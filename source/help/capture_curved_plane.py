"""Capture real app screenshots for the curved-surface sketch Help walkthrough.
Run after python build.py. Playwright Chromium is required.
"""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 shots=ROOT/'help/shots/curved-plane';shots.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':960});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto((ROOT/'local/3DJames.html').as_uri())
  await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  async def built():
   await page.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending && !window.__3dj.app.afterBuild && window.__3dj.app.builtRevision===window.__3dj.store.revision',timeout=120000)
  async def shot(name):
   await page.locator('.toast').evaluate_all('(els)=>els.forEach(e=>e.remove())')
   await page.wait_for_timeout(200);await page.screenshot(path=str(shots/(name+'.png')))
  await page.evaluate("const B=window.__3dj;B.commands.newProject();window.demo=B.commands.addShape('cyl',{d:40,h:40});B.store.amend(d=>d.features[0].pos=[0,0,0]);B.app.settings.panelOpen=true;B.commands.openPanel('props');")
  await built()
  await page.evaluate("const v=window.__3dj.vp;v.anim=null;v.camera.position.set(110,-85,75);v.orbit.target.set(0,0,20);v.orbit.update();v.requestRender()")
  await page.get_by_role('tab',name='Insert',exact=True).click()
  await page.get_by_role('button',name='Sketch',exact=True).click()
  await shot('plane-menu')
  await page.get_by_text('On a surface',exact=False).click()
  xy=await page.evaluate('()=>{const v=window.__3dj.vp,p=v.toScreen(v.camera.position.clone().set(20,0,20));return [p.x,p.y]}')
  await page.mouse.click(*xy)
  await page.get_by_role('dialog',name='Sketch plane',exact=True).wait_for(timeout=120000)
  await shot('plane-settings')
  await page.get_by_role('button',name='Sketch here',exact=True).click()
  await page.get_by_role('button',name='Cancel',exact=True).click()
  # Reuse the picked plane through the same entry point; add a precise example circle.
  await page.evaluate("const B=window.__3dj;B.commands.setWorkplane({P:[20,0,20],n:[1,0,0],curved:true,size:60});window.sk=B.commands.startSketch();sk.loops.push({type:'circle',c:[0,0],r:3});sk.setTool('select');document.querySelector('.sketch [title=\"Fit everything in view\"]').click();")
  await shot('plane-sketch')
  await page.get_by_role('button',name='Done',exact=True).click()
  await page.get_by_role('button',name='Cut into the face',exact=True).click()
  await page.get_by_role('dialog',name='Make it solid',exact=True).locator('input').first.fill('6')
  await shot('plane-cut-settings')
  before=await page.evaluate('window.__3dj.app.results.bodies.get(window.demo).volume')
  await page.get_by_role('button',name='OK',exact=True).click();await built()
  await page.wait_for_timeout(250);await built()
  result=await page.evaluate('({errors:window.__3dj.app.results.errors,volume:window.__3dj.app.results.bodies.get(window.demo).volume})')
  assert not result['errors'] and result['volume']<before-100,result
  await page.evaluate("const B=window.__3dj;B.commands.setWorkplane(null);B.app.sel=[];B.vp.setSelection([]);B.vp.anim=null;B.vp.camera.position.set(110,-85,75);B.vp.orbit.target.set(0,0,20);B.vp.orbit.update();B.vp.requestRender();")
  await shot('plane-result')
  await page.get_by_role('button',name='File menu',exact=True).click();await shot('tools-file-menu')
  await page.keyboard.press('Escape')
  assert not errors,errors
  (shots/'capture.json').write_text(json.dumps({'pageErrors':errors,'cutVolume':before-result['volume'],'screenshots':6},indent=2))
  await browser.close()
asyncio.run(main())
