"""
Every link to an ashleylim.com page → a path on this site (e.g. https://ashleylim.com/eft → /eft), so they follow whatever
domain serves the site (www.ashleylim.com once it's on Vercel). Payment links (?product=…, add-to-cart links into the
WooCommerce / cafe24 checkout on ashleylim.com) and WordPress files (/wp-content/…) keep pointing to ashleylim.com.
Links to pages of this site open in the same tab. Canonical tags name the page on www.ashleylim.com (they need a full URL).
Live slugs that live under another path here come from overrides.json ("path", e.g. lifeartist2026 → /lifeartist).

Used by gen.py for generated pages; run it directly to update the hand-built pages:
  python3 tools/rebuild/sitelinks.py site/index.html site/nsmb/index.html …
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATHS = {k: v['path'] for k, v in json.load(open(os.path.join(HERE, 'overrides.json'))).items()
         if isinstance(v, dict) and v.get('path')}
CANONICAL = 'https://www.ashleylim.com'
PAGE = re.compile(r'^/(?!go/|assets/|preview/)[^.]*$')   # a page of this site (not a file, a /go/ redirect or a preview)
LIVE = re.compile(r'^https?://(?:www\.)?ashleylim\.com(/[^?#]*)?(\?[^#]*)?(#.*)?$')


def site_link(href):
    m = LIVE.match(href)
    if not m or 'product=' in href or '/wp-content/' in href: return href
    path, query, frag = (m.group(1) or '/').rstrip('/'), m.group(2) or '', m.group(3) or ''
    slug = path.lstrip('/')
    if slug in PATHS: path = '/' + PATHS[slug]
    return (path or '/') + query + frag


def localize_html(text):
    def tag(m):
        t = m.group(0)
        h = re.search(r'href="([^"]+)"', t)
        if not h: return t
        raw = h.group(1).replace('&amp;', '&')
        if 'rel="canonical"' in t:   # canonical: this page on www.ashleylim.com
            path = site_link(raw) if LIVE.match(raw) else raw
            return t.replace(h.group(0), 'href="%s"' % (CANONICAL + (path.rstrip('/') or '/'))) if path.startswith('/') else t
        new = site_link(raw) if LIVE.match(raw) else raw
        t = t.replace(h.group(0), 'href="%s"' % new.replace('&', '&amp;'))
        if PAGE.match(new.split('#')[0].split('?')[0]):   # same site: same tab
            t = re.sub(r'\s+target="_blank"', '', t); t = re.sub(r'\s+rel="noopener(?: noreferrer)?"', '', t)
        return t
    return re.sub(r'<(?:a|link)\b[^>]*>', tag, text)


if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f).read(); n = localize_html(s)
        if n != s: open(f, 'w').write(n); print('updated', f)
