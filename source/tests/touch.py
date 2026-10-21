# Touch screens and pens (tablets, the Apple Pencil): real touch and pen events through Chrome's DevTools protocol.
# Fingers: touch mode switches on, taps pick, hold-then-drag moves an object, swipes and pinches move the camera,
# double tap flies in; in the sketch a finger draws by touch-slide-lift and two fingers slide and zoom the board.
# Pen: works like the mouse (exact), and a palm on the screen while the pen is used is ignored.
# The mouse is unchanged (the other test suites check that). Run after build.py:  python tests/touch.py
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1180, 'height': 820}, has_touch=True)
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    cdp = await ctx.new_cdp_session(pg)
    ev = pg.evaluate
    results = []
    def check(name, ok, info=''):
      results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:400]), flush=True)
    async def touch(kind, pts):
      await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i, 'radiusX': 6, 'radiusY': 6, 'force': 1} for i, (x, y) in pts]})
    async def tap(x, y, hold=0):
      await touch('touchStart', [(1, (x, y))]); await pg.wait_for_timeout(60 + hold); await touch('touchEnd', [])
      await pg.wait_for_timeout(120)
    async def swipe(pts_from, pts_to, steps=10, hold=0):
      ids = list(range(1, len(pts_from) + 1))
      await touch('touchStart', list(zip(ids, pts_from)))
      if hold: await pg.wait_for_timeout(hold)
      for k in range(1, steps + 1):
        await touch('touchMove', [(i, (a[0] + (c[0] - a[0]) * k / steps, a[1] + (c[1] - a[1]) * k / steps)) for i, a, c in zip(ids, pts_from, pts_to)])
        await pg.wait_for_timeout(16)
      await touch('touchEnd', []); await pg.wait_for_timeout(150)
    async def pen(kind, x, y, buttons=1):
      await cdp.send('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left' if kind != 'mouseMoved' else 'none', 'buttons': buttons, 'clickCount': 1, 'pointerType': 'pen'})

    # ---------------------------------------------------------------- touch mode switches on by itself
    await ev("async()=>{ const C=__3dj.commands; C.newProject(); await new Promise(r=>setTimeout(r,600)); }")
    await pg.mouse.click(600, 120)
    check('touch mode is off after using the mouse', not await ev("()=>document.body.classList.contains('touch-ui')"))
    await tap(600, 120)
    check('a finger switches touch mode on (bigger buttons, on-screen keys)', await ev("()=>document.body.classList.contains('touch-ui')"))
    big = await ev("()=>document.querySelector('#cmdbar .cb').getBoundingClientRect().height")
    check('ribbon buttons are finger-sized (46 px or more)', big >= 45.5, big)

    # ---------------------------------------------------------------- 3D: tap, hold-and-drag, swipe, pinch, double tap
    a = await ev("""async()=>{ const C=__3dj.commands, A=__3dj.app; const id=C.addShape('box',{w:30,d:30,h:30});
      for(let i=0;i<300 && (A.building||A.pending||A.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50));
      __3dj.vp.view('home', false); await new Promise(r=>setTimeout(r,300)); C.selectNone?.(); return id; }""")
    await pg.wait_for_timeout(300)
    async def screen_of(id):
      # a spot on the screen where this object is in front (its middle may be hidden behind another one)
      return await ev("""(id)=>{ const vp=__3dj.vp, d=__3dj.app.results.bodies.get(id), r=vp.renderer.domElement.getBoundingClientRect();
        const c=new (vp.camera.position.constructor)((d.bbox[0][0]+d.bbox[1][0])/2,(d.bbox[0][1]+d.bbox[1][1])/2,(d.bbox[0][2]+d.bbox[1][2])/2).project(vp.camera);
        const x0=r.left+(c.x+1)/2*r.width, y0=r.top+(1-c.y)/2*r.height;
        for (let rad=0; rad<160; rad+=6) for (let a=0; a<6.28; a+=0.5) { const x=x0+Math.cos(a)*rad, y=y0+Math.sin(a)*rad; if (vp.hitBody({clientX:x, clientY:y})?.object.userData.bodyId===id) return [x,y]; }
        return [x0,y0]; }""", id)
    def screen_of_old(id):
      return ev("(id)=>{ const vp=__3dj.vp, d=__3dj.app.results.bodies.get(id); const c=new (vp.camera.position.constructor)((d.bbox[0][0]+d.bbox[1][0])/2,(d.bbox[0][1]+d.bbox[1][1])/2,(d.bbox[0][2]+d.bbox[1][2])/2).project(vp.camera); const r=vp.renderer.domElement.getBoundingClientRect(); return [r.left+(c.x+1)/2*r.width, r.top+(1-c.y)/2*r.height]; }", id)
    x, y = await screen_of(a)
    await ev("()=>{ __3dj.app.sel=[]; __3dj.commands.renderAll(); __3dj.vp.setSelection([]); }")
    await tap(x, y)
    check('a tap on an object picks it', await ev("(id)=>JSON.stringify(__3dj.app.sel)===JSON.stringify([id])", a), await ev("()=>__3dj.app.sel"))
    cam0 = await ev("()=>__3dj.vp.camera.position.toArray()")
    pos0 = await ev("(id)=>__3dj.app.results.bodies.get(id).bbox[0]", a)
    await swipe([(x, y)], [(x + 120, y + 10)])
    await pg.wait_for_timeout(400)
    cam1 = await ev("()=>__3dj.vp.camera.position.toArray()")
    pos1 = await ev("(id)=>__3dj.app.results.bodies.get(id).bbox[0]", a)
    check('a quick swipe (even starting on an object) turns the camera, the object stays', cam0 != cam1 and pos0 == pos1, [cam0, cam1, pos0, pos1])
    x, y = await screen_of(a)
    await swipe([(x, y)], [(x + 90, y)], hold=550)
    for _ in range(100):
      if await ev("(id)=>{ const A=__3dj.app; return !A.building && !A.pending && A.builtRevision===__3dj.store.revision; }", a): break
      await pg.wait_for_timeout(50)
    pos2 = await ev("(id)=>__3dj.app.results.bodies.get(id).bbox[0]", a)
    check('touch, hold, then drag moves the object', ((pos2[0] - pos1[0]) ** 2 + (pos2[1] - pos1[1]) ** 2) ** 0.5 > 3, [pos1, pos2])
    d0 = await ev("()=>__3dj.vp.camera.position.distanceTo(__3dj.vp.orbit.target)")
    await swipe([(500, 400), (700, 400)], [(420, 400), (780, 400)])
    d1 = await ev("()=>__3dj.vp.camera.position.distanceTo(__3dj.vp.orbit.target)")
    check('two fingers pinched apart zoom in', d1 < d0 * 0.95, [d0, d1])
    x, y = await screen_of(a)
    await ev("()=>{ window.__dbl=[]; const h=__3dj.vp.hooks, f=h.onDoubleClick; h.onDoubleClick=(id)=>{ __dbl.push(id); f(id); }; }")
    await ev("()=>{ window.__tl=[]; const c=__3dj.vp.renderer.domElement; for (const k of ['pointerdown','pointerup','pointercancel']) c.addEventListener(k, e=>__tl.push(k+'@'+Math.round(e.timeStamp)+':'+e.pointerType), true); }")
    # two quick taps, sent back to back (this test machine draws slowly; a real double tap is about 0.2 s)
    pt = [{'x': x, 'y': y, 'id': 1}]
    await asyncio.gather(*[cdp.send('Input.dispatchTouchEvent', {'type': k, 'touchPoints': pt if k == 'touchStart' else []}) for k in ('touchStart', 'touchEnd', 'touchStart', 'touchEnd')])
    await pg.wait_for_timeout(800)
    dbl = await ev("()=>__dbl")
    if not dbl: print('DBL DEBUG', await ev("()=>__tl"), x, y, await ev("([x,y])=>__3dj.vp.hitBody({clientX:x,clientY:y})?.object.userData.bodyId", [x, y]), await ev("()=>__3dj.vp.mode"))
    check('a double tap on an object flies in to it (once)', dbl == [a], dbl)
    # Pick more: the on-screen key stands in for Ctrl
    b2 = await ev("""async()=>{ const C=__3dj.commands, A=__3dj.app; const id=C.addShape('cyl'); for(let i=0;i<300 && (A.building||A.pending||A.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50)); __3dj.vp.view('fit', false); await new Promise(r=>setTimeout(r,400)); return id; }""")
    x, y = await screen_of(a); await tap(x, y)
    bx = await ev("()=>{ const r=document.querySelector('.touch-key').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]; }")
    await tap(*bx)
    x, y = await screen_of(b2); await tap(x, y)
    check('with "Pick more" on, a second tap adds to the selection', await ev("(ids)=>ids.every(i=>__3dj.app.sel.includes(i)) && __3dj.app.sel.length===2", [a, b2]), await ev("()=>__3dj.app.sel"))
    await tap(*bx)

    # ---------------------------------------------------------------- sketch: draw with a finger, two fingers slide and zoom
    await ev("async()=>{ window.__k = __3dj.commands.openSketch([], ()=>{}); await new Promise(r=>setTimeout(r,300)); __k.setTool('line'); }")
    at = lambda x, y: ev(f"()=>__k.screenOf([{x},{y}])")
    for q in [(0, 0), (30, 0), (30, 20)]:
      await tap(*(await at(*q)))
    check('finger taps draw a line', await ev("()=>__k.drawing && __k.drawing.pts.length===3"), await ev("()=>JSON.stringify(__k.drawing)"))
    s0 = await ev("()=>__k.screenOf([10,0])")
    c = await at(15, 10)
    await swipe([(c[0] - 60, c[1]), (c[0] + 60, c[1])], [(c[0] - 120, c[1]), (c[0] + 120, c[1])])
    s1 = await ev("()=>__k.screenOf([10,0])")
    n = await ev("()=>__k.drawing.pts.length")
    check('two fingers zoom the board and add no points', abs(s1[0] - s0[0]) > 5 and n == 3, [s0, s1, n])
    st = await at(-20, 30); en = await at(0.2, 20.2)
    await swipe([st], [en], steps=8)
    d = await ev("()=>JSON.parse(JSON.stringify(__k.drawing?.pts || __k.loops.at(-1).pts))")
    check('touch, slide, lift: the point goes where the finger was lifted (snapped)', [0, 20] in d, d)
    await tap(*(await at(0, 0)))
    check('a finger tap on the start closes the outline', await ev("()=>!__k.drawing && __k.loops.some(l=>l.type==='poly')"), await ev("()=>JSON.stringify(__k.loops)"))
    # the number pad stands in for typing
    await ev("()=>{ document.querySelector('.sketch [title=\"Fit everything in view\"]').click(); __k.setTool('line'); }"); await pg.wait_for_timeout(200)
    cc = await ev("()=>{ const r=document.querySelector('.sk-svg').getBoundingClientRect(); return [r.x+r.width*0.3, r.y+r.height*0.35]; }")
    await tap(*cc)
    pad = await ev("()=>{ const b=[...document.querySelectorAll('.sketch .cb')].find(x=>x.textContent==='123'); const r=b.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]; }")
    await tap(*pad)
    await pg.fill('.sk-pad', '25'); await pg.keyboard.press('Enter')
    check('the 123 pad types a length (a 25 mm line)', await ev("()=>{ const p=__k.drawing?.pts; return p && p.length===2 && Math.abs(Math.hypot(p[1][0]-p[0][0], p[1][1]-p[0][1]) - 25) < 1e-6; }"), await ev("()=>JSON.stringify(__k.drawing)"))
    await ev("()=>__k.setTool('select')")

    # ---------------------------------------------------------------- pen (Apple Pencil): exact like a mouse; palm ignored
    await ev("async()=>{ __k.close(); window.__k = __3dj.commands.openSketch([], ()=>{}); await new Promise(r=>setTimeout(r,300)); __k.setTool('line'); }")
    for q in [(0, 0), (20, 0)]:
      x, y = await at(*q)
      await pen('mouseMoved', x, y, 0); await pen('mousePressed', x, y); await pen('mouseReleased', x, y, 0); await pg.wait_for_timeout(80)
    check('the pen draws points where it touches', await ev("()=>__k.drawing && __k.drawing.pts.length===2"), await ev("()=>JSON.stringify(__k.drawing)"))
    x, y = await at(10, 25)
    await pen('mouseMoved', x, y, 0)
    await tap(*(await at(40, -20)))
    check('a palm touching the screen while the pen is used is ignored', await ev("()=>__k.drawing && __k.drawing.pts.length===2"), await ev("()=>JSON.stringify(__k.drawing)"))
    await ev("()=>__k.close()")

    # ---------------------------------------------------------------- View > Touch: off
    await ev("()=>{ __3dj.app.settings.inputMode='mouse'; }")
    await ev("async()=>{ (await import(location.href).catch(()=>null)); }")
    await ev("()=>{ document.body.classList.remove('touch-ui'); }")
    await tap(600, 120)
    check('Touch: off keeps the mouse layout even after a finger', not await ev("()=>document.body.classList.contains('touch-ui')"))
    await ev("()=>{ __3dj.app.settings.inputMode='auto'; }")

    for e in errs: print('PAGE', e[:300])
    n = sum(ok for _, ok in results)
    print(f'{n}/{len(results)} passed, {len(errs)} page errors')
    await b.close()
    raise SystemExit(0 if n == len(results) and not errs else 1)

asyncio.run(main())
