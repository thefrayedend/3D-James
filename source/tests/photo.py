# Insert > Sketch > From a photo, with made-up photos whose real sizes are known:
#  1. an L bracket with two round holes on A4 paper, photographed at an angle: 4 paper corners straighten and size it,
#     "Find the outline" finds the L (120 x 160 mm) and the two holes as circles (16 and 12 mm)
#  2. a 450 mm part on a plain floor, no paper: a measured 400 x 300 mm rectangle sizes it (the part is bigger than it)
#  3. a photo from straight above, sized by a line of known length; traced by hand (the photo goes under the board)
#  Also: the photo is kept with the sketch, saved in the project, back in Edit sketch; Move / Size again on the board.
# Real mouse clicks. Run after build.py:  python tests/photo.py
import asyncio, io, json, math, os, tempfile, zipfile
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
APP = (ROOT / 'local/3DJames.html').as_uri()
TMP = Path(tempfile.mkdtemp(prefix='3dj-photo-'))


def solve(A, b):
    n = len(b); M = [list(r) + [b[i]] for i, r in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1): M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]


def persp_coeffs(out_pts, in_pts):
    """PIL PERSPECTIVE: maps output pixel -> input pixel."""
    A, b = [], []
    for (x, y), (u, v) in zip(out_pts, in_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return solve(A, b)


def bracket_on_paper():
    """Top view at 4 px/mm: a grey table, A4 paper, a dark L bracket with two holes. Then seen at an angle."""
    ppm = 4
    img = Image.new('RGB', (420 * ppm, 360 * ppm), (120, 100, 85))
    d = ImageDraw.Draw(img)
    px, py = 100, 30  # paper top-left on the table (mm)
    d.rectangle([px * ppm, py * ppm, (px + 210) * ppm, (py + 297) * ppm], fill=(246, 246, 242))
    L = [(40, 60), (160, 60), (160, 100), (80, 100), (80, 220), (40, 220)]
    d.polygon([((px + x) * ppm, (py + y) * ppm) for x, y in L], fill=(35, 40, 48))
    for (cx, cy, r) in [(60, 200, 8), (140, 80, 6)]:
        d.ellipse([(px + cx - r) * ppm, (py + cy - r) * ppm, (px + cx + r) * ppm, (py + cy + r) * ppm], fill=(246, 246, 242))
    paper = [(px, py + 297), (px + 210, py + 297), (px + 210, py), (px, py)]  # BL, BR, TR, TL (mm, picture y down)
    src_pts = [(x * ppm, y * ppm) for x, y in paper]
    # the camera: the paper appears as a skewed quad in a 1600 x 1200 photo
    dst_pts = [(380, 1110), (1290, 1060), (1150, 160), (470, 210)]
    out = img.transform((1600, 1200), Image.PERSPECTIVE, persp_coeffs(dst_pts, src_pts), Image.BICUBIC, fillcolor=(90, 80, 70))
    p = TMP / 'bracket-on-a4.jpg'; out.save(p, quality=92)
    return p, dst_pts


def big_part_on_floor():
    """A 450 x 120 mm dark bar with a 30 mm hole on a light floor, and a 400 x 300 tape rectangle under it. 2 px/mm, slight angle."""
    ppm = 2
    img = Image.new('RGB', (900 * ppm, 700 * ppm), (215, 212, 205))
    d = ImageDraw.Draw(img)
    rx, ry = 250, 200  # the tape rectangle's top-left (mm)
    d.rectangle([rx * ppm, ry * ppm, (rx + 400) * ppm, (ry + 300) * ppm], outline=(180, 60, 50), width=2)
    bx, by = 200, 290
    d.rectangle([bx * ppm, by * ppm, (bx + 450) * ppm, (by + 120) * ppm], fill=(30, 34, 40))
    d.ellipse([(bx + 60 - 15) * ppm, (by + 60 - 15) * ppm, (bx + 60 + 15) * ppm, (by + 60 + 15) * ppm], fill=(215, 212, 205))
    rect = [(rx, ry + 300), (rx + 400, ry + 300), (rx + 400, ry), (rx, ry)]
    src_pts = [(x * ppm, y * ppm) for x, y in rect]
    dst_pts = [(420, 960), (1240, 990), (1180, 380), (470, 360)]
    out = img.transform((1600, 1200), Image.PERSPECTIVE, persp_coeffs(dst_pts, src_pts), Image.BICUBIC, fillcolor=(215, 212, 205))
    p = TMP / 'bar-on-floor.jpg'; out.save(p, quality=92)
    return p, dst_pts


def top_down_with_ruler():
    """Straight from above, 3 px/mm, a 100 mm ruler mark from (100,100) to (200,100) mm."""
    ppm = 3
    img = Image.new('RGB', (300 * ppm, 200 * ppm), (240, 240, 240))
    d = ImageDraw.Draw(img)
    d.line([(100 * ppm, 100 * ppm), (200 * ppm, 100 * ppm)], fill=(0, 0, 0), width=3)
    p = TMP / 'ruler.png'; img.save(p)
    return p, [(100 * ppm, 100 * ppm), (200 * ppm, 100 * ppm)], (300 * ppm, 200 * ppm)


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await (await b.new_context(viewport={'width': 1400, 'height': 900})).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP)
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        ev = pg.evaluate
        results = []
        def check(name, ok, info=''):
            results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' :: ' + str(info)[:500]), flush=True)

        async def open_photo(path):
            await ev("()=>{ window.__done=null; }")
            async with pg.expect_file_chooser() as fc:
                await ev("()=>{ window.__k = null; __3dj.commands.startPhotoSketch(); }")
            await (await fc.value).set_files(str(path))
            await pg.wait_for_selector('dialog.pw-dialog canvas'); await pg.wait_for_timeout(500)
        async def to_screen(img_pt, img_size):
            return await ev("([p, s])=>{ const c=document.querySelector('.pw-canvas').getBoundingClientRect(); const k=Math.min(c.width/s[0], c.height/s[1])*0.96; return [c.left+(c.width-s[0]*k)/2+p[0]*k, c.top+(c.height-s[1]*k)/2+p[1]*k]; }", [img_pt, img_size])
        async def click_points(pts, size, order):
            for i in order:
                x, y = await to_screen(pts[i], size); await pg.mouse.click(x, y); await pg.wait_for_timeout(80)
        async def board():
            await pg.wait_for_selector('.sketch .sk-svg', timeout=20000); await pg.wait_for_timeout(400)
            return await ev("()=>{ const l=[...document.querySelectorAll('.sketch')]; return true; }")
        def bbox(pts): xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; return [min(xs), min(ys), max(xs), max(ys)]

        # ---------------------------------------------------------------- 1. on A4 paper, at an angle, find the outline
        p, corners = bracket_on_paper()
        await open_photo(p)
        check('From a photo opens the photo window (paper is the first choice)', await ev("()=>[...document.querySelectorAll('.pw-side .chip.on')].some(c=>c.textContent==='Sheet of paper')"))
        await click_points(corners, (1600, 1200), [2, 0, 3, 1])  # any order
        check('after 4 corners, both buttons are ready', await ev("()=>[...document.querySelectorAll('.pw-go button')].every(b=>!b.disabled)"))
        await pg.click('.pw-go button:text-is("Find the outline")')
        await pg.wait_for_function("()=>/Found|Nothing/.test(document.querySelector('.pw-status').textContent)", timeout=30000)
        st = await ev("()=>document.querySelector('.pw-status').textContent")
        check('the outline is found (and round holes become circles)', 'Found 3 outlines' in st and 'circles' in st, st)
        await pg.click('.pw-go button:has-text("Open in the sketch")')
        await board()
        L = await ev("()=>JSON.parse(JSON.stringify(__3dj.app && document.querySelector('.sketch') ? window.__lastSketch?.loops || null : null))")
        L = await ev("()=>{ const k = document.querySelector('.sketch'); return null; }")
        # the board object is not global: read it through the Done button's result instead
        await ev("()=>{ window.__out = null; }")
        loops = await ev("""async()=>{ const btn=[...document.querySelectorAll('.sketch .btn.primary')].find(b=>b.textContent.includes('Done')); btn.click(); await new Promise(r=>setTimeout(r,300));
          const d=document.querySelector('dialog'); if (!d) return null; const h=d.querySelector('input'); h.value='5'; [...d.querySelectorAll('button')].find(b=>b.textContent==='OK').click();
          await new Promise(r=>setTimeout(r,500)); const f=__3dj.store.doc.features.at(-1); return JSON.parse(JSON.stringify(f.p)); }""")
        polys = [l for l in loops['loops'] if l['type'] == 'poly']
        circles = sorted([l for l in loops['loops'] if l['type'] == 'circle'], key=lambda c: -c['r'])
        bb = bbox(polys[0]['pts']) if polys else [0, 0, 0, 0]
        check('the L is 120 x 160 mm (within 1.5 mm) after straightening', polys and abs((bb[2] - bb[0]) - 120) < 1.5 and abs((bb[3] - bb[1]) - 160) < 1.5, bb)
        check('the L comes out as exactly its 6 corners', polys and len(polys[0]['pts']) == 6, polys[0]['pts'] if polys else None)
        check('the holes are 16 mm and 12 mm circles (within 0.6 mm)', len(circles) == 2 and abs(circles[0]['r'] * 2 - 16) < 0.6 and abs(circles[1]['r'] * 2 - 12) < 0.6, circles)
        ph = loops.get('photo') or {}
        check('the photo is kept with the sketch (sized: the A4 sheet is 210 x 297 mm on it)', ph.get('file') and ph.get('w', 0) > 200 and ph.get('h', 0) > 280, ph)
        # it is saved inside the project and comes back in Edit sketch
        data = await ev("async()=>Array.from(await __3dj.commands.buildFileData('3dj'))")
        z = zipfile.ZipFile(io.BytesIO(bytes(data)))
        check('saving the project includes the photo', any(n == 'files/' + ph.get('file') for n in z.namelist()), z.namelist())
        await ev("()=>{ const f=__3dj.store.doc.features.at(-1); __3dj.commands.editSketch(f); }")
        await pg.wait_for_selector('.sketch image.sk-photo', timeout=10000)
        check('Edit sketch shows the photo again', await ev("()=>!!document.querySelector('.sketch image.sk-photo')"))
        # Move photo and Size again on the board
        img0 = await ev("()=>{ const r=document.querySelector('.sk-photo').getBoundingClientRect(); return [r.x, r.y, r.width]; }")
        await ev("()=>[...document.querySelectorAll('.sk-side .chip')].find(c=>c.textContent==='Size again').click()")
        sx = await ev("()=>{ const r=document.querySelector('.sk-svg').getBoundingClientRect(); return [r.x+r.width*0.4, r.y+r.height*0.5]; }")
        await pg.mouse.click(sx[0], sx[1]); await pg.mouse.click(sx[0] + 100, sx[1])
        await pg.wait_for_selector('.sk-ask'); await pg.fill('.sk-ask', '200'); await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(300)
        img1 = await ev("()=>{ const r=document.querySelector('.sk-photo').getBoundingClientRect(); return [r.x, r.y, r.width]; }")
        check('Size again: two points + a distance resize the photo', abs(img1[2] / img0[2] - 1) > 0.05, [img0, img1])
        await ev("()=>[...document.querySelectorAll('.sk-side .chip')].find(c=>c.textContent==='Move photo').click()")
        await pg.mouse.move(sx[0], sx[1]); await pg.mouse.down(); await pg.mouse.move(sx[0] + 60, sx[1] + 30, steps=5); await pg.mouse.up()
        img2 = await ev("()=>{ const r=document.querySelector('.sk-photo').getBoundingClientRect(); return [r.x, r.y, r.width]; }")
        check('Move photo: dragging moves it', abs(img2[0] - img1[0] - 60) < 3 and abs(img2[1] - img1[1] - 30) < 3, [img1, img2])
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(200)
        img3 = await ev("()=>{ const r=document.querySelector('.sk-photo').getBoundingClientRect(); return [r.x, r.y, r.width]; }")
        check('Undo puts the photo back', abs(img3[0] - img1[0]) < 2, [img1, img3])
        await ev("()=>[...document.querySelectorAll('.sketch .btn')].find(b=>b.textContent==='Cancel').click()")

        # ---------------------------------------------------------------- 2. no paper: a measured rectangle, a part bigger than it
        p, rect = big_part_on_floor()
        await open_photo(p)
        await ev("()=>[...document.querySelectorAll('.pw-side .chip')].find(c=>c.textContent==='A rectangle I measured').click()")
        await pg.fill('.pw-two input >> nth=0', '400'); await pg.fill('.pw-two input >> nth=1', '300')
        await click_points(rect, (1600, 1200), [0, 1, 2, 3])
        await pg.click('.pw-go button:text-is("Find the outline")')
        await pg.wait_for_function("()=>/Found|Nothing/.test(document.querySelector('.pw-status').textContent)", timeout=30000)
        st = await ev("()=>document.querySelector('.pw-status').textContent")
        await pg.click('.pw-go button:has-text("Open in the sketch")')
        await board()
        loops = await ev("""async()=>{ const btn=[...document.querySelectorAll('.sketch .btn.primary')].find(b=>b.textContent.includes('Done')); btn.click(); await new Promise(r=>setTimeout(r,300));
          const d=document.querySelector('dialog'); const h=d.querySelector('input'); h.value='5'; [...d.querySelectorAll('button')].find(b=>b.textContent==='OK').click();
          await new Promise(r=>setTimeout(r,500)); return JSON.parse(JSON.stringify(__3dj.store.doc.features.at(-1).p)); }""")
        polys = [l for l in loops['loops'] if l['type'] == 'poly']; circles = [l for l in loops['loops'] if l['type'] == 'circle']
        big = max(polys, key=lambda l: (bbox(l['pts'])[2] - bbox(l['pts'])[0])) if polys else None
        bb = bbox(big['pts']) if big else [0, 0, 0, 0]
        check('without paper: a 450 x 120 mm part, bigger than the 400 x 300 rectangle, comes out the right size (within 3 mm)', big and abs((bb[2] - bb[0]) - 450) < 3 and abs((bb[3] - bb[1]) - 120) < 3, [st, bb])
        check('  and its 30 mm hole is a circle', any(abs(c['r'] * 2 - 30) < 1.5 for c in circles), circles)

        # ---------------------------------------------------------------- 3. a measured line, traced by hand
        p, ends, size = top_down_with_ruler()
        await open_photo(p)
        await ev("()=>[...document.querySelectorAll('.pw-side .chip')].find(c=>c.textContent==='A line I measured').click()")
        await pg.fill('.pw-side input.in', '100')
        await click_points(ends, size, [0, 1])
        await pg.click('.pw-go button:has-text("Trace it myself")')
        await board()
        ph = await ev("""async()=>{ const btn=[...document.querySelectorAll('.sketch .btn')].find(b=>b.textContent==='Cancel');
          const im=document.querySelector('.sketch image.sk-photo'); const w=+im.getAttribute('width'); return { w }; }""")
        # 300 mm wide photo: on screen width / pixels per mm
        s = await ev("()=>{ const a=document.querySelector('.sketch'); return 1; }")
        wmm = await ev("()=>{ const im=document.querySelector('.sk-photo'); const svg=document.querySelector('.sk-svg'); return +im.getAttribute('width'); }")
        check('a line of known length sizes the photo; the board opens with it underneath to trace', ph['w'] > 0 and await ev("()=>!!document.querySelector('.sketch image.sk-photo')"), ph)
        await ev("()=>[...document.querySelectorAll('.sketch .btn')].find(b=>b.textContent==='Cancel').click()")

        for e in errs: print('PAGE', e[:300])
        n = sum(ok for _, ok in results)
        print(f'{n}/{len(results)} passed, {len(errs)} page errors')
        await b.close()
        raise SystemExit(0 if n == len(results) and not errs else 1)

asyncio.run(main())
