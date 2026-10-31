# Sketch tools: Trim, Slot, Polygon, Offset, Pattern, helper line <-> drawn line, Level & upright, and importing DXF / SVG.
# Real mouse clicks and keys where it matters. Run after build.py:  python tests/sketch_tools.py
import asyncio, json, math
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()


def dxf_text():
  """A small DXF in mm: a 60 x 40 plate with a round end (LWPOLYLINE with a bulge), a line-arc-line chain, a block hole."""
  ent = lambda *g: '\n'.join(f'{c}\n{v}' for c, v in g)
  return '\n'.join(['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS', ent((0, 'BLOCK'), (2, 'HOLE'), (10, 0), (20, 0)), ent((0, 'CIRCLE'), (10, 0), (20, 0), (40, 3)), ent((0, 'ENDBLK')), '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    ent((0, 'LWPOLYLINE'), (90, 4), (70, 1), (10, 0), (20, 0), (10, 60), (20, 0), (42, 1), (10, 60), (20, 40), (10, 0), (20, 40)),
    ent((0, 'LINE'), (10, 100), (20, 0), (11, 120), (21, 0)), ent((0, 'ARC'), (10, 120), (20, 10), (40, 10), (50, 270), (51, 90)),
    ent((0, 'LINE'), (10, 120), (20, 20), (11, 100), (21, 20)), ent((0, 'LINE'), (10, 100), (20, 20), (11, 100), (21, 0)),
    ent((0, 'INSERT'), (2, 'HOLE'), (10, 10), (20, 10)), ent((0, 'TEXT'), (1, 'hello')),
    '0', 'ENDSEC', '0', 'EOF'])


SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">'
       '<rect x="10" y="10" width="30" height="20"/><circle cx="70" cy="25" r="10"/>'
       '<path d="M 50 45 A 10 10 0 0 1 70 45" fill="none" stroke="black"/></svg>')


def area(l):
  """Area of a loop (arcs included) for checking results."""
  if l['type'] == 'circle': return math.pi * l['r'] ** 2
  P, B, n, a = l['pts'], l.get('bulge') or [0] * len(l['pts']), len(l['pts']), 0
  for i in range(n):
    (x1, y1), (x2, y2) = P[i], P[(i + 1) % n]; a += (x1 * y2 - x2 * y1) / 2
    b = B[i] or 0
    if b:
      c = math.hypot(x2 - x1, y2 - y1); th = 4 * math.atan(b); R = c * (1 + b * b) / (4 * abs(b))
      a += math.copysign(R * R * (abs(th) - math.sin(abs(th))) / 2, th)
  return abs(a)


def bounds(l):
  xs = [p[0] for p in l['pts']]; ys = [p[1] for p in l['pts']]
  return [min(xs), min(ys), max(xs), max(ys)]


