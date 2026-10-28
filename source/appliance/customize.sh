#!/bin/bash
# Runs INSIDE the board's root filesystem (chroot) during build-image.sh.
# Installs system packages and enables the services.
# The 3DJames server files themselves were already copied in by build-image.sh.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 LANG=C.UTF-8

log() { echo "[customize] $*"; }

# ---------------------------------------------------------------- packages
log "Installing system packages"
# Vendor images point apt at their own mirrors (e.g. repo.huaweicloud.com), which are often
# slow, out of date or unreachable from the build server. For the build we use the official
# Debian/Ubuntu servers and put the vendor's settings back afterwards.
. /etc/os-release
CODENAME="${VERSION_CODENAME:-}"
APT_BAK=/tmp/apt-sources-backup
rm -rf "$APT_BAK"; mkdir -p "$APT_BAK"
cp -a /etc/apt/sources.list "$APT_BAK/" 2>/dev/null || true
[ -d /etc/apt/sources.list.d ] && cp -a /etc/apt/sources.list.d "$APT_BAK/" && rm -f /etc/apt/sources.list.d/*
restore_apt() {
  rm -f /etc/apt/sources.list /etc/apt/sources.list.d/* 2>/dev/null || true
  [ -f "$APT_BAK/sources.list" ] && cp -a "$APT_BAK/sources.list" /etc/apt/sources.list
  [ -d "$APT_BAK/sources.list.d" ] && cp -a "$APT_BAK/sources.list.d/." /etc/apt/sources.list.d/
  rm -rf "$APT_BAK"
}
trap restore_apt EXIT
PKGS="avahi-daemon libnss-mdns network-manager dnsmasq-base wpasupplicant iw rfkill wireless-regdb
  sudo python3 ca-certificates dosfstools fdisk e2fsprogs util-linux curl tzdata"

# Writes /etc/apt/sources.list for one of several server choices.
set_sources() {
  if [ "${ID:-}" = ubuntu ]; then
    local M=http://ports.ubuntu.com/ubuntu-ports
    [ "$(dpkg --print-architecture)" = amd64 ] && M=http://archive.ubuntu.com/ubuntu
    case "$1" in
      full) printf 'deb %s %s main universe\ndeb %s %s-updates main universe\ndeb %s %s-security main universe\n' "$M" "$CODENAME" "$M" "$CODENAME" "$M" "$CODENAME" ;;
      base) printf 'deb %s %s main universe\n' "$M" "$CODENAME" ;;
      *) return 1 ;;
    esac > /etc/apt/sources.list
    return 0
  fi
  local SEC="$CODENAME-security"; [ "$CODENAME" = buster ] && SEC="buster/updates"
  local C="main contrib non-free"
  case "$1" in
    # 1) normal Debian servers incl. security updates
    full) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\ndeb http://deb.debian.org/debian-security %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 2) old release whose security updates were moved: security from archive.debian.org
    mixed) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\ndeb http://archive.debian.org/debian-security %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 3) snapshot.debian.org keeps every package version ever published (slow but complete)
    snapshot) printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260815T000000Z %s %s\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260815T000000Z %s-updates %s\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260815T000000Z %s %s\n' \
            "$CODENAME" "$C" "$CODENAME" "$C" "$SEC" "$C" ;;
    # 4) without security updates
    base) printf 'deb http://deb.debian.org/debian %s %s\ndeb http://deb.debian.org/debian %s-updates %s\n' "$CODENAME" "$C" "$CODENAME" "$C" ;;
    # 5) fully archived release
    archive) printf 'deb http://archive.debian.org/debian %s %s\ndeb http://archive.debian.org/debian-security %s %s\n' "$CODENAME" "$C" "$SEC" "$C" ;;
    *) return 1 ;;
  esac > /etc/apt/sources.list
}

INSTALLED=0
for choice in full mixed snapshot base archive; do
  set_sources "$choice" || continue
  log "Trying package servers: $choice (${ID:-?} $CODENAME)"
  rm -rf /var/lib/apt/lists/*   # drop stale lists from earlier attempts / the vendor mirror
  apt-get -o Acquire::Check-Valid-Until=false update || true
  # shellcheck disable=SC2086
  if apt-get install -y --no-install-recommends $PKGS; then
    INSTALLED=1
    break
  fi
  log "That didn't work, trying the next option"
done
[ "$INSTALLED" = 1 ] || { echo "[customize] ERROR: could not install the system packages from any package server"; exit 1; }
# Optional, nice to have; ignore if the distro calls them differently.
apt-get install -y --no-install-recommends openssh-server || true
# Samba: for the optional "3DJames-update" network folder (switched off until the admin turns it on), and the NAS
# self-test below.
apt-get install -y --no-install-recommends samba samba-common-bin || log "samba not available"
# USB drives formatted as exFAT or NTFS, for kernels without their own driver (the self-test checks what is there).
apt-get install -y --no-install-recommends exfat-fuse || log "exfat-fuse not available"
apt-get install -y --no-install-recommends ntfs-3g || log "ntfs-3g not available"

# ---------------------------------------------------------------- user & folders
if ! id threedjames >/dev/null 2>&1; then
  log "Creating service user threedjames"
  useradd --system --home-dir /var/lib/3djames --create-home --shell /usr/sbin/nologin threedjames
fi
install -d -o threedjames -g threedjames -m 750 /var/lib/3djames
install -d -o threedjames -g threedjames -m 775 /srv/3djames
install -d -m 755 /var/lib/3djames-sys /tdjsetup /mnt/3djames
install -d -m 700 /etc/3djames /etc/3djames/places
chown -R root:root /opt/3djames
# Every system file this image adds belongs to root (sudo refuses a sudoers folder owned by anyone else, and then the
# server can't run its helper: no NAS shares, no Wi-Fi changes). Checked, so a broken image can't be shipped again.
chown root:root /etc/sudoers.d /etc/sudoers.d/3djames /usr/local/sbin/3djames-helper
chown -R root:root /usr/local/lib/3djames /etc/systemd/system/3djames*.service /etc/NetworkManager/conf.d /etc/NetworkManager/dnsmasq-shared.d /etc/avahi/services /etc/systemd/journald.conf.d
chmod 755 /etc/sudoers.d /usr/local/sbin/3djames-helper; chmod 440 /etc/sudoers.d/3djames
visudo -c >/dev/null || { echo "[customize] ERROR: the sudoers settings are not valid"; visudo -c; exit 1; }
[ "$(stat -c %u /etc/sudoers.d)" = 0 ] && [ "$(stat -c %u /etc/sudoers.d/3djames)" = 0 ] || { echo "[customize] ERROR: /etc/sudoers.d must belong to root"; exit 1; }
python3 -m py_compile /opt/3djames/server/3djames_server.py
# Samba: off until the admin switches the update folder on
mkdir -p /etc/samba
[ -f /etc/samba/3djames.conf ] || echo "# The 3DJames update folder is switched off (admin page > App)." > /etc/samba/3djames.conf
if [ -f /etc/samba/smb.conf ] && ! grep -q 3djames.conf /etc/samba/smb.conf; then echo "include = /etc/samba/3djames.conf" >> /etc/samba/smb.conf; fi
systemctl disable smbd.service nmbd.service samba-ad-dc.service 2>/dev/null || true

# ---------------------------------------------------------------- SD-card settings drive
if ! grep -q 'LABEL=3DJAMES' /etc/fstab; then
  log "Adding the 3DJAMES settings drive to /etc/fstab"
  echo 'LABEL=3DJAMES /tdjsetup vfat defaults,nofail,uid=threedjames,gid=threedjames,fmask=0133,dmask=0022,flush,x-systemd.device-timeout=15s 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------- hostname / mDNS
echo 3djames > /etc/hostname
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sed -i 's/^127\.0\.1\.1.*/127.0.1.1\t3djames/' /etc/hosts
else
  printf '127.0.1.1\t3djames\n' >> /etc/hosts
