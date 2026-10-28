# The 3DJames server with a real NAS share (SMB): the admin adds the share on the admin page's API, gives a person a
# folder on it, and that person lists, saves, opens, gets "someone else saved it", makes a folder and deletes, all
# through the app's file API. Only plain Python (no browser): the image build runs it against a test share.
#
#   python appliance/selftest-nas.py <server> <share> [<folder inside the share>] [--user U --password P]
#
# The image build (customize.sh) runs it inside the board's files with a test share, as the server's own user: the image
# is only published when saving to a NAS works there.
#
# Everything it makes is inside a new folder "3DJames-test-<random>" in that folder, removed again at the end.
import argparse, http.cookiejar, json, os, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request, uuid
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / 'server' / '3djames_server.py'  # source/server, or the repo's server/
if not SERVER.exists():  # inside the board's files (image build): /opt/3djames/server
    SERVER = Path(os.environ.get('TDJ_SERVER', '/opt/3djames/server/3djames_server.py'))


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


class Client:
    def __init__(self, base):
        self.base = base
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None, headers=None, raw=False):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        h = dict(headers or {})
        if body is not None and not isinstance(body, bytes):
            h['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            r = self.op.open(req, timeout=120)
        except urllib.error.HTTPError as e:
            r = e
        b = r.read()
        return r.status, (b if raw else json.loads(b or b'{}')), r.headers


def main():
    a = argparse.ArgumentParser()
    a.add_argument('server'); a.add_argument('share'); a.add_argument('folder', nargs='?', default='')
    a.add_argument('--user', default=''); a.add_argument('--password', default='')
    a = a.parse_args()
    data = Path(tempfile.mkdtemp(prefix='3dj-nas-test-'))
    ap, adp = free_port(), free_port()
    app_file = data / 'app.html'
    app_file.write_text('<!doctype html><title>3DJames</title><script>window.__3DJ_VERSION="0.0.0";window.__3DJ_EMBED=1</script>', encoding='utf-8')
    srv = subprocess.Popen([sys.executable, str(SERVER), '--data', str(data), '--app-port', str(ap), '--admin-port', str(adp), '--bundled-app', str(app_file)],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    results = []

    def check(name, ok, info=''):
        results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:400]), flush=True)
        return ok

    admin, app = Client(f'http://127.0.0.1:{adp}'), Client(f'http://127.0.0.1:{ap}')
    test = f'3DJames-test-{uuid.uuid4().hex[:8]}'
    path = '/'.join(x for x in (a.folder.strip('/'), test) if x)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(admin.base + '/api/state', timeout=1); break
            except Exception:
                time.sleep(0.2)
        st, j, _ = admin.call('POST', '/api/setup', {'user': 'alex', 'name': 'Alex', 'password': 'secret1'})
        check('setup', st == 200, j)
        st, j, _ = admin.call('POST', '/api/place/save', {'type': 'smb', 'label': 'NAS', 'server': 'nobody-here.invalid', 'share': a.share})
        check('a NAS that is not there is refused with a plain message', st == 400 and 'NAS' in j.get('message', ''), j)
        st, j, _ = admin.call('POST', '/api/place/save', {'type': 'smb', 'label': 'NAS', 'server': a.server, 'share': 'no-such-share-3dj'})
        check('a share that is not there is refused, naming the shares there are', st == 400 and 'no share called' in j.get('message', ''), j)
        st, j, _ = admin.call('POST', '/api/place/save', {'type': 'smb', 'label': 'NAS', 'server': a.server, 'share': a.share, 'username': a.user, 'password': a.password})
        if not check('the admin adds the NAS share (it connects and saves a test file)', st == 200 and j.get('id'), j):
            return
        pid = j['id']
        st, j, _ = admin.call('GET', '/api/overview')
        p = j['config']['places'][pid]
        check('the Storage list shows it connected, without the password', p['connected'] and 'password' not in json.dumps(j), p)
        st, j, _ = admin.call('POST', '/api/user/save', {'isNew': False, 'user': 'alex', 'name': 'Alex', 'admin': True, 'shared': False,
                                                        'folders': [{'label': '3D Objects (NAS)', 'place': pid, 'path': path, 'write': True}]})
        check('the admin gives Alex a folder on the NAS', st == 200, j)

        # ---------------------------------------------------------------- Alex, in the app
        st, _, _ = app.call('POST', '/login', b'user=alex&password=secret1', {'Content-Type': 'application/x-www-form-urlencoded'}, raw=True)
        st, me, _ = app.call('GET', '/api/me')
        check('Alex signs in and has the NAS folder', st == 200 and [f['label'] for f in me['folders']] == ['3D Objects (NAS)'], me)
        st, j, _ = app.call('GET', '/api/list?folder=f0&path=')
        check('the NAS folder lists (empty, made for him)', st == 200 and j['entries'] == [], j)
        body = os.urandom(300000) + b'3dj'
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=bracket.3dj', body, {'If-Match': 'new'})
        check('Save: a new file on the NAS', st == 200 and j.get('etag'), j)
        tag = j.get('etag')
        st, got, h = app.call('GET', '/api/file?folder=f0&path=bracket.3dj', raw=True)
        check('Open: the same bytes come back, with the same version tag', st == 200 and got == body and h.get('ETag') == tag, (st, len(got), h.get('ETag'), tag))
        st, j, _ = app.call('GET', '/api/list?folder=f0&path=')
        check('the folder lists the file with its size', [(e['name'], e['size']) for e in j.get('entries', [])] == [('bracket.3dj', len(body))], j)
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=bracket.3dj', body, {'If-Match': 'new'})
        check('Save as onto a name that exists is refused (conflict)', st == 409, j)
        body2 = body[::-1]
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=bracket.3dj', body2, {'If-Match': tag})
        check('Save again (the version he opened): saved', st == 200 and j.get('etag'), j)
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=bracket.3dj', body, {'If-Match': tag})
        check('Save from an older version: "someone else saved it", naming who', st == 409 and j.get('error') == 'conflict' and j.get('by') == 'Alex', j)
        st, got, _ = app.call('GET', '/api/file?folder=f0&path=bracket.3dj', raw=True)
        check('the newer version is still there', got == body2)
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=bracket.3dj', body, {'If-Match': 'any'})
        check('"Replace their version" saves', st == 200)
        st, j, _ = app.call('POST', '/api/mkdir', {'folder': 'f0', 'path': 'Parts/Brackets'})
        check('make a folder (two deep)', st == 200, j)
        st, j, _ = app.call('PUT', '/api/file?folder=f0&path=Parts/Brackets/a%20b.3dj', b'x' * 10, {'If-Match': 'new'})
        st, j, _ = app.call('GET', '/api/list?folder=f0&path=Parts/Brackets')
        check('save into it (name with a space) and list it', [e['name'] for e in j.get('entries', [])] == ['a b.3dj'], j)
        st, j, _ = app.call('POST', '/api/presence', {'folder': 'f0', 'path': 'bracket.3dj'})
        check('"someone else has it open" works on the NAS', st == 200, j)
        for bad in ('../x.3dj', 'Parts/../../x.3dj', '.hidden', 'a:b.3dj', 'C:\\x.3dj'):
            st, j, _ = app.call('PUT', '/api/file?folder=f0&path=' + urllib.request.quote(bad), b'x', {'If-Match': 'new'})
            check(f'refused outside his folder / bad name: {bad}', st == 400, (st, j))
        for name in ('Parts/Brackets/a b.3dj', 'bracket.3dj'):
            st, j, _ = app.call('POST', '/api/delete', {'folder': 'f0', 'path': name})
            check(f'delete {name}', st == 200, j)
        st, j, _ = app.call('GET', '/api/list?folder=f0&path=')
        check('only the empty Parts folder is left', [e['name'] for e in j.get('entries', [])] == ['Parts'], j)
    finally:
        # tidy up the NAS: the test folder and everything left in it
        try:
            sys.path.insert(0, str(SERVER.parent))
            from tdj import smbstore
            s = smbstore.SmbShare(a.server, a.share, a.user, a.password)
            def rm(parts):
                for e in s.listdir(parts):
                    if e.is_dir:
                        rm(parts + [e.name])
                    else:
                        s.remove(parts + [e.name])
                s._do(lambda c: c.deleteDirectory(s.share, s._p(parts)))
            rm([x for x in path.split('/') if x])
            left = [e.name for e in s.listdir([x for x in a.folder.split('/') if x])]
            check('the test folder was removed from the NAS again', test not in left, left)
            s.close()
        except Exception as e:  # noqa: BLE001
            check('the test folder was removed from the NAS again', False, e)
        srv.terminate()
        try:
            out = srv.communicate(timeout=10)[0]
            if 'Traceback' in out:
                print(out[-3000:])
        except Exception:  # noqa: BLE001
            pass
    print(f'{sum(results)}/{len(results)} passed', flush=True)
    sys.exit(0 if results and all(results) else 1)


if __name__ == '__main__':
    main()
