# Picture for Help: Send feedback (feedback.jpg). Real app screenshot, marked up.
# Run after build.py:  python help/shots/feedback_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, num, save

async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        await pg.evaluate("async () => { const { commands: C, app, store } = window.__3dj; C.newProject(); C.addShape('box', { w: 30, d: 20, h: 10 }); while (app.building || app.pending || app.builtRevision !== store.revision) await new Promise((r) => setTimeout(r, 20)); }")
        await pg.get_by_role('tab', name='Help', exact=True).click()
        btn = await pg.get_by_role('button', name='Send feedback').bounding_box()
        await pg.get_by_role('button', name='Send feedback').click()
        await pg.get_by_label('Title').fill('A wish: inches as well as mm')
        await pg.get_by_label('What happened, or what you would like').fill('I measure in inches. Could sizes be typed and shown in inches?')
        await pg.get_by_role('dialog').locator('select').select_option('idea')
        im = await shot(pg)
        go = await box(pg, 'dialog.modal .btn.primary')
        ring(im, [btn['x'], btn['y'], btn['width'], btn['height']], pad=4); num(im, (btn['x'] + btn['width'] + 30, btn['y'] + btn['height'] / 2), 1)
        tick = await box(pg, 'dialog.modal label.check')
        ring(im, tick, pad=4); num(im, (tick[0] - 26, tick[1] + tick[3] / 2), 2)
        ring(im, go, pad=6); num(im, (go[0] + go[2] + 30, go[1] + go[3] / 2), 3)
        save(im, 'feedback.jpg')
        print('page errors:', errs)
        await b.close()

asyncio.run(main())
