"""
Links to ashleylim.com pages → paths on this site (e.g. https://ashleylim.com/eft → /eft), so they follow whatever
domain serves the site. Payment links (?product=…) and WordPress files (/wp-content/…) keep pointing to ashleylim.com.
Live slugs that live under another path here come from overrides.json ("path", e.g. lifeartist2026 → /lifeartist).

Used by gen.py for generated pages; run it directly to update the hand-built pages:
  python3 tools/rebuild/sitelinks.py site/index.html site/nsmb/index.html …
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATHS = {k: v['path'] for k, v in json.load(open(os.path.join(HERE, 'overrides.json'))).items()
         if isinstance(v, dict) and v.get('path')}
LIVE = re.compile(r'^https?://(?:www\.)?ashleylim\.com(/[^?#]*)?(\?[^#]*)?(#.*)?$')


def site_link(href):
    m = LIVE.match(href)
    if not m or 'product=' in href or '/wp-content/' in href: return href
    path, query, frag = (m.group(1) or '/').rstrip('/'), m.group(2) or '', m.group(3) or ''
    slug = path.lstrip('/')
    if slug in PATHS: path = '/' + PATHS[slug]
    return (path or '/') + query + frag


def localize_html(text):
    # Every href="…" except the canonical tag (that one names the original page for search engines).
    def tag(m):
        t = m.group(0)
        if re.search(r'rel="canonical"', t): return t
        return re.sub(r'href="([^"]+)"', lambda h: 'href="%s"' % site_link(h.group(1).replace('&amp;', '&')).replace('&', '&amp;')
                      if LIVE.match(h.group(1).replace('&amp;', '&')) else h.group(0), t)
    return re.sub(r'<(?:a|link)\b[^>]*>', tag, text)


if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f).read(); n = localize_html(s)
        if n != s: open(f, 'w').write(n); print('updated', f)
