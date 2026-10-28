# Shared helpers for Help pictures: start the real app, take screenshots, and mark them up (red rings and arrows,
# numbered blue dots, labels) in one look. Works on Windows, Linux and macOS.
#   from markup import open_app, Shot      (see lines_shots.py for an example)
import math, os, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(SRC, 'help', 'img')
APP = 'file:///' + os.path.join(SRC, 'local', '3DJames.html').replace(os.sep, '/').lstrip('/')
S = 1.5  # screenshots are taken at 1.5x for sharp text
RED = (225, 40, 40); BLUE = (40, 110, 210)

def _font(size, display=False):
    names = (['InterDisplay-Bold.otf'] if display else []) + ['Inter-Bold.otf', 'segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf']
    dirs = ['/usr/share/fonts/opentype/inter/', os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts'), '/Library/Fonts/', '/usr/share/fonts/truetype/dejavu/', os.path.join(SRC, 'assets', 'fonts')]
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def ring(im, box, pad=8, w=6):
    """A red rounded box around a screen rectangle [x, y, w, h] (CSS pixels)."""
    d = ImageDraw.Draw(im); x, y, bw, bh = [v * S for v in box]
    d.rounded_rectangle([x - pad, y - pad, x + bw + pad, y + bh + pad], 14, outline=RED, width=w)

def circle(im, at, r=22, w=5):
    d = ImageDraw.Draw(im); x, y = at[0] * S, at[1] * S
    d.ellipse([x - r, y - r, x + r, y + r], outline=RED, width=w)

def arrow(im, frm, to, label=None, side='left', w=7):
    """A red arrow from frm to to (CSS pixels), with an optional label box at its tail."""
    d = ImageDraw.Draw(im); f = [v * S for v in frm]; t = [v * S for v in to]
    d.line([tuple(f), tuple(t)], fill=RED, width=w)
    a = math.atan2(t[1] - f[1], t[0] - f[0])
    for s in (0.45, -0.45): d.line([tuple(t), (t[0] - 30 * math.cos(a + s), t[1] - 30 * math.sin(a + s))], fill=RED, width=w)
    if label: tag(im, f, label, side)

def tag(im, at, label, side='left'):
    """A white label box with red text; at is in image pixels."""
    d = ImageDraw.Draw(im); ft = _font(30)
    lines = label.split('\n'); tw = max(ft.getlength(t) for t in lines); th = 40 * len(lines)
    x = at[0] - tw - 18 if side == 'left' else at[0] + 18
    x = max(16, min(x, im.width - tw - 16))
    y = max(12, min(at[1] - th / 2, im.height - th - 12))
    d.rounded_rectangle([x - 14, y - 8, x + tw + 14, y + th + 6], 12, fill=(255, 255, 255), outline=RED, width=4)
    for i, t in enumerate(lines): d.text((x, y + i * 40), t, font=ft, fill=RED)

def num(im, at, n):
    """A numbered blue dot (step number) at a screen point (CSS pixels)."""
    d = ImageDraw.Draw(im); x, y = at[0] * S, at[1] * S; ft = _font(38, True)
    d.ellipse([x - 28, y - 28, x + 28, y + 28], fill=BLUE)
    d.text((x - ft.getlength(str(n)) / 2, y - 25), str(n), font=ft, fill='white')

def save(im, name, w=1100, crop=None):
    """Save as a compact JPEG in help/img (crop in CSS pixels)."""
    if crop: im = im.crop([v * S for v in crop])
    im = im.convert('RGB'); im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=80, optimize=True); print('wrote', name)

async def open_app(p, width=1280, height=720, init=None):
    """Start the built app (local/3DJames.html) at 1.5x and wait for the geometry engine. init: a script run first."""
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': width, 'height': height}, device_scale_factor=S)
    if init: await ctx.add_init_script(init)
    pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(APP)
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    return b, pg, errs

async def shot(pg, wait=350):
    """A screenshot of the page as a Pillow image."""
    await pg.wait_for_timeout(wait)
    path = os.path.join(tempfile.gettempdir(), '3dj-help-shot.png')
    await pg.screenshot(path=path)
    return Image.open(path).convert('RGB')

async def box(pg, sel):
    """Screen rectangle [x, y, w, h] of the last element matching a CSS selector."""
    return await pg.evaluate("(s)=>{const e=[...document.querySelectorAll(s)].pop(); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]}", sel)
