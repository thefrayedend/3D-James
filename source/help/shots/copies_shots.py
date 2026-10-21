# Pictures for Help: Mirror copy / Turned copy (Combine objects) and Edit sketches together (Make the sketch solid).
# Real app screenshots with real clicks, marked up. Run after build.py:  python3 help/shots/copies_shots.py
import asyncio, os, math
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')
APP = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'local', '3DJames.html'))
S = 1.5
from markup import _font  # Inter where it is installed, else a bold system font (Windows, Linux, macOS)
font = lambda n, s: _font(s, 'Display' in n)
RED = (225, 40, 40)
def ring(im, box, pad=8, w=6):
    d = ImageDraw.Draw(im); x, y, bw, bh = [v * S for v in box]
    d.rounded_rectangle([x - pad, y - pad, x + bw + pad, y + bh + pad], 14, outline=RED, width=w)
def tag(im, at, label, side='left'):
    d = ImageDraw.Draw(im); ft = font('Inter-Bold.otf', 30)
    lines = label.split('\n'); tw = max(ft.getlength(t) for t in lines); th = 40 * len(lines)
    x = at[0] - tw - 18 if side == 'left' else at[0] + 18
    y = at[1] - th / 2
    d.rounded_rectangle([x - 14, y - 8, x + tw + 14, y + th + 6], 12, fill=(255, 255, 255), outline=RED, width=4)
    for i, t in enumerate(lines): d.text((x, y + i * 40), t, font=ft, fill=RED)
def arrow(im, frm, to, label=None, side='left', w=7):
    d = ImageDraw.Draw(im); frm = [v * S for v in frm]; to = [v * S for v in to]
    d.line([tuple(frm), tuple(to)], fill=RED, width=w)
    a = math.atan2(to[1] - frm[1], to[0] - frm[0])
    for s in (0.45, -0.45): d.line([tuple(to), (to[0] - 30 * math.cos(a + s), to[1] - 30 * math.sin(a + s))], fill=RED, width=w)
    if label: tag(im, frm, label, side)
