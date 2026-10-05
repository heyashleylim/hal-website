# Decisions

Newest first. One entry per decision: what, why, date.

## 2026-10-05 — Homepage rebuilt from ashleylim.com
- `/` now mirrors the live ashleylim.com home: profile (avatar, name, tagline, bio) and the two visible program
  cards (내성만방 → /nsmb, EFT 태핑 마스터클래스 → ashleylim.com/eft). Hidden live cards (CHOSEN, 스위치, 얼라인먼트 세션,
  퀀텀점프 웨비나) are left out. Blush page background and rose card buttons follow the live page.
- The previous ENGINE-style homepage moved to `/engine` instead of being deleted.

## 2026-10-05 — /nsmb rebuilt from ashleylim.com/nsmb
- Layout, colors, type and spacing measured from the live page at 1440px; built on DESIGN.md tokens (`brand.css`).
- Only sections visible on the live page are included. Hidden live sections (screenshot gallery, three review images,
  Path A/B, pricing cards, 4th star review) are left out.
- Kept from the earlier homepage by request: sticky About photo, framed curriculum video, phone-framed video
  testimonials with hover motion, waitlist form, FAQ accordion.
- "Are you ready?" is set in GmarketSans instead of Newsreader, per DESIGN.md (no English accent serifs).
- Copy is kept verbatim, including the live page's quirks: "멈춰버려요.머리로는" (no space) and the repeated
  opening paragraph in the "미래의 나를 구해줘서 고마워" story.

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
