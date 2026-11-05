# Puts a fresh build where it is used. Run after build.py:  python tools/ship.py
#   1. local/3DJames.html is copied to the 3DJames folder (..\3DJames.html, the one you open) and to ..\single
#      and ..\update.json (version, size, SHA-256) is written for the installed program's update check
#   2. the version number in ..\README.txt is brought up to date, and ..\icons\originals is remade
#   3. ..\Share\3djames-project-skill.zip: the Claude skill (source\skill) that writes .3dj projects, and
#      ..\Share\3DJames guide for Copilot.txt: the same guide for chat AIs without skills
#   4. the AI link (windows-desktop\link): 3DJamesLink.exe, and the files that tell Gemini and Claude about it
# The 3DJames folder (the one above source) is the master copy of everything that ships; nothing is kept twice.
import os, re, shutil, subprocess, sys, zipfile
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.dirname(SRC)  # the 3DJames folder
os.chdir(SRC)
sys.path.insert(0, os.path.join(SRC, 'tools'))
import privacy
VERSION = open('VERSION', encoding='utf-8').read().strip()
built = os.path.join(SRC, 'local', '3DJames.html')
if not os.path.exists(built): raise SystemExit('Build first: python build.py')
# nothing personal goes out (tools/privacy.py; the Help pictures are looked at by eye)
if (found := privacy.check([built])): raise SystemExit('NOT shipped, personal details in the app:\n' + '\n'.join(found))

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

# 1b. update.json: what the installed program looks for on GitHub at start-up (Installation/build/App.cs). It names the version,
#     the size and the SHA-256 of 3DJames.html, which sits next to it in the GitHub project; the program downloads the page only
#     when the version is newer than its own, and keeps it only when size and checksum match
import hashlib, json
page = open(built, 'rb').read()
with open(os.path.join(APP, 'update.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump({'version': VERSION, 'sha256': hashlib.sha256(page).hexdigest(), 'size': len(page)}, f, indent=2); f.write('\n')
print('update.json: version', VERSION)

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
link_failed = None
def put_program(src, dest):
    """Copy a program, also over one that is running (an AI's link): Windows lets a running program be renamed out
    of the way (to .old.exe), not written over."""
    try: shutil.copyfile(src, dest)
    except PermissionError:
        old = dest[:-4] + '.old.exe'
        if os.path.exists(old): os.remove(old)
        os.replace(dest, old); shutil.copyfile(src, dest)
        print(dest, 'was running: the old one is now', os.path.basename(old))
try:
    subprocess.run([shutil.which('python') or 'python', os.path.join('windows-desktop', 'link', 'build_link.py')], check=True)
    put_program(os.path.join(SRC, 'local', '3DJamesLink.exe'), os.path.join(APP, '3DJamesLink.exe'))
    for f, dest in LINK_FILES.items():
        os.makedirs(os.path.dirname(os.path.join(APP, dest)), exist_ok=True)
        shutil.copyfile(os.path.join(SRC, 'windows-desktop', 'link', 'ai', f), os.path.join(APP, dest))
    print('AI link copied to', APP)
except (OSError, subprocess.CalledProcessError) as e:
    link_failed = e
    print('AI link NOT updated:', e)

# (no share zip any more: 3DJames is shared as the installer, Installation\Make 3DJames Installer.cmd)

# 3. the Claude skill that writes 3DJames projects (upload it at claude.ai > Settings > Capabilities > Skills)
skill = os.path.join(SRC, 'skill', '3djames-project')
# nothing personal may go in it, in any file of the skill (tools/privacy.py: read from this PC, no list kept)
copilot = os.path.join(SRC, 'skill', 'copilot')
found = privacy.check([d for d in (skill, copilot) if os.path.isdir(d)])
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
# (a release must not go out with an old AI link: the installer takes it from the 3DJames folder)
if link_failed: sys.exit(f'BUT the AI link was NOT updated ({link_failed}): fix that before making the installer.')
