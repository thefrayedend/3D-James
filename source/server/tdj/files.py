"""Reading and writing people's files, never outside the folders they were given.

A folder is inside a storage place: this box (the SD card), a USB drive plugged into the box (mounted by the root
helper), or a NAS share (the server talks to the NAS itself: see smbstore.py)."""
import json
import os
import shutil
import tempfile
import threading
import time

from . import smbstore

BAD_CHARS = '<>:"|?*\\\x00'


class FileError(ValueError):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def etag_of(st):
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


def clean_parts(path):
    """A folder or file path as a list of names; refuses anything that could reach outside (.., hidden names...)."""
    parts = [p for p in str(path or '').replace('\\', '/').split('/') if p not in ('', '.')]
    if any(p == '..' or p.startswith('.') or any(c in p for c in BAD_CHARS) or p != p.strip() or p.endswith('.') for p in parts):
        raise FileError(400, 'That name is not allowed.')
    return parts


# ---------------------------------------------------------------------- where a folder's files are
class Item:
    def __init__(self, name, is_dir, size, mtime_ms, etag):
        self.name, self.is_dir, self.size, self.mtime_ms, self.etag = name, is_dir, size, mtime_ms, etag


class DiskPlace:
    """A folder on this box (the SD card, or a mounted USB drive)."""

    def __init__(self, root, label, mounted=False):
        self.root, self.label, self.mounted = root, label, mounted

    def base(self, parts):
        if self.mounted and not os.path.ismount(self.root):
            raise FileError(503, f'The USB drive for "{self.label}" is not plugged in (or not ready). Plug it into the box and try again in a few seconds.')
        base = os.path.realpath(os.path.join(self.root, *parts))
        if self.mounted:
            os.makedirs(base, exist_ok=True)
        return base

    def path(self, base_parts, parts):
        base = self.base(base_parts)
        if not self.mounted:
            os.makedirs(base, exist_ok=True)
        full = os.path.realpath(os.path.join(base, *parts))
        if full != base and not full.startswith(base + os.sep):
            raise FileError(400, 'That place is outside your folder.')
        return full

    def list(self, b, parts):
        d = self.path(b, parts)
        if not os.path.isdir(d):
            raise FileError(404, 'That folder does not exist (any more).')
        out = []
        with os.scandir(d) as it:
            for e in it:
                if e.name.startswith('.'):
                    continue
                try:
                    st = e.stat()
                except OSError:
                    continue
                out.append(Item(e.name, e.is_dir(), st.st_size, int(st.st_mtime * 1000), None))
        return out

    def stat(self, b, parts):
        p = self.path(b, parts)
        if not os.path.isfile(p):
            return None
        st = os.stat(p)
        return Item(parts[-1], False, st.st_size, int(st.st_mtime * 1000), etag_of(st))

    def is_dir(self, b, parts):
        return os.path.isdir(self.path(b, parts))

    def open(self, b, parts):
        """(local file, remove it after sending?)"""
        return self.path(b, parts), False

    def write(self, b, parts, source):
        p = self.path(b, parts)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        # a copy in the same folder first, then swapped in, so a cut connection never leaves half a file
        fd, tmp = tempfile.mkstemp(prefix='.saving-', dir=os.path.dirname(p))
        try:
            with os.fdopen(fd, 'wb') as out, open(source, 'rb') as src:
                shutil.copyfileobj(src, out, 1 << 20)
                out.flush()
                if self.mounted:
                    os.fsync(out.fileno())  # a USB drive may be pulled out any time
            os.replace(tmp, p)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
        return self.stat(b, parts)

    def mkdir(self, b, parts):
        os.makedirs(self.path(b, parts), exist_ok=True)

    def delete(self, b, parts):
        p = self.path(b, parts)
        if not os.path.isfile(p):
            raise FileError(404, 'That file does not exist.')
        os.remove(p)

    def key(self, b, parts):
        return self.path(b, parts)


