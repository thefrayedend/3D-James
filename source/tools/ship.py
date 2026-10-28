# Puts a fresh build where it is used. Run after build.py:  python tools/ship.py
#   1. local/3DJames.html is copied to the 3DJames folder (..\3DJames.html, the one you open) and to ..\single
#   2. the version number in ..\README.txt is brought up to date, and ..\icons\originals is remade
#   3. ..\Share\3djames-project-skill.zip: the Claude skill (source\skill) that writes .3dj projects, and
#      ..\Share\3DJames guide for Copilot.txt: the same guide for chat AIs without skills
#   4. the AI link (windows-desktop\link): 3DJamesLink.exe, and the files that tell Gemini and Claude about it
# The 3DJames folder (the one above source) is the master copy of everything that ships; nothing is kept twice.
import os, re, shutil, subprocess, zipfile
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.dirname(SRC)  # the 3DJames folder
os.chdir(SRC)
VERSION = open('VERSION', encoding='utf-8').read().strip()
built = os.path.join(SRC, 'local', '3DJames.html')
if not os.path.exists(built): raise SystemExit('Build first: python build.py')

# 0. a changed app gets a new version number: if this build differs from the one already shipped but carries the same
#    number, the last part goes up by one (VERSION and package.json) and the app is built again with it
VERSION_RE = re.compile(rb'window\.__3DJ_VERSION="([^"]*)"')
def version_in(path):
    m = VERSION_RE.search(open(path, 'rb').read()) if os.path.exists(path) else None
    return m.group(1).decode() if m else None
shipped = os.path.join(APP, '3DJames.html')
def without_version(path): return VERSION_RE.sub(b'', open(path, 'rb').read())
if version_in(shipped) == VERSION and without_version(shipped) != without_version(built):
    parts = VERSION.split('.'); parts[-1] = str(int(parts[-1]) + 1); new = '.'.join(parts)
    open('VERSION', 'w', encoding='utf-8', newline='\n').write(new + '\n')
    pkg = open('package.json', encoding='utf-8').read()
    open('package.json', 'w', encoding='utf-8', newline='\n').write(re.sub(r'"version": "[^"]*"', f'"version": "{new}"', pkg, count=1))
    print(f'Changed since {VERSION} was shipped: now version {new}')
    subprocess.run([shutil.which('python') or 'python', 'build.py'], check=True)
    VERSION = new

# 1. the app itself
for dest in [os.path.join(APP, '3DJames.html'), os.path.join(APP, 'single', '3DJames.html')]:
    if os.path.isdir(os.path.dirname(dest)): shutil.copyfile(built, dest); print('copied to', dest)

# 2. README version and the built-in button pictures
readme = os.path.join(APP, 'README.txt')
if os.path.exists(readme):
    t = open(readme, encoding='utf-8').read()
    t2 = re.sub(r'^Version .*$', 'Version ' + VERSION, t, count=1, flags=re.M)
    if t2 != t: open(readme, 'w', encoding='utf-8', newline='\r\n').write(t2.replace('\r\n', '\n'))
subprocess.run([shutil.which('node') or 'node', os.path.join('tools', 'make_icons.mjs'), os.path.join(APP, 'icons')], check=True)

# 4. The AI link: built here, copied next to 3DJames.html with what tells the AIs about it
LINK_FILES = {'GEMINI.md': 'GEMINI.md', 'Connect Antigravity.cmd': 'Connect Antigravity.cmd', 'mcp.json': '.mcp.json'}
for gone in ['Ask Gemini.cmd', os.path.join('.gemini', 'settings.json')]:  # Gemini CLI: Google stopped its free sign-in (June 2026)
    if os.path.exists(os.path.join(APP, gone)): os.remove(os.path.join(APP, gone))
try:
    subprocess.run([shutil.which('python') or 'python', os.path.join('windows-desktop', 'link', 'build_link.py')], check=True)
    shutil.copyfile(os.path.join(SRC, 'local', '3DJamesLink.exe'), os.path.join(APP, '3DJamesLink.exe'))
    for f, dest in LINK_FILES.items():
        os.makedirs(os.path.dirname(os.path.join(APP, dest)), exist_ok=True)
        shutil.copyfile(os.path.join(SRC, 'windows-desktop', 'link', 'ai', f), os.path.join(APP, dest))
    print('AI link copied to', APP)
except (OSError, subprocess.CalledProcessError) as e:
    print('AI link NOT updated:', e)

# (no share zip any more: 3DJames is shared as the installer, Installation\Make 3DJames Installer.cmd)

# 3. the Claude skill that writes 3DJames projects (upload it at claude.ai > Settings > Capabilities > Skills)
skill = os.path.join(SRC, 'skill', '3djames-project')
# nothing personal may go in it: the words in Installation\Private words.txt (the installer's list) and the Windows
# user name, in any file of the skill
private = [os.environ.get('USERNAME', '')]
words_file = os.path.join(APP, 'Installation', 'Private words.txt')
if os.path.exists(words_file):
    private += [w.strip() for w in open(words_file, encoding='utf-8-sig') if w.strip() and not w.lstrip().startswith('#')]
private = [w for w in private if len(w) >= 3]
copilot = os.path.join(SRC, 'skill', 'copilot')
found = []
for base, _, files in [w for d in (skill, copilot) if os.path.isdir(d) for w in os.walk(d)]:
    for f in files:
        text = open(os.path.join(base, f), encoding='utf-8', errors='replace').read()
        found += [f'{f}: "{w}"' for w in private if re.search(r'(?<![A-Za-z0-9])' + re.escape(w) + r'(?![A-Za-z0-9])', text, re.I)]
if found:
    print('Claude skill and Copilot guide NOT made, they have personal words in them:', ', '.join(found))
elif os.path.isdir(skill):
    sz = os.path.join(APP, 'Share', '3djames-project-skill.zip')
    with zipfile.ZipFile(sz, 'w', zipfile.ZIP_DEFLATED) as z2:
        for base, _, files in os.walk(skill):
            for f in sorted(files):
                src = os.path.join(base, f); z2.write(src, '3djames-project/' + os.path.relpath(src, skill).replace(os.sep, '/'))
    print(sz)
    # the same guide as one plain text file for chat AIs without skills (Copilot, ChatGPT...): the user attaches it
    if os.path.isdir(copilot):
        body = open(os.path.join(skill, 'SKILL.md'), encoding='utf-8').read()
        body = body[body.index('## Make it easy to edit'):]
        guide = open(os.path.join(copilot, 'intro.txt'), encoding='utf-8').read() + body
        cp = os.path.join(APP, 'Share', '3DJames guide for Copilot.txt')
        open(cp, 'w', encoding='utf-8', newline='\r\n').write(guide)
        print(cp)
print('shipped version', VERSION)
