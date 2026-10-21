import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1440,'height':960});errors=[];results=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto((ROOT/'local/3DJames.html').as_uri())
  await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  await page.evaluate("const B=window.__3dj; B.commands.newProject();window.bodyId=B.commands.addShape('cyl',{d:40,h:40});B.store.amend(d=>d.features[0].pos=[0,0,0]);")
  await page.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending',timeout=120000)
  await page.evaluate("const v=window.__3dj.vp;v.anim=null;v.camera.position.set(130,0,30);v.orbit.target.set(0,0,20);v.orbit.update();v.requestRender()")
  baseline=await page.evaluate('JSON.stringify(window.__3dj.store.doc)')
  async def menu():
   await page.get_by_role('tab',name='Insert',exact=True).click()
   if not await page.get_by_role('button',name='Sketch',exact=True).is_visible():
    await page.get_by_role('button',name='More tools',exact=True).click()
   await page.get_by_role('button',name='Sketch',exact=True).click()
  async def pick():
   xy=await page.evaluate('()=>{const v=window.__3dj.vp,p=v.toScreen(v.camera.position.clone().set(20,0,20));return [p.x,p.y]}')
   await page.mouse.click(*xy)
   await page.get_by_role('dialog',name='Sketch plane',exact=True).wait_for(timeout=120000)
  await menu();await page.get_by_text('Place sketch plane',exact=False).click();await pick()
  await page.get_by_label('Plane offset (mm)',exact=True).fill('-1')
  await page.screenshot(path=str(ROOT/'dist/sketch-plane-ui.png'))
  assert await page.evaluate('Math.abs(window.__3dj.vp.wpMesh.position.x-19.05)<0.02'),'offset preview wrong'
  await page.get_by_role('button',name='Cancel',exact=True).click()
  assert await page.evaluate('!window.__3dj.app.workplane && !window.__3dj.vp.wpMesh'),'cancel did not restore plane'
  assert await page.evaluate('JSON.stringify(window.__3dj.store.doc)')==baseline,'cancel changed project'
  results.append({'name':'real curved-face click, exact offset preview and Cancel','ok':True})
  await menu();await page.get_by_text('Place sketch plane',exact=False).click();await pick()
  await page.get_by_label('Flip plane direction').check()
  await page.get_by_role('button',name='Use plane',exact=True).click()
  assert await page.evaluate('window.__3dj.app.workplane.curved && window.__3dj.app.workplane.n[0]<-0.99'),'flipped plane not set'
  results.append({'name':'Use plane applies flipped curved frame without modeling mutation','ok':True})
  await menu();await page.get_by_text('Adjust current plane',exact=False).click()
  await page.get_by_role('button',name='Sketch here',exact=True).click()
  assert await page.evaluate('document.body.classList.contains("sketching")'),'sketch editor not opened'
  await page.get_by_role('button',name='Cancel',exact=True).click()
  results.append({'name':'adjust plane and Sketch here open existing sketch editor','ok':True})
  await menu();await page.get_by_text('On a surface',exact=False).click();await pick()
  await page.get_by_role('button',name='Sketch here',exact=True).click()
  assert await page.evaluate('document.body.classList.contains("sketching")')
  await page.get_by_role('button',name='Cancel',exact=True).click()
  assert await page.evaluate('window.__3dj.app.workplane.n[0]<-0.99'),'cancel sketch lost prior workplane'
  results.append({'name':'surface sketch shortcut and cancel restore previous workplane','ok':True})
  assert not errors,errors
  out={'tests':results,'pageErrors':errors};print(json.dumps(out,indent=2));(ROOT/'dist/plane-ui-results.json').write_text(json.dumps(out,indent=2))
  await browser.close()
asyncio.run(main())
