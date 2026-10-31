# The page's side of updates in the installed Windows program (src/updates.js, Help > Licenses and components > Updates).
# A stand-in for the program's WebView2 connection records what the page sends and plays back what the program would say.
# (The program's own half, App.cs, is tested by tests/updater_host.py.)   Run after build.py:  python tests/updates.py
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
FAKE = """
window.__posted = []; window.__wvl = [];
window.chrome = Object.assign(window.chrome || {}, { webview: { postMessage: (m) => window.__posted.push(m), addEventListener: (t, fn) => { if (t === 'message') window.__wvl.push(fn); } } });
window.__3DJ_HOST = { program: true, updates: true };
window.__say = (m) => window.__wvl.forEach((fn) => fn({ data: m }));
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        errs = []
        ok = True
        def check(name, cond, info=''):
            nonlocal ok
            print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f' {info}'))
            ok = ok and bool(cond)

        # in the installed program
        ctx = await b.new_context(viewport={'width': 1400, 'height': 860})
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(FAKE)
        await pg.goto((ROOT / 'local/3DJames.html').as_uri())
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        check('the page asks the program where updates stand', '__3dj_status' in await pg.evaluate('window.__posted'))
        await pg.evaluate("window.__say({type:'3dj-update',status:'downloaded',version:'0.99.0',current:'0.17.22',enabled:true})")
        toast = pg.locator('.toast', has_text='0.99.0')
        await toast.wait_for(timeout=5000)
        check('a downloaded update is announced', 'next time you start' in await toast.inner_text())
        await pg.evaluate("(()=>{ window.__3dj.commands.showAbout(); })()")
        box = pg.locator('.modal-back').last
        await box.get_by_text('Updates', exact=True).wait_for(timeout=5000)
        check('About shows the update status', 'Version 0.99.0 is downloaded' in await box.locator('[data-update-status]').inner_text())
        cb = box.get_by_label('Look for a newer version on GitHub when 3DJames starts')
        check('the switch shows it is on', await cb.is_checked())
        await box.get_by_role('button', name='Check now').click()
        check('Check now asks the program', '__3dj_check' in await pg.evaluate('window.__posted'))
        await pg.evaluate("window.__say({type:'3dj-update',status:'checking',version:null,current:'0.17.22',enabled:true})")
        check('and waits while it looks', await box.get_by_role('button', name='Check now').is_disabled() and 'Looking' in await box.locator('[data-update-status]').inner_text())
        await pg.evaluate("window.__say({type:'3dj-update',status:'current',version:'0.17.22',current:'0.17.22',enabled:true})")
        check('then says you are up to date', 'newest version (0.17.22)' in await box.locator('[data-update-status]').inner_text())
        await cb.uncheck()
        check('the switch tells the program', '__3dj_updates_off' in await pg.evaluate('window.__posted'))
        await cb.check()
        check('and back on', (await pg.evaluate('window.__posted'))[-1] == '__3dj_updates_on')
        for st, words in [('offline', 'Could not reach GitHub'), ('failed', 'will try again next time')]:
            await pg.evaluate("(s)=>window.__say({type:'3dj-update',status:s,version:null,current:'0.17.22',enabled:true})", st)
            check(f'{st} is explained', words in await box.locator('[data-update-status]').inner_text())
        await ctx.close()

        # in a plain browser (and the 3DJames box) there is no program: nothing about updates shows
        pg = await (await b.new_context(viewport={'width': 1400, 'height': 860})).new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto((ROOT / 'local/3DJames.html').as_uri())
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        await pg.evaluate("(()=>{ window.__3dj.commands.showAbout(); })()")
        await pg.locator('.modal-back').last.get_by_text('Version', exact=False).first.wait_for(timeout=5000)
        check('a plain browser shows no Updates section', await pg.locator('[data-update-status]').count() == 0)
        check('no page errors', not errs, errs)
        print('ALL OK' if ok else 'FAILED'); await b.close()
        raise SystemExit(0 if ok else 1)

asyncio.run(main())
