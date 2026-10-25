# Pictures for Help: the main window (overview.jpg) and a cylinder dragged from the toolbar onto a cube (drag-shape.jpg).
# Run after build.py:  python help/shots/drag_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, save

FULL = (0, 0, 1280, 720)
WAIT = "async()=>{ for (let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,250)); while (__3dj.app.building) await new Promise(r=>setTimeout(r,100)); } }"


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        # the main window for Getting started (overview.jpg): the example bracket picked, Properties open, move arrows
        await ev(WAIT)
        if await ev("()=>__3dj.app.results.bodies.size > 0"):
            await ev("()=>{ const id=[...__3dj.app.results.bodies.keys()][0]; __3dj.app.settings.panelOpen=true; __3dj.app.sel=[id]; __3dj.vp.setSelection([id]); __3dj.commands.openPanel('props'); __3dj.commands.renderAll(); }"); await ev(WAIT)
            await pg.mouse.move(5, 400); im = await shot(pg, 800)
            save(im, 'overview.jpg', crop=FULL)
        await ev("()=>__3dj.commands.newProject()"); await ev(WAIT)
        await ev("()=>{ __3dj.app.settings.panelOpen=false; __3dj.commands.renderAll(); }"); await ev(WAIT)
        await ev("()=>{ __3dj.commands.addShape('box', { w: 40, d: 30, h: 15 }); }"); await ev(WAIT)
        await ev("()=>{ __3dj.app.sel=[]; __3dj.vp.setSelection([]); __3dj.commands.renderAll(); }"); await pg.keyboard.press('f'); await ev(WAIT)
        to = await ev("()=>{ const v=__3dj.vp.toScreen(new __3dj.vp.camera.position.constructor(0,0,15)); return [v.x, v.y]; }")
        btn = await box(pg, '#cmdbar .cb:nth-of-type(3)')
        cyl = await ev("()=>{ const b=[...document.querySelectorAll('#cmdbar .cb')].find(x=>x.textContent.trim()==='Cylinder').getBoundingClientRect(); return [b.x,b.y,b.width,b.height]; }")
        x0, y0 = cyl[0] + cyl[2] / 2, cyl[1] + cyl[3] / 2
        await pg.mouse.move(x0, y0); await pg.mouse.down()
        for k in range(1, 16): await pg.mouse.move(x0 + (to[0] - x0) * k / 15, y0 + (to[1] - y0) * k / 15); await pg.wait_for_timeout(25)
        im = await shot(pg, 400)
        ring(im, cyl, pad=5)
        arrow(im, (cyl[0] + cyl[2] / 2 + 10, cyl[1] + cyl[3] + 10), (to[0] - 30, to[1] - 40), None)
        arrow(im, (to[0] + 240, to[1] + 170), (to[0] + 30, to[1] + 20), 'Drag a shape from the toolbar:\nthe see-through shape shows\nwhere it lands (here on the cube)', side='right')
        save(im, 'drag-shape.jpg', crop=FULL)
        await pg.mouse.up()
        assert not errs, errs
        await b.close()

asyncio.run(main())
