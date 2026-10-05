# Rebuilding pages from ashleylim.com

These tools recreate a live ashleylim.com (Elementor) page as a static page in `site/`,
at the same layout for desktop (1440px), tablet (900px) and mobile (390px).

| File | What it does |
|------|--------------|
| `collector.py` | Local helper on `http://127.0.0.1:8799`. Serves a live page same-origin (`/p/<path>`) so its fonts and scripts load, serves `cap.js`, and saves captures to `dumps/`. |
| `cap.js` | Runs inside the live page: records every element's structure, text, attributes and computed styles. |
| `gen.py` | Turns the three captures into `site/<slug>/index.html` (public) and `site/preview/<slug>/index.html` (private, hidden elements shown and outlined). |

## Steps (with Claude Code's Browser pane)

1. `python3 tools/rebuild/collector.py` (leave it running).
2. Open `http://127.0.0.1:8799/p/<slug>` at 1440px wide, load the script and capture:
   `s=document.createElement('script');s.src='/cap.js';document.head.appendChild(s)` then `await __C.capture('<slug>.d')`.
3. Resize to 900px → `await __C.capturePass('<slug>.t')`; resize to 390px → `await __C.capturePass('<slug>.m')`.
4. `python3 tools/rebuild/gen.py <slug> --sticky-header` (add `--public-only` or `--preview-only` when needed;
   `--debug` writes an element-tagged copy to `site/_debug/` for comparing against the capture).
5. Check the page at 1440 / 900 / 390px, then commit.

Notes
- Elements hidden on the live page at every width are left out of the public page and shown, outlined, in the preview.
- Images download to `site/assets/img/<slug>/` (public) or `site/preview/<slug>/img/` (only used by hidden elements).
- `dumps/`, `imgcache/` and `proxycache/` are local working files (git-ignored).
- If new copy uses Hangul syllables outside the font subset, re-subset `site/assets/fonts/` from `_originals/fonts/`.
