# HAL website — Ashley Lim

Marketing site for Ashley Lim (애슐리 림) and her programs, starting with 내성만방 (NSMB).
Korean-first copy, long-form sales pages, deployed on Vercel from GitHub.

- Repo: https://github.com/heyashleylim/hal-website (`main` = production)
- Hosting: Vercel. Push to `main` → production deploy. Any other branch → preview URL.
- Stack: static HTML + CSS + vanilla JS. No framework, no build step, no npm.
  Do not introduce one without asking first.

## Folder structure

```
hal-website/
├── CLAUDE.md              ← this file
├── README.md              ← human quick-start (preview, deploy)
├── vercel.json            ← outputDirectory: "site", clean URLs, cache headers
├── api/waitlist.js        ← Vercel function: NSMB waitlist → ActiveCampaign (tag + Master Contact List)
├── middleware.js          ← password-protects /preview/* (login page + cookie: PREVIEW_USER / PREVIEW_PASSWORD)
├── tools/rebuild/         ← capture + generator that recreates live ashleylim.com pages (see its README)
├── .env.example           ← names of the env vars the function needs (values live in Vercel only)
├── .gitignore
├── .claude/
│   ├── launch.json        ← local preview server ("site", port 8791)
│   ├── settings.json      ← shared project settings (committed, when needed)
│   └── skills/            ← optional: project copies of skills, so they travel with the repo
├── docs/                  ← NOT deployed
│   ├── DESIGN.md          ← web design system
│   ├── FRAME.md           ← video/frame companion (reels, thumbnails), not for web pages
│   ├── content/nsmb.md    ← source copy per page, verbatim from Ashley's live pages
│   └── decisions.md       ← short log of design/content decisions and why
├── _originals/            ← git-ignored: unoptimized source images and unused downloads
└── site/                  ← the ONLY folder Vercel serves
    ├── index.html         ← / — rebuild of the ashleylim.com home (link-in-bio: profile + program cards)
    ├── engine/index.html  ← /engine — ENGINE-style NSMB page (ENGINE palette, its own CSS/JS)
    ├── nsmb/index.html    ← /nsmb — rebuild of ashleylim.com/nsmb in Ashley's design system (hand-built, customised)
    ├── lifeartist2026/, eft/, chosen/, switch/          ← generated from the live pages (tools/rebuild)
    ├── terms-and-conditions/, refund-policy/, privacy-policy/  ← generated from the live pages
    ├── preview/<page>/    ← PRIVATE copies incl. elements hidden on the live site (password + noindex)
    ├── robots.txt         ← disallows /preview/
    ├── <page>/index.html  ← each new page gets a folder → clean URL /<page>
    ├── favicon.png, apple-touch-icon.png
    ├── og/                ← social share images (1200×630 JPEG)
    └── assets/
        ├── css/
        │   ├── brand.css       ← Ashley's design system (DESIGN.md): tokens, base, buttons, header
        │   ├── footer.css      ← the site footer, shared by EVERY page (self-contained: own tokens, font, resets)
        │   ├── faq.css         ← the FAQ accordion (the /nsmb style), shared by every page with a FAQ
        │   ├── lv-carousel.css ← arrows/dots for rebuilt image carousels (with js/lv-carousel.js)
        │   ├── pages/nsmb.css  ← /nsmb section layouts
        │   ├── tokens.css      ← ENGINE palette variables (/engine only)
        │   ├── base.css        ← /engine: reset, typography, layout, reveal
        │   └── components.css  ← /engine: components + responsive
        ├── js/main.js          ← /engine: enrollment state, countdown, reveal, lite-YouTube, forms
        ├── js/nsmb.js          ← /nsmb: progress bars, lite-YouTube, waitlist form
        ├── js/lv-carousel.js   ← generated pages: image carousel (autoplay, loop, arrows, dots), no dependencies
        ├── css/fonts.css       ← @font-face for every page (link before page CSS)
        ├── fonts/              ← subset woff2: gmarket-sans-300/500/700, pretendard-400/500/600/700
        └── img/
            ├── shared/         ← logo, Ashley portraits
            ├── home/           ← homepage avatar and program images
            └── nsmb/           ← page-specific images (message-NN, review-*, yt-*)
```
Rules for the structure:
- Anything in `site/` is public. Docs, drafts, source files and notes never go there.
- One page = one folder with an `index.html`. Shared code lives in `site/assets/`, never copied per page.
- Page-specific CSS stays in a `<style>` block in that page only while it is small. Once two pages need it, move it to `components.css`.
- Asset paths are root-relative (`/assets/img/...`) so they work from any page folder.
- Filenames: lowercase, kebab-case, ASCII only (`nsmb-review-cho.webp`, not `내성만방-review-CHO-Small.png`). Korean filenames break URLs and caching.

