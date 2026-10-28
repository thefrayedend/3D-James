# Pictures for setting up storage on a 3DJames box: nas-1 (Add a NAS share, filled in), nas-2 (the Storage list,
# connected, with a USB drive plugged in), nas-3 (a person's folder on the NAS), box-usb (the USB drives card). Uses the
# box's real admin page, started here with a throw-away data folder. The NAS and the USB drive are filled in as the box
# shows them (this PC has no USB helper, and the pictures shouldn't depend on a NAS being there). Values: \\192.168.1.50\James, folder "3D Objects".
# Run after build.py:  python help/shots/nas_shots.py
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
from markup import shot, box, ring, arrow, num, save, SRC

ROOT = Path(SRC)
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


async def main():
    data = Path(tempfile.mkdtemp(prefix='3dj-nas-shots-'))
    ap, adp = free_port(), free_port()
    srv = subprocess.Popen([sys.executable, str(ROOT / 'server' / '3djames_server.py'), '--data', str(data), '--app-port', str(ap), '--admin-port', str(adp),
                            '--bundled-app', str(ROOT / 'local' / '3DJames.html')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                           env={**os.environ, 'TDJ_MOUNT_ROOT': str(data / 'mnt')})
    ADMIN = f'http://127.0.0.1:{adp}'
    for _ in range(100):
        try: urllib.request.urlopen(ADMIN + '/api/state', timeout=1); break
        except Exception: time.sleep(0.2)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 1200, 'height': 760}, device_scale_factor=1.5)
            pg = await ctx.new_page()
            await pg.goto(ADMIN + '/'); await pg.wait_for_selector('text=Welcome to your 3DJames box')
            ins = pg.locator('main input')
            await ins.nth(0).fill('james'); await ins.nth(1).fill('James'); await ins.nth(2).fill('secret1'); await ins.nth(3).fill('secret1')
            await pg.click('text=Create the admin account'); await pg.wait_for_selector('nav >> text=Storage')

            # 1: Storage tab > Add a NAS share, filled in for \\192.168.1.50\James
            await pg.wait_for_timeout(1000)
            await pg.click('#tabs button[data-tab=storage]')
            await pg.wait_for_function("()=>document.querySelector('main h2')?.textContent==='Where files are kept'")
            await pg.click('text=Add a NAS share'); await pg.wait_for_timeout(300)
            fields = pg.locator('main input')
            await fields.nth(0).fill('NAS')
            await fields.nth(1).fill('192.168.1.50')
            await fields.nth(2).fill('James')
            await fields.nth(3).fill('')
            await fields.nth(4).fill('')
            await pg.mouse.move(5, 5)
            await pg.evaluate("()=>document.querySelectorAll('.toast, #toast').forEach(e=>e.remove())")
            im = await shot(pg)
            st = await pg.evaluate("()=>{ const e=document.querySelector('#tabs button[data-tab=storage]'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            ring(im, st, pad=4); num(im, (st[0] + st[2] / 2, st[1] + st[3] + 26), 1)
            card = await box(pg, 'main .card')
            for i, (lab, txt) in enumerate([(1, '192.168.1.50'), (2, 'James')]):
                r = await pg.evaluate(f"()=>{{ const e=document.querySelectorAll('main input')[{lab}]; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }}")
                ring(im, r, pad=3)
            sv = await pg.evaluate("()=>{ const e=[...document.querySelectorAll('main button')].find(x=>x.textContent.trim()==='Save and connect'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            ring(im, sv, pad=4); num(im, (sv[0] - 16, sv[1] + sv[3] / 2), 2)
            save(im, 'nas-1.jpg', w=1100)


            # from here: the box's status as it reads once the share is connected
            # (this PC can't mount the share, so the box refuses to save it here: it is shown as the box lists it once saved)
            async def connected(route):
                resp = await route.fetch(); j = await resp.json()
                j['config']['places']['nas'] = {'label': 'NAS', 'type': 'smb', 'server': '192.168.1.50', 'share': 'James', 'username': '',
                                                'connected': True, 'space': None, 'problem': '', 'used': []}
                j['usb'] = [{'uuid': '1A2B-3C4D', 'fstype': 'exfat', 'label': '', 'name': 'SanDisk Ultra', 'size': 64.1e9, 'dev': '/dev/sda1', 'place': None}]
                await route.fulfill(response=resp, body=json.dumps(j), headers={**resp.headers, 'content-type': 'application/json'})
            await pg.route('**/api/overview', connected)
            await pg.goto(ADMIN + '/'); await pg.wait_for_selector('#tabs:not([hidden])'); await pg.wait_for_timeout(1000)
            await pg.click('#tabs button[data-tab=storage]'); await pg.wait_for_function("()=>document.querySelector('main h2')?.textContent==='Where files are kept'"); await pg.wait_for_timeout(300)
            im = await shot(pg)
            row = await pg.evaluate("()=>{ const e=[...document.querySelectorAll('main tr')].find(x=>x.textContent.includes('192.168.1.50')); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            ring(im, row, pad=4)
            arrow(im, (row[0] + row[2] * 0.55, row[1] + row[3] + 120), (row[0] + row[2] * 0.55, row[1] + row[3] + 8), 'It should say "connected"', side='right')
            save(im, 'nas-2.jpg', w=1100)

            # box-usb: the USB drives card
            await pg.evaluate("()=>[...document.querySelectorAll('main .card')].find(x=>x.querySelector('h2')?.textContent==='USB drives').scrollIntoView({block:'center'})")
            await pg.wait_for_timeout(200)
            im = await shot(pg)
            card = await pg.evaluate("()=>{ const e=[...document.querySelectorAll('main .card')].find(x=>x.querySelector('h2')?.textContent==='USB drives'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            use = await pg.evaluate("()=>{ const e=[...document.querySelectorAll('main button')].find(x=>x.textContent.trim()==='Use this drive'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            ring(im, use, pad=4)
            arrow(im, (use[0] + use[2] + 50, use[1] + use[3] / 2 + 50), (use[0] + use[2] + 8, use[1] + use[3] / 2), 'Plug it in, then' + chr(10) + 'click this', side='right')
            save(im, 'box-usb.jpg', crop=[card[0] - 10, card[1] - 10, card[0] + card[2] + 10, card[1] + card[3] + 10], w=1000)

            # 3: Users tab > edit James > Add a folder on the NAS: folder "3D Objects"
            await pg.click('#tabs button[data-tab=users]'); await pg.wait_for_function("()=>document.querySelector('main h2')?.textContent==='People who can use 3DJames'")
            await pg.locator('main button', has_text='Edit').first.click(); await pg.wait_for_timeout(400)
            await pg.click('text=Add a folder'); await pg.wait_for_timeout(300)
            rows = pg.locator('main .folder')
            last = rows.nth(await rows.count() - 1)
            await last.locator('input').nth(0).fill('3D Objects (NAS)')
            opts = await last.locator('select option').all_text_contents()
            nas = [o for o in opts if 'NAS' in o][0]
            await last.locator('select').select_option(label=nas)
            await last.locator('input').nth(1).fill('3D Objects')
            await last.scroll_into_view_if_needed(); await pg.mouse.move(5, 5)
            im = await shot(pg)
            fr = await last.bounding_box()
            ring(im, [fr['x'], fr['y'], fr['width'], fr['height']], pad=5)
            arrow(im, (fr['x'] + 560, fr['y'] + fr['height'] + 120), (fr['x'] + 420, fr['y'] + fr['height'] + 8), 'Label, the NAS, the folder inside it,\n"save" ticked. Then Save', side='right')
            sv = await pg.evaluate("()=>{ const e=[...document.querySelectorAll('main button')].find(x=>x.textContent.trim()==='Save'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }")
            ring(im, sv, pad=4)
            save(im, 'nas-3.jpg', w=1100)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
