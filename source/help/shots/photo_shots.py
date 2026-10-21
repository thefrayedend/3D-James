# Pictures for the Help page "Sketch from a photo" (photo-1..4). Uses the made-up photos from tests/photo.py.
# Run after build.py:  python help/shots/photo_shots.py
import asyncio, os, sys
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, num, save, SRC

# only the picture makers are needed (the test itself runs on import's last line, so read them by hand)
src = open(os.path.join(SRC, 'tests', 'photo.py'), encoding='utf-8').read().split('async def main():')[0]
ns = {'__file__': os.path.join(SRC, 'tests', 'photo.py')}
exec(src, ns)
FULL = (0, 0, 1280, 720)


async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        ev = pg.evaluate

        async def open_photo(path):
            async with pg.expect_file_chooser() as fc:
                await ev("()=>{ __3dj.commands.startPhotoSketch(); }")
            await (await fc.value).set_files(str(path))
            await pg.wait_for_selector('dialog.pw-dialog canvas'); await pg.wait_for_timeout(600)
        async def to_screen(pt, size):
            return await ev("([p, s])=>{ const c=document.querySelector('.pw-canvas').getBoundingClientRect(); const k=Math.min(c.width/s[0], c.height/s[1])*0.96; return [c.left+(c.width-s[0]*k)/2+p[0]*k, c.top+(c.height-s[1]*k)/2+p[1]*k]; }", [pt, size])

        # 1: A4 paper at an angle, the 4 corners clicked
        path, corners = ns['bracket_on_paper']()
        await open_photo(path)
        scr = []
        for i in [3, 2, 1, 0]:
            x, y = await to_screen(corners[i], (1600, 1200)); scr.append((x, y)); await pg.mouse.click(x, y); await pg.wait_for_timeout(80)
        await pg.mouse.move(5, 5)
        im = await shot(pg)
        side = await ev("()=>{ const r=document.querySelector('.pw-side .chip-row').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
        ring(im, side, pad=5)
        arrow(im, (side[0] - 60, side[1] + 300), (side[0] + 20, side[1] + side[3] + 6), '1  What do you know\nthe size of?', side='left')
        x, y = scr[0]
        arrow(im, (x - 40, y + 150), (x - 8, y + 12), '2  Click the paper\'s\n4 corners', side='left')
        go = await box(pg, '.pw-go')
        ring(im, go, pad=5)
        save(im, 'photo-1.jpg', crop=FULL)
        # 2: Find the outline: the preview
        await pg.click('.pw-go button:text-is("Find the outline")')
        await pg.wait_for_function("()=>/Found|Nothing/.test(document.querySelector('.pw-status').textContent)", timeout=30000)
        await pg.wait_for_timeout(300)
        im = await shot(pg)
        sl = await box(pg, '.pw-side input[type=range]')
        ring(im, await box(pg, '.pw-side'), pad=4)
        save(im, 'photo-2.jpg', crop=FULL)
        # 3: the board with the photo underneath and the outline found
        await pg.click('.pw-go button:has-text("Open in the sketch")')
        await pg.wait_for_selector('.sketch .sk-photo'); await pg.wait_for_timeout(5200)
        im = await shot(pg)
        pb = await ev("()=>{ const h=[...document.querySelectorAll('.sk-fold-h')].find(x=>x.textContent.includes('Photo')); const r=h.getBoundingClientRect(); return [r.x, r.y, r.width, 150]; }")
        ring(im, pb, pad=4)
        arrow(im, (pb[0] - 260, pb[1] + 260), (pb[0] - 6, pb[1] + 60), 'Fade, hide, move or size\nthe photo again', side='left')
        save(im, 'photo-3.jpg', crop=FULL)
        await ev("()=>[...document.querySelectorAll('.sketch .btn')].find(b=>b.textContent==='Cancel').click()")
        # 4: no paper: a rectangle you measured, the part bigger than it
        path, rect = ns['big_part_on_floor']()
        await open_photo(path)
        await ev("()=>[...document.querySelectorAll('.pw-side .chip')].find(c=>c.textContent==='A rectangle I measured').click()")
        await pg.fill('.pw-two input >> nth=0', '400'); await pg.fill('.pw-two input >> nth=1', '300')
        for i in [0, 1, 2, 3]:
            x, y = await to_screen(rect[i], (1600, 1200)); await pg.mouse.click(x, y); await pg.wait_for_timeout(80)
        await pg.mouse.move(5, 5)
        im = await shot(pg)
        two = await box(pg, '.pw-two')
        ring(im, two, pad=5)
        arrow(im, (two[0] - 40, two[1] + 200), (two[0] + 20, two[1] + two[3] + 6), 'No paper? Any rectangle you\nmeasured (here a 400 x 300 mm\ntape square on the floor)', side='left')
        save(im, 'photo-4.jpg', crop=FULL)
        assert not errs, errs
        await b.close()

asyncio.run(main())
