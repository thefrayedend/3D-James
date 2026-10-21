import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright
HERE=Path(__file__).resolve().parent
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  ctx=await b.new_context(viewport={'width':1440,'height':900})
  page=await ctx.new_page(); errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:print(m.text,flush=True) if m.type=='log' and m.text.startswith('TEST ') else None)
  url=HERE.parent.joinpath('local/3DJames.html').as_uri()
  await page.goto(url)
  await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  await page.add_script_tag(path=str(HERE/'features.js'))
  results=await page.evaluate('window.__runFeatureTests()')
  await page.reload()
  await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building',timeout=120000)
  restored=await page.evaluate('''async()=>{const {store:S,commands:C}=window.__3dj;if(S.doc.versions?.[0]?.label!=='Session marker')return false;await C.restoreVersion(S.doc.versions[0].id);return S.doc.features[0].p.w===32;}''')
  results.append({'name':'version snapshots persist across a browser reload','ok':restored})
  result={'tests':results,'pageErrors':errors}
  print(json.dumps(result,indent=2),flush=True)
  HERE.parent.joinpath('dist/features-results.json').write_text(json.dumps(result,indent=2))
  await b.close();sys.exit(1 if errors or any(not r['ok'] for r in results) else 0)
asyncio.run(main())
