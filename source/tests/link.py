# The AI link: 3DJamesLink.exe (an MCP server, windows-desktop/link/) driving the real app (src/bridge.js), the way
# Gemini CLI or Claude would. Checks the "Allow?" question, every tool (steps, variables, objects, build report,
# picture, save / overwrite question / reopen, Make editable, Undo), a second AI handing its jobs to the first,
# Stop, and that a web site cannot ask for jobs.
#   python windows-desktop/link/build_link.py && python build.py && python tests/link.py
import base64, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
SRC = HERE.parent
EXE = SRC / 'local' / '3DJamesLink.exe'
READY = 'window.__3dj && document.getElementById("loading").hidden && !window.__3dj.app.building'
fails = []


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what, flush=True)
    if not ok:
        fails.append(what)


class Mcp:
    """One AI: starts its own copy of the link and talks MCP to it."""
    def __init__(self, projects, client='gemini-cli-mcp-client'):
        self.p = subprocess.Popen([str(EXE), '--projects', str(projects), '--port', '47841'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        self.n = 0
        self.lock = threading.Lock()
        self.waiting = {}
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=lambda: [None for _ in self.p.stderr], daemon=True).start()
        r = self.rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': client, 'version': '1'}})
        self.info = r['result']
        self.p.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n'); self.p.stdin.flush()

    def _read(self):
        for line in self.p.stdout:
            m = json.loads(line)
            ev = self.waiting.get(m.get('id'))
            if ev is not None:
                ev.append(m)

    def rpc(self, method, params, timeout=600):
        with self.lock:
            self.n += 1
            i = self.n
            box = []
            self.waiting[i] = box
            self.p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': i, 'method': method, 'params': params}) + '\n'); self.p.stdin.flush()
        t = time.time()
        while not box:
            if time.time() - t > timeout:
                raise TimeoutError(method)
            time.sleep(0.02)
        return box[0]

    def call(self, name, args=None, timeout=600):
        r = self.rpc('tools/call', {'name': name, 'arguments': args or {}}, timeout)['result']
        c = r['content']
        if r.get('isError'):
            return {'_error': c[0]['text']}
        if c[0]['type'] == 'image':
            return {'_image': c[0]['data']}
        return json.loads(c[0]['text']) if c[0]['text'][:1] in '{[' else c[0]['text']

    def close(self):
        self.p.stdin.close()
        self.p.wait(10)


def call_async(mcp, name, args=None):
    out = {}
    th = threading.Thread(target=lambda: out.setdefault('r', mcp.call(name, args)))
    th.start()
    return th, out


def main():
    if not EXE.exists():
        sys.exit('build 3DJamesLink.exe first: python windows-desktop/link/build_link.py')
    projects = Path(tempfile.mkdtemp(prefix='3dj-link-'))
    shutil.copy(HERE / 'fixtures' / 'stl' / 'bracket.stl', projects / 'bracket.stl')
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = b.new_context(viewport={'width': 1400, 'height': 860})
        ctx.add_init_script("localStorage.setItem('3djames.link', 'test'); localStorage.setItem('3djames.linkport', '47841')")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto((SRC / 'local' / '3DJames.html').as_uri())
        page.wait_for_function(READY, timeout=120000)

        gem = Mcp(projects)
        check(gem.info['serverInfo']['name'] == '3djames', 'initialize answers as 3djames')
        tools = {t['name'] for t in gem.rpc('tools/list', {})['result']['tools']}
        check({'status', 'add_steps', 'picture', 'save_project', 'make_editable', 'how_to_write_steps'} <= tools, f'tools/list has the tools ({len(tools)})')
        guide = gem.call('how_to_write_steps')
        check('sketch' in guide and 'add_steps' in guide and 'Units and coordinates' in guide, 'the step guide comes from the skill')

        # the first job: 3DJames asks the user; say no, then yes
        page.wait_for_timeout(1500)
        th, out = call_async(gem, 'status')
        page.get_by_role('button', name="Don't allow").click(timeout=30000)
        th.join(60)
        check('_error' in out['r'] and 'said no' in out['r']['_error'], 'Don\'t allow is passed back to the AI')
        page.evaluate("() => {}")
        page.wait_for_timeout(200)
        # (declined: asked again only after a minute; reload the window to be asked again now)
        page.reload(); page.wait_for_function(READY, timeout=120000); page.wait_for_timeout(1500)
        th, out = call_async(gem, 'new_project', {'name': 'Link test', 'discard_changes': True})
        dlg = page.get_by_role('dialog')
        dlg.wait_for(timeout=30000)
        check('Gemini' in dlg.inner_text(), 'the question names Gemini')
        check(page.evaluate('document.title').startswith('(!) Allow Gemini') or page.wait_for_function("document.title.startsWith('(!) Allow Gemini')", timeout=3000), 'the window title asks too (seen in the taskbar)')
        # a window behind others is slowed down to about one check-in a minute: answer late, with no check-ins at all
        page.evaluate("() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('/page/alive') ? new Promise(() => {}) : f(u, o); }")
        page.wait_for_timeout(70000)
        page.get_by_role('button', name='Allow', exact=True).click()
        th.join(60)
        check(out['r'].get('project') == 'Link test' and out['r'].get('steps') == 0, f'new_project after a late Allow ({str(out["r"])[:120]})')
        check(page.get_by_text('Gemini can work here').is_visible(), 'the window shows that Gemini can work here')

        r = gem.call('add_steps', {
            'vars': [{'name': 'plateW', 'expr': '80'}],
            'objects': {'b1': {'name': 'Base plate', 'color': '#22B14C'}, 'b2': {'name': 'Corner hole', 'color': '#8b96a3', 'hole': True}},
            'steps': [
                {'type': 'shape', 'kind': 'box', 'name': 'Base plate', 'body': 'b1', 'p': {'w': 'plateW', 'd': 60, 'h': 5}, 'pos': [0, 0, 0], 'rot': [0, 0, 0]},
                {'type': 'shape', 'kind': 'cyl', 'name': 'Corner hole', 'body': 'b2', 'p': {'d': 6, 'h': 10}, 'pos': [30, 20, -2], 'rot': [0, 0, 0]},
                {'type': 'combine', 'op': 'subtract', 'name': 'Cut the corner hole', 'body': 'b1', 'tools': ['b2']},
            ]})
        check(r.get('built') and r['overall']['size_mm'] == [80, 60, 5], f'add_steps builds an 80 x 60 x 5 plate ({r.get("overall")})')
        v0 = r['overall']['volume_cm3']
        check(abs(v0 - (80 * 60 * 5 - 3.14159 * 9 * 5) / 1000) < 0.05, f'volume has the hole taken out ({v0} cm3)')
        check(page.evaluate('window.__3dj.store.undoStack.length') >= 1, 'the change is an Undo step')

        r = gem.call('set_vars', {'vars': [{'name': 'plateW', 'expr': '100'}]})
        check(r['overall']['size_mm'][0] == 100, 'set_vars changes the width to 100')
        r = gem.call('change_step', {'id': r['objects'][0] and 'f1', 'changes': {'p': {'h': 8}}})
        check(r['overall']['size_mm'] == [100, 60, 8], f'change_step merges p (height 8) {r["overall"]["size_mm"]}')
        r = gem.call('change_step', {'id': 'f2', 'changes': {'kind': 'nonsense'}})
        check(not r['built'] and r['problems'], f'a broken step comes back as a problem ({r["problems"][:1]})')
        r = gem.call('undo')
        check(r['built'] and r['undone'] == 1, 'undo fixes it')
        r = gem.call('add_steps', {'steps': [{'type': 'combine', 'op': 'subtract', 'body': 'b1', 'tools': ['b9']}]})
        check('_error' not in r and 'note' in r and 'b9' in r['note'], 'a missing object is pointed out')
        gem.call('undo')
        r = gem.call('add_steps', {'steps': [{'id': 'f1', 'type': 'shape', 'kind': 'box'}]})
        check('_error' in r and 'already used' in r['_error'], 'a used step id is refused and nothing changes')
        r = gem.call('set_objects', {'objects': {'b1': {'color': '#00A2E8'}}})
        check(page.evaluate("window.__3dj.store.doc.bodies.b1.color") == '#00A2E8', 'set_objects recolours')
        r = gem.call('get_project')
        check(len(r['project']['features']) == 3 and r['project']['vars'][0]['expr'] == '100', 'get_project gives the steps')

        r = gem.call('picture', {'view': 'front', 'width': 600})
        png = base64.b64decode(r.get('_image', ''))
        check(png[:4] == b'\x89PNG' and len(png) > 2000, f'picture is a PNG ({len(png)} bytes)')

        r = gem.call('save_project', {'name': 'Plate test'})
        f = projects / 'Plate test.3dj'
        check(f.exists() and 'project.json' in zipfile.ZipFile(f).namelist(), f'save_project writes Projects/Plate test.3dj ({r})')
        check(page.evaluate("!window.__3dj.app.dirty && window.__3dj.app.file.name") == 'Plate test.3dj', 'the window shows it saved')
        r = gem.call('save_project', {'name': 'Plate test'})
        check('_error' in r and 'already exists' in r['_error'], 'saving over a file is refused without overwrite')
        th, out = call_async(gem, 'save_project', {'name': 'Plate test', 'overwrite': True})
        page.get_by_role('button', name='Keep the old file').click(timeout=30000)
        th.join(60)
        check('_error' in out['r'], 'the user can keep the old file')
        r = gem.call('save_project', {'name': 'Plate test', 'format': 'stl'})
        check((projects / 'Plate test.stl').exists(), 'save_project as STL')
        lst = gem.call('list_projects')
        check({'Plate test.3dj', 'Plate test.stl', 'bracket.stl'} <= {x['name'] for x in lst['projects']}, 'list_projects')
        r = gem.call('save_project', {'name': '..\\..\\escape'})
        check(not (projects.parent / 'escape.3dj').exists() and (projects / 'escape.3dj').exists(), 'saving stays inside Projects')

        gem.call('set_vars', {'vars': [{'name': 'plateW', 'expr': '50'}]})
        r = gem.call('open_project', {'name': 'Plate test'})
        check('_error' in r and 'not saved' in r['_error'], 'open refuses to throw away unsaved changes')
        r = gem.call('open_project', {'name': 'Plate test', 'discard_changes': True})
        check(r.get('overall', {}).get('size_mm') == [100, 60, 8], 'open_project reopens the saved plate')
        r = gem.call('open_project', {'name': 'C:\\Windows\\win.ini'})
        check('_error' in r, 'only 3D files open')

        # a second AI (Claude) hands its jobs to the first copy
        cl = Mcp(projects, 'claude-code')
        r = cl.call('status')
        check(r.get('open') and r.get('file') == 'Plate test.3dj', f'a second AI works through the first one ({r})')

        # a web site cannot ask for jobs; another program without the key cannot run them
        def http(url, data=None, headers={}):
            req = urllib.request.Request(url, data=data, headers=headers)
            try:
                return urllib.request.urlopen(req, timeout=30).status
            except urllib.error.HTTPError as e:
                return e.code
        check(http('http://127.0.0.1:47841/page/next?w=evil&focus=9e15', headers={'Origin': 'https://evil.example'}) == 403, 'a web site is turned away')
        check(http('http://127.0.0.1:47841/agent/job', b'{"tool":"status"}', {'X-Link-Key': 'wrong'}) == 403, 'a job without the key is turned away')

        r = gem.call('new_project', {'name': 'Editable', 'discard_changes': True})
        r = gem.call('make_editable', {'file': 'bracket'})
        res = r.get('result') or {}
        check(r.get('built') and res.get('done') and 'the same as the STL' in res.get('summary', ''), f'make_editable: {res.get("summary")}')
        page.keyboard.press('Escape')

        # Stop: the next job asks again
        page.get_by_role('button', name='Stop', exact=True).click()
        th, out = call_async(gem, 'status')
        page.get_by_role('button', name="Don't allow").click(timeout=30000)
        th.join(60)
        check('_error' in out['r'], 'after Stop the AI has to ask again')

        page.screenshot(path=str(SRC / 'dist' / 'link.png'))
        check(not errors, f'no page errors {errors[:2]}')
        cl.close(); gem.close()
        b.close()
    shutil.rmtree(projects, ignore_errors=True)
    print('FAILED: ' + '; '.join(fails) if fails else 'all link checks passed')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
