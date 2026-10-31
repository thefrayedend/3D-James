# Importing other programs' files: 3MF parts keep where they were and come in as one undo step (or not at all when
# one part is bad), the main model of a 3MF is the one its _rels/.rels names (and parts kept in other model files, as
# Bambu Studio and PrusaSlicer save them, are found), bad 3MF coordinates and units are refused, OBJ faces with a dent
# are filled properly, and Make editable never puts its result into a project that changed while it worked.
#   python tests/imports.py
import asyncio, base64, io, json, os, zipfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {info}'))
  if not ok: fails.append(name)

# a 10 mm cube; T[:-2] leaves a hole in it (not a closed solid)
V = [(0,0,0),(10,0,0),(10,10,0),(0,10,0),(0,0,10),(10,0,10),(10,10,10),(0,10,10)]
T = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
def mesh(tris=T): return '<mesh><vertices>' + ''.join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in V) + '</vertices><triangles>' + ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris) + '</triangles></mesh>'
def model(items, objects, unit='millimeter', extra=''):
  return f'<model unit="{unit}" {NS} {extra}><resources>{objects}</resources><build>{items}</build></model>'
TWO = model('<item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 0 20"/>', f'<object id="1" type="model" name="A">{mesh()}</object><object id="2" type="model" name="B">{mesh()}</object>')
BAD = model('<item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 0 20"/>', f'<object id="1" type="model" name="A">{mesh()}</object><object id="2" type="model" name="B">{mesh(T[:-2])}</object>')
RELS = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="/{}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
def archive(parts, root='3D/3dmodel.model'):
  b = io.BytesIO()
  with zipfile.ZipFile(b, 'w') as z:
    z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    for name, xml in parts: z.writestr(name, xml)
    z.writestr('_rels/.rels', RELS.format(root))
  return base64.b64encode(b.getvalue()).decode()
# as Bambu Studio saves: the main model holds only components that point into 3D/Objects/object_1.model
PROD = 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"'
BAMBU = [('3D/Objects/object_1.model', model('', f'<object id="1" type="model">{mesh()}</object><object id="2" type="model">{mesh()}</object>')),
         ('3D/3dmodel.model', model('<item objectid="3"/><item objectid="4" transform="1 0 0 0 1 0 0 0 1 0 40 5"/>',
           '<object id="3" type="model" name="Bracket"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>'
           '<object id="4" type="model" name="Lid"><components><component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 10"/></components></object>', extra=PROD))]

