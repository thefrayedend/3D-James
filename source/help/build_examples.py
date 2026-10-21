"""Validate editable tutorial projects and capture their real CAD results."""
import asyncio,base64,json
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
  async def built():
   await page.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending && window.__3dj.app.builtRevision===window.__3dj.store.revision',timeout=120000)
   err=await page.evaluate('window.__3dj.app.results.errors');assert not err,err
  async def load(doc):
   await page.evaluate('d=>window.__3dj.commands.loadProject(d,null)',doc);await built()
   await page.evaluate("const B=window.__3dj;B.vp.anim=null;B.vp.view('home',false);B.app.settings.panelOpen=true;B.commands.openPanel('history');")
   await page.wait_for_timeout(250)
  async def shot(name):
   await page.locator('.toast').evaluate_all('(es)=>es.forEach(e=>e.remove())')
   await page.screenshot(path=str(ROOT/'help/img'/f'tutorial-{name}.jpg'),type='jpeg',quality=92)
  for key in ['plate','nameplate','mug']:
   doc=json.loads((ROOT/'help/examples'/f'{key}.json').read_text())
   await load(doc)
   before=await page.evaluate('window.__3dj.app.results.bodies.get("b1").volume')
   parts=await page.evaluate('''async()=>{const C=window.__3dj.commands;const ex=await C.workerCall({type:'export',format:'step',items:[{id:'b1',name:'Tutorial',color:'#00A2E8'}],base:'tutorial'});const data=ex.files[0].data.slice().buffer;return (await C.workerCall({type:'checkImport',fmt:'step',fileId:'tutorial-inspect',data},[data])).parts;}''')
   assert parts==1,(key,parts)
   await shot(key)
   data=await page.evaluate("async()=>{const a=await window.__3dj.commands.buildFileData('3dj');let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s)}")
   binary=base64.b64decode(data);(ROOT/'help/examples'/f'{key}.3dj').write_bytes(binary)
   # Reopen the actual archive, then change a real parameter and check the model rebuilds.
   await page.evaluate("async b64=>{const a=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));await window.__3dj.commands.openFile(new File([a],'example.3dj'),null)}",data);await built()
   if key=='plate':edit="d.features[0].p.h=6"
   elif key=='nameplate':edit="d.features[1].text='HELLO'"
   else:edit="d.features[1].p.h=12"
   await page.evaluate(f'window.__3dj.store.commit(d=>{{{edit}}})');await built()
   after=await page.evaluate('window.__3dj.app.results.bodies.get("b1").volume');assert abs(after-before)>1,(key,before,after)
   await page.evaluate('window.__3dj.store.undo()');await built()
   undo=await page.evaluate('window.__3dj.app.results.bodies.get("b1").volume');assert abs(undo-before)<.01
   results.append({'model':key,'solidCount':parts,'volume':before,'editedVolume':after,'archiveBytes':len(binary),'ok':True})
   if key=='plate':
    await page.evaluate('window.__3dj.commands.editSketch(window.__3dj.store.doc.features[0])');await shot('plate-sketch')
    await page.get_by_role('button',name='Cancel',exact=True).click()
   if key=='mug':
    await page.evaluate('window.__3dj.commands.editSketch(window.__3dj.store.doc.features[0])');await shot('mug-profile')
    await page.get_by_role('button',name='Cancel',exact=True).click()
    cup=json.loads(json.dumps(doc));cup['features']=cup['features'][:1];cup['bodies']={'b1':doc['bodies']['b1']};await load(cup);await shot('mug-cup')
    await load(doc);await page.evaluate('window.__3dj.commands.editSketch(window.__3dj.store.doc.features[1])');await shot('mug-handle')
    await page.get_by_role('button',name='Cancel',exact=True).click()
  assert not errors,errors
  (ROOT/'help/examples/validation.json').write_text(json.dumps({'models':results,'pageErrors':errors},indent=2));print(json.dumps(results,indent=2))
  await browser.close()
asyncio.run(main())