fi
# Use mDNS (.local) for name lookups too.
if grep -q '^hosts:' /etc/nsswitch.conf && ! grep -q mdns /etc/nsswitch.conf; then
  sed -i 's/^hosts:.*/hosts:          files mdns4_minimal [NOTFOUND=return] dns/' /etc/nsswitch.conf
fi

# ---------------------------------------------------------------- security defaults
# Vendor images ship well-known default passwords and SSH switched on. A rookie never needs
# them, so lock them; SSH can be enabled from 3djames-config.txt with a personal password.
log "Locking default accounts and disabling SSH (enable it in 3djames-config.txt)"
passwd -l root >/dev/null 2>&1 || true
for u in $(awk -F: '$3 >= 1000 && $3 < 60000 {print $1}' /etc/passwd); do
  [ "$u" = threedjames ] || [ "$u" = tdjadmin ] || passwd -l "$u" >/dev/null 2>&1 || true
done
systemctl disable ssh.service 2>/dev/null || true
systemctl disable sshd.service 2>/dev/null || true
# Skip Armbian's interactive first-login wizard (nobody logs in on this appliance).
rm -f /root/.not_logged_in_yet
# Getty autologin on the debug console of some vendor images: turn it off.
rm -f /etc/systemd/system/serial-getty@*.service.d/override.conf /etc/systemd/system/getty@tty1.service.d/override.conf 2>/dev/null || true