JS_HELPERS = '''
  window.__wait = async () => { const { app, store: S } = window.__3dj; const t = Date.now();
    while (app.building || app.pending || app.builtRevision !== S.revision) { if (Date.now() - t > 120000) throw Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
  window.__bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  window.__fresh = async () => { window.__3dj.commands.newProject(); await __wait(); };
  window.__boxes = () => Object.fromEntries([...window.__3dj.app.results.bodies].map(([id, b]) => [window.__3dj.store.doc.bodies[id].name, b.bbox]));
'''

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    c = await b.new_context(viewport={'width': 1440, 'height': 900})
    # hold back the engine's answer to Make editable when asked (window.__hold), to open another project meanwhile
    await c.add_init_script('''const NW = Worker; window.Worker = class extends NW { constructor(...a) { super(...a);
      this.addEventListener('message', (e) => { if (window.__hold && e.data.type === 'converted') { e.stopImmediatePropagation(); window.__held = { w: this, data: e.data }; } }); } };''')
    pg = await c.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto(Path(os.environ.get('TDJ_APP', ROOT / 'local/3DJames.html')).as_uri())  # TDJ_APP: try another build
    await pg.wait_for_function(READY, timeout=120000)
    await pg.evaluate('()=>{' + JS_HELPERS + '}')
    ev = pg.evaluate

    # 1. two parts of a 3MF: where they were relative to each other, one undo step, both selected
    r = await ev('''async (s) => { const { commands: C, store: S, app } = window.__3dj; await __fresh(); const u = S.undoStack.length;
      const ok = await C.insertFile(new File([__bytes(s)], 'two.3mf')); await __wait();
      return { ok, boxes: __boxes(), undo: S.undoStack.length - u, sel: app.sel.length }; }''', archive([('3D/3dmodel.model', TWO)]))
    a, bb = r['boxes'].get('A'), r['boxes'].get('B')
    d = [round((bb[0][i] + bb[1][i]) / 2 - (a[0][i] + a[1][i]) / 2, 3) for i in range(3)] if a and bb else None
    check('3MF parts keep their places relative to each other (30 mm across, 20 mm up)', d == [30, 0, 20], r)
    check('the group sits on the floor', a and min(a[0][2], bb[0][2]) == 0, r)
    check('a two-part 3MF is one undo step and both parts end up selected', r['ok'] and r['undo'] == 1 and r['sel'] == 2, r)
    r = await ev('''async () => { const { store: S } = window.__3dj; S.undo(); await __wait(); return Object.keys(S.doc.bodies).length; }''')
    check('one Undo takes the whole 3MF back out', r == 0, r)

    # 2. a 3MF with one bad part changes nothing (Insert and Open)
    r = await ev('''async (s) => { const { commands: C, store: S } = window.__3dj; await __fresh(); C.addShape('box', { w: 20, d: 20, h: 5 }); await __wait();
      const before = JSON.stringify(S.doc), u = S.undoStack.length;
      const ok = await C.insertFile(new File([__bytes(s)], 'bad.3mf')); await __wait();
      return { ok, same: JSON.stringify(S.doc) === before, undo: S.undoStack.length - u }; }''', archive([('3D/3dmodel.model', BAD)]))
    check('Insert of a 3MF with a bad second part fails and leaves the project and Undo as they were', r['ok'] is False and r['same'] and r['undo'] == 0, r)
    r = await ev('''async (s) => { const { commands: C, store: S, app } = window.__3dj; const before = JSON.stringify(S.doc), file = app.file;
      await C.openFile(new File([__bytes(s)], 'bad.3mf'), null); await __wait();
      return { same: JSON.stringify(S.doc) === before, file: app.file === file }; }''', archive([('3D/3dmodel.model', BAD)]))
    check('Open of the same 3MF also leaves the open project alone', r['same'] and r['file'], r)

    # 3. the main model is the one _rels/.rels names, even when another comes first in the ZIP
    wrong = TWO.replace('30 0 20', '90 0 20')
    r = await ev('''(s) => { const enc = new TextEncoder(); const m = window.__3dj.commands.parse3mf(new Map([['3D/other.model', enc.encode(s[0])], ['3D/main.model', enc.encode(s[1])],
      ['_rels/.rels', enc.encode(s[2])]])); return m[1].verts[0]; }''', [wrong, TWO, RELS.format('3D/main.model')])
    check('the 3MF model named in _rels/.rels is read, not the first one in the ZIP', r == 30, r)

    # 4. Bambu / Prusa style: parts in their own model file, opened with the real Open
    r = await ev('''async (s) => { const { commands: C } = window.__3dj; await __fresh(); C.openFile(new File([__bytes(s)], 'plate.3mf'), null);
      const t = Date.now(); while (!document.querySelector('.modal') && Date.now() - t < 60000) await new Promise((r) => setTimeout(r, 50));
      [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Keep as a mesh')?.click(); await __wait(); return __boxes(); }''', archive(BAMBU))
    br, lid = r.get('Bracket'), r.get('Lid')
    d = [round((lid[0][i] + lid[1][i]) / 2 - (br[0][i] + br[1][i]) / 2, 3) for i in range(3)] if br and lid else None
    check('a Bambu Studio style 3MF (parts in 3D/Objects) opens with both parts in place', d == [0, 40, 15], r)

    # 5. bad numbers in a 3MF are refused, not guessed
    for name, xml, want in [('a missing coordinate', TWO.replace(' x="10"', '', 1), 'coordinate'),
                            ('a blank coordinate', TWO.replace('y="10"', 'y=""', 1), 'coordinate'),
                            ('an unknown unit', TWO.replace('unit="millimeter"', 'unit="furlong"'), 'unit'),
                            ('two objects with one number', TWO.replace('id="2"', 'id="1"'), 'two objects')]:
      r = await ev('''(s) => { try { window.__3dj.commands.parse3mf(new Map([['3D/3dmodel.model', new TextEncoder().encode(s)]])); return 'accepted'; } catch (e) { return e.message; } }''', xml)
      check(f'a 3MF with {name} is refused with a clear message', want in r, r)
    r = await ev('''() => window.__3dj.commands.parse3mf(new Map([['3D/3dmodel.model', new TextEncoder().encode(%s)]]))[0].verts[3]''' % json.dumps(TWO.replace('millimeter', 'inch')))
    check('a 3MF in inches is still scaled to mm', abs(r - 254) < 1e-3, r)

    # 6. OBJ faces with a dent (an L or arrow shape), as a real import: the right volume
    obj = ''.join(f'v {x} {y} {z}\n' for z in (0, 4) for x, y in [(0,0),(30,0),(30,30),(20,10),(0,30)])
    obj += 'f 5 4 3 2 1\nf 6 7 8 9 10\n' + ''.join(f'f {k+1} {(k+1)%5+1} {(k+1)%5+6} {k+6}\n' for k in range(5))
    r = await ev('''async (s) => { const { commands: C, app } = window.__3dj; await __fresh(); const ok = await C.insertFile(new File([s], 'arrow.obj')); await __wait();
      // what Save as STL writes: the volume, and the area its top triangles cover, counted without signs so a
      // triangle folded back over the dent shows up (the dented outline is 600 mm2, 4 mm thick)
      const dv = new DataView((await C.buildFileData('stl')).buffer); let vol = 0, top = 0;
      for (let t = 0, n = dv.getUint32(80, true); t < n; t++) { const p = [0, 1, 2].map((k) => [0, 1, 2].map((i) => dv.getFloat32(84 + t * 50 + 12 + k * 12 + i * 4, true)));
        vol += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
        if (p.every((q) => Math.abs(q[2] - p[0][2]) < 1e-4 && q[2] > 2)) top += Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2; }
      return { ok, vol, top, err: Object.values(app.results.errors || {}) }; }''', obj)
    check('an OBJ with dented faces imports right: 2400 mm3, the top covering just its 600 mm2', r['ok'] and not r['err'] and abs(r['vol'] - 2400) < 0.1 and abs(r['top'] - 600) < 0.1, r)

    # 7. Make editable: a result that comes back after another project was opened is dropped
    r = await ev('''async () => { const { commands: C, store: S, app } = window.__3dj; await __fresh();
      C.addShape('box', { w: 10, d: 10, h: 10 }); await __wait(); const stl = await C.buildFileData('stl'); await __fresh();
      await C.insertFile(new File([stl], 'race-cube.stl')); await __wait();
      window.__held = null; window.__hold = true; window.__conv = C.makeEditable([...app.results.bodies.keys()][0], { quiet: true });
      const t = Date.now(); while (!window.__held && Date.now() - t < 120000) await new Promise((r) => setTimeout(r, 50));
      await __fresh(); C.addShape('box', { w: 77, d: 22, h: 11 }); await __wait(); const before = JSON.stringify(S.doc);
      window.__hold = false; __held.w.dispatchEvent(new MessageEvent('message', { data: __held.data }));
      const done = await __conv; await __wait();
      return { done, same: JSON.stringify(S.doc) === before, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ') }; }''')
    check('Make editable finishing after New project leaves the new project alone and says so', r['done'] is False and r['same'] and 'nothing was changed' in r['toast'], r)
    r = await ev('''async () => { const { commands: C, store: S, app } = window.__3dj; await __fresh();
      C.addShape('box', { w: 10, d: 10, h: 10 }); await __wait(); const stl = await C.buildFileData('stl'); await __fresh();
      await C.insertFile(new File([stl], 'cube.stl')); await __wait(); const id = [...app.results.bodies.keys()][0];
      window.__held = null; window.__hold = true; window.__conv = C.makeEditable(id, { quiet: true });
      const t = Date.now(); while (!window.__held && Date.now() - t < 120000) await new Promise((r) => setTimeout(r, 50));
      S.commit((d) => { d.features[0].pos = [15, 0, 0]; }); await __wait(); const before = JSON.stringify(S.doc);
      window.__hold = false; __held.w.dispatchEvent(new MessageEvent('message', { data: __held.data }));
      const done = await __conv; await __wait(); return { done, same: JSON.stringify(S.doc) === before }; }''')
    check('Make editable finishing after the mesh was moved leaves it as it is', r['done'] is False and r['same'], r)
    r = await ev('''async () => { const { commands: C, store: S, app } = window.__3dj; await __fresh();
      C.addShape('box', { w: 10, d: 10, h: 10 }); await __wait(); const stl = await C.buildFileData('stl'); await __fresh();
      await C.insertFile(new File([stl], 'cube.stl')); await __wait(); const u = S.undoStack.length;
      const done = await C.makeEditable([...app.results.bodies.keys()][0], { quiet: true }); await __wait();
      return { done, kinds: S.doc.features.map((f) => f.kind), undo: S.undoStack.length - u }; }''')
    check('Make editable left alone still works, as one undo step', r['done'] is True and 'import' not in r['kinds'] and r['undo'] == 1, r)

    check('no page errors', not errors, errors)
    await b.close()
  print(f'\n{"All passed" if not fails else f"{len(fails)} failed"}')
  raise SystemExit(1 if fails else 0)

asyncio.run(main())
