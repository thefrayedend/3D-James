# Picture for the Help pages "History", "Edges, faces, split and emboss" and the nameplate tutorial (tools-emboss):
# a plate with raised MAKER lettering, its Emboss step open: its settings first, the Step box under them.
# Run after build.py:  python help/shots/emboss_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, save

FULL = (0, 0, 1280, 720)
IDLE = "() => !window.__3dj.app.building && !window.__3dj.app.pending && window.__3dj.app.builtRevision === window.__3dj.store.revision"


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        await ev("()=>{ const C = window.__3dj.commands; C.newProject(); C.addShape('box', { w: 80, d: 30, h: 4 }, 'Nameplate'); }")
        await pg.wait_for_function(IDLE, timeout=60000)
        # the emboss step, on the top face (the same step Object > Emboss makes)
        await ev("""()=>{ const { app, store, commands: C } = window.__3dj; const id = Object.keys(store.doc.bodies)[0]; const d = app.results.bodies.get(id);
          let best = -1, bz = -1e9; for (let i = 0; i < d.faces.length / 6; i++) { if (d.faces[i * 6 + 5] > 0.99 && d.faces[i * 6 + 2] > bz) { bz = d.faces[i * 6 + 2]; best = i; } }
          app.sel = [id]; window.__3dj.vp.setSelection([id]); C.startTool('emboss'); C.toolPick('face', { body: id, index: best, point: [0, 0, bz] });
          Object.assign(app.tool, { text: 'MAKER', size: 8, depth: 1 }); C.applyTool(); }""")
        await pg.wait_for_function(IDLE, timeout=60000)
        await ev("()=>{ const { store, commands: C } = window.__3dj; const f = store.doc.features.find((x) => x.type === 'emboss'); C.editStep(f.id); C.openPanel('history'); }")
        await pg.wait_for_timeout(1200)
        im = await shot(pg)
        save(im, 'tools-emboss.jpg', crop=FULL)
        assert not errs, errs
        await b.close()

asyncio.run(main())
