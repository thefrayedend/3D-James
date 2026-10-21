#!/usr/bin/env python3
"""
3DJames box - system helper (runs as root; the 3DJames server may call it through sudo).

Used by systemd units:
  firstboot        grow the root partition to fill the SD card, fresh SSH keys and machine id (once)
  apply-config     apply 3djames-config.txt from the SD card's 3DJAMES drive (Wi-Fi, name, first admin, SSH)
  hotspot-watch    start a setup Wi-Fi hotspot when the box has no network; write MY-3DJAMES-ADDRESS.txt (long-running)

Used by the server's admin page (`sudo 3djames-helper <cmd>`), all print JSON:
  net-status | wifi-scan | wifi-connect <ssid> (password on stdin) | set-hostname <name> | reboot | shutdown | system-info
  mount-place <id>      connect a NAS share (settings as JSON on stdin; the password is kept here, root only)
  forget-place <id>     disconnect it and forget its settings
  update-share on|off <folder>   the "3DJames-update" network folder (password on stdin)
  server-update <zip>   install a new server program and restart it
"""
import grp
import hashlib
import json
import os
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

SETUP_DIR = "/tdjsetup"
CONFIG_FILE = os.path.join(SETUP_DIR, "3djames-config.txt")
ADDRESS_FILE = os.path.join(SETUP_DIR, "MY-3DJAMES-ADDRESS.txt")
STATE_DIR = "/var/lib/3djames-sys"
DATA_DIR = "/var/lib/3djames"
PLACES_DIR = "/etc/3djames/places"
MOUNT_ROOT = "/mnt/3djames"
SERVER_DIR = "/opt/3djames/server"
SERVICE_USER = "threedjames"
WIFI_CON = "3djames-wifi"
HOTSPOT_CON = "3djames-hotspot"
HOTSPOT_PASSWORD = "3djames123"
SCAN_CACHE = os.path.join(STATE_DIR, "wifi-scan.json")
ADMIN_USER = "tdjadmin"
SAMBA_CONF = "/etc/samba/3djames.conf"


# ----------------------------------------------------------------------------- helpers
def run(cmd, check=False, timeout=60, input_text=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input_text)
    except (OSError, subprocess.TimeoutExpired) as e:
        if check:
            raise
        return subprocess.CompletedProcess(cmd, 1, "", str(e))
    if check and r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f"{cmd[0]} failed")
    return r


def log(msg):
    print(f"3djames: {msg}", file=sys.stderr, flush=True)


def out(obj):
    print(json.dumps(obj))


def nm_fields(line):
    """Split nmcli -t output (':' separated, '\\:' escaped)."""
    return [p.replace("\\:", ":") for p in re.split(r"(?<!\\):", line)]


def parse_config(path=CONFIG_FILE):
    cfg = {}
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line[0] in "#;[" or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                cfg[k.strip().lower()] = v
    except FileNotFoundError:
        pass
    return cfg


def truthy(v):
    return str(v).strip().lower() in ("1", "yes", "y", "on", "true", "enable", "enabled")


def service_ids():
    try:
        return pwd.getpwnam(SERVICE_USER).pw_uid, grp.getgrnam(SERVICE_USER).gr_gid
    except KeyError:
        return 0, 0


def wifi_device():
    r = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device"])
    for line in r.stdout.splitlines():
        f = nm_fields(line)
        if len(f) >= 2 and f[1] == "wifi" and not f[0].startswith("p2p"):
            return f[0]
    return None


def ipv4_of(dev):
    r = run(["ip", "-4", "-o", "addr", "show", "dev", dev])
    m = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", r.stdout)
    return m.group(1) if m else ""


def hotspot_active():
    r = run(["nmcli", "-t", "-f", "NAME", "connection", "show", "--active"])
    return HOTSPOT_CON in r.stdout.splitlines()


def network_ips():
    """IPv4 addresses on ethernet / normal Wi-Fi (not the setup hotspot)."""
    ips = []
    r = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    for line in r.stdout.splitlines():
        f = nm_fields(line)
        if len(f) < 4 or f[1] not in ("ethernet", "wifi") or not f[2].startswith("connected") or f[3] == HOTSPOT_CON:
            continue
        ip = ipv4_of(f[0])
        if ip and not ip.startswith("10.42.") and not ip.startswith("169.254."):
            ips.append(ip)
    return ips


