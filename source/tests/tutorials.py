import asyncio,json,zipfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  context=await browser.new_context(viewport={'width':1440,'height':960},accept_downloads=True)
  await context.add_init_script("localStorage.setItem('3djames.settings',JSON.stringify({helpPage:'curved',panelOpen:true}))")
  page=await context.new_page();errors=[];results=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def ready():await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  async def built():await page.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending && window.__3dj.app.builtRevision===window.__3dj.store.revision',timeout=120000)
  async def topic(text):
    # its chapter may be folded: open the chapters first
    while not await page.locator('.help-link').filter(has_text=text).count() and await page.locator('.help-section:not(.open)').count():
      await page.locator('.help-section:not(.open)').first.click()
    await page.locator('.help-link').filter(has_text=text).click()
  await page.goto((ROOT/'local/3DJames.html').as_uri());await ready()
  await page.get_by_role('tab',name='Help',exact=True).click()
  assert await page.locator('.help-body h1').inner_text()=='About 3DJames'
  assert (await page.locator('.help-link').first.inner_text()).endswith('About 3DJames')
  assert await page.locator('a[href="https://discord.gg/Y5Ke2SHHyc"]').get_attribute('target')=='_blank'
  await page.screenshot(path=str(ROOT/'dist/about.png'))
  results.append({'name':'About is first and defaults on a new app session, with the specified Discord link','ok':True})
  await page.get_by_role('button',name='Explore tutorials',exact=True).click()
  assert await page.locator('.tutorial-card').count()==3
  await page.get_by_role('button',name='Read the sketch mug tutorial',exact=True).click()
  await page.get_by_role('heading',name='2. Spin it into a hollow cup',exact=True).scroll_into_view_if_needed()
  marker=page.get_by_role('heading',name='2. Spin it into a hollow cup',exact=True)
  await marker.evaluate('(e)=>e.scrollIntoView({block:"start"})')
  offset=await marker.evaluate('(e)=>e.getBoundingClientRect().top-e.closest("article").getBoundingClientRect().top')
  await page.get_by_role('button',name='Keep visible',exact=True).click()
  await page.wait_for_timeout(100)
  assert await page.locator('#helpview').evaluate('(e)=>e.classList.contains("docked")')
  newoffset=await marker.evaluate('(e)=>e.getBoundingClientRect().top-e.closest("article").getBoundingClientRect().top')
  assert abs(newoffset-offset)<2,(offset,newoffset)
  scroll=await page.locator('.help-article').evaluate('(e)=>e.scrollTop')
  await page.evaluate('window.__3dj.commands.newProject()');await built()
  await page.get_by_role('button',name='Cube',exact=True).click();await built()
  await page.evaluate("window.__3dj.vp.anim=null;window.__3dj.vp.view('home',false)")
  assert abs(await page.locator('.help-article').evaluate('(e)=>e.scrollTop')-scroll)<2
  await page.screenshot(path=str(ROOT/'dist/tutorial-docked.png'))
  results.append({'name':'topic and exact scroll position remain while switching tabs and building geometry','ok':True})
  xy=await page.evaluate('()=>{const B=window.__3dj,d=B.app.results.bodies.get(B.app.sel[0]),v=B.vp,p=v.toScreen(v.camera.position.clone().set(...d.bbox[0].map((x,i)=>(x+d.bbox[1][i])/2)));window.pickedId=B.app.sel[0];B.app.sel=[];v.setSelection([]);return [p.x,p.y]}')
  await page.mouse.click(*xy)
  assert await page.evaluate('window.__3dj.app.sel.includes(window.pickedId)'),'canvas selection offset is wrong with docked Help'
  await page.get_by_role('button',name='Sketch',exact=True).click()
  await page.get_by_text('On the floor',exact=True).click()
  rectangles=await page.evaluate('()=>{const h=document.getElementById("helpview").getBoundingClientRect(),s=document.querySelector(".sketch").getBoundingClientRect();return {helpRight:h.right,sketchLeft:s.left,width:s.width}}')
  assert rectangles['sketchLeft']>=rectangles['helpRight']-1 and rectangles['width']>600,rectangles
  await page.screenshot(path=str(ROOT/'dist/tutorial-sketch-docked.png'))
  await page.get_by_role('button',name='Cancel',exact=True).click()
  results.append({'name':'model picking and the actual sketch board work beside docked Help without overlap','ok':True})
  await page.get_by_role('button',name='Full Help',exact=True).click()
  await topic('Tutorial: raised nameplate')
  before=await page.evaluate('JSON.stringify(window.__3dj.store.doc)')
  await page.get_by_role('button',name='Open editable example',exact=True).click()
  await page.get_by_role('dialog',name='Open tutorial example?',exact=True).wait_for()
  await page.get_by_role('button',name='Cancel',exact=True).click()
  assert await page.evaluate('JSON.stringify(window.__3dj.store.doc)')==before
  await page.get_by_role('button',name='Open editable example',exact=True).click()
  await page.get_by_role('button',name='Open without saving',exact=True).click();await built()
  assert await page.evaluate('window.__3dj.store.doc.name')=='Tutorial - Raised nameplate'
  assert await page.evaluate('window.__3dj.app.file===null && window.__3dj.app.dirty')
  await page.evaluate("window.__3dj.store.commit(d=>d.features[1].text='HELLO')");await built()
  await page.get_by_role('button',name='Open editable example',exact=True).click();await page.get_by_role('button',name='Open without saving',exact=True).click();await built()
  assert await page.evaluate('window.__3dj.store.doc.features[1].text')=='MAKER'
  results.append({'name':'example opening protects unsaved work and always creates a fresh editable copy','ok':True})
  async with page.expect_download() as info:await page.get_by_role('button',name='Download .3dj',exact=True).click()
  download=await info.value;path=await download.path()
  with zipfile.ZipFile(path) as archive:
   doc=json.loads(archive.read('project.json'));assert doc['features'][1]['text']=='MAKER' and 'preview.png' in archive.namelist()
  results.append({'name':'embedded example downloads as a real editable 3dj archive with history and preview','ok':True})
  await page.get_by_role('button',name='Close Help',exact=True).click()
  await page.get_by_role('tab',name='Help',exact=True).click()
  assert await page.locator('.help-body h1').inner_text()=='Tutorial: raised nameplate'
  await page.reload();await ready();await page.get_by_role('tab',name='Help',exact=True).click()
  assert await page.locator('.help-body h1').inner_text()=='About 3DJames'
  results.append({'name':'Help resumes within the session but returns to About after restarting','ok':True})
  assert not errors,errors
  out={'tests':results,'pageErrors':errors};print(json.dumps(out,indent=2));(ROOT/'dist/tutorial-results.json').write_text(json.dumps(out,indent=2))
  await browser.close()
asyncio.run(main())