# ---------------------------------------------------------------- services
# Our firstboot service grows the root partition; vendor resizers would fight over it.
for s in armbian-resize-filesystem orangepi-resize-filesystem resize2fs_once rpi-resizefs; do
  systemctl disable "$s.service" 2>/dev/null || true
  systemctl mask "$s.service" 2>/dev/null || true
done
systemctl enable NetworkManager.service avahi-daemon.service || true
systemctl enable 3djames-firstboot.service 3djames-config.service 3djames-hotspot.service 3djames.service
# A static/ifupdown wlan0 config would stop NetworkManager from managing Wi-Fi.
if [ -f /etc/network/interfaces ]; then
  sed -i -E '/^\s*(auto|allow-hotplug)\s+wlan[0-9]+/d; /^\s*iface\s+wlan[0-9]+/,/^\s*$/d' /etc/network/interfaces || true
fi

# ---------------------------------------------------------------- self-test (the build fails if any of this is wrong)
# The admin page runs the root helper as the service user, through sudo, with no password: try exactly that.
log "Self-test: the service user can run the root helper"
out=$(runuser -u threedjames -- sudo -n /usr/local/sbin/3djames-helper build-selftest 2>&1 || true)
echo "$out" | grep -q 'unknown command build-selftest' || { echo "[customize] ERROR: the server can't run its helper through sudo: $out"; exit 1; }
for f in /etc/sudoers.d /etc/sudoers.d/3djames /usr/local/sbin/3djames-helper /usr/local/lib/3djames/tdjsys.py /opt/3djames/server/3djames_server.py; do
  [ "$(stat -c %u "$f")" = 0 ] || { echo "[customize] ERROR: $f does not belong to root"; exit 1; }
done
for t in lsblk blkid findmnt; do command -v "$t" >/dev/null || { echo "[customize] ERROR: $t is missing (needed for USB drives)"; exit 1; }; done