def hotspot_ssid():
    try:
        dev = wifi_device()
        mac = open(f"/sys/class/net/{dev}/address").read().strip().replace(":", "") if dev else ""
    except OSError:
        mac = ""
    return "3DJames-Setup-" + (mac[-4:].upper() if mac else "Box")


def hostname():
    try:
        return open("/etc/hostname").read().strip()
    except OSError:
        return "3djames"


# ----------------------------------------------------------------------------- first boot
def firstboot():
    os.makedirs(STATE_DIR, exist_ok=True)
    marker = os.path.join(STATE_DIR, "firstboot.done")
    if os.path.exists(marker):
        return
    try:
        src = run(["findmnt", "-n", "-o", "SOURCE", "/"]).stdout.strip()  # e.g. /dev/mmcblk0p1
        m = re.match(r"(/dev/(?:mmcblk\d+|nvme\d+n\d+|sd[a-z]+))p?(\d+)$", src)
        if m:
            disk, part = m.group(1), m.group(2)
            log(f"growing {src} to fill {disk}")
            run(["sfdisk", "--no-reread", "--no-tell-kernel", "-N", part, disk], input_text=", +\n")
            r = run(["partx", "-u", "--nr", part, disk])
            if r.returncode != 0:
                run(["resizepart", disk, part, str(int(run(["sfdisk", "--show-size", src]).stdout.strip() or 0))])
            run(["resize2fs", src], timeout=600)
        else:
            log(f"root device {src} not recognised, not resizing")
    except Exception as e:  # noqa: BLE001
        log(f"resize failed: {e}")
    if os.path.isdir("/etc/ssh"):
        for f in os.listdir("/etc/ssh"):
            if f.startswith("ssh_host_"):
                os.remove(os.path.join("/etc/ssh", f))
        run(["ssh-keygen", "-A"])
    try:
        if os.path.getsize("/etc/machine-id") == 0 or open("/etc/machine-id").read().strip() in ("", "uninitialized"):
            run(["systemd-machine-id-setup"])
    except OSError:
        run(["systemd-machine-id-setup"])
    open(marker, "w").write(time.strftime("%Y-%m-%d %H:%M:%S\n"))


# ----------------------------------------------------------------------------- SD card config
def apply_config():
    os.makedirs(STATE_DIR, exist_ok=True)
    cfg = parse_config()
    if not cfg:
        log("no 3djames-config.txt settings found")
        return
    fingerprint = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()
    stamp = os.path.join(STATE_DIR, "config.sha256")
    if os.path.exists(stamp) and open(stamp).read().strip() == fingerprint:
        log("3djames-config.txt unchanged")
        return

    name = re.sub(r"[^a-z0-9-]", "", cfg.get("hostname", "").lower())[:32]
    if name:
        set_hostname(name)

    country = cfg.get("wifi_country", "").upper()
    if re.fullmatch(r"[A-Z]{2}", country):
        run(["iw", "reg", "set", country])
        try:
            with open("/etc/default/crda", "w") as f:
                f.write(f"REGDOMAIN={country}\n")
        except OSError:
            pass

    complete = True
    ssid = cfg.get("wifi_name") or cfg.get("wifi_ssid") or ""
    if ssid:
        for _ in range(30):  # the Wi-Fi driver can show up a little after NetworkManager
            if wifi_device():
                break
            time.sleep(1)
        r = wifi_configure(ssid, cfg.get("wifi_password", ""), hidden=truthy(cfg.get("wifi_hidden", "no")), connect=False)
        log(r.get("message", ""))
        complete = r.get("ok", False)

    tz = cfg.get("timezone", "")
    if tz and os.path.exists(f"/usr/share/zoneinfo/{tz}"):
        run(["timedatectl", "set-timezone", tz])

    # the first admin account (instead of making it on the admin page)
    admin, pw = cfg.get("admin_name", "").strip().lower(), cfg.get("admin_password", "")
    if admin and len(pw) >= 6:
        os.makedirs(DATA_DIR, exist_ok=True)
        p = os.path.join(DATA_DIR, "initial-admin.json")
        with open(p, "w") as f:
            json.dump({"user": admin, "password": pw}, f)
        uid, gid = service_ids()
        os.chown(p, uid, gid)
        os.chmod(p, 0o600)

    ssh_pw = cfg.get("ssh_password", "")
    if truthy(cfg.get("ssh", "no")) and len(ssh_pw) >= 6:
        if run(["id", ADMIN_USER]).returncode != 0:
            run(["useradd", "-m", "-s", "/bin/bash", "-G", "sudo", ADMIN_USER])
        run(["chpasswd"], input_text=f"{ADMIN_USER}:{ssh_pw}\n")
        run(["systemctl", "enable", "--now", "ssh"])
        log(f"SSH enabled for user {ADMIN_USER}")
    elif "ssh" in cfg and not truthy(cfg.get("ssh")):
        run(["systemctl", "disable", "--now", "ssh"])

    if complete:
        with open(stamp, "w") as f:
            f.write(fingerprint)


