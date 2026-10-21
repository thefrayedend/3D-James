"""Validate the packaged web assets under the desktop host's secure origin."""
import asyncio, json, mimetypes
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent
ASSETS=ROOT/'build/payload/app'
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        context=await browser.new_context(viewport={'width':1400,'height':860})
        async def serve(route):
            path=(ASSETS/unquote(urlsplit(route.request.url).path).lstrip('/')).resolve()
            if not path.is_relative_to(ASSETS.resolve()) or not path.is_file():
                await route.fulfill(status=404,body='Not found');return
            await route.fulfill(status=200,content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream',body=path.read_bytes())
        await context.route('https://app.3djames.local/**',serve)
        await context.route('http://**',lambda route:route.abort())
        page=await context.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto('https://app.3djames.local/3DJames.html')
        await page.wait_for_function('window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building && !window.__3dj.app.pending',timeout=120000)
        result=await page.evaluate('''async()=>{
          const {app,store,commands:C}=window.__3dj;
          const project=await C.buildFileData('3dj');
          const zip=await C.readZip(project);
          await C.openFile(new File([project],'round-trip.3dj'),null);
          while(app.building||app.pending) await new Promise(r=>setTimeout(r,20));
          const mf=await C.readZip(await C.buildFileData('3mf'));
          const stl=await C.buildFileData('stl');
          return {ok:app.results.bodies.size===2&&!Object.keys(app.results.errors).length,
            origin:location.origin,objects:app.results.bodies.size,features:store.doc.features.length,
            openPicker:typeof showOpenFilePicker,savePicker:typeof showSaveFilePicker,directoryPicker:typeof showDirectoryPicker,
            project:zip.has('project.json'),preview:zip.has('preview.png'),threeMF:mf.has('3D/3dmodel.model'),stlBytes:stl.byteLength};
        }''')
        await page.screenshot(path=str(ROOT/'build/payload-check.png'))
        result['pageErrors']=errors
        (ROOT/'build/payload-test.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result,indent=2),flush=True)
        await browser.close()
        assert result['ok'] and result['project'] and result['preview'] and result['threeMF'] and result['stlBytes']>84 and not errors
asyncio.run(main())
