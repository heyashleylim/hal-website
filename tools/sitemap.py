"""
Writes site/sitemap.xml (served at https://www.ashleylim.com/sitemap.xml; robots.txt points to it).

Lists every public page (site/<page>/index.html) except /preview/*, pages marked noindex, and EXCLUDE below.
lastmod = the date of the page's last commit. Run after adding, removing or changing pages:
  python3 tools/sitemap.py
"""
import os, re, subprocess
from xml.sax.saxutils import escape

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SITE = os.path.join(REPO, 'site')
BASE = 'https://www.ashleylim.com'
EXCLUDE = {'/engine'}   # alternative design of /nsmb: not offered to search engines


def pages():
    for root, dirs, files in os.walk(SITE):
        dirs[:] = sorted(d for d in dirs if d not in ('preview', 'admin', 'podcast', 'assets', '_debug', 'og'))
        if 'index.html' not in files: continue
        f = os.path.join(root, 'index.html')
        path = '/' + os.path.relpath(root, SITE).replace(os.sep, '/').strip('.').strip('/')
        if path in EXCLUDE: continue
        if re.search(r'<meta name="robots" content="[^"]*noindex', open(f, encoding='utf-8').read()): continue
        date = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', f], cwd=REPO, capture_output=True, text=True).stdout.strip()
        yield path.rstrip('/') or '/', date


rows = sorted(pages(), key=lambda p: (p[0] != '/', p[0]))
xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for path, date in rows:
    xml.append('  <url><loc>%s</loc>%s</url>' % (escape(BASE + (path if path != '/' else '/')), '<lastmod>%s</lastmod>' % date if date else ''))
xml.append('</urlset>')
open(os.path.join(SITE, 'sitemap.xml'), 'w').write('\n'.join(xml) + '\n')
print('\n'.join(xml))