# ----------------------------------------------------------------------------- Wi-Fi
def wifi_configure(ssid, password, hidden=False, connect=True, timeout=45):
    dev = wifi_device()
    if not dev:
        return {"ok": False, "message": "No Wi-Fi hardware found on this box."}
    run(["nmcli", "radio", "wifi", "on"])
    run(["nmcli", "connection", "delete", WIFI_CON])
    args = ["nmcli", "connection", "add", "type", "wifi", "con-name", WIFI_CON, "ifname", dev, "ssid", ssid,
            "connection.autoconnect", "yes", "connection.autoconnect-priority", "10", "802-11-wireless.powersave", "2"]
    if hidden:
        args += ["802-11-wireless.hidden", "yes"]
    if password:
        args += ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password]
    r = run(args)
    if r.returncode != 0:
        return {"ok": False, "message": "Could not save the Wi-Fi settings: " + (r.stderr or r.stdout).strip()}
    if not connect:
        return {"ok": True, "message": f"Wi-Fi \"{ssid}\" saved."}
    was_hotspot = hotspot_active()
    if was_hotspot:
        run(["nmcli", "connection", "down", HOTSPOT_CON])
        time.sleep(2)
    r = run(["nmcli", "--wait", str(timeout), "connection", "up", WIFI_CON], timeout=timeout + 15)
    if r.returncode == 0:
        time.sleep(2)
        return {"ok": True, "message": f"Connected to \"{ssid}\" ({ipv4_of(dev) or 'getting an address'}).", "ip": ipv4_of(dev)}
    msg = (r.stderr or r.stdout).strip()
    if "Secrets were required" in msg or "802-1x" in msg or "psk" in msg.lower():
        msg = "Wrong Wi-Fi password."
    elif "No network with SSID" in msg:
        msg = f"Network \"{ssid}\" not found. Check the name (upper/lower case matters) and that the router is in range."
    if was_hotspot:
        start_hotspot()
    return {"ok": False, "message": "Could not connect: " + msg}


def wifi_scan():
    if hotspot_active():
        try:
            nets = json.load(open(SCAN_CACHE))
            return {"ok": True, "networks": nets, "message": "List from before the setup hotspot started."}
        except (OSError, ValueError):
            return {"ok": True, "networks": [], "message": "Can't search while the setup hotspot is on. Type your Wi-Fi name."}
    dev = wifi_device()
    if not dev:
        return {"ok": False, "networks": [], "message": "No Wi-Fi hardware found on this box."}
    run(["nmcli", "device", "wifi", "rescan", "ifname", dev], timeout=20)
    time.sleep(3)
    r = run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", dev], timeout=30)
    best = {}
    for line in r.stdout.splitlines():
        f = nm_fields(line)
        if len(f) < 4 or not f[1]:
            continue
        sig = int(f[2] or 0)
        cur = best.get(f[1])
        if not cur or sig > cur["signal"]:
            best[f[1]] = {"ssid": f[1], "signal": sig, "security": f[3] not in ("", "--"), "inUse": f[0] == "*"}
    nets = sorted(best.values(), key=lambda n: -n["signal"])
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        json.dump(nets, open(SCAN_CACHE, "w"))
    except OSError:
        pass
    return {"ok": True, "networks": nets}


