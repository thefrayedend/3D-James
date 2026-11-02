# The Helpers (Object > Helpers, src/jobs.js): each one built on real shapes, checking the result has the right
# objects and about the right size and volume.   Run after build.py:  python tests/helpers.py
import asyncio, json, math
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent

JS = r"""
window.__helpers = async () => {
  const { app, store: S } = window.__3dj;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const built = async () => {
    const end = Date.now() + 120000;
    while (app.building || app.pending || app.builtRevision !== S.revision) { if (Date.now() > end) throw new Error('build timed out'); await sleep(20); }
  };
  const box = (id, w, d, h, pos = [0, 0, 0]) => ({ id: 'f' + id, type: 'shape', body: id, kind: 'box', p: { w, d, h, round: 0, roundMode: 'all' }, pos, rot: [0, 0, 0] });
  const cyl = (id, d, h, pos = [0, 0, 0]) => ({ id: 'f' + id, type: 'shape', body: id, kind: 'cyl', p: { d, h }, pos, rot: [0, 0, 0] });
  const TOP = { nc: [0.5, 0.5, 1], d: [0, 0, 1] }, RIGHT = { nc: [1, 0.5, 0.5], d: [1, 0, 0] };
  const scene = async (features, bodies) => {
    window.__3dj.commands.loadProject({ name: 't', vars: [], bodies, features, seq: 900 }, null);
    await built();
    const out = { errors: { ...app.results.errors }, b: {} };
    for (const [id, d] of app.results.bodies) out.b[id] = { v: d.volume, bb: d.bbox, solid: !!d.solid };
    return out;
  };
  const B = (...ids) => Object.fromEntries(ids.map((id) => [id, { name: id, color: '#888888' }]));
  const shell = (body) => ({ id: 'fsh' + body, type: 'shell', body, faces: [TOP], t: 2 });
  const R = {};
  R.plainBox = await scene([box('b1', 40, 30, 20), shell('b1')], B('b1'));
  for (const style of ['friction', 'snap', 'slide'])
    R['lid_' + style] = await scene([box('b1', 40, 30, 20), shell('b1'), { id: 'fl', type: 'lid', src: 'b1', body: 'b2', style, t: 2, lip: 4, wall: 1.2, gap: 0.15, slot: 1, dx: 50, dy: 0 }], B('b1', 'b2'));
  R.lid_closed = await scene([box('b1', 40, 30, 20), { id: 'fl', type: 'lid', src: 'b1', body: 'b2', style: 'friction', t: 2, lip: 4, wall: 1.2, gap: 0.15, dx: 50, dy: 0 }], B('b1', 'b2'));
  R.fit = await scene([box('b1', 30, 30, 10), cyl('b2', 10, 20, [0, 0, -5]), { id: 'ff', type: 'fit', body: 'b1', tools: ['b2'], gap: 0.2, keepPart: true }], B('b1', 'b2'));
  R.fit_box = await scene([box('b1', 30, 30, 10), box('b2', 10, 10, 20, [0, 0, -5]), { id: 'ff', type: 'fit', body: 'b1', tools: ['b2'], gap: 0.3, keepPart: true }], B('b1', 'b2'));
  const split = (joint) => ({ id: 'fs', type: 'split', body: 'b1', body2: 'b2', body3: 'b3', off: 0, roll: 0, pitch: 90, yaw: 0, keep: 'both', joint, jd: 5, jl: 8, jn: 2, jgap: 0.15 });
  R.split_none = await scene([box('b1', 100, 20, 10), split('none')], B('b1', 'b2', 'b3'));
  for (const j of ['pegs', 'pins', 'dovetail']) R['split_' + j] = await scene([box('b1', 100, 20, 10), split(j)], B('b1', 'b2', 'b3'));
  R.split_flat = await scene([box('b1', 60, 40, 30), { ...split('pegs'), pitch: 0, jn: 3 }], B('b1', 'b2', 'b3'));
  const plates = [box('b1', 40, 30, 4, [-22, 0, 0]), box('b2', 40, 30, 4, [22, 0, 0])];
  R.hinge_pin = await scene([...plates, { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0, pin: 0, clear: 0.3, kgap: 0.4, margin: 1 }], B('b1', 'b2'));
  // the two halves must not touch anywhere (else they print stuck together): their overlap, made bigger by 0.1 mm, is empty
  const apart = (steps) => [...steps, { id: 'fc1', type: 'copy', src: 'b1', body: 'c1', d: [0, 0, 0] }, { id: 'fc2', type: 'copy', src: 'b2', body: 'c2', d: [0, 0, 0] },
    { id: 'fx', type: 'fit', body: 'c1', tools: ['c2'], gap: 0.1, keepPart: true }, { id: 'fy', type: 'copy', src: 'b1', body: 'c3', d: [0, 0, 0] }, { id: 'fz', type: 'combine', op: 'subtract', body: 'c3', tools: ['c1'] }];
  R.hinge_touch = await scene(apart([...plates, { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0, pin: 0, clear: 0.3, kgap: 0.4, margin: 1 }]), B('b1', 'b2', 'c1', 'c2', 'c3'));
  // split halves meet at the cut, so for them: they do not overlap anywhere (pegs in their holes, the rail in its slot)
  const overlap = (steps) => [...steps, { id: 'fc1', type: 'copy', src: 'b1', body: 'c1', d: [0, 0, 0] }, { id: 'fc2', type: 'copy', src: 'b2', body: 'c2', d: [0, 0, 0] }, { id: 'fz', type: 'combine', op: 'intersect', body: 'c1', tools: ['c2'] }];
  R.pegs_touch = await scene(overlap([box('b1', 100, 20, 10), split('pegs')]), B('b1', 'b2', 'b3', 'c1', 'c2'));
  R.dove_touch = await scene(overlap([box('b1', 100, 20, 10), split('dovetail')]), B('b1', 'b2', 'b3', 'c1', 'c2'));
  // the hinge turns: the second plate swung over about the pin (90 and 180 degrees) never runs into the first one
  const swing = (deg) => { const a = (-deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, -4 * s, 0, 4 - 4 * c, 1]; };
  for (const deg of [90, 180]) R['hinge_fold' + deg] = await scene([...plates, { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0, pin: 0, clear: 0.3, kgap: 0.4, margin: 1 },
    { id: 'fc1', type: 'copy', src: 'b1', body: 'c1', d: [0, 0, 0] }, { id: 'fc2', type: 'copy', src: 'b2', body: 'c2', d: [0, 0, 0] }, { id: 'fm', type: 'move', body: 'c2', m: swing(deg) },
    { id: 'fz', type: 'combine', op: 'intersect', body: 'c1', tools: ['c2'] }], B('b1', 'b2', 'c1', 'c2'));
  // pegs on a cut through a thin part are made shorter so they do not come out the far side
  R.split_thin = await scene([box('b1', 120, 30, 16), { ...split('pegs'), pitch: 0 }], B('b1', 'b2', 'b3'));
  // a snap hook with the part it clicks into: the window is cut in that part
  R.snap_into = await scene([box('b1', 40, 40, 10), box('b2', 40, 40, 3, [0, 0, 14]), { id: 'fn', type: 'snap', body: 'b1', body2: 'b2', face: TOP, mode: 'hook', w: 6, len: 10, t: 1.6, barb: 1, gap: 0.2, u: 0, v: 0, angle: 0, depth: 0 }], B('b1', 'b2'));
  R.snap_miss = await scene([box('b1', 40, 40, 10), box('b2', 40, 40, 3, [60, 0, 0]), { id: 'fn', type: 'snap', body: 'b1', body2: 'b2', face: TOP, mode: 'hook', w: 6, len: 10, t: 1.6, barb: 1, gap: 0.2, u: 0, v: 0, angle: 0, depth: 0 }], B('b1', 'b2'));
  R.hinge_living = await scene([...plates, { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'living', t: 0.6, margin: 1 }], B('b1', 'b2'));
  R.hinge_front = await scene([box('b1', 40, 30, 4, [-22, 0, 0]), box('b2', 40, 30, 4, [-10, 50, 0]), { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0 }], B('b1', 'b2'));
  R.hinge_apart = await scene([box('b1', 40, 30, 4, [-22, 0, 0]), box('b2', 40, 30, 4, [30, 50, 0]), { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0 }], B('b1', 'b2'));
  const holes = (kind, extra = {}) => ({ id: 'fo', type: 'holes', body: 'b1', face: TOP, kind, size: 'M3', d: 3.4, hd: 6.72, cb: 6.5, hk: 3.3, idepth: 6, af: 5.7, m: 2.6, depth: 0, pts: [[-10, -10], [10, 10]], ...extra });
  for (const k of ['plain', 'countersunk', 'counterbore', 'insert', 'nut']) R['holes_' + k] = await scene([box('b1', 40, 40, 10), holes(k, k === 'insert' ? { d: 4 } : {})], B('b1'));
  R.holes_hollow = await scene([box('b1', 40, 40, 20), { id: 'fsh', type: 'shell', body: 'b1', faces: [{ nc: [0.5, 0.5, 0], d: [0, 0, -1] }], t: 2 }, holes('plain')], B('b1'));
  R.snap_hook = await scene([box('b1', 40, 40, 10), { id: 'fn', type: 'snap', body: 'b1', face: TOP, mode: 'hook', w: 6, len: 8, t: 1.6, barb: 0.8, gap: 0.2, u: 0, v: 0, angle: 0, depth: 0 }], B('b1'));
  R.snap_window = await scene([box('b1', 40, 40, 10), { id: 'fn', type: 'snap', body: 'b1', face: TOP, mode: 'window', w: 6, len: 8, t: 1.6, barb: 0.8, gap: 0.2, u: 0, v: 0, angle: 0, depth: 0 }], B('b1'));
  for (const pattern of ['hex', 'round', 'slots']) R['vents_' + pattern] = await scene([box('b1', 60, 40, 3), { id: 'fv', type: 'vents', body: 'b1', face: TOP, pattern, s: 5, bar: 1.6, margin: 3, depth: 0, dir: 'across' }], B('b1'));
  R.vents_wall = await scene([box('b1', 40, 40, 30), shell('b1'), { id: 'fv', type: 'vents', body: 'b1', face: RIGHT, pattern: 'hex', s: 4, bar: 1.6, margin: 3, depth: 0 }], B('b1'));
  // the ones that also work on meshes (a part merged with a thread becomes a mesh)
  const bolt = (id, pos) => ({ id: 'f' + id, type: 'shape', body: id, kind: 'thread', p: { size: 'M3', D: 3, P: 0.5, len: 6, kind: 'cutter', clear: 0.15, head: 'none', headH: 2, af: 5.5, nutH: 2.4, chamfer: true }, pos, rot: [0, 0, 0] });
  const meshPlate = [box('b1', 40, 30, 4, [-22, 0, 0]), bolt('t1', [-30, 0, 0]), { id: 'fm1', type: 'combine', op: 'union', body: 'b1', tools: ['t1'] }];
  R.mesh_hinge = await scene([...meshPlate, box('b2', 40, 30, 4, [22, 0, 0]), { id: 'fh', type: 'hinge', body: 'b1', body2: 'b2', style: 'pin', d: 4, n: 0 }], { ...B('b1', 'b2'), t1: { name: 't', hole: true } });
  R.mesh_lid = await scene([box('b1', 40, 30, 20), shell('b1'), bolt('t1', [0, 0, 0]), { id: 'fm1', type: 'combine', op: 'union', body: 'b1', tools: ['t1'] },
    { id: 'fl', type: 'lid', src: 'b1', body: 'b2', style: 'snap', t: 2, lip: 4, wall: 1.2, gap: 0.15, dx: 50, dy: 0 }], { ...B('b1', 'b2'), t1: { name: 't', hole: true } });
  R.mesh_fit = await scene([...meshPlate, cyl('b2', 6, 10, [-15, 0, -2]), { id: 'ff', type: 'fit', body: 'b1', tools: ['b2'], gap: 0.2 }], { ...B('b1', 'b2'), t1: { name: 't', hole: true } });
  R.mesh_split = await scene([box('b1', 100, 20, 10), bolt('t1', [-40, 0, 0]), { id: 'fm1', type: 'combine', op: 'union', body: 'b1', tools: ['t1'] }, split('dovetail')], { ...B('b1', 'b2', 'b3'), t1: { name: 't', hole: true } });
  return R;
};
"""

