# Move arrows: one on every side of the picked object, the side ones at its middle height (never down on the floor),
# each moving the object along its own direction. Real mouse drags. Run after build.py:  python tests/movearrows.py
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()
WAIT = "async()=>{ for (let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,250)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); } }"


async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1100, 'height': 700}, has_touch=True); pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building', timeout=120000)
    ev = pg.evaluate; W = lambda: ev(WAIT)
    results = []
    def check(name, ok, info=''):
      results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:400]), flush=True)
    await ev("()=>__3dj.commands.newProject()"); await W()
    await ev("()=>{ __3dj.app.settings.panelOpen=false; __3dj.app.settings.grid=1; __3dj.commands.addShape('box', { w: 80, d: 35, h: 40 }); }"); await W()
    await pg.keyboard.press('f'); await W(); await pg.wait_for_timeout(600)
    mid = lambda: ev("()=>{ const d=[...__3dj.app.results.bodies.values()][0]; return [0,1,2].map(i=>Math.round((d.bbox[0][i]+d.bbox[1][i])/2*10)/10); }")
    arrows = lambda: ev("""()=>[...document.querySelectorAll('.hud svg.hmove')].map(e=>{ const g=e.querySelector('path.grab'), r=g.getBoundingClientRect();
      return { ax:+e.dataset.ax, sign:+e.dataset.sign, shown:e.style.display!=='none', x:r.x+r.width/2, y:r.y+r.height/2 }; })""")
    start_view = await ev("()=>{ const vp=__3dj.vp; return [vp.camera.position.toArray(), vp.orbit.target.toArray()]; }")
    arr = await arrows()
    check('six move arrows: top, bottom, left, right, front, back', len(arr) == 6 and sorted((a['ax'], a['sign']) for a in arr) == [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)], arr)
    shown = [a for a in arr if a['shown']]
    check('from above: top, left, right and front can be seen (the bottom is under it, the back behind it)', len(shown) >= 4 and {(2, 1), (0, 1), (0, -1)} <= {(a['ax'], a['sign']) for a in shown}, arr)
    # each side arrow sits at that side's middle height on screen, not down on its floor line
    sides = [a for a in shown if a['ax'] != 2]
    near = []
    for a in sides:
      ys = await ev(f"""()=>{{ const vp=__3dj.vp, d=[...__3dj.app.results.bodies.values()][0], c=[0,1,2].map(i=>(d.bbox[0][i]+d.bbox[1][i])/2);
        const diag=Math.hypot(...[0,1,2].map(i=>d.bbox[1][i]-d.bbox[0][i])), half=Math.min(25, Math.max(4, diag*0.12)), gap=half*0.5+2;
        const F=new vp.camera.position.constructor(...c); F.setComponent({a['ax']}, d.bbox[{1 if a['sign'] > 0 else 0}][{a['ax']}] + ({a['sign']})*(gap+half));
        const G=F.clone(); G.z=d.bbox[0][2]; return [vp.toScreen(F).y, vp.toScreen(G).y]; }}""")
      near.append(abs(a['y'] - ys[0]) < abs(a['y'] - ys[1]))
    check('the left, right and front arrows are at the middle height of their side, not down at the floor', sides and all(near), [sides, near])
    # the arrows are fixed to the object: from any view, each one is drawn exactly at its own spot in the scene (the middle
    # of its side at the object's middle height, a set distance out), and the bottom one is hidden from above
    fixed = '''()=>{ const vp=__3dj.vp, V=vp.camera.position.constructor, d=[...__3dj.app.results.bodies.values()][0];
      const mn=new V(...d.bbox[0]), mx=new V(...d.bbox[1]), c=mn.clone().add(mx).multiplyScalar(0.5), diag=mx.clone().sub(mn).length();
      const half=Math.min(25, Math.max(4, diag*0.12)), gap=half*0.5+2, objHalf=Math.max(3, diag*0.05), out=[];
      for (const e of document.querySelectorAll('.hud svg.hmove')) { if (e.style.display==='none') continue;
        const ax=+e.dataset.ax, sign=+e.dataset.sign, F=c.clone(); F.setComponent(ax, (sign>0?mx:mn).getComponent(ax));
        const wpp=vp.worldPerPixel(F), hl=Math.max(objHalf, 16*wpp), inner=Math.max(gap+half-objHalf, 12*wpp);
        const M=F.clone(); M.setComponent(ax, F.getComponent(ax)+sign*(inner+hl));
        const s=vp.toScreen(M), r=e.querySelector('path.grab').getBoundingClientRect();
        out.push(Math.hypot(r.x+r.width/2-s.x, r.y+r.height/2-s.y)); }
      return out; }'''
    views = [(60, -330, 40), (-330, -30, 30), (-220, -240, 230), (300, -60, 170), (-80, 320, 60)]
    offs, bottom_seen = [], []
    for v in views:
      await ev(f"""()=>{{ const vp=__3dj.vp, c=vp.selectionBox().getCenter(vp.camera.position.clone()); vp.orbit.target.copy(c); vp.camera.position.set(c.x+{v[0]},c.y+{v[1]},c.z+{v[2]}); vp.camera.lookAt(c); vp.orbit.update(); vp.updateGizmo(); }}""")
      await pg.wait_for_timeout(250)
      offs += await ev(fixed)
      bottom_seen.append(await ev("()=>document.querySelector('.hud svg.hmove[data-ax=\"2\"][data-sign=\"-1\"]').style.display!=='none'"))
    check('from five different views every arrow is drawn exactly at its fixed spot on the object (it never moves with the view)', offs and max(offs) < 1.5, offs)
    check('the bottom arrow (under the object) is hidden whenever you look from above', not any(bottom_seen), bottom_seen)
    # zooming: up close the arrows keep their size against the object; zoomed far out (like 3D Builder) they keep a
    # readable size and sit around the object, every one apart from the others
    ratios = []
    for dist in (100, 200):
      ratios.append(await ev(f"""()=>{{ const vp=__3dj.vp, bx=vp.selectionBox(), c=bx.getCenter(vp.camera.position.clone()), v=new vp.camera.position.constructor(0.3,-1,0.35).normalize();
        vp.orbit.target.copy(c); vp.camera.position.copy(c).addScaledVector(v, {dist}); vp.camera.lookAt(c); vp.orbit.update(); vp.updateGizmo();
        const e=[...document.querySelectorAll('.hud svg.hmove')].find(x=>x.dataset.ax==='0' && x.style.display!=='none'); if (!e) return null;
        const r=e.querySelector('path.grab').getBoundingClientRect(), a=vp.toScreen(bx.min), b=vp.toScreen(new vp.camera.position.constructor(bx.max.x,bx.min.y,bx.min.z));
        return r.width / Math.abs(b.x-a.x); }}"""))
    check('up close, zooming keeps the arrows the same size against the object', all(ratios) and max(ratios) / min(ratios) < 1.2, ratios)
    far = await ev("""()=>{ const vp=__3dj.vp, bx=vp.selectionBox(), c=bx.getCenter(vp.camera.position.clone()), v=new vp.camera.position.constructor(0.3,-1,0.35).normalize();
      vp.orbit.target.copy(c); vp.camera.position.copy(c).addScaledVector(v, 6000); vp.camera.lookAt(c); vp.orbit.update(); vp.updateGizmo();
      return [...document.querySelectorAll('.hud svg.hmove')].filter(e=>e.style.display!=='none').map(e=>{ const r=e.querySelector('path.grab').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2, Math.hypot(r.width, r.height)]; }); }""")
    apart = all(((p[0]-q[0])**2 + (p[1]-q[1])**2) ** 0.5 > 25 for i, p in enumerate(far) for q in far[i+1:])
    check('zoomed far out, the arrows keep a readable size (30+ px) around the small object and never pile up', len(far) >= 3 and all(f[2] >= 28 for f in far) and apart, far)
    blue = await ev("()=>[...document.querySelectorAll('.hud svg.hmove')].every(e=>e.style.color==='rgb(30, 160, 255)')")
    check('all the move arrows are blue (none green)', blue)
    await ev("""()=>{ const vp=__3dj.vp, c=vp.selectionBox().getCenter(vp.camera.position.clone()); vp.orbit.target.copy(c); vp.camera.position.set(c.x+60,c.y-330,c.z+40); vp.camera.lookAt(c); vp.orbit.update(); vp.updateGizmo(); }""")
    await pg.wait_for_timeout(250)
    check('looking straight at the front, its front-back arrows (tip-on) are hidden', await ev("()=>[...document.querySelectorAll('.hud svg.hmove[data-ax=\"1\"]')].every(e=>e.style.display==='none')"))
    await ev("(v)=>{ const vp=__3dj.vp; vp.camera.position.fromArray(v[0]); vp.orbit.target.fromArray(v[1]); vp.camera.lookAt(vp.orbit.target); vp.orbit.update(); vp.updateGizmo(); }", start_view)
    await pg.wait_for_timeout(400)
    # each visible arrow moves the object along its own direction only
    for a in shown:
      await ev("()=>{ __3dj.app.sel=[[...__3dj.app.results.bodies.keys()][0]]; __3dj.vp.setSelection(__3dj.app.sel); __3dj.vp.updateGizmo(); }"); await pg.wait_for_timeout(300)
      cur = [x for x in await arrows() if x['ax'] == a['ax'] and x['sign'] == a['sign']][0]
      m0 = await mid()
      tip = await ev(f"""()=>{{ const vp=__3dj.vp, d=[...__3dj.app.results.bodies.values()][0], c=[0,1,2].map(i=>(d.bbox[0][i]+d.bbox[1][i])/2); const p=new vp.camera.position.constructor(...c), q=p.clone(); q.setComponent({a['ax']}, q.getComponent({a['ax']}) + 20); const s0=vp.toScreen(p), s1=vp.toScreen(q); const l=Math.hypot(s1.x-s0.x, s1.y-s0.y)||1; return [(s1.x-s0.x)/l, (s1.y-s0.y)/l, l]; }}""")
      dx, dy = (tip[0] * 70, tip[1] * 70) if tip[2] > 3 else (0, 70)
      await pg.mouse.move(cur['x'], cur['y']); await pg.mouse.down()
      for k in range(1, 13): await pg.mouse.move(cur['x'] + dx * k / 12, cur['y'] + dy * k / 12)
      await pg.mouse.up(); await W()
      m1 = await mid(); d = [round(m1[i] - m0[i], 1) for i in range(3)]
      others = [abs(d[i]) for i in range(3) if i != a['ax']]
      check(f"arrow {'XYZ'[a['ax']]}{'+' if a['sign'] > 0 else '-'} moves it along {'XYZ'[a['ax']]} only", abs(d[a['ax']]) >= 1 and max(others) < 0.01, d)
      await ev("()=>__3dj.store.undo()"); await W()
    # a finger drags an arrow too
    await ev("()=>{ __3dj.app.sel=[[...__3dj.app.results.bodies.keys()][0]]; __3dj.vp.setSelection(__3dj.app.sel); __3dj.vp.updateGizmo(); }"); await pg.wait_for_timeout(300)
    top = [x for x in await arrows() if x['ax'] == 2 and x['sign'] == 1][0]
    m0 = await mid(); cdp = await ctx.new_cdp_session(pg)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': top['x'], 'y': top['y']}]})
    for k in range(1, 13): await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': top['x'], 'y': top['y'] - 60 * k / 12}]}); await pg.wait_for_timeout(20)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await W()
    m1 = await mid()
    check('a finger on the top arrow lifts the object', m1[2] - m0[2] >= 1 and m1[0] == m0[0] and m1[1] == m0[1], [m0, m1])
    check('no page errors', not errs, errs)
    await b.close()
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad: raise SystemExit(1)

if __name__ == '__main__':
  asyncio.run(main())
