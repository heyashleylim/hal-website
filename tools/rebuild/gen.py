"""
Generate a static page from a live-page capture (cap.js dumps at 1440 / 900 / 390px).

  python3 gen.py <slug> [--sticky-header] [--public-only | --preview-only]

Writes:
  site/<slug>/index.html          public: elements hidden at every breakpoint are dropped
  site/preview/<slug>/index.html  private: every element shown; hidden ones outlined + labelled
Images go to site/assets/img/<slug>/ when visible publicly, else site/preview/<slug>/img/.
"""
import hashlib, html, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SITE = os.path.join(REPO, 'site')
CACHE = os.path.join(HERE, 'imgcache'); os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.join(HERE, 'dumps'), exist_ok=True)

INHERITED = {'font-family','font-size','font-weight','font-style','line-height','color','text-align','letter-spacing',
             'text-transform','white-space','word-break','text-decoration-line','text-decoration-color',
             'text-underline-offset','list-style-type','visibility','fill','stroke'}
IMGLIKE = {'img','iframe','video'}
VOID = {'br','img','input','hr','source','wbr'}
BPS = ['d','t','m']
BP_LABEL = {'d':'데스크톱','t':'태블릿','m':'모바일'}
GOOGLE = {'Newsreader':'Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500',
          'Poppins':'Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400',
          'Abhaya Libre':'Abhaya+Libre:wght@400;500;600;700',
          'Noto Serif KR':'Noto+Serif+KR:wght@400;500;700'}
ICON_FONTS = re.compile(r'icomoon|eicons|Font Awesome|fa-|elementor-icons', re.I)

