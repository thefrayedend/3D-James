# Picture for Help (Sketch on a face or curved surface > On a mesh): the board opened on the flat top of an imported STL
# (tests/fixtures/stl/block.stl), its outline and pocket dashed.   Run after build.py:  python help/shots/mesh_shots.py
import asyncio, base64, os
from playwright.async_api import async_playwright
from markup import open_app, shot, save

FIX = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'fixtures', 'stl', 'block.stl')
BUILT = '() => { const {app, store} = window.__3dj; return !app.building && !app.pending && app.builtRevision === store.revision; }'


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate
        await ev("()=>{ __3dj.commands.newProject(); }"); await pg.wait_for_timeout(500)
        data = base64.b64encode(open(FIX, 'rb').read()).decode()
        await ev('''([b64]) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); __3dj.commands.openFile(new File([bytes], 'block.stl'), null); }''', [data])
        await pg.get_by_role('button', name='Keep as a mesh').click(timeout=60000)
        await pg.wait_for_function(BUILT, timeout=120000); await pg.wait_for_timeout(500)
        await pg.get_by_role('tab', name='Insert', exact=True).click()
        await pg.get_by_role('button', name='Sketch').click(); await pg.get_by_text('On a surface…').click()
        bb = await ev("()=>[...__3dj.app.results.bodies.values()][0].bbox")
        for fx, fy in [(0.5, 0.5), (0.3, 0.5), (0.7, 0.5), (0.5, 0.3), (0.2, 0.2), (0.8, 0.8)]:
            w = [bb[0][0] + (bb[1][0] - bb[0][0]) * fx, bb[0][1] + (bb[1][1] - bb[0][1]) * fy, bb[1][2]]
            s = await ev(f"()=>{{ const q=__3dj.vp.toScreen(new (__3dj.vp.camera.position.constructor)({w[0]},{w[1]},{w[2]})); return [q.x,q.y]; }}")
            await pg.mouse.move(s[0], s[1]); await pg.wait_for_timeout(250)
            if await ev("()=>{ const h=__3dj.vp.pick?.hover; return !!h?.area && h.area.n[2] > 0.99; }"): break
        await pg.mouse.click(s[0], s[1]); await pg.wait_for_timeout(1500)
        await ev("()=>document.querySelectorAll('.toast').forEach((t)=>t.remove())")
        save(await shot(pg, 600), 'mesh-sketch.jpg')
        print('errors:', errs)
        await b.close()

asyncio.run(main())
