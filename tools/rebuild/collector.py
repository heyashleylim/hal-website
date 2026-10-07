# Local helper for page capture. Serves the live site same-origin so fonts and scripts load normally:
#   GET  /p/<path>        -> live page HTML, with ashleylim.com URLs rewritten to this origin
#   GET  /<anything else> -> proxied live asset (CSS bodies rewritten the same way)
#   GET  /cap.js          -> the capture script
#   POST /save?name=<n>   -> writes the JSON body to dumps/<n>.json
import http.server, os, re, subprocess, urllib.parse, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'dumps'); CACHE = os.path.join(HERE, 'proxycache')
os.makedirs(CACHE, exist_ok=True); os.makedirs(OUT, exist_ok=True)
LIVE = 'https://ashleylim.com'
def fetch(url):
    key = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest())
    if os.path.exists(key) and not url.endswith(('/', '')) is False and os.path.exists(key + '.ct'):
        return open(key, 'rb').read(), open(key + '.ct').read()
    r = subprocess.run(['curl', '-sL', '-A', 'Mozilla/5.0 (Macintosh) Chrome/130', '-w', '\n%{content_type}', url], capture_output=True)
    body, _, ct = r.stdout.rpartition(b'\n')
    ct = ct.decode() or 'application/octet-stream'
    open(key, 'wb').write(body); open(key + '.ct', 'w').write(ct)
    return body, ct
def rewrite(b):
    # Visible text such as <a href="...">https://ashleylim.com</a> must survive: hide text occurrences
    # (right after a tag, optionally after spaces, or after an opening bracket that isn't url( ) behind an entity before rewriting URLs.
    b = re.sub(rb'(>\s*|(?<!url)\()https://ashleylim\.com', rb'\1https&#58;//ashleylim.com', b)
    b = re.sub(rb'https://ashleylim\.com(?=["\'])', b'/', b)  # bare-domain links would otherwise become href=""
    return b.replace(b'https://ashleylim.com', b'').replace(b'https:\\/\\/ashleylim.com', b'').replace(b'//ashleylim.com/', b'/')
class H(http.server.BaseHTTPRequestHandler):
    def send(self, body, ct, cache=True):
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body)))
        if not cache: self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/cap.js':
            return self.send(open(os.path.join(HERE, 'cap.js'), 'rb').read(), 'text/javascript', cache=False)
        if u.path.startswith('/p/'):
            body, ct = fetch(LIVE + '/' + u.path[3:] + (('?' + u.query) if u.query else ''))
            body = re.sub(rb'<meta[^>]+Content-Security-Policy[^>]*>', b'', rewrite(body), flags=re.I)
            return self.send(body, 'text/html; charset=utf-8', cache=False)
        body, ct = fetch(LIVE + self.path)
        if 'css' in ct or 'javascript' in ct: body = rewrite(body)
        self.send(body, ct)
    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = os.path.basename(q.get('name', ['dump'])[0])
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with open(os.path.join(OUT, name + '.json'), 'wb') as f: f.write(data)
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'saved %d bytes' % len(data))
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8799), H).serve_forever()
