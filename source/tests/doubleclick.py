# Double-clicking an object: 1st flies in to frame it, 2nd goes twice as close, 3rd goes back to the first view (and round again).
# A different object, or moving the view yourself, starts again at the first view. Real mouse.  python tests/doubleclick.py
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg=await b.new_page(viewport={'width':1400,'height':860}); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto((ROOT/'local/3DJames.html').as_uri())
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
    built=lambda: pg.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending',timeout=120000)
    await pg.evaluate('window.__3dj.commands.newProject()'); await built()
    await pg.get_by_role('button',name='Cube',exact=True).click(); await built()
    await pg.evaluate("window.__3dj.vp.anim=null;window.__3dj.vp.view('home',false)")
    dist="()=>{const v=window.__3dj.vp;return v.camera.position.distanceTo(v.orbit.target)}"
    async def screen():  # the middle of the first object on screen
      return await pg.evaluate("""()=>{const B=window.__3dj, v=B.vp, id=[...B.app.results.bodies.keys()][0]; const c=v.selectionBox([id]).getCenter(new v.camera.position.constructor()).project(v.camera); const r=v.renderer.domElement.getBoundingClientRect(); return [r.left+(c.x+1)/2*r.width, r.top+(1-c.y)/2*r.height]}""")
    async def dbl():
      x,y=await screen(); await pg.mouse.dblclick(x,y); await pg.wait_for_function('!window.__3dj.vp.anim',timeout=10000); return await pg.evaluate(dist)
    d0=await pg.evaluate(dist); d1=await dbl(); d2=await dbl(); d3=await dbl(); d4=await dbl()
    print(json.dumps({'start':d0,'1st':d1,'2nd':d2,'3rd':d3,'4th':d4}))
    assert abs(d2-d1/2)<0.01*d1, (d1,d2)
    assert abs(d3-d1)<0.01*d1 and abs(d4-d2)<0.01*d1, (d3,d4)
    # moving the view yourself starts again at the first view
    await pg.mouse.move(700,430); await pg.mouse.wheel(0,-200); await pg.wait_for_timeout(300)
    d5=await dbl(); assert abs(d5-d1)<0.01*d1, (d5,d1)
    assert not errs, errs
    print('ALL OK'); await b.close()
asyncio.run(main())
