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
INLINE_TAGS = {'a','span','strong','b','em','i','u','s','small','sup','sub','mark','code','label','br','img'}
BPS = ['d','t','m']
BP_LABEL = {'d':'데스크톱','t':'태블릿','m':'모바일'}
GOOGLE = {'Newsreader':'Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500',
          'Poppins':'Poppins:ital,wght@0,400;0,500;0,600;0,700;1,400',
          'Abhaya Libre':'Abhaya+Libre:wght@400;500;600;700',
          'Noto Serif KR':'Noto+Serif+KR:wght@400;500;700'}
ICON_FONTS = re.compile(r'icomoon|eicons|Font Awesome|fa-|elementor-icons', re.I)

slug = sys.argv[1]; STICKY = '--sticky-header' in sys.argv
DEBUG = '--debug' in sys.argv
NOWRAP = '--no-nowrap' not in sys.argv
MODES = [False] if '--public-only' in sys.argv else [True] if '--preview-only' in sys.argv else [False, True]
D = json.loads(open(os.path.join(HERE, 'dumps', slug + '.d.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))
T = json.loads(open(os.path.join(HERE, 'dumps', slug + '.t.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))['styles']
M = json.loads(open(os.path.join(HERE, 'dumps', slug + '.m.json')).read().replace('http://127.0.0.1:8799', 'https://ashleylim.com').replace('"/wp-content/', '"https://ashleylim.com/wp-content/').replace('(\\"/wp-content/', '(\\"https://ashleylim.com/wp-content/').replace('(/wp-content/', '(https://ashleylim.com/wp-content/'))['styles']
meta = D['meta']
# Optional second desktop pass at 1920px: tells fixed widths/paddings apart from percentage ones.
_wp = os.path.join(HERE, 'dumps', slug + '.w.json')
WD = json.loads(open(_wp).read())['styles'] if os.path.exists(_wp) else {}
_np = os.path.join(HERE, 'dumps', slug + '.n.json')   # and at 1100px (narrow desktop)
ND = json.loads(open(_np).read())['styles'] if os.path.exists(_np) else {}
# Tablet and phone ranges, captured at their other end too: 1024px (with the 900px pass) and 767px (with 390px).
def _pass(suffix):
    f = os.path.join(HERE, 'dumps', slug + suffix + '.json')
    return json.loads(open(f).read())['styles'] if os.path.exists(f) else {}
PAIR = {'t': _pass('.tw'), 'm': _pass('.mw')}
# Extra captures per breakpoint range: (lower end, upper end) around the main capture.
RANGE = {'d': (ND, WD), 't': (_pass('.tl'), PAIR['t']), 'm': ({}, PAIR['m'])}

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

# Deliberate differences from the live page (overrides.json), e.g. equal-height cards at every width.
OVR = json.load(open(os.path.join(HERE, 'overrides.json'))).get(slug, {})
def node_text(i):
    n = nodes[i]
    return ''.join(c if isinstance(c, str) else node_text(c['i']) for c in n.get('c', []))
EQUAL_GRIDS, CARD_FILL = set(), set()
CAROUSEL_TRACK, CAROUSEL_VP, BOTTOM_SPACE = set(), set(), {}
def top_section(i):
    # The page section (child of the main content root) that contains node i.
    root = D['tree'][1]['node']['i']
    while parent[i] is not None and parent[i] != root and parent[parent[i]] is not None: i = parent[i]
    x = i
    while parent[x] is not None and parent[x] != root: x = parent[x]
    return x
def apply_overrides():
  for i, n in nodes.items():  # image carousels: the slide track and its clipping viewport
      if any(isinstance(c, dict) and 'swiper-slide' in c['a'].get('cls', '') for c in n.get('c', [])):
          CAROUSEL_TRACK.add(i); CAROUSEL_VP.add(parent[i])
  for rule in OVR.get('bottom_space', []):
      hits = [i for i, n in nodes.items() if rule['after'] in ''.join(c for c in n.get('c', []) if isinstance(c, str))]
      if not hits: sys.exit('overrides.json: anchor not found on %s: %s' % (slug, rule['after']))
      BOTTOM_SPACE[top_section(hits[0])] = rule['px']
  for anchor in OVR.get('equal_height_cards', []):
      hits = [i for i, n in nodes.items() if anchor in ''.join(c for c in n.get('c', []) if isinstance(c, str))]
      if not hits: sys.exit('overrides.json: anchor not found on %s: %s' % (slug, anchor))
      x = hits[0]
      def grids_under(i):
          out = [i] if 'grid' in S('d', i).get('display', '') else []
          for c in nodes[i].get('c', []):
              if isinstance(c, dict): out += grids_under(c['i'])
          return out
      while x is not None and not grids_under(x): x = parent[x]
      for g in grids_under(x):
          EQUAL_GRIDS.add(g)
          for item in [c for c in nodes[g].get('c', []) if isinstance(c, dict)]:
              k = item
              while True:  # the card box inside the grid cell: follow single-child wrappers down
                  kids = [c for c in k.get('c', []) if isinstance(c, dict)]
                  if len(kids) != 1 or any(isinstance(c, str) and c.strip() for c in k.get('c', [])): break
                  k = kids[0]; CARD_FILL.add(k['i'])

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
    # Nothing captured up the tree: the value is the body's (15px/21px on phones, see the base CSS). Without these, browser defaults leak through
    # (bold h1-h6, underlined links), because the capture only records values that differ from the parent.
    if bp == 'm' and prop in ('font-size', 'line-height'): return {'font-size': '15px', 'line-height': '21px'}[prop]
    return {'line-height': D['meta']['bodyLH'], 'font-size': D['meta']['bodySize'], 'font-weight': '400',
            'font-style': 'normal', 'color': D['meta']['bodyColor'], 'font-family': D['meta']['bodyFont'],
            'text-decoration-line': 'none', 'letter-spacing': 'normal', 'text-transform': 'none'}.get(prop)

def in_summary(i):
    # Single-line FAQ questions that fill their row: pinned to one line, else sub-pixel font differences wrap them.
    # (Only there: elsewhere it would overflow between breakpoints.)
    p = i
    while p is not None:
        if nodes[p]['t'] == 'summary': return True
        p = parent[p]
    return False

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
            # Keep the live fallback chain (e.g. Poppins, "Noto Sans KR"): Korean characters in these Latin-only
            # fonts then fall back exactly as on the live page.
            fonts_used.add(g); return v
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
UA_INH['a'] = ('color', 'text-decoration-line')
UA_INH['mark'] = ('color',)

# Chrome's default margins, in px at the capture's 16px. The capture skips values equal to the default, but the
# defaults are em-based here, so on phones (15px body text) they'd shrink: write them out in px instead.
UA_MARGIN = {'p': 16, 'ul': 16, 'ol': 16, 'dl': 16, 'blockquote': 16, 'figure': 16,
             'h1': 21.44, 'h2': 19.92, 'h3': 18.72, 'h4': 21.28, 'h5': 22.1776, 'h6': 24.9776}

def _line(p1, w1, p2, w2):
    """Width as a straight line of the parent's width through two captures: (slope, offset), or None."""
    if abs(p2 - p1) < 2: return None
    a = (w2 - w1) / (p2 - p1)
    if a < -0.02 or a > 1.02: return None
    return max(a, 0), w1 - max(a, 0) * p1

def _css(line, extra):
    a, b = line
    if a < 0.0005: return '%gpx' % round(b + extra, 2)
    if abs(b) <= 1.5 and not extra: return '%.4f%%' % (a * 100)
    return 'calc(%.4f%% + %.2fpx)' % (a * 100, b + extra)

def desk_width(i, w, pw, extra=0, bp='d'):
    """Desktop width from the 1100 / 1440 / 1920px captures, as CSS props: fixed, a share of the parent, a mix
    (calc), or a scaling width capped where the live box stops growing (max-width) / starts (min-width).
    None when the captures don't give a usable answer (the caller then keeps the 1440px pixels)."""
    s0, s2 = RANGE[bp][0].get(str(i)), RANGE[bp][1].get(str(i))
    if not pw: return None
    up = _line(pw, w, s2['__pw'], s2['__w']) if s2 and s2.get('__w') is not None and s2.get('__pw') else None
    lo = _line(s0['__pw'], s0['__w'], pw, w) if s0 and s0.get('__w') is not None and s0.get('__pw') else None
    if up is None and lo is None: return None
    if up is None: return {'width': _css(lo, extra)}
    if lo is None: return {'width': _css(up, extra)}
    if abs(up[0] - lo[0]) < 0.01 and abs(up[1] - lo[1]) < 2: return {'width': _css(up, extra)}   # one line
    if up[0] < 0.0005 and abs(s0['__w'] - s0['__pw']) <= 1 and w < pw - 1:
        # fills its parent at the low end, fixed from here up: min(100%, Wpx) (e.g. an 800px column, centred)
        return {'width': '100%', 'max-width': 'min(100%%, %gpx)' % round(w + extra, 2)}
    if up[0] < 0.0005 and lo[0] > 0.0005:   # grows up to here, fixed above: scale, capped
        return {'width': _css(lo, extra), 'max-width': 'min(100%%, %gpx)' % round(w + extra, 2)}
    if lo[0] < 0.0005 and up[0] > 0.0005:   # fixed below, grows above
        return {'width': _css(up, extra), 'min-width': '%gpx' % round(w + extra, 2)}
    return {'width': _css(up, extra)}

def fluid(wv, pw, pdisp, pi, bp='t', i=None, w=None):
    """A captured width, written so the box keeps the live behaviour between captures.
    Desktop: from the 1440/1920 pair (fixed, % or calc). Tablet/mobile: a share of the parent's width, so
    768-1024px (900px capture) and phones scale instead of overflowing. At the capture width it's the same pixels."""
    if not pw or pw < 200 or pdisp.startswith('inline') or pdisp in ('contents', 'table-cell') or \
            (pi is not None and S('d', pi).get('position') in ('absolute', 'fixed') and not in_role(pi, 'header')):
        return '%gpx' % wv   # (the header's 'fixed' is Elementor's sticky state, dropped in our output)
    r = desk_width(i, w if w is not None else wv, pw, (wv - w) if w is not None else 0, bp) if i is not None else None
    if r: return r
    return {'width': '%gpx' % wv} if bp == 'd' else '%.4f%%' % (wv / pw * 100)

def put_width(out, key, val):
    """Apply fluid()/desk_width() output: a plain value, or a dict with width (+ max-/min-width)."""
    if isinstance(val, dict):
        out[key] = val['width']
        for k in ('max-width', 'min-width'):
            if k in val: out[k] = val[k]
    else: out[key] = val

def equal_fr_rows(i):
    """Rows of a grid whose items all share one height at desktop (Elementor's repeat(n, 1fr) rows), else 0."""
    s = S('d', i)
    if 'grid' not in s.get('display', ''): return 0
    kids = [c for c in nodes[i].get('c', []) if isinstance(c, dict) and not hid('d', c['i'])]
    hs = [S('d', c['i']).get('__h') for c in kids]
    tc = s.get('grid-template-columns', 'none')
    cols = len(tc.split()) if tc != 'none' else 1
    if len(kids) > cols and all(hs) and max(hs) - min(hs) <= 1: return -(-len(kids) // cols)
    return 0

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
    # A border style without a captured width means 0px on the live page (0 is the default, so the capture skips it);
    # left alone, the browser would draw 'medium' (3px) borders.
    for side in ('top', 'right', 'bottom', 'left'):
        if out.get('border-%s-style' % side, 'none') not in ('none', 'hidden') and 'border-%s-width' % side not in out:
            out['border-%s-width' % side] = '0px'
    for prop in UA_INH.get(n['t'], ()):
        if prop not in out:
            v = eff(bp, i, prop)
            if v:
                if prop == 'font-family':
                    v = map_font(v)
                    if not v: continue
                out[prop] = v
    if n['t'] in UA_MARGIN:
        for side in ('margin-top', 'margin-bottom'):
            if side not in out: out[side] = '%gpx' % UA_MARGIN[n['t']]
    # Side paddings that scale with the page on the live site (e.g. the header's 8%): proportional to the parent's
    # width at both 1440px and 1920px -> write them as percentages.
    s0, s2 = RANGE[bp][0].get(str(i)), RANGE[bp][1].get(str(i))
    if s2 and s.get('__pw') and s2.get('__pw') and abs(s2['__pw'] - s['__pw']) >= 2 and \
            all(abs((px(s0.get(k, '0px')) or 0) / s0['__pw'] - (px(s.get(k, '0px')) or 0) / s['__pw']) < 0.001
                for k in ('padding-left', 'padding-right')) if s0 and s0.get('__pw') else s2 and s.get('__pw') and s2.get('__pw') and abs(s2['__pw'] - s['__pw']) >= 2:
        for k in ('padding-left', 'padding-right'):
            v1, v2 = px(s.get(k, '0px')) or 0, px(s2.get(k, '0px')) or 0
            if v1 > 0 and abs(v2 - v1) > 0.5 and abs(v1 / s['__pw'] - v2 / s2['__pw']) < 0.001:
                out[k] = '%.4f%%' % (v1 / s['__pw'] * 100)
    # ----- layout -----
    w, pw = s.get('__w'), s.get('__pw')
    disp = s.get('display', '')
    pi = parent[i]; pd = S(bp, pi) if pi is not None else {}
    pdisp, pdir = s.get('__pdisp', ''), s.get('__pdir', 'row')
    if n['t'] in IMGLIKE and w:
        h = s.get('__h')
        ptag = nodes[pi]['t'] if pi is not None else ''
        if pw and abs(w - pw) <= 1 and ptag not in ('picture', 'a', 'span', 'figure'): out['width'] = '100%'
        else: out['max-width'] = '100%'; put_width(out, 'width', desk_width(i, w, pw, 0, bp) or '%gpx' % w)
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
                        for c in n.get('c', [])) \
            and any(isinstance(c, dict) or c.strip() for c in n.get('c', []))  # empty boxes (bar fills) aren't text
        single_line = only_text and h is not None and h <= lh * 1.45
        if 'flex' in pdisp and pdir.startswith('row'):
            if pw and abs(w - pw) <= 1 and not inline and s.get('flex-grow', '0') == '0' and not only_text:
                out['width'] = '100%'  # full-width row item: in a centred row it would otherwise shrink to its content
            if pw and w < pw - 1 and not inline:
                if s.get('flex-grow', '0') in ('0',):
                    if not single_line:
                        fw = fluid((int(w) + 3) if only_text else w, pw, pdisp, pi, bp, i, w)
                        fv = fw['width'] if isinstance(fw, dict) else fw
                        # Text in a row (e.g. a checklist line next to its icon): on the live page it's sized by its
                        # own text, wrapping only when it must. Keep that unless the live width is fixed.
                        if not (only_text and not re.fullmatch(r'[\d.]+px', fv) and bp != 'd'):
                            put_width(out, 'width', fw)
                else:
                    if s.get('flex-basis', 'auto') in ('auto', ''):   # keep a live basis such as 'content'
                        put_width(out, 'flex-basis', fluid(w, pw, pdisp, pi, bp, i, w))
            # Items that don't fill the row's height must have had an explicit height (stretch is the default).
            if h and pd.get('align-items', 'normal') in ('normal', 'stretch') and pd.get('flex-wrap', 'nowrap') == 'nowrap' \
                    and s.get('align-self', 'auto') in ('auto', 'normal', 'stretch'):
                ph = S(bp, pi).get('__h') if pi is not None else None
                if ph:
                    pad = sum(px(pd.get(k, '0')) or 0 for k in ('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'))
                    if h < ph - pad - 1.5: out['height'] = '%gpx' % h
        elif 'grid' in pdisp:
            # Grid items centred / end-aligned in their cell (justify-self/-items isn't captured): use the offsets.
            # Offsets are measured from the grid's edges, so work out the item's own column (cell) first.
            gl, gr = s.get('__ml'), s.get('__mr')
            tracks = pd.get('grid-template-columns', 'none')
            ncol = len(tracks.split()) if tracks not in ('none', '') else 1
            gap = px(pd.get('column-gap', '0')) or 0
            if gl is not None and gr is not None and w and pw and ncol >= 1:
                cell = (pw - gap * (ncol - 1)) / ncol
                col = max(0, min(ncol - 1, int((gl + 1) // (cell + gap)))) if cell > 0 else 0
                lm = gl - col * (cell + gap); rm = cell - w - lm
                if w < cell - 1:
                    if lm > 1 and abs(lm - rm) <= 1.5: out['justify-self'] = 'center'
                    elif lm > 1 and rm <= 1: out['justify-self'] = 'end'
        elif 'flex' in pdisp and pw and abs(w - pw) <= 1 and not inline and not only_text and \
                (pd.get('align-items', 'normal') not in ('normal', 'stretch') or s.get('align-self', 'auto') not in ('auto', 'normal', 'stretch')):
            out['width'] = '100%'  # full-width box in a centred / start-aligned column: it won't stretch by itself
        elif pw and abs(w + (px(s.get('margin-left', '0')) or 0) + (px(s.get('margin-right', '0')) or 0) - pw) <= 1 \
                and 'flex' not in pdisp and not inline:
            pass  # a block that fills its parent apart from its margins (e.g. an indented list): auto width does that
        elif pw and abs(w - pw) > 1 and not inline and not single_line:
            # In a flex column, only stretched items can have had an explicit width; centred / start-aligned
            # items are sized by their own text, and pinning that width makes sub-pixel differences wrap.
            stretch = pd.get('align-items', 'normal') in ('normal', 'stretch') and \
                s.get('align-self', 'auto') in ('auto', 'normal', 'stretch')
            has_br = any(isinstance(c, dict) and c['t'] == 'br' for c in n.get('c', []))
            # Shrink-to-fit text only stays narrower than its parent when a <br> sets the line length.
            text_fit = only_text and has_br
            if 'flex' not in pdisp or stretch or not text_fit:
                out['max-width'] = '100%'; put_width(out, 'width', fluid((int(w) + 3) if only_text else w, pw, pdisp, pi, bp, i, w))
        # Single-line text that fills (almost) all of its room on the live page: keep it on one line here too.
        if NOWRAP and single_line and only_text and pw and w >= pw * 0.9 and not n['a'].get('href'):
            if in_summary(i): out['white-space'] = 'nowrap'
            elif disp in ('block', 'flow-root', '') and n['t'] not in INLINE_TAGS and (px(out.get('margin-left', '0')) or 0) == 0 \
                    and (px(out.get('margin-right', '0')) or 0) == 0 and 'width' not in out \
                    and pi is not None and S(bp, pi).get('__w') and S(bp, pi).get('__pw') \
                    and S(bp, pi)['__w'] + (px(S(bp, pi).get('margin-left', '0')) or 0) + (px(S(bp, pi).get('margin-right', '0')) or 0) \
                        < S(bp, pi)['__pw'] - 1:  # only inside a box sized to its content (not just indented)
                # A line that fills its row: 3px of slack so sub-pixel font differences don't wrap it at the
                # capture width, while it can still wrap on narrower screens (nowrap would overflow there).
                ta = eff(bp, i, 'text-align') or 'start'
                if ta == 'center': out['margin-left'] = out['margin-right'] = '-1.5px'
                elif ta in ('right', 'end'): out['margin-left'] = '-3px'
                else: out['margin-right'] = '-3px'
        mw = s.get('__maxw', 'none')
        if mw not in ('none', '') and n['t'] != 'svg': out['max-width'] = mw
        has_text = any(isinstance(c, str) and c.strip() for c in n.get('c', []))
        if disp == 'inline-block' and pw and abs(w - pw) <= 1 and 'width' not in out and n['t'] not in IMGLIKE:
            out['width'] = '100%'   # full-width buttons (live: width 100%); shrink-to-fit would centre a narrow one
        if inline and disp != 'inline' and not has_text and h and n.get('c') and not node_text(i).strip():
            out['width'] = '%gpx' % w; out['height'] = '%gpx' % h  # icon-only inline boxes (e.g. social icons)
        ml, mr = px(s.get('margin-left', '0')), px(s.get('margin-right', '0'))
        if ml and mr and ml > 0 and abs(ml - mr) <= 1 and pw and abs((pw - w) / 2 - ml) <= 1.5 \
                and ('width' in out or 'max-width' in out):  # negative margins are real offsets; auto needs a width
            out['margin-left'] = out['margin-right'] = 'auto'
        mh = s.get('__minh', '0px')
        if mh not in ('0px', 'auto', ''): out['min-height'] = mh
        txt = ''.join(c for c in n.get('c', []) if isinstance(c, str)).strip()
        if only_text and txt and len(txt) <= 4 and h and not inline:
            vpad = sum(px(s.get(k, '0')) or 0 for k in ('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'))
            if abs(h - (lh + vpad)) > 1: out['height'] = '%gpx' % h  # fixed-size badges ("1", "#1"), taller or shorter than a line
            hpad = sum(px(s.get(k, '0')) or 0 for k in ('padding-left', 'padding-right', 'border-left-width', 'border-right-width'))
            small = w and pw and (w < pw - 1 or w <= 60)   # a badge, not a full-width line of short text ("01")
            if small and w > len(txt) * fs * 0.7 + hpad + 6 and 'flex' in pdisp: out['width'] = '%gpx' % w; out['flex-shrink'] = '0'
            elif small and w <= 60 and 'width' not in out:
                out['width'] = '%gpx' % w; out['flex-shrink'] = '0'
                if 'height' not in out and h: out['height'] = '%gpx' % h
        has_kids = any(isinstance(c, dict) or (isinstance(c, str) and c.strip()) for c in n.get('c', []))
        if h and not has_kids and n['t'] not in VOID:
            out['height' if 'background-image' not in out else 'min-height'] = '%gpx' % h
            if P(bp, i) and w and out.get('width') in (None, '100%'):
                out['width'] = '%gpx' % w   # icon-font glyph boxes (::before): our fallback glyph has another width
    # Equal-height grids: Elementor grids use 1fr rows, so every row is as tall as the tallest item. The capture
    # only has the resulting pixel heights, so when all items share one height, make the rows equal again.
    if 'grid' in disp:
        kids = [c for c in n.get('c', []) if isinstance(c, dict) and not hid(bp, c['i'])]
        hs = [S(bp, c['i']).get('__h') for c in kids]
        cols = len(s.get('grid-template-columns', 'none').split()) if s.get('grid-template-columns', 'none') != 'none' else 1
        fr_rows = equal_fr_rows(i)
        if fr_rows:
            # The explicit row count is set once (desktop) and usually kept at every width: on a one-column phone
            # layout only the first rows are equalised, the rest size to their content. Apply it at this width only
            # if the captured row heights show it (a page can override the rows per breakpoint).
            row_h = [max(hs[k:k + cols]) for k in range(0, len(hs), cols)] if all(hs) else []
            first = row_h[:fr_rows]
            out['grid-template-rows'] = 'repeat(%d, 1fr)' % fr_rows if first and max(first) - min(first) <= 1 else 'none'
        elif kids and all(hs) and s.get('__h'):
            # fr rows with top-aligned items leave the grid taller than its rows of content: keep the live height.
            rows = [max(hs[k:k + cols]) for k in range(0, len(hs), cols)]
            gap = px(s.get('row-gap', '0')) or 0
            box = sum(px(s.get(k_, '0')) or 0 for k_ in ('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'))
            if s['__h'] > sum(rows) + gap * (len(rows) - 1) + box + 1: out['min-height'] = '%gpx' % s['__h']
    # ...and a grid item's single box that fills the whole cell on the live page (cards) fills it here too.
    if pi is not None and 'grid' in S(bp, pi).get('__pdisp', '') and w is not None and n['t'] not in IMGLIKE and not disp.startswith('inline'):
        ph_ = S(bp, pi).get('__h'); h_ = s.get('__h')
        sibs = [c for c in nodes[pi].get('c', []) if isinstance(c, dict)]
        if ph_ and h_ and len(sibs) == 1 and abs(ph_ - h_) <= 1: out['height'] = '100%'
    # A box that fills its parent here but is capped at the top of this width range on the live page
    # (e.g. 1000px content, centred, at 1024px): give it that max-width, and auto margins if it's centred.
    if w is not None and pw and abs(w - pw) <= 1 and not disp.startswith('inline') and out.get('width', '100%') == '100%' \
            and n['t'] not in IMGLIKE:
        s2 = RANGE[bp][1].get(str(i))
        if s2 and s2.get('__w') and s2.get('__pw') and s2['__w'] < s2['__pw'] - 1:
            if out.get('max-width', '100%') in ('100%', 'none'): out['max-width'] = 'min(100%%, %gpx)' % s2['__w']
            ml2, mr2 = s2.get('__ml') or 0, s2.get('__mr') or 0
            if ml2 > 1 and abs(ml2 - mr2) <= 1.5: out['margin-left'] = out['margin-right'] = 'auto'
            elif ml2 > 1 and mr2 <= 1: out['margin-left'] = 'auto'
    if i in EQUAL_GRIDS: out['grid-template-rows'] = 'none'; out['grid-auto-rows'] = '1fr'; out['align-items'] = 'stretch'
    if i in CARD_FILL: out['height'] = '100%'
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
    if STICKY and n['i'] == D['tree'][0]['node']['i']:
        # Sticky on every device (as live: sticky_on desktop/tablet/mobile), with the /nsmb header's 1px rule.
        # The -1px margin keeps the page from shifting by the rule's pixel.
        out.update({'position': 'sticky', 'top': '0', 'z-index': '100'})
        bar = next((c for c in n.get('c', []) if isinstance(c, dict)), None)
        if not (bar and (px(S(bp, bar['i']).get('border-bottom-width', '0')) or 0) >= 1):   # live bar has no rule of its own
            out.update({'border-bottom': '1px solid rgb(215, 215, 215)', 'margin-bottom': '-1px'})
    if i in CAROUSEL_TRACK: out.pop('transform', None)  # lv-carousel.js positions the slides
    if i in BOTTOM_SPACE: out['padding-bottom'] = '%dpx' % BOTTOM_SPACE[i][{'d': 0, 't': 1, 'm': 2}[bp]]
    return out

def pdecls(i, bp, preview):
    p = P(bp, i) if not (hid(bp, i) and preview) else (P('d', i) or P('t', i) or P('m', i))
    if not p: return {}
    res = {}
    # Divider lines on both sides of a label in a flex row ("—— 해외 거주자 ——"): on the live page they share
    # the free space; captured as fixed pixels they'd only centre the label at the capture width.
    node_s0 = S(bp, i) if not hid(bp, i) else {}
    split = 'flex' in node_s0.get('display', '') and not node_s0.get('flex-direction', 'row').startswith('column') and \
        all(ps in p and p[ps].get('content') in ('""', "''") and p[ps].get('position', 'static') == 'static' for ps in ('::before', '::after'))
    for ps, st in p.items():
        o = {}
        if split and ps in ('::before', '::after'):
            st = {k: v for k, v in st.items() if k != 'width'}; o['flex'] = '1 1 0'
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
                  'value', 'for', 'title', 'open', 'required', 'checked', 'selected', 'start', 'reversed'):
            if k in a and not (t == 'iframe' and k == 'title'): out.append((k, a[k]))
        if t == 'a' and a.get('href'):
            out.append(('href', a['href']))
            if a.get('target'): out.append(('target', a['target'])); out.append(('rel', 'noopener'))
        if t == 'form': out.append(('action', '#'))
        if is_panel(n['i']) and S('d', n['i']).get('__hidden'): out.append(('hidden', ''))
        if DEBUG: out.append(('data-c', n['i']))
        s = ''.join(' %s="%s"' % (k, html.escape(str(v), quote=True)) if v != '' else ' %s' % k for k, v in out)
        return s + extra

    INLINE_KEEP = {'strong': 'strong', 'b': 'strong', 'em': 'em', 'i': 'em', 'u': 'u', 'br': 'br', 'a': 'a', 'span': None, 'mark': None}
    def inline_html(n):
        out = []
        for c in n.get('c', []):
            if isinstance(c, str): out.append(html.escape(c)); continue
            if not preview and not public_visible(c['i']): continue
            t = INLINE_KEEP.get(c['t'], None) if c['t'] in INLINE_KEEP else 'BLOCK'
            if c['t'] == 'br': out.append('<br>')
            elif t == 'a':
                href = c['a'].get('href', '')
                out.append('<a href="%s"%s>%s</a>' % (html.escape(href, quote=True),
                           ' target="_blank" rel="noopener"' if c['a'].get('target') else '', inline_html(c)))
            elif t in ('strong', 'em', 'u'): out.append('<%s>%s</%s>' % (t, inline_html(c), t))
            else: out.append(inline_html(c))
        return ''.join(out)
    def answer_html(n):
        # Paragraphs of the live answer, without the live styling (the /nsmb FAQ style applies).
        kids = [c for c in n.get('c', []) if isinstance(c, dict) and (preview or public_visible(c['i']))]
        has_text = any(isinstance(c, str) and c.strip() for c in n.get('c', []))
        if n['t'] in ('ul', 'ol'):
            return '<%s>%s</%s>' % (n['t'], ''.join('<li>%s</li>' % inline_html(li) for li in kids), n['t'])
        if has_text or (kids and all(c['t'] in INLINE_KEEP for c in kids)):
            return '<p>%s</p>' % inline_html(n).strip()
        return ''.join(answer_html(c) for c in kids)
    def faq_item(n, flag):
        summ = next(c for c in n['c'] if isinstance(c, dict) and c['t'] == 'summary')
        q = re.sub(r'\s+', ' ', node_text(summ['i'])).strip()
        body = ''.join(answer_html(c) for c in n['c'] if isinstance(c, dict) and c is not summ)
        return '<details%s%s><summary>%s<span class="pm" aria-hidden="true"></span></summary><div class="ans">%s</div></details>' % (
            ' open' if 'open' in n['a'] else '', flag, html.escape(q), body)

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
        if t == 'details': return faq_item(n, (' class="lv-hidden"' + flag) if mark else '')
        if i in CAROUSEL_TRACK: cls += ' lv-track'
        if i in CAROUSEL_VP: cls += ' lv-viewport'
        if 'swiper-slide' in n['a'].get('cls', ''): cls += ' lv-slide'
        if n['a'].get('settings') and 'carousel' in n['a'].get('wt', ''):
            flag += ' data-lv-carousel="%s"' % html.escape(n['a']['settings'], quote=True)
        if any(isinstance(c, dict) and c['t'] == 'details' for c in n.get('c', [])): cls += ' faq faq--gen'
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
        if r['role'] == 'footer':
            parts.append(SITE_FOOTER)  # every page shares the home page's footer (styles: footer.css)
            continue
        h = render(r['node'])
        if r['role'] in ('wp-page', 'wp-post', 'main'): h = '<main id="main">' + h + '</main>'
        parts.append(h)
    body = '\n'.join(parts)

    tab_css = []
    VIS = ('border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-width',
           'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style',
           'border-bottom-style', 'border-left-style', 'background-color', 'color', 'box-shadow')
    for i, n in nodes.items():
        if n['a'].get('role') != 'tablist' or (not preview and not public_visible(i)): continue
        tabs = [c for c in n.get('c', []) if isinstance(c, dict) and c['a'].get('role') == 'tab']
        on = [t for t in tabs if t['a'].get('aria-selected') == 'true']; off = [t for t in tabs if t['a'].get('aria-selected') != 'true']
        if not on or not off: continue
        tl = cls_for(i).split()[0]
        for bp in BPS:
            dn, df = decls(on[0]['i'], bp, preview), decls(off[0]['i'], bp, preview)
            keys = [k for k in VIS if dn.get(k) != df.get(k)]
            if not keys: continue
            rules = ('.%s>[role=tab][aria-selected="true"]{%s}' % (tl, ';'.join('%s:%s' % (k, dn[k]) for k in keys if k in dn)) +
                     '.%s>[role=tab][aria-selected="false"]{%s}' % (tl, ';'.join('%s:%s' % (k, df[k]) for k in keys if k in df)))
            tab_css.append(rules if bp == 'd' else '@media (max-width:%s){%s}' % ('1024px' if bp == 't' else '767px', rules))
        hov = OVR.get('tab_hover')
        if hov:
            tab_css.append('.%s>[role=tab]{transition:border-color .3s,background-color .3s,color .3s;cursor:pointer}' % tl)
            tab_css.append('@media (hover:hover){.%s>[role=tab][aria-selected="false"]:hover{%s}}' % (tl, ';'.join('%s:%s' % kv for kv in hov.items())))

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
    if tab_css: css += '\n/* tab states (selected / not selected / hover) */\n' + '\n'.join(tab_css)
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

# The site-wide footer, taken verbatim from the home page so there is one source of truth.
SITE_FOOTER = re.search(r'<footer class="site-footer">.*?</footer>', open(os.path.join(SITE, 'index.html')).read(), re.S).group(0)

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
            '<link rel="stylesheet" href="/assets/css/fonts.css">\n<link rel="stylesheet" href="/assets/css/footer.css">\n%s%s\n'
            '<style>\n/* Generated from ashleylim.com%s (captured at 1440/900/390px). Edit with care: regenerate instead. */\n%s\n%s\n%s\n</style>\n</head>\n<body>\n%s%s\n%s\n</body>\n</html>\n'
            % (html.escape(title), robots, ('<meta name="description" content="%s">' % html.escape(desc, quote=True)) if desc else '',
               ('<link rel="stylesheet" href="/assets/css/faq.css">\n' if '<details' in body else '') +
               ('<link rel="stylesheet" href="/assets/css/lv-carousel.css">\n<script src="/assets/js/lv-carousel.js" defer></script>\n'
                if 'data-lv-carousel' in body else ''), fl,
               meta['path'].replace('/p/', '/'), base, pcss, css, banner, body, tabs_js))

apply_overrides()
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
