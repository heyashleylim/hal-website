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
3. Set the viewport to 900px, **reload** `/p/<slug>`, load `/cap.js` again → `await __C.capturePassFresh('<slug>.t', N)`;
   same at 390px → `await __C.capturePassFresh('<slug>.m', N)`. `N` is `meta.n` of `dumps/<slug>.d.json` (element count);
   a page that loaded differently is refused instead of saved. (Don't just resize a loaded page: it can keep stale
   styles, e.g. desktop button padding.)
4. `python3 tools/rebuild/gen.py <slug>` — add `--sticky-header` only for pages whose live header is sticky
   (currently `eft`, `chosen` and the `nsmb` preview; `switch`, `lifeartist2026` and the policy pages scroll it away).
   Add `--public-only` or `--preview-only` when needed (policy pages: `--public-only`);
   `--debug` writes an element-tagged copy to `site/_debug/` for comparing against the capture).
5. Check the page at 1440 / 900 / 390px, then commit.

Notes
- FAQs aren't copied as-is: each `<details>` accordion is rebuilt in the /nsmb style (`/assets/css/faq.css`),
  with the live question and answer text.
- `overrides.json` holds deliberate differences from the live page, per slug (e.g. `equal_height_cards`:
  card grids under a given heading get equal-height cards at every width). The anchor text must exist on the page.
- Image carousels (Elementor image-carousel, e.g. /switch) are rebuilt for `/assets/js/lv-carousel.js` +
  `/assets/css/lv-carousel.css`, using the widget's captured settings (autoplay timing, slides per view, loop, arrows/dots).
- Tab lists (e.g. the /lifeartist2026 plan picker) get selected / not-selected styles from the capture; hover styles
  can't be captured, so they come from `overrides.json` (`tab_hover`).
- Ordered lists keep their `start` numbers.
- The footer isn't captured: every generated page gets the home page's `<footer class="site-footer">` (from
  `site/index.html`) and `/assets/css/footer.css`, so all pages share one footer. Regenerate after changing it.
- Checking a rebuild: compare against the live page at 1440 / 900 / 390px (section heights, and every text's
  font, weight, size, colour and underline), and check 375 / 768 / 1024px for content sticking out.
- Why some generated rules exist (each fixed a measured difference from the live site):
  - values the capture skips because they equal the parent's fall back to the live body's (weight 400, no
    underline, 15px/21px on phones), so browser defaults (bold headings, underlined links) don't leak in;
  - default paragraph/heading margins are written in px (the browser's 1em would shrink on phones);
  - grids whose items share one height get `repeat(n, 1fr)` rows, applied per width only where the capture shows it;
  - widths are written as a share of the parent so they scale between captures (e.g. 768-1024px);
  - lines that fill their row get 3px of slack (FAQ questions: no-wrap) against sub-pixel font differences.
- `collector.py` keeps visible "https://ashleylim.com" text intact (only URLs in attributes/CSS are rewritten).
- Elements hidden on the live page at every width are left out of the public page and shown, outlined, in the preview.
- Images download to `site/assets/img/<slug>/` (public) or `site/preview/<slug>/img/` (only used by hidden elements).
- `dumps/`, `imgcache/` and `proxycache/` are local working files (git-ignored).
- If new copy uses Hangul syllables outside the font subset, re-subset `site/assets/fonts/` from `_originals/fonts/`.
