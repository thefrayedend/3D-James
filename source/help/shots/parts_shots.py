# Pictures for the Help pages "Ready-made parts", "Gridfinity", "Gears" and "Printer and workshop parts":
# parts-menu, parts-gridfinity, parts-gears, parts-gallery. Real app screenshots, real clicks, marked up.
# Run after build.py:  python help/shots/parts_shots.py
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, tag, num, save

SCENE = '''async ([list, dir]) => {
  const B = window.__3dj, C = B.commands, S = B.store, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const built = async () => { await sleep(60); for (let i = 0; i < 4000; i++) { if (!B.app.building && !B.app.pending) { await sleep(40); if (!B.app.building && !B.app.pending) return; } await sleep(30); } };
  C.newProject(); await built(); B.app.settings.panelOpen = false; C.renderAll();
  const ids = [];
  for (const [kind, extra, x, y, rot] of list) {
    const id = C.addShape(kind, extra); await built();
    S.commit((d) => { const f = d.features.find((q) => q.type === 'shape' && q.body === id); f.pos = [x, y, 0]; if (rot) f.rot = rot; }); await built();
    ids.push(id);
  }
  B.app.sel = []; B.vp.setSelection([]); C.renderAll(); B.vp.anim = null;
  // the camera: looking along dir, as close as lets everything fill 85 % of the picture
  const vp = B.vp, T = vp.camera.position.constructor, bx = vp.sceneBox(), c = bx.getCenter(new T()), d = new T(...dir).normalize();
  let dist = bx.getSize(new T()).length() * 1.5;
  for (let k = 0; k < 8; k++) {
    vp.camera.position.copy(c).addScaledVector(d, dist); vp.orbit.target.copy(c); vp.orbit.update(); vp.camera.updateMatrixWorld();
    const r = vp.renderer.domElement.getBoundingClientRect(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const xs of [bx.min.x, bx.max.x]) for (const ys of [bx.min.y, bx.max.y]) for (const zs of [bx.min.z, bx.max.z]) { const q = vp.toScreen(new T(xs, ys, zs)); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    dist *= Math.max((x1 - x0) / (0.85 * r.width), (y1 - y0) / (0.85 * r.height));
    // and slide the view so the objects are in the middle of the picture
    const right = new T().setFromMatrixColumn(vp.camera.matrixWorld, 0), up = new T().setFromMatrixColumn(vp.camera.matrixWorld, 1), wpp = vp.worldPerPixel(vp.orbit.target);
    const shift = right.multiplyScalar(((x0 + x1) / 2 - r.left - r.width / 2) * wpp).add(up.multiplyScalar(-(((y0 + y1) / 2 - r.top - r.height / 2) * wpp)));
    c.add(shift);
  }
  vp.requestRender(); await sleep(500);
  return ids;
}'''

async def where(pg, id, up=0):
    """Screen point (CSS pixels) of the middle of an object's top (plus up mm)."""
    return await pg.evaluate("""([id, up]) => { const B = __3dj, b = B.app.results.bodies.get(id).bbox, V = B.vp.camera.position.constructor;
      const q = B.vp.toScreen(new V((b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, b[1][2] + up)); return [q.x, q.y]; }""", [id, up])

async def rect(loc):
    r = await loc.bounding_box()
    return [r['x'], r['y'], r['width'], r['height']]

