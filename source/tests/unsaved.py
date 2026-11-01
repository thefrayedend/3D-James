# Unsaved changes are never thrown away without asking: New, Open, dropping a project, the tutorial examples and the
# installed program's close button all ask "Save changes?" first (src/files.js askToSave). Work brought back after a
# restart keeps its unsaved star. The program's own half (App.cs) is tested by tests/updater_host.py.
# Served over http (not file://) so the save window can be stood in for by a real file handle.   Run after build.py:
#   python tests/unsaved.py
import asyncio, functools, http.server, json, threading
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
# stands in for the program's WebView2 connection (as in tests/updates.py)
FAKE_HOST = """
window.__posted = []; window.__wvl = [];
window.chrome = Object.assign(window.chrome || {}, { webview: { postMessage: (m) => window.__posted.push(m), addEventListener: (t, fn) => { if (t === 'message') window.__wvl.push(fn); } } });
window.__3DJ_HOST = { program: true, updates: false };
window.__say = (m) => window.__wvl.forEach((fn) => fn({ data: m }));
"""
# the Windows save and open windows: answer with a file in the page's private storage (a real, rememberable handle)
FAKE_PICKERS = """
window.__picked = 0;
window.showSaveFilePicker = async () => { window.__picked++; return (await navigator.storage.getDirectory()).getFileHandle('kept.3dj', { create: true }); };
window.showOpenFilePicker = async () => { window.__picked++; throw new DOMException('closed', 'AbortError'); };
"""

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=str(ROOT / 'local'))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