class NasPlace:
    """A folder on a NAS share."""

    def __init__(self, pid, share, label):
        self.pid, self.share, self.label = pid, share, label

    def run(self, fn):
        try:
            return fn()
        except smbstore.SmbError as e:
            raise FileError(503, f'"{self.label}" (the NAS): {e}')

    def list(self, b, parts):
        try:
            got = self.run(lambda: self.share.listdir(b + parts))
        except smbstore.Missing:
            if parts:
                raise FileError(404, 'That folder does not exist (any more).')
            self.run(lambda: self.share.makedirs(b))
            got = []
        return [Item(e.name, e.is_dir, e.size, int(e.mtime * 1000), None) for e in got if not e.name.startswith('.')]

    def stat(self, b, parts):
        try:
            e = self.run(lambda: self.share.stat(b + parts))
        except smbstore.Missing:
            return None
        return None if e.is_dir else Item(e.name, False, e.size, int(e.mtime * 1000), e.etag())

    def is_dir(self, b, parts):
        try:
            return self.run(lambda: self.share.stat(b + parts)).is_dir
        except smbstore.Missing:
            return False

    def open(self, b, parts):
        try:
            return self.run(lambda: self.share.read_to_temp(b + parts)), True
        except smbstore.Missing:
            raise FileError(404, 'That file does not exist (any more).')

    def write(self, b, parts, source):
        self.run(lambda: self.share.makedirs(b + parts[:-1]))
        e = self.run(lambda: self.share.write_from(b + parts, source))
        return Item(e.name, False, e.size, int(e.mtime * 1000), e.etag())

    def mkdir(self, b, parts):
        self.run(lambda: self.share.makedirs(b + parts))

    def delete(self, b, parts):
        if not self.stat(b, parts):
            raise FileError(404, 'That file does not exist.')
        self.run(lambda: self.share.remove(b + parts))

    def key(self, b, parts):
        return f'smb://{self.pid}/' + '/'.join(p.lower() for p in b + parts)  # NAS names ignore upper/lower case


