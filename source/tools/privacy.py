# Personal details must never go out (in a release, the installer, GitHub or the 3DJames box). They are read from this
# PC each time, so no list of them is kept anywhere: the Windows user name, the computer's name, the account's full
# name, and the Microsoft accounts signed in on it. Anything that looks like someone's own folder, a PC's own name, an
# address in a home network or a personal email address is stopped too.
#   python tools/privacy.py file-or-folder ...      (prints what it finds; exit 1 when something turns up)
# Used by tools/ship.py, tools/publish_appliance.py and windows-desktop/link/build_link.py.
import os, re, subprocess, sys


def words():
    """This PC's own names: user name, computer name, full name (and each part) and Microsoft account emails (and the
    name before the @ when it has digits)."""
    found = [os.environ.get('USERNAME', ''), os.environ.get('COMPUTERNAME', '')]
    try:
        full = subprocess.run(['powershell', '-NoProfile', '-Command', '(Get-LocalUser -Name $env:USERNAME).FullName'],
                              capture_output=True, text=True, timeout=60).stdout.strip()
        found += [full, *full.split()]
    except Exception:
        pass
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\IdentityCRL\UserExtendedProperties') as key:
            for i in range(100):
                try:
                    email = winreg.EnumKey(key, i)
                except OSError:
                    break
                name = email.split('@')[0]
                # (the name before the @ on its own only when it has digits: a plain word could be anything)
                found += [email] + ([name] if any(ch.isdigit() for ch in name) else [])
    except Exception:
        pass
    return sorted({w for w in found if len(w) >= 3})


# the made-up examples the app and Help use (the box's NAS page: "Like 192.168.1.20", \\192.168.1.50\Alex), the box's
# own Wi-Fi setup address, and the author of a library the box uses (in its license)
EXAMPLES = {'192.168.1.20', '192.168.1.50', '10.42.0.1', 'etingof@gmail.com'}
PATTERNS = [
    ("someone's own folder", re.compile(r'[A-Za-z]:\\{1,2}Users\\{1,2}(?!(Public|you|name)\b)[^\\"\'<>\s]+', re.I)),
    ("a PC's own name", re.compile(r'\b(DESKTOP|LAPTOP)-[A-Z0-9]{7}\b')),
    ('an address in a home network', re.compile(r'(?<![\d.])(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])')),
    ('a personal email address', re.compile(r'[\w.+-]+@(gmail|googlemail|yahoo|hotmail|outlook|live|msn|icloud|me|aol|gmx|proton(mail)?)\.\w+', re.I)),
]
BASE64 = re.compile(r'[A-Za-z0-9+/=]{200,}')  # embedded pictures and fonts: random letters (pictures are checked by eye)


def find(text, names=None):
    """What in this text is personal: a list of (what, the text around it)."""
    names = words() if names is None else names
    text = BASE64.sub(' ', text)
    out = []
    for w in names:
        m = re.search(r'(?<![A-Za-z0-9])' + re.escape(w) + r'(?![A-Za-z0-9])', text, re.I)
        if m:
            out.append((f'"{m.group(0)}"', text[max(0, m.start() - 40):m.end() + 40]))
    for what, rx in PATTERNS:
        for m in rx.finditer(text):
            if m.group(0) not in EXAMPLES:
                out.append((f'{what} "{m.group(0)}"', text[max(0, m.start() - 40):m.end() + 40]))
                break
    return [(w, ' '.join(re.sub(r'[^\x20-\x7e]', ' ', a).split())) for w, a in out]


def check(paths, names=None, skip=('.jpg', '.png', '.ico', '.woff2', '.ttf', '.wasm', '.3dj', '.zip', '.stl', '.pyc')):
    """Every file under these paths: a list of 'file: what ... around ...'. (Pictures are checked by eye; zipped and
    compiled files hold random letters, so the files they are made from are checked instead.)"""
    names = words() if names is None else names
    hits = []
    for top in paths:
        files = [top] if os.path.isfile(top) else [os.path.join(b, f) for b, d, fs in os.walk(top) for f in fs if '.git' not in b.split(os.sep)]
        for p in files:
            if p.lower().endswith(skip):
                continue
            data = open(p, 'rb').read()
            for text in (data.decode('latin-1'), data.decode('utf-16-le', errors='ignore')):
                for what, around in find(text, names):
                    hits.append(f'{p}: {what}   ...{around}...')
    return sorted(set(hits))


if __name__ == '__main__':
    hits = check(sys.argv[1:])
    print('\n'.join(hits) if hits else 'nothing personal found')
    sys.exit(1 if hits else 0)
