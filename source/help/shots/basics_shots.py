# Pictures for Help: Spin around step by step (spin-1..5), the View tab (view-tab), History with Variables
# (history-vars) and the Objects list (objects-list). Run after build.py:  python help/shots/basics_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, save

FULL = (0, 0, 1280, 720)
OUTLINE = "{type:'poly', pts:[[-30,0],[58,0],[58,10],[35,22],[35,32],[12,32],[-21,65],[-30,65]], bulge:[0,0,0,0,0,0.414214,0,0]}"


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate

        # ---- Spin around, step by step
        await ev(f"""async()=>{{ __3dj.app.settings.panelOpen=false; __3dj.commands.renderAll();
          window.__k=__3dj.commands.startSketch({{ start: [{OUTLINE}] }}); await new Promise(r=>setTimeout(r,300));
          __k.setTool('select'); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,250)); }}""")
        await pg.mouse.move(5, 300)
        gx, gy = await ev("()=>__k.screenOf([0, 40])")
        im = await shot(pg)
        arrow(im, (gx + 260, gy + 120), (gx + 6, gy), 'The green line: what\nit spins around', side='right')
        save(im, 'spin-1.jpg', crop=FULL)
        btn = await ev("()=>{ const c=[...document.querySelectorAll('.sketch .sk-side .chip')].find(x=>x.textContent==='Right of green line'); const r=c.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
        im = await shot(pg)
        ring(im, btn, pad=6)
        arrow(im, (btn[0] - 150, btn[1] + 130), (btn[0] - 8, btn[1] + btn[3] / 2), 'Click this', side='left')
        save(im, 'spin-2.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('.sketch .sk-side .chip')].find(x=>x.textContent==='Right of green line').click()")
        await pg.wait_for_timeout(200)
        gx, gy = await ev("()=>__k.screenOf([0, 40])")
        im = await shot(pg)
        arrow(im, (gx + 300, gy + 150), (gx + 6, gy + 6), 'Now it touches the green line.\nThen click Done', side='right')
        ring(im, await box(pg, '.sketch .btn.primary'), pad=5)
        save(im, 'spin-3.jpg', crop=FULL)
        await ev("()=>document.querySelector('.sketch .btn.primary').click()"); await pg.wait_for_timeout(300)
        await ev("()=>[...document.querySelectorAll('dialog.modal .seg button')].find(x=>x.textContent==='Spin around').click()"); await pg.wait_for_timeout(150)
        im = await shot(pg)
        ring(im, await box(pg, 'dialog.modal'), pad=6)
        save(im, 'spin-4.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('dialog.modal button')].find(x=>x.textContent==='OK').click()")
        await pg.wait_for_function("()=>!__3dj.app.building && __3dj.app.results.bodies.size>=1", timeout=60000)
        await ev("()=>{ __3dj.app.settings.panelOpen=true; __3dj.commands.openPanel('props'); __3dj.commands.renderAll(); }")
        await pg.keyboard.press('f'); await pg.wait_for_timeout(800)
        im = await shot(pg, 600)
        save(im, 'spin-5.jpg', crop=FULL)

        # ---- the View tab
        await ev("()=>{ __3dj.commands.newProject?.(); }"); await pg.wait_for_timeout(600)
        if await ev("()=>!!document.querySelector('dialog.modal')"):
            await ev("()=>{ const bs=[...document.querySelectorAll('dialog.modal button')]; (bs.find(x=>/Don.t save|Discard|without/i.test(x.textContent))||bs[bs.length-1]).click(); }")
            await pg.wait_for_timeout(600)
        await ev("()=>{ __3dj.commands.addShape('box'); }"); await pg.wait_for_timeout(1500)
        await ev("()=>{ __3dj.app.sel=[]; __3dj.commands.renderAll(); }"); await pg.keyboard.press('f'); await pg.wait_for_timeout(800)
        await pg.get_by_role('tab', name='View', exact=True).click(); await pg.wait_for_timeout(300)
        im = await shot(pg)
        row = await box(pg, '#cmdbar')
        ring(im, [row[0] + 4, row[1] + 2, row[2] - 8, row[3] - 4], pad=3)
        save(im, 'view-tab.jpg', crop=FULL)

        # ---- History with Variables, and the Objects list (on the example bracket, if the app starts with it)
        await pg.get_by_role('tab', name='Insert', exact=True).click()
        await ev("""async()=>{ const d=__3dj.store.doc; if (!d.vars.length) __3dj.store.commit((x)=>{ x.vars.push({name:'wall', expr:'3'}); });
          const ids=[...__3dj.app.results.bodies.keys()]; __3dj.app.sel=[ids[0]]; __3dj.app.historyAll=false; __3dj.commands.openPanel('history'); __3dj.commands.renderAll(); }""")
        await pg.wait_for_timeout(800)
        im = await shot(pg)
        ring(im, await box(pg, '#vars'), pad=4)
        save(im, 'history-vars.jpg', crop=FULL)
        await ev("()=>{ __3dj.commands.addShape('cyl'); }"); await pg.wait_for_timeout(1500)
        await ev("()=>{ window.__keep=__3dj.app.sel.slice(); __3dj.app.sel=[]; __3dj.commands.renderAll(); }")
        await pg.keyboard.press('f'); await pg.wait_for_timeout(800)
        await ev("()=>{ __3dj.app.sel=window.__keep; __3dj.commands.renderAll(); }")
        await ev("()=>{ __3dj.commands.openPanel('objects'); __3dj.commands.renderAll(); }"); await pg.wait_for_timeout(500)
        im = await shot(pg)
        ring(im, await box(pg, '.side-body'), pad=2)
        save(im, 'objects-list.jpg', crop=FULL)
        assert not errs, errs
        await b.close()

asyncio.run(main())