# USB drives: the board's own kernel must read USB sticks and the usual Windows/Mac formats.
has_mod() {  # built into the kernel, or a module file
  local d
  for d in /lib/modules/*/; do
    grep -q "/$1\.ko" "$d/modules.builtin" 2>/dev/null && return 0
    [ -n "$(find "$d" -name "$1.ko*" -print -quit 2>/dev/null)" ] && return 0
  done
  return 1
}
log "Kernel support (for USB drives and NAS shares):"
for m in usb-storage uas vfat exfat ntfs3 fuse ext4 cifs; do
  if has_mod "$m"; then log "  $m: yes"; else log "  $m: no"; fi
done
has_mod usb-storage || { echo "[customize] ERROR: this kernel can't use USB drives (no usb-storage)"; exit 1; }
has_mod vfat || { echo "[customize] ERROR: this kernel can't read FAT32 USB drives (no vfat)"; exit 1; }
if ! has_mod exfat; then
  { has_mod fuse && command -v mount.exfat-fuse >/dev/null; } || { echo "[customize] ERROR: no way to read exFAT USB drives (no exfat in the kernel, no exfat-fuse)"; exit 1; }
fi
has_mod ntfs3 || { has_mod fuse && command -v ntfs-3g >/dev/null; } || log "WARNING: NTFS USB drives can't be used (no ntfs3, no ntfs-3g)"

# USB drives: a pretend drive (a FAT32 disk image, as Windows formats a stick) goes through what the admin page does:
# get it ready, the server's user saves on it, "pulled out" (the box lets go of it), forgotten.
log "Self-test: a USB drive"
USBIMG=/tmp/tdj-usbtest.img
rm -f "$USBIMG"; truncate -s 64M "$USBIMG"; mkfs.vfat -n TDJTEST "$USBIMG" >/dev/null
LOOPU=$(losetup -f --show "$USBIMG")
UUIDU=$(blkid -o value -s UUID "$LOOPU" || true)
for _ in $(seq 1 30); do [ -e "/dev/disk/by-uuid/$UUIDU" ] && break; sleep 0.5; done
if [ -n "$UUIDU" ] && [ -e "/dev/disk/by-uuid/$UUIDU" ]; then
  helper() { /usr/local/sbin/3djames-helper "$@"; }
  r=$(echo "{\"type\": \"usb\", \"uuid\": \"$UUIDU\", \"fstype\": \"vfat\"}" | helper mount-place usbtest || true)
  echo "  get it ready: $r"
  echo "$r" | grep -q '"ok": true' && echo "$r" | grep -q 'can open and save' || { echo "[customize] ERROR: a USB drive could not be got ready"; exit 1; }
  runuser -u threedjames -- sh -c 'mkdir -p "/mnt/3djames/usbtest/users/alex" && echo test > "/mnt/3djames/usbtest/users/alex/a b.3dj" && cat "/mnt/3djames/usbtest/users/alex/a b.3dj" >/dev/null' \
    || { echo "[customize] ERROR: the server can't save on a USB drive"; exit 1; }
  r=$(echo '{"reconnect": true}' | helper mount-place usbtest || true)
  echo "$r" | grep -q '"ok": true' || { echo "[customize] ERROR: a ready USB drive is not seen as ready: $r"; exit 1; }
  rm -f "/dev/disk/by-uuid/$UUIDU"  # as if pulled out (a mounted disk image itself can't vanish)
  r=$(echo '{"reconnect": true}' | helper mount-place usbtest || true)
  echo "  pulled out: $r"
  ! mountpoint -q /mnt/3djames/usbtest || { echo "[customize] ERROR: the box did not let go of a USB drive that was pulled out"; exit 1; }
  helper forget-place usbtest >/dev/null
else
  log "WARNING: no /dev/disk/by-uuid on this build machine: the USB self-test was skipped"
fi
[ -n "$LOOPU" ] && losetup -d "$LOOPU" 2>/dev/null || true
rm -f "$USBIMG" /etc/3djames/places/usbtest.json

# NAS shares: the server talks to them itself (no kernel driver needed). Start a real test share here (Samba, one with
# a user name and password, one anyone may open) and run the server from this image against it, as its own user: add
# the share on the admin page, save, open, "someone else saved it", folders, delete. The image is not made otherwise.
log "Self-test: saving to a NAS share"
command -v smbd >/dev/null && command -v smbpasswd >/dev/null || { echo "[customize] ERROR: samba is missing (needed for the NAS self-test)"; exit 1; }
SMBT=/tmp/tdj-smbtest
rm -rf "$SMBT"; mkdir -p "$SMBT/share" "$SMBT/open" "$SMBT/state/ncalrpc"
id tdjnas >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin tdjnas
chown tdjnas "$SMBT/share"; chmod 777 "$SMBT/open"
cat > "$SMBT/smb.conf" <<EOF
[global]
  workgroup = WORKGROUP
  server role = standalone server
  map to guest = Bad User
  passdb backend = tdbsam:$SMBT/state/passdb.tdb
  private dir = $SMBT/state
  lock directory = $SMBT/state
  state directory = $SMBT/state
  cache directory = $SMBT/state
  pid directory = $SMBT/state
  ncalrpc dir = $SMBT/state/ncalrpc
  log file = $SMBT/log.%m
  smb ports = 445
  disable netbios = yes
  load printers = no
  printing = bsd
  printcap name = /dev/null
  disable spoolss = yes
[test]
  path = $SMBT/share
  read only = no
  valid users = tdjnas
[open]
  path = $SMBT/open
  read only = no
  guest ok = yes
  force user = nobody
  create mask = 0666
  force create mode = 0666
  directory mask = 0777
  force directory mode = 0777
EOF
printf 'nas-pass1\nnas-pass1\n' | smbpasswd -c "$SMBT/smb.conf" -s -a tdjnas >/dev/null
# in its own process group: smbd stops its whole group when it ends, which would otherwise be this build
setsid smbd -s "$SMBT/smb.conf" --foreground --no-process-group </dev/null >"$SMBT/smbd.out" 2>&1 &
python3 -c "
import socket, time
for _ in range(60):
    try:
        socket.create_connection(('127.0.0.1', 445), 1).close(); break
    except OSError:
        time.sleep(0.5)
else:
    raise SystemExit('the test share did not start')" || { cat "$SMBT/smbd.out" "$SMBT"/log.* 2>/dev/null | tail -40; exit 1; }
chmod 644 /tmp/selftest-nas.py
nas_ok=1
runuser -u threedjames -- python3 /tmp/selftest-nas.py 127.0.0.1 test --user tdjnas --password nas-pass1 || nas_ok=0
runuser -u threedjames -- python3 /tmp/selftest-nas.py 127.0.0.1 open "3D Objects" || nas_ok=0
for p in /proc/[0-9]*; do grep -qa "$SMBT/smb.conf" "$p/cmdline" 2>/dev/null && kill "${p#/proc/}" 2>/dev/null; done; sleep 1  # stop the test share
[ "$nas_ok" = 1 ] || { cat "$SMBT"/log.* 2>/dev/null | tail -60; echo "[customize] ERROR: saving to a NAS share does not work in this image"; exit 1; }
userdel tdjnas 2>/dev/null || true
rm -rf "$SMBT" /tmp/selftest-nas.py
log "Self-test passed"

# ---------------------------------------------------------------- tidy up
restore_apt; trap - EXIT
apt-get clean
rm -rf /var/lib/apt/lists/* /root/.cache /tmp/* 2>/dev/null || true
# A fresh machine-id is generated on first boot (needed for unique DHCP/mDNS identity).
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
log "Done"
