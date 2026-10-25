"""A small web framework on Python's built-in server: routes, JSON, cookies, uploads to temporary files."""
import json
import os
import shutil
import tempfile
import urllib.parse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_UPLOAD = 450 << 20  # projects can be up to 400 MB


class Request:
    def __init__(self, h):
        self.h = h
        u = urllib.parse.urlsplit(h.path)
        self.path = u.path
        self.query = {k: v[-1] for k, v in urllib.parse.parse_qs(u.query, keep_blank_values=True).items()}
        self.method = h.command
        self.headers = h.headers
        c = SimpleCookie()
        try:
            c.load(h.headers.get('Cookie', ''))
        except Exception:  # noqa: BLE001
            pass
        self.cookies = {k: m.value for k, m in c.items()}
        self.ip = h.client_address[0]
        self._body = None
        self.consumed = False  # the upload was already read (into memory or a temporary file)

    def length(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_UPLOAD:
            raise ValueError('That is too big (more than 450 MB).')
        return n

    def body(self):
        if self._body is None:
            self._body = self.h.rfile.read(self.length())
            self.consumed = True
        return self._body

    def json(self):
        try:
            return json.loads(self.body() or b'{}')
        except ValueError:
            return {}

    def form(self):
        return {k: v[-1] for k, v in urllib.parse.parse_qs(self.body().decode('utf-8', 'replace')).items()}

    def to_temp_file(self, dir=None):
        """The request body, streamed into a temporary file (big uploads never sit in memory)."""
        n = self.length()
        self.consumed = True
        fd, path = tempfile.mkstemp(prefix='upload-', dir=dir)
        with os.fdopen(fd, 'wb') as f:
            left = n
            while left > 0:
                chunk = self.h.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left > 0:
            os.remove(path)
            raise ValueError('The upload was cut off.')
        return path


class Response:
    def __init__(self, status=200, body=b'', ctype='text/plain; charset=utf-8', headers=None, file=None, remove_file=False):
        self.status, self.body, self.ctype, self.headers, self.file = status, body, ctype, dict(headers or {}), file
        self.remove_file = remove_file  # file is a temporary copy: delete it once sent


def js(obj, status=200, headers=None):
    return Response(status, json.dumps(obj).encode(), 'application/json', headers)


def html(text, status=200, headers=None):
    return Response(status, text.encode('utf-8'), 'text/html; charset=utf-8', {'Cache-Control': 'no-store', **(headers or {})})


def redirect(to, headers=None):
    return Response(303, b'', headers={'Location': to, **(headers or {})})


def cookie(name, value, max_age):
    return f'{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}'


class Handler(BaseHTTPRequestHandler):
    routes = []  # [(method, path, fn)]
    protocol_version = 'HTTP/1.1'
    server_version = '3DJames'

    def log_message(self, fmt, *args):  # quiet: only errors
        pass

    def handle_any(self):
        req = Request(self)
        try:
            fn = next((f for m, p, f in self.routes if m == req.method and (p == req.path or (p.endswith('*') and req.path.startswith(p[:-1])))), None)
            res = fn(req) if fn else self.not_found(req)
        except ValueError as e:
            res = js({'ok': False, 'message': str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            res = js({'ok': False, 'message': f'Something went wrong on the server: {e}'}, 500)
        self.send(res, req)

    def not_found(self, req):
        return js({'ok': False, 'message': 'Not found'}, 404)

    def send(self, res, req):
        try:
            if req.method != 'HEAD' and req.headers.get('Content-Length') and not req.consumed and res.status >= 400:
                # an unread upload: read it away so the connection stays usable
                try:
                    req.h.rfile.read(min(req.length(), MAX_UPLOAD))
                except Exception:  # noqa: BLE001
                    self.close_connection = True
            self.send_response(res.status)
            self.send_header('Content-Type', res.ctype)
            for k, v in res.headers.items():
                if isinstance(v, list):
                    for x in v:
                        self.send_header(k, x)
                else:
                    self.send_header(k, v)
            if res.file:
                size = os.path.getsize(res.file)
                self.send_header('Content-Length', str(size))
                self.end_headers()
                if req.method != 'HEAD':
                    with open(res.file, 'rb') as f:
                        shutil.copyfileobj(f, self.wfile, 1 << 20)
            else:
                self.send_header('Content-Length', str(len(res.body)))
                self.end_headers()
                if req.method != 'HEAD':
                    self.wfile.write(res.body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        finally:
            if res.file and res.remove_file:
                try:
                    os.remove(res.file)
                except OSError:
                    pass

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = handle_any


def serve(handler_cls, port, host=''):
    s = ThreadingHTTPServer((host, port), handler_cls)
    s.daemon_threads = True
    return s