## Source of truth (in this order)

1. **Ashley's copy** (`docs/content/`, or the live page it came from). Words, prices, dates and testimonials are hers.
2. **`docs/DESIGN.md`**: colors, type, spacing, components for the web. Tokens in `site/assets/css/tokens.css` must match it.
3. **Skills**: they advise. When a skill and DESIGN.md disagree, DESIGN.md wins. Flag the conflict instead of silently choosing.

`FRAME.md` is for video frames (1920×1080, 1080×1920, 1080×1080). Use it for reels, covers and thumbnails, not for page layout.

## Skills: when to use which

- **frontend-design**: new pages or sections, and any time the aesthetic direction is open. Use it to make choices that feel intentional, then express them through DESIGN.md tokens.
- **ui-ux-pro-max**: focused checks and fixes, such as accessibility, contrast, touch targets, forms, responsive layout, motion and the pre-delivery checklist. Query one concern at a time (`--domain ux`, `--stack html-tailwind` for HTML/CSS patterns). Do not let `--design-system` replace DESIGN.md.
- **ashley-lim-voice / ashley-lim-market**: any new or edited Korean copy, testimonial selection, persona or offer questions.
- **ashley-lim-design**: quick reference for Ashley's brand tokens. If it differs from DESIGN.md, ask.

## Content rules (non-negotiable)

- Never invent testimonials, numbers, results, prices, deadlines, guarantees or names. Use only what Ashley has published or provided.
- Keep testimonial text verbatim, including emoji and informal spelling. Anonymized names stay anonymized (`김00`).
- If source copy contradicts itself (for example "7일 환불 보장" vs "14일 전액 환불 보장"), keep it and flag it. Don't fix it silently.
- Structural labels (eyebrows, section tags) may be added for design, but list them in the change summary.
- Legal/business footer details (사업자등록번호, 통신판매업신고, address) must match the live ashleylim.com footer exactly.

## Code conventions

- **Tokens only**: components use CSS variables (`var(--accent)`), never raw hex.
- **"Accent color" = Vermilion `#DB4A2B`** (`--accent`, hover `--accent-hover` `#F16344`). Whenever the accent color is mentioned, use this — never the dusty rose `--rose` `#C37568` or the ENGINE red `#bd1b1b`.
- **Korean typography**: `word-break: keep-all`; body line-height ≥ 1.6; no positive letter-spacing on Hangul (Latin-only labels may track out); never fake-italicize Korean (`font-synthesis: none` on `em`).
- **Fonts**: pages in Ashley's style use the self-hosted subsets in `site/assets/fonts/` via `brand.css` (KS X 1001 Hangul + Latin + symbols; full originals live in `_originals/fonts/`). If new copy uses a rare Hangul syllable outside that set, re-run the subset with the extra characters. `/engine` still loads its ENGINE fonts from Google Fonts / Fontshare / jsDelivr.
- **Images**: WebP (JPEG fallback only if needed), explicit `width`/`height`, `loading="lazy"` below the fold, `fetchpriority="high"` on the hero only. Max ~300 KB each, ~2000px on the long edge.
- **Video**: lite-YouTube pattern (thumbnail + play button, iframe on click, `youtube-nocookie.com`). No autoplaying embeds.
- **JS**: vanilla, progressive enhancement. The page must read correctly with JS off (reveals default to visible).
- **Motion**: transform/opacity only, and respect `prefers-reduced-motion`.
- **Accessibility**: one `h1` per page, sequential headings, visible focus rings, labels on every input, 44px touch targets, text contrast ≥ 4.5:1, skip link.
- **Responsive**: check 375px, 768px, 1024px and 1440px. There must be no horizontal scroll at 375px.
- **Third parties**: no new trackers, pixels, chat widgets or CDNs without asking. Fonts may come from Google Fonts or jsDelivr only until self-hosted.

## Generated pages and private previews

