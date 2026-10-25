"""The appliance's settings: users, storage places, the shared folder. Kept in <data>/config.json.

  places   where files can live: {id: {label, type: 'local' | 'usb' | 'smb', ...}}
           local: path (a folder on the box; '' = the SD card)
           usb: uuid, fstype, name (a USB drive plugged into the box: the root helper mounts it at MOUNT_ROOT/<id>)
           smb: server, share, username, domain (a NAS share: the server talks to it itself, see smbstore.py)
           (NAS passwords are not kept here but in <data>/secrets.json, which only the server can read)
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
        self.secrets_path = os.path.join(data_dir, 'secrets.json')
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

    # ------------------------------------------------------------------ NAS passwords
    def secrets(self):
        try:
            with open(self.secrets_path, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def secret(self, place_id):
        return self.secrets().get(place_id, '')

    def set_secret(self, place_id, password):
        with self.lock:
            d = self.secrets()
            if password is None:
                d.pop(place_id, None)
            else:
                d[place_id] = password
            tmp = self.secrets_path + '.tmp'
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(d, f)
            os.replace(tmp, self.secrets_path)

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
        """The folder on this box where a place's files are (a USB drive is mounted there; None for a NAS share)."""
        p = self.data['places'].get(place_id)
        if not p:
            return None
        if p['type'] == 'local':
            return p.get('path') or self.box_root
        if p['type'] == 'smb':
            return None
        return os.path.join(MOUNT_ROOT, place_id)

    def public(self):
        """Everything for the admin page (no password hashes; NAS passwords are not in here at all)."""
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
