"""Talking to a NAS share (SMB, "Windows file sharing") from the server itself, with the pysmb library it carries
(server/vendor). No kernel driver, no mounting: works on any board and on any computer the server runs on.

One connection per NAS share, used by one request at a time; when the NAS or the network was away, the next request
connects again by itself."""
import os
import socket
import sys
import tempfile
import threading
import time
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vendor'))
from smb.base import NotConnectedError, NotReadyError, OperationFailure, SMBTimeout  # noqa: E402
from smb.SMBConnection import SMBConnection  # noqa: E402


class SmbError(Exception):
    """Something the admin (or the user) can understand and fix."""


class Missing(Exception):
    """The file or folder is not there."""


class Entry:
    def __init__(self, name, is_dir, size, mtime):
        self.name, self.is_dir, self.size, self.mtime = name, is_dir, size, mtime  # mtime: seconds (float)

    def etag(self):
        return f'"s{int(self.mtime * 1e7):x}-{self.size:x}"'


def address_of(server):
    """The NAS address: \\\\nas, nas.local, an IP address. Names are looked up (mDNS .local names work on the box)."""
    server = server.strip().strip('\\/').split('\\')[0].split('/')[0]
    try:
        return socket.gethostbyname(server)
    except OSError:
        raise SmbError(f'Could not find the NAS "{server}". Check its name, or type its address (like 192.168.1.20).')


def friendly(e):
    t = str(e).lower()
    if isinstance(e, (SMBTimeout, socket.timeout)) or 'timed out' in t:
        return 'The NAS did not answer in time. Check that it is switched on and on the same network.'
    if isinstance(e, ConnectionRefusedError) or 'refused' in t:
        return 'The NAS refused the connection. Check that file sharing (SMB) is switched on there.'
    if isinstance(e, OSError) and ('unreachable' in t or 'no route' in t or 'host is down' in t):
        return 'Could not reach the NAS. Check its address, and that it is switched on.'
    return f'Could not talk to the NAS: {e}'