- `/lifeartist2026`, `/eft`, `/chosen`, `/switch` and the three policy pages are **generated** by `tools/rebuild/` from captures of the live pages. Each has its CSS inline, with one class per style combination. **Don't hand-edit them**: when the live page changes, re-capture and regenerate (see `tools/rebuild/README.md`). If a page here should diverge from the live site, hand-build it like `/nsmb` instead.
- `/preview/<page>` shows the same page **including elements hidden on the live site**, outlined in rose with a "숨김 · 데스크톱/태블릿/모바일" tag. Images used only by hidden elements live under `/preview/<page>/img/`, so they're protected too.
- Previews are protected by `middleware.js`: any `/preview/*` URL shows a login page (아이디 / 비밀번호), and a correct login sets an HttpOnly cookie for `/preview` valid 30 days. Changing `PREVIEW_PASSWORD` logs everyone out. Don't switch back to the browser's Basic Auth pop-up: its credentials don't reach the middleware behind Vercel's deployment protection. `PREVIEW_USER` and `PREVIEW_PASSWORD` are set in Vercel (all environments). Without them `/preview/*` returns 503 for everyone. They're also `noindex` (meta + `X-Robots-Tag`) and disallowed in `robots.txt`.
- Every FAQ uses the /nsmb accordion style (`faq.css`): the generator rebuilds each live accordion as `<div class="faq"><details><summary>…<span class="pm"></span></summary><div class="ans">…</div></details></div>`, keeping the live questions and answers word for word.
- Deliberate differences from the live pages (asked for by Ashley) live in `tools/rebuild/overrides.json` so they survive regeneration. Currently: equal-height EFT cards ("수업이 끝나면, 이렇게 달라집니다") at every width; extra space after the FAQ on /switch and /lifeartist2026 and after the last section of the policy pages; the /lifeartist2026 plan hover outline (live behaviour the capture can't record).
- Sticky headers (`/eft`, `/chosen`, like live) carry the same 1px #D7D7D7 bottom rule as `/nsmb`.
- Every page uses the same footer: the `<footer class="site-footer">` markup from `site/index.html` plus `footer.css`. The generator copies that markup from the home page each time it runs, so change the footer in `site/index.html` (and `/nsmb`), then regenerate the generated pages.
- Generated public pages carry `<link rel="canonical">` to their ashleylim.com originals, so search engines don't treat this site as duplicate content. Remove it only when this site *becomes* ashleylim.com.

## Page configuration

Sales pages keep cohort-specific values in one place: the `data-state` and `data-deadline` attributes on `#page`.

- `data-state="open" | "closed"`: closed shows the waitlist and the "registration closed" notices.
- `data-deadline`: ISO date with `+09:00` (KST). After it passes, the page switches to closed on its own.
- Preview either state with `?enroll=open` / `?enroll=closed`.

**New cohort checklist:** deadline, prices, payment links, refund-request date (guarantee section and FAQ), live-session count/day, waitlist form endpoint, `og:` image, footer year.

## Working on this repo

- **Preview locally:** start the `site` preview from `.claude/launch.json` (static server on `site/`, port 8791). Asset paths are root-relative (`/assets/...`), so always preview through the server, not by opening the file.
- **Before saying a change is done:** reload, check the console for errors, check desktop and 375px, and test any interaction you touched (forms, FAQ, countdown, video).
- **Big changes** (new page, redesign, restructure): work on a branch and share the Vercel preview URL before merging to `main`.
- **Commits:** small, one concern each, imperative subject ("Add FAQ to EFT page"). Commit or push only when asked.
- **Never commit:** `.DS_Store`, `.claude/settings.local.json`, raw exports, `.psd`/`.fig`, unoptimized originals (keep those outside the repo or in Drive).
- **Fonts and licenses:** Pretendard is OFL. Check Gmarket Sans terms before serving or redistributing its files publicly.

## Open decisions

- [ ] `/engine` uses the ENGINE palette (red `#bd1b1b`, Instrument Serif). DESIGN.md specifies Ashley's palette (terracotta/coral, Gmarket Sans + Pretendard). Decide which is canonical for the site, then update this file.
- [ ] Set the ActiveCampaign env vars in Vercel (see `.env.example`) and, for double opt-in, the AC form id.
- [ ] Confirm "7일" vs "14일" refund wording on the NSMB page.
- [ ] Check Gmarket Sans license terms for public web hosting (subset woff2 files are now served).
- [ ] Decide whether to keep `/engine` or delete it.
- [ ] When this site replaces ashleylim.com: remove the canonical tags and switch absolute ashleylim.com links in generated pages to relative ones.
