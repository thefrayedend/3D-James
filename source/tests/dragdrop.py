# Shapes dragged from the Insert toolbar land where you let go (on the floor or on top of an object), like 3D Builder;
# a click still adds them beside what is there. Mouse and finger. Run after build.py:  python tests/dragdrop.py
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()
WAIT = "async()=>{ for (let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,250)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); } }"


async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, has_touch=True); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building', timeout=120000)
    ev = pg.evaluate; W = lambda: ev(WAIT)
    results = []
    def check(name, ok, info=''):
      results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:400]), flush=True)
    async def screen(x, y, z): return await ev(f"()=>{{ const v=__3dj.vp.toScreen(new __3dj.vp.camera.position.constructor({x},{y},{z})); return [v.x, v.y]; }}")
    bodies = lambda: ev("()=>[...__3dj.app.results.bodies.values()].map(d=>({min:d.bbox[0].map(v=>Math.round(v*10)/10), max:d.bbox[1].map(v=>Math.round(v*10)/10)}))")
    async def press(label):
      bb = await pg.locator('#cmdbar .cb', has_text=label).first.bounding_box()
      return bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    async def mouse_drag(label, to, release=True):
      x0, y0 = await press(label)
      await pg.mouse.move(x0, y0); await pg.mouse.down()
      for k in range(1, 11): await pg.mouse.move(x0 + (to[0] - x0) * k / 10, y0 + (to[1] - y0) * k / 10); await pg.wait_for_timeout(20)
      if release: await pg.mouse.up(); await W()

    await ev("()=>__3dj.commands.newProject()"); await W()
    await mouse_drag('Cube', await screen(30, 10, 0), release=False)
    ghost = await ev("()=>{ const g=__3dj.vp.dropGhost; return g && g.parent ? [g.position.x, g.position.y].map(v=>Math.round(v)) : null; }")
    check('while dragging, a see-through shape shows where it will land (under the pointer), and a label follows it', ghost and abs(ghost[0] - 30) <= 4 and abs(ghost[1] - 10) <= 4 and await ev("()=>!!document.querySelector('.drag-chip')"), ghost)
    await pg.mouse.up(); await W()
    bs = await bodies()
    mid = [round((bs[0]['min'][i] + bs[0]['max'][i]) / 2) for i in (0, 1)] if bs else None
    check('the cube lands exactly where the see-through shape was, on the floor', len(bs) == 1 and mid == ghost and bs[0]['min'][2] == 0 and bs[0]['max'][2] == 20, [bs, ghost])
    check('nothing is left on screen after the drop', not await ev("()=>!!document.querySelector('.drag-chip') || !!__3dj.vp.dropGhost?.parent"))
    await mouse_drag('Cylinder', await screen(30, 10, 20))
    c = (await bodies())[-1]
    check('a cylinder dropped on top of the cube stands on its top', c['min'][2] == 20 and abs(c['min'][0] - bs[0]['min'][0]) <= 4, c)
    await pg.locator('#cmdbar .cb', has_text='Torus').first.click(); await W()
    t = (await bodies())[-1]
    check('a plain click still adds the shape beside what is there', len(await bodies()) == 3 and t['min'][0] > 40, t)
    await ev("()=>__3dj.store.undo()"); await W()
    check('one Undo takes the added shape away again', len(await bodies()) == 2)
    # a finger works the same way
    cdp = await ctx.new_cdp_session(pg)
    to = await screen(-30, -20, 0); x0, y0 = await press('Cone')
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
    for k in range(1, 16):
      await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (to[0] - x0) * k / 15, 'y': y0 + (to[1] - y0) * k / 15}]}); await pg.wait_for_timeout(25)
    fghost = await ev("()=>{ const g=__3dj.vp.dropGhost; return g && g.parent ? [g.position.x, g.position.y].map(v=>Math.round(v)) : null; }")
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await W()
    c = (await bodies())[-1]
    fmid = [round((c['min'][i] + c['max'][i]) / 2) for i in (0, 1)]
    check('a finger drags a shape in from the toolbar the same way (lands where the preview was, near the finger)', len(await bodies()) == 3 and fmid == fghost and abs(fmid[0] + 30) <= 4 and abs(fmid[1] + 20) <= 4, [c, fghost])
    check('no page errors', not errs, errs)
    await b.close()
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad: raise SystemExit(1)

if __name__ == '__main__':
  asyncio.run(main())
