# Pictures for the help page "Sketch rules" (and the sketch board picture), taken from the real app and marked up.
# Run after build.py:  python3 help/shots/rules_shots.py
import asyncio, os, math
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')
APP = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'local', '3DJames.html'))
S = 1.5
from markup import _font  # Inter where it is installed, else a bold system font (Windows, Linux, macOS)
font = lambda n, s: _font(s, 'Display' in n)
RED = (225, 40, 40); BLUE = (40, 110, 210)

def ring(im, box, pad=8, w=6):
    d = ImageDraw.Draw(im); x, y, bw, bh = [v * S for v in box]
    d.rounded_rectangle([x - pad, y - pad, x + bw + pad, y + bh + pad], 14, outline=RED, width=w)
def arrow(im, frm, to, label=None, side='left', w=7):
    d = ImageDraw.Draw(im); frm = [v * S for v in frm]; to = [v * S for v in to]
    d.line([tuple(frm), tuple(to)], fill=RED, width=w)
    a = math.atan2(to[1] - frm[1], to[0] - frm[0])
    for s in (0.45, -0.45): d.line([tuple(to), (to[0] - 30 * math.cos(a + s), to[1] - 30 * math.sin(a + s))], fill=RED, width=w)
    if label: tag(im, frm, label, side)
def tag(im, at, label, side='left'):
    d = ImageDraw.Draw(im); ft = font('Inter-Bold.otf', 30)
    lines = label.split('\n'); tw = max(ft.getlength(t) for t in lines); th = 40 * len(lines)
    x = at[0] - tw - 18 if side == 'left' else at[0] + 18
    y = at[1] - th / 2
    d.rounded_rectangle([x - 14, y - 8, x + tw + 14, y + th + 6], 12, fill=(255, 255, 255), outline=RED, width=4)
    for i, t in enumerate(lines): d.text((x, y + i * 40), t, font=ft, fill=RED)
def num(im, at, n):
    d = ImageDraw.Draw(im); x, y = at[0] * S, at[1] * S; ft = font('InterDisplay-Bold.otf', 38)
    d.ellipse([x - 28, y - 28, x + 28, y + 28], fill=BLUE); d.text((x - ft.getlength(str(n)) / 2, y - 24), str(n), font=ft, fill='white')
def save(im, name, w=1100, crop=None):
    if crop: im = im.crop([v * S for v in crop])
    im = im.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=80, optimize=True); print('wrote', name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await (await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=S)).new_page()
        pg.on('pageerror', lambda e: print('PAGEERR', e))
        await pg.goto(APP)
        await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
        ev = pg.evaluate
        box = lambda sel: ev("(s)=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}", sel)
        async def shot(): await pg.wait_for_timeout(350); await pg.screenshot(path='/tmp/rs.png'); return Image.open('/tmp/rs.png').convert('RGB')
        await ev("""async()=>{ const C=__3dj.commands; C.newProject(); await new Promise(r=>setTimeout(r,800)); __3dj.app.settings.panelOpen=false; __3dj.app.settings.skFold={}; C.renderAll();
          window.__k = C.startSketch(); await new Promise(r=>setTimeout(r,300));
          __k.loops.push({type:'poly', pts:[[0,0],[50,0],[52,28],[0,30]]}); __k.loops.push({type:'circle', c:[25,15], r:5});
          __k.setTool('select'); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,200));
          __k.pickItems([{l:0,i:1}]); }""")
        # 1: pick a line, then click a rule
        im = await shot()
        rb = await box('.sk-rbar'); sp = await ev("()=>__k.screenOf([51,14])"); up = await box('.sk-rb[data-rule="upright"]')
        ring(im, rb, pad=4)
        arrow(im, (sp[0] + 110, sp[1] - 60), (sp[0] + 8, sp[1] + 2), '1  Pick a line\n(Select tool)', side='right')
        arrow(im, (up[0] + 200, up[1] + 110), (up[0] + up[2] / 2 + 4, up[1] + up[3] + 4), '2  Click a rule\n(here: Upright)', side='right')
        save(im, 'rules-1.jpg', crop=(0, 0, 1280, 470))
        # 2: badges, the starting point, the status
        await ev("""async()=>{ __k.pressRule('upright'); __k.pickItems([{l:0,i:0}]); __k.pressRule('flat'); __k.pickItems([{l:0,i:2}]); __k.pressRule('flat'); __k.pickItems([]); }""")
        im = await shot()
        bd = await ev("()=>{const e=[...document.querySelectorAll('.sk-badge')].find(g=>g.querySelector('text').textContent==='|'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        an = await ev("()=>{const e=document.querySelector('.sk-badge.anchor'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        st = await box('.sk-status')
        arrow(im, (bd[0] - 170, bd[1] - 60), (bd[0] - 4, bd[1] + 4), 'A badge for each rule.\nClick it to remove it.', side='left')
        arrow(im, (an[0] + 170, an[1] - 70), (an[0] + an[2] + 4, an[1]), 'Starting point: locked.\nRules never move it.', side='right')
        ring(im, st, pad=5)
        save(im, 'rules-2.jpg', crop=(0, 0, 1280, 720))
        # 3: everything locked turns green
        await ev("""async()=>{ __k.pickItems([{l:0,i:3}]); __k.pressRule('upright'); __k.setLength(0,0,50); __k.setLength(0,1,30); __k.measureRule('dx',{l:0,k:0},{l:1,k:0},25); __k.measureRule('dy',{l:0,k:0},{l:1,k:0},15); __k.setDiameter(1,10); }""")
        im = await shot()
        st = await box('.sk-status'); ring(im, st, pad=5)
        sp = await ev("()=>__k.screenOf([50,30])")
        arrow(im, (sp[0] - 120, sp[1] + 120), (sp[0] - 6, sp[1] + 6), 'Green = locked.\nNothing can change\nby accident.', side='left')
        save(im, 'rules-3.jpg', crop=(0, 0, 1280, 720))
        im = await shot()
        # 4: the Rules list on the right
        rl = await ev("()=>{const h=[...document.querySelectorAll('.sk-fold-h')].find(e=>e.textContent.includes('Rules')); const a=h.getBoundingClientRect(); const n=h.nextElementSibling.getBoundingClientRect(); return [a.x,a.y,a.width,n.bottom-a.y]}")
        ring(im, rl, pad=4)
        lk = await ev("()=>{const e=[...document.querySelectorAll('.sk-side .chip')].find(c=>c.textContent==='🔒'); const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}")
        arrow(im, (lk[0] - 190, lk[1] + 80), (lk[0] - 4, lk[1] + lk[3] / 2), 'The lock: this size holds.\nClick it to just show\nthe size instead.', side='left')
        save(im, 'rules-4.jpg', crop=(560, 30, 1280, 490), w=900)
        # the sketch board (for the Sketch page)
        await ev("""async()=>{ __k.close(); window.__k = __3dj.commands.startSketch(); await new Promise(r=>setTimeout(r,300));
          __k.loops.push({type:'poly', pts:[[0,0],[88,0],[88,10],[65,22],[65,32],[42,32],[9,65],[0,65]], bulge:[0,0,0,0,0,0.414214,0,0]});
          __k.addRule('flat',{l:0,i:0}); __k.addRule('upright',{l:0,i:7}); __k.measureRule('dx',{o:1},{l:0,k:5},42); __k.setRadius(0,5,33);
          __k.setTool('select'); __k.pickEdge(0,0); document.querySelector('.sketch [title="Fit everything in view"]').click(); await new Promise(r=>setTimeout(r,250)); }""")
        im = await shot(); save(im, 'sketch.jpg')
        await b.close()
asyncio.run(main())
