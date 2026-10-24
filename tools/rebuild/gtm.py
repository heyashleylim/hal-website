"""
Google Tag Manager (container GTM-MK4FNWNV) and Vercel Web Analytics on every public page; never on /preview pages.
Vercel Web Analytics: window.va queue + /_vercel/insights/script.js (served by Vercel once Analytics is enabled in the
project), right before </head>. Locally the script 404s, which is harmless.
The head script goes right after <meta charset>, the <noscript> fallback right after <body>.

gen.py adds it to generated pages; run it directly for the hand-built pages (it skips pages that already have it):
  python3 tools/rebuild/gtm.py site/index.html site/nsmb/index.html …
"""
import re, sys

GTM_ID = 'GTM-MK4FNWNV'
HEAD = ("<!-- Google Tag Manager -->\n"
        "<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n"
        "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n"
        "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n"
        "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n"
        "})(window,document,'script','dataLayer','%s');</script>\n"
        "<!-- End Google Tag Manager -->\n") % GTM_ID
BODY = ('<!-- Google Tag Manager (noscript) -->\n'
        '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=%s"\n'
        'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
        '<!-- End Google Tag Manager (noscript) -->\n') % GTM_ID


VA = ('<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>\n'
      '<script defer src="/_vercel/insights/script.js"></script>\n')


def add_vercel_analytics(html):
    if '/_vercel/insights/script.js' in html: return html
    return html.replace('</head>', VA + '</head>', 1)


def add_gtm(html):
    if 'googletagmanager.com/gtm.js' in html: return html
    html = re.sub(r'(<meta charset="[^"]*">\n?)', lambda m: m.group(1) + ('' if m.group(1).endswith('\n') else '\n') + HEAD, html, count=1)
    html = re.sub(r'(<body[^>]*>\n?)', lambda m: m.group(1) + ('' if m.group(1).endswith('\n') else '\n') + BODY, html, count=1)
    return html


if __name__ == '__main__':
    for f in sys.argv[1:]:
        if '/preview/' in f: print('skipped (preview)', f); continue
        s = open(f).read(); n = add_vercel_analytics(add_gtm(s))
        if n != s: open(f, 'w').write(n); print('added', f)
