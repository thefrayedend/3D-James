#!/usr/bin/env python3
"""3DJames server: the 3DJames app for everyone on your network, with sign-in and shared storage.

  http://<box>.local          the app (sign in first; your folders show up in Open and Save)
  http://<box>.local:8080     the admin page (users, storage places, app updates, network)

Run on the box by systemd (3djames.service). To try it on any computer (Python 3.8+, nothing to install):
  python 3djames_server.py --data ./testdata --app-port 8090 --admin-port 8091 --bundled-app ../local/3DJames.html
"""
import argparse
import os
import shutil
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tdj import adminsite, appsite, system  # noqa: E402
from tdj.config import Config  # noqa: E402
from tdj.files import Files  # noqa: E402
from tdj.sessions import Presence, Sessions  # noqa: E402
from tdj.web import serve  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


class Context:
    pass


def first_admin(cfg, data_dir):
    """The first admin can come from the SD card's 3djames-config.txt (admin_name / admin_password)."""
    p = os.path.join(data_dir, 'initial-admin.json')
    if not os.path.exists(p):
        return
    try:
        import json
        from tdj.config import USERNAME, hash_password
        d = json.load(open(p, encoding='utf-8'))
        name = (d.get('user') or '').strip().lower()
        if not cfg.has_admin() and USERNAME.match(name) and len(d.get('password') or '') >= 6:
            cfg.data['users'][name] = {'name': name, 'hash': hash_password(d['password']), 'admin': True, 'shared': True,
                                       'folders': [{'label': 'My files', 'place': 'box', 'path': f'users/{name}', 'write': True}]}
            cfg.save()
            print(f'made the admin account "{name}" from 3djames-config.txt', flush=True)
    except (OSError, ValueError) as e:
        print(f'initial-admin.json: {e}', flush=True)
    finally:
        try:
            os.remove(p)
        except OSError:
            pass


def watch_drop_folder(ctx):
    """New app files copied into the update folder (the network share) are installed by themselves."""
    os.makedirs(ctx.drop_dir, exist_ok=True)
    note = os.path.join(ctx.drop_dir, 'LAST-UPDATE.txt')
    seen = {}
    while True:
        try:
            for name in os.listdir(ctx.drop_dir):
                p = os.path.join(ctx.drop_dir, name)
                if not name.lower().endswith('.html') or not os.path.isfile(p):
                    continue
                st = os.stat(p)
                sig = (st.st_size, st.st_mtime)
                if seen.get(name) != sig:  # still being copied: wait until it stops changing
                    seen[name] = sig
                    continue
                try:
                    v = ctx.app.install(p)
                    msg = f'{time.strftime("%Y-%m-%d %H:%M")}  Installed {name}: 3DJames {v}.\r\nPeople get it the next time they open or reload the app.\r\n'
                except Exception as e:  # noqa: BLE001
                    msg = f'{time.strftime("%Y-%m-%d %H:%M")}  {name} was NOT installed: {e}\r\n'
                try:
                    os.remove(p)
                except OSError:
                    pass
                seen.pop(name, None)
                with open(note, 'w', encoding='utf-8', newline='') as f:
                    f.write(msg)
                print(msg.strip(), flush=True)
        except OSError:
            pass
        time.sleep(5)


def mounted_from(path):
    """The device mounted at path (from /proc/mounts), or None."""
    found = None
    try:
        with open('/proc/mounts', encoding='utf-8') as f:
            for line in f:
                dev, at = line.split()[:2]
                if at.replace('\\040', ' ') == path:
                    found = os.path.realpath(dev)  # the last one counts
    except OSError:
        pass
    return found


def keep_drives_connected(ctx):
    """USB drives are ready by themselves when the box starts and a few seconds after they are plugged in again.
    (The root helper also lets go of a drive that was pulled out.) NAS shares need nothing: the server connects to
    them itself whenever it needs them."""
    time.sleep(3)
    said = {}
    while True:
        for pid, p in list(ctx.config.data['places'].items()):
            if p['type'] in ('usb', 'nfs'):
                root = ctx.config.place_root(pid)
                mounted = os.path.ismount(root)
                if p['type'] == 'usb':
                    dev = f'/dev/disk/by-uuid/{p.get("uuid")}'
                    present = os.path.exists(dev)
                    if (not present and not mounted) or (present and mounted_from(root) == os.path.realpath(dev)):
                        continue  # not plugged in, or plugged in and ready: nothing to do
                if p['type'] == 'nfs' and mounted:
                    continue
                r = system.helper('mount-place', pid, stdin='{"id": "%s", "reconnect": true}' % pid, timeout=90)
                msg = r.get('message', '')
                if said.get(pid) != msg:
                    print(f'storage place {pid}: {msg}', flush=True)
                    said[pid] = msg
        time.sleep(8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', default='/var/lib/3djames', help='settings, sessions and the app file')
    ap.add_argument('--box', default=None, help='where "This box" keeps files (default: <data>/files)')
    ap.add_argument('--app-port', type=int, default=80)
    ap.add_argument('--admin-port', type=int, default=8080)
    ap.add_argument('--bundled-app', default=os.path.join(HERE, 'app', '3DJames.html'), help='app file installed when none is there yet')
    ap.add_argument('--drop', default=None, help='update folder: app files copied here are installed (default: <data>/update-drop)')
    a = ap.parse_args()

    os.makedirs(a.data, exist_ok=True)
    # uploads and files on their way from a NAS wait here, on the SD card (/tmp may be a small memory disk)
    tempfile.tempdir = os.path.join(a.data, 'tmp')
    shutil.rmtree(tempfile.tempdir, ignore_errors=True)
    os.makedirs(tempfile.tempdir, exist_ok=True)
    ctx = Context()
    ctx.version = open(os.path.join(HERE, 'VERSION'), encoding='utf-8').read().strip() if os.path.exists(os.path.join(HERE, 'VERSION')) else 'dev'
    ctx.app_port, ctx.admin_port = a.app_port, a.admin_port
    box = a.box or os.path.join(a.data, 'files')
    os.makedirs(box, exist_ok=True)
    ctx.config = Config(a.data, box)
    first_admin(ctx.config, a.data)
    ctx.sessions = Sessions(a.data)
    ctx.presence = Presence()
    ctx.files = Files(ctx.config, a.data)
    ctx.app = system.AppFiles(a.data, a.bundled_app)
    ctx.drop_dir = a.drop or os.path.join(a.data, 'update-drop')

    app_srv = serve(appsite.make_handler(ctx), a.app_port)
    admin_srv = serve(adminsite.make_handler(ctx), a.admin_port)
    threading.Thread(target=admin_srv.serve_forever, daemon=True).start()
    threading.Thread(target=watch_drop_folder, args=(ctx,), daemon=True).start()
    if system.helper_available():
        threading.Thread(target=keep_drives_connected, args=(ctx,), daemon=True).start()
    info = ctx.app.info()
    print(f'3DJames server {ctx.version}: app on port {a.app_port}, admin on port {a.admin_port}; '
          f'app {info["version"] if info else "not installed"}; data in {a.data}', flush=True)
    try:
        app_srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
