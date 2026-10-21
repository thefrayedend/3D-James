import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright
HERE = Path(__file__).resolve().parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context()
        await ctx.add_init_script("window.__reviewWorkers=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__reviewWorkers.push(this)}};")
        pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: print(m.text, flush=True) if m.type == 'log' and m.text.startswith('TEST ') else None)
        await pg.goto(HERE.parent.joinpath('local/3DJames.html').as_uri())
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        await pg.add_script_tag(path=str(HERE/'reliability.js'))
        results = await pg.evaluate('window.__runReliability()')
        await pg.evaluate('window.__3dj.app.sel=[...window.__3dj.app.results.bodies.keys()]; window.__selectionBeforeDialog=window.__3dj.app.sel.slice(); window.showSaveFilePicker=undefined; window.__3dj.commands.saveAs()')
        dialog = pg.locator('dialog[open]')
        await dialog.wait_for()
        focused = True
        for _ in range(12):
            await pg.keyboard.press('Tab')
            focused = focused and await pg.evaluate('document.activeElement===document.body || !!document.activeElement.closest("dialog")')
        screenshot = HERE.parent / 'dist' / 'save-dialog.png'
        screenshot.parent.mkdir(exist_ok=True)
        await pg.screenshot(path=str(screenshot))
        await pg.keyboard.press('Escape')
        closed = await dialog.count() == 0
        selection_kept = await pg.evaluate('JSON.stringify(window.__3dj.app.sel)===JSON.stringify(window.__selectionBeforeDialog)')
        results.append({'name':'dialog traps focus and Escape dismisses without changing selection','ok':focused and closed and selection_kept})
        print(json.dumps({'tests':results,'pageErrors':errors}, indent=2), flush=True)
        await b.close()
        raise SystemExit(1 if errors or any(not r['ok'] for r in results) else 0)
asyncio.run(main())
