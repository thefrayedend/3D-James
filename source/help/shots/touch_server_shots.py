# Pictures for the Help pages "Tablets and Apple Pencil" (touch-*) and "3DJames box (server)" (box-*).
# Real app screenshots, marked up. Run after build.py:  python help/shots/touch_server_shots.py
import asyncio, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, num, circle, save, SRC, S

FULL = (0, 0, 1280, 720)


async def touch_pictures(p):
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=S, has_touch=True)
    pg = await ctx.new_page()
    await pg.goto('file:///' + os.path.join(SRC, 'local', '3DJames.html').replace(os.sep, '/').lstrip('/'))
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    cdp = await ctx.new_cdp_session(pg)
    async def tap(x, y):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]}); await pg.wait_for_timeout(60)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await pg.wait_for_timeout(200)
    await pg.evaluate("""async()=>{ const C=__3dj.commands, A=__3dj.app; C.newProject(); await new Promise(r=>setTimeout(r,500));
      A.settings.panelOpen=false; C.addShape('box',{w:40,d:30,h:20}); const c=C.addShape('cyl'); __3dj.store.commit((d)=>{ d.features.find(f=>f.body===c).pos=[45,0,0]; });
      for(let i=0;i<300 && (A.building||A.pending||A.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50));
      __3dj.vp.view('fit', false); C.renderAll(); }""")
    await tap(640, 120)  # a finger: touch mode on
    await pg.wait_for_timeout(600)
    im = await shot(pg)
    k = await box(pg, '.touch-key')
    ring(im, k, pad=6)
    arrow(im, (k[0] + 260, k[1] - 150), (k[0] + k[2] + 6, k[1]), '"Pick more": tap more objects\nto pick them too (like Ctrl)', side='right')
    cb = await box(pg, '#cmdbar')
    arrow(im, (cb[0] + 700, cb[1] + 170), (cb[0] + 640, cb[1] + cb[3] + 4), 'Touch mode: bigger buttons', side='right')
    save(im, 'touch-3d.jpg', crop=FULL)
    # the sketch board with the on-screen keys
    await pg.evaluate("async()=>{ window.__k = __3dj.commands.startSketch(); await new Promise(r=>setTimeout(r,300)); __k.setTool('line'); }")
    for q in [(0, 0), (40, 0), (40, 25)]:
        x, y = await pg.evaluate(f"()=>__k.screenOf([{q[0]},{q[1]}])"); await tap(x, y)
    await pg.wait_for_timeout(5200)
    im = await shot(pg)
    keys = await box(pg, '.sk-keys')
    ring(im, keys, pad=5)
    arrow(im, (keys[0] + 120, keys[1] + 200), (keys[0] + keys[2] / 2, keys[1] + keys[3] + 6), 'On-screen keys: Pick more, Straight,\nReach, Free, and 123 to type a size', side='right')
    save(im, 'touch-sketch.jpg', crop=FULL)
    await b.close()


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); n = s.getsockname()[1]; s.close(); return n


async def box_pictures(p):
    data = tempfile.mkdtemp(prefix='3dj-shots-')
    ap, adp = free_port(), free_port()
    srv = subprocess.Popen([sys.executable, os.path.join(SRC, 'server', '3djames_server.py'), '--data', data, '--app-port', str(ap), '--admin-port', str(adp),
                            '--bundled-app', os.path.join(SRC, 'local', '3DJames.html')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try: urllib.request.urlopen(f'http://127.0.0.1:{adp}/api/state', timeout=1); break
        except Exception: time.sleep(0.2)
    try:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        adm = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=S)
        apg = await adm.new_page()
        await apg.goto(f'http://127.0.0.1:{adp}/')
        await apg.wait_for_selector('text=Welcome to your 3DJames box')
        ins = apg.locator('main input')
        await ins.nth(0).fill('jon'); await ins.nth(1).fill('Jon'); await ins.nth(2).fill('secret1'); await ins.nth(3).fill('secret1')
        im = await shot(apg)
        save(im, 'box-setup.jpg', crop=FULL)
        await apg.click('text=Create the admin account')
        await apg.wait_for_selector('text=People who can use 3DJames')
        post = lambda path, body: adm.request.post(f'http://127.0.0.1:{adp}{path}', data=json.dumps(body), headers={'Content-Type': 'application/json'})
        await post('/api/user/save', {'isNew': True, 'user': 'sarah', 'name': 'Sarah', 'password': 'secret2', 'shared': True})
        await post('/api/shared/save', {'enabled': True, 'label': 'Shared', 'place': 'box', 'path': 'shared', 'write': True})
        await apg.reload(); await apg.wait_for_selector('text=People who can use 3DJames'); await apg.wait_for_timeout(300)
        # show the addresses the way they are on the box
        await apg.evaluate("()=>{ S.host='3djames'; S.appPort=80; S.adminPort=8080; users(); }")
        im = await shot(apg)
        save(im, 'box-users.jpg', crop=FULL)
        await apg.click('nav >> text=Storage'); await apg.wait_for_timeout(300)
        await apg.click('text=Add a NAS share'); await apg.wait_for_timeout(300)
        ins = apg.locator('main input')
        await ins.nth(0).fill('My NAS'); await ins.nth(1).fill('mynas.local'); await ins.nth(2).fill('3djames'); await ins.nth(3).fill('3djames-box')
        im = await shot(apg)
        save(im, 'box-nas.jpg', crop=FULL)
        await apg.click('nav >> text=App'); await apg.wait_for_timeout(300)
        im = await shot(apg)
        save(im, 'box-app.jpg', crop=FULL)
        # the app: sign-in, then the server's Open / Save window
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=S)
        pg = await ctx.new_page()
        await pg.goto(f'http://127.0.0.1:{ap}/')
        await pg.fill('#u', 'jon'); await pg.fill('#p', 'secret1')
        im = await shot(pg)
        save(im, 'box-signin.jpg', crop=FULL)
        await pg.click('button[type=submit]')
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=180000)
        await pg.evaluate("async()=>{ const C=__3dj.commands, A=__3dj.app; C.newProject(); C.addShape('box'); for(let i=0;i<300 && (A.building||A.pending||A.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50)); }")
        await pg.keyboard.press('Control+Shift+S')
        await pg.wait_for_selector('dialog.fb-dialog .fb-place'); await pg.fill('dialog.fb-dialog input[aria-label="File name"]', 'bracket')
        await pg.click('dialog.fb-dialog button:text-is("Save")'); await pg.wait_for_timeout(1500)
        await pg.keyboard.press('Control+o')
        await pg.wait_for_selector('dialog.fb-dialog .fb-row'); await pg.wait_for_timeout(400)
        im = await shot(pg)
        side = await box(pg, '.fb-side')
        ring(im, side, pad=6)
        arrow(im, (side[0] - 10, side[1] + 330), (side[0] + 30, side[1] + side[3] + 6), 'Your folders on the box\n(and the shared one)', side='right')
        dev = await pg.evaluate("()=>{ const b=[...document.querySelectorAll('dialog.fb-dialog button')].find(x=>x.textContent.startsWith('From this device')); const r=b.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
        ring(im, dev, pad=5)
        save(im, 'box-open.jpg', crop=FULL)
        await b.close()
    finally:
        srv.terminate()
        shutil.rmtree(data, ignore_errors=True)


async def main():
    async with async_playwright() as p:
        await touch_pictures(p)
        await box_pictures(p)

asyncio.run(main())