async def main():
    ok = True
    def check(name, cond, info=''):
        nonlocal ok
        print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f'   {info}'), flush=True)
        ok = ok and bool(cond)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await (await b.new_context(viewport={'width': 1300, 'height': 800})).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto((ROOT / 'local/3DJames.html').as_uri())
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        await pg.add_script_tag(content=JS)
        R = await pg.evaluate('window.__helpers()')

        # ---- the same jobs from the Helpers menu, as a user does them
        async def built():
            await pg.wait_for_function('(()=>{const a=window.__3dj.app;return !a.building && !a.pending && a.builtRevision===window.__3dj.store.revision})()', timeout=120000)
        async def start(*shapes):
            await pg.evaluate('window.__3dj.commands.newProject()'); await built()
            ids = []
            for kind, p, pos in shapes:
                ids.append(await pg.evaluate("([k, p]) => window.__3dj.commands.addShape(k, p)", [kind, p])); await built()
                if pos: await pg.evaluate("([id, pos]) => window.__3dj.store.commit((d) => { d.features.find((f) => f.body === id).pos = pos; })", [ids[-1], pos]); await built()
            return ids
        async def select(*ids):
            await pg.evaluate("(ids) => { const { app, vp, commands } = window.__3dj; app.sel = ids; vp.setSelection(ids); app.tab = 'Object'; commands.renderCmdBar(); }", list(ids))
        async def helper(item):
            await pg.get_by_role('button', name='Helpers', exact=True).click()
            await pg.get_by_role('button', name=item, exact=True).click()
            await built()
        # a click on the face of an object that points this way (n), at (u, v) from the face's middle, as the 3D view reports it
        async def click_face(body, n, du=0, dv=0):
            await pg.evaluate('''([body, n, du, dv]) => { const d = window.__3dj.app.results.bodies.get(body); let idx = -1;
              for (let i = 0; i < d.faces.length / 6; i++) if ([0, 1, 2].every((k) => Math.abs(d.faces[i * 6 + 3 + k] - n[k]) < 1e-3)) { idx = i; break; }
              const c = [0, 1, 2].map((k) => d.faces[idx * 6 + k]); const point = [c[0] + du, c[1] + dv, c[2]];
              window.__3dj.commands.toolPick('face', { body, index: idx, point }); }''', [body, n, du, dv])
            await built()
        steps = lambda: pg.evaluate('window.__3dj.store.doc.features.map((f) => ({ type: f.type, pts: f.pts, u: f.u, v: f.v, joint: f.joint, keep: f.keep, kind: f.kind, src: f.src, tools: f.tools }))')
        errors = lambda: pg.evaluate('Object.keys(window.__3dj.app.results.errors).length')
        U = {}
        [box] = await start(('box', {'w': 60, 'd': 40, 'h': 10}, None)); await select(box)
        await helper('Screw holes on a face')
        await click_face(box, [0, 0, 1], -20, -10); await click_face(box, [0, 0, 1], 20, 10)
        await click_face(box, [1, 0, 0])
        U['holes_other_face'] = await pg.locator('.toast', has_text='same face').count() > 0
        await pg.get_by_role('button', name='Done', exact=True).click(); await built()
        s = await steps(); U['holes'] = (s[-1]['type'] == 'holes' and s[-1]['pts'][0] == [-20, -10] and len(s[-1]['pts']) == 2 and abs(s[-1]['pts'][1][0] - 20) < 0.5 and s[-1]['kind'] == 'countersunk' and not await errors(), s[-1])
        U['holes_panel'] = await pg.get_by_role('button', name='Click to add more', exact=True).count() == 1
        await select(box); await helper('Snap clip on a face'); await click_face(box, [0, 0, 1], 5, 3)
        s = await steps(); U['snap'] = (s[-1]['type'] == 'snap' and s[-1]['u'] == 5 and s[-1]['v'] == 3 and not await errors(), s[-1])
        await select(box); await helper('Vents on a face'); await click_face(box, [0, 0, -1])
        s = await steps(); U['vents'] = (s[-1]['type'] == 'vents' and not await errors(), s[-1])
        [box] = await start(('box', {'w': 60, 'd': 40, 'h': 10}, None)); await select(box); await helper('Split to fit the printer (with connectors)')
        U['split_bar'] = await pg.get_by_role('button', name='Connectors: Pegs and holes').count() == 1
        await pg.get_by_role('button', name='Split', exact=True).click(); await built()
        s = await steps(); U['split'] = (s[-1]['type'] == 'split' and s[-1]['joint'] == 'pegs' and s[-1]['keep'] == 'both' and not await errors(), s[-1], await pg.evaluate('window.__3dj.app.results.errors'))
        [box, part] = await start(('box', {'w': 30, 'd': 30, 'h': 10}, None), ('cyl', {'d': 10, 'h': 20}, [0, 0, -5])); await select(part)
        await helper('Fit around (cut out with a gap)')
        s = await steps(); U['fit'] = (s[-1]['type'] == 'fit' and s[-1]['tools'] == [part] and not await errors(), s[-1])
        [box] = await start(('box', {'w': 40, 'd': 30, 'h': 20}, None)); await select(box)
        await pg.evaluate("(id) => window.__3dj.store.commit((d) => d.features.push({ id: 'fsh', type: 'shell', body: id, faces: [{ nc: [0.5, 0.5, 1], d: [0, 0, 1] }], t: 2 }))", box); await built()
        await helper('Make a lid')
        s = await steps(); U['lid'] = (s[-1]['type'] == 'lid' and s[-1]['src'] == box and not await errors() and await pg.evaluate('window.__3dj.app.results.bodies.size') == 2, s[-1], await pg.evaluate('window.__3dj.app.results.errors'))
        [a, b2] = await start(('box', {'w': 40, 'd': 30, 'h': 4}, [-22, 0, 0]), ('box', {'w': 40, 'd': 30, 'h': 4}, [22, 0, 0])); await select(a, b2)
        await helper('Hinge between two parts')
        s = await steps(); U['hinge'] = (s[-1]['type'] == 'hinge' and not await errors(), s[-1], await pg.evaluate('window.__3dj.app.results.errors'))
        # a lid for a closed box hollows it first (no broken step, no red message)
        [box] = await start(('box', {'w': 40, 'd': 30, 'h': 20}, None)); await select(box)
        await helper('Make a lid'); await built(); await pg.wait_for_timeout(300); await built()
        s = await steps(); U['lid_closed_box'] = ([x['type'] for x in s] == ['shape', 'shell', 'lid'] and not await errors() and await pg.locator('.toast.err').count() == 0, s)
        # a hinge that cannot work is taken back out, with the reason
        [a, b2] = await start(('box', {'w': 40, 'd': 30, 'h': 4}, None), ('box', {'w': 40, 'd': 30, 'h': 4}, [10, 0, 0])); await select(a, b2)
        await helper('Hinge between two parts'); await built(); await pg.wait_for_timeout(300); await built()
        s = await steps(); U['hinge_overlap_undone'] = ([x['type'] for x in s] == ['shape', 'shape'] and await pg.locator('.toast.err', has_text='side by side').count() == 1, s)
        # split to fit the printer starts across the longest side and opens the step
        [box] = await start(('box', {'w': 120, 'd': 30, 'h': 16}, None)); await select(box)
        await helper('Split to fit the printer (with connectors)')
        await pg.get_by_role('button', name='Split', exact=True).click(); await built()
        s = await pg.evaluate("window.__3dj.store.doc.features.at(-1)")
        U['split_across'] = (s['type'] == 'split' and s['pitch'] == 90 and await pg.get_by_text('Connectors', exact=True).count() > 0, s)
        # two parts picked: the hook goes on the face clicked, its window in the other part
        [a, b2] = await start(('box', {'w': 40, 'd': 40, 'h': 10}, None), ('box', {'w': 40, 'd': 40, 'h': 3}, [0, 0, 14])); await select(a, b2)
        await helper('Snap clip on a face'); await click_face(a, [0, 0, 1])
        s = await steps(); U['snap_two_parts'] = (s[-1]['type'] == 'snap' and not await errors() and await pg.evaluate("window.__3dj.store.doc.features.at(-1).body2") == b2, s)
        await b.close()
    vol = lambda s, i: R[s]['b'].get(i, {}).get('v', 0)
    size = lambda s, i, k: (lambda bb: bb[1][k] - bb[0][k])(R[s]['b'][i]['bb'])
    clean = lambda s: not R[s]['errors']
    shell_v = vol('plainBox', 'b1')
    for st in ['friction', 'snap', 'slide']:
        s = 'lid_' + st
        check(f'{st} lid builds', clean(s) and 'b2' in R[s]['b'], R[s]['errors'])
    check('push-on lid: plate and lip (6 mm tall), lip fits inside', clean('lid_friction') and abs(size('lid_friction', 'b2', 2) - 6) < 0.05 and abs(size('lid_friction', 'b2', 0) - 40) < 0.05, R['lid_friction']['b'].get('b2'))
    check('push-on lid leaves the box alone', abs(vol('lid_friction', 'b1') - shell_v) < 0.01)
    check('snap lid cuts a groove in the box', clean('lid_snap') and vol('lid_snap', 'b1') < shell_v - 1)
    check('sliding lid: a 2 mm plate, grooves cut in the walls', clean('lid_slide') and abs(size('lid_slide', 'b2', 2) - 2) < 0.05 and vol('lid_slide', 'b1') < shell_v - 10)
    check('a lid for a closed box says to hollow it first', 'fl' in R['lid_closed']['errors'] and 'Hollow' in R['lid_closed']['errors']['fl'], R['lid_closed']['errors'])
    hole = math.pi * 5.2 ** 2 * 10
    check('fit around: the hole is 0.2 mm bigger all round', clean('fit') and abs((9000 - vol('fit', 'b1')) - hole) < hole * 0.02, (9000 - vol('fit', 'b1'), hole))
    check('fit around keeps the part', 'b2' in R['fit']['b'] and R['fit']['b']['b1']['solid'])
    check('fit around a box: 10.6 mm square pocket', clean('fit_box') and abs((9000 - vol('fit_box', 'b1')) - 10.6 ** 2 * 10) < 4, 9000 - vol('fit_box', 'b1'))
    total = 100 * 20 * 10
    check('split without connectors still works', clean('split_none') and abs(vol('split_none', 'b1') + vol('split_none', 'b2') - total) < 1)
    for j in ['pegs', 'pins', 'dovetail']:
        s = 'split_' + j
        check(f'split with {j} builds both halves', clean(s) and 'b1' in R[s]['b'] and 'b2' in R[s]['b'], R[s]['errors'])
    peg = math.pi * 2.5 ** 2 * 8
    check('pegs: 2 pegs on one half, holes in the other', abs((vol('split_pegs', 'b1') - total / 2) - 2 * peg) < peg * 0.1 and vol('split_pegs', 'b2') < total / 2 - 2 * peg, (vol('split_pegs', 'b1'), vol('split_pegs', 'b2')))
    check('pins: holes in both halves and 2 loose pins', vol('split_pins', 'b1') < total / 2 - 1 and vol('split_pins', 'b2') < total / 2 - 1 and abs(vol('split_pins', 'b3') - 2 * math.pi * 2.5 ** 2 * 7.8) < 15, (vol('split_pins', 'b1'), vol('split_pins', 'b3')))
    check('dovetail: a rail on one half, a slot in the other', vol('split_dovetail', 'b1') > total / 2 + 50 and vol('split_dovetail', 'b2') < total / 2 - 50, (vol('split_dovetail', 'b1'), vol('split_dovetail', 'b2')))
    check('split across a big face: 3 pegs fit', clean('split_flat') and abs((vol('split_flat', 'b1') - 60 * 40 * 15) - 3 * peg) < peg * 0.3, R['split_flat']['errors'] or vol('split_flat', 'b1') - 36000)
    check('pin hinge: two parts, knuckles between them', clean('hinge_pin') and 'b1' in R['hinge_pin']['b'] and 'b2' in R['hinge_pin']['b'], R['hinge_pin']['errors'])
    hb = R['hinge_pin']['b']
    check('pin hinge: the parts stay apart (not merged)', hb['b1']['bb'][1][0] < hb['b2']['bb'][1][0] and hb['b1']['bb'][0][0] < hb['b2']['bb'][0][0])
    # an empty result is what we want: the step that builds it says so
    empty = lambda s: 'empty' in R[s]['errors'].get('fz', '') or vol(s, 'c3' if 'c3' in R[s]['b'] else 'c1') < 0.01
    check('the hinge knuckles keep a gap of at least 0.1 mm from the other part', empty('hinge_touch'), R['hinge_touch']['errors'])
    check('the pegs do not overlap their holes', empty('pegs_touch'), (R['pegs_touch']['errors'], vol('pegs_touch', 'c1')))
    check('the dovetail rail does not overlap its slot', empty('dove_touch'), (R['dove_touch']['errors'], vol('dove_touch', 'c1')))
    for deg in [90, 180]:
        check(f'the pin hinge swings {deg} degrees without running into the other part', empty(f'hinge_fold{deg}'), (R[f'hinge_fold{deg}']['errors'], vol(f'hinge_fold{deg}', 'c1')))
    check('pegs through a thin half are made shorter (no hole out the top)', clean('split_thin') and R['split_thin']['b']['b1']['bb'][1][2] < 16 - 1.2 and abs(size('split_thin', 'b2', 2) - 8) < 0.01, (R['split_thin']['errors'], R['split_thin']['b']['b1']['bb']))
    win = 6.4 * 3.0 * 3
    check('a snap hook cuts its window in the part it clicks into', clean('snap_into') and abs((4800 - vol('snap_into', 'b2')) - win) < 2, (R['snap_into']['errors'], 4800 - vol('snap_into', 'b2')))
    check('a snap hook that misses the other part says so', 'fn' in R['snap_miss']['errors'] and 'reach' in R['snap_miss']['errors']['fn'], R['snap_miss']['errors'])
    check('living hinge joins them into one object', clean('hinge_living') and list(R['hinge_living']['b']) == ['b1'] and abs(size('hinge_living', 'b1', 0) - 84) < 0.05, R['hinge_living'])
    check('a hinge between parts front to back (only its defaults given)', clean('hinge_front') and len(R['hinge_front']['b']) == 2, R['hinge_front']['errors'])
    check('a hinge for parts that are not side by side explains', 'fh' in R['hinge_apart']['errors'] and 'side by side' in R['hinge_apart']['errors']['fh'], R['hinge_apart']['errors'])
    base = 40 * 40 * 10
    plain = 2 * math.pi * 1.7 ** 2 * 10
    check('plain holes go through', clean('holes_plain') and abs((base - vol('holes_plain', 'b1')) - plain) < plain * 0.03, base - vol('holes_plain', 'b1'))
    for k in ['countersunk', 'counterbore', 'nut']:
        check(f'{k} holes take more than plain ones', clean('holes_' + k) and base - vol('holes_' + k, 'b1') > plain + 5, R['holes_' + k]['errors'] or base - vol('holes_' + k, 'b1'))
    ins = 2 * math.pi * 2 ** 2 * 6
    check('insert holes: 4 mm wide, 6 mm deep', clean('holes_insert') and abs((base - vol('holes_insert', 'b1')) - ins) < ins * 0.03, base - vol('holes_insert', 'b1'))
    hv = vol('holes_hollow', 'b1')
    sh = 40 * 40 * 20 - 36 * 36 * 18
    check('through a hollow part: only the top wall is drilled', clean('holes_hollow') and abs((sh - hv) - 2 * math.pi * 1.7 ** 2 * 2) < 3, (sh - hv, R['holes_hollow']['errors']))
    check('snap hook stands on the face', clean('snap_hook') and abs(size('snap_hook', 'b1', 2) - 18) < 0.05 and vol('snap_hook', 'b1') > base + 6 * 1.6 * 8, R['snap_hook'])
    check('snap window cuts through', clean('snap_window') and abs((base - vol('snap_window', 'b1')) - 6.4 * 2.8 * 10) < 3, base - vol('snap_window', 'b1'))
    for pat in ['hex', 'round', 'slots']:
        s = 'vents_' + pat
        cut = 60 * 40 * 3 - vol(s, 'b1')
        check(f'{pat} vents cut a pattern through the plate', clean(s) and 1500 < cut < 54 * 34 * 3, R[s]['errors'] or cut)
    wall = (40 * 40 * 30 - 36 * 36 * 28) - vol('vents_wall', 'b1')
    check('vents in a box wall go through that wall only', clean('vents_wall') and 50 < wall < 34 * 24 * 2, R['vents_wall']['errors'] or wall)
    for s in ['mesh_hinge', 'mesh_lid', 'mesh_fit', 'mesh_split']:
        check(f'{s.replace("mesh_", "")} on a mesh (a part merged with a thread)', clean(s) and not R[s]['b']['b1']['solid'] and len(R[s]['b']) >= 2, R[s]['errors'])
    for k, v in U.items():
        good = v[0] if isinstance(v, tuple) else v
        check(f'from the menu: {k}', good, v)
    check('no page errors', not errs, errs)
    raise SystemExit(0 if ok else 1)

asyncio.run(main())
