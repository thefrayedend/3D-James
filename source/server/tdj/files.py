"""Reading and writing people's files, never outside the folders they were given."""
import json
import os
import shutil
import tempfile
import threading
import time


class FileError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def etag_of(st):
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


class Files:
    def __init__(self, config, data_dir):
        self.config = config
        self.writers_path = os.path.join(data_dir, 'writers.json')
        self.lock = threading.Lock()
        try:
            with open(self.writers_path, encoding='utf-8') as f:
                self.writers = json.load(f)
        except (OSError, ValueError):
            self.writers = {}

    def folder(self, user, folder_id):
        f = next((x for x in self.config.folders_of(user) if x['id'] == folder_id), None)
        if not f:
            raise FileError(404, 'That folder is not yours to use.')
        return f

    def resolve(self, user, folder_id, sub='', write=False):
        """The real path of folder/sub, after checking the user may use it (and may write, if asked)."""
        f = self.folder(user, folder_id)
        if write and not f.get('write'):
            raise FileError(403, f'"{f["label"]}" is read-only for you.')
        root = self.config.place_root(f['place'])
        if not root:
            raise FileError(404, 'That storage place no longer exists. Ask the admin.')
        if self.config.data['places'][f['place']]['type'] != 'local' and not os.path.ismount(root):
            raise FileError(503, f'The storage for "{f["label"]}" (a network share) is not connected right now. Ask the admin.')
        base = os.path.realpath(os.path.join(root, f.get('path', '').strip('/\\')))
        os.makedirs(base, exist_ok=True)
        parts = [p for p in str(sub).replace('\\', '/').split('/') if p not in ('', '.')]
        if any(p == '..' or p.startswith('.') or any(c in p for c in '<>:"|?*\x00') for p in parts):
            raise FileError(400, 'That name is not allowed.')
        full = os.path.realpath(os.path.join(base, *parts))
        if full != base and not full.startswith(base + os.sep):
            raise FileError(400, 'That place is outside your folder.')
        return full

    def list(self, user, folder_id, sub):
        d = self.resolve(user, folder_id, sub)
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
                out.append({'name': e.name, 'dir': e.is_dir(), 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)})
        return out

    def stat(self, user, folder_id, sub):
        p = self.resolve(user, folder_id, sub)
        if not os.path.isfile(p):
            raise FileError(404, 'That file does not exist (any more).')
        return p, os.stat(p)

    def write(self, user, folder_id, sub, source, if_match, display_name):
        """Put the file (from a temporary file) in place. if_match: 'new' (must not exist yet), 'any', or an ETag
        (must still be the version the user opened: otherwise someone else saved it meanwhile)."""
        p = self.resolve(user, folder_id, sub, write=True)
        if os.path.isdir(p):
            raise FileError(400, 'There is a folder with that name.')
        with self.lock:
            exists = os.path.isfile(p)
            if exists and if_match != 'any' and (if_match == 'new' or etag_of(os.stat(p)) != if_match):
                st = os.stat(p)
                raise FileError(409, 'Someone else saved this file since you opened it.', error='conflict',
                                by=self.writers.get(p, ''), mtime=int(st.st_mtime * 1000))
            if not exists and if_match not in ('new', 'any'):
                pass  # it was deleted meanwhile: saving it again is fine
            os.makedirs(os.path.dirname(p), exist_ok=True)
            # a copy in the same folder first, then swapped in, so a cut connection never leaves half a file
            fd, tmp = tempfile.mkstemp(prefix='.saving-', dir=os.path.dirname(p))
            os.close(fd)
            try:
                shutil.copyfile(source, tmp)
                os.replace(tmp, p)
            except BaseException:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            self.writers[p] = display_name
            if len(self.writers) > 5000:
                self.writers = dict(list(self.writers.items())[-4000:])
            try:
                with open(self.writers_path, 'w', encoding='utf-8') as f:
                    json.dump(self.writers, f)
            except OSError:
                pass
        return etag_of(os.stat(p))

    def mkdir(self, user, folder_id, sub):
        os.makedirs(self.resolve(user, folder_id, sub, write=True), exist_ok=True)

    def delete(self, user, folder_id, sub):
        p = self.resolve(user, folder_id, sub, write=True)
        if not os.path.isfile(p):
            raise FileError(404, 'That file does not exist.')
        os.remove(p)

    def key(self, user, folder_id, sub):
        """Same file = same key, whoever opens it (for "someone else has it open")."""
        try:
            return self.resolve(user, folder_id, sub)
        except FileError:
            return None


def free_space(path):
    try:
        u = shutil.disk_usage(path)
        return {'free': u.free, 'total': u.total}
    except OSError:
        return None


def now_ms():
    return int(time.time() * 1000)
