# Send feedback (Help page and the File menu): the dialog, the GitHub report it opens (title, words, version, the
# model's problems), the copy of the project for the report (.3dj.zip in Downloads) and that it opens again.
# Run after build.py:  python tests/feedback.py
import asyncio, os, sys, urllib.parse
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
fails = []
def check(name, ok, info=''):
  print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  {str(info)[:300]}'), flush=True)
  if not ok: fails.append(name)
WAIT = 'async () => { const { app, store } = window.__3dj; while (app.building || app.pending || app.builtRevision !== store.revision) await new Promise((r) => setTimeout(r, 20)); }'

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': 1300, 'height': 820}, accept_downloads=True)
    pg = await ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.goto((ROOT / 'local/3DJames.html').as_uri())
    await pg.wait_for_function('window.__3dj && document.getElementById("loading").hidden', timeout=120000)
    ev = pg.evaluate
    # a project with a problem in it: a round edge bigger than the box
    await ev('''async () => { const { commands: C, store: S } = window.__3dj; C.newProject(); const id = C.addShape('box', { w: 20, d: 20, h: 10 });
      await (''' + WAIT + ''')(); S.commit((d) => { d.name = 'Feedback test'; d.features.push({ id: 'fz', type: 'fillet', name: 'Too round', body: id, edges: [{ nc: [0.5, 0, 1], d: [1, 0, 0] }], r: 30 }); }); }''')
    await ev(WAIT)
    await ev("() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }")

    # from the Help page
    await pg.get_by_role('tab', name='Help', exact=True).click()
    await pg.get_by_role('button', name='Send feedback').click()
    dlg = pg.get_by_role('dialog')
    check('Help > Send feedback opens the dialog', await dlg.count() == 1 and 'GitHub' in await dlg.inner_text())
    check('it says 3DJames itself sends nothing', 'sends nothing' in await dlg.inner_text())
    check('a project with a problem: "Something went wrong" is picked', await dlg.locator('select').input_value() == 'problem')
    # nothing written yet: it asks for words
    await pg.get_by_role('button', name='Open the report').click()
    check('it asks for a few words first', await pg.locator('.toast', has_text='Write a few words').count() == 1 and await ev('() => window.__opened.length') == 0)
    await pg.get_by_label('Title').fill('Round edges fail')
    await pg.get_by_label('What happened, or what you would like').fill('I rounded the top edge and it failed.')
    async with pg.expect_download() as dl:
      await pg.get_by_role('button', name='Open the report').click()
    d = await dl.value
    path = os.path.join(os.environ.get('TEMP', '/tmp'), d.suggested_filename); await d.save_as(path)
    url = (await ev('() => window.__opened'))[0]
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    check('it opens a new report on the 3DJames GitHub page', url.startswith('https://github.com/thefrayedend/3D-James/issues/new?'), url[:80])
    body = q.get('body', [''])[0]
    check('the report has the title and the words', q.get('title') == ['Round edges fail'] and 'I rounded the top edge' in body, q)
    check('the report has the version and the problem', ('3DJames ' + await ev('() => window.__3DJ_VERSION')) in body and 'Too round' in body, body)
    check('the copy of the project is a .3dj.zip (GitHub takes zips)', d.suggested_filename == 'Feedback-test.3dj.zip', d.suggested_filename)
    check('the report says to drag the copy in', 'Feedback-test.3dj.zip' in body)
    check('the dialog closed and a note says what to do next', await pg.get_by_role('dialog').count() == 0 and await pg.locator('.toast', has_text='Downloads').count() == 1)

    # the copy opens again in 3DJames (dropped on the window, or opened)
    ok = await ev('''async (bytes) => { const { commands: C, store: S } = window.__3dj; C.newProject();
      await C.openFile(new File([new Uint8Array(bytes)], 'Feedback-test.3dj.zip'), null); await (''' + WAIT + ''')();
      return S.doc.features.length === 2 && S.doc.features[1].name === 'Too round'; }''', list(open(path, 'rb').read()))
    check('the .3dj.zip opens in 3DJames as the project', ok)

    # from the File menu, with nothing in the project: no project to attach
    await ev('async () => { window.__3dj.commands.newProject(); }'); await ev(WAIT)
    await pg.get_by_role('tab', name='Insert', exact=True).click()
    await pg.get_by_role('button', name='File menu').click()
    await pg.get_by_role('button', name='Send feedback…').click()
    box = pg.get_by_role('dialog').locator('input[type=checkbox]')
    check('File menu > Send feedback; an empty project has nothing to attach', await box.is_disabled() and not await box.is_checked())
    await pg.get_by_role('button', name='Cancel').click()
    check('no page errors', not errors, errors)
    await b.close()
  print('all passed' if not fails else f'{len(fails)} failed')
  sys.exit(1 if fails else 0)

asyncio.run(main())
