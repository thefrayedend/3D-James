# Pictures for the Help page "More sketch tools" (tools-1..6): Trim, Slot / Polygon, Offset, Pattern, Import, Level.
# Run after build.py:  python help/shots/tools_shots.py
import asyncio, os, sys
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, num, save, SRC
sys.path.insert(0, os.path.join(SRC, 'tests'))
FULL = (0, 0, 1280, 720)


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        async def board(start='[]', tool='line'):
            await ev(f"""async()=>{{ document.querySelector('.sketch') && window.__k?.close(); window.__k=__3dj.commands.openSketch({start}, ()=>{{}}, 'Sketch', {{}}); await new Promise(r=>setTimeout(r,250)); __k.setTool('{tool}'); }}""")
            await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()"); await pg.wait_for_timeout(200)
        async def at(x, y): return await ev(f"()=>__k.screenOf([{x},{y}])")
        async def clicks(*pts):
            for q in pts: x, y = await at(*q); await pg.mouse.click(x, y); await pg.wait_for_timeout(40)
        tool = lambda k: box(pg, f'.sketch .sk-tool[data-tool="{k}"]')

        # 1: Trim: two overlapping shapes, the piece under the pointer in red
        await board('[{type:"poly",pts:[[0,0],[60,0],[60,40],[0,40]]},{type:"poly",pts:[[35,20],[95,20],[95,60],[35,60]]},{type:"circle",c:[95,20],r:12}]', 'trim')
        await clicks((60, 30))
        x, y = await at(47, 40); await pg.mouse.move(x - 40, y - 20); await pg.mouse.move(x, y); await pg.wait_for_timeout(100)
        im = await shot(pg)
        ring(im, await tool('trim'), pad=5)
        arrow(im, (x - 230, y - 150), (x - 6, y - 8), 'Trim: the piece under the\npointer turns red. Click\nand it is taken out', side='left')
        save(im, 'tools-1.jpg', crop=FULL)
        await clicks((47, 40), (35, 30), (47, 20), (95, 8), (89, 20), (95, 26))
        await pg.mouse.move(5, 5)
        im = await shot(pg)
        cx, cy = await at(70, 30)
        arrow(im, (cx + 260, cy + 170), (cx + 30, cy + 20), 'Trimmed: one outline\n(the circle bites a\nround corner out)', side='right')
        save(im, 'tools-2.jpg', crop=FULL)

        # 3: Slot and Polygon
        await board('[{type:"poly",pts:[[-50,-30],[50,-30],[50,30],[-50,30]]}]', 'slot')
        await clicks((-30, 10), (0, 10), (0, 15))
        await ev("()=>__k.setTool('polygon')")
        await clicks((30, 10)); await pg.keyboard.type('17'); await pg.keyboard.press('Enter')
        await ev("()=>__k.setTool('slot')")
        await clicks((-30, -12), (0, -12))
        x, y = await at(0, -16); await pg.mouse.move(x, y); await pg.wait_for_timeout(120)
        im = await shot(pg)
        ring(im, await tool('slot'), pad=5); ring(im, await tool('polygon'), pad=5)
        px, py = await at(30, 10)
        arrow(im, (px + 230, py - 140), (px + 40, py - 20), 'Polygon: 17 across flats\n(a hexagon for an M10 nut)', side='right')
        sx, sy = await at(-15, 10)
        arrow(im, (sx - 120, sy - 160), (sx - 10, sy - 30), 'Slot: two centers,\nthen the width', side='left')
        save(im, 'tools-3.jpg', crop=FULL)

        # 4: Offset: a wall inside an outline
        await board('[{type:"poly",pts:[[-40,-25],[40,-25],[40,25],[-40,25]],round:[8,8,8,8]}]', 'select')
        await ev("()=>__k.pick(0)"); await pg.wait_for_timeout(100)
        await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Offset…').click()")
        await pg.fill('dialog.modal input >> nth=0', '2')
        await ev("()=>[...document.querySelectorAll('dialog.modal .seg button')].find(b=>b.textContent==='Inside (smaller)').click()")
        await pg.wait_for_timeout(150)
        im = await shot(pg)
        ring(im, await box(pg, 'dialog.modal'), pad=6)
        save(im, 'tools-4.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Offset').click()")
        await pg.wait_for_function("()=>__k.loops.length===2", timeout=30000)
        await ev("()=>{ __k.pick(null); }"); await pg.mouse.move(5, 5)
        im = await shot(pg)
        wx, wy = await at(38, 0)
        arrow(im, (wx + 230, wy + 120), (wx + 8, wy), 'A 2 mm wall: the outline\nand its offset inside', side='right')
        save(im, 'tools-5.jpg', crop=FULL)

        # 6: Pattern: holes around a flange
        await board('[{type:"circle",c:[0,0],r:40},{type:"circle",c:[0,0],r:12},{type:"circle",c:[28,0],r:4}]', 'select')
        await ev("()=>__k.pick(2)"); await pg.wait_for_timeout(100)
        await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(c=>c.textContent==='Pattern…').click()")
        await ev("()=>[...document.querySelectorAll('dialog.modal .seg button')].find(b=>b.textContent==='In a circle').click()")
        await pg.fill('dialog.modal input >> nth=0', '6')
        await pg.wait_for_timeout(150)
        im = await shot(pg)
        ring(im, await box(pg, 'dialog.modal'), pad=6)
        save(im, 'tools-6.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Make copies').click()")
        await pg.mouse.move(5, 5)
        im = await shot(pg)
        save(im, 'tools-7.jpg', crop=FULL)

        # 8: Import a DXF
        from sketch_tools import dxf_text
        await board()
        await ev("()=>document.querySelectorAll('.toast').forEach(t=>t.remove())")
        await ev("(t)=>__k.importText('bracket.dxf', t)", dxf_text())
        await pg.wait_for_timeout(150)
        im = await shot(pg)
        ring(im, await box(pg, 'dialog.modal'), pad=6)
        ib = await ev("()=>{ const b=[...document.querySelectorAll('.sketch .sk-bar .cb')].find(x=>x.textContent==='Import'); const r=b.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
        ring(im, ib, pad=5)
        save(im, 'tools-8.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(b=>b.textContent==='Put it in the middle').click()")
        await pg.mouse.move(5, 5); await pg.wait_for_timeout(5200)
        im = await shot(pg)
        save(im, 'tools-9.jpg', crop=FULL)

        # 10: Level & upright while drawing
        await board('[]', 'line')
        await clicks((-30, -15), (20, -15), (20.6, 12)); await pg.keyboard.press('Escape')
        await clicks((20, 12))
        x, y = await at(-15, 12.7); await pg.mouse.move(x, y); await pg.wait_for_timeout(120)
        im = await shot(pg)
        arrow(im, (x - 60, y - 150), (x - 4, y - 12), 'Nearly level: it goes\nexactly level', side='left')
        bx, by = await at(-5, -15)
        arrow(im, (bx - 60, by + 150), (bx - 2, by - 16), 'Flat and Upright rules\n(badges): they stay so', side='left')
        save(im, 'tools-10.jpg', crop=FULL)
        assert not errs, errs
        await b.close()

asyncio.run(main())
