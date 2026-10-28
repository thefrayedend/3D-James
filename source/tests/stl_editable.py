# Make editable in the real app: open an STL, answer "Make editable" with the mouse, check the steps are
# sketches with no errors, that changing a sketch changes the model, that Undo gives the mesh back and that the
# result survives a .3dj save and reopen.   python tests/stl_editable.py [file.stl ...]
import asyncio, base64, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
HERE = Path(__file__).resolve().parent
FIX = HERE / 'fixtures' / 'stl'
FILES = [Path(a) for a in sys.argv[1:]] or sorted(FIX.glob('*.stl'))
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.goto(HERE.parent.joinpath('local/3DJames.html').as_uri())
    await page.wait_for_function(READY, timeout=120000)
    results = []
    for f in FILES:
      data = base64.b64encode(f.read_bytes()).decode()
      await page.evaluate('''async ([name, b64]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        window.__3dj.commands.openFile(new File([bytes], name), null);
      }''', [f.name, data])
      # the question comes up: click Make editable with the mouse
      await page.get_by_role('button', name='Make editable').click(timeout=60000)
      await page.wait_for_function('''() => { const { store, app } = window.__3dj;
        return !app.converting && store.doc.features.some((f) => f.kind === 'sketch') && !app.building && app.builtRevision === store.revision; }''', timeout=600000)
      shot = HERE.parent / 'dist' / f'stl_editable_{f.stem[:30]}.png'
      await page.screenshot(path=str(shot))
      r = await page.evaluate('''async () => {
        const { store: S, app, commands: C } = window.__3dj;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const built = async () => { while (app.building || app.pending || app.builtRevision !== S.revision) await sleep(20); };
        const dialog = document.querySelector('dialog.modal')?.innerText || '';
        document.querySelectorAll('dialog.modal .btn.primary').forEach((x) => x.click());
        const sk = S.doc.features.filter((f) => f.kind === 'sketch');
        const vol = () => [...app.results.bodies.values()].filter((b) => !S.doc.bodies[b.id]?.hole).reduce((s, b) => s + b.volume, 0);
        const out = { steps: S.doc.features.length, sketches: sk.length, imports: S.doc.features.filter((f) => f.kind === 'import').length, errors: { ...app.results.errors }, dialog, volume: vol() };
        // change the first sketch: push it up 1 mm further (or spin a larger profile), the model must follow
        const f0 = sk[0];
        S.commit((d) => { const g = d.features.find((x) => x.id === f0.id); if (g.p.mode === 'revolve') g.p.loops[0].pts = g.p.loops[0].pts.map(([x, y]) => [x * 1.05, y]); else g.p.h = +g.p.h + 1; });
        await built();
        out.changed = vol(); out.errorsAfterChange = { ...app.results.errors };
        S.undo(); await built();
        out.afterUndo = vol(); out.errorsAfterUndo = { ...app.results.errors };
        // (the same steps; a big model rebuilt can come out cut into slightly different triangles for the screen)
        out.backToConverted = Math.abs(out.afterUndo - out.volume) < out.volume * 1e-4;
        S.undo(); await built();
        out.undoGivesMesh = S.doc.features.some((f) => f.kind === 'import') && !S.doc.features.some((f) => f.kind === 'sketch');
        S.redo(); await built();
        const bytes = await C.buildFileData('3dj');
        await C.openFile(new File([bytes], 'roundtrip.3dj'), null); await built();
        out.reopened = S.doc.features.filter((f) => f.kind === 'sketch').length === sk.length && !Object.keys(app.results.errors).length;
        return out;
      }''')
      r['file'] = f.name
      r['ok'] = (not r['errors'] and r['sketches'] > 0 and abs(r['changed'] - r['volume']) > 1e-6 and not r['errorsAfterChange']
                 and r['backToConverted'] and r['undoGivesMesh'] and r['reopened'] and 'editable' in r['dialog'])
      print(json.dumps(r), flush=True)
      results.append(r)
    await b.close()
    bad = [r for r in results if not r['ok']]
    print(f'{len(results) - len(bad)}/{len(results)} files OK; page errors: {errors}')
    sys.exit(1 if bad or errors else 0)

asyncio.run(main())
