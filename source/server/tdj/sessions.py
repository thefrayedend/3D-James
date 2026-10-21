"""Who is signed in: a random token in a cookie, remembered in <data>/sessions.json so a restart doesn't sign
everybody out. Also slows down password guessing, and tracks who has which file open."""
import json
import os
import secrets
import threading
import time

DAY = 86400


class Sessions:
    def __init__(self, data_dir, days=30):
        self.path = os.path.join(data_dir, 'sessions.json')
        self.days = days
        self.lock = threading.Lock()
        self.tokens = {}
        try:
            with open(self.path, encoding='utf-8') as f:
                self.tokens = {k: v for k, v in json.load(f).items() if v.get('exp', 0) > time.time()}
        except (OSError, ValueError):
            pass
        self.fails = {}  # ip -> [count, last time]

    def _save(self):
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.tokens, f)
        os.replace(tmp, self.path)

    def create(self, user, kind='app'):
        tok = secrets.token_urlsafe(32)
        with self.lock:
            self.tokens[tok] = {'user': user, 'kind': kind, 'exp': time.time() + self.days * DAY}
            self._save()
        return tok

    def get(self, tok, kind='app'):
        s = self.tokens.get(tok or '')
        if not s or s['kind'] != kind or s['exp'] < time.time():
            return None
        if s['exp'] - time.time() < (self.days - 1) * DAY:  # used: keep it alive (saved at most once a day)
            with self.lock:
                s['exp'] = time.time() + self.days * DAY
                self._save()
        return s['user']

    def drop(self, tok=None, user=None):
        with self.lock:
            for k in [k for k, v in self.tokens.items() if k == tok or (user and v['user'] == user)]:
                del self.tokens[k]
            self._save()

    # -------------------------------------------------------------- slowing down password guessing
    def wait_for(self, ip):
        n, last = self.fails.get(ip, (0, 0))
        if n < 3:  # a few typos are free; after that 2, 4, 8... up to 30 seconds between tries
            return 0
        return max(0, min(30, 2 ** (n - 2)) - (time.time() - last))

    def failed(self, ip):
        n, _ = self.fails.get(ip, (0, 0))
        self.fails[ip] = (n + 1, time.time())

    def succeeded(self, ip):
        self.fails.pop(ip, None)


class Presence:
    """Who has which file open (the app tells us every 45 s). Forgotten after 2 minutes."""
    def __init__(self):
        self.lock = threading.Lock()
        self.open = {}  # user -> (file key, time)

    def set(self, user, key):
        now = time.time()
        with self.lock:
            if key:
                self.open[user] = (key, now)
            else:
                self.open.pop(user, None)
            return sorted(u for u, (k, t) in self.open.items() if u != user and k == key and now - t < 120)
