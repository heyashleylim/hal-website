"""
Ends a timed sale on a generated page: removes the elements marked data-sale="hide" and the countdown
(data-sale="countdown"), puts the regular price in data-sale="price" (from data-sale-after) and drops sale.js.
In the browser, /assets/js/sale.js does the same at the deadline; this makes it permanent in the HTML.

  python3 tools/rebuild/sale_end.py site/eft/index.html site/preview/eft/index.html   # only acts once the deadline has passed
  python3 tools/rebuild/sale_end.py --force …                                          # end it now regardless

Run by .github/workflows/sale-end.yml just after the deadline, and by gen.py when it regenerates a page after it.
"""
import datetime, re, sys

def _element_span(html, start):
    # [start, end) of the element whose start tag begins at `start` (same-name nesting counted).
    name = re.match(r'<([a-zA-Z0-9]+)', html[start:]).group(1)
    depth, pos = 0, start
    pat = re.compile(r'<(/?)%s\b[^>]*>' % name)
    for m in pat.finditer(html, start):
        depth += -1 if m.group(1) else 1
        if depth == 0: return start, m.end()
    raise ValueError('unclosed <%s>' % name)

def deadline_of(html):
    m = re.search(r'data-sale-deadline="([^"]+)"', html)
    return datetime.datetime.fromisoformat(m.group(1)) if m else None

def end_sale(html):
    for marker in ('hide', 'countdown'):
        while True:
            m = re.search(r'<[a-zA-Z0-9]+\b[^>]*\bdata-sale="%s"[^>]*>' % marker, html)
            if not m: break
            a, b = _element_span(html, m.start()); html = html[:a] + html[b:]
    def price(m):
        a, b = _element_span(html_ref[0], m.start())
        el = html_ref[0][a:b]
        after = re.search(r'data-sale-after="([^"]*)"', el).group(1)
        open_tag = re.match(r'<[^>]*>', el).group(0)
        open_tag = re.sub(r'\s*data-sale(?:-after)?="[^"]*"', '', open_tag)
        name = re.match(r'<([a-zA-Z0-9]+)', el).group(1)
        return (a, b, '%s%s</%s>' % (open_tag, after, name))
    while True:
        html_ref = [html]
        m = re.search(r'<[a-zA-Z0-9]+\b[^>]*\bdata-sale="price"[^>]*>', html)
        if not m: break
        a, b, rep = price(m); html = html[:a] + rep + html[b:]
    html = re.sub(r'<script src="/assets/js/sale\.js"[^>]*></script>\n?', '', html)
    html = re.sub(r'<link rel="stylesheet" href="/assets/css/sale\.css">\n?', '', html)
    html = re.sub(r'\s*data-sale-deadline="[^"]*"', '', html)
    return html

if __name__ == '__main__':
    force = '--force' in sys.argv
    for f in [a for a in sys.argv[1:] if not a.startswith('--')]:
        s = open(f, encoding='utf-8').read(); d = deadline_of(s)
        if d is None: print('no sale on', f); continue
        if not force and datetime.datetime.now(datetime.timezone.utc) < d: print('sale still running on', f, '(ends %s)' % d.isoformat()); continue
        open(f, 'w', encoding='utf-8').write(end_sale(s)); print('sale ended on', f)
