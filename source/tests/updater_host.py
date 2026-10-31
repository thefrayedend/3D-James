# The installed program's update check (Installation\build\App.cs): builds the real 3DJames.exe in a scratch folder with a tiny
# stand-in 3DJames.html, points it at a small web server on this computer and checks, through the browser's debug port:
#   - a newer version is downloaded, checked (size, SHA-256, version) and shown from the next start
#   - a damaged download, an old version, no connection and "updates off" change nothing
#   - the older installed copy is left alone, and a newer installed copy wins over an older download
# python tests/updater_host.py          (needs Windows, the .NET Framework compiler and the WebView2 SDK that the installer script downloads)
import hashlib, http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INST = ROOT.parent / 'Installation'
CSC = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
WV = INST / 'build/tools/webview2'
if not CSC.exists() or not (WV / 'lib').exists():
    print('SKIP: needs csc.exe and the WebView2 SDK (run Make 3DJames Installer.cmd once)'); sys.exit(0)

work = Path(tempfile.mkdtemp(prefix='tdj_upd_'))
app = work / 'app'; app.mkdir()
lib = next(d for d in sorted((WV / 'lib').iterdir()) if d.name.startswith('net4') and (d / 'Microsoft.Web.WebView2.WinForms.dll').exists())
src = work / 'App.cs'
# the program is built from the installer script's own copy of the source, so this tests what ships
ps = (INST / 'Build-3DJames.ps1').read_text(encoding='utf-8')
a = ps.index("$AppSource = @'\n") + len("$AppSource = @'\n"); b = ps.index("\n'@\nSet-Content -Path $AppCs")
src.write_text(ps[a:b] + '\n', encoding='utf-8')
r = subprocess.run([str(CSC), '/nologo', '/target:winexe', '/platform:x64', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
                    f'/r:{lib / "Microsoft.Web.WebView2.Core.dll"}', f'/r:{lib / "Microsoft.Web.WebView2.WinForms.dll"}', f'/out:{app / "3DJames.exe"}', str(src)],
                   capture_output=True, text=True)
assert r.returncode == 0, r.stdout + r.stderr
for f in [lib / 'Microsoft.Web.WebView2.Core.dll', lib / 'Microsoft.Web.WebView2.WinForms.dll', WV / 'runtimes/win-x64/native/WebView2Loader.dll']:
    shutil.copy(f, app)

def page(version, pad=0):
    return ('<!DOCTYPE html><html><head><meta charset="utf-8"><title>fake</title></head><body>fake 3DJames<script>window.__3DJ_VERSION="%s";</script>'
            '<!--%s--></body></html>' % (version, 'x' * pad)).encode()

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

# the stand-in GitHub
served = work / 'web'; served.mkdir()
hits = []
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(served), **k)
    def log_message(self, *a): hits.append(self.path.split('?')[0])
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
web_port = free_port()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', web_port), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

def publish(version, data=None, claimed_sha=None):
    data = data or page(version, 5000)
    (served / '3DJames.html').write_bytes(data)
    (served / 'update.json').write_text(json.dumps({'version': version, 'sha256': claimed_sha or hashlib.sha256(data).hexdigest(), 'size': len(data)}))

RUNS = []   # only the programs started here are ever stopped (never a 3DJames window that is open for real work)
class Run:
    """one start of the program, with its own data folder; returns what the page says about itself"""
    def __init__(self, data, url=None, wait=400, extra=None):
        self.port = free_port()
        env = dict(os.environ, TDJ_DATA=str(data), TDJ_UPDATE_WAIT=str(wait),
                   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={self.port}')
        if url: env['TDJ_UPDATE_URL'] = url
        env.update(extra or {})
        self.p = subprocess.Popen([str(app / '3DJames.exe')], env=env); RUNS.append(self.p)
    def tabs(self):
        for _ in range(100):
            try: return json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.port}/json', timeout=2))
            except Exception: time.sleep(0.3)
        raise AssertionError('the program did not start')
    def js(self, expr):
        import asyncio, websockets
        tab = next(t for t in self.tabs() if t.get('type') == 'page')
        async def go():
            async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=None) as ws:
                await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get('id') == 1: return m['result']['result'].get('value')
        return asyncio.run(go())
    def wait_js(self, expr, secs=30):
        end = time.time() + secs; last = None
        while time.time() < end:
            try:
                last = self.js(expr)
                if last: return last
            except Exception as e: last = str(e)
            time.sleep(0.4)
        raise AssertionError(f'timed out waiting for {expr}: {last}')
    def stop(self):
        self.p.kill(); self.p.wait(); time.sleep(0.8)

# the page listens for the program's status, as the real one does
LISTEN = "window.__st=[];if(window.chrome&&chrome.webview){chrome.webview.addEventListener('message',e=>window.__st.push(e.data));chrome.webview.postMessage('__3dj_status');}1"
def statuses(run, want, secs=30):
    run.wait_js('window.__3DJ_VERSION')  # the page itself has loaded (not the blank one before it)
    run.wait_js(LISTEN)  # (re-)listen; later runs ask again
    try: return run.wait_js("(window.__st.filter(s=>s.status==%s)[0])||null" % json.dumps(want), secs)
    except AssertionError:
        print('  statuses seen:', run.js('JSON.stringify(window.__st)')); raise

