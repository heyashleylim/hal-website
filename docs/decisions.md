# Decisions

Newest first. One entry per decision: what, why, date.

## 2026-10-05 — Project restructure
- Published files moved to `site/`; Vercel serves only that folder, so `docs/` and source files stay private.
- Page CSS split into `tokens.css`, `base.css`, `components.css`; page JS moved to `main.js`.
- Images converted to WebP with ASCII kebab-case names (`message-01.webp`, `review-cho.webp`).
  Originals kept locally in `_originals/` (git-ignored).
- `nsmb-old.html` (previous NSMB page) deleted. It remains in git history.

## 2026-10-04 — Homepage = ENGINE-style NSMB page
- The homepage reproduces the layout and style of thestartupmom.com/the-reels-editing-engine
  (cream/red palette, Instrument Serif, Inter, Clash Display, Cousine) with the full NSMB content.
- Open question: this palette differs from `docs/DESIGN.md` (Ashley's terracotta palette). See CLAUDE.md > Open decisions.
