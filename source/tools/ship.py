# Puts a fresh build where it is used, and makes the file to share. Run after build.py:  python tools/ship.py
#   1. local/3DJames.html is copied to the 3DJames folder (..\3DJames.html, the one you open) and to ..\single
#   2. the version number in ..\README.txt is brought up to date, and ..\icons\originals is remade
#   3. ..\Share\3DJames.zip: one "3DJames" folder with the app, start-up files, icons, licenses and README
#   4. ..\Share\3djames-project-skill.zip: the Claude skill (source\skill) that writes .3dj projects
# The 3DJames folder (the one above source) is the master copy of everything that ships; nothing is kept twice.
import os, re, shutil, subprocess, zipfile
SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.dirname(SRC)  # the 3DJames folder
os.chdir(SRC)
VERSION = open('VERSION', encoding='utf-8').read().strip()
built = os.path.join(SRC, 'local', '3DJames.html')
if not os.path.exists(built): raise SystemExit('Build first: python build.py')

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

# 3. the share zip
SHIP = ['3DJames.html', 'LICENSE.txt', 'README.txt', 'Open 3DJames.cmd', 'Make desktop shortcut.cmd']
SHIP_DIRS = ['licenses', 'icons', 'icon']
os.makedirs(os.path.join(APP, 'Share'), exist_ok=True)
out = os.path.join(APP, 'Share', '3DJames.zip')
z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
for f in SHIP:
    if os.path.exists(os.path.join(APP, f)): z.write(os.path.join(APP, f), '3DJames/' + f)
for d in SHIP_DIRS:
    for base, _, files in os.walk(os.path.join(APP, d)):
        for f in sorted(files):
            src = os.path.join(base, f)
            z.write(src, '3DJames/' + os.path.relpath(src, APP).replace(os.sep, '/'))
z.writestr(zipfile.ZipInfo('3DJames/Projects/'), '')
z.close()
print(out, os.path.getsize(out), 'bytes, version', VERSION, len(zipfile.ZipFile(out).namelist()), 'files')

# 4. the Claude skill that writes 3DJames projects (upload it at claude.ai > Settings > Capabilities > Skills)
skill = os.path.join(SRC, 'skill', '3djames-project')
if os.path.isdir(skill):
    sz = os.path.join(APP, 'Share', '3djames-project-skill.zip')
    with zipfile.ZipFile(sz, 'w', zipfile.ZIP_DEFLATED) as z2:
        for base, _, files in os.walk(skill):
            for f in sorted(files):
                src = os.path.join(base, f); z2.write(src, '3djames-project/' + os.path.relpath(src, skill).replace(os.sep, '/'))
    print(sz)