slug = sys.argv[1]; STICKY = '--sticky-header' in sys.argv
DEBUG = '--debug' in sys.argv
MODES = [False] if '--public-only' in sys.argv else [True] if '--preview-only' in sys.argv else [False, True]
D = json.loads(open(os.path.join(HERE, 'dumps', slug + '.d.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))
T = json.loads(open(os.path.join(HERE, 'dumps', slug + '.t.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))['styles']
M = json.loads(open(os.path.join(HERE, 'dumps', slug + '.m.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))['styles']
meta = D['meta']

nodes, parent = {}, {}
def index(n, p=None):
    nodes[n['i']] = n; parent[n['i']] = p
    for c in n.get('c', []):
        if isinstance(c, dict): index(c, n['i'])
for r in D['tree']:
    if r['node']: index(r['node'])

ROLE = {}
for r in D['tree']:
    if r['node']:
        stack = [r['node']]
        while stack:
            x = stack.pop(); ROLE[x['i']] = r['role']
            stack.extend(c for c in x.get('c', []) if isinstance(c, dict))
def in_role(i, role): return ROLE.get(i) == role

def S(bp, i):
    if bp == 'd': return nodes[i]['s']
    return (T if bp == 't' else M).get(str(i), nodes[i]['s'])
def P(bp, i):
    if bp == 'd': return nodes[i].get('p')
    return (T if bp == 't' else M).get(str(i), {}).get('__p')

def eff(bp, i, prop):
    """Inherited property as rendered: captured values only differ from the parent, so walk up."""
    x = i
    while x is not None:
        v = S(bp, x).get(prop)
        if v: return v
        x = parent[x]
    return {'line-height': D['meta']['bodyLH'], 'font-size': D['meta']['bodySize']}.get(prop)

def is_panel(i): return nodes[i]['a'].get('role') == 'tabpanel'
def in_details_body(i):
    # Content of a closed <details> (FAQ accordion) reports display:none, but it's interactive, not hidden.
    c, p = i, parent[i]
    while p is not None:
        if nodes[p]['t'] == 'details': return nodes[c]['t'] != 'summary'
        c, p = p, parent[p]
    return False
def is_toggle_icon(i):
    # Accordion open/closed icons swap via display:none — interactive state, not hidden content.
    c = i
    while c is not None:
        if re.search(r'\be-(opened|closed)\b', nodes[c]['a'].get('cls', '')): return True
        c = parent[c]
    return False
def hid(bp, i):
    st = S(bp, i)
    if not st.get('__hidden') or is_panel(i) or in_details_body(i) or is_toggle_icon(i): return False
    if in_role(i, 'header') and st.get('display') != 'none' and not S('d', i).get('__hidden'):
        return False  # Elementor's sticky header toggles visibility on the original while a clone shows
    return True
def hidden_all(i): return all(hid(bp, i) for bp in BPS)
def anc_hidden_all(i):
    p = parent[i]
    while p is not None:
        if hidden_all(p): return True
        p = parent[p]
    return False
def public_visible(i): return not hidden_all(i) and not anc_hidden_all(i)
def anc_hidden_bp(bp, i):
    p = parent[i]
    while p is not None:
        if hid(bp, p): return True
        p = parent[p]
    return False

fonts_used = set()
def map_font(v):
    if ICON_FONTS.search(v): return None
    if 'Gmarket' in v: return 'var(--font-head)'
    for g in GOOGLE:
        if g in v:
            fonts_used.add(g); return '"%s", var(--font-body)' % g
    return 'var(--font-body)'

def px(v):
    try: return float(str(v).replace('px', ''))
    except ValueError: return None

def fr_tracks(v):
    parts = v.split()
    if parts and all(re.fullmatch(r'[\d.]+px', p) for p in parts):
        return ' '.join('minmax(0,%sfr)' % round(float(p[:-2]), 2) for p in parts)
    return v

IMGMAP = {}      # live url -> (public?, local url)
IMGDIM = {}      # live url -> (w, h) of the local file
img_public = {}  # live url -> bool used publicly
def note_img(url, i):
    if not url or url.startswith('data:'): return
    img_public[url] = img_public.get(url, False) or public_visible(i)

UA_INH = {}
for t_ in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'): UA_INH[t_] = ('font-size', 'font-weight')
for t_ in ('strong', 'b', 'th'): UA_INH[t_] = ('font-weight',)
for t_ in ('em', 'i', 'cite', 'address', 'dfn', 'var'): UA_INH[t_] = ('font-style',)
for t_ in ('small', 'big', 'sub', 'sup'): UA_INH[t_] = ('font-size',)
for t_ in ('code', 'kbd', 'pre', 'samp', 'tt'): UA_INH[t_] = ('font-family', 'font-size')
for t_ in ('button', 'input', 'select', 'textarea', 'option'):
    UA_INH[t_] = ('font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'color', 'letter-spacing', 'text-align', 'text-transform')
UA_INH['a'] = ('color',)
UA_INH['mark'] = ('color',)

def decls(i, bp, preview):
    n = nodes[i]; s = S(bp, i); out = {}
    if hid(bp, i):
        if not preview: return {'display': 'none'}
        for alt in BPS:  # preview: borrow styles from a breakpoint where it shows
            if not hid(alt, i): s = S(alt, i); break
    for k, v in s.items():
        if k.startswith('__'): continue
        if k == 'font-family':
            f = map_font(v)
            if f: out[k] = f
            continue
        if k == 'visibility' and v == 'hidden' and (preview or in_role(i, 'header')): continue
        if k == 'display' and v == 'none':
            # Interactive states (tabs, accordion bodies, accordion icons) are handled by [hidden] / details CSS.
            if preview or is_panel(i) or in_details_body(i) or is_toggle_icon(i):
                alt = next((S(b, i).get('display') for b in BPS if S(b, i).get('display') not in (None, 'none')), None)
                if alt: out['display'] = alt
                continue
        if k == 'grid-template-columns': v = fr_tracks(v)
        if k == 'transition': continue
        if k == 'background-image' and 'url(' in v:
            for u in re.findall(r'url\("?([^")]+)"?\)', v): note_img(u, i)
        out[k] = v
    if is_panel(i) and out.get('display') == 'none': out.pop('display')
    for prop in UA_INH.get(n['t'], ()):
        if prop not in out:
            v = eff(bp, i, prop)
            if v:
                if prop == 'font-family':
                    v = map_font(v)
                    if not v: continue
                out[prop] = v
    # ----- layout -----
    w, pw = s.get('__w'), s.get('__pw')
    disp = s.get('display', '')
    pi = parent[i]; pd = S(bp, pi) if pi is not None else {}
    pdisp, pdir = s.get('__pdisp', ''), s.get('__pdir', 'row')
    if n['t'] in IMGLIKE and w:
        h = s.get('__h')
        ptag = nodes[pi]['t'] if pi is not None else ''
        if pw and abs(w - pw) <= 1 and ptag not in ('picture', 'a', 'span', 'figure'): out['width'] = '100%'
        else: out['width'] = '%gpx' % w; out['max-width'] = '100%'
        if n['t'] == 'img':
            nw, nh = n['a'].get('nw'), n['a'].get('nh')
            fit = s.get('object-fit', 'fill')
            if fit not in ('fill', '') or (nw and nh and h and abs(h / w - nh / nw) > 0.02):
                out['height'] = '%gpx' % h
                if fit in ('fill', ''): out['object-fit'] = 'cover'
            else: out['height'] = 'auto'
        elif h: out['aspect-ratio'] = '%g / %g' % (w, h); out['height'] = 'auto'
    elif w is not None and n['t'] not in ('svg', 'br'):
        inline = disp.startswith('inline') or disp in ('contents', 'table-cell')
        h = s.get('__h')
        fs = px(eff(bp, i, 'font-size') or '16px') or 16
        lh = px(eff(bp, i, 'line-height') or '') or fs * 1.2
        only_text = all(isinstance(c, str) or c['t'] in ('span', 'strong', 'b', 'em', 'i', 'u', 'a', 'br', 'mark', 'small', 'sup', 'sub')
                        for c in n.get('c', []))
        single_line = only_text and h is not None and h <= lh * 1.45
        if 'flex' in pdisp and pdir.startswith('row'):
            if pw and abs(w - pw) <= 1 and not inline and s.get('flex-grow', '0') == '0' and not only_text:
                out['width'] = '100%'  # full-width row item: in a centred row it would otherwise shrink to its content
            if pw and w < pw - 1 and not inline:
                if s.get('flex-grow', '0') in ('0',):
                    if not single_line: out['width'] = '%gpx' % ((int(w) + 1) if only_text else w)
                else:
                    out['flex-basis'] = '%gpx' % w
            # Items that don't fill the row's height must have had an explicit height (stretch is the default).
            if h and pd.get('align-items', 'normal') in ('normal', 'stretch') and pd.get('flex-wrap', 'nowrap') == 'nowrap' \
                    and s.get('align-self', 'auto') in ('auto', 'normal', 'stretch'):
                ph = S(bp, pi).get('__h') if pi is not None else None
                if ph:
                    pad = sum(px(pd.get(k, '0')) or 0 for k in ('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'))
                    if h < ph - pad - 1.5: out['height'] = '%gpx' % h
        elif 'grid' in pdisp: pass
        elif 'flex' in pdisp and pw and abs(w - pw) <= 1 and not inline and not only_text and \
                (pd.get('align-items', 'normal') not in ('normal', 'stretch') or s.get('align-self', 'auto') not in ('auto', 'normal', 'stretch')):
            out['width'] = '100%'  # full-width box in a centred / start-aligned column: it won't stretch by itself
        elif pw and abs(w - pw) > 1 and not inline and not single_line:
            # In a flex column, only stretched items can have had an explicit width; centred / start-aligned
            # items are sized by their own text, and pinning that width makes sub-pixel differences wrap.
            stretch = pd.get('align-items', 'normal') in ('normal', 'stretch') and \
                s.get('align-self', 'auto') in ('auto', 'normal', 'stretch')
            has_br = any(isinstance(c, dict) and c['t'] == 'br' for c in n.get('c', []))
            # Shrink-to-fit text only stays narrower than its parent when a <br> sets the line length.
            text_fit = only_text and has_br
            if 'flex' not in pdisp or stretch or not text_fit:
                out['width'] = '%gpx' % ((int(w) + 1) if only_text else w); out['max-width'] = '100%'
        # Single-line text that fills (almost) all of its room on the live page: keep it on one line here too.
        if single_line and only_text and pw and w >= pw * 0.9 and not n['a'].get('href'):
            out['white-space'] = 'nowrap'
        mw = s.get('__maxw', 'none')
        if mw not in ('none', '') and n['t'] != 'svg': out['max-width'] = mw
        has_text = any(isinstance(c, str) and c.strip() for c in n.get('c', []))
        if inline and disp != 'inline' and not has_text and h and n.get('c'):
            out['width'] = '%gpx' % w; out['height'] = '%gpx' % h  # icon-only inline boxes (e.g. social icons)
        ml, mr = px(s.get('margin-left', '0')), px(s.get('margin-right', '0'))
        if ml and mr and ml > 0 and abs(ml - mr) <= 1 and pw and abs((pw - w) / 2 - ml) <= 1.5:  # negative margins are real offsets
            out['margin-left'] = out['margin-right'] = 'auto'
        mh = s.get('__minh', '0px')
        if mh not in ('0px', 'auto', ''): out['min-height'] = mh
        txt = ''.join(c for c in n.get('c', []) if isinstance(c, str)).strip()
        if only_text and txt and len(txt) <= 4 and h and not inline:
            vpad = sum(px(s.get(k, '0')) or 0 for k in ('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'))
            if h > lh + vpad + 4: out['height'] = '%gpx' % h
            hpad = sum(px(s.get(k, '0')) or 0 for k in ('padding-left', 'padding-right', 'border-left-width', 'border-right-width'))
            if w and w > len(txt) * fs * 0.7 + hpad + 6 and 'flex' in pdisp: out['width'] = '%gpx' % w; out['flex-shrink'] = '0'
        has_kids = any(isinstance(c, dict) or (isinstance(c, str) and c.strip()) for c in n.get('c', []))
        if h and not has_kids and n['t'] not in VOID:
            out['height' if 'background-image' not in out else 'min-height'] = '%gpx' % h
    if out.get('position') == 'absolute' and w is not None and pw:
        # Computed left/right/top/bottom come back as pixels on both sides; keep only the side the box hugs.
        for a_, b_ in (('left', 'right'), ('top', 'bottom')):
            va, vb = px(out.get(a_, '')), px(out.get(b_, ''))
            if va is not None and vb is not None:
                size = w if a_ == 'left' else (s.get('__h') or 0)
                full = pw if a_ == 'left' else (S(bp, pi).get('__h') if pi is not None else 0) or 0
                if size < full - 2: out.pop(a_ if va > vb else b_)
    if out.get('position') == 'fixed' and in_role(i, 'header'):
        # Elementor's sticky header switches to position:fixed while scrolled; we use position:sticky instead.
        for k in ('position', 'top', 'left', 'right', 'width'): out.pop(k, None)
    if bp == 'd' and STICKY and n['i'] == D['tree'][0]['node']['i']:
        out.update({'position': 'sticky', 'top': '0', 'z-index': '100'})
    return out

def pdecls(i, bp, preview):
    p = P(bp, i) if not (hid(bp, i) and preview) else (P('d', i) or P('t', i) or P('m', i))
    if not p: return {}
    res = {}
    for ps, st in p.items():
        o = {}
        absolute = st.get('position') in ('absolute', 'fixed')
        node_s = S(bp, i) if not hid(bp, i) else {}
        for k, v in st.items():
            if absolute and k in ('top', 'right', 'bottom', 'left') and v != 'auto':
                o[k] = v; continue
            if absolute and k in ('width', 'height') and v.endswith('px'):
                box = node_s.get('__w' if k == 'width' else '__h')
                if box and abs(float(v[:-2]) - box) <= 2: o[k] = '100%'; continue
            if v in ('auto', 'none', 'normal', '0px', 'rgba(0, 0, 0, 0)', 'static') and k != 'content': continue
            if k == 'font-family':
                if ICON_FONTS.search(v):
                    o['font-family'] = 'var(--font-body)'
                    if re.fullmatch(r'"\\?[^"]{1}"', st.get('content', '')) or len(st.get('content', '')) <= 4:
                        o['content'] = '"✔"'
                    continue
                f = map_font(v); v = f or v
            if k == 'background-image' and 'url(' in v:
                for u in re.findall(r'url\("?([^")]+)"?\)', v): note_img(u, i)
            if k not in o: o[k] = v
        res[ps] = o
    return res

def diff(prev, cur):
    o = {}
    for k, v in cur.items():
        if prev.get(k) != v: o[k] = v
    for k in prev:
        if k not in cur:
            o[k] = 'inherit' if k in INHERITED else ({'width': 'auto', 'max-width': 'none', 'height': 'auto',
                    'min-height': '0', 'min-width': 'auto', 'aspect-ratio': 'auto'}.get(k, 'revert'))
    return o

def build(preview):
    classes, css_by_class = {}, {}
    def cls_for(i):
        D_ = decls(i, 'd', preview); T_ = decls(i, 't', preview); M_ = decls(i, 'm', preview)
        pd_ = {bp: pdecls(i, bp, preview) for bp in BPS}
        key = json.dumps([D_, diff(D_, T_), diff(T_, M_), pd_], sort_keys=True)
        if key not in classes:
            c = 'x%d' % len(classes); classes[key] = c
            css_by_class[c] = (D_, diff(D_, T_), diff(T_, M_), pd_)
        return classes[key]
    hidden_count = [0]

    def attrs_html(n, cls, extra=''):
        a = n['a']; t = n['t']
        keep = ' '.join(c for c in a.get('cls', '').split() if c in ('e-opened', 'e-closed'))
        out = [('class', cls + (' ' + keep if keep else ''))]
        for k in ('id', 'role', 'aria-controls', 'aria-selected', 'aria-labelledby', 'type', 'name', 'placeholder',
                  'value', 'for', 'title', 'open', 'required', 'checked', 'selected'):
            if k in a and not (t == 'iframe' and k == 'title'): out.append((k, a[k]))
        if t == 'a' and a.get('href'):
            out.append(('href', a['href']))
            if a.get('target'): out.append(('target', a['target'])); out.append(('rel', 'noopener'))
        if t == 'form': out.append(('action', '#'))
        if is_panel(n['i']) and S('d', n['i']).get('__hidden'): out.append(('hidden', ''))
        if DEBUG: out.append(('data-c', n['i']))
        s = ''.join(' %s="%s"' % (k, html.escape(str(v), quote=True)) if v != '' else ' %s' % k for k, v in out)
        return s + extra

    first_imgs = [0]
    def render(n, depth=0, flagged_bps=frozenset()):
        i = n['i']
        if not preview and not public_visible(i): return ''
        if preview and in_role(i, 'header') and S('d', i).get('visibility') == 'hidden' and hidden_all(i):
            return ''  # Elementor's sticky-header placeholder clone: not content, skip it in previews too
        t = n['t']; cls = cls_for(i)
        if t == 'svg':
            svg = re.sub(r'^<svg', '<svg class="%s"' % cls, n.get('svg', ''), count=1)
            return svg
        hb = frozenset(bp for bp in BPS if hid(bp, i))
        flag = ''
        mark = preview and hb and not (hb <= flagged_bps)
        if mark:
            hidden_count[0] += 1
            flag = ' data-hidden-on="%s"' % ' · '.join(BP_LABEL[b] for b in BPS if b in hb)
            cls += ' lv-hidden'
        if t == 'img':
            src = n['a'].get('src', ''); note_img(src, i)
            first_imgs[0] += 1
            lazy = ' loading="lazy" decoding="async"' if first_imgs[0] > 2 else ''
            dims = ' width="%d" height="%d"' % (n['a']['nw'], n['a']['nh']) if n['a'].get('nw') else '@@DIM:' + src + '@@'
            return '<img class="%s" src="%s" alt="%s"%s%s%s>' % (cls, '@@IMG:' + src + '@@', html.escape(n['a'].get('alt', ''), quote=True), dims, lazy, flag)
        if t == 'iframe':
            src = n['a'].get('src', '')
            m = re.search(r'youtube(?:-nocookie)?\.com/embed/([\w-]{11})', src)
            if m: src = 'https://www.youtube-nocookie.com/embed/%s?rel=0' % m.group(1)
            return '<iframe class="%s" src="%s" title="%s" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen%s></iframe>' % (cls, html.escape(src, quote=True), html.escape(n['a'].get('title') or '동영상', quote=True), flag)
        if t == 'br': return '<br>'
        if t == 'source': return ''
        if t in ('input',): return '<input%s>' % attrs_html(n, cls, flag)
        inner = []
        if n['a'].get('video'):
            v = n['a']['video']; m = re.search(r'(?:v=|youtu\.be/|embed/|shorts/)([\w-]{11})', v)
            if m: inner.append('<iframe class="lv-video" src="https://www.youtube-nocookie.com/embed/%s?rel=0" title="동영상" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>' % m.group(1))
        else:
            for c in n.get('c', []):
                if isinstance(c, str): inner.append(html.escape(c))
                else: inner.append(render(c, depth + 1, flagged_bps | hb))
        tag = {'header': 'header', 'footer': 'footer'}.get(t, t)
        if tag in ('button',) and n['a'].get('role') != 'tab' and 'type' not in n['a']: pass
        return '<%s%s>%s</%s>' % (tag, attrs_html(n, cls, flag), ''.join(inner), tag)

    parts = []
    for r in D['tree']:
        if not r['node']: continue
        h = render(r['node'])
        if r['role'] in ('wp-page', 'wp-post', 'main'): h = '<main id="main">' + h + '</main>'
        parts.append(h)
    body = '\n'.join(parts)

    def css_block(sel, d):
        return '%s{%s}' % (sel, ';'.join('%s:%s' % (k, v) for k, v in d.items())) if d else ''
    lines, tab, mob = [], [], []
    for c, (d_, t_, m_, p_) in css_by_class.items():
        lines.append(css_block('.' + c, d_))
        tab.append(css_block('.' + c, t_)); mob.append(css_block('.' + c, m_))
        prev = {}
        for bp, target in (('d', lines), ('t', tab), ('m', mob)):
            for ps, st in (p_.get(bp) or {}).items():
                target.append(css_block('.%s%s' % (c, ps), st if bp == 'd' else diff((p_.get('d') or {}).get(ps, {}), st)))
    css = '\n'.join(x for x in lines if x)
    css += '\n@media (max-width:1024px){' + ''.join(x for x in tab if x) + '}'
    css += '\n@media (max-width:767px){' + ''.join(x for x in mob if x) + '}'
    return body, css, hidden_count[0]

def localize_images(html_text, css_text):
    urls = set(re.findall(r'@@IMG:(.*?)@@', html_text)) | set(re.findall(r'url\("?(https?://[^")]+)"?\)', css_text))
    pub_dir = os.path.join(SITE, 'assets', 'img', slug); prv_dir = os.path.join(SITE, 'preview', slug, 'img')
    for u in sorted(urls):
        if u in IMGMAP: continue
        base = re.sub(r'\?.*$', '', u.split('/')[-1])
        stem, ext = os.path.splitext(base)
        safe = re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')[:40] or 'img'
        safe += '-' + hashlib.md5(u.encode()).hexdigest()[:6]
        raw = os.path.join(CACHE, hashlib.md5(u.encode()).hexdigest() + ext.lower())
        if not os.path.exists(raw):
            subprocess.run(['curl', '-sfL', '-A', 'Mozilla/5.0', '-o', raw, u])
            if not os.path.exists(raw) or os.path.getsize(raw) == 0: print('  ! download failed:', u)
        public = img_public.get(u, True) and MODES != [True]  # preview-only pages keep all their images private
        d = pub_dir if public else prv_dir; os.makedirs(d, exist_ok=True)
        if ext.lower() in ('.svg', '.gif', '.webp'):  # already web formats: copy as-is
            name = safe + ext.lower(); dst = os.path.join(d, name)
            if os.path.exists(raw): open(dst, 'wb').write(open(raw, 'rb').read())
        else:
            name = safe + '.webp'; dst = os.path.join(d, name)
            if not os.path.exists(dst) and os.path.exists(raw):
                subprocess.run(['cwebp', '-quiet', '-q', '82', '-m', '6', '-resize', '1600', '0', raw, '-o', dst]) \
                    if _width(raw) > 1600 else subprocess.run(['cwebp', '-quiet', '-q', '82', '-m', '6', raw, '-o', dst])
        if not os.path.exists(dst): print('  ! no output for:', u, '(raw', os.path.exists(raw) and os.path.getsize(raw), ')')
        IMGMAP[u] = ('/assets/img/%s/%s' % (slug, name)) if public else ('/preview/%s/img/%s' % (slug, name))
        if os.path.exists(dst) and not dst.endswith('.svg'):
            r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', dst], capture_output=True, text=True).stdout
            m_ = re.findall(r'pixel(?:Width|Height): (\d+)', r)
            if len(m_) == 2: IMGDIM[u] = (int(m_[0]), int(m_[1]))
    return IMGMAP

def _width(f):
    r = subprocess.run(['sips', '-g', 'pixelWidth', f], capture_output=True, text=True).stdout
    m = re.search(r'pixelWidth: (\d+)', r); return int(m.group(1)) if m else 0

def page(body, css, preview, nhidden):
    fl = ''
    gfam = [GOOGLE[f] for f in sorted(fonts_used)]
    if gfam:
        fl = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
              '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=%s&display=swap">' % '&family='.join(gfam))
    title = meta['title']; desc = meta.get('description', '')
    live_url = 'https://ashleylim.com' + meta['path'].replace('/p/', '/').rstrip('/')
    robots = '<meta name="robots" content="noindex, nofollow, noarchive">' if preview else '<link rel="canonical" href="%s">' % live_url
    banner = ''
    pcss = ''
    if preview:
        banner = ('<div class="lv-banner">비공개 미리보기 · 실제 페이지에서 숨겨진 요소 <b>%d개</b>를 점선으로 표시했어요 · '
                  '<a href="/%s">공개 페이지 보기 →</a></div>' % (nhidden, slug))
        pcss = ('.lv-banner{position:sticky;top:0;z-index:1000;background:#082D2E;color:#FFFDF7;font:500 14px/1.4 var(--font-body);padding:10px 16px;text-align:center}'
                '.lv-banner a{color:#F8F6D3}'
                '.lv-hidden{outline:2px dashed #C37568!important;outline-offset:3px}'
                '[data-hidden-on]:not(img):not(span):not(strong):not(a)::marker{color:inherit}'
                '.lv-hidden{position:relative}'
                '.lv-hidden::before{content:"숨김 · " attr(data-hidden-on)!important;position:absolute!important;top:-12px!important;left:6px!important;z-index:5!important;'
                'display:block!important;width:auto!important;height:auto!important;background:#C37568!important;color:#fff!important;font:700 11px/1.6 var(--font-body)!important;'
                'padding:0 8px!important;border-radius:100px!important;opacity:1!important;transform:none!important;pointer-events:none}')
    base = ('*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%%;scroll-behavior:smooth}'
            'body{margin:0;background:%s;color:%s;font-family:var(--font-body);font-size:%s;line-height:%s;-webkit-font-smoothing:antialiased;overflow-x:clip}'
            'img{max-width:100%%}a{color:inherit}[hidden]{display:none!important}'
            'details>summary{list-style:none;cursor:pointer}details>summary::-webkit-details-marker{display:none}'
            'details:not([open]) .e-opened{display:none!important}details[open] .e-closed{display:none!important}'
            '.lv-video{display:block;width:100%%;aspect-ratio:16/9;border:0}'
            # ashleylim.com's Elementor kit drops body text to 15px/21px on phones (measured on the live site)
            '@media (max-width:767px){body{font-size:15px;line-height:21px}}'
            ':root{--font-head:"GmarketSans","Pretendard","Noto Sans KR",sans-serif;--font-body:"Pretendard","Noto Sans KR",-apple-system,BlinkMacSystemFont,sans-serif}'
            % (meta['bodyBg'], meta['bodyColor'], meta['bodySize'], meta['bodyLH']))
    tabs_js = ('<script>document.querySelectorAll(\'[role=tab]\').forEach(function(t){t.addEventListener(\'click\',function(){'
               'var list=t.closest(\'[role=tablist]\')||t.parentElement;list.querySelectorAll(\'[role=tab]\').forEach(function(o){o.setAttribute(\'aria-selected\',o===t?\'true\':\'false\');'
               'var p=document.getElementById(o.getAttribute(\'aria-controls\'));if(p){if(o===t)p.removeAttribute(\'hidden\');else p.setAttribute(\'hidden\',\'\')}})})})</script>') \
        if '[role=tab]' in body or 'role="tab"' in body else ''
    return ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<title>%s</title>\n%s%s\n<link rel="icon" href="/favicon.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
            '<link rel="stylesheet" href="/assets/css/fonts.css">\n%s\n'
            '<style>\n/* Generated from ashleylim.com%s (captured at 1440/900/390px). Edit with care: regenerate instead. */\n%s\n%s\n%s\n</style>\n</head>\n<body>\n%s%s\n%s\n</body>\n</html>\n'
            % (html.escape(title), robots, ('<meta name="description" content="%s">' % html.escape(desc, quote=True)) if desc else '',
               fl, meta['path'].replace('/p/', '/'), base, pcss, css, banner, body, tabs_js))

for preview in MODES:
    body, css, nh = build(preview)
    localize_images(body, css)
    body = re.sub(r'@@IMG:(.*?)@@', lambda m: IMGMAP.get(m.group(1), m.group(1)), body)
    body = re.sub(r'@@DIM:(.*?)@@', lambda m: (' width="%d" height="%d"' % IMGDIM[m.group(1)]) if m.group(1) in IMGDIM else '', body)
    css = re.sub(r'url\("?(https?://[^")]+)"?\)', lambda m: 'url("%s")' % IMGMAP.get(m.group(1), m.group(1)), css)
    out = os.path.join(SITE, 'preview', slug) if preview else os.path.join(SITE, slug)
    if DEBUG: out = os.path.join(SITE, '_debug', slug)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'index.html'), 'w').write(page(body, css, preview, nh))
    print(('preview' if preview else 'public'), out, len(body) // 1024, 'KB html', len(css) // 1024, 'KB css', 'hidden marked:', nh)
print('images:', len(IMGMAP), 'public:', sum(1 for u in IMGMAP if img_public.get(u, True)), 'fonts:', sorted(fonts_used))
