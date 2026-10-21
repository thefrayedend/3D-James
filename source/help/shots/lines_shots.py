# Pictures for the help page "Sketch: draw your own outline": lines that stop anywhere, carry on later and join up
# (lines-1..4), and taking a side out of a finished outline (redraw-1..3).
# Real app screenshots with real mouse clicks, marked up. Run after build.py:  python help/shots/lines_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, num, circle, save

FULL = (0, 0, 1280, 720)

async def board(pg, setup=''):
    await pg.evaluate("""async(setup)=>{ const C=__3dj.commands; document.querySelector('.sketch') && window.__k?.close();
      C.newProject(); await new Promise(r=>setTimeout(r,700)); __3dj.app.settings.panelOpen=false; __3dj.app.settings.skFold={}; C.renderAll();
      window.__k = C.startSketch(); await new Promise(r=>setTimeout(r,300)); (new Function(setup))();
      document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,200)); }""", setup)

async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        at = lambda x, y: pg.evaluate(f"()=>__k.screenOf([{x},{y}])")
        async def click(x, y): sx, sy = await at(x, y); await pg.mouse.click(sx, sy)
        async def hover(x, y): sx, sy = await at(x, y); await pg.mouse.move(sx, sy)

        # ---- lines-1: a line stopped halfway stays open, with orange ends
        await board(pg, "__k.setTool('line');")
        await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 250); await pg.wait_for_timeout(200)
        for q in [(0, 0), (50, 0), (50, 30)]: await click(*q)
        await pg.keyboard.press('Escape'); await pg.mouse.move(5, 300)
        im = await shot(pg)
        a = await at(0, 0); e = await at(50, 30); st = await box(pg, '.sk-status')
        circle(im, a, 26); circle(im, e, 26)
        arrow(im, (a[0] - 30, a[1] + 140), (a[0] - 6, a[1] + 22), 'Orange ring: a loose end.\nClick it with Line or Arc\nto carry on from there', side='right')
        arrow(im, (e[0] - 70, e[1] - 110), (e[0] - 14, e[1] - 16), 'Esc or Enter stopped\nthe line here', side='left')
        ring(im, st, pad=5)
        save(im, 'lines-1.jpg', crop=FULL)

        # ---- lines-2: draw from one loose end to another: they join into one line
        await board(pg, "__k.setTool('line');")
        await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 250); await pg.wait_for_timeout(200)
        for q in [(0, 0), (50, 0), (50, 30)]: await click(*q)
        await pg.keyboard.press('Escape')
        for q in [(0, 30), (-15, 15)]: await click(*q)
        await pg.keyboard.press('Escape')
        await click(50, 30); await hover(0, 30); await pg.wait_for_timeout(4800)  # let the note at the top go away
        im = await shot(pg)
        s1 = await at(50, 30); s2 = await at(0, 30)
        num(im, (s1[0] + 30, s1[1] - 30), 1); num(im, (s2[0] - 30, s2[1] - 30), 2)
        arrow(im, (s1[0] + 170, s1[1] + 120), (s1[0] + 14, s1[1] + 12), '1  Click a loose end', side='right')
        arrow(im, (s2[0] - 70, s2[1] + 190), (s2[0] - 8, s2[1] + 14), '2  Click the loose end\nof the other line', side='left')
        save(im, 'lines-2.jpg', crop=FULL)
        # ---- lines-3: they are one line now; closing its two ends makes one outline
        await click(0, 30)
        n = await pg.evaluate("()=>__k.loops.length")
        assert n == 1, 'the lines should have joined into one'
        await click(-15, 15); await hover(0, 0)
        im = await shot(pg)
        s1 = await at(-15, 15); s2 = await at(0, 0)
        arrow(im, (s2[0] - 120, s2[1] + 130), (s2[0] - 10, s2[1] + 12), 'Click the last loose end:\none closed outline', side='left')
        save(im, 'lines-3.jpg', crop=FULL)
        await click(0, 0)
        L = await pg.evaluate("()=>JSON.parse(JSON.stringify(__k.loops))")
        assert len(L) == 1 and L[0]['type'] == 'poly' and len(L[0]['pts']) == 5, L

        # ---- lines-5: near a loose end, the pointer is pulled onto it (the dashed pull zone)
        await board(pg, "__k.setTool('line');")
        await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 250); await pg.wait_for_timeout(200)
        for q in [(0, 0), (50, 0), (50, 30), (10, 30)]: await click(*q)
        await pg.keyboard.press('Escape')
        await click(-12, 18); await pg.keyboard.down('Alt'); await hover(-4, 5); await pg.wait_for_timeout(4800)
        im = await shot(pg); await pg.keyboard.up('Alt')
        e0 = await at(0, 0); cz = await at(-4, 5)
        arrow(im, (e0[0] - 30, e0[1] + 190), (e0[0] - 6, e0[1] + 16), 'Holding Alt: inside the\ndashed circle the point\ngoes onto the loose end.\nPull back to let go', side='left')
        save(im, 'lines-5.jpg', crop=FULL)
        await pg.keyboard.press('Escape')

        # ---- lines-4: Done with a line still open asks what to do
        await board(pg, "__k.setTool('line');")
        await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 250); await pg.wait_for_timeout(200)
        for q in [(0, 0), (50, 0), (50, 30), (10, 30)]: await click(*q)
        await pg.keyboard.press('Escape'); await pg.mouse.move(5, 300)
        await pg.evaluate("()=>__k.finish()")
        im = await shot(pg)
        ring(im, await box(pg, 'dialog.modal'), pad=6)
        save(im, 'lines-4.jpg', crop=FULL)
        await pg.evaluate("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Keep drawing').click()")

        # ---- redraw-1..3: take the top side out of a rectangle and draw an arc in its place
        await board(pg, "__k.loops.push({type:'poly', pts:[[0,0],[60,0],[60,40],[0,40]]}); __k.addRule('flat',{l:0,i:0}); __k.setLength(0,0,60); __k.setTool('select'); __k.pick(null);")
        await pg.mouse.move(500, 420); await pg.mouse.wheel(0, 300); await pg.wait_for_timeout(300)
        x, y = await at(15, 40); await pg.mouse.click(x, y)
        im = await shot(pg)
        db = await box(pg, '.sk-delseg')
        ring(im, db, pad=5)
        arrow(im, (x + 60, y + 120), (x + 4, y + 6), '1  Select tool:\nclick the side', side='right')
        arrow(im, (db[0] + 120, db[1] + 170), (db[0] + db[2] / 2, db[1] + db[3] + 4), '2  Delete segment\n(or press Delete)', side='right')
        save(im, 'redraw-1.jpg', crop=FULL)
        await pg.click('.sk-delseg')
        await pg.keyboard.press('a')
        await click(0, 40); await hover(30, 58)
        await pg.wait_for_timeout(5200)
        im = await shot(pg)
        g = await at(60, 40); d = await at(0, 40); c = await at(30, 58)
        num(im, (g[0] + 26, g[1] - 26), 1); num(im, (d[0] - 26, d[1] - 26), 2); num(im, (c[0] + 26, c[1] + 26), 3)
        arrow(im, (g[0] - 40, g[1] + 230), (g[0] - 6, g[1] + 14), 'The new part starts\nat this open end', side='left')
        arrow(im, (d[0] + 40, d[1] + 90), (d[0] + 4, d[1] + 12), '2  Arc: click the orange end,\n3  then where it bends through', side='right')
        save(im, 'redraw-2.jpg', crop=FULL)
        await click(30, 58); await pg.mouse.move(5, 300)
        await pg.evaluate("()=>{__k.setTool('select'); __k.pick(null);}")
        im = await shot(pg)
        L = await pg.evaluate("()=>JSON.parse(JSON.stringify({loops:__k.loops,rules:__k.rules}))")
        assert len(L['loops']) == 1 and L['loops'][0]['type'] == 'poly' and any(L['loops'][0].get('bulge', [])), L
        assert sum(1 for r in L['rules'] if r['t'] in ('flat', 'length')) == 2, L
        save(im, 'redraw-3.jpg', crop=FULL)

        assert not errs, errs
        await b.close()
asyncio.run(main())
