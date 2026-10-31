# A picture of every ready-made part (a contact sheet) from the real app, to look at them:
#   python tests/parts_sheet.py [kind ...]      -> dist/parts-sheet.png (and dist/parts-sheet-<n>.png when there are many)
# Uses the same cases as tests/parts.mjs (tests/parts.cases.json), one picture per case.
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / 'tests/parts.cases.json').read_text(encoding='utf-8'))
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
only = sys.argv[1:]
PER_SHEET = 20; COLS = 5; CELL = (360, 300)

async def main():
  cases = [c for c in CASES if not only or c[0] in only]
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1100, 'height': 760})).new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto((ROOT / 'local/3DJames.html').as_uri())
    await pg.wait_for_function(READY, timeout=120000)
    shots = []
    for kind, extra, _, note in cases:
      info = await pg.evaluate('''async ([kind, extra, view]) => {
        const B = window.__3dj, C = B.commands, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const built = async () => { await sleep(60); for (let i = 0; i < 3000; i++) { if (!B.app.building && !B.app.pending) { await sleep(40); if (!B.app.building && !B.app.pending) return; } await sleep(30); } };
        C.newProject(); await built();
        const id = C.addShape(kind, extra); await built();
        B.app.sel = []; B.vp.setSelection([]); C.renderAll();
        B.vp.anim = null; B.vp.view(view, false); B.vp.view('fit', false); await sleep(250);
        return { errors: Object.values(B.app.results.errors), hole: !!B.store.doc.bodies[id].hole };
      }''', [kind, extra, os.environ.get('VIEW', 'home')])
      el = pg.locator('#view canvas.gl')
      png = await el.screenshot()
      img = Image.open(__import__('io').BytesIO(png)).convert('RGB')
      shots.append((f'{kind}  {note or ""}' + ('  [hole]' if info['hole'] else '') + ('  ERROR ' + info['errors'][0][:40] if info['errors'] else ''), img))
      print(('ERR ' if info['errors'] else 'ok  ') + kind, note or '')
    out = ROOT / 'dist'; out.mkdir(exist_ok=True)
    for n in range(0, len(shots), PER_SHEET):
      chunk = shots[n:n + PER_SHEET]; rows = (len(chunk) + COLS - 1) // COLS
      sheet = Image.new('RGB', (COLS * CELL[0], rows * CELL[1]), 'white'); d = ImageDraw.Draw(sheet)
      for i, (label, img) in enumerate(chunk):
        x, y = (i % COLS) * CELL[0], (i // COLS) * CELL[1]
        w, h = img.size; k = min(CELL[0] / w, (CELL[1] - 22) / h) * 1.0
        # crop the middle of the view to where the part is (the view is fitted to it)
        im = img.resize((int(w * k), int(h * k)))
        sheet.paste(im, (x + (CELL[0] - im.size[0]) // 2, y + 20)); d.text((x + 6, y + 4), label[:56], fill='black'); d.rectangle([x, y, x + CELL[0] - 1, y + CELL[1] - 1], outline='#bbbbbb')
      name = 'parts-sheet.png' if len(shots) <= PER_SHEET else f'parts-sheet-{n // PER_SHEET + 1}.png'
      sheet.save(out / name); print('wrote', out / name)
    await b.close()
  if errors: print('page errors:', errors); sys.exit(1)
asyncio.run(main())