async def main():
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_address[1]}/3DJames.html'
    ok = True
    errs = []
    def check(name, cond, info=''):
        nonlocal ok
        print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f' {info}'), flush=True)
        ok = ok and bool(cond)

    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 1400, 'height': 860})
        await ctx.add_init_script(FAKE_HOST + FAKE_PICKERS)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))

        async def start():
            await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        async def built():
            await pg.wait_for_function('(()=>{const a=window.__3dj.app;return !a.building && !a.pending && a.builtRevision===window.__3dj.store.revision})()', timeout=120000)
        async def change():
            await pg.evaluate("window.__3dj.commands.addShape('box')"); await built()
        ask = pg.get_by_role('dialog', name='Save changes?')
        async def menu(item):
            await pg.get_by_label('File menu').click()
            await pg.get_by_text(item, exact=True).click()
        dirty = lambda: pg.evaluate('window.__3dj.app.dirty')
        features = lambda: pg.evaluate('window.__3dj.store.doc.features.length')

        await pg.goto(url); await start()
        check('the page tells the program it answers the close button', '__3dj_close_asks' in await pg.evaluate('window.__posted'))

        # New
        await pg.evaluate('window.__3dj.commands.newProject()'); await built()
        await menu('New')
        await pg.wait_for_timeout(300)
        check('New with nothing to save does not ask', await ask.count() == 0)
        await change(); n = await features()
        await menu('New'); await ask.wait_for(timeout=5000)
        check('New with unsaved changes asks first', 'Do you want to save the changes to' in await ask.inner_text())
        await ask.get_by_role('button', name='Cancel').click()
        check('Cancel keeps the work', await features() == n and await dirty())
        await menu('New'); await ask.wait_for(timeout=5000)
        await pg.keyboard.press('Escape')
        check('Escape is the same as Cancel', await features() == n and await dirty())
        await menu('New'); await ask.get_by_role('button', name="Don't save").click(); await built()
        check("Don't save starts the new project", await features() == 0 and not await dirty())

        # Save from the question
        await change()
        await menu('New'); await ask.get_by_role('button', name='Save', exact=True).click()
        # it saves, then New goes ahead
        await pg.wait_for_function('window.__3dj.store.doc.features.length === 0 && !window.__3dj.app.dirty', timeout=30000); await built()
        size = await pg.evaluate("(async()=>(await (await (await navigator.storage.getDirectory()).getFileHandle('kept.3dj')).getFile()).size)()")
        check('Save saves it, then goes ahead', size > 0 and await features() == 0, f'size {size}')
        # saving was cancelled in the save window: nothing goes ahead
        await change()
        await pg.evaluate("window.__realSave = window.showSaveFilePicker; window.showSaveFilePicker = async () => { throw new DOMException('closed', 'AbortError'); }; 0")
        await menu('New'); await ask.get_by_role('button', name='Save', exact=True).click()
        await pg.wait_for_timeout(800)
        check('a save that did not happen stops New', await features() == 1 and await dirty())
        await pg.evaluate('window.showSaveFilePicker = window.__realSave; 0')
        # from here on the project is kept.3dj with one object, plus one more not saved yet
        await pg.evaluate('window.__3dj.commands.saveDoc()')
        await pg.wait_for_function('window.__3dj.app.file?.name === "kept.3dj" && !window.__3dj.app.dirty', timeout=30000)
        await change()

        # Open (Ctrl+O): asks before the open window
        picked = await pg.evaluate('window.__picked')
        await pg.keyboard.press('Control+o'); await ask.wait_for(timeout=5000)
        await ask.get_by_role('button', name='Cancel').click(); await pg.wait_for_timeout(300)
        check('Open asks before showing the open window', await pg.evaluate('window.__picked') == picked and await dirty())
        # dropping a project file on the window
        await pg.evaluate("""(()=>{ const dt = new DataTransfer(); dt.items.add(new File(['{"features":[]}'], 'other.json'));
            document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()""")
        await ask.wait_for(timeout=5000)
        await ask.get_by_role('button', name='Cancel').click(); await pg.wait_for_timeout(300)
        check('dropping a project file asks first', await features() == 2 and await dirty())

        # the installed program's close button
        posted = lambda: pg.evaluate('window.__posted')
        await pg.evaluate("window.__posted.length = 0; window.__say({ type: '3dj-close' })"); await ask.wait_for(timeout=5000)
        check('closing with unsaved changes asks (and tells the program it is asking)', await posted() == ['__3dj_close_wait'])
        await pg.evaluate("window.__say({ type: '3dj-close' })"); await pg.wait_for_timeout(300)
        check('a second click on close does not open a second question', await ask.count() == 1)
        await ask.get_by_role('button', name='Cancel').click(); await pg.wait_for_timeout(300)
        check('Cancel keeps the program open', '__3dj_close_ok' not in await posted() and await dirty())
        await pg.evaluate("window.__posted.length = 0; window.__say({ type: '3dj-close' })"); await ask.wait_for(timeout=5000)
        await ask.get_by_role('button', name="Don't save").click()
        await pg.wait_for_function("window.__posted.includes('__3dj_close_ok')", timeout=10000)
        check("Don't save lets the program close", True)

        # next start: the project as it was saved, not the work that was thrown away (that is in Backups)
        await pg.reload(); await start(); await built()
        check("after Don't save, the next start shows the saved file", await features() == 1 and not await dirty()
              and await pg.evaluate('window.__3dj.app.file?.name') == 'kept.3dj', await pg.title())
        backups = await pg.evaluate("(async()=>(await window.__3dj.commands.idb.all('backups')).map(b=>JSON.parse(b.json).features.length))()")
        check('and the thrown-away work is in Backups', 2 in backups, str(backups))
        await pg.evaluate("window.__posted.length = 0; window.__say({ type: '3dj-close' })")
        await pg.wait_for_function("window.__posted.includes('__3dj_close_ok')", timeout=10000)
        check('closing with nothing to save does not ask', await ask.count() == 0 and await posted() == ['__3dj_close_wait', '__3dj_close_ok'])

        # work brought back after a restart (or a crash) keeps its unsaved star
        await change(); await pg.wait_for_timeout(3200)  # the background copy is written a moment after a change
        await pg.reload(); await start(); await built()
        check('unsaved work brought back after a restart is still marked unsaved', await features() == 2 and await dirty()
              and (await pg.title()).startswith('kept.3dj *'), await pg.title())
        await pg.evaluate("window.__3dj.commands.saveDoc()")
        await pg.wait_for_function('!window.__3dj.app.dirty', timeout=30000)
        await pg.reload(); await start(); await built()
        check('a saved project comes back without the star', await features() == 2 and not await dirty(), await pg.title())
        await pg.evaluate('window.__3dj.commands.newProject()'); await built()
        await change(); await pg.wait_for_timeout(3200)
        await pg.reload(); await start(); await built()
        check('a never-saved project comes back marked unsaved', await features() == 1 and await dirty()
              and await pg.evaluate('window.__3dj.app.file') is None)
        await ctx.close(); await b.close()
    srv.shutdown()
    check('no page errors', not errs, errs)
    raise SystemExit(0 if ok else 1)

asyncio.run(main())
