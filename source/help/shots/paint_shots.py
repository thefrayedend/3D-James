# Pictures for Help: Paint parts (paint-parts, paint-bucket). Real app screenshots, marked up.
# Run after build.py:  python help/shots/paint_shots.py
import asyncio, math
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, num, save

WAIT = "async () => { const { app, store } = window.__3dj; while (app.building || app.pending || app.builtRevision !== store.revision) await new Promise((r) => setTimeout(r, 20)); }"
SCR = "(p) => { const v = window.__3dj.vp, s = v.toScreen(v.camera.position.clone().set(...p)); return [s.x, s.y]; }"


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        async def start(kind, prm, color):
            bx = await ev("([k, p, c]) => { const C = window.__3dj.commands; C.newProject(); const id = C.addShape(k, p); window.__3dj.store.doc.bodies[id].color = c; return id; }", [kind, prm, color])
            await ev(WAIT)
            await ev("() => { const { app, vp, commands: C } = window.__3dj; app.sel = []; vp.setSelection([]); app.tab = 'Paint'; C.renderAll(); C.renderCmdBar(); vp.view('home', false); }")
            await pg.get_by_role('button', name='Paint parts').click()
            await pg.wait_for_timeout(300)
            return bx
        async def tool(name, **prefs):
            await pg.get_by_role('button', name=name, exact=True).click()
            await ev("(p) => Object.assign(window.__3dj.commands.paintPrefs, p)", prefs)
        async def click(pt):
            await pg.mouse.click(*(await ev(SCR, pt))); await pg.wait_for_timeout(200)

        # 1. a box: Fill on the top, a Band round the bottom, a Brush wave on the front
        bx = await start('box', {'w': 50, 'd': 36, 'h': 30}, '#3F48CC')
        await tool('Fill', color='#ffc90e', coverage=30); await click([0, 0, 30])
        await tool('Band', color='#ed1c24', size=6); await click([25, 0, 5])
        await tool('Brush', color='#ffffff', size=3)
        pts = [await ev(SCR, [-20 + i, -18, 17 + 4 * math.sin(i / 4)]) for i in range(0, 41)]
        await pg.mouse.move(*pts[0]); await pg.mouse.down()
        for q in pts[1:]: await pg.mouse.move(*q)
        await pg.mouse.up(); await pg.mouse.move(80, 650)
        await pg.evaluate("() => document.querySelectorAll('.toast').forEach((t) => t.remove())")
        im = await shot(pg)
        save(im, 'paint-parts.jpg')

        # 2. Bucket: a red band splits a cup's side in two; the bucket fills above it, then below it
        await pg.get_by_role('button', name='Cancel').click()
        bx = await start('cyl', {'d': 40, 'h': 34}, '#c3c3c3')
        bb = await ev('(id) => window.__3dj.app.results.bodies.get(id).bbox', bx)
        cx, fy, z0 = (bb[0][0] + bb[1][0]) / 2, bb[0][1] + 0.5, bb[0][2]
        await tool('Band', color='#ed1c24', size=4); await click([cx, fy, z0 + 17])
        await tool('Bucket', color='#00a2e8', coverage=30); await click([cx, fy, z0 + 27])
        await ev("() => Object.assign(window.__3dj.commands.paintPrefs, { color: '#22b14c' })"); await click([cx, fy, z0 + 7])
        await pg.mouse.move(80, 650)
        await pg.evaluate("() => document.querySelectorAll('.toast').forEach((t) => t.remove())")
        im = await shot(pg)
        r = await pg.get_by_role('button', name='Bucket', exact=True).bounding_box(); bt = [r['x'], r['y'], r['width'], r['height']]
        ring(im, bt, pad=4); num(im, (bt[0] - 30, bt[1] + bt[3] + 26), 1)
        sl = await box(pg, '#cmdbar input[type=range]')
        ring(im, sl, pad=6); num(im, (sl[0] + sl[2] / 2, sl[1] + sl[3] + 34), 2)
        save(im, 'paint-bucket.jpg')
        await pg.get_by_role('button', name='Cancel').click()
        print('page errors:', errs)
        await b.close()

asyncio.run(main())
