# Puts the 3DJames box (server + SD card image builder) into its git repository, ready to push to GitHub,
# where the "Build SD card image" action makes the image.   python tools/publish_appliance.py [--push]
#   source/server        -> <repo>/server
#   source/appliance     -> <repo>/appliance (build-image.sh, customize.sh, rootfs, setup-partition)
#   appliance/github/... -> <repo>/.github/workflows/build-image.yml
#   README, release notes, license
# The repository folder is ../appliance-repo (next to source). The 3DJames app (3DJames.html) is NOT in it:
# the admin uploads it on the box's admin page.
import os, shutil, subprocess, sys

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(os.path.dirname(SRC), 'appliance-repo')
REMOTE = 'https://github.com/thefrayedend/3djames-pi.git'


def copytree(a, b):
    shutil.rmtree(b, ignore_errors=True)
    shutil.copytree(a, b, ignore=shutil.ignore_patterns('__pycache__', 'testdata', '*.pyc', 'github'))


def git(*args, check=True):
    return subprocess.run(['git', '-C', REPO, *args], check=check, capture_output=True, text=True)


os.makedirs(REPO, exist_ok=True)
if not os.path.isdir(os.path.join(REPO, '.git')):
    subprocess.run(['git', 'init', '-b', 'main', REPO], check=True, capture_output=True)
    git('remote', 'add', 'origin', REMOTE)
copytree(os.path.join(SRC, 'server'), os.path.join(REPO, 'server'))
copytree(os.path.join(SRC, 'appliance'), os.path.join(REPO, 'appliance'))
for f in ('README.md', 'RELEASE-NOTES.md'):
    shutil.move(os.path.join(REPO, 'appliance', f), os.path.join(REPO, f))
os.makedirs(os.path.join(REPO, '.github', 'workflows'), exist_ok=True)
shutil.copyfile(os.path.join(SRC, 'appliance', 'github', 'build-image.yml'), os.path.join(REPO, '.github', 'workflows', 'build-image.yml'))
shutil.copyfile(os.path.join(SRC, 'COPYING'), os.path.join(REPO, 'LICENSE'))
with open(os.path.join(REPO, '.gitattributes'), 'w', newline='\n') as f:
    f.write('* text=auto eol=lf\n*.txt text eol=crlf\n')
with open(os.path.join(REPO, '.gitignore'), 'w', newline='\n') as f:
    f.write('__pycache__/\ntestdata/\nout/\n')
git('add', '-A')
if git('diff', '--cached', '--quiet', check=False).returncode:
    v = open(os.path.join(SRC, 'server', 'VERSION')).read().strip()
    git('-c', 'user.name=thefrayedend', '-c', 'user.email=78568423+thefrayedend@users.noreply.github.com', 'commit', '-m', f'3DJames box: server {v}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
    print('committed', git('log', '--oneline', '-1').stdout.strip())
else:
    print('nothing changed')
if '--push' in sys.argv:
    r = git('push', '-u', 'origin', 'main', check=False)
    print(r.stdout + r.stderr)
print(REPO)