def net_status():
    st = {"ok": True, "hostname": hostname(),
          "ethernet": {"connected": False, "ip": ""},
          "wifi": {"present": False, "connected": False, "ssid": "", "ip": "", "signal": 0},
          "hotspot": {"active": False, "ssid": hotspot_ssid(), "password": HOTSPOT_PASSWORD}}
    r = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    for line in r.stdout.splitlines():
        f = nm_fields(line)
        if len(f) < 4:
            continue
        if f[1] == "ethernet" and f[2].startswith("connected"):
            st["ethernet"] = {"connected": True, "ip": ipv4_of(f[0])}
        if f[1] == "wifi":
            st["wifi"]["present"] = True
            if f[2].startswith("connected"):
                if f[3] == HOTSPOT_CON:
                    st["hotspot"]["active"] = True
                else:
                    st["wifi"].update({"connected": True, "ip": ipv4_of(f[0])})
                    w = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "ifname", f[0], "--rescan", "no"])
                    for wl in w.stdout.splitlines():
                        wf = nm_fields(wl)
                        if len(wf) >= 3 and wf[0] == "yes":
                            st["wifi"].update({"ssid": wf[1], "signal": int(wf[2] or 0)})
    return st


def start_hotspot():
    dev = wifi_device()
    if not dev:
        return False
    try:
        wifi_scan()
    except Exception:  # noqa: BLE001
        pass
    run(["nmcli", "connection", "delete", HOTSPOT_CON])
    r = run(["nmcli", "connection", "add", "type", "wifi", "ifname", dev, "con-name", HOTSPOT_CON,
             "autoconnect", "no", "ssid", hotspot_ssid(), "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg",
             "ipv4.method", "shared", "ipv4.addresses", "10.42.0.1/24", "ipv6.method", "disabled",
             "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", HOTSPOT_PASSWORD])
    if r.returncode != 0:
        log("hotspot setup failed: " + r.stderr.strip())
        return False
    r = run(["nmcli", "--wait", "20", "connection", "up", HOTSPOT_CON], timeout=40)
    log("setup hotspot " + ("started: " + hotspot_ssid() if r.returncode == 0 else "failed: " + r.stderr.strip()))
    return r.returncode == 0


def write_address_file(ips):
    """MY-3DJAMES-ADDRESS.txt on the SD card's 3DJAMES drive: readable on any PC."""
    if not os.path.ismount(SETUP_DIR) or not ips:
        return
    name = hostname()
    text = ("Your 3DJames box\r\n================\r\n\r\n"
            f"The app:         http://{name}.local      or  http://{ips[0]}\r\n"
            f"The admin page:  http://{name}.local:8080 or  http://{ips[0]}:8080\r\n\r\n"
            f"(written {time.strftime('%Y-%m-%d %H:%M')})\r\n")
    try:
        old = open(ADDRESS_FILE, encoding="utf-8").read().split("(written")[0]
    except OSError:
        old = ""
    if old != text.split("(written")[0]:
        with open(ADDRESS_FILE, "w", encoding="utf-8", newline="") as f:
            f.write(text)


def hotspot_watch():
    """Starts the setup hotspot when the box has no network ~90 s after boot; while it runs, retries the saved
    Wi-Fi every 5 minutes. Also keeps MY-3DJAMES-ADDRESS.txt on the SD card up to date."""
    for _ in range(90):
        if network_ips():
            break
        time.sleep(1)
    last_retry = time.time()
    while True:
        try:
            ips = network_ips()
            if ips:
                write_address_file(ips)
                if hotspot_active():
                    run(["nmcli", "connection", "down", HOTSPOT_CON])
            elif not hotspot_active():
                start_hotspot()
                last_retry = time.time()
            elif time.time() - last_retry > 300:
                last_retry = time.time()
                if run(["nmcli", "-t", "-f", "NAME", "connection", "show"]).stdout.count(WIFI_CON):
                    log("retrying saved Wi-Fi")
                    run(["nmcli", "connection", "down", HOTSPOT_CON])
                    time.sleep(2)
                    if run(["nmcli", "--wait", "30", "connection", "up", WIFI_CON], timeout=45).returncode != 0:
                        start_hotspot()
        except Exception as e:  # noqa: BLE001
            log(f"hotspot-watch: {e}")
        time.sleep(15)


