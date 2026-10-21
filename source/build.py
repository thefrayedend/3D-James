# Builds the single-file app: local/3DJames.html (everything inside, works offline, no install).
#   python3 build.py
import base64, gzip, json, os, shutil, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
DIST = 'dist'
shutil.rmtree(DIST, ignore_errors=True)
os.makedirs(DIST)
os.makedirs('local', exist_ok=True)

def esbuild(entry, out, *extra):
    subprocess.run([shutil.which('node') or 'node', os.path.join(ROOT, 'tools', 'bundle.mjs'), entry, f'{DIST}/{out}', *extra], check=True)

esbuild('src/app.js', 'app.js')
# the geometry engine runs as a classic web worker made from a blob, so it needs no files next to the page
esbuild('src/worker.js', 'worker.js', '--external:node:*', '--define:import.meta.url=self.location.href')

def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()

occ = base64.b64encode(gzip.compress(open('node_modules/replicad-opencascadejs/dist/replicad_single.wasm', 'rb').read(), 9)).decode()
embed = 'window.__3DJ_EMBED={worker:"%s",occ:"%s",manifold:"%s",sans:"%s",round:"%s"};' % (
    b64(f'{DIST}/worker.js'), occ, b64('node_modules/manifold-3d/manifold.wasm'),
    b64('assets/fonts/DejaVuSans-Bold.ttf'), b64('assets/fonts/Poppins-Bold.ttf'))
# the open-source credits and their license texts (Help > About / Licenses)
credits = json.load(open('licenses/credits.json', encoding='utf-8'))
lic = {'credits': credits, 'texts': {c['file']: open('licenses/' + c['file'], encoding='utf-8').read() for c in credits}, 'notice': open('licenses/README.txt', encoding='utf-8').read(), 'own': open('COPYING', encoding='utf-8').read()}
VERSION = open('VERSION', encoding='utf-8').read().strip()
embed += 'window.__3DJ_VERSION=%s;' % json.dumps(VERSION)
embed += 'window.__3DJ_LICENSES=%s;' % json.dumps(lic).replace('</', '<\\/')
# the help pages (Help tab): help/pages/<id>.html with pictures from help/img, in the order of help/pages/contents.json
# (chapters, each with its pages). Every page must be listed exactly once.
import glob, re
contents = json.load(open('help/pages/contents.json', encoding='utf-8'))
files = {os.path.basename(f)[:-5] for f in glob.glob('help/pages/*.html')}
listed = [pid for s in contents for pid in s['pages']]
assert len(listed) == len(set(listed)), 'a help page is listed twice in contents.json'
assert set(listed) == files, f'help pages not in contents.json: {sorted(files - set(listed))}; listed but missing: {sorted(set(listed) - files)}'
pages = []
for s in contents:
    for page_id in s['pages']:
        body = open(f'help/pages/{page_id}.html', encoding='utf-8').read()
        title = re.search(r'<h1>(.*?)</h1>', body).group(1)
        pages.append({'id': page_id, 'title': title, 'html': body, 'section': s['section']})
examples = {}
for f in sorted(glob.glob('help/examples/*.json')):
    key = os.path.basename(f)[:-5]
    if key == 'validation': continue
    examples[key] = {'doc': json.load(open(f, encoding='utf-8')), 'archive': b64('help/examples/' + key + '.3dj')}
imgs = {os.path.basename(f): 'data:image/jpeg;base64,' + b64(f) for f in glob.glob('help/img/*.jpg')}
embed += 'window.__3DJ_HELP=%s;' % json.dumps({'pages': pages, 'img': imgs, 'examples': examples}).replace('</', '<\\/')

html = open('index.html', encoding='utf-8').read()
app = open(f'{DIST}/app.js', encoding='utf-8').read().replace('</script', '<\\/script')
html = (html.replace('ICON_256', 'data:image/png;base64,' + b64('assets/icon-256.png'))
            .replace('ICON_32', 'data:image/png;base64,' + b64('assets/icon-32.png'))
            .replace('<script>EMBED</script>', '<script>' + embed + '</script>')
            .replace('<script>APP</script>', '<script>' + app + '</script>'))
open('local/3DJames.html', 'w', encoding='utf-8').write(html)
print(f'local/3DJames.html {len(html) / 1e6:.2f} MB, version {VERSION}')
