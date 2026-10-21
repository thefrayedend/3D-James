# Sketch: lines don't have to go back to where they started. Stop anywhere (Enter / Esc), carry on later from an
# orange end, and lines whose ends meet join into one (an outline once its two ends meet).
# Real mouse clicks and keys. Run after build.py:  python tests/sketch_lines.py
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = await b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    ev = pg.evaluate
    results = []
    def check(name, ok, info=''):
      results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:400]), flush=True)
    async def board(start='[]', owners=None):
      o = '{owners:' + json.dumps(owners) + '}' if owners else '{}'
      await ev(f"""async()=>{{ document.querySelector('.sketch') && window.__k?.close(); window.__done=null; window.__k=__3dj.commands.openSketch({start}, (l,r)=>{{window.__done={{l,r}}}}, 'Sketch', {o}); await new Promise(r=>setTimeout(r,250)); __k.setTool('line'); }}""")
      await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()"); await pg.wait_for_timeout(150)
    async def at(x, y): return await ev(f"()=>__k.screenOf([{x},{y}])")
    async def clicks(*pts):
      for q in pts: x, y = await at(*q); await pg.mouse.click(x, y)
    L = lambda: ev("()=>JSON.parse(JSON.stringify(__k.loops))")

    # 1. a line from point to point, stopped with Esc: it stays open (no side back to the start)
    await board()
    await clicks((0, 0), (20, 0), (20, 15))
    await pg.keyboard.press('Escape')
    ls = await L(); o = [l for l in ls if l['type'] == 'open']
    check('Esc stops the line where it is: an open line, not closed back to the start', len(o) == 1 and len(o[0]['pts']) == 3 and await ev("()=>!__k.drawing"), ls)
    check('the board says how many lines are unfinished', 'unfinished line' in await ev("()=>document.querySelector('.sk-status').textContent"))
    # 2. carry on from its orange end: the new part joins the same line
    await clicks((20, 15), (0, 15))
    await pg.keyboard.press('Enter')
    o = [l for l in await L() if l['type'] == 'open']
    check('starting on an orange end carries the same line on (Enter stops)', len(o) == 1 and len(o[0]['pts']) == 4, o)
    # 3. clicking the other orange end closes it into an outline
    await clicks((0, 15), (0, 0))
    ls = await L(); polys = [l for l in ls if l['type'] == 'poly' and len(l['pts']) == 4 and [0, 0] in l['pts'] and [20, 15] in l['pts']]
    check('joining the two ends makes one closed outline', len(polys) == 1 and not [l for l in ls if l['type'] == 'open'], ls)

    # 4. two separate lines joined by drawing between their ends become one line, then one outline
    await board()
    await clicks((0, 0), (30, 0), (30, 20)); await pg.keyboard.press('Escape')
    await clicks((0, 20), (-10, 10)); await pg.keyboard.press('Escape')
    check('two separate unfinished lines', len(await L()) == 2)
    await clicks((30, 20), (0, 20))
    ls = await L()
    check('a line drawn from one line end to another joins all three into one line', len(ls) == 1 and ls[0]['type'] == 'open' and len(ls[0]['pts']) == 5, ls)
    await clicks((-10, 10), (0, 0))
    ls = await L()
    check('closing the joined line makes one outline (not separate small ones)', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 5, ls)

    # 5. Done with an unfinished line: asked what to do; "Close with straight lines" closes it and finishes
    await board()
    await clicks((0, 0), (25, 0), (25, 25)); await pg.keyboard.press('Escape')
    await ev("()=>__k.finish()")
    check('Done with an unfinished line asks first', await ev("()=>!!document.querySelector('dialog.modal') && !window.__done"))
    check('no closed outline yet: no "Finish without them"', not await ev("()=>[...document.querySelectorAll('dialog.modal button')].some(b=>b.textContent==='Finish without them')"))
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Close with straight lines').click()")
    d = await ev("()=>window.__done && JSON.parse(JSON.stringify(window.__done.l))")
    check('closing with straight lines makes a triangle and finishes', d and len(d) == 1 and d[0]['type'] == 'poly' and len(d[0]['pts']) == 3, d)
    # with a closed outline as well: finish without the open line keeps it (not solid) for later
    await board('[{type:"poly",pts:[[0,0],[60,0],[60,40],[0,40]]}]')
    await clicks((20, 10), (40, 10), (40, 30)); await pg.keyboard.press('Escape')
    await ev("()=>__k.finish()")
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Finish without them').click()")
    d = await ev("()=>window.__done && JSON.parse(JSON.stringify(window.__done.l))")
    check('finish without them: the outline and the kept open line both go back', d and len(d) == 2 and sorted(l['type'] for l in d) == ['open', 'poly'], d)
    # "Keep drawing" leaves the board open
    await board()
    await clicks((0, 0), (25, 0)); await pg.keyboard.press('Escape')
    await ev("()=>__k.finish()")
    await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Keep drawing').click()")
    check('Keep drawing goes back to the board', await ev("()=>!!document.querySelector('.sketch') && !window.__done"))

    # 6. delete a side in the middle of an open line: two lines; a corner at its end: one side shorter
    await board()
    await clicks((0, 0), (10, 0), (20, 0), (30, 0), (40, 0)); await pg.keyboard.press('Escape')
    await pg.keyboard.press('s'); await clicks((12, 0)); await pg.keyboard.press('Delete')  # (not the middle: that is the bend diamond)
    ls = await L()
    check('deleting a side out of the middle splits the line in two', len(ls) == 2 and sorted(len(l['pts']) for l in ls) == [2, 3], ls)
    await ev("()=>__k.deletePoint(__k.loops.findIndex(l=>l.pts.length===3), 2)")
    ls = await L()
    check('deleting the end point of an open line makes it one side shorter', sorted(len(l['pts']) for l in ls) == [2, 2], ls)
    # Undo while drawing takes back the last point only
    await pg.keyboard.press('l'); await clicks((0, 30), (10, 30), (20, 30)); await pg.keyboard.press('Control+z')
    check('Undo while drawing takes back the last point', await ev("()=>__k.drawing && __k.drawing.pts.length===2"))
    # switching tools keeps the line drawn so far
    await pg.click('.sketch .sk-tool[data-tool="rect"]')
    check('switching tools keeps the line so far (open)', await ev("()=>!__k.drawing && __k.loops.some(l=>l.type==='open' && l.pts.length===2 && l.pts[0][1]===30)"))

    # 7. rules move along when lines join: a length rule on the first line still holds on the joined outline
    await board()
    await clicks((0, 0), (40, 0)); await pg.keyboard.press('Escape')
    await ev("()=>{__k.pickItems([{l:0,i:0}]); __k.pressRule('flat'); __k.setTool('line');}")
    await clicks((40, 0), (40, 20), (0, 20), (0, 0))
    ls = await L(); r = await ev("()=>JSON.parse(JSON.stringify(__k.rules))")
    fl = [x for x in r if x['t'] == 'flat']
    ok = len(ls) == 1 and ls[0]['type'] == 'poly' and fl and ls[0]['pts'][fl[0]['a']['i']][1] == 0 and ls[0]['pts'][(fl[0]['a']['i'] + 1) % 4][1] == 0
    check('a rule on a line stays on the same side after the line joins into an outline', ok, [ls, r])

    # 8. live mirror: half an outline from the green line and back, stopped with Esc, becomes the whole outline
    await board()
    await ev("()=>{__k.setLiveMirror(0); __k.setTool('line');}")
    await clicks((0, 0), (15, 0), (15, 10), (0, 20)); await pg.keyboard.press('Escape')
    ls = await L()
    check('live mirror: an open half from the green line and back becomes one whole outline', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 6, ls)
    await ev("()=>__k.setLiveMirror(null)")

    # 9. two sketches on one board: a line from one sketch joined to a line of the other becomes one outline
    await board('[{type:"open",pts:[[0,0],[30,0],[30,20]],owner:0},{type:"open",pts:[[0,20],[0,0]],owner:1}]', [{'name': 'A', 'color': '#2f6fdf'}, {'name': 'B', 'color': '#e8590c'}])
    await clicks((30, 20), (0, 20))
    ls = await L()
    check('lines from two sketches joined end to end become one outline in one sketch', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 4, ls)

    # 11. loose ends grab the pointer within 2 mm; holding Alt they reach 10 mm; Ctrl places a point with no snapping
    async def alt_clicks(*pts):
      await pg.keyboard.down('Alt')
      for q in pts: x, y = await at(*q); await pg.mouse.move(x, y); await pg.mouse.click(x, y)
      await pg.keyboard.up('Alt')
    await board()
    await clicks((0, 0), (40, 0), (40, 30)); await pg.keyboard.press('Escape')
    await clicks((1, 1))             # 1.4 mm from the loose end at 0,0: grabbed without any key
    d = await ev("()=>__k.drawing && JSON.parse(JSON.stringify(__k.drawing.pts))")
    check('a click 1.4 mm from a loose end lands on it (no key needed)', d and d[0] == [0, 0], d)
    await pg.keyboard.press('Escape')
    await board()
    await clicks((0, 0), (40, 0), (40, 30)); await pg.keyboard.press('Escape')
    await clicks((4, 3))             # 5 mm away, no Alt: a point of its own
    d = await ev("()=>__k.drawing && JSON.parse(JSON.stringify(__k.drawing.pts))")
    check('5 mm from a loose end without Alt: the point stays where it was clicked', d and d[0] != [0, 0], d)
    await pg.keyboard.press('Escape')
    await alt_clicks((4, 3)); await clicks((20, 20))
    d = await ev("()=>__k.drawing && JSON.parse(JSON.stringify(__k.drawing.pts))")
    check('holding Alt, a click 5 mm from a loose end starts exactly on it', d and d[0] == [0, 0], d)
    await alt_clicks((37, 33))       # 4 mm from the other loose end, Alt held: closes the outline
    ls = await L()
    check('holding Alt, a point 4 mm from the last loose end closes the outline', len(ls) == 1 and ls[0]['type'] == 'poly', ls)
    await board()
    await clicks((0, 0), (40, 0), (40, 30)); await pg.keyboard.press('Escape')
    x, y = await at(0.5, 0.5); await pg.keyboard.down('Control'); await pg.mouse.move(x, y); await pg.mouse.click(x, y); await pg.keyboard.up('Control')
    d = await ev("()=>__k.drawing && JSON.parse(JSON.stringify(__k.drawing.pts))")
    check('Ctrl places a point exactly where it is clicked (no snapping at all)', d and d[0] == [0.5, 0.5], d)
    await pg.keyboard.press('Escape')
    # pulling back away from the loose end lets go (Alt held): the point goes where you put it
    await board()
    await clicks((0, 0), (40, 0), (40, 30)); await pg.keyboard.press('Escape')
    await pg.keyboard.down('Alt')
    for q in [(12, 9), (8, 6), (4, 3), (1, 1), (2, 2), (4, 3)]: await pg.mouse.move(*(await at(*q)))
    x, y = await at(4, 3); await pg.mouse.click(x, y); await pg.keyboard.up('Alt')
    d = await ev("()=>__k.drawing && JSON.parse(JSON.stringify(__k.drawing.pts))")
    check('Alt held: coming close grabs the loose end, pulling back lets go and places the point near it', d and d[0] != [0, 0] and abs(d[0][0] - 4) < 1.1 and abs(d[0][1] - 3) < 1.1, d)
    await pg.keyboard.press('Escape')
    # Join close ends: lines a hair apart (an older drawing) are moved together and joined
    await board('[{type:"open",pts:[[0,0],[40,0],[40,30]]},{type:"open",pts:[[40.4,30.2],[0,30],[0.3,0.2]]}]')
    await ev("()=>__k.setTool('select')")
    await ev("()=>[...document.querySelectorAll('.sk-side .chip')].find(b=>b.textContent.startsWith('Join close ends')).click()")
    ls = await L()
    check('Join close ends turns two near-miss lines into one closed outline', len(ls) == 1 and ls[0]['type'] == 'poly' and len(ls[0]['pts']) == 4, ls)
    # dragging a loose end near another one (Alt held) joins them
    await board('[{type:"open",pts:[[0,0],[40,0],[40,30]]},{type:"open",pts:[[0,30],[10,30]]}]')
    await pg.keyboard.press('s')
    a = await at(10, 30); bpt = await at(37, 28)
    await pg.mouse.move(*a); await pg.mouse.down(); await pg.keyboard.down('Alt')
    for k in range(1, 11): await pg.mouse.move(a[0] + (bpt[0] - a[0]) * k / 10, a[1] + (bpt[1] - a[1]) * k / 10)
    await pg.mouse.up(); await pg.keyboard.up('Alt')
    ls = await L()
    check('dragging a loose end near another loose end (Alt held) joins the lines', len(ls) == 1 and ls[0]['type'] == 'open' and len(ls[0]['pts']) == 4, ls)

    # 12. Properties always offers Edit sketch for an object made from a sketch (also for sketches cut out of it)
    r = await ev("""async()=>{ document.querySelector('.sketch') && __k.close(); const C=__3dj.commands, A=__3dj.app; C.newProject(); await new Promise(r=>setTimeout(r,500));
      const wait=async()=>{ for(let i=0;i<300 && (A.building||A.pending||A.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50)); };
      const s=C.addShape('sketch',{loops:[{type:'poly',pts:[[0,0],[30,0],[30,20],[0,20]]}],h:5}); await wait();
      A.sel=[s]; A.feature=null; C.openPanel('props'); await new Promise(r=>setTimeout(r,100));
      const own=[...document.querySelectorAll('#props button')].map(b=>b.textContent.trim()).filter(t=>t.startsWith('Edit sketch'));
      const box=C.addShape('box',{w:40,d:40,h:10}); const cut=C.addShape('sketch',{loops:[{type:'circle',c:[0,0],r:4}],h:20},'Hole sketch'); await wait();
      A.sel=[box,cut]; C.combine('subtract'); await wait();
      A.sel=[box]; A.feature=null; C.openPanel('props'); await new Promise(r=>setTimeout(r,100));
      const cutBtns=[...document.querySelectorAll('#props button')].map(b=>b.textContent.trim()).filter(t=>t.startsWith('Edit sketch'));
      return {own, cutBtns}; }""")
    check('Properties shows Edit sketch for a sketch object without opening History', r['own'] == ['Edit sketch'], r)
    check('Properties shows Edit sketch for a sketch cut out of an object', len(r['cutBtns']) == 1 and r['cutBtns'][0].startswith('Edit sketch: '), r)

    # 10. the engine ignores open lines saved in a sketch (only closed outlines are solid)
    v = await ev("""async()=>{ document.querySelector('.sketch') && __k.close(); const C=__3dj.commands; C.newProject(); await new Promise(r=>setTimeout(r,500));
      const id=C.addShape('sketch',{loops:[{type:'poly',pts:[[0,0],[10,0],[10,10],[0,10]]},{type:'open',pts:[[20,0],[30,0],[30,10]]}],h:5});
      for(let i=0;i<200 && (__3dj.app.building||__3dj.app.pending||__3dj.app.builtRevision!==__3dj.store.revision);i++) await new Promise(r=>setTimeout(r,50));
      const d=__3dj.app.results.bodies.get(id); return {v:d?.volume, err:Object.values(__3dj.app.results.errors)}; }""")
    check('a saved sketch with an open line builds from its closed outline only', v and abs((v['v'] or 0) - 500) < 1 and not v['err'], v)

    for e in errs: print('PAGE', e[:300])
    n = sum(ok for _, ok in results)
    print(f'{n}/{len(results)} passed, {len(errs)} page errors')
    await b.close()
    raise SystemExit(0 if n == len(results) and not errs else 1)

asyncio.run(main())
