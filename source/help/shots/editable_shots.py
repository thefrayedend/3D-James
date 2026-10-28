# Pictures for the Help page "Make an STL editable" (editable-1..3), from the real app with the test bracket
# (tests/fixtures/stl/bracket.stl, made by tests/make_stl_fixtures.mjs).
# Run after build.py:  python help/shots/editable_shots.py
import asyncio, base64, os
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, num, save, SRC

FULL = (0, 0, 1280, 720)
STL = os.path.join(SRC, 'tests', 'fixtures', 'stl', 'bracket.stl')


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        data = base64.b64encode(open(STL, 'rb').read()).decode()
        await ev('''async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          window.__3dj.commands.openFile(new File([bytes], 'bracket.stl'), null); }''', data)
        # 1: the question when an STL is opened
        await pg.get_by_role('button', name='Make editable').wait_for(timeout=60000)
        await pg.wait_for_function('!window.__3dj.app.building', timeout=60000)
        await pg.wait_for_timeout(800)
        im = await shot(pg)
        go = await box(pg, 'dialog.modal .btn.primary')
        ring(im, go, pad=6)
        num(im, (go[0] + go[2] + 30, go[1] + go[3] / 2), 1)
        sl = await box(pg, 'dialog.modal .detail-pick')
        if sl:
            ring(im, sl, pad=6)
            num(im, (sl[0] - 30, sl[1] + sl[3] / 2), 2)
        save(im, 'editable-1.jpg', crop=FULL)
        # 2: after Make editable: the steps in History
        await pg.get_by_role('button', name='Make editable').click()
        await pg.wait_for_function('''() => { const { store, app } = window.__3dj; return !app.converting && store.doc.features.some((f) => f.kind === 'sketch')
          && !app.building && app.builtRevision === store.revision; }''', timeout=300000)
        await pg.wait_for_selector('dialog.modal .btn.primary')
        await ev("()=>document.querySelector('dialog.modal .btn.primary').click()")
        await ev("()=>{ const C = window.__3dj.commands; const id = Object.keys(window.__3dj.store.doc.bodies)[0]; C.renderAll(); window.__3dj.app.sel = [id]; window.__3dj.vp.setSelection([id]); window.__3dj.app.historyAll = false; C.openPanel('history'); }")
        await pg.wait_for_timeout(1200)
        im = await shot(pg)
        hist = await box(pg, '#side .side-body')
        if hist:
            ring(im, hist, pad=4)
            num(im, (hist[0] - 30, hist[1] + 40), 1)
        save(im, 'editable-2.jpg', crop=FULL)
        # 3: the sketch with the holes on the sketch board
        await ev("""()=>{ const { store, commands: C } = window.__3dj; const n = (x) => x.p.loops.filter((l) => l.type === 'circle').length; const f = store.doc.features.filter((x) => x.kind === 'sketch').sort((a, b) => n(b) - n(a))[0]; C.editSketch(f); }""")
        await pg.wait_for_selector('.sketch', timeout=30000)
        await pg.wait_for_timeout(2500)
        im = await shot(pg)
        save(im, 'editable-3.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('.sketch .btn')].find(b=>b.textContent==='Cancel')?.click()")
        await pg.wait_for_timeout(1500)
        # 4: pointing at an Edit sketch button shows that sketch's piece in orange
        await ev("()=>{ const C = window.__3dj.commands; const id = Object.keys(window.__3dj.store.doc.bodies)[0]; window.__3dj.app.sel = [id]; window.__3dj.vp.setSelection([id]); C.openPanel('props'); C.renderAll(); }")
        await pg.wait_for_timeout(800)
        btn = pg.locator('#side button', has_text='holes').first
        await btn.hover()
        await pg.wait_for_function("() => (window.__3dj.app.results.ghosts || []).some((g) => g.hover) && !window.__3dj.app.building", timeout=60000)
        await pg.wait_for_timeout(600)
        im = await shot(pg)
        bb = await btn.bounding_box()
        k = (bb['x'], bb['y'], bb['width'], bb['height'])
        ring(im, k, pad=4)
        arrow(im, (k[0] - 330, k[1] + 40), (k[0] - 6, k[1] + k[3] / 2), 'Point at a button:\nits piece shows in orange', side='left')
        save(im, 'editable-4.jpg', crop=FULL)
        assert not errs, errs
        await b.close()

asyncio.run(main())
