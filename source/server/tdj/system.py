"""Things only root may do (connect a NAS share, Wi-Fi, the box's name, restart...), done by the root helper
`3djames-helper` through sudo. On a test computer (no helper) they answer "not available here"."""
import gzip
import json
import os
import re
import shutil
import subprocess
import time

HELPER = '/usr/local/sbin/3djames-helper'


def helper_available():
    return os.path.exists(HELPER) and os.name == 'posix'


def helper(*args, stdin=None, timeout=120):
    if not helper_available():
        return {'ok': False, 'message': 'Not available on this computer (only on the 3DJames box).'}
    try:
        r = subprocess.run(['sudo', '-n', HELPER, *args], input=stdin, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {'ok': False, 'message': str(e)}
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {'ok': r.returncode == 0, 'message': (r.stderr or r.stdout).strip()[-400:]}


# ---------------------------------------------------------------------- the app file (3DJames.html)
VERSION_RE = re.compile(rb'window\.__3DJ_VERSION\s*=\s*"([^"]{1,40})"')


def app_version(path):
    """The version written inside a 3DJames.html, or None if it isn't one."""
    try:
        with open(path, 'rb') as f:
            head = f.read(4 << 20)
            f.seek(max(0, os.path.getsize(path) - (40 << 20)))
            rest = f.read()
    except OSError:
        return None
    m = VERSION_RE.search(head) or VERSION_RE.search(rest)
    if not m or b'__3DJ_EMBED' not in head + rest:
        return None
    return m.group(1).decode('utf-8', 'replace')


class AppFiles:
    """data/app/3DJames.html (+ .gz for fast sending), and the one before it for "go back"."""
    def __init__(self, data_dir, bundled=None):
        self.dir = os.path.join(data_dir, 'app')
        os.makedirs(self.dir, exist_ok=True)
        self.current = os.path.join(self.dir, '3DJames.html')
        self.previous = os.path.join(self.dir, '3DJames.previous.html')
        if not os.path.exists(self.current) and bundled and os.path.exists(bundled):
            self.install(bundled, keep_previous=False)
        self.ensure_gz()

    def ensure_gz(self):
        gz = self.current + '.gz'
        if os.path.exists(self.current) and (not os.path.exists(gz) or os.path.getmtime(gz) < os.path.getmtime(self.current)):
            tmp = gz + '.tmp'
            with open(self.current, 'rb') as s, gzip.open(tmp, 'wb', compresslevel=6) as d:
                shutil.copyfileobj(s, d, 1 << 20)
            os.replace(tmp, gz)

    def info(self, path=None):
        path = path or self.current
        if not os.path.exists(path):
            return None
        st = os.stat(path)
        return {'version': app_version(path), 'size': st.st_size, 'installed': int(st.st_mtime * 1000)}

    def install(self, source, keep_previous=True):
        v = app_version(source)
        if not v:
            raise ValueError('That is not a 3DJames app file (3DJames.html).')
        if keep_previous and os.path.exists(self.current):
            shutil.copyfile(self.current, self.previous)
        tmp = self.current + '.new'
        shutil.copyfile(source, tmp)
        os.replace(tmp, self.current)
        os.utime(self.current, (time.time(), time.time()))
        self.ensure_gz()
        return v

    def roll_back(self):
        if not os.path.exists(self.previous):
            raise ValueError('There is no earlier version to go back to.')
        cur = self.current + '.swap'
        shutil.copyfile(self.current, cur)
        shutil.copyfile(self.previous, self.current)
        os.replace(cur, self.previous)
        os.utime(self.current, (time.time(), time.time()))
        self.ensure_gz()
        return app_version(self.current)
