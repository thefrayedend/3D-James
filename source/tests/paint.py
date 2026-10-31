# Paint parts (Paint tab): fill a face, brush, sphere, band and eraser with the real mouse, Done / Cancel / Undo,
# the paint following the object when it is moved, turned, sized, copied and merged, and the paint in a saved 3MF as
# OrcaSlicer's / Bambu Studio's per-triangle "paint_color" (read back here the way their TriangleSelector reads it).
#   python tests/paint.py
import asyncio, os, re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {info}'))
  if not ok: fails.append(name)

JS = '''
  window.__wait = async () => { const { app, store: S } = window.__3dj; const t = Date.now();
    while (app.building || app.pending || app.builtRevision !== S.revision) { if (Date.now() - t > 120000) throw Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
  window.__box = (id) => window.__3dj.app.results.bodies.get(id).bbox;
  window.__scr = (p) => { const v = window.__3dj.vp.toScreen(new (window.__3dj.vp.camera.position.constructor)(...p)); return [v.x, v.y]; };
  // the painted pieces of an object as drawn: [[x,y,z] middle of each piece, colour r,g,b]
  window.__pieces = (id) => { const e = window.__3dj.vp.bodies.get(id); const m = e?.paintMesh; if (!m) return [];
    const P = m.geometry.getAttribute('position').array, C = m.geometry.getAttribute('color').array, out = [];
    for (let i = 0; i < P.length; i += 9) out.push([[(P[i] + P[i + 3] + P[i + 6]) / 3, (P[i + 1] + P[i + 4] + P[i + 7]) / 3, (P[i + 2] + P[i + 5] + P[i + 8]) / 3], [C[i], C[i + 1], C[i + 2]]]);
    return out; };
'''

def decode(s):
  """A paint_color string as OrcaSlicer reads it: nibbles from the last character on; returns the tree."""
  nib = [int(c, 16) for c in reversed(s)]
  pos = [0]
  def nxt():
    v = nib[pos[0]]; pos[0] += 1; return v
  def node():
    code = nxt()
    if code & 3:
      assert code & 3 == 3, 'only splits in four are written'
      kids = [None] * 4
      for i in range(3, -1, -1): kids[i] = node()
      return kids
    if code & 12 == 12:
      n = nxt(); return n + 18 + nxt() if n == 15 else n + 3
    return code >> 2
  t = node()
  assert pos[0] == len(nib), 'every nibble used'
  return t