def save(im, name, w=1100, crop=None):
    if crop: im = im.crop([v * S for v in crop])
    im = im.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=80, optimize=True); print('wrote', name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await (await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=S)).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP)
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        ev = pg.evaluate
        box = lambda sel: ev("(s)=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}", sel)
        built = lambda: pg.wait_for_function('!window.__3dj.app.building && !window.__3dj.app.pending', timeout=120000)
        async def shot(): await pg.wait_for_timeout(500); await pg.screenshot(path='/tmp/cs.png'); return Image.open('/tmp/cs.png').convert('RGB')
        # a sketch: an L-shaped bracket with a curved inside corner
        await ev("""async()=>{ const B=__3dj, C=B.commands; C.newProject(); await new Promise(r=>setTimeout(r,800)); B.app.settings.panelOpen=true; C.renderAll();
          const id=C.addShape('sketch',{loops:[{type:'poly',pts:[[0,0],[40,0],[40,8],[14,8],[10,30],[0,30]],bulge:[0,0,0,0.3,0,0]}],h:12},'Sketch');
          window.__id=id; }""")
        await built()
        await ev("()=>{const B=__3dj; B.vp.view('home',false); B.app.sel=[__id]; B.vp.setSelection([__id]); B.commands.renderAll();}")
        await pg.get_by_role('tab', name='Object', exact=True).click()
        await pg.locator('#cmdbar button', has_text='Mirror').first.click()
        im = await shot()
        mi = await ev("()=>{const e=[...document.querySelectorAll('.mi')].find(m=>m.textContent.includes('Mirror copy to the right')); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        tc = await ev("()=>{const a=[...document.querySelectorAll('.mi')].filter(m=>m.textContent.includes('Turned copy')); const r=a[0].getBoundingClientRect(), q=a[a.length-1].getBoundingClientRect(); return [r.x,r.y,r.width,q.bottom-r.y]}")
        ring(im, mi, pad=4); ring(im, tc, pad=4)
        arrow(im, (mi[0] + mi[2] + 170, mi[1] - 20), (mi[0] + mi[2] + 8, mi[1] + mi[3] / 2), 'A mirror image as\nits own object', side='right')
        arrow(im, (tc[0] + tc[2] + 170, tc[1] + tc[3] + 40), (tc[0] + tc[2] + 8, tc[1] + tc[3] / 2), 'A turned copy\nbeside it', side='right')
        save(im, 'copies-menu.jpg', crop=(0, 0, 1280, 560))
        await pg.locator('.mi', has_text='Mirror copy to the right').click()
        await built(); await ev("()=>__3dj.vp.view('home',false)")
        im = await shot()
        es = await ev("()=>{const e=[...document.querySelectorAll('#props button')].find(b=>b.textContent.includes('Edit sketch')); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        nm = await box('#props input')
        if es: ring(im, es, pad=4)
        if nm: arrow(im, (nm[0] - 60, nm[1] + 170), (nm[0] - 6, nm[1] + nm[3] / 2), 'The copy is its own\nsketch: Edit sketch\nshows it flipped', side='left')
        save(im, 'copies-result.jpg')
        # both sketches picked: Edit sketches together
        await ev("()=>{const B=__3dj; const ids=[...B.app.results.bodies.keys()]; B.app.sel=ids; B.vp.setSelection(ids); B.commands.openPanel('props'); B.commands.renderAll();}")
        await pg.wait_for_timeout(300)
        im = await shot()
        eb = await ev("()=>{const e=[...document.querySelectorAll('#props button')].find(b=>b.textContent.includes('Edit sketches together')); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        ring(im, eb, pad=5)
        arrow(im, (eb[0] - 80, eb[1] + 160), (eb[0] - 6, eb[1] + eb[3] / 2), 'Ctrl+click two or more\nsketches, then click', side='left')
        save(im, 'multi-props.jpg')
        await pg.locator('#props button', has_text='Edit sketches together').click()
        await pg.wait_for_timeout(500)
        await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()")
        await pg.mouse.move(600, 600)
        im = await shot()
        ow = await ev("()=>{const a=[...document.querySelectorAll('.sk-owner')]; const r=a[0].getBoundingClientRect(), q=a[a.length-1].getBoundingClientRect(); return [r.x,r.y,r.width,q.bottom-r.y]}")
        jn = await ev("()=>{const e=[...document.querySelectorAll('.sk-side .chip')].find(c=>c.textContent==='Join into one sketch'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        ring(im, ow, pad=4); ring(im, jn, pad=4)
        arrow(im, (ow[0] - 120, ow[1] + 30), (ow[0] - 8, ow[1] + 30), 'Each sketch has\nits own color', side='left')
        arrow(im, (jn[0] - 120, jn[1] + 90), (jn[0] - 8, jn[1] + jn[3] / 2), 'Or make them\none sketch', side='left')
        save(im, 'multi-board.jpg')
        await ev("()=>document.querySelector('.sketch .btn')?.click()")  # Cancel
        # merge touching sketches: two bars that touch at a corner become one L-shaped outline
        await ev("""async()=>{ const B=__3dj, C=B.commands; C.newProject(); await new Promise(r=>setTimeout(r,600));
          const a=C.addShape('sketch',{loops:[{type:'poly',pts:[[0,0],[60,0],[60,12],[0,12]]}],h:10},'Sketch');
          const b=C.addShape('sketch',{loops:[{type:'poly',pts:[[0,0],[12,0],[12,50],[0,50]]},{type:'circle',c:[6,40],r:3}]},'Sketch');
          window.__ab=[a,b]; }""")
        await built()
        await ev("()=>{const B=__3dj, S=B.store; S.commit((d)=>{d.features.find(x=>x.body===__ab[0]).pos=[30,6,0]; d.features.find(x=>x.body===__ab[1]).pos=[6,31,0];}); }")
        await built()
        await ev("()=>{window.__k=__3dj.commands.editSketches(__ab); __k.setTool('line');}")
        await pg.wait_for_timeout(400)
        await ev("()=>document.querySelector('.sketch [title=\"Fit everything in view\"]').click()")
        await pg.mouse.move(700, 650)
        im = await shot()
        mb = await ev("()=>{const e=[...document.querySelectorAll('.sk-side .chip')].find(c=>c.textContent==='Merge touching sketches'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        ring(im, mb, pad=4)
        arrow(im, (mb[0] - 120, mb[1] + 110), (mb[0] - 8, mb[1] + mb[3] / 2), 'Weld outlines that\ntouch into one', side='left')
        save(im, 'merge-before.jpg')
        await pg.locator('.sk-side .chip', has_text='Merge touching sketches').click()
        await pg.wait_for_function("document.querySelectorAll('.sk-owner')[1]?.textContent.includes('0 shapes')", timeout=30000)
        await pg.wait_for_timeout(3600)  # let the note fade
        im = await shot()
        save(im, 'merge-after.jpg')
        await ev("()=>__k.close(true)")
        assert not errs, errs
        await b.close()
asyncio.run(main())
