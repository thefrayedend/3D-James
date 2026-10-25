"""The app address (http://3djames.local): sign in, then the 3DJames app, and the file API it uses."""
import html as htmlmod
import os
import socket
import time

from .files import FileError
from .web import Handler, Response, cookie, html, js, redirect

COOKIE = 'tdj'


def page(title, body):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{htmlmod.escape(title)}</title><style>
:root{{color-scheme:light dark;--bg:#eef2f7;--card:#fff;--ink:#1d2430;--muted:#5f6b7a;--accent:#2f6fdf;--line:#d5dce6}}
@media (prefers-color-scheme:dark){{:root{{--bg:#16191f;--card:#20242c;--ink:#e8ecf2;--muted:#9aa4b2;--line:#363c47}}}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.45 "Segoe UI",system-ui,sans-serif}}
.card{{width:min(380px,92vw);background:var(--card);border-radius:14px;padding:28px;box-shadow:0 8px 30px #0002}}
h1{{margin:0 0 4px;font-size:22px}} .muted{{color:var(--muted);font-size:13px}} label{{display:block;margin:14px 0 4px;font-weight:600;font-size:13px}}
input{{box-sizing:border-box;width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}}
button{{margin-top:18px;width:100%;padding:12px;font-size:16px;font-weight:600;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}}
.err{{margin-top:12px;padding:8px 10px;border-radius:8px;background:#fde2e2;color:#8a1c1c;font-size:13px}}</style></head>
<body><div class="card">{body}</div></body></html>'''


def make_handler(ctx):
    cfg, sessions, files, presence, appfiles = ctx.config, ctx.sessions, ctx.files, ctx.presence, ctx.app

    def who(req):
        u = sessions.get(req.cookies.get(COOKIE), 'app')
        return u if u and cfg.user(u) else None

    def need_user(fn):
        def wrapped(req):
            u = who(req)
            if not u:
                return js({'ok': False, 'message': 'Please sign in again.'}, 401)
            return fn(req, u)
        return wrapped

    def file_errors(fn):
        def wrapped(req, *a):
            try:
                return fn(req, *a)
            except FileError as e:
                return js({'ok': False, 'message': e.message, **e.extra}, e.status)
        return wrapped

    def login_page(req, message=''):
        if not cfg.data['users']:
            # the address this page was opened with (works in the setup hotspot too), with the admin port
            host = (req.headers.get('Host') or f'{socket.gethostname()}.local').split(':')[0]
            link = f'http://{htmlmod.escape(host)}:{ctx.admin_port}'
            return html(page('3DJames', f'<h1>3DJames</h1><p>This 3DJames box is not set up yet.</p><p class="muted">Open the admin page to create the first account:<br><a href="{link}"><b>{link}</b></a></p>'))
        err = f'<div class="err">{htmlmod.escape(message)}</div>' if message else ''
        return html(page('Sign in - 3DJames', f'''<h1>3DJames</h1><div class="muted">Sign in to open your designs.</div>
<form method="post" action="/login"><label for="u">Name</label><input id="u" name="user" autocomplete="username" autocapitalize="none" autofocus required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>{err}
<button type="submit">Sign in</button></form>'''))

    def index(req):
        u = who(req)
        if not u:
            return redirect('/login')
        if not os.path.exists(appfiles.current):
            return html(page('3DJames', '<h1>3DJames</h1><p>The 3DJames app has not been installed on this box yet.</p><p class="muted">The admin can upload it on the admin page (App).</p>'))
        st = os.stat(appfiles.current)
        tag = f'"app-{st.st_mtime_ns:x}-{st.st_size:x}"'
        headers = {'Cache-Control': 'no-cache', 'ETag': tag, 'Vary': 'Accept-Encoding'}
        if req.headers.get('If-None-Match') == tag:
            return Response(304, b'', headers=headers)
        gz = appfiles.current + '.gz'
        if 'gzip' in (req.headers.get('Accept-Encoding') or '') and os.path.exists(gz):
            return Response(200, ctype='text/html; charset=utf-8', headers={**headers, 'Content-Encoding': 'gzip'}, file=gz)
        return Response(200, ctype='text/html; charset=utf-8', headers=headers, file=appfiles.current)

    def login_post(req):
        wait = sessions.wait_for(req.ip)
        if wait > 0:
            return login_page(req, f'Too many wrong passwords. Wait {int(wait) + 1} seconds and try again.')
        f = req.form()
        name = (f.get('user') or '').strip().lower()
        if not cfg.check_password(name, f.get('password') or ''):
            sessions.failed(req.ip)
            time.sleep(0.5)
            return login_page(req, 'That name or password is not right.')
        sessions.succeeded(req.ip)
        tok = sessions.create(name, 'app')
        return redirect('/', {'Set-Cookie': cookie(COOKIE, tok, 30 * 86400)})

    def logout(req):
        sessions.drop(req.cookies.get(COOKIE))
        return redirect('/login', {'Set-Cookie': cookie(COOKIE, '', 0)})

    @need_user
    def me(req, u):
        usr = cfg.user(u)
        return js({'ok': True, 'user': u, 'name': usr.get('name') or u, 'admin': bool(usr.get('admin')),
                   'folders': [{'id': f['id'], 'label': f['label'], 'write': bool(f.get('write'))} for f in cfg.folders_of(u)],
                   'server': ctx.version})

    @need_user
    @file_errors
    def listing(req, u):
        return js({'ok': True, 'entries': files.list(u, req.query.get('folder'), req.query.get('path', ''))})

    @need_user
    @file_errors
    def get_file(req, u):
        p, temp, it = files.open(u, req.query.get('folder'), req.query.get('path', ''))
        return Response(200, ctype='application/octet-stream', file=p, remove_file=temp,
                        headers={'ETag': it.etag, 'X-Modified': str(it.mtime_ms), 'Cache-Control': 'no-store'})

    @need_user
    @file_errors
    def put_file(req, u):
        tmp = req.to_temp_file()
        try:
            name = cfg.user(u).get('name') or u
            tag = files.write(u, req.query.get('folder'), req.query.get('path', ''), tmp, req.headers.get('If-Match') or 'new', name)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return js({'ok': True, 'etag': tag})

    @need_user
    @file_errors
    def mkdir(req, u):
        b = req.json()
        files.mkdir(u, b.get('folder'), b.get('path', ''))
        return js({'ok': True})

    @need_user
    @file_errors
    def delete(req, u):
        b = req.json()
        files.delete(u, b.get('folder'), b.get('path', ''))
        return js({'ok': True})

    @need_user
    def where(req, u):
        b = req.json()
        key = files.key(u, b.get('folder'), b.get('path')) if b.get('path') else None
        names = [cfg.user(x).get('name') or x for x in presence.set(u, key) if cfg.user(x)]
        return js({'ok': True, 'others': names})

    class AppHandler(Handler):
        routes = [
            ('GET', '/', index), ('HEAD', '/', index), ('GET', '/3DJames.html', index),
            ('GET', '/login', login_page), ('POST', '/login', login_post), ('GET', '/logout', logout),
            ('GET', '/api/me', me), ('GET', '/api/list', listing), ('GET', '/api/file', get_file), ('PUT', '/api/file', put_file),
            ('POST', '/api/mkdir', mkdir), ('POST', '/api/delete', delete), ('POST', '/api/presence', where),
        ]
    return AppHandler