async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        # ---- the menu
        await pg.evaluate("async () => { __3dj.commands.newProject(); await new Promise((r) => setTimeout(r, 600)); __3dj.app.settings.panelOpen = false; __3dj.commands.renderAll(); }")
        await pg.get_by_role('tab', name='Insert', exact=True).click()
        parts_btn = pg.locator('#cmdbar .cb', has_text='Parts').first
        await parts_btn.click()
        item1 = pg.locator('.menu').locator('.mi', has_text='Organizing').first; await item1.click()
        item2 = pg.locator('.menu.sub[data-level="1"]').locator('.mi', has_text='Gridfinity bin').first; await item2.click()
        item3 = pg.locator('.menu.sub[data-level="2"] .mi', has_text='2 × 1 × 3').first; await item3.hover()
        im = await shot(pg)
        for n, loc, off in [(1, parts_btn, (-8, 22)), (2, item1, (-100, 0)), (3, item2, (-96, 0)), (4, item3, (-100, 0))]:
            r = await rect(loc)
            if n == 1: ring(im, r, pad=6)
            num(im, (r[0] + r[2] + off[0] if n != 1 else r[0] + r[2] / 2 - 60, r[1] + r[3] / 2 + off[1]) if n == 1 else (r[0] - 24 if n != 4 else r[0] - 24, r[1] + r[3] / 2), n)
        save(im, 'parts-menu.jpg', crop=(0, 0, 1280, 720))
        await pg.keyboard.press('Escape')

        # ---- Gridfinity: a baseplate with bins in it
        ids = await pg.evaluate(SCENE, [[
            ['gfbaseplate', {'nx': 2, 'ny': 2}, 0, 0], ['gfbin', {'nx': 2, 'ny': 1, 'nz': 3, 'divx': 2}, 0, -21], ['gfbin', {'nx': 1, 'ny': 1, 'nz': 4}, -21, 21],
            ['gfbin', {'nx': 1, 'ny': 1, 'nz': 2}, 100, -21], ['gfbaseplate', {'nx': 2, 'ny': 1}, 100, 21]], [-0.3, -1, 0.85]])
        im = await shot(pg)
        a = await where(pg, ids[1], 0); c = await where(pg, ids[4], 0); g = await where(pg, ids[2], 0)
        arrow(im, (a[0] - 60, a[1] + 150), (a[0] - 40, a[1] + 30), 'A bin: its foot fits the\nbaseplate pocket', side='right')
        arrow(im, (c[0] + 120, c[1] - 130), (c[0] + 30, c[1] - 14), 'A baseplate:\nthe open grid\nthe bins sit in', side='right')
        arrow(im, (g[0] - 250, g[1] - 60), (g[0] - 40, g[1] - 4), 'Taller bins: more units\nof 7 mm', side='left')
        save(im, 'parts-gridfinity.jpg', crop=tuple(await box(pg, '#view')))

        # ---- gears: two gears, a rack, a worm, a helical and a bevel gear
        ids = await pg.evaluate(SCENE, [[
            ['gear', {'type': 'spur', 'z': 30, 'm': 1.5, 'w': 10, 'bore': 6}, 0, 0], ['gear', {'type': 'spur', 'z': 12, 'm': 1.5, 'w': 10, 'bore': 5}, 31.5, 0, [0, 0, 15]],
            ['rack', {'m': 1.5, 'teeth': 15, 'w': 10}, 0, -25.2], ['worm', {'len': 40, 'pitchD': 14, 'bore': 5}, 80, 14],
            ['gear', {'type': 'helical', 'z': 24, 'm': 1.5, 'w': 12, 'helix': 20, 'bore': 5}, -70, 8], ['gear', {'type': 'bevel', 'z': 20, 'mate': 20, 'w': 8, 'm': 1.5, 'bore': 5}, 0, 50]], [-0.25, -1, 0.9]])
        im = await shot(pg)
        for i, label, dx, dy in [(0, 'Spur gears (they mesh)', -250, 20), (2, 'Rack', 20, 70), (3, 'Worm', 70, -90), (4, 'Helical gear', -60, -80), (5, 'Bevel gear', 100, -50)]:
            q = await where(pg, ids[i], 2)
            arrow(im, (q[0] + dx, q[1] + dy), (q[0] + dx * 0.12, q[1] + dy * 0.12), label, side='right')
        save(im, 'parts-gears.jpg', crop=tuple(await box(pg, '#view')))

        # ---- a gallery of printable parts (numbered; the names are in the caption)
        grid = [('hinge', {}), ('balljoint', {}), ('ujoint', {}), ('knob', {}), ('thumbscrew', {}),
                ('gt2pulley', {}), ('boardhook', {'style': 'pegboard'}), ('lidbox', {'part': 'box', 'style': 'hinged', 'w': 50, 'd': 35, 'h': 25}), ('drawerpull', {'spacing': 64}), ('tolerancetest', {}),
                ('boardposts', {'board': 'pi4'}), ('fanmount', {'size': '60', 'side': 60, 'spacing': 50, 'screw': 3.4, 'open': 56}), ('cableclip', {}), ('snapfit', {}), ('vwheel', {})]
        ids = await pg.evaluate(SCENE, [[[k, e, (i % 5) * 105, (i // 5) * 85] for i, (k, e) in enumerate(grid)], [-0.15, -1, 1.1]])
        im = await shot(pg)
        for n, id in enumerate(ids, 1):
            q = await where(pg, id, 0)
            num(im, (q[0], q[1] - 6), n)
        save(im, 'parts-gallery.jpg', crop=tuple(await box(pg, '#view')))
        await b.close()
        if errs: print('PAGE ERRORS:', errs)

asyncio.run(main())