# ----------------------------------------------------------------------------- NAS shares
def place_paths(pid):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,23}", pid or ""):
        raise ValueError("bad place id")
    return os.path.join(PLACES_DIR, pid + ".json"), os.path.join(PLACES_DIR, pid + ".cred"), os.path.join(MOUNT_ROOT, pid)


def friendly_mount_error(text, typ):
    t = text.lower()
    if "permission denied" in t or "error(13)" in t or "access denied" in t:
        return "The NAS said no: check the NAS user name and password, and that this user may use the share." if typ == "smb" else "The NAS said no: allow this box's address to read and write the exported folder."
    if "no such file" in t or "error(2)" in t or "bad share name" in t:
        return "That share (or folder) was not found on the NAS. Check its name."
    if "host is down" in t or "unreachable" in t or "error(112)" in t or "could not resolve" in t or "timed out" in t or "error(113)" in t:
        return "Could not reach the NAS. Check its name or address, and that it is switched on."
    if "operation not supported" in t or "error(95)" in t:
        return "The NAS does not speak that SMB version. Pick another one (or Automatic)."
    return "Could not connect: " + text.strip()[-300:]


def mount_place(pid):
    spec_in = json.loads(sys.stdin.read() or "{}")
    spec_path, cred_path, mnt = place_paths(pid)
    os.makedirs(PLACES_DIR, mode=0o700, exist_ok=True)
    old = {}
    if os.path.exists(spec_path):
        old = json.load(open(spec_path))
    spec = old if spec_in.get("reconnect") else dict(spec_in)
    if not spec.get("type"):
        return {"ok": False, "message": "This storage place has no settings yet. Edit it on the admin page."}
    if spec_in.get("keepPassword") and "password" in old:
        spec["password"] = old["password"]
    spec.pop("keepPassword", None)
    spec.pop("reconnect", None)
    uid, gid = service_ids()
    os.makedirs(mnt, exist_ok=True)
    if os.path.ismount(mnt):
        if spec_in.get("reconnect"):
            return {"ok": True, "message": "Connected."}
        run(["umount", "-l", mnt])
    if spec["type"] == "smb":
        with open(cred_path, "w") as f:
            os.chmod(cred_path, 0o600)
            f.write(f"username={spec.get('username', '')}\npassword={spec.get('password', '')}\n")
            if spec.get("domain"):
                f.write(f"domain={spec['domain']}\n")
        base = f"credentials={cred_path},uid={uid},gid={gid},file_mode=0664,dir_mode=0775,iocharset=utf8,noperm,soft"
        versions = [spec["vers"]] if spec.get("vers") else ["3.0", "2.1", "2.0", "1.0"]
        src = f"//{spec['server']}/{spec['share']}"
        err = ""
        for v in versions:
            r = run(["mount", "-t", "cifs", src, mnt, "-o", f"{base},vers={v}"], timeout=40)
            if r.returncode == 0:
                spec["vers_used"] = v
                break
            err = (r.stderr or r.stdout)
        if not os.path.ismount(mnt):
            return {"ok": False, "message": friendly_mount_error(err, "smb")}
    elif spec["type"] == "nfs":
        r = run(["mount", "-t", "nfs", f"{spec['server']}:{spec['export']}", mnt, "-o", "soft,timeo=100,retrans=2"], timeout=40)
        if r.returncode != 0:
            return {"ok": False, "message": friendly_mount_error(r.stderr or r.stdout, "nfs")}
    else:
        return {"ok": False, "message": "Unknown kind of storage."}
    with open(spec_path, "w") as f:
        os.chmod(spec_path, 0o600)
        json.dump(spec, f)
    # can the server (not root) write there?
    test = os.path.join(mnt, f".3djames-test-{os.getpid()}")
    r = run(["runuser", "-u", SERVICE_USER, "--", "sh", "-c", f"echo ok > '{test}' && rm -f '{test}'"])
    if r.returncode != 0:
        return {"ok": True, "message": "Connected, but 3DJames may not write there. On the NAS, give this user (or this box) read and write access to the share.", "readOnly": True}
    return {"ok": True, "message": "Connected."}


