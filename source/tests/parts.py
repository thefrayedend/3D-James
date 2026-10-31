# Ready-made parts (Insert > Parts): every part builds in the real geometry engine (tests/parts.mjs: sizes, holes, moving
# pieces that stay separate, a Gridfinity bin that fits its baseplate, every Parts menu item), and the Parts menu works
# with the real mouse: sections and flyouts, adding a part, changing its numbers in Properties, size presets, parts that
# are holes, Undo, sizing, and saving and opening a project that holds one.
#   python tests/parts.py
import asyncio, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {info}'))
  if not ok: fails.append(name)

JS = '''
  window.__wait = async () => { const { app, store: S } = window.__3dj; const t = Date.now();
    while (app.building || app.pending || app.builtRevision !== S.revision) { if (Date.now() - t > 120000) throw Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
  window.__last = () => { const { store: S } = window.__3dj; const f = [...S.doc.features].reverse().find((x) => x.type === 'shape'); return f; };
  window.__size = (id) => { const b = window.__3dj.app.results.bodies.get(id).bbox; return [0, 1, 2].map((i) => +(b[1][i] - b[0][i]).toFixed(2)); };
'''

async def main():
  # 1. the engine, without a browser
  r = subprocess.run(['node', str(ROOT / 'tests/parts.mjs')], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
  tail = r.stdout.strip().splitlines()
  bad = [l for l in tail if l.startswith('FAIL')]
  check(f'every part and every Parts menu item builds in the engine ({tail[-1] if tail else "no output"})', r.returncode == 0 and not bad, '\n'.join(bad[:8]) or r.stderr[-300:])

  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await (await b.new_context(viewport={'width': 1440, 'height': 900})).new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto((ROOT / 'local/3DJames.html').as_uri())
    await pg.wait_for_function(READY, timeout=120000)
    await pg.evaluate('()=>{' + JS + '}')
    ev = pg.evaluate
    await ev('async () => { window.__3dj.commands.newProject(); await __wait(); }')
    await pg.get_by_role('tab', name='Insert', exact=True).click()

    async def open_item(*path):
      """Insert > Parts > section > ... > item, by clicking (each flyout opens beside the one before)."""
      await pg.keyboard.press('Escape')
      await pg.get_by_role('button', name='Parts', exact=True).click()
      for i, name in enumerate(path):
        menu = pg.locator('.menu') if i == 0 else pg.locator(f'.menu.sub[data-level="{i}"]')
        await menu.locator('.mi', has_text=name).first.click()
      await ev('async () => { await __wait(); }')

    # 2. the menu: a section, a flyout inside it, an item
    await open_item('Organizing', 'Gridfinity bin', '2 × 2 × 3')
    f = await ev('() => ({ kind: __last().kind, p: __last().p })')
    check('Parts > Organizing > Gridfinity bin > 2 × 2 × 3 adds a 2 × 2 × 3 bin', f['kind'] == 'gfbin' and f['p']['nx'] == 2 and f['p']['ny'] == 2 and f['p']['nz'] == 3, f)
    id1 = await ev('() => window.__3dj.app.sel[0]')
    sz = await ev('(id) => __size(id)', id1)
    check('the bin is 83.5 × 83.5 × 21 mm and builds without errors', abs(sz[0] - 83.5) < 0.1 and abs(sz[2] - 21) < 0.1 and not await ev('() => Object.keys(window.__3dj.app.results.errors).length'), sz)
    check('its name says what it is', 'Gridfinity bin' in await ev('(id) => window.__3dj.store.doc.bodies[id].name', id1))
    check('Properties opened with its numbers', await pg.get_by_label('Units wide (X, 42 mm each)', exact=True).is_visible())

    # 3. change a number in Properties
    box = pg.get_by_label('Units wide (X, 42 mm each)', exact=True)
    await box.fill('3'); await box.press('Tab')
    await ev('async () => { await __wait(); }')
    sz = await ev('(id) => __size(id)', id1)
    check('3 units wide makes it 125.5 mm wide', abs(sz[0] - 125.5) < 0.1, sz)
    undo0 = await ev('() => window.__3dj.store.undoStack.length')
    await ev('async () => { window.__3dj.store.undo(); await __wait(); }')
    check('Undo takes the change back', abs((await ev('(id) => __size(id)', id1))[0] - 83.5) < 0.1)

    # 4. a part that is a hole
    await open_item('Electronics', 'Board mounting holes (to cut)', 'Raspberry Pi')
    id2 = await ev('() => window.__3dj.app.sel[0]')
    check('a board hole pattern is a hole (gray, cut out when merged)', await ev('(id) => !!window.__3dj.store.doc.bodies[id].hole', id2))
    check('it says what to do with a hole', 'Subtract' in await ev('() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")'))

    # 5. a size preset: picking a fan size fills in its standard numbers
    await open_item('Electronics', 'Fan mount plate', '80 mm fan')
    id3 = await ev('() => window.__3dj.app.sel[0]')
    p80 = await ev('() => __last().p')
    check('a fan mount from the menu has the 80 mm numbers (71.5 mm holes, 4.3 mm screws)', p80['side'] == 80 and p80['spacing'] == 71.5 and p80['screw'] == 4.3, p80)
    await pg.locator('.field', has_text='Fan size (mm)').locator('select').select_option('40')
    await ev('async () => { await __wait(); }')
    p40 = await ev('() => __last().p')
    check('choosing 40 mm in Properties fills in the 40 mm numbers', p40['side'] == 40 and p40['spacing'] == 32 and p40['screw'] == 3.4, p40)
    check('and the plate is rebuilt 40 mm', (await ev('(id) => __size(id)', id3))[0] == 40)

    # 6. the part kinds with a choice that shows other numbers
    await open_item('Motion and gears', 'Helical gear', '20 teeth')
    id4 = await ev('() => window.__3dj.app.sel[0]')
    check('a helical gear shows its helix angle', await pg.get_by_label('Helix angle (degrees)', exact=True).is_visible())
    await pg.locator('.field', has_text='Kind').locator('select').select_option('spur')
    check('a spur gear does not', not await pg.get_by_label('Helix angle (degrees)', exact=True).is_visible())

    # 7. sizing in the bottom bar, like any shape: a part keeps its own numbers and is stretched
    await ev('async (id) => { const { app, vp, commands: C } = window.__3dj; app.sel = [id]; vp.setSelection([id]); C.renderAll(); C.setGizmo("scale"); await __wait(); }', id1)
    before = await ev('(id) => __size(id)', id1)
    await ev('async () => { window.__3dj.commands.barCommit(0, String(window.__3dj.app.results.bodies.get(window.__3dj.app.sel[0]).bbox[1][0] * 2 - window.__3dj.app.results.bodies.get(window.__3dj.app.sel[0]).bbox[0][0] * 2)); await __wait(); }')
    after = await ev('(id) => __size(id)', id1)
    check('sizing a part (all directions) makes it twice as big and it still builds', abs(after[0] - 2 * before[0]) < 0.2 and not await ev('() => Object.keys(window.__3dj.app.results.errors).length'), [before, after])
    await ev('() => { window.__3dj.commands.setGizmo("translate"); }')

    # 8. a project with parts in it saves and opens again
    kinds = await ev('() => window.__3dj.store.doc.features.filter((f) => f.type === "shape").map((f) => f.kind)')
    ok = await ev('''async () => { const C = window.__3dj.commands; const bytes = await C.buildFileData('3dj');
      C.newProject(); await __wait(); await C.openFile(new File([bytes], 'parts.3dj'), null); await __wait();
      return window.__3dj.store.doc.features.filter((f) => f.type === 'shape').map((f) => f.kind); }''')
    check('saved as a .3dj and opened again: the same parts come back', ok == kinds, [kinds, ok])
    check('and they still build', not await ev('() => Object.keys(window.__3dj.app.results.errors).length') and await ev('() => window.__3dj.app.results.bodies.size') == len(kinds))

    # 9. every section of the menu opens and has items
    await pg.keyboard.press('Escape')
    await pg.get_by_role('button', name='Parts', exact=True).click()
    sections = await ev('() => [...document.querySelectorAll(".menu .mi.has-sub")].map((b) => b.textContent.trim())')
    want = ['Organizing', 'Electronics', 'Joints', 'Wall mounting and cables', 'Knobs, handles and feet', 'Filament and printer', 'Motion and gears', 'Profiles, brackets and fasteners']
    check('the Parts menu has all the new sections', all(any(w in s for s in sections) for w in want), sections)
    await pg.keyboard.press('Escape')
    check('no page errors', not errors, errors)
    await b.close()
  print(f'\n{len(fails)} failed' if fails else '\nall passed')
  sys.exit(1 if fails else 0)
asyncio.run(main())