async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    ev = pg.evaluate
    results = []
    def check(name, ok, info=''):
      results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:500]), flush=True)
    async def board(start='[]', tool='line'):
      await ev(f"""async()=>{{ document.querySelector('.sketch') && window.__k?.close(); window.__done=null; window.__k=__3dj.commands.openSketch({start}, (l,r)=>{{window.__done={{l,r}}}}, 'Sketch', {{}}); await new Promise(r=>setTimeout(r,250)); __k.setTool('{tool}'); }}""")
      await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()"); await pg.wait_for_timeout(150)
    async def at(x, y): return await ev(f"()=>__k.screenOf([{x},{y}])")
    async def clicks(*pts):
      for q in pts: x, y = await at(*q); await pg.mouse.click(x, y); await pg.wait_for_timeout(30)
    async def typed(s):
      await pg.keyboard.type(s); await pg.keyboard.press('Enter')
    L = lambda: ev("()=>JSON.parse(JSON.stringify(__k.loops))")
    R = lambda: ev("()=>JSON.parse(JSON.stringify(__k.rules))")
    near = lambda a, b2, tol=1e-3: abs(a - b2) < tol

    # ---- the toolbar and keys
    await board()
    names = await ev("()=>[...document.querySelectorAll('.sketch .sk-tool span')].map(s=>s.textContent)")
    check('Slot, Polygon and Trim are on the toolbar, and Import', all(n in names for n in ['Slot', 'Polygon', 'Trim']) and await ev("()=>[...document.querySelectorAll('.sketch .sk-bar .cb span')].some(s=>s.textContent==='Import')"), names)
    tools = []
    for k in 'opt':
      await pg.mouse.move(640, 400); await pg.keyboard.press(k)
      tools.append(await ev("()=>document.querySelector('.sk-tool.on').dataset.tool"))
    check('keys O, P, T pick Slot, Polygon, Trim', tools == ['slot', 'polygon', 'trim'], tools)

    # ---- Trim: two overlapping rectangles become one L-free outline
    await board('[{type:"poly",pts:[[0,0],[40,0],[40,30],[0,30]]},{type:"poly",pts:[[20,10],[60,10],[60,40],[20,40]]}]', 'trim')
    x, y = await at(40, 20); await pg.mouse.move(x - 30, y); await pg.mouse.move(x, y); await pg.wait_for_timeout(50)
    check('Trim shows the piece it would take out in red, only between the crossings', await ev("()=>!!document.querySelector('.sk-trim')") and await ev("()=>{ const s=__k.trimSpanAt([40,20]); return s && Math.abs(s.t0-1/3)<1e-6 && s.t1===1; }"), await ev("()=>__k.trimSpanAt([40,20])"))
    await clicks((40, 20))
    ls = await L()
    check('trimming a side of an outline opens it (the piece is gone)', len(ls) == 2 and sum(l['type'] == 'open' for l in ls) == 1, ls)
    await clicks((30, 30), (20, 20), (30, 10))
    ls = await L()
    one = [l for l in ls if l['type'] == 'poly']
    check('trimming the 4 inside pieces leaves one closed outline: the two shapes joined', len(ls) == 1 and len(one) == 1 and len(one[0]['pts']) == 8 and near(area(one[0]), 2000, 1e-2), ls)
    await ev("()=>__k.undo()")
    ls = await L()
    check('Undo puts the last piece back', ls and ls[0]['type'] == 'open' and not [l for l in ls if l['type'] == 'poly' and len(l['pts']) == 8], ls)
    # a circle cut by a line: the piece between the crossings goes, the rest stays an arc
    await board('[{type:"circle",c:[0,0],r:10},{type:"line",pts:[[-20,4],[20,4]]}]', 'trim')
    await clicks((0, 10))
    ls = await L(); o = [l for l in ls if l['type'] == 'open']
    check('trimming the top of a circle across a helper line leaves the rest as an arc', len(o) == 1 and near(abs(o[0]['pts'][0][0]), math.sqrt(84), 1e-4) and near(o[0]['pts'][-1][1], 4) and o[0].get('bulge') and all(abs(bb) <= 1.0000001 for bb in o[0]['bulge']), ls)
    await clicks((15, 4))
    ls = await L(); lines = [l for l in ls if l['type'] == 'line']
    check('trimming a helper line keeps the rest of it', len(lines) == 1 and lines[0]['pts'][0] == [-20, 4] and near(lines[0]['pts'][1][0], math.sqrt(84), 1e-3), lines)
    await board('[{type:"circle",c:[0,0],r:10}]', 'trim')
    await clicks((10, 0))
    check('a line nothing crosses is taken out whole', len(await L()) == 0)

    # ---- Slot
    await board('[]', 'slot')
    await clicks((0, 0), (30, 0), (30, 4))
    ls = await L(); sl = ls[-1] if ls else None
    check('Slot: two centers and the width make a rounded slot', sl and sl['type'] == 'poly' and len(sl['pts']) == 4 and sl.get('bulge') == [0, 1, 0, 1] and near(area(sl), 30 * 8 + math.pi * 16, 1e-2), ls)
    rs = await R()
    check('the slot keeps its shape: parallel sides, smooth round ends', sum(r['t'] == 'smooth' for r in rs) == 4 and any(r['t'] == 'parallel' for r in rs), rs)
    await ev("()=>__k.movePoint(0, 1, [40, 0])")
    sl = (await L())[0]; A, B2, C, D = sl['pts']
    par = abs((B2[0] - A[0]) * (C[1] - D[1]) - (B2[1] - A[1]) * (C[0] - D[0]))
    check('dragging a slot corner keeps it a slot (sides parallel, ends round)', par < 1e-3 and all(abs(abs(bb) - 1) < 1e-3 for bb in [sl['bulge'][1], sl['bulge'][3]]), sl)
    await board('[]', 'slot')
    await clicks((0, 20)); x, y = await at(10, 20); await pg.mouse.move(x, y); await typed('25'); await typed('6')
    sl = (await L())[-1]
    check('Slot by typing: length 25 (center to center) then width 6', bounds(sl) == [0, 17, 25, 23] and near(area(sl), 25 * 6 + math.pi * 9, 1e-2), sl)

    # ---- Polygon
    await board('[]', 'polygon')
    await clicks((0, 0)); await typed('20')
    pl = (await L())[-1]; bx = bounds(pl)
    check('Polygon: type 20 across flats: a hexagon 20 across, flat side at the bottom', len(pl['pts']) == 6 and near(bx[1], -10) and near(bx[3], 10) and near(bx[2] - bx[0], 40 / math.sqrt(3), 1e-2), pl)
    await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='8').click()")
    await clicks((50, 0), (60, 0))
    pl = (await L())[-1]
    check('the number of sides is picked on the right (8 here), a click sets a corner', len(pl['pts']) == 8 and [60, 0] in pl['pts'], pl)
    await ev("()=>{ const s=[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='6'); s.click(); }")

    # ---- helper line <-> drawn line
    await board('[{type:"poly",pts:[[0,0],[30,0],[30,20],[0,20]]}]', 'select')
    await ev("()=>__k.pickEdge(0, 0)"); await pg.wait_for_timeout(50)
    await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Make helper line').click()")
    ls = await L()
    check('Make helper line: the side becomes a helper line, the outline opens', sorted(l['type'] for l in ls) == ['line', 'open'] and next(l for l in ls if l['type'] == 'line')['pts'] == [[0, 0], [30, 0]], ls)
    li = next(i for i, l in enumerate(ls) if l['type'] == 'line')
    await ev(f"()=>__k.pickEdge({li}, 0)"); await pg.wait_for_timeout(50)
    await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Make it a drawn line').click()")
    ls = await L()
    check('Make it a drawn line: it joins up and closes the outline again', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 4, ls)

    # ---- Pattern
    await board('[{type:"circle",c:[20,0],r:2}]', 'select')
    await ev("()=>__k.pick(0)")
    await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Pattern…').click()")
    await ev("()=>[...document.querySelectorAll('dialog.modal .seg button')].find(b=>b.textContent==='In a circle').click()")
    await pg.fill('dialog.modal input >> nth=0', '6')
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Make copies').click()")
    cs = [l for l in await L() if l['type'] == 'circle']
    angs = sorted(round(math.degrees(math.atan2(c['c'][1], c['c'][0])) % 360) for c in cs)
    check('Pattern in a circle: 6 holes evenly round the center', len(cs) == 6 and angs == [0, 60, 120, 180, 240, 300] and all(near(math.hypot(*c['c']), 20, 1e-2) for c in cs), cs)
    await board('[{type:"poly",pts:[[0,0],[4,0],[4,4],[0,4]]}]', 'select')
    await ev("()=>__k.pattern([0], {kind:'row', count:4, dx:10, dy:0})")
    ls = await L()
    check('Pattern in a row: 4 in all, 10 mm apart', len(ls) == 4 and sorted(bounds(l)[0] for l in ls) == [0, 10, 20, 30], ls)

    # ---- Offset (the geometry engine does it)
    await board('[{type:"poly",pts:[[-20,-10],[20,-10],[20,10],[-20,10]]},{type:"circle",c:[50,0],r:5}]', 'select')
    await ev("()=>__k.pick(0)")
    await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Offset…').click()")
    await pg.fill('dialog.modal input >> nth=0', '2')
    await ev("()=>[...document.querySelectorAll('dialog.modal .seg button')].find(b=>b.textContent==='Inside (smaller)').click()")
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Offset').click()")
    await pg.wait_for_function("()=>__k.loops.length===3", timeout=20000)
    ls = await L(); w = ls[2]
    check('Offset inside 2 mm: a smaller copy (a 2 mm wall with the original)', w['type'] == 'poly' and [round(v, 3) for v in bounds(w)] == [-18, -8, 18, 8] and ls[0]['pts'] == [[-20, -10], [20, -10], [20, 10], [-20, 10]], ls)
    await ev("()=>__k.offset([0], 3, 'round', true)"); await pg.wait_for_function("()=>__k.loops.length===4", timeout=20000)
    o = (await L())[3]
    check('Offset outside with round corners: arcs at the corners, 3 mm away', o['type'] == 'poly' and o.get('bulge') and sum(1 for bb in o['bulge'] if abs(bb) > 1e-6) == 4 and [round(v, 3) for v in bounds(o)] == [-23, -13, 23, 13], o)
    await ev("()=>__k.offset([1], 1.5, 'sharp', false)"); await pg.wait_for_function("()=>__k.loops.filter(l=>l.type==='circle').length===1 && __k.loops.length===4", timeout=20000)
    c = [l for l in await L() if l['type'] == 'circle'][0]
    check('Offset a circle, replacing it: a circle 1.5 mm bigger', near(c['r'], 6.5) and c['c'] == [50, 0], c)
    await ev("()=>__k.offset([1], -10, 'sharp', true)"); await pg.wait_for_timeout(1500)
    check('an inward offset bigger than the shape leaves nothing (and says so)', len(await L()) == 4 and await ev("()=>/Nothing is left/.test(document.body.textContent)"))

    # ---- Level & upright
    await board()
    await clicks((0, 0), (30, 0.7), (30.6, 20)); await pg.keyboard.press('Escape')
    ls = await L(); rs = await R()
    check('a line drawn nearly level goes exactly level (and nearly upright, upright)', ls[0]['pts'] == [[0, 0], [30, 0], [30, 20]], ls)
    check('…and keeps a Flat / Upright rule', sorted(r['t'] for r in rs if r['t'] in ('flat', 'upright')) == ['flat', 'upright'], rs)
    await ev("()=>__k.movePoint(0, 2, [35, 25])")
    ls = await L()
    check('dragging later keeps them level and upright', near(ls[0]['pts'][1][1], 0) and near(ls[0]['pts'][1][0], 35), ls)
    await board('[]', 'rect')
    await clicks((0, 0), (30, 20))
    rs = await R()
    check('a rectangle stays a rectangle: 2 Flat and 2 Upright rules', sorted(r['t'] for r in rs if r['t'] in ('flat', 'upright')) == ['flat', 'flat', 'upright', 'upright'], rs)
    await ev("()=>__k.movePoint(0, 2, [40, 25])")
    ls = await L(); P = ls[0]['pts']
    check('dragging a rectangle corner keeps it square', near(P[1][1], P[0][1]) and near(P[2][0], P[1][0]) and near(P[3][1], P[2][1]) and near(P[0][0], P[3][0]) and near(P[2][0], 40), P)
    await ev("()=>{ const s=__3dj.app?.settings || null; }")
    await ev("()=>{ [...document.querySelectorAll('.sk-fold-h')].find(h=>h.textContent.includes('Snap to')).click(); }")
    await ev("()=>{ [...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Level & upright').click(); }")
    await board()
    await clicks((0, 0), (60, 1.5)); await pg.keyboard.press('Escape')
    ls = await L(); rs = await R()
    check('Level & upright off (under Snap to): no straightening, no rules', ls[0]['pts'][1][1] > 1 and not [r for r in rs if r['t'] in ('flat', 'upright')], [ls, rs])
    await ev("()=>{ [...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Level & upright').click(); [...document.querySelectorAll('.sk-fold-h')].find(h=>h.textContent.includes('Snap to')).click(); }")

    # ---- Import DXF / SVG
    await board()
    res = await ev("(t)=>__k.readDrawing('part.dxf', t)", dxf_text())
    check('DXF: lines, arcs, polylines with bulges and block circles are read; text is left out', len(res['loops']) == 6 and res['skipped'] == 1 and any(l['type'] == 'circle' and l['c'] == [10, 10] and l['r'] == 3 for l in res['loops']), res)
    await ev("(t)=>__k.importText('part.dxf', t)", dxf_text())
    check('Import asks where to put it, with what it found', await ev("()=>/6 0 × 40|120 × 40|line/.test(document.querySelector('dialog.modal').textContent)"), await ev("()=>document.querySelector('dialog.modal')?.textContent"))
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Keep its position').click()")
    ls = await L()
    plate = [l for l in ls if l['type'] == 'poly' and [0, 0] in l['pts']]
    chain = [l for l in ls if l['type'] == 'poly' and [100, 0] in l['pts']]
    check('the DXF plate is one closed outline with its round end as an arc', len(plate) == 1 and plate[0]['bulge'].count(1) == 1 and near(area(plate[0]), 60 * 40 + math.pi * 200, 1e-2), ls)
    check('lines whose ends meet join into a closed outline (line, arc, line, line)', len(chain) == 1 and not [l for l in ls if l['type'] == 'open'], ls)
    await board()
    await ev("(t)=>__k.importText('logo.svg', t)", SVG)
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Put it in the middle').click()")
    ls = await L()
    rect = [l for l in ls if l['type'] == 'poly']; circ = [l for l in ls if l['type'] == 'circle']; arc = [l for l in ls if l['type'] == 'open']
    check('SVG in mm: the rectangle (30 x 20), the circle (r 10) and an open arc', len(rect) == 1 and near(bounds(rect[0])[2] - bounds(rect[0])[0], 30) and near(bounds(rect[0])[3] - bounds(rect[0])[1], 20)
          and len(circ) == 1 and near(circ[0]['r'], 10) and len(arc) == 1 and arc[0].get('bulge') and near(abs(arc[0]['bulge'][0]), 1, 1e-6), ls)
    check('…placed with its middle on the center of the sketch', near(circ[0]['c'][0], 70 - 45) and near(circ[0]['c'][1], 27.5 - 25), circ)
    # a path that ends a hair short of its start (rounding in the file) still closes into an outline
    gap = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M10 10 L60 10 L60 40 L10 40 L10.004 10.003"/></svg>'
    r = await ev("(t)=>__k.readDrawing('gap.svg', t)", gap)
    await board(); await ev("(t)=>{ const r=__k.readDrawing('gap.svg', t); __k.addImported(r.loops, 'keep'); }", gap)
    ls = await L()
    check('an SVG outline that ends 0.004 mm short of its start is closed on import', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 4, ls)
    # several outlines that each have a hole (letters like D and A): every one becomes solid
    two = [{'type': 'poly', 'pts': [[0, 0], [30, 0], [30, 20], [0, 20]]}, {'type': 'poly', 'pts': [[5, 5], [25, 5], [25, 15], [5, 15]]},
           {'type': 'poly', 'pts': [[40, 0], [60, 0], [60, 20], [40, 20]]}, {'type': 'poly', 'pts': [[45, 5], [55, 5], [55, 15], [45, 15]]},
           {'type': 'circle', 'c': [80, 10], 'r': 8}, {'type': 'circle', 'c': [80, 10], 'r': 3}]
    vol = await ev("""async(ls)=>{ const before=new Set(__3dj.app.results.bodies.keys()); __3dj.commands.addShape('sketch', { loops: ls, h: 2 }, 'Holes');
      await new Promise(r=>setTimeout(r,300)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); await new Promise(r=>setTimeout(r,200));
      const id=[...__3dj.app.results.bodies.keys()].find(k=>!before.has(k)); return __3dj.app.results.bodies.get(id)?.volume; }""", two)
    want = 2 * ((600 - 200) + (400 - 100) + math.pi * (64 - 9))
    check('three outlines that each have a hole all become solid (none goes missing)', vol and near(vol, want, 0.5), [vol, want])
    bad = await ev("()=>{ try { __k.readDrawing('x.dxf', 'hello'); return 'no error'; } catch (e) { return e.message; } }")
    check('a file that is not a DXF says so', 'not a DXF' in bad, bad)
    # Done after an import makes the solid as usual
    await ev("()=>__k.finish()")
    if await ev("()=>!!document.querySelector('dialog.modal')"):
      await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Finish without them').click()")
    check('Done with an imported drawing finishes', await ev("()=>!!window.__done"))

    # a sketch standing on an upright face: sizing across the face (Y here) changes its height, it stays a sketch, and
    # (like any typed size) it shrinks evenly on both sides; changing Height in Properties grows it out of the face
    await ev("()=>{ document.querySelector('.sketch') && window.__k?.close(); __3dj.commands.newProject(); }"); await pg.wait_for_timeout(800)
    await ev("""()=>{ const C=__3dj.commands, A=__3dj.app; C.createSketch([{type:'poly',pts:[[-20,-10],[20,-10],[20,10],[-20,10]]}], [], {mode:'extrude', h:2, cut:false}, null);
      window.__id=A.sel[0]; A.settings.lock=false; }""")
    built = "async()=>{ await new Promise(r=>setTimeout(r,300)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); await new Promise(r=>setTimeout(r,300)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); }"
    await ev(built)
    await ev("()=>{ __3dj.store.commit((doc)=>{ const g=doc.features.find(x=>x.type==='shape'&&x.body===window.__id); g.rot=[90,0,0]; g.pos=[0,-30,20]; }); }"); await ev(built)
    box = lambda: ev("()=>__3dj.app.results.bodies.get(window.__id).bbox.map(v=>v.map(x=>Math.round(x*1000)/1000))")
    state = lambda: ev("()=>{ const f=__3dj.store.doc.features.filter(x=>x.body===window.__id); return {solid:__3dj.app.results.bodies.get(window.__id).solid, h:f[0].p.h, steps:f.length}; }")
    b0 = await box()
    await ev("()=>{ __3dj.vp.setSelection([window.__id]); __3dj.app.gizmo='scale'; __3dj.commands.barCommit(1, '5'); }"); await ev(built)
    b1, s1 = await box(), await state()
    check('a sketch standing on a face: sizing Y (across the face) changes its Height and it stays a sketch', s1 == {'solid': True, 'h': 5, 'steps': 1}, s1)
    mid = lambda b, i: round((b[0][i] + b[1][i]) / 2, 3)
    check('…it shrinks evenly on both sides: its middle and its height off the floor stay where they were', all(mid(b1, i) == mid(b0, i) for i in range(3)) and b1[1][1] - b1[0][1] == 5 and b1[0][2] == b0[0][2] and b1[1][2] == b0[1][2], [b0, b1])
    await ev("()=>__3dj.store.undo()"); await ev(built)
    await ev("()=>{ __3dj.commands.openPanel('props'); __3dj.commands.renderAll(); }"); await ev(built)
    hbox = pg.locator('#side .field', has=pg.locator('label', has_text='Height')).locator('input.in').first
    await hbox.fill('5'); await hbox.press('Enter'); await ev(built)
    b1 = await box()
    check('changing Height in Properties grows it out of the face: its back stays put (one Undo step)', b1[1][1] == b0[1][1] and b1[0][1] == b0[1][1] - 5 and b1[0][2] == b0[0][2], [b0, b1])
    await ev("()=>__3dj.store.undo()"); await ev(built)
    check('…and Undo puts it back where it was', await box() == b0, [await box(), b0])

    # the same sketch with a leftover Move step from an older version (shrunk evenly to about half, like the DEWALT logo):
    # it is taken into the sketch, Height shows the real thickness, and sizing Y changes Height (not a mesh)
    await ev("()=>{ __3dj.store.commit((doc)=>{ doc.features.push({ id:'fmv', type:'move', body:window.__id, m:[0.5,0,0,0, 0,0.5,0,0, 0,0,0.5,0, 0,10,5,1] }); }); }"); await ev(built)
    s2 = await state()
    check('a leftover even resize (Move step) is taken into the sketch: one step, Height = its real thickness', s2['steps'] == 1 and s2['solid'] and abs(s2['h'] - 1) < 1e-3, s2)
    b2 = await box()
    await ev("()=>{ __3dj.vp.setSelection([window.__id]); __3dj.app.gizmo='scale'; __3dj.commands.barCommit(1, '3'); }"); await ev(built)
    s3, b3 = await state(), await box()
    check('…then sizing Y changes its Height and it stays a sketch, its middle where it was', s3 == {'solid': True, 'h': 3, 'steps': 1} and abs(mid(b3, 1) - mid(b2, 1)) < 1e-3, [s3, b2, b3])

    check('no page errors', not errs, errs)
    await b.close()
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad: raise SystemExit(1)

if __name__ == "__main__":
  asyncio.run(main())
