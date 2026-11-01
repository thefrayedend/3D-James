# Pictures for Help: Helpers (Object > Helpers). Real app screenshots, marked up.
# Run after build.py:  python help/shots/helpers_shots.py   (then python help/prepare_images.py is not needed: these are JPEGs)
import asyncio
from playwright.async_api import async_playwright
from markup import open_app, shot, box, ring, arrow, save

TOP = {'nc': [0.5, 0.5, 1], 'd': [0, 0, 1]}
def cube(i, w, d, h, pos=(0, 0, 0), name=None):
    return {'id': 'f' + i, 'type': 'shape', 'body': i, 'kind': 'box', 'p': {'w': w, 'd': d, 'h': h, 'round': 0, 'roundMode': 'all'}, 'pos': list(pos), 'rot': [0, 0, 0]}

async def main():
    async with async_playwright() as p:
        b, pg, errs = await open_app(p)
        built = lambda: pg.wait_for_function('(()=>{const a=window.__3dj.app;return !a.building && !a.pending && a.builtRevision===window.__3dj.store.revision})()', timeout=120000)
        async def scene(features, bodies, sel, step=None, view='home'):
            await pg.evaluate("""([features, bodies]) => { window.__3dj.commands.loadProject({ name: 'Helpers', vars: [], bodies, features, seq: 900 }, null); }""", [features, bodies])
            await built()
            await pg.evaluate("""([sel, step, view]) => { const B = window.__3dj, C = B.commands; B.app.settings.panelOpen = true; B.app.sel = sel; B.vp.setSelection(sel);
              if (step) { C.editStep(step); C.openPanel('props'); } else C.renderAll(); B.vp.view(view, false); }""", [sel, step, view])
            await pg.get_by_role('tab', name='Object', exact=True).click()
            await pg.wait_for_timeout(600)
        body = lambda name, color: {'name': name, 'color': color}

        # 1. the menu
        await scene([cube('b1', 60, 40, 20)], {'b1': body('Box', '#7092BE')}, ['b1'])
        await pg.get_by_role('button', name='Helpers', exact=True).click()
        im = await shot(pg)
        menu = await box(pg, '.menu')
        ring(im, menu, pad=4)
        save(im, 'helpers-menu.jpg', crop=(0, 0, 1280, 620))
        await pg.keyboard.press('Escape')

        # 2. split to fit the printer: pegs (the top half moved aside to show them)
        await scene([cube('b1', 120, 30, 16), {'id': 'fs', 'type': 'split', 'body': 'b1', 'body2': 'b2', 'off': 0, 'roll': 0, 'pitch': 90, 'yaw': 0, 'keep': 'both', 'joint': 'pegs', 'jd': 5, 'jl': 8, 'jn': 2, 'jgap': 0.15},
                     {'id': 'fm', 'type': 'move', 'body': 'b2', 'm': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 25, 0, 0, 1]}],
                    {'b1': body('Shelf', '#7092BE'), 'b2': body('Shelf (part 2)', '#FF7F27')}, ['b1'], 'fs', 'fit')
        im = await shot(pg)
        save(im, 'helpers-split.jpg')

        # 3. a lid for a hollowed box
        await scene([cube('b1', 50, 36, 24), {'id': 'fh', 'type': 'shell', 'body': 'b1', 'faces': [TOP], 't': 2},
                     {'id': 'fl', 'type': 'lid', 'src': 'b1', 'body': 'b2', 'style': 'friction', 't': 2, 'lip': 4, 'wall': 1.2, 'gap': 0.15, 'slot': 1, 'dx': 60, 'dy': 0}],
                    {'b1': body('Box', '#7092BE'), 'b2': body('Box lid', '#FF7F27')}, ['b2'], 'fl', 'fit')
        im = await shot(pg)
        save(im, 'helpers-lid.jpg')

        # 4. a pin hinge between two plates
        await scene([cube('b1', 50, 40, 5, (-27, 0, 0)), cube('b2', 50, 40, 5, (27, 0, 0)),
                     {'id': 'fg', 'type': 'hinge', 'body': 'b1', 'body2': 'b2', 'style': 'pin', 'd': 5, 'n': 0, 'pin': 0, 'clear': 0.3, 'kgap': 0.4, 't': 0.6, 'margin': 1}],
                    {'b1': body('Cover', '#7092BE'), 'b2': body('Base', '#FF7F27')}, ['b1'], 'fg', 'fit')
        im = await shot(pg)
        save(im, 'helpers-hinge.jpg')

        # 5. screw holes and vents on a plate
        await scene([cube('b1', 80, 50, 6),
                     {'id': 'fo', 'type': 'holes', 'body': 'b1', 'face': TOP, 'kind': 'countersunk', 'size': 'M3', 'd': 3.4, 'hd': 6.72, 'depth': 0, 'pts': [[-33, -18], [33, -18], [-33, 18], [33, 18]]},
                     {'id': 'fv', 'type': 'vents', 'body': 'b1', 'face': TOP, 'pattern': 'hex', 's': 5, 'bar': 1.6, 'margin': 4, 'depth': 0}],
                    {'b1': body('Cover plate', '#7092BE')}, ['b1'], 'fo', 'fit')
        im = await shot(pg)
        save(im, 'helpers-holes.jpg')

        # 6. fit around: a battery cut out of a holder with a 0.2 mm gap; the battery stays (lifted to show the pocket)
        await scene([cube('b1', 40, 30, 14), {'id': 'fc', 'type': 'shape', 'body': 'b2', 'kind': 'cyl', 'p': {'d': 18.4, 'h': 30}, 'pos': [0, 0, 4], 'rot': [0, 90, 0]},
                     {'id': 'ff', 'type': 'fit', 'body': 'b1', 'tools': ['b2'], 'gap': 0.2, 'keepPart': True},
                     {'id': 'fm', 'type': 'move', 'body': 'b2', 'm': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 22, 1]}],
                    {'b1': body('Holder', '#7092BE'), 'b2': body('Battery', '#22B14C')}, ['b1'], 'ff', 'fit')
        im = await shot(pg)
        save(im, 'helpers-fit.jpg')

        # 7. a snap hook and its window
        await scene([cube('b1', 40, 20, 4, (-25, 0, 0)), cube('b2', 40, 20, 4, (25, 0, 0)),
                     {'id': 'fn', 'type': 'snap', 'body': 'b1', 'face': TOP, 'mode': 'hook', 'w': 6, 'len': 8, 't': 1.6, 'barb': 0.8, 'gap': 0.2, 'u': 0, 'v': 0, 'angle': 0, 'depth': 0},
                     {'id': 'fw', 'type': 'snap', 'body': 'b2', 'face': TOP, 'mode': 'window', 'w': 6, 'len': 8, 't': 1.6, 'barb': 0.8, 'gap': 0.2, 'u': 0, 'v': 0, 'angle': 0, 'depth': 0}],
                    {'b1': body('Part with the hook', '#7092BE'), 'b2': body('Part with the window', '#FF7F27')}, ['b1'], 'fn', 'fit')
        im = await shot(pg)
        save(im, 'helpers-snap.jpg')
        print('page errors:', errs)
        await b.close()

asyncio.run(main())