class SmbShare:
    def __init__(self, server, share, username='', password='', domain=''):
        self.server, self.share = server.strip(), share.strip().strip('\\/')
        self.username, self.password, self.domain = username or '', password or '', domain or ''
        self.conn = None
        self.lock = threading.RLock()
        self.last_ok = 0.0
        self.last_error = ''

    # ------------------------------------------------------------------ the connection
    def _connect(self):
        ip = address_of(self.server)
        c = SMBConnection(self.username, self.password, 'THREEDJAMES', self.server.split('.')[0][:15].upper() or 'NAS',
                          domain=self.domain, use_ntlm_v2=True, is_direct_tcp=True)
        try:
            ok = c.connect(ip, 445, timeout=15)
        except (OSError, SMBTimeout, NotReadyError, NotConnectedError) as e:
            raise SmbError(friendly(e))
        if not ok:
            raise SmbError('The NAS said no: check the NAS user name and password (leave both empty for a share '
                           'that needs no password).')
        try:
            names = [s.name for s in c.listShares(timeout=15)]
        except Exception:  # noqa: BLE001 - some NAS boxes don't list shares: try the share itself below
            names = None
        if names is not None and self.share.lower() not in (n.lower() for n in names):
            c.close()
            visible = ', '.join(n for n in names if not n.endswith('$')) or 'none'
            raise SmbError(f'The NAS has no share called "{self.share}". Shares it has: {visible}.')
        try:
            c.listPath(self.share, '/', timeout=15)
        except OperationFailure:
            c.close()
            raise SmbError(f'The NAS would not let this user open the share "{self.share}". Check the user name and '
                           'password, and that this user may use the share.')
        self.conn = c

    def _do(self, fn):
        """fn(conn), connecting first when needed; once more on a fresh connection when the old one broke."""
        with self.lock:
            for attempt in (0, 1):
                if self.conn is None:
                    try:
                        self._connect()
                    except SmbError as e:
                        self.last_error = str(e)
                        raise
                try:
                    r = fn(self.conn)
                    self.last_ok, self.last_error = time.time(), ''
                    return r
                except OperationFailure:
                    self.last_ok = time.time()
                    raise
                except (OSError, SMBTimeout, NotReadyError, NotConnectedError, AttributeError) as e:
                    self.close()
                    if attempt:
                        self.last_error = friendly(e)
                        raise SmbError(self.last_error)

    def close(self):
        with self.lock:
            if self.conn is not None:
                try:
                    self.conn.close()
                except Exception:  # noqa: BLE001
                    pass
            self.conn = None

    def check(self):
        """Connect (if needed) and make sure the share is still there. Raises SmbError."""
        self._do(lambda c: c.echo(b'3dj', timeout=10))

    # ------------------------------------------------------------------ files (paths: lists of names inside the share)
    @staticmethod
    def _p(parts):
        return '/' + '/'.join(parts)

    def stat(self, parts):
        if not parts:
            return Entry('', True, 0, 0)
        try:
            a = self._do(lambda c: c.getAttributes(self.share, self._p(parts), timeout=30))
        except OperationFailure:
            raise Missing()
        return Entry(a.filename, a.isDirectory, a.file_size, a.last_write_time)

    def listdir(self, parts):
        try:
            got = self._do(lambda c: c.listPath(self.share, self._p(parts), timeout=30))
        except OperationFailure:
            raise Missing()
        return [Entry(f.filename, f.isDirectory, f.file_size, f.last_write_time) for f in got if f.filename not in ('.', '..')]

    def makedirs(self, parts):
        for i in range(1, len(parts) + 1):
            try:
                e = self.stat(parts[:i])
                if not e.is_dir:
                    raise SmbError(f'There is a file called "{parts[i - 1]}" where a folder should be.')
                continue
            except Missing:
                pass
            try:
                self._do(lambda c: c.createDirectory(self.share, self._p(parts[:i]), timeout=30))
            except OperationFailure:
                try:  # made meanwhile by someone else?
                    if self.stat(parts[:i]).is_dir:
                        continue
                except Missing:
                    pass
                raise SmbError(f'The NAS would not make the folder "{parts[i - 1]}": may this user write to the share?')

    def read_to(self, parts, fileobj):
        try:
            self._do(lambda c: (fileobj.seek(0), fileobj.truncate(), c.retrieveFile(self.share, self._p(parts), fileobj, timeout=120)))
        except OperationFailure:
            raise Missing()

    def read_to_temp(self, parts):
        """The file, copied into a temporary file here (the caller removes it)."""
        fd, tmp = tempfile.mkstemp(prefix='nas-')
        try:
            with os.fdopen(fd, 'w+b') as f:
                self.read_to(parts, f)
        except BaseException:
            os.remove(tmp)
            raise
        return tmp

    def write_from(self, parts, source):
        """Put the local file `source` at parts: first under a temporary name next to it, then swapped in, so a cut
        connection never leaves half a file."""
        tmp = parts[:-1] + [f'.saving-{uuid.uuid4().hex[:10]}']
        try:
            with open(source, 'rb') as f:
                self._do(lambda c: (f.seek(0), c.storeFile(self.share, self._p(tmp), f, timeout=300)))
        except OperationFailure:
            self._forget(tmp)
            raise SmbError('The NAS would not let 3DJames save there. On the NAS, give this user (or everyone, for a '
                           'share with no password) permission to write to the share.')
        try:
            try:
                self.stat(parts)
                self._do(lambda c: c.deleteFiles(self.share, self._p(parts), timeout=30))
            except Missing:
                pass
            self._do(lambda c: c.rename(self.share, self._p(tmp), self._p(parts), timeout=30))
        except OperationFailure:
            self._forget(tmp)
            raise SmbError('The NAS would not let 3DJames replace that file. Is it open (and locked) in another program?')
        return self.stat(parts)

    def remove(self, parts):
        try:
            self._do(lambda c: c.deleteFiles(self.share, self._p(parts), timeout=30))
        except OperationFailure:
            raise SmbError('The NAS would not let 3DJames delete that file.')

    def _forget(self, parts):
        try:
            self._do(lambda c: c.deleteFiles(self.share, self._p(parts), timeout=30))
        except Exception:  # noqa: BLE001
            pass

    def test_write(self, parts):
        """Can files be saved in folder `parts`? Saves, reads back and deletes a small test file. Raises SmbError."""
        self.makedirs(parts)
        name = parts + [f'.3djames-test-{uuid.uuid4().hex[:8]}']
        fd, src = tempfile.mkstemp(prefix='nas-test-')
        data = b'3DJames test ' + uuid.uuid4().hex.encode()
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
            self.write_from(name, src)
            back = self.read_to_temp(name)
            try:
                with open(back, 'rb') as f:
                    if f.read() != data:
                        raise SmbError('The NAS gave back something different from what was saved.')
            finally:
                os.remove(back)
            self.remove(name)
        finally:
            try:
                os.remove(src)
            except OSError:
                pass
