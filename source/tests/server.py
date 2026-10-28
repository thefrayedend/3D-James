# The 3DJames server (appliance) with the real app: first-time setup, users, sign-in, the server's Open / Save
# window, the shared folder, "someone else saved it", "someone else has it open", My parts, app updates
# (upload and the update folder), and that nobody can reach outside their own folders.
# Starts its own server on free ports with a throw-away data folder. Run after build.py:  python tests/server.py
import asyncio, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
APP_HTML = ROOT / 'local' / '3DJames.html'


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


async def main():
    data = Path(tempfile.mkdtemp(prefix='3dj-server-test-'))
    ap, adp = free_port(), free_port()
    srv = subprocess.Popen([sys.executable, str(ROOT / 'server' / '3djames_server.py'), '--data', str(data), '--app-port', str(ap), '--admin-port', str(adp),
                            '--bundled-app', str(APP_HTML)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    APP, ADMIN = f'http://127.0.0.1:{ap}', f'http://127.0.0.1:{adp}'
    results = []
    def check(name, ok, info=''):
        results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:500]), flush=True)
    for _ in range(100):
        try: urllib.request.urlopen(ADMIN + '/api/state', timeout=1); break
        except Exception: time.sleep(0.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            errs = []
            # ---------------------------------------------------------------- first-time setup on the admin page
            adm = await b.new_context(viewport={'width': 1200, 'height': 800})
            ap_ = await adm.new_page(); ap_.on('pageerror', lambda e: errs.append(str(e)))
            r = await (await adm.new_page()).goto(APP + '/')
            check('before setup, the app address says to open the admin page', 'not set up yet' in (await r.text()))
            await ap_.goto(ADMIN + '/')
            await ap_.wait_for_selector('text=Welcome to your 3DJames box')
            ins = ap_.locator('main input')
            await ins.nth(0).fill('alex'); await ins.nth(1).fill('Alex'); await ins.nth(2).fill('secret1'); await ins.nth(3).fill('secret1')
            await ap_.click('text=Create the admin account')
            await ap_.wait_for_selector('text=People who can use 3DJames')
            check('setup makes the admin account and opens the admin page', await ap_.is_visible('nav >> text=Storage'))
            api = adm.request
            async def post(path, body):
                r = await api.post(ADMIN + path, data=json.dumps(body), headers={'Content-Type': 'application/json'}); return r.status, await r.json()
            st, j = await post('/api/user/save', {'isNew': True, 'user': 'sam', 'name': 'Sam', 'password': 'secret2', 'shared': True})
            check('admin adds a person (Sam)', st == 200, j)
            st, j = await post('/api/shared/save', {'enabled': True, 'label': 'Shared', 'place': 'box', 'path': 'shared', 'write': True})
            check('admin switches on the shared folder', st == 200, j)
            st, j = await post('/api/user/save', {'isNew': True, 'user': 'Bad Name', 'password': 'secret3'})
            check('bad sign-in names are refused with a plain message', st == 400 and 'lower-case' in j.get('message', ''), j)
            r = await (await b.new_context()).request.get(ADMIN + '/api/overview')
            check('the admin API needs an admin sign-in', r.status == 401)

            # ---------------------------------------------------------------- Alex signs in to the app
            async def signin(name, pw):
                ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
                pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
                await pg.goto(APP + '/')
                await pg.fill('#u', name); await pg.fill('#p', pw); await pg.click('button[type=submit]')
                await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=180000)
                return ctx, pg
            ctx0 = await b.new_context(); pg0 = await ctx0.new_page(); await pg0.goto(APP + '/')
            await pg0.fill('#u', 'alex'); await pg0.fill('#p', 'wrong!'); await pg0.click('button[type=submit]')
            check('a wrong password is refused', 'not right' in await pg0.content())
            jctx, alex = await signin('alex', 'secret1')
            mode = await alex.evaluate("()=>fetch('/api/me').then(r=>r.json())")
            check('after sign-in the app is served, with Alex\'s folders', [f['label'] for f in mode['folders']] == ['My files', 'Shared'], mode)
            # Save as: the server's own window, into My files
            await alex.evaluate("()=>{ __3dj.commands.newProject(); __3dj.commands.addShape('box'); }")
            await alex.wait_for_timeout(1500)
            await alex.keyboard.press('Control+Shift+S')
            await alex.wait_for_selector('dialog.fb-dialog .fb-place'); await alex.wait_for_timeout(300)
            check('Save as opens the server window with My files and Shared', await alex.locator('.fb-place').all_inner_texts() == ['My files', 'Shared'])
            await alex.fill('dialog.fb-dialog input[aria-label="File name"]', 'bracket')
            await alex.click('dialog.fb-dialog button:text-is("Save")')
            f = data / 'files' / 'users' / 'alex' / 'bracket.3dj'
            for _ in range(60):
                if f.exists(): break
                await alex.wait_for_timeout(250)
            check('the project is saved on the box in Alex\'s folder (.3dj added)', f.exists() and f.stat().st_size > 1000)
            # Open: the file is listed, and opens
            await alex.evaluate("()=>__3dj.commands.newProject()")
            await alex.keyboard.press('Control+o')
            await alex.wait_for_selector('dialog.fb-dialog .fb-row')
            await alex.dblclick('dialog.fb-dialog .fb-row:has-text("bracket.3dj")')
            await alex.wait_for_function("()=>__3dj.app.file?.name==='bracket.3dj'", timeout=20000)
            check('Open lists the saved file and opens it', await alex.evaluate("()=>__3dj.store.doc.features.length") >= 1)
            # Save (Ctrl+S) goes back to the same server file
            await alex.evaluate("()=>__3dj.commands.addShape('cyl')")
            await alex.wait_for_timeout(800)
            m0 = f.stat().st_mtime_ns
            await alex.keyboard.press('Control+s')
            for _ in range(40):
                if f.stat().st_mtime_ns != m0: break
                await alex.wait_for_timeout(250)
            check('Ctrl+S saves back into the same file on the box', f.stat().st_mtime_ns != m0)

            # ---------------------------------------------------------------- the shared folder: open by two, saved by both
            await alex.keyboard.press('Control+Shift+S')
            await alex.wait_for_selector('dialog.fb-dialog .fb-place')
            await alex.click('dialog.fb-dialog .fb-place:has-text("Shared")')
            await alex.wait_for_timeout(400)
            await alex.fill('dialog.fb-dialog input[aria-label="File name"]', 'team-part')
            await alex.click('dialog.fb-dialog button:text-is("Save")')
            sf = data / 'files' / 'shared' / 'team-part.3dj'
            for _ in range(60):
                if sf.exists(): break
                await alex.wait_for_timeout(250)
            check('Alex saves into the shared folder', sf.exists())
            sctx, sam = await signin('sam', 'secret2')
            names = await sam.evaluate("()=>fetch('/api/me').then(r=>r.json()).then(j=>j.folders.map(f=>f.label))")
            check('Sam sees her own folder and the shared one', names == ['My files', 'Shared'], names)
            await sam.keyboard.press('Control+o')
            await sam.wait_for_selector('dialog.fb-dialog .fb-place')
            await sam.click('dialog.fb-dialog .fb-place:has-text("Shared")')
            await sam.dblclick('dialog.fb-dialog .fb-row:has-text("team-part.3dj")')
            await sam.wait_for_function("()=>__3dj.app.file?.name==='team-part.3dj'", timeout=20000)
            await sam.wait_for_timeout(500)
            toasts = await sam.locator('.toast').all_inner_texts()
            check('Sam is told that Alex has the file open too', any('Alex also has team-part.3dj open' in t for t in toasts), toasts)
            await sam.evaluate("()=>__3dj.commands.addShape('sphere')"); await sam.wait_for_timeout(800)
            await sam.keyboard.press('Control+s')
            await sam.wait_for_function("()=>!__3dj.app.dirty", timeout=20000)
            # now Alex saves their older copy: asked first
            await alex.evaluate("()=>__3dj.commands.addShape('cone')"); await alex.wait_for_timeout(800)
            await alex.keyboard.press('Control+s')
            try: await alex.wait_for_selector('text=Someone else saved this file', timeout=20000)
            except Exception: print('ALEX TOASTS', await alex.locator('.toast').all_inner_texts()); raise
            txt = await alex.inner_text('dialog')
            check('saving over a newer save asks first, and says who saved it', 'Sam' in txt, txt)
            await alex.click('text=Replace their version')
            await alex.wait_for_function("()=>!__3dj.app.dirty", timeout=20000)
            check('"Replace their version" saves', True)

            # ---------------------------------------------------------------- My parts live in the user's folder
            await alex.evaluate("async()=>{ const id=[...__3dj.app.results.bodies.keys()][0]; await __3dj.commands.saveToMyParts(id); }")
            parts = list((data / 'files' / 'users' / 'alex' / '3DJames Parts').glob('*.3dj')) if (data / 'files' / 'users' / 'alex' / '3DJames Parts').exists() else []
            check('Save to My parts writes a .3dj into "3DJames Parts" in Alex\'s folder', len(parts) == 1, parts)
            n = await alex.evaluate("async()=>(await __3dj.commands.loadMyParts()).length")
            check('My parts lists it', n == 1, n)

            # ---------------------------------------------------------------- nobody gets outside their folders
            async def get(pg, url):
                return await pg.evaluate("async(u)=>{ const r = await fetch(u); return [r.status, (await r.text()).slice(0, 200)]; }", url)
            s1 = await get(sam, '/api/list?folder=f0&path=..')
            s2 = await get(sam, '/api/file?folder=f0&path=../alex/bracket.3dj')
            s3 = await get(sam, '/api/list?folder=f9&path=')
            check('"..", other people\'s folders and unknown folders are refused', s1[0] == 400 and s2[0] == 400 and s3[0] == 404, [s1, s2, s3])
            anon = await (await b.new_context()).request.get(APP + '/api/list?folder=f0&path=')
            check('the file API needs a sign-in', anon.status == 401)

            # ---------------------------------------------------------------- app updates: upload, roll back, update folder
            body = APP_HTML.read_bytes().replace(b'window.__3DJ_VERSION="', b'window.__3DJ_VERSION="9.9.9-', 1)
            r = await api.put(ADMIN + '/api/app', data=body)
            j = await r.json()
            check('uploading a new app file installs it', r.status == 200 and j.get('version', '').startswith('9.9.9-'), j)
            r = await api.put(ADMIN + '/api/app', data=b'<html>not the app</html>')
            check('a file that is not the app is refused', r.status == 400)
            st, j = await post('/api/app/rollback', {})
            check('roll back goes to the version before', st == 200 and not j['version'].startswith('9.9.9'), j)
            drop = data / 'update-drop'; drop.mkdir(exist_ok=True)
            (drop / '3DJames.html').write_bytes(body)
            note = drop / 'LAST-UPDATE.txt'
            for _ in range(80):
                if note.exists(): break
                time.sleep(0.25)
            check('a new app file copied into the update folder is installed by itself', note.exists() and '9.9.9' in note.read_text(), note.read_text() if note.exists() else 'no note')
            r = await jctx.request.get(APP + '/', headers={'Accept-Encoding': 'gzip'})
            check('the app is sent compressed', r.headers.get('content-encoding') == 'gzip')

            # ---------------------------------------------------------------- sign out
            await alex.evaluate("()=>{ __3dj.app.dirty = false; }")
            await alex.goto(APP + '/logout')
            check('Sign out goes back to the sign-in page', '/login' in alex.url)
            check('no errors in the pages', not errs, errs)
            await b.close()
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=5)[0]
        except Exception: out = ''
        if any(not ok for _, ok in results): print('--- server output ---\n' + out[-3000:])
        shutil.rmtree(data, ignore_errors=True)
    n = sum(ok for _, ok in results)
    print(f'{n}/{len(results)} passed')
    raise SystemExit(0 if n == len(results) else 1)

asyncio.run(main())
