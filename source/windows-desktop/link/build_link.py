"""Build 3DJamesLink.exe (the AI link, an MCP server) with the .NET Framework C# compiler that comes with Windows.

  python windows-desktop/link/build_link.py [--out local/3DJamesLink.exe]

The step guide it hands to the AI is skill/3djames-project/SKILL.md, built into the program.
"""
import argparse
import re
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.abspath(os.path.join(HERE, '..', '..'))
CSC = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(SOURCE, 'local', '3DJamesLink.exe'))
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    # the step guide built in: the skill from its modelling part on (it names no one and no folders: the link is shared)
    skill = open(os.path.join(SOURCE, 'skill', '3djames-project', 'SKILL.md'), encoding='utf-8').read()
    skill = skill[skill.index('## Make it easy to edit'):]
    if re.search(r'thefr|\bJon\b|C:\\Users', skill):
        sys.exit('SKILL.md still names a person or a folder')
    guide = os.path.join(SOURCE, 'local', 'link-guide.md')
    open(guide, 'w', encoding='utf-8').write(skill)
    icon = os.path.join(SOURCE, '..', 'Installation', '3DJames.ico')
    cmd = [CSC, '/nologo', '/target:exe', '/optimize+', '/platform:anycpu', f'/out:{a.out}',
           '/r:System.Web.Extensions.dll',
           f'/resource:{os.path.join(HERE, "tools.json")},tools.json',
           f'/resource:{guide},SKILL.md',
           f'/resource:{os.path.join(HERE, "ai", "GEMINI.md")},GEMINI.md',
           *([f'/win32icon:{icon}'] if os.path.exists(icon) else []),
           os.path.join(HERE, 'Link.cs'), os.path.join(HERE, 'Tools.cs')]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout.strip() or f'built {a.out}')
    if r.returncode:
        print(r.stderr, file=sys.stderr)
        sys.exit(r.returncode)


if __name__ == '__main__':
    main()
