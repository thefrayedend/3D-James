# Sketching on an imported mesh, with the real mouse: open STLs as meshes, Sketch > On a surface... on the flat top of
# the block (the board shows its outline and its pocket dashed), draw a rectangle, cut it in, check the mesh got the cut;
# then on the round side of the knob, which gives a plane touching the mesh (the Sketch plane window).
#   python tests/mesh_sketch.py
import asyncio, base64, sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / 'tests' / 'fixtures' / 'stl'
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
BUILT = '() => { const {app, store} = window.__3dj; return !app.building && !app.pending && app.builtRevision === store.revision; }'
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {info}'))
  if not ok: fails.append(name)

async def open_mesh(pg, name):
  ev = pg.evaluate
  await ev("()=>{ __3dj.commands.newProject(); }"); await pg.wait_for_timeout(500)
  data = base64.b64encode((FIX / name).read_bytes()).decode()
  await ev('''([n, b64]) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); __3dj.commands.openFile(new File([bytes], n), null); }''', [name, data])
  await pg.get_by_role('button', name='Keep as a mesh').click(timeout=60000)
  await pg.wait_for_function(BUILT, timeout=120000); await pg.wait_for_timeout(500)
  await pg.get_by_role('tab', name='Insert', exact=True).click()
  await pg.get_by_role('button', name='Sketch').click(); await pg.get_by_text('On a surface…').click()
  return await ev("()=>[...__3dj.app.results.bodies.values()][0]")

async def hover_until(pg, pts, test):
  """Move the mouse over world points until the highlighted area passes test (JS, given the hover); its screen spot."""
  for w in pts:
    s = await pg.evaluate(f"()=>{{ const q=__3dj.vp.toScreen(new (__3dj.vp.camera.position.constructor)({w[0]},{w[1]},{w[2]})); return [q.x,q.y]; }}")
    await pg.mouse.move(s[0], s[1]); await pg.wait_for_timeout(250)
    if await pg.evaluate(f"()=>{{ const h=__3dj.vp.pick?.hover; return !!h?.area && ({test})(h); }}"): return s
  return None

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto((ROOT / 'local' / '3DJames.html').as_uri()); await pg.wait_for_function(READY, timeout=120000)
    ev = pg.evaluate

    # ---- the flat top of a block
    body = await open_mesh(pg, 'block.stl')
    check('the block came in as a mesh', body['solid'] is False)
    bb, top = body['bbox'], body['bbox'][1][2]
    pts = [[bb[0][0] + (bb[1][0] - bb[0][0]) * fx, bb[0][1] + (bb[1][1] - bb[0][1]) * fy, top] for fx, fy in [(0.5, 0.5), (0.3, 0.5), (0.7, 0.5), (0.5, 0.3), (0.5, 0.7), (0.2, 0.2), (0.8, 0.8)]]
    s = await hover_until(pg, pts, f"(h)=>h.area.n[2] > 0.99 && Math.abs(h.area.P[2] - {top}) < 0.01")
    check('the flat top of the mesh lights up under the pointer', s is not None)
    await pg.mouse.click(s[0], s[1]); await pg.wait_for_timeout(1500)
    wp = await ev("()=>__3dj.app.workplane && {P:__3dj.app.workplane.P, n:__3dj.app.workplane.n, curved:__3dj.app.workplane.curved}")
    check('the board is on the top (pointing up, flat)', wp and abs(wp['P'][2] - top) < 0.01 and wp['n'][2] > 0.999 and not wp['curved'], wp)
    check('the top outline and its pocket are dashed on the board', await ev("()=>document.querySelectorAll('.sketch .sk-ref').length") == 2)
    vol0 = await ev("()=>[...__3dj.app.results.bodies.values()][0].volume")
    await pg.keyboard.press('r'); await pg.wait_for_timeout(200)
    await pg.mouse.click(300, 650); await pg.wait_for_timeout(150); await pg.mouse.click(420, 715); await pg.wait_for_timeout(300)
    await pg.locator('.sketch button.primary', has_text='Done').click(force=True); await pg.wait_for_timeout(500)
    await pg.get_by_text('Cut into the face').click()
    await pg.locator('dialog.modal input').first.fill('5')
    await pg.locator('dialog.modal .btn.primary').click()
    await pg.wait_for_timeout(500); await pg.wait_for_function(BUILT, timeout=120000)
    r = await ev("()=>{ const {app, store}=__3dj; const sk=store.doc.features.find(f=>f.kind==='sketch'); return {plane: sk?.p.sketchPlane, bodies: [...app.results.bodies.values()].map(b=>b.volume), errors: Object.keys(app.results.errors).length, wp: !!app.workplane}; }")
    check('the sketch remembers the plane on the top', r['plane'] and abs(r['plane']['P'][2] - top) < 0.01, r)
    check('the cut went into the mesh (one object, smaller, no problems)', len(r['bodies']) == 1 and r['bodies'][0] < vol0 - 20 and r['errors'] == 0, (vol0, r))
    check('back on the floor afterwards', not r['wp'])

    # ---- the round side of a knob
    body = await open_mesh(pg, 'knob.stl')
    bb = body['bbox']
    pts = [[(bb[0][0] + bb[1][0]) / 2, bb[0][1] + 0.001, bb[0][2] + (bb[1][2] - bb[0][2]) * fz] for fz in [0.2, 0.35, 0.5, 0.65, 0.8]]
    s = await hover_until(pg, pts, "(h)=>h.area.curved")
    check('the round side counts as curved', s is not None)
    await pg.mouse.click(s[0], s[1]); await pg.wait_for_timeout(800)
    text = await ev("()=>document.querySelector('dialog.modal')?.innerText || ''")
    check('a curved mesh gives the plane window (tangent, offset, flip)', 'Tangent to the curved surface' in text and 'Offset' in text, text[:200])
    await pg.get_by_role('button', name='Sketch here').click(); await pg.wait_for_timeout(800)
    wp = await ev("()=>__3dj.app.workplane && {P:__3dj.app.workplane.P, n:__3dj.app.workplane.n}")
    check('the plane touches the knob where it was clicked, facing out', await ev("()=>!!document.querySelector('.sketch')") and wp and wp['n'][1] < -0.95 and abs(wp['P'][1] - bb[0][1]) < 1, wp)
    await pg.get_by_role('button', name='Cancel').first.click(); await pg.wait_for_timeout(300)

    check('no errors in the page', not errs, errs)
    await b.close()
  print(f'{len(fails)} failed' if fails else 'all passed')
  sys.exit(1 if fails else 0)

asyncio.run(main())
