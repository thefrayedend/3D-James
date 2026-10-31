# Sizing keeps an object where it is: a size typed in the bottom bar, or dragging an X or Y size arrow with the mouse,
# changes both sides the same (take 1 mm off X and each side loses 0.5 mm), for plain shapes, shapes turned on their
# side, and combined objects. Z keeps the bottom still, so an object on the floor stays on it.
#   python tests/sizing.py
import asyncio, os
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
  // a fresh object of the given kind, turned and placed, picked with the Size handles
  window.__make = async (kind, rot, combined) => { const { commands: C, store: S, app, vp } = window.__3dj;
    C.newProject(); await __wait(); const id = C.addShape(kind); await __wait();
    S.commit((d) => { const f = d.features.find((x) => x.body === id); f.rot = rot; f.pos = [5, -7, 0]; }); await __wait();
    if (combined) { const t = C.addShape('box', { w: 6, d: 6, h: 6 }); await __wait(); app.sel = [id, t]; vp.setSelection(app.sel); C.combine('union'); await __wait(); }
    app.settings.lock = false; app.sel = [id]; vp.setSelection([id]); C.setGizmo('scale'); await __wait(); return id; };
'''
MID = lambda b, i: (b[0][i] + b[1][i]) / 2

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto(Path(os.environ.get('TDJ_APP', ROOT / 'local/3DJames.html')).as_uri())
    await pg.wait_for_function(READY, timeout=120000)
    await pg.evaluate('()=>{' + JS + '}')
    ev = pg.evaluate

    # 1. typed sizes: 1 mm off X, Y or Z for shapes standing and turned on their side
    for kind, rot, combined in [('box', [0, 0, 0], False), ('cyl', [90, 0, 0], False), ('cone', [0, 90, 0], False), ('text', [90, 0, 90], False), ('box', [0, 0, 0], True)]:
      for ax in range(3):
        r = await ev('''async ([kind, rot, combined, ax]) => { const { commands: C } = window.__3dj; const id = await __make(kind, rot, combined);
          const b0 = __box(id), n = b0[1][ax] - b0[0][ax]; C.barCommit(ax, String(n - 1)); await __wait(); return [b0, __box(id)]; }''', [kind, rot, combined, ax])
        b0, b1 = r
        same = all(abs(MID(b1, i) - MID(b0, i)) < 0.02 for i in (0, 1)) and abs(b1[0][2] - b0[0][2]) < 0.02
        size = abs((b1[1][ax] - b1[0][ax]) - (b0[1][ax] - b0[0][ax] - 1)) < 0.03
        check(f'typed size, 1 mm off {"XYZ"[ax]}: {kind} turned {rot}{" (combined)" if combined else ""} stays put', same and size, r)

    # 2. the size arrows, dragged with the real mouse
    async def drag(id, ax, sign, px):
      at = await ev('''([ax, sign]) => { const it = window.__3dj.vp.hudItems.find((x) => x.data.type === 'face' && x.data.ax === ax && x.data.sign === sign && x.el.style.display !== 'none');
        if (!it) return null; const r = it.el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }''', [ax, sign])
      if not at: return None
      b0 = await ev('(id) => __box(id)', id)
      await pg.mouse.move(*at); await pg.mouse.down()
      for k in range(1, 11): await pg.mouse.move(at[0] + px[0] * k / 10, at[1] + px[1] * k / 10)
      await pg.mouse.up(); await ev('() => __wait()')
      return [b0, await ev('(id) => __box(id)', id)]

    for kind, rot, combined in [('box', [0, 0, 0], False), ('cyl', [90, 0, 0], False), ('box', [0, 0, 0], True)]:
      id = await ev('([k, r, c]) => __make(k, r, c)', [kind, rot, combined])
      # the right-hand X arrow, pulled in toward the middle
      r = await drag(id, 0, 1, (-40, 0))
      ok = r and r[1][1][0] - r[1][0][0] < r[0][1][0] - r[0][0][0] - 1 and abs(MID(r[1], 0) - MID(r[0], 0)) < 0.02 and abs(MID(r[1], 1) - MID(r[0], 1)) < 0.02 and abs(r[1][0][2] - r[0][0][2]) < 0.02
      check(f'X size arrow dragged in: {kind} turned {rot}{" (combined)" if combined else ""} gets narrower on both sides, its middle stays', ok, r)
      id = await ev('([k, r, c]) => __make(k, r, c)', [kind, rot, combined])
      r = await drag(id, 2, 1, (0, -40))
      ok = r and r[1][1][2] - r[1][0][2] > r[0][1][2] - r[0][0][2] + 1 and abs(r[1][0][2] - r[0][0][2]) < 0.02 and abs(MID(r[1], 0) - MID(r[0], 0)) < 0.02
      check(f'top size arrow dragged up: {kind} turned {rot}{" (combined)" if combined else ""} gets taller, its bottom stays on the floor', ok, r)

    check('no page errors', not errors, errors)
    await b.close()
  print(f'\n{"all passed" if not fails else f"{len(fails)} failed"}')
  if fails: raise SystemExit(1)

asyncio.run(main())