def forget_place(pid):
    spec_path, cred_path, mnt = place_paths(pid)
    if os.path.ismount(mnt):
        run(["umount", "-l", mnt])
    for p in (spec_path, cred_path):
        try:
            os.remove(p)
        except OSError:
            pass
    try:
        os.rmdir(mnt)
    except OSError:
        pass
    return {"ok": True}


# ----------------------------------------------------------------------------- the update folder (Samba)
def update_share(on, folder):
    password = sys.stdin.read().rstrip("\r\n")
    if not shutil.which("smbd"):
        return {"ok": False, "message": "The network-folder program (Samba) is not installed on this box."}
    if on:
        os.makedirs(folder, exist_ok=True)
        uid, gid = service_ids()
        os.chown(folder, uid, gid)
        with open(SAMBA_CONF, "w") as f:
            f.write(f"""# Written by the 3DJames admin page (App > Update folder).
[3DJames-update]
   comment = Copy a new 3DJames.html here to install it
   path = {folder}
   valid users = {SERVICE_USER}
   force user = {SERVICE_USER}
   writable = yes
   create mask = 0664
   directory mask = 0775
""")
        main_conf = "/etc/samba/smb.conf"
        text = open(main_conf).read() if os.path.exists(main_conf) else "[global]\n   workgroup = WORKGROUP\n"
        if f"include = {SAMBA_CONF}" not in text:
            with open(main_conf, "a") as f:
                f.write(f"\ninclude = {SAMBA_CONF}\n")
        if password:
            r = run(["smbpasswd", "-a", "-s", SERVICE_USER], input_text=f"{password}\n{password}\n")
            if r.returncode != 0:
                return {"ok": False, "message": "Could not set the password: " + (r.stderr or r.stdout).strip()}
            run(["smbpasswd", "-e", SERVICE_USER])
        for s in ("smbd", "nmbd"):
            run(["systemctl", "enable", s])
            run(["systemctl", "restart", s])
        return {"ok": True, "message": f"The update folder is on: \\\\{hostname()}\\3DJames-update (sign in as {SERVICE_USER})."}
    with open(SAMBA_CONF, "w") as f:
        f.write("# The 3DJames update folder is switched off (admin page > App).\n")
    for s in ("smbd", "nmbd"):
        run(["systemctl", "disable", "--now", s])
    return {"ok": True, "message": "The update folder is off."}


# ----------------------------------------------------------------------------- the server program itself
def server_update(zip_path):
    try:
        z = zipfile.ZipFile(zip_path)
    except (OSError, zipfile.BadZipFile):
        return {"ok": False, "message": "That is not a zip file."}
    names = z.namelist()
    prefix = ""
    main = [n for n in names if n.endswith("3djames_server.py")]
    if not main:
        return {"ok": False, "message": "That zip has no 3DJames server in it (3djames_server.py)."}
    prefix = main[0][: -len("3djames_server.py")]
    if not any(n.startswith(prefix + "tdj/") for n in names) or any(".." in n or n.startswith("/") for n in names):
        return {"ok": False, "message": "That zip doesn't look like a 3DJames server."}
    new = SERVER_DIR + ".new"
    shutil.rmtree(new, ignore_errors=True)
    tmp = tempfile.mkdtemp()
    z.extractall(tmp)
    shutil.copytree(os.path.join(tmp, prefix) if prefix else tmp, new)
    shutil.rmtree(tmp, ignore_errors=True)
    r = run(["python3", "-m", "py_compile", os.path.join(new, "3djames_server.py")])
    if r.returncode != 0:
        shutil.rmtree(new, ignore_errors=True)
        return {"ok": False, "message": "The new server program has an error: " + r.stderr.strip()[-300:]}
    old = SERVER_DIR + ".previous"
    shutil.rmtree(old, ignore_errors=True)
    if os.path.isdir(SERVER_DIR):
        os.rename(SERVER_DIR, old)
    os.rename(new, SERVER_DIR)
    run(["chown", "-R", "root:root", SERVER_DIR])
    run(["systemd-run", "--on-active=2", "systemctl", "restart", "3djames.service"])
    version = open(os.path.join(SERVER_DIR, "VERSION")).read().strip() if os.path.exists(os.path.join(SERVER_DIR, "VERSION")) else "?"
    return {"ok": True, "message": f"Server {version} installed. It restarts now: reload this page in a few seconds."}


