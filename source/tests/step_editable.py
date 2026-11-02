# Make editable on STEP parts (src/stepconvert.js, then the mesh converter): a part of flat faces and straight round
# walls comes back as sketches from its own exact edges (true circles, exact sizes, holes through several levels as one
# hole sketch); a part with rounded top edges still becomes steps or stays the exact STEP solid, never a mesh.
# Run after build.py:  python tests/step_editable.py
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {str(info)[:400]}'), flush=True)
  if not ok: fails.append(name)
WAIT = 'async () => { const { app } = window.__3dj; await new Promise((r) => setTimeout(r, 80)); while (app.building || app.pending || app.converting) await new Promise((r) => setTimeout(r, 30)); }'
BOX = lambda i, w, d, h, pos: {'id': 'f' + i, 'type': 'shape', 'body': i, 'kind': 'box', 'p': {'w': w, 'd': d, 'h': h, 'round': 0, 'roundMode': 'all'}, 'pos': pos, 'rot': [0, 0, 0]}
CYL = lambda i, d, h, pos: {'id': 'f' + i, 'type': 'shape', 'body': i, 'kind': 'cyl', 'p': {'d': d, 'h': h}, 'pos': pos, 'rot': [0, 0, 0]}

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1300, 'height': 820})).new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto((ROOT / 'local/3DJames.html').as_uri())
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    ev = pg.evaluate

    async def as_step(features, bodies):
      """Build a project and save it as STEP: the bytes."""
      await ev("([f, b]) => window.__3dj.commands.loadProject({ name: 't', vars: [], bodies: b, features: f, seq: 900 }, null)", [features, bodies])
      await ev(WAIT)
      return await ev("async () => [...new Uint8Array(await window.__3dj.commands.buildFileData('step'))]")
    async def make_editable(data, name):
      await ev('() => window.__3dj.commands.newProject()'); await ev(WAIT)
      await ev("async ([n, d]) => { await window.__3dj.commands.insertFile(new File([new Uint8Array(d)], n), { stepParts: 'separate' }); }", [name, data])
      await ev(WAIT)
      id = await ev("() => window.__3dj.store.doc.features.find((f) => f.kind === 'import').body")
      v0 = await ev('(id) => window.__3dj.app.results.bodies.get(id).volume', id)
      ok = await ev('async (id) => await window.__3dj.commands.makeEditable(id, { quiet: true })', id)
      await ev(WAIT)
      return id, v0, ok, await ev('() => window.__3dj.store.doc.features.map((f) => ({ type: f.type, kind: f.kind, name: f.name, loops: f.p?.loops, fmt: f.p?.fmt, body: f.body }))')

    # 1. a stepped block: a 60 x 40 x 8 base, a 30 x 40 x 12 block on it, two Ø6 holes through both, one Ø4 in the base only
    B = {k: {'name': k, 'color': '#22B14C'} for k in ['a', 'b', 'h1', 'h2', 'h3']}
    for k in ['h1', 'h2', 'h3']: B[k]['hole'] = True
    feats = [BOX('a', 60, 40, 8, [0, 0, 0]), BOX('b', 30, 40, 12, [-15, 0, 8]), {'id': 'fu', 'type': 'combine', 'op': 'union', 'body': 'a', 'tools': ['b']},
             CYL('h1', 6, 30, [-15, -10, -5]), CYL('h2', 6, 30, [-15, 10, -5]), CYL('h3', 4, 30, [20, 0, -5]),
             {'id': 'fs', 'type': 'combine', 'op': 'subtract', 'body': 'a', 'tools': ['h1', 'h2', 'h3']}]
    data = await as_step(feats, B)
    id, v0, ok, steps = await make_editable(data, 'stepped.step')
    v1 = await ev('(id) => window.__3dj.app.results.bodies.get(id).volume', id)
    names = [s['name'] for s in steps]
    check('a stepped STEP block is made editable', ok and not await ev('() => Object.keys(window.__3dj.app.results.errors).length'), names)
    check('it is the same volume as the STEP part', abs(v1 - v0) < v0 * 1e-6, (v0, v1))
    check('its steps: an outline, a level on it, joined, and the holes cut', any('outline pushed up 8 mm' in n for n in names) and any('level 2 at 8 mm, pushed up 12 mm' in n for n in names) and any('join the levels' in n for n in names) and any('cut the holes' in n for n in names), names)
    holes = [s for s in steps if s['kind'] == 'sketch' and s['name'] and 'holes' in s['name'] and 'cut' not in s['name']]
    check('the two holes through both levels are one sketch of true Ø6 circles', len(holes) == 1 and all(l['type'] == 'circle' and abs(l['r'] - 3) < 1e-6 for l in holes[0]['loops']) and len(holes[0]['loops']) == 2, holes)
    base = next(s for s in steps if s['kind'] == 'sketch' and 'outline pushed up 8 mm' in (s['name'] or ''))
    check('the hole in the base only stays in the base sketch (a true Ø4 circle)', any(l['type'] == 'circle' and abs(l['r'] - 2) < 1e-6 for l in base['loops']) and not any(l['type'] == 'circle' and abs(l['r'] - 3) < 1e-6 for l in base['loops']), base['loops'])
    check('no mesh is left', not any(s['kind'] == 'import' for s in steps))
    # make the two through holes bigger: Ø6 -> Ø8 takes the right amount away (2 holes, 20 mm deep)
    await ev("(n) => window.__3dj.store.commit((d) => { const f = d.features.find((x) => x.name === n); f.p.loops.forEach((l) => { l.r = 4; }); })", holes[0]['name'])
    await ev(WAIT)
    v2 = await ev('(id) => window.__3dj.app.results.bodies.get(id).volume', id)
    want = 2 * 3.141592653589793 * (4 ** 2 - 3 ** 2) * 20
    check('changing the hole sketch to Ø8 takes away the right amount', abs((v1 - v2) - want) < want * 0.01, (v1 - v2, want))

    # 2. a plate with its top edges rounded: not just outlines pushed up, but still steps or the exact solid, never a mesh
    feats = [BOX('a', 40, 30, 10, [0, 0, 0]), {'id': 'ff', 'type': 'fillet', 'body': 'a', 'edges': [{'nc': [0.5, 0, 1], 'd': [1, 0, 0]}, {'nc': [0.5, 1, 1], 'd': [1, 0, 0]}], 'r': 3}]
    data = await as_step(feats, {'a': {'name': 'a', 'color': '#22B14C'}})
    id, v0, ok, steps = await make_editable(data, 'rounded.step')
    kinds = [(s['kind'], s.get('fmt')) for s in steps]
    check('a STEP part with rounded top edges is never swapped for a mesh', not any(k == ('import', 'stl') for k in kinds), kinds)
    check('it becomes steps or stays the exact STEP solid', ok or kinds == [('import', 'step')], (ok, kinds))

    check('no page errors', not errors, errors)
    await b.close()
  print('all passed' if not fails else f'{len(fails)} failed')
  sys.exit(1 if fails else 0)

asyncio.run(main())
