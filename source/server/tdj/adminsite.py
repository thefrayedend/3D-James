"""The admin address (http://3djames.local:8080): first-time setup, users, storage places, the shared folder,
app updates, network and the box itself."""
import json
import os
import re
import socket
import time

from . import smbstore, system
from .config import USERNAME, hash_password
from .files import clean_parts
from .web import Handler, Response, cookie, js

COOKIE = 'tdjadmin'
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
PLACE_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,23}$')


def make_handler(ctx):
    cfg, sessions = ctx.config, ctx.sessions

    def admin_of(req):
        u = sessions.get(req.cookies.get(COOKIE), 'admin')
        return u if u and (cfg.user(u) or {}).get('admin') else None

    def need_admin(fn):
        def wrapped(req):
            u = admin_of(req)
            if not u:
                return js({'ok': False, 'message': 'Please sign in as an admin.', 'signedIn': False}, 401)
            return fn(req, u)
        return wrapped

    def static(name, ctype):
        def serve(req):
            return Response(200, ctype=ctype, headers={'Cache-Control': 'no-cache'}, file=os.path.join(WEB, name))
        return serve

    # ------------------------------------------------------------------ signing in
    def state(req):
        return js({'ok': True, 'setup': not cfg.has_admin(), 'signedIn': bool(admin_of(req)), 'host': socket.gethostname(), 'appPort': ctx.app_port})

    def setup(req):
        if cfg.has_admin():
            return js({'ok': False, 'message': 'This box is already set up.'}, 400)
        b = req.json()
        name = (b.get('user') or '').strip().lower()
        if not USERNAME.match(name):
            return js({'ok': False, 'message': 'Use a short name: lower-case letters and numbers (like alex).'}, 400)
        if len(b.get('password') or '') < 6:
            return js({'ok': False, 'message': 'Choose a password of at least 6 characters.'}, 400)
        with cfg.lock:
            cfg.data['users'][name] = {'name': (b.get('name') or name).strip(), 'hash': hash_password(b['password']), 'admin': True, 'shared': True,
                                       'folders': [{'label': 'My files', 'place': 'box', 'path': f'users/{name}', 'write': True}]}
            cfg.save()
        return signed_in(name)

    def signed_in(name):
        tok = sessions.create(name, 'admin')
        return js({'ok': True}, headers={'Set-Cookie': cookie(COOKIE, tok, 7 * 86400)})

    def login(req):
        wait = sessions.wait_for(req.ip)
        if wait > 0:
            return js({'ok': False, 'message': f'Too many wrong passwords. Wait {int(wait) + 1} seconds.'}, 429)
        b = req.json()
        name = (b.get('user') or '').strip().lower()
        if not cfg.check_password(name, b.get('password') or '') or not cfg.user(name).get('admin'):
            sessions.failed(req.ip)
            time.sleep(0.5)
            return js({'ok': False, 'message': 'That name or password is not right (or that account is not an admin).'}, 401)
        sessions.succeeded(req.ip)
        return signed_in(name)

    def logout(req):
        sessions.drop(req.cookies.get(COOKIE))
        return js({'ok': True}, headers={'Set-Cookie': cookie(COOKIE, '', 0)})

    # ------------------------------------------------------------------ overview
    @need_admin
    def overview(req, me):
        d = cfg.public()
        places = {}
        for pid, p in d['places'].items():
            ok, space, why = ctx.files.place_status(pid)
            places[pid] = {**p, 'connected': ok, 'space': space, 'problem': why, 'used': place_users(pid)}
        d['places'] = places
        usb = None  # USB drives plugged into the box (only on the box itself)
        if system.helper_available():
            r = system.helper('usb-list', timeout=20)
            if r.get('ok'):
                taken = {p.get('uuid'): pid for pid, p in d['places'].items() if p['type'] == 'usb'}
                usb = [{**x, 'place': taken.get(x.get('uuid'))} for x in r.get('drives', [])]
        return js({'ok': True, 'me': me, 'config': d, 'usb': usb, 'app': ctx.app.info(), 'previousApp': ctx.app.info(ctx.app.previous),
                   'server': ctx.version, 'host': socket.gethostname(), 'appPort': ctx.app_port, 'adminPort': ctx.admin_port,
                   'helper': system.helper_available(), 'dropFolder': ctx.drop_dir})

    def place_users(pid):
        users = [n for n, u in cfg.data['users'].items() if any(f.get('place') == pid for f in u.get('folders', []))]
        if cfg.data['shared'].get('place') == pid and cfg.data['shared'].get('enabled'):
            users.append('(shared folder)')
        return users

    @need_admin
    def system_info(req, me):
        return js({'ok': True, 'system': system.helper('system-info'), 'net': system.helper('net-status')})

    # ------------------------------------------------------------------ users
    def clean_folders(folders):
        out = []
        for f in folders or []:
            if f.get('place') not in cfg.data['places']:
                raise ValueError(f'Unknown storage place "{f.get("place")}".')
            path = '/'.join(clean_parts(f.get('path', '')))
            out.append({'label': (f.get('label') or 'Files').strip()[:40], 'place': f['place'], 'path': path, 'write': bool(f.get('write', True))})
        return out

    @need_admin
    def user_save(req, me):
        b = req.json()
        name = (b.get('user') or '').strip().lower()
        if not USERNAME.match(name):
            raise ValueError('Use a short name: lower-case letters and numbers, no spaces (like sam).')
        with cfg.lock:
            u = cfg.data['users'].get(name)
            if b.get('isNew'):
                if u:
                    raise ValueError(f'There is already a user called {name}.')
                if len(b.get('password') or '') < 6:
                    raise ValueError('Choose a password of at least 6 characters.')
                u = {}
            elif not u:
                raise ValueError('That user does not exist (any more).')
            if b.get('password'):
                if len(b['password']) < 6:
                    raise ValueError('Choose a password of at least 6 characters.')
                u['hash'] = hash_password(b['password'])
                sessions.drop(user=name)  # signed out everywhere
            u['name'] = (b.get('name') or name).strip()[:40]
            admin = bool(b.get('admin'))
            if not admin and u.get('admin') and sum(1 for x in cfg.data['users'].values() if x.get('admin')) == 1:
                raise ValueError('This is the only admin. Make someone else an admin first.')
            u['admin'] = admin
            u['shared'] = bool(b.get('shared'))
            u['folders'] = clean_folders(b.get('folders')) if 'folders' in b else u.get('folders') or [{'label': 'My files', 'place': 'box', 'path': f'users/{name}', 'write': True}]
            cfg.data['users'][name] = u
            cfg.save()
        for f in u['folders']:  # make the folders right away where possible
            ctx.files.make_folder(f['place'], f['path'])
        return js({'ok': True})

    @need_admin
    def user_delete(req, me):
        name = (req.json().get('user') or '').lower()
        if name == me:
            raise ValueError('You cannot delete yourself.')
        with cfg.lock:
            if name not in cfg.data['users']:
                raise ValueError('That user does not exist.')
            del cfg.data['users'][name]
            cfg.save()
        sessions.drop(user=name)
        return js({'ok': True, 'message': f'{name} was removed. Their files were kept.'})

    # ------------------------------------------------------------------ storage places
    @need_admin
    def place_save(req, me):
        b = req.json()
        typ = b.get('type')
        pid = (b.get('id') or '').strip().lower()
        old = cfg.data['places'].get(pid) if pid else None
        if typ not in ('smb', 'usb') and not (old and old['type'] == typ):
            raise ValueError('Pick a kind of storage.')
        if not pid:
            base = re.sub(r'[^a-z0-9-]', '-', (b.get('label') or typ).lower()).strip('-')[:16] or typ
            pid, k = base, 2
            while pid in cfg.data['places']:
                pid, k = f'{base}-{k}', k + 1
        if not PLACE_ID.match(pid):
            raise ValueError('Bad place id.')
        if old and old['type'] != typ:
            raise ValueError('The kind of a storage place cannot change. Add a new one instead.')
        p = dict(old or {}, label=(b.get('label') or (old or {}).get('label') or pid).strip()[:40], type=typ)
        msg = 'Saved.'
        if typ == 'smb':
            server, share = (b.get('server') or '').strip(), (b.get('share') or '').strip().strip('\\/')
            server = server.replace('\\', '/').strip('/')
            if '/' in server:  # \\nas\share (as Windows shows it) typed into the NAS box
                server, _, rest = server.partition('/')
                share = share or rest.split('/')[0]
            if not server or not share:
                raise ValueError('Type the NAS name (or address) and the share name.')
            p.update(server=server, share=share, username=(b.get('username') or '').strip(), domain=(b.get('domain') or '').strip())
            for k in ('vers', 'vers_used'):
                p.pop(k, None)
            password = b.get('password') or ''
            if not password and old and p['username'] and p['username'] == old.get('username'):
                password = cfg.secret(pid)  # left empty: keep it
            test = smbstore.SmbShare(p['server'], p['share'], p['username'], password, p['domain'])
            try:
                test.test_write([])  # can it really save there? (a small test file, deleted right away)
                msg = 'Connected. 3DJames can open and save files there.'
            except smbstore.SmbError as e:
                raise ValueError(str(e))
            finally:
                test.close()
            cfg.set_secret(pid, password)
            ctx.files.drop_share(pid)
        elif typ == 'usb' and not old:
            uuid = (b.get('uuid') or '').strip()
            drive = next((x for x in (system.helper('usb-list', timeout=20).get('drives') or []) if x.get('uuid') == uuid), None)
            if not uuid or not drive:
                raise ValueError('That USB drive is not plugged in (any more).')
            if any(x.get('uuid') == uuid for x in cfg.data['places'].values() if x['type'] == 'usb'):
                raise ValueError('That USB drive is already in use here.')
            p.update(uuid=uuid, fstype=drive.get('fstype', ''), name=drive.get('name', ''))
            r = system.helper('mount-place', pid, stdin=json.dumps({'type': 'usb', 'uuid': uuid, 'fstype': p['fstype']}), timeout=90)
            if not r.get('ok'):
                raise ValueError(r.get('message') or 'Could not use that USB drive.')
            msg = r.get('message') or 'Ready.'
        with cfg.lock:
            cfg.data['places'][pid] = p
            cfg.save()
        return js({'ok': True, 'id': pid, 'message': msg})

    @need_admin
    def place_delete(req, me):
        pid = req.json().get('id')
        if pid == 'box':
            raise ValueError('"This box" is always there.')
        if place_users(pid):
            raise ValueError('Users (or the shared folder) still keep files there: move them first.')
        p = cfg.data['places'].get(pid)
        if p and p['type'] == 'smb':
            ctx.files.drop_share(pid)
            cfg.set_secret(pid, None)
        elif p and p['type'] != 'local':
            system.helper('forget-place', pid)
        with cfg.lock:
            cfg.data['places'].pop(pid, None)
            cfg.save()
        return js({'ok': True})

    @need_admin
    def place_connect(req, me):
        pid = req.json().get('id')
        p = cfg.data['places'].get(pid)
        if not p:
            raise ValueError('That storage place no longer exists.')
        if p['type'] == 'smb':
            ctx.files.drop_share(pid)
            try:
                ctx.files.share_of(pid).check()
            except smbstore.SmbError as e:
                raise ValueError(str(e))
            return js({'ok': True, 'message': 'Connected.'})
        r = system.helper('mount-place', pid, stdin=json.dumps({'id': pid, 'reconnect': True}), timeout=90)
        return js(r, 200 if r.get('ok') else 400)

    # ------------------------------------------------------------------ the shared folder
    @need_admin
    def shared_save(req, me):
        b = req.json()
        if b.get('place') not in cfg.data['places']:
            raise ValueError('Pick where the shared folder is kept.')
        path = '/'.join(clean_parts(b.get('path') or 'shared'))
        with cfg.lock:
            cfg.data['shared'] = {'enabled': bool(b.get('enabled')), 'label': (b.get('label') or 'Shared').strip()[:40], 'place': b['place'], 'path': path, 'write': bool(b.get('write', True))}
            cfg.save()
        return js({'ok': True})

    # ------------------------------------------------------------------ the app file
    @need_admin
    def app_upload(req, me):
        tmp = req.to_temp_file(dir=ctx.app.dir)
        try:
            v = ctx.app.install(tmp)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return js({'ok': True, 'version': v, 'message': f'3DJames {v} is installed. People get it the next time they open or reload the app.'})

    @need_admin
    def app_rollback(req, me):
        v = ctx.app.roll_back()
        return js({'ok': True, 'version': v, 'message': f'Back to 3DJames {v}.'})

    @need_admin
    def update_share(req, me):
        b = req.json()
        on = bool(b.get('enabled'))
        if on and len(b.get('password') or '') < 6 and not cfg.data['settings'].get('updateShare'):
            raise ValueError('Choose a password of at least 6 characters for the update folder.')
        r = system.helper('update-share', 'on' if on else 'off', ctx.drop_dir, stdin=b.get('password') or '')
        if not r.get('ok'):
            raise ValueError(r.get('message') or 'Could not change the update folder.')
        with cfg.lock:
            cfg.data['settings']['updateShare'] = on
            cfg.save()
        return js(r)

    # ------------------------------------------------------------------ the box
    def helper_call(*args, stdin=None, timeout=120):
        @need_admin
        def call(req, me):
            b = req.json()
            extra = [b.get(k) for k in ('name', 'ssid') if b.get(k)]
            r = system.helper(*args, *extra, stdin=b.get('password') if stdin == 'password' else stdin, timeout=timeout)
            return js(r, 200 if r.get('ok') else 400)
        return call

    @need_admin
    def server_update(req, me):
        tmp = req.to_temp_file()
        r = system.helper('server-update', tmp, timeout=300)
        try:
            os.remove(tmp)
        except OSError:
            pass
        return js(r, 200 if r.get('ok') else 400)

    @need_admin
    def password(req, me):
        b = req.json()
        if not cfg.check_password(me, b.get('old') or ''):
            raise ValueError('Your current password is not right.')
        if len(b.get('new') or '') < 6:
            raise ValueError('Choose a password of at least 6 characters.')
        with cfg.lock:
            cfg.data['users'][me]['hash'] = hash_password(b['new'])
            cfg.save()
        return js({'ok': True, 'message': 'Password changed.'})

    class AdminHandler(Handler):
        routes = [
            ('GET', '/', static('admin.html', 'text/html; charset=utf-8')), ('GET', '/admin.js', static('admin.js', 'text/javascript')),
            ('GET', '/admin.css', static('admin.css', 'text/css')),
            ('GET', '/api/state', state), ('POST', '/api/setup', setup), ('POST', '/api/login', login), ('POST', '/api/logout', logout),
            ('GET', '/api/overview', overview), ('GET', '/api/system', system_info),
            ('POST', '/api/user/save', user_save), ('POST', '/api/user/delete', user_delete),
            ('POST', '/api/place/save', place_save), ('POST', '/api/place/delete', place_delete), ('POST', '/api/place/connect', place_connect),
            ('POST', '/api/shared/save', shared_save),
            ('PUT', '/api/app', app_upload), ('POST', '/api/app/rollback', app_rollback), ('POST', '/api/update-share', update_share),
            ('POST', '/api/system/reboot', helper_call('reboot')), ('POST', '/api/system/shutdown', helper_call('shutdown')),
            ('POST', '/api/system/hostname', helper_call('set-hostname')),
            ('POST', '/api/wifi/scan', helper_call('wifi-scan', timeout=60)), ('POST', '/api/wifi/connect', helper_call('wifi-connect', stdin='password', timeout=90)),
            ('PUT', '/api/server-update', server_update), ('POST', '/api/password', password),
        ]
    return AdminHandler
