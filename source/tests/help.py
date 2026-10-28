import asyncio,json,re
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
  await page.get_by_role('tab',name='Help',exact=True).click()
  # chapters fold open and shut: the one being read is open, the others are folded
  assert await page.locator('.help-section').count()==7
  assert await page.locator('.help-section.open').count()==1
  assert (await page.locator('.help-where').inner_text()).lower().startswith('start here')
  await page.locator('.help-section',has_text='Sketching').click()
  assert await page.locator('.help-link',has_text='The sketch board').count()==1
  await page.locator('.help-section',has_text='Sketching').click()
  assert await page.locator('.help-link',has_text='The sketch board').count()==0
  results.append({'name':'Help chapters fold open and shut; the page says which chapter it is in','ok':True})
  # the topic list stays where it was scrolled to when a chapter is opened or a topic is picked
  await page.set_viewport_size({'width':1440,'height':600})
  await page.locator('.help-section',has_text='Sketching').click()
  await page.locator('.help-nav').evaluate('(e)=>e.scrollTop=e.scrollHeight')
  top=await page.locator('.help-nav').evaluate('(e)=>e.scrollTop'); assert top>50,top
  await page.locator('.help-section',has_text='Reference').click()
  t2=await page.locator('.help-nav').evaluate('(e)=>e.scrollTop'); assert abs(t2-top)<2,(top,t2)
  y0=(await page.locator('.help-link',has_text='Import a DXF or SVG drawing').bounding_box())['y']
  await page.locator('.help-link',has_text='Import a DXF or SVG drawing').click()
  y1=(await page.locator('.help-link',has_text='Import a DXF or SVG drawing').bounding_box())['y']; assert abs(y1-y0)<2,(y0,y1)
  assert await page.locator('.help-body h1').inner_text()=='Import a DXF or SVG drawing'
  await page.locator('.help-section',has_text='Sketching').click(); await page.locator('.help-section',has_text='Reference').click()
  await page.set_viewport_size({'width':1440,'height':960})
  await page.locator('.help-section',has_text='Start here').click(); await page.locator('.help-link',has_text='About 3DJames').click()
  results.append({'name':'the topic list keeps its scroll position when a chapter or topic is clicked','ok':True})
  while await page.locator('.help-section:not(.open)').count(): await page.locator('.help-section:not(.open)').first.click()
  count=await page.locator('.help-link').count();assert count==31,count
  # every link between pages goes to a page that exists, and clicking one opens it
  ids=await page.evaluate('()=>window.__3DJ_HELP.pages.map(p=>p.id)')
  for pg in await page.evaluate('()=>window.__3DJ_HELP.pages.map(p=>[p.id,[...p.html.matchAll(/data-help-topic="([^"]+)"/g)].map(m=>m[1])])'):
   assert all(t in ids for t in pg[1]),pg
  await page.locator('.help-link',has_text='Getting started').click()
  await page.locator('.help-body a[data-help-topic="sketch"]').first.click()
  assert await page.locator('.help-body h1').inner_text()=='The sketch board'
  results.append({'name':'links between Help pages all lead somewhere, and open the page','ok':True})
  for i in range(count):
   while await page.locator('.help-section:not(.open)').count(): await page.locator('.help-section:not(.open)').first.click()
   await page.locator('.help-link').nth(i).click()
   images=await page.locator('.help-body img').evaluate_all('async es=>{await Promise.all(es.map(e=>e.decode()));return es.map(e=>({src:e.src.startsWith("data:image/"),width:e.naturalWidth,alt:e.alt,role:e.getAttribute("role")}))}')
   assert all(im['src'] and im['width']>0 and im['alt'] and im['role']=='button' for im in images),(i,images)
   assert await page.locator('.help-article').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),i
  results.append({'name':'all 28 Help topics render and every referenced picture decodes offline with alternative text','ok':True})
  search=page.get_by_placeholder('Search help…');await search.fill('tangent')
  await page.locator('.help-link').filter(has_text='Sketch on a face or curved surface').click()
  assert await page.locator('.help-body figure').count()==5
  await page.screenshot(path=str(ROOT/'dist/help-curved.png'))
  results.append({'name':'curved-plane tutorial is discoverable through Help search and has five captioned steps','ok':True})
  first=page.locator('.help-body img').first
  await first.click()
  dialog=page.get_by_role('dialog');await dialog.wait_for()
  assert await dialog.locator('img').evaluate('(e)=>e.complete && e.naturalWidth>0')
  await page.get_by_role('button',name='Actual size',exact=True).click()
  assert await dialog.locator('img').evaluate('(e)=>Math.abs(e.getBoundingClientRect().width-e.naturalWidth)<1')
  await page.get_by_role('button',name='Fit picture',exact=True).click()
  await page.screenshot(path=str(ROOT/'dist/help-enlarged.png'))
  await page.keyboard.press('Escape');await dialog.wait_for(state='detached')
  assert await first.evaluate('(e)=>document.activeElement===e')
  await first.press('Enter');await page.get_by_role('button',name='Close picture',exact=True).click()
  results.append({'name':'pictures enlarge by mouse or keyboard, Escape closes and focus returns','ok':True})
  await page.set_viewport_size({'width':1000,'height':800})
  assert await page.locator('.help-article').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  await page.screenshot(path=str(ROOT/'dist/help-narrow.png'))
  results.append({'name':'illustrated topic fits a narrower desktop window','ok':True})
  await page.set_viewport_size({'width':1440,'height':960})
  await page.get_by_placeholder('Search help…').fill('')
  while await page.locator('.help-section:not(.open)').count(): await page.locator('.help-section:not(.open)').first.click()
  await page.locator('.help-link').filter(has_text='Saving and opening').click()
  text=await page.locator('.help-body').inner_text();assert 'STEP' in text and 'Backups' in text and 'Export' not in text and 'JSON' not in text
  await page.locator('.help-link').filter(has_text='History, variables and versions').click()
  assert await page.locator('.help-body figure').count()>=4
  await page.screenshot(path=str(ROOT/'dist/help-tools.png'))
  results.append({'name':'older file guidance is corrected and recent tools have captioned pictures','ok':True})
  assert not errors,errors
  out={'tests':results,'pageErrors':errors};print(json.dumps(out,indent=2));(ROOT/'dist/help-results.json').write_text(json.dumps(out,indent=2))
  await browser.close()
asyncio.run(main())