def leaves(t):
  return [t] if not isinstance(t, list) else [x for k in t for x in leaves(k)]

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto(Path(os.environ.get('TDJ_APP', ROOT / 'local/3DJames.html')).as_uri())
    await pg.wait_for_function(READY, timeout=120000)
    await pg.evaluate('()=>{' + JS + '}')
    ev = pg.evaluate

    # Paint tab: Paint parts opens the paint row (Cancel, Done, colours, tools)
    box = await ev('''async () => { const { commands: C, app, vp } = window.__3dj; C.newProject(); await __wait();
      const id = C.addShape('box', { w: 30, d: 30, h: 20 }); await __wait(); app.sel = []; vp.setSelection([]);
      app.tab = 'Paint'; C.renderCmdBar(); return id; }''')
    await pg.get_by_role('button', name='Paint parts').click()
    names = await ev('() => [...document.querySelectorAll("#cmdbar .cb span")].map((s) => s.textContent)')
    check('Paint parts shows Cancel, Done, Fill, Brush, Sphere, Band, Eraser, Clear', all(n in names for n in ['Cancel', 'Done', 'Fill', 'Brush', 'Sphere', 'Band', 'Eraser', 'Clear']), names)

    # 1. Fill: hover shows what would be filled, a click fills the top face (coverage 30°: not the sides)
    await ev('() => { const P = window.__3dj.commands.paintPrefs; P.mode = "fill"; P.color = "#ff0000"; P.coverage = 30; window.__3dj.vp.view("home", false); }')
    await pg.wait_for_timeout(300)
    bb = await ev('(id) => __box(id)', box)
    top = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, bb[1][2]]
    at = await ev('(p) => __scr(p)', top)
    await pg.mouse.move(*at); await pg.mouse.move(at[0] + 2, at[1] + 1)
    prev = await ev('() => !!window.__3dj.vp.paintPreview')
    check('Fill: pointing at a face shows it in the colour first (like 3D Builder)', prev)
    await pg.mouse.click(at[0] + 2, at[1] + 1)
    pc = await ev('(id) => __pieces(id)', box)
    check('Fill: a click paints the top face, and only it', len(pc) >= 2 and all(abs(c[0][2] - bb[1][2]) < 1e-3 for c in pc) and all(c[1][0] > 0.9 and c[1][1] < 0.1 for c in pc), pc[:4])

    # Fill dragged from the top over the front: both faces, as one stroke (one Ctrl+Z takes both off)
    await ev('() => { window.__3dj.vp.view("home", false); }'); await pg.wait_for_timeout(300)
    fr = await ev('(p) => __scr(p)', [top[0], bb[0][1], (bb[0][2] + bb[1][2]) / 2])
    await pg.mouse.move(at[0] + 2, at[1] + 1); await pg.mouse.down()
    for k in range(1, 11): await pg.mouse.move(at[0] + (fr[0] - at[0]) * k / 10, at[1] + (fr[1] - at[1]) * k / 10)
    await pg.mouse.up()
    pc = await ev('(id) => __pieces(id)', box)
    faces = {round(c[0][2] - bb[1][2], 2) == 0 for c in pc} | {round(c[0][1] - bb[0][1], 2) == 0 for c in pc}
    strokes = await ev('(id) => window.__3dj.app.tool.ops[id].length', box)
    check('Fill: dragging across the object fills each face passed over (like 3D Builder), as one Undo step', True in faces and len(pc) > 2 and any(abs(c[0][1] - bb[0][1]) < 1e-3 for c in pc) and strokes == 3, (len(pc), strokes))  # the click's fill + the drag's two
    await pg.keyboard.press('Control+z')
    check('Ctrl+Z takes the whole drag off, the earlier fill stays', await ev('(id) => window.__3dj.app.tool.ops[id].length', box) == 1)

    # Cancel takes it off again; nothing is kept
    await pg.get_by_role('button', name='Cancel').click()
    check('Cancel: the paint made goes away, nothing kept', not await ev('(id) => __pieces(id).length', box) and not await ev('(id) => !!window.__3dj.store.doc.bodies[id].paint', box))

    # 2. again, then a brush stroke across the front, then Done: one Undo step
    await pg.get_by_role('button', name='Paint parts').click()
    await pg.mouse.click(at[0] + 2, at[1] + 1)
    await ev('() => { const P = window.__3dj.commands.paintPrefs; P.mode = "brush"; P.color = "#0000ff"; P.size = 4; window.__3dj.vp.view("front", false); }')
    await pg.wait_for_timeout(300)
    zc = (bb[0][2] + bb[1][2]) / 2
    a = await ev('(p) => __scr(p)', [bb[0][0] + 6, bb[0][1], zc]); c = await ev('(p) => __scr(p)', [bb[1][0] - 6, bb[0][1], zc])
    await pg.mouse.move(*a); await pg.mouse.down()
    for k in range(1, 21): await pg.mouse.move(a[0] + (c[0] - a[0]) * k / 20, a[1] + (c[1] - a[1]) * k / 20)
    await pg.mouse.up()
    pc = await ev('(id) => __pieces(id)', box)
    blue = [x for x in pc if x[1][2] > 0.9]
    ok = blue and all(abs(x[0][1] - bb[0][1]) < 1e-3 and abs(x[0][2] - zc) < 2.6 and bb[0][0] + 3 < x[0][0] < bb[1][0] - 3 for x in blue)
    check('Brush: a drag paints a 4 mm wide stripe on the front face, where it went', ok, blue[:3])
    trees = await ev('(id) => window.__3dj.vp.bodies.get(id).paint.trees.filter((t) => Array.isArray(t)).length', box)
    check('Brush: big triangles are split where the stroke edge runs through them', trees > 0, trees)
    undo0 = await ev('() => window.__3dj.store.undoStack.length')
    await pg.get_by_role('button', name='Done').click()
    ops = await ev('(id) => window.__3dj.store.doc.bodies[id].paint.ops.map((o) => o.t)', box)
    check('Done keeps the fill and the stroke as one Undo step', ops == ['fill', 'brush'] and await ev('() => window.__3dj.store.undoStack.length') == undo0 + 1, ops)

    async def red_top():
      bb2 = await ev('(id) => __box(id)', box)
      pc2 = await ev('(id) => __pieces(id)', box)
      reds = [x for x in pc2 if x[1][0] > 0.9]
      return bb2, reds, [x for x in pc2 if x[1][2] > 0.9]

    # 3. the paint follows the object: moved with the arrow keys, by Properties, turned, sized
    await ev('''async (id) => { const { commands: C, app, vp } = window.__3dj; app.sel = [id]; vp.setSelection([id]); C.translateSel(25, 0, 0); await __wait(); }''', box)
    bb2, reds, blues = await red_top()
    check('Moved: the paint goes along', reds and all(abs(x[0][2] - bb2[1][2]) < 1e-3 and bb2[0][0] <= x[0][0] <= bb2[1][0] for x in reds) and blues and all(abs(x[0][1] - bb2[0][1]) < 1e-3 for x in blues))
    await ev('''async (id) => { const { store: S } = window.__3dj; S.commit((d) => { const f = d.features.find((x) => x.body === id); f.pos = [f.pos[0], f.pos[1] + 10, f.pos[2]]; }); await __wait(); }''', box)
    bb2, reds, blues = await red_top()
    check('Moved by changing its position in Properties: the paint goes along', reds and blues and all(abs(x[0][1] - bb2[0][1]) < 1e-3 for x in blues), [bb2, blues[:2]])
    await ev('''async (id) => { const { commands: C } = window.__3dj; C.rotateSel('z', 90); await __wait(); }''', box)
    bb2, reds, blues = await red_top()
    check('Turned a quarter: the top stays painted, the stripe turns with its side', reds and all(abs(x[0][2] - bb2[1][2]) < 1e-3 for x in reds) and blues and all(abs(x[0][0] - bb2[1][0]) < 1e-3 for x in blues), [bb2, blues[:2]])
    await ev('''async (id) => { const { commands: C } = window.__3dj; const b = __box(id); C.barCommit(2, String(b[1][2] - b[0][2] + 10)); await __wait(); }''', box)
    bb2, reds, blues = await red_top()
    check('Made taller: the top paint stays on the top', reds and all(abs(x[0][2] - bb2[1][2]) < 1e-3 for x in reds), [bb2, reds[:2]])

    # 4. Duplicate: the copy has the same paint, in its own place
    cp = await ev('''async (id) => { const { commands: C, app } = window.__3dj; app.sel = [id]; C.duplicateSel(); await __wait(); return app.sel[0]; }''', box)
    cb = await ev('(id) => __box(id)', cp); cpc = await ev('(id) => __pieces(id)', cp)
    check('Duplicate: the copy is painted the same, where the copy is', cpc and all(abs(x[0][2] - cb[1][2]) < 1e-3 and cb[0][0] - 1e-3 <= x[0][0] <= cb[1][0] + 1e-3 for x in cpc if x[1][0] > 0.9) and len(cpc) == len(await ev('(id) => __pieces(id)', box)))

    # 5. Merge: a painted cylinder joined onto the box keeps its paint
    await ev('''async (cp) => { const { commands: C, app, vp } = window.__3dj; app.sel = [cp]; C.deleteSel(); await __wait(); }''', cp)
    cyl = await ev('''async (box) => { const { commands: C, app, vp, store: S } = window.__3dj; const id = C.addShape('cyl', { d: 10, h: 10 }); await __wait();
      const b = __box(box), c = __box(id); C.translateSel(0, 0, 0);
      S.commit((d) => { const f = d.features.find((x) => x.body === id); f.pos = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, b[1][2] - 2]; }); await __wait();
      C.startPaint(); const P = C.paintPrefs; P.mode = 'fill'; P.color = '#00ff00'; P.coverage = 0;
      const t = __box(id); C.paintPointer('down', { body: id, point: [(t[0][0] + t[1][0]) / 2, (t[0][1] + t[1][1]) / 2, t[1][2]], normal: [0, 0, 1], dir: [0, 0, -1], tri: -1 }, {});
      C.finishPaint(true); app.sel = [box, id]; vp.setSelection(app.sel); C.combine('union'); await __wait(); return id; }''', box)
    pc = await ev('(id) => __pieces(id)', box)
    check('Merge: the joined object keeps the paint of both', any(x[1][1] > 0.9 for x in pc) and any(x[1][0] > 0.9 for x in pc) and any(x[1][2] > 0.9 for x in pc))

    # 6. Sphere, Band and Eraser (driven directly; the mouse path is the same as the brush)
    res = await ev('''async ([id, top]) => { const { commands: C, vp } = window.__3dj; const b = __box(id), cz = (b[0][2] + b[1][2]) / 2; b[1][2] = top;
      C.startPaint(); const P = C.paintPrefs, before = __pieces(id).length;
      P.mode = 'band'; P.color = '#ffff00'; P.size = 3;
      C.paintPointer('down', { body: id, point: [b[1][0], (b[0][1] + b[1][1]) / 2, cz], normal: [1, 0, 0], dir: [-1, 0, 0], tri: 0 }, {}); C.paintPointer('up', null, {});
      const yel = __pieces(id).filter((x) => x[1][0] > 0.9 && x[1][1] > 0.9);
      const bandOk = yel.length > 0 && yel.every((x) => Math.abs(x[0][2] - cz) <= 1.5 + 1e-6);
      const allSides = [0, 1].every((i) => yel.some((x) => Math.abs(x[0][i] - b[0][i]) < 1e-3)) && [0, 1].every((i) => yel.some((x) => Math.abs(x[0][i] - b[1][i]) < 1e-3));
      P.mode = 'erase'; P.size = 30;
      const mid = [(b[0][0] + b[1][0]) / 2, b[0][1], cz];
      C.paintPointer('down', { body: id, point: mid, normal: [0, -1, 0], dir: [0, 1, 0], tri: 0 }, {}); C.paintPointer('up', null, {});
      const frontLeft = __pieces(id).filter((x) => Math.abs(x[0][1] - b[0][1]) < 1e-3 && Math.hypot(x[0][0] - mid[0], x[0][2] - mid[2]) < 14).length;
      P.mode = 'ball'; P.color = '#ff00ff'; P.size = 6;
      C.paintPointer('down', { body: id, point: [b[1][0], b[1][1], b[1][2]], normal: [0, 0, 1], dir: [0, 0, -1], tri: 0 }, {}); C.paintPointer('up', null, {});
      const mag = __pieces(id).filter((x) => x[1][0] > 0.9 && x[1][2] > 0.9 && x[1][1] < 0.1);
      const ballOk = mag.length > 0 && mag.every((x) => Math.hypot(x[0][0] - b[1][0], x[0][1] - b[1][1], x[0][2] - b[1][2]) <= 3 + 1e-6);
      const sides = new Set(mag.map((x) => (Math.abs(x[0][0] - b[1][0]) < 1e-3 ? 'x' : '') + (Math.abs(x[0][1] - b[1][1]) < 1e-3 ? 'y' : '') + (Math.abs(x[0][2] - b[1][2]) < 1e-3 ? 'z' : '')));
      C.finishPaint(true);
      return { bandOk, allSides, frontLeft, ballOk, sides: [...sides] }; }''', [box, bb2[1][2]])
    check('Band: a level band all the way round, as tall as Size', res['bandOk'] and res['allSides'], res)
    check('Eraser: rubs the paint off where it goes', res['frontLeft'] == 0, res)
    check('Sphere: paints within the ball on every face it touches (a corner: three faces)', res['ballOk'] and len(set(''.join(res['sides']))) == 3, res)

    # 7. Undo after Done takes the paint session off in one go; Redo puts it back
    n1 = await ev('(id) => window.__3dj.store.doc.bodies[id].paint.ops.length', box)
    await ev('async () => { window.__3dj.store.undo(); await __wait(); }')
    n0 = await ev('(id) => window.__3dj.store.doc.bodies[id].paint?.ops.length || 0', box)
    await ev('async () => { window.__3dj.store.redo(); await __wait(); }')
    check('Undo after Done: the whole painting session in one step, Redo brings it back', n0 == n1 - 3 and await ev('(id) => window.__3dj.store.doc.bodies[id].paint.ops.length', box) == n1, [n0, n1])

    # 8. the 3MF: paint as OrcaSlicer's paint_color, each paint colour on a filament of its own
    data = await ev('''async () => { const { commands: C } = window.__3dj; const bytes = await C.buildFileData('3mf');
      const zip = await C.readZip(bytes); return new TextDecoder().decode(zip.get('3D/3dmodel.model')); }''')
    groups = re.findall(r'<m:colorgroup id="(\d+)"><m:color color="(#[0-9A-F]{8})"/>', data)
    fil = {}
    for gid, c in sorted(groups, key=lambda g: int(g[0])):
      if c not in fil: fil[c] = len(fil) + 1
    paints = re.findall(r'paint_color="([0-9A-F]+)"', data)
    check('3MF: every paint colour has a colour group (so a filament of its own)', all(c in fil for c in ['#FF0000FF', '#0000FFFF', '#00FF00FF', '#FFFF00FF', '#FF00FFFF']), list(fil))
    if not all(c in fil for c in ['#FF0000FF', '#0000FFFF', '#FFFF00FF', '#FF00FFFF']): fil = {**{c: -1 for c in ['#FF0000FF', '#0000FFFF', '#FFFF00FF', '#FF00FFFF']}, **fil}
    states = set()
    try:
      for s in paints: states |= set(leaves(decode(s)))
      okdec = True
    except Exception as e:
      okdec = str(e)
    check('3MF: every paint_color reads back the way OrcaSlicer reads it', paints and okdec is True, okdec)
    check('3MF: the paint names the filaments of its colours', {fil['#FF0000FF'], fil['#0000FFFF'], fil['#FF00FFFF'], fil['#FFFF00FF']} <= states and states <= set(fil.values()) | {0}, [states, fil])
    tri = re.findall(r'<triangle [^>]*>', data)
    check('3MF: whole painted triangles are written the short way ("8" = filament 2)', any(re.search(r'paint_color="[48]"|paint_color="[0-9A-F]C"', t) for t in tri))

    check('no page errors', not errors, errors)
    await b.close()
  print(f'\n{"all passed" if not fails else f"{len(fails)} failed"}')
  if fails: raise SystemExit(1)

asyncio.run(main())
