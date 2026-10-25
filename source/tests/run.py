import asyncio, sys, json, os
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
async def main():
    page_url = sys.argv[1] if len(sys.argv)>1 else __import__('pathlib').Path(HERE).parent.joinpath('local', '3DJames.html').as_uri()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
        ctx = await b.new_context(viewport={'width':1400,'height':860})
        pg = await ctx.new_page()
        errs=[]
        pg.on('console', lambda m: print(m.text, flush=True) if m.type == 'log' and m.text.startswith('TEST ') else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console.error: '+m.text) if m.type=='error' and 'ERR_FILE_NOT_FOUND' not in m.text else None)  # (the icons-folder check misses when there is no icons folder)
        ONLY = os.environ.get('ONLY', '')
        await ctx.add_init_script('window.__ONLY = ' + json.dumps(ONLY))
        await pg.goto(page_url)
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        await pg.add_script_tag(path=os.path.join(HERE,'suite.js'))
        res = await pg.evaluate('window.__runTests()')
        if ONLY:  # just the tests whose names contain this text
            for r in res: print(('PASS ' if r['ok'] else 'FAIL ')+r['name']+('' if r['ok'] else ' :: '+str(r.get('msg'))))
            for e in errs: print('PAGE', e[:300])
            await b.close(); sys.exit(1 if any(not r['ok'] for r in res) or errs else 0)
        # real mouse checks
        mouse = await pg.evaluate('window.__mouseSetup()')
        x,y = mouse['dbl']
        distance = await pg.evaluate('window.__3dj.vp.camera.position.distanceTo(window.__3dj.vp.orbit.target)')
        await pg.mouse.dblclick(x,y)
        try:
            await pg.wait_for_function('distance => window.__3dj.vp.camera.position.distanceTo(window.__3dj.vp.orbit.target) < distance * 0.6', arg=distance, timeout=10000)
        except Exception:
            pass  # The assertion below reports selection and camera distances if the animation failed.
        res += await pg.evaluate('window.__mouseCheck()')
        # handles: drag them with the real mouse
        async def drag(sel, dx, dy, idx=0):
            box = await pg.evaluate("([s,i])=>{const e=document.querySelectorAll(s)[i]; if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]}", [sel, idx])
            if not box: return False
            x, y = box
            await pg.mouse.move(x, y); await pg.mouse.down()
            for k in range(1, 13): await pg.mouse.move(x + dx * k / 12, y + dy * k / 12)
            await pg.mouse.up(); await pg.wait_for_timeout(1200)
            return True
        # objects snap flush: drag a box 1 mm toward its neighbour (gap 1.3 mm) and it should touch exactly
        sn = await pg.evaluate("window.__snapSetup()")
        (x0, y0), (x1, y1) = sn['at'], sn['to']
        await pg.mouse.move(x0, y0); await pg.mouse.down()
        for k in range(1, 11): await pg.mouse.move(x0 + (x1 - x0) * k / 10, y0 + (y1 - y0) * k / 10)
        await pg.mouse.up(); await pg.wait_for_timeout(2500)
        gap = await pg.evaluate("window.__snapGap()")
        res.append({'name': 'dragged objects snap flush with zero gap', 'ok': abs(gap) < 1e-6, 'msg': f'gap {gap}'})
        await pg.evaluate("window.__handleSetup()")
        await pg.wait_for_timeout(1500)
        async def check(name, found, expr):
            ok = found and await pg.evaluate(expr)
            res.append({'name': name, 'ok': bool(ok), 'msg': '' if ok else await pg.evaluate("JSON.stringify(window.__h())")})
        await check('lift arrow raises the object', await drag('.hud svg.lift path.grab', 0, -60), "window.__h().z > 1")
        await check('side arrow slides the object', await drag('.hud svg.slide[data-ax="0"]:not([style*="none"]) path.grab', -80, 0), "Math.abs(window.__h().x) > 1")
        await pg.evaluate("window.__handleSetup()"); await pg.wait_for_timeout(1500)
        await check('front-back arrow slides the object', await drag('.hud svg.slide[data-ax="1"]:not([style*="none"]) path.grab', 40, 40), "Math.abs(window.__h().y) > 1 && Math.abs(window.__h().x) < 0.01")
        await check('a move arrow on every side (6), the side ones at the middle height', True, "document.querySelectorAll('.hud svg.hmove').length === 6 && document.querySelectorAll('.hud svg.lift').length === 2")
        await pg.evaluate("window.__3dj.commands.setGizmo('scale')"); await pg.wait_for_timeout(500)
        await check('corner dot sizes the object', await drag('.hud .hdot', -60, -60, 0), "window.__h().w > 41")
        await pg.evaluate("window.__3dj.commands.setGizmo('rotate')"); await pg.wait_for_timeout(500)
        await check('turning arrow turns the object', await drag('.hud svg.hrot path.grab', 60, 40, 0), "window.__h().turned")
        await pg.evaluate("window.__3dj.commands.setGizmo('translate'); window.__3dj.commands.startTool('split')"); await pg.wait_for_timeout(600)
        await check('split plane arrow moves the cut', await drag('.hud svg.lift', 0, -25), "Math.abs(window.__3dj.app.tool.off) > 0.5")
        screenshot = __import__('pathlib').Path(HERE).parent / 'dist' / 'test-final.png'
        screenshot.parent.mkdir(exist_ok=True)
        await pg.screenshot(path=str(screenshot))
        fails=[r for r in res if not r['ok']]
        for r in res: print(('PASS ' if r['ok'] else 'FAIL ')+r['name']+('' if r['ok'] else ' :: '+str(r.get('msg'))))
        for e in errs: print('PAGE', e[:300])
        print(f"\n{len(res)-len(fails)}/{len(res)} passed, {len(errs)} page errors")
        await b.close()
        sys.exit(1 if fails or errs else 0)
asyncio.run(main())