# ---------------------------------------------------------------------- people's folders
class Files:
    def __init__(self, config, data_dir):
        self.config = config
        self.writers_path = os.path.join(data_dir, 'writers.json')
        self.lock = threading.Lock()
        self.shares = {}  # place id -> (settings it was made with, SmbShare)
        self.shares_lock = threading.Lock()
        try:
            with open(self.writers_path, encoding='utf-8') as f:
                self.writers = json.load(f)
        except (OSError, ValueError):
            self.writers = {}

    # ------------------------------------------------------------------ storage places
    def share_of(self, pid):
        """The NAS connection of a place (made when first needed; made again when its settings changed)."""
        p = self.config.data['places'].get(pid) or {}
        want = (p.get('server'), p.get('share'), p.get('username', ''), self.config.secret(pid), p.get('domain', ''))
        with self.shares_lock:
            had = self.shares.get(pid)
            if had and had[0] == want:
                return had[1]
            if had:
                had[1].close()
            s = smbstore.SmbShare(*want)
            self.shares[pid] = (want, s)
            return s

    def drop_share(self, pid):
        with self.shares_lock:
            had = self.shares.pop(pid, None)
        if had:
            had[1].close()

    def place(self, pid):
        p = self.config.data['places'].get(pid)
        if not p:
            raise FileError(404, 'That storage place no longer exists. Ask the admin.')
        if p['type'] == 'smb':
            return NasPlace(pid, self.share_of(pid), p['label'])
        return DiskPlace(self.config.place_root(pid), p['label'], mounted=p['type'] != 'local')

    def make_folder(self, pid, path):
        """Make a folder in a storage place (for a new user), if the place can be reached now."""
        try:
            pl = self.place(pid)
            pl.mkdir(clean_parts(path), [])
        except (FileError, OSError):
            pass

    def place_status(self, pid):
        """(connected, free space or None, message) for the admin page."""
        p = self.config.data['places'][pid]
        if p['type'] == 'smb':
            s = self.share_of(pid)
            if time.time() - s.last_ok > 20:
                try:
                    s.check()
                except smbstore.SmbError as e:
                    return False, None, str(e)
            return True, None, ''
        root = self.config.place_root(pid)
        ok = os.path.isdir(root) if p['type'] == 'local' else os.path.ismount(root)
        return ok, free_space(root) if ok else None, '' if ok else 'Not plugged in.'

    # ------------------------------------------------------------------ a person's folders
    def folder(self, user, folder_id):
        f = next((x for x in self.config.folders_of(user) if x['id'] == folder_id), None)
        if not f:
            raise FileError(404, 'That folder is not yours to use.')
        return f

    def target(self, user, folder_id, sub='', write=False):
        """(storage place, the folder's path inside it, the path inside the folder), after checking the user may use
        it (and may write, if asked)."""
        f = self.folder(user, folder_id)
        if write and not f.get('write'):
            raise FileError(403, f'"{f["label"]}" is read-only for you.')
        return self.place(f['place']), clean_parts(f.get('path', '')), clean_parts(sub)

    def list(self, user, folder_id, sub):
        pl, b, parts = self.target(user, folder_id, sub)
        return [{'name': e.name, 'dir': e.is_dir, 'size': e.size, 'mtime': e.mtime_ms} for e in pl.list(b, parts)]

    def stat(self, user, folder_id, sub):
        """(storage place, folder path, path, Item) of an existing file."""
        pl, b, parts = self.target(user, folder_id, sub)
        it = pl.stat(b, parts) if parts else None
        if not it:
            raise FileError(404, 'That file does not exist (any more).')
        return pl, b, parts, it

    def open(self, user, folder_id, sub):
        """(local file to send, remove it after sending?, Item)."""
        pl, b, parts, it = self.stat(user, folder_id, sub)
        path, temp = pl.open(b, parts)
        return path, temp, it

    def write(self, user, folder_id, sub, source, if_match, display_name):
        """Put the file (from a temporary file) in place. if_match: 'new' (must not exist yet), 'any', or an ETag
        (must still be the version the user opened: otherwise someone else saved it meanwhile)."""
        pl, b, parts = self.target(user, folder_id, sub, write=True)
        if not parts:
            raise FileError(400, 'That name is not allowed.')
        if pl.is_dir(b, parts):
            raise FileError(400, 'There is a folder with that name.')
        key = pl.key(b, parts)
        with self.lock:
            cur = pl.stat(b, parts)
            if cur and if_match != 'any' and (if_match == 'new' or cur.etag != if_match):
                raise FileError(409, 'Someone else saved this file since you opened it.', error='conflict',
                                by=self.writers.get(key, ''), mtime=cur.mtime_ms)
            # (not there any more although it was opened: deleted meanwhile, saving it again is fine)
            it = pl.write(b, parts, source)
            self.writers[key] = display_name
            if len(self.writers) > 5000:
                self.writers = dict(list(self.writers.items())[-4000:])
            try:
                with open(self.writers_path, 'w', encoding='utf-8') as f:
                    json.dump(self.writers, f)
            except OSError:
                pass
        return it.etag

    def mkdir(self, user, folder_id, sub):
        pl, b, parts = self.target(user, folder_id, sub, write=True)
        pl.mkdir(b, parts)

    def delete(self, user, folder_id, sub):
        pl, b, parts = self.target(user, folder_id, sub, write=True)
        if not parts:
            raise FileError(404, 'That file does not exist.')
        pl.delete(b, parts)

    def key(self, user, folder_id, sub):
        """Same file = same key, whoever opens it (for "someone else has it open")."""
        try:
            pl, b, parts = self.target(user, folder_id, sub)
            return pl.key(b, parts)
        except (FileError, OSError):
            return None


def free_space(path):
    try:
        u = shutil.disk_usage(path)
        return {'free': u.free, 'total': u.total}
    except OSError:
        return None


def now_ms():
    return int(time.time() * 1000)
