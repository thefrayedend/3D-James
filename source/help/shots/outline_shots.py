# Picture for the Help page "Sketching" (sketch-outline): a sketch on the floor with a box on the floor and a
# cylinder lifted off it, both shown in grey seen from above.
# Run after build.py:  python help/shots/outline_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, arrow, save

FULL = (0, 0, 1280, 720)
IDLE = "() => !window.__3dj.app.building && window.__3dj.app.builtRevision === window.__3dj.store.revision"


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        await ev("()=>{ const C = window.__3dj.commands; C.newProject(); C.addShape('box', {}, 'Box'); C.addShape('cyl', {}, 'Cylinder'); }")
        await pg.wait_for_function(IDLE, timeout=60000)
        # the cylinder 35 mm to the side and 15 mm up: it doesn't touch the floor, but still shows from above
        await ev("""()=>{ const { store } = window.__3dj; store.commit((d) => { const id = Object.keys(d.bodies)[1];
          const f = d.features.find((x) => x.type === 'shape' && x.body === id); f.pos = [35, 10, 15]; }); }""")
        await pg.wait_for_function(IDLE, timeout=60000)
        await ev("()=>{ window.__k = window.__3dj.commands.startSketch(); }")
        await pg.wait_for_selector('.sk-outline', timeout=30000)
        await pg.wait_for_timeout(800)
        im = await shot(pg)
        box = await ev("()=>window.__k.screenOf([-10, 10])")
        can = await ev("()=>window.__k.screenOf([35 - 7, 10 + 7])")
        arrow(im, (box[0] + 150, box[1] - 120), (box[0] + 8, box[1] + 8), 'The box: grey, and dashed\nwhere it stands on the floor', side='left')
        arrow(im, (can[0] + 40, can[1] - 170), (can[0] + 4, can[1] + 4), 'The cylinder, 15 mm up:\ngrey seen from above', side='left')
        save(im, 'sketch-outline.jpg', crop=FULL)
        await ev("()=>window.__k.close()")
        assert not errs, errs
        await b.close()

asyncio.run(main())