failed = []
def check(name, cond, extra=''):
    print(('ok   ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra and not cond else ''))
    if not cond: failed.append(name)

try:
    url = f'http://127.0.0.1:{web_port}/update.json'
    (app / '3DJames.html').write_bytes(page('0.1.0', 3000))   # "installed"
    data = work / 'data'

    # 1. newer on the server: downloaded, shown from the NEXT start; this start still shows the installed one
    publish('0.2.0')
    r = Run(data, url)
    check('first start shows the installed version', r.wait_js('window.__3DJ_VERSION') == '0.1.0')
    st = statuses(r, 'downloaded')
    check('a newer version is downloaded', st and st['version'] == '0.2.0' and st['current'] == '0.1.0', st)
    check('this start still shows the installed one', r.js('window.__3DJ_VERSION') == '0.1.0')
    host = r.js('JSON.stringify(window.__3DJ_HOST)'); check('the page is told it is in the program', json.loads(host) == {'program': True, 'updates': True}, host)
    r.stop()
    got = data / '3DJames/update/0.2.0/3DJames.html'
    check('the new copy is in the data folder', got.exists() and got.read_bytes() == page('0.2.0', 5000))
    check('the installed copy is untouched', (app / '3DJames.html').read_bytes() == page('0.1.0', 3000))
    r = Run(data, url)
    check('next start shows the new version', r.wait_js('window.__3DJ_VERSION') == '0.2.0')
    st = statuses(r, 'current'); check('then it says it is up to date', st and st['version'] == '0.2.0', st)
    r.stop()

    # 2. nothing newer: no second download
    n = hits.count('/3DJames.html'); r = Run(data, url); statuses(r, 'current'); r.stop()
    check('an up-to-date start downloads no page', hits.count('/3DJames.html') == n)

    # 3. a damaged download is thrown away
    data2 = work / 'data2'
    publish('0.3.0', claimed_sha='0' * 64)
    r = Run(data2, url); r.wait_js('window.__3DJ_VERSION'); st = statuses(r, 'failed')
    check('a wrong checksum is refused', st is not None, st); r.stop()
    check('nothing is kept from it', not any((data2 / '3DJames/update').glob('*/3DJames.html')) and not list((data2 / '3DJames/update').glob('*.part')))
    publish('0.3.0', data=page('0.9.9', 5000))   # the file says another version than the list
    (served / 'update.json').write_text(json.dumps({'version': '0.3.0', 'sha256': hashlib.sha256(page('0.9.9', 5000)).hexdigest(), 'size': len(page('0.9.9', 5000))}))
    r = Run(data2, url); r.wait_js('window.__3DJ_VERSION'); st = statuses(r, 'failed')
    check('a file that is not the version it claims is refused', st is not None, st); r.stop()

    # 4. an older version on the server changes nothing
    publish('0.0.5'); r = Run(data, url); st = statuses(r, 'current')
    check('an older version online is ignored', st and st['version'] == '0.2.0', st); r.stop()

    # 5. no connection
    r = Run(data, f'http://127.0.0.1:{free_port()}/update.json'); st = statuses(r, 'offline')
    check('no connection is handled quietly', st is not None, st); check('and the page still shows', r.js('window.__3DJ_VERSION') == '0.2.0'); r.stop()

    # 6. updates off: nothing is asked automatically, "check now" still works
    publish('0.4.0'); data3 = work / 'data3'; n = len(hits)
    r = Run(data3, url, wait=600000); r.wait_js('window.__3DJ_VERSION'); r.wait_js(LISTEN)
    r.js("chrome.webview.postMessage('__3dj_updates_off');1"); time.sleep(1.2)
    check('turning updates off is remembered', (data3 / '3DJames/update/updates-off').exists())
    r.stop()
    n = len(hits); r = Run(data3, url, wait=300)
    check('with updates off the page is told so', json.loads(r.wait_js('JSON.stringify(window.__3DJ_HOST)')) == {'program': True, 'updates': False})
    time.sleep(3)
    check('with updates off nothing is asked', len(hits) == n, hits[n:])
    r.wait_js(LISTEN); r.js("chrome.webview.postMessage('__3dj_check');1")
    st = statuses(r, 'downloaded'); check('"check now" works even then', st and st['version'] == '0.4.0', st)
    r.js("chrome.webview.postMessage('__3dj_updates_on');1"); time.sleep(1.0); r.stop()
    check('turning updates on is remembered', not (data3 / '3DJames/update/updates-off').exists())

    # 7. a newer installed copy beats an older download (a reinstall)
    (app / '3DJames.html').write_bytes(page('0.5.0', 3000))
    r = Run(data3, url); check('a newer installed version wins', r.wait_js('window.__3DJ_VERSION') == '0.5.0'); statuses(r, 'current'); r.stop()
    check('the older download is cleaned away', not any((data3 / '3DJames/update').glob('0.*')))
finally:
    srv.shutdown()
    for p in RUNS:
        if p.poll() is None: p.kill()
    time.sleep(1); shutil.rmtree(work, ignore_errors=True)

print('FAILED: ' + ', '.join(failed) if failed else 'ALL OK'); sys.exit(1 if failed else 0)
