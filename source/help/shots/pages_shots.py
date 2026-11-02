# Pictures for Help pages that had none: Combine (combine.jpg: a block with a hole cut by Subtract, its step open in
# Properties), Saving and opening (save-changes.jpg: the Save changes? question) and Install (updates.jpg: the
# Updates box in Help > Licenses and components, as the installed program shows it); and Copies (pattern.jpg: six
# pegs around a disc, the Pattern step open); Make it solid (solid.jpg: the window Done opens, for a plate with a hole).
# Run after build.py:  python help/shots/pages_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, num, save

WAIT = "async () => { const { app, store } = window.__3dj; while (app.building || app.pending || app.builtRevision !== store.revision) await new Promise((r) => setTimeout(r, 20)); }"
# the installed program's side, as tests/updates.py plays it (only the program shows the Updates box)
PROGRAM = """
window.__wvl = [];
window.chrome = Object.assign(window.chrome || {}, { webview: { postMessage: () => {}, addEventListener: (t, fn) => { if (t === 'message') window.__wvl.push(fn); } } });
window.__3DJ_HOST = { program: true, updates: true };
window.__say = (m) => window.__wvl.forEach((fn) => fn({ data: m }));
"""


async def main():
    async with async_playwright() as p:
        # 1. Combine: a 40 x 30 x 10 block, a Ø10 cylinder subtracted; the step open with its Operation box
        b, pg, errs = await open_app(p)
        await pg.evaluate("""async () => { const { commands: C, store: S, app, vp } = window.__3dj;
          C.loadProject({ name: 'Block with a hole', vars: [], seq: 900,
            bodies: { b1: { name: 'Block', color: '#00A2E8' }, b2: { name: 'Hole', color: '#8b96a3', hole: true } },
            features: [{ id: 'f1', type: 'shape', body: 'b1', kind: 'box', p: { w: 40, d: 30, h: 10, round: 0, roundMode: 'all' }, pos: [0, 0, 0], rot: [0, 0, 0] },
              { id: 'f2', type: 'shape', body: 'b2', kind: 'cyl', p: { d: 10, h: 14 }, pos: [0, 0, -2], rot: [0, 0, 0] },
              { id: 'f3', type: 'combine', op: 'subtract', name: 'Cut the hole', body: 'b1', tools: ['b2'] }] }, null); }""")
        await pg.evaluate(WAIT)
        await pg.evaluate("() => { const { commands: C, app, vp } = window.__3dj; app.sel = ['b1']; vp.setSelection(['b1']); app.tab = 'Object'; C.editStep('f3'); C.openPanel('props'); C.renderCmdBar(); C.renderAll(); vp.view('home', false); }")
        await pg.get_by_role('tab', name='Object', exact=True).click(); await pg.wait_for_timeout(500)
        im = await shot(pg)
        r = await pg.get_by_role('button', name='Subtract', exact=True).bounding_box()
        ring(im, [r['x'], r['y'], r['width'], r['height']], pad=4); num(im, (r['x'] + r['width'] / 2, r['y'] + r['height'] + 32), 1)
        op = await box(pg, '#props select')
        ring(im, op, pad=6); num(im, (op[0] - 30, op[1] + op[3] / 2), 2)
        save(im, 'combine.jpg')

        # 1b. Pattern: a peg copied round a disc, six in all, the step open
        await pg.evaluate("""async () => { window.__3dj.commands.loadProject({ name: 'Peg ring', vars: [], seq: 900,
            bodies: { b1: { name: 'Disc', color: '#FF7F27' }, b2: { name: 'Peg', color: '#00A2E8' } },
            features: [{ id: 'f1', type: 'shape', body: 'b1', kind: 'cyl', p: { d: 60, h: 4 }, pos: [0, 0, 0], rot: [0, 0, 0] },
              { id: 'f2', type: 'shape', body: 'b2', kind: 'cyl', p: { d: 8, h: 12 }, pos: [22, 0, 4], rot: [0, 0, 0] },
              { id: 'f3', type: 'array', name: 'Pegs round the disc', body: 'b2', kind: 'circular', n: 6, dx: 0, dy: 0, dz: 0, angle: 360, cx: 0, cy: 0 }] }, null); }""")
        await pg.evaluate(WAIT)
        await pg.evaluate("() => { const { commands: C, app, vp } = window.__3dj; app.sel = ['b2']; vp.setSelection(['b2']); C.editStep('f3'); C.openPanel('props'); C.renderAll(); vp.view('home', false); }")
        await pg.wait_for_timeout(500)
        im = await shot(pg)
        r = await pg.get_by_role('button', name='Pattern', exact=True).bounding_box()
        ring(im, [r['x'], r['y'], r['width'], r['height']], pad=4); num(im, (r['x'] + r['width'] / 2, r['y'] + r['height'] + 32), 1)
        r = await pg.locator('#props .card').first.bounding_box(); card = [r['x'], r['y'], r['width'], r['height']]
        ring(im, card, pad=6); num(im, (card[0] - 30, card[1] + 24), 2)
        save(im, 'pattern.jpg')

        # 1c. Make it solid: a plate outline with a hole, Done: the window that asks how it becomes solid
        await pg.evaluate("""async () => { const C = window.__3dj.commands; C.newProject(); window.__3dj.app.settings.panelOpen = false; C.renderAll();
          window.__k = C.startSketch({ start: [{ type: 'poly', pts: [[-30, -20], [30, -20], [30, 20], [-30, 20]] }, { type: 'circle', c: [0, 0], r: 8 }] });
          await new Promise((r) => setTimeout(r, 300)); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise((r) => setTimeout(r, 250));
          document.querySelector('.sketch .btn.primary').click(); }""")
        await pg.get_by_role('dialog').wait_for(); await pg.wait_for_timeout(300)
        im = await shot(pg)
        dlg = await box(pg, 'dialog.modal')
        save(im, 'solid.jpg', crop=(dlg[0] - 20, dlg[1] - 20, dlg[0] + dlg[2] + 20, dlg[1] + dlg[3] + 20), w=640)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { try { window.__k.cancel?.(); } catch {} window.__3dj.app.settings.panelOpen = true; }")
        await pg.goto(pg.url); await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)

        # 2. Saving and opening: New with unsaved changes asks first
        await pg.evaluate("""() => window.__3dj.commands.loadProject({ name: 'Block with a hole', vars: [], seq: 900,
            bodies: { b1: { name: 'Block', color: '#00A2E8' }, b2: { name: 'Hole', color: '#8b96a3', hole: true } },
            features: [{ id: 'f1', type: 'shape', body: 'b1', kind: 'box', p: { w: 40, d: 30, h: 10, round: 0, roundMode: 'all' }, pos: [0, 0, 0], rot: [0, 0, 0] },
              { id: 'f2', type: 'shape', body: 'b2', kind: 'cyl', p: { d: 10, h: 14 }, pos: [0, 0, -2], rot: [0, 0, 0] },
              { id: 'f3', type: 'combine', op: 'subtract', name: 'Cut the hole', body: 'b1', tools: ['b2'] }] }, null)""")
        await pg.evaluate(WAIT)
        await pg.evaluate("() => { window.__3dj.app.dirty = true; window.__3dj.vp.view('home', false); }")
        await pg.get_by_role('button', name='File menu').click(); await pg.get_by_role('button', name='New', exact=True).click()
        await pg.get_by_role('dialog').wait_for(); await pg.wait_for_timeout(300)
        im = await shot(pg)
        dlg = await box(pg, 'dialog.modal')
        ring(im, dlg, pad=6)
        save(im, 'save-changes.jpg', crop=(dlg[0] - 260, dlg[1] - 120, dlg[0] + dlg[2] + 260, dlg[1] + dlg[3] + 120), w=900)
        await pg.get_by_role('button', name='Cancel').click()
        print('page errors:', errs)
        await b.close()

        # 3. Install: the Updates box in the installed program, after a check found the newest version
        b, pg, errs = await open_app(p, init=PROGRAM)
        await pg.get_by_role('tab', name='Help', exact=True).click()
        await pg.get_by_role('button', name='Licenses and components').click(); await pg.wait_for_timeout(300)
        await pg.evaluate("() => window.__say({ type: '3dj-update', status: 'current', version: window.__3DJ_VERSION, current: window.__3DJ_VERSION, enabled: true })")
        await pg.wait_for_timeout(300)
        im = await shot(pg)
        up = await box(pg, '.modal .lic:has(input[type=checkbox])')
        ring(im, up, pad=6)
        dlg = await box(pg, 'dialog.modal')
        save(im, 'updates.jpg', crop=(dlg[0] - 40, dlg[1] - 20, dlg[0] + dlg[2] + 40, min(720, up[1] + up[3] + 60)), w=900)
        print('page errors:', errs)
        await b.close()

asyncio.run(main())
