"""The appliance's settings: users, storage places, the shared folder. Kept in <data>/config.json.

  places   where files can live: {id: {label, type: 'local' | 'smb' | 'nfs', ...}}
           local: path (a folder on the box)    smb: server, share, username, domain, vers    nfs: server, export
           (NAS passwords are not kept here: the root helper keeps them where only it can read them)
  users    {username: {name, hash, admin, folders: [{label, place, path, write}], shared: bool}}
  shared   {enabled, label, place, path, write}: one folder everybody with `shared` may use
"""
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import threading

DEFAULT = {
    'version': 1,
    'places': {'box': {'label': 'This box (SD card)', 'type': 'local', 'path': ''}},
    'users': {},
    'shared': {'enabled': False, 'label': 'Shared', 'place': 'box', 'path': 'shared', 'write': True},
    'settings': {'updateShare': False},
}
USERNAME = re.compile(r'^[a-z][a-z0-9._-]{0,31}$')


class Config:
    def __init__(self, data_dir, box_root):
        self.path = os.path.join(data_dir, 'config.json')
        self.box_root = box_root  # where "This box" keeps files
        self.lock = threading.RLock()
        self.data = copy.deepcopy(DEFAULT)
        if os.path.exists(self.path):
            with open(self.path, encoding='utf-8') as f:
                loaded = json.load(f)
            for k, v in DEFAULT.items():
                loaded.setdefault(k, copy.deepcopy(v))
            self.data = loaded
        self.data['places'].setdefault('box', copy.deepcopy(DEFAULT['places']['box']))

    def save(self):
        with self.lock:
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=1)
            os.replace(tmp, self.path)

    # ------------------------------------------------------------------ users
    def user(self, name):
        return self.data['users'].get(name)

    def has_admin(self):
        return any(u.get('admin') for u in self.data['users'].values())

    def check_password(self, name, password):
        u = self.user(name)
        if not u:
            hash_password(password)  # same time either way
            return False
        return verify_password(password, u.get('hash', ''))

    def folders_of(self, name):
        """The folders a user may use: [{id, label, place, path, write}] (id: f0, f1... and 'shared')."""
        u = self.user(name) or {}
        out = [dict(f, id=f'f{i}') for i, f in enumerate(u.get('folders', []))]
        s = self.data['shared']
        if s.get('enabled') and u.get('shared'):
            out.append({'id': 'shared', 'label': s.get('label') or 'Shared', 'place': s['place'], 'path': s.get('path', ''), 'write': bool(s.get('write', True))})
        return out

    def place_root(self, place_id):
        """The folder on this box where a place's files are (a NAS share is mounted there)."""
        p = self.data['places'].get(place_id)
        if not p:
            return None
        if p['type'] == 'local':
            return p.get('path') or self.box_root
        return os.path.join(MOUNT_ROOT, place_id)

    def public(self):
        """Everything for the admin page (no password hashes)."""
        d = copy.deepcopy(self.data)
        for u in d['users'].values():
            u.pop('hash', None)
        return d


MOUNT_ROOT = os.environ.get('TDJ_MOUNT_ROOT', '/mnt/3djames')


# ---------------------------------------------------------------------- passwords
def hash_password(password, salt=None, rounds=240000):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode(), rounds)
    return f'pbkdf2${rounds}${salt}${dk.hex()}'


def verify_password(password, stored):
    try:
        _, rounds, salt, want = stored.split('$')
        return hmac.compare_digest(hash_password(password, salt, int(rounds)).split('$')[3], want)
    except (ValueError, AttributeError):
        return False
