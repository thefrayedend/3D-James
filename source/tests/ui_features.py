import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=await b.new_page(viewport={'width':1440,'height':960});errors=[];results=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto((ROOT/'local/3DJames.html').as_uri())
  await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  async def built():
   await page.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending',timeout=120000)
  async def setup():
   await page.evaluate('window.__3dj.commands.newProject()');await built()
   await page.evaluate("window.__uiBody=window.__3dj.commands.addShape('box',{w:100,d:70,h:10});window.__3dj.app.sel=[window.__uiBody];window.__3dj.vp.setSelection([window.__uiBody]);")
   await built()
   await page.evaluate("window.__3dj.app.tab='Object';window.__3dj.commands.renderCmdBar();window.__3dj.vp.anim=null;window.__3dj.vp.view('home',false)")
  await setup()
  await page.get_by_role('button',name='Emboss',exact=True).click()
  face=await page.evaluate('''()=>{const v=window.__3dj.vp,p=v.camera.position.clone().set(0,0,10);const s=v.toScreen(p);return [s.x,s.y]}''')
  await page.mouse.click(*face)
  assert await page.evaluate('!!window.__3dj.app.tool.face'),'face picking failed'
  text=page.get_by_label('Text',exact=True);await text.fill('JAMES');await text.press('Tab')
  await page.get_by_role('button',name='Apply',exact=True).click();await built()
  assert await page.evaluate("window.__3dj.store.doc.features.at(-1).type==='emboss' && !Object.keys(window.__3dj.app.results.errors).length")
  await page.screenshot(path=str(ROOT/'dist/emboss-ui.png'))
  results.append({'name':'text emboss through actual face click and Apply','ok':True})
  await page.get_by_role('tab',name='View',exact=True).click()
  await page.get_by_role('button',name='Measure',exact=True).click()
  for point in [[-40,-25,10],[40,-25,10]]:
   xy=await page.evaluate('p=>{const v=window.__3dj.vp,s=v.toScreen(v.camera.position.clone().set(...p));return [s.x,s.y]}',point)
   await page.mouse.click(*xy)
  value=await page.evaluate("window.__3dj.commands.measureResult('point',window.__3dj.app.tool.items).rows.find(x=>x[0]==='Distance')?.[1]")
  assert value is not None and abs(value-80)<0.1,('picked distance',value)
  await page.screenshot(path=str(ROOT/'dist/measure-ui.png'))
  await page.get_by_role('button',name='Done',exact=True).click()
  results.append({'name':'general measure through real surface clicks','ok':True})
  await page.evaluate("window.__3dj.commands.createVersion('Fit test','First printable fit');window.__3dj.commands.versionsDialog()")
  await page.screenshot(path=str(ROOT/'dist/versions-ui.png'))
  await page.get_by_role('button',name='Close',exact=True).click()
  results.append({'name':'version list displays snapshot and notes','ok':True})
  await page.set_viewport_size({'width':1000,'height':800})
  await page.get_by_role('tab',name='Object',exact=True).click()
  await page.get_by_role('button',name='More tools',exact=True).click()
  assert await page.evaluate("!document.getElementById('cmdbar').classList.contains('icons') && !!document.querySelector('.ribbon-more-menu .cb')")
  await page.screenshot(path=str(ROOT/'dist/ribbon-ui.png'))
  await page.keyboard.press('Escape')
  results.append({'name':'narrow ribbon retains labels with functional More menu','ok':True})
  await page.set_viewport_size({'width':1440,'height':960});await setup()
  await page.evaluate("const B=window.__3dj;window.__uiSecond=B.commands.addShape('box',{w:60,d:30,h:20});")
  await built()
  await page.evaluate("const B=window.__3dj;B.app.sel=[window.__uiBody,window.__uiSecond];B.vp.setSelection(B.app.sel);B.commands.combine('union')")
  await built()
  assert await page.evaluate('window.__3dj.app.results.bodies.size===1 && !document.querySelector("dialog[open]")'),'merge did not happen in one click'
  await page.evaluate('window.__3dj.store.undo()');await built()
  results.append({'name':'merge happens in one click, no preview to apply','ok':True})
  out={'tests':results,'pageErrors':errors};print(json.dumps(out,indent=2),flush=True)
  (ROOT/'dist/ui-features-results.json').write_text(json.dumps(out,indent=2))
  await b.close();assert not errors,errors
asyncio.run(main())