# ----------------------------------------------------------------------------- system
def set_hostname(name):
    name = re.sub(r"[^a-z0-9-]", "", name.lower())[:32]
    if not name:
        return {"ok": False, "message": "Use letters, numbers and dashes only."}
    run(["hostnamectl", "set-hostname", name])
    try:
        with open("/etc/hostname", "w") as f:
            f.write(name + "\n")
        hosts = open("/etc/hosts").read()
        hosts = re.sub(r"^127\.0\.1\.1\s+.*$", f"127.0.1.1\t{name}", hosts, flags=re.M)
        if "127.0.1.1" not in hosts:
            hosts += f"127.0.1.1\t{name}\n"
        open("/etc/hosts", "w").write(hosts)
    except OSError:
        pass
    run(["systemctl", "restart", "avahi-daemon"])
    return {"ok": True, "message": f"Renamed: the app is now at http://{name}.local"}


def system_info():
    info = {"ok": True}
    try:
        info["model"] = open("/proc/device-tree/model").read().strip("\x00\n ")
    except OSError:
        pass
    try:
        for line in open("/etc/os-release"):
            if line.startswith("PRETTY_NAME="):
                info["os"] = line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    try:
        up = float(open("/proc/uptime").read().split()[0])
        d, h, m = int(up // 86400), int(up % 86400 // 3600), int(up % 3600 // 60)
        info["uptime"] = (f"{d} days " if d else "") + f"{h}h {m}m"
    except OSError:
        pass
    temps = []
    for z in sorted(os.listdir("/sys/class/thermal")) if os.path.isdir("/sys/class/thermal") else []:
        try:
            temps.append(int(open(f"/sys/class/thermal/{z}/temp").read()) / 1000)
        except (OSError, ValueError):
            pass
    if temps:
        info["temp"] = f"{max(temps):.0f} °C"
    try:
        mem = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo")}
        info["memory"] = f"{(mem['MemTotal'] - mem['MemAvailable']) / 1024:.0f} MB used of {mem['MemTotal'] / 1024:.0f} MB"
    except (OSError, KeyError, ValueError):
        pass
    try:
        s = os.statvfs("/")
        info["disk"] = f"{s.f_bavail * s.f_frsize / 1e9:.1f} GB free of {s.f_blocks * s.f_frsize / 1e9:.1f} GB"
    except OSError:
        pass
    return info


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd, args = sys.argv[1], sys.argv[2:]
    try:
        if cmd == "firstboot":
            firstboot()
        elif cmd == "apply-config":
            apply_config()
        elif cmd == "hotspot-watch":
            hotspot_watch()
        elif cmd == "net-status":
            out(net_status())
        elif cmd == "wifi-scan":
            out(wifi_scan())
        elif cmd == "wifi-connect" and args:
            out(wifi_configure(args[0], sys.stdin.read().rstrip("\r\n")))
        elif cmd == "set-hostname" and args:
            out(set_hostname(args[0]))
        elif cmd == "system-info":
            out(system_info())
        elif cmd == "mount-place" and args:
            out(mount_place(args[0]))
        elif cmd == "forget-place" and args:
            out(forget_place(args[0]))
        elif cmd == "update-share" and len(args) == 2:
            out(update_share(args[0] == "on", args[1]))
        elif cmd == "server-update" and args:
            out(server_update(args[0]))
        elif cmd == "reboot":
            out({"ok": True, "message": "Restarting. The box is back in about a minute."})
            sys.stdout.flush()
            run(["systemd-run", "--on-active=1", "systemctl", "reboot"])
        elif cmd == "shutdown":
            out({"ok": True, "message": "Shutting down. Unplug and plug the box in to start it again."})
            sys.stdout.flush()
            run(["systemd-run", "--on-active=1", "systemctl", "poweroff"])
        else:
            out({"ok": False, "message": f"unknown command {cmd}"})
            sys.exit(2)
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
