# Pictures for the Help page "Let an AI help (Gemini or Claude)" (ai-1, ai-2): the real app with the real
# 3DJamesLink.exe, driven over MCP the way Gemini CLI does it (the MCP client from tests/link.py).
# Run after build.py and windows-desktop/link/build_link.py:  python help/shots/link_shots.py
import asyncio, os, sys, tempfile, threading
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, num, save, SRC
sys.path.insert(0, os.path.join(SRC, 'tests'))
from link import Mcp  # noqa: E402

FULL = (0, 0, 1280, 720)
PLATE = {'name': 'Mounting plate', 'vars': [{'name': 'plateW', 'expr': '90'}, {'name': 'holeD', 'expr': '5'}],
         'bodies': {'b1': {'name': 'Mounting plate', 'color': '#00A2E8'}, 'b2': {'name': 'Corner screw hole', 'color': '#8b96a3', 'hole': True}},
         'features': [
             {'id': 'f1', 'type': 'shape', 'kind': 'box', 'name': 'Mounting plate', 'body': 'b1', 'p': {'w': 'plateW', 'd': 60, 'h': 5, 'round': 6, 'roundMode': 'vertical'}, 'pos': [0, 0, 0], 'rot': [0, 0, 0]},
             {'id': 'f2', 'type': 'shape', 'kind': 'cyl', 'name': 'Corner screw hole', 'body': 'b2', 'p': {'d': 'holeD', 'h': 9}, 'pos': ['8 - plateW/2', -22, -2], 'rot': [0, 0, 0]},
             {'id': 'f3', 'type': 'array', 'name': 'Screw holes left and right', 'body': 'b2', 'kind': 'linear', 'n': 2, 'dx': 'plateW - 16', 'dy': 0, 'dz': 0},
             {'id': 'f5', 'type': 'array', 'name': 'Screw holes front and back', 'body': 'b2', 'kind': 'linear', 'n': 2, 'dx': 0, 'dy': 44, 'dz': 0},
             {'id': 'f4', 'type': 'combine', 'op': 'subtract', 'name': 'Cut the screw holes', 'body': 'b1', 'tools': ['b2']}]}


async def main():
    gem = Mcp(tempfile.mkdtemp(prefix='3dj-shots-'))
    async with async_playwright() as p:
        b, pg, errs = await open_app(p, init="localStorage.setItem('3djames.link', 'test'); localStorage.setItem('3djames.linkport', '47841')")
        await pg.wait_for_timeout(1500)
        # 1: the first job: 3DJames asks
        th = threading.Thread(target=lambda: gem.call('new_project', {'name': 'Mounting plate', 'discard_changes': True}))
        th.start()
        await pg.get_by_role('button', name='Allow', exact=True).wait_for(timeout=30000)
        im = await shot(pg)
        go = await box(pg, 'dialog.modal .btn.primary')
        ring(im, go, pad=6)
        num(im, (go[0] + go[2] + 30, go[1] + go[3] / 2), 1)
        save(im, 'ai-1.jpg', crop=FULL)
        await pg.get_by_role('button', name='Allow', exact=True).click()
        await asyncio.to_thread(th.join, 60)
        # 2: Gemini made a plate: the note at the top, its message, the steps in History
        r = await asyncio.to_thread(gem.call, 'replace_project', {'project': PLATE})
        assert r.get('built'), r
        await pg.evaluate("()=>{ const C = window.__3dj.commands; window.__3dj.app.historyAll = true; C.openPanel('history'); C.renderAll(); }")
        await pg.wait_for_timeout(1500)
        im = await shot(pg, 300)
        pill = await box(pg, '#view .card.float[role=status]')
        ring(im, pill, pad=6)
        num(im, (pill[0] - 30, pill[1] + pill[3] / 2), 1)
        hist = await box(pg, '#side .side-body')
        if hist:
            num(im, (hist[0] - 28, hist[1] + 190), 2)
        save(im, 'ai-2.jpg', crop=FULL)
        assert not errs, errs
        await b.close()
    gem.close()

asyncio.run(main())
