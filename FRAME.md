---
name: Ashley Lim (frame.md — video-first companion)
source: design.md (Ashley Lim NSMB style pack) · atoms carried verbatim
status: Frame-scale companion to design.md. Nothing in design.md is modified.
unit: the frame (1920×1080 primary; 1080×1920 portrait; 1080×1080 square)
principle: atoms are sacred · composition is free · numbers come from the script.

colors:
  ground:          { hex: "#FFFDF7", role: "cream — default frame ground; never pure white" }
  ink:             { hex: "#222222", role: "primary text on cream (15.6:1); numerals" }
  muted-ink:       { hex: "#555555", role: "secondary line, credit, index chip" }
  muted-ink-soft:  { hex: "#777777", role: "colophon, timestamp, chrome label" }
  coral:           { hex: "#DB4A2B", role: "action — one emphasis word, buttons, key figure (large/bold only on cream)" }
  butter-tint:     { hex: "#F8F6D3", role: "soft block/card behind ink text" }
  sage-mint:       { hex: "#EDF7EE", role: "results ground — 'after' moments" }
  sage-green:      { hex: "#3A7A4A", role: "result ink on sage-mint (4.7:1)" }
  teal-deep:       { hex: "#082D2E", role: "calm closer; dark card; cream text on it 14.5:1" }
  blush:           { hex: "#C37568", role: "quote color — large text only (3.4:1)" }
  marigold:        { hex: "#FDC341", role: "delight accent — highlight/fill; keyword, star pop, count-up card" }

typography:
  # ---- reading ramp (px carried from design.md + cqw equivalents @1920) ----
  body:
    fontFamily: "Inter, Pretendard, system-ui"
    fontWeight: 400
    fontSize: 20px       # ≈ 1.05cqw — chrome/colophon only
    lineHeight: 1.5
  caption-video:
    fontFamily: "Inter, Pretendard, sans-serif"
    fontWeight: 500       # Inter Medium / Pretendard Bold 700 for Korean
    fontSize: 28px        # ≈ 1.46cqw — load-bearing floor met
    lineHeight: 1.35
    textCase: lowercase
  kicker:
    fontFamily: "Poppins, Pretendard, sans-serif"
    fontWeight: 600
    fontSize: 24px        # ≈ 1.25cqw — chrome; always paired with a rule
    letterSpacing: 0.04em
  subhead-voice:
    fontFamily: "Newsreader, Pretendard, serif"
    fontStyle: italic
    fontWeight: 400
    fontSize: 44px        # ≈ 2.3cqw
    lineHeight: 1.3
  head:
    fontFamily: "Poppins, 'Gmarket Sans', sans-serif"
    fontWeight: 500
    fontSize: 64px        # ≈ 3.3cqw
    lineHeight: 1.15

  # ---- hero / display ramp (frame-native, cqw) ----
  wordmark-mega:
    fontFamily: "Poppins, 'Gmarket Sans', sans-serif"
    fontWeight: 500
    fontSize: 22cqw       # ≈ 422px @1920 — identity cover
    lineHeight: 0.88
    letterSpacing: -0.03em
  display-hero:
    fontFamily: "Poppins, 'Gmarket Sans', sans-serif"
    fontWeight: 500
    fontSize: 10cqw       # ≈ 192px — stacked head on cream
    lineHeight: 1.0
    letterSpacing: -0.015em
  voice-hero:
    fontFamily: "Newsreader, Pretendard, serif"
    fontStyle: italic
    fontWeight: 400
    fontSize: 7.5cqw      # ≈ 144px — the one confessional line per beat
    lineHeight: 1.1
  section-head:
    fontFamily: "Poppins, 'Gmarket Sans', sans-serif"
    fontWeight: 500
    fontSize: 4.2cqw      # ≈ 81px — section/takeover
    lineHeight: 1.1
  numeral-mega:
    fontFamily: "Poppins, sans-serif"
    fontWeight: 600
    fontSize: 18cqw       # ≈ 346px — count-up stat
    lineHeight: 0.9
    letterSpacing: -0.04em
  numeral-ledger:
    fontFamily: "Poppins, sans-serif"
    fontWeight: 600
    fontSize: 3.6cqw      # ≈ 69px — ledger/catalog cell numeral
    lineHeight: 1.0
  pill-giant:
    fontFamily: "Poppins, sans-serif"
    fontWeight: 500
    fontSize: 2.2cqw      # ≈ 42px — frame-scale CTA pill
    letterSpacing: 0.01em
  kicker-frame:
    fontFamily: "Poppins, Pretendard, sans-serif"
    fontWeight: 600
    fontSize: 1.5cqw      # ≈ 29px — meets the 1.4cqw legibility floor
    letterSpacing: 0.08em
    textCase: lowercase

rounded:
  nil:   0px
  xs:    4px
  sm:    8px
  md:    14px
  lg:    22px
  pill:  999px

spacing:
  # engine-locked zones carried verbatim, plus frame-scale pads
  safe-top:        270px     # ≈ 25cqh
  safe-bottom:     300px     # ≈ 27.8cqh
  gutter-s:        12px
  gutter-m:        24px
  gutter-l:        48px
  frame-pad:       5cqw      # standard interior padding
  frame-pad-tight: 3cqw
  stack-m:         2.2cqw    # vertical rhythm between stacked lines
  rail-keepout:    2cqw      # min space around headline / eyebrow

components:
  pill-primary:
    backgroundColor: "{colors.coral}"
    textColor:       "{colors.ground}"
    typography:      "{typography.pill-giant}"
    rounded:         "{rounded.pill}"
    padding:         "1.1cqw 2.4cqw"
  pill-primary-giant:
    backgroundColor: "{colors.coral}"
    textColor:       "{colors.ground}"
    typography:      "{typography.pill-giant}"
    rounded:         "{rounded.pill}"
    padding:         "1.6cqw 3.4cqw"
  pill-marigold:
    backgroundColor: "{colors.marigold}"
    textColor:       "{colors.ink}"
    typography:      "{typography.pill-giant}"
    rounded:         "{rounded.pill}"
    padding:         "1.1cqw 2.4cqw"
  kicker-rail:
    textColor:       "{colors.muted-ink}"
    typography:      "{typography.kicker-frame}"
    padding:         "0.4cqw 0"
    # construction: a 1px hairline in {colors.muted-ink-soft} sits 0.5cqw below the label
  card-butter:
    backgroundColor: "{colors.butter-tint}"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.md}"
    padding:         "4cqw"
  card-teal:
    backgroundColor: "{colors.teal-deep}"
    textColor:       "{colors.ground}"
    rounded:         "{rounded.md}"
    padding:         "4cqw"
  card-sage:
    backgroundColor: "{colors.sage-mint}"
    textColor:       "{colors.sage-green}"
    rounded:         "{rounded.md}"
    padding:         "4cqw"
  stat-card-marigold:
    backgroundColor: "{colors.marigold}"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.lg}"
    padding:         "4cqw 5cqw"
    # focal: {typography.numeral-mega} in {colors.ink}; caption {typography.kicker-frame}
  highlight-mark:
    backgroundColor: "{colors.marigold}"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.xs}"
    padding:         "0.1cqw 0.6cqw"
    # construction: inline marker-stroke under ONE word in a head
  caption-karaoke:
    backgroundColor: "transparent"
    textColor:       "{colors.ground}"
    typography:      "{typography.caption-video}"
    padding:         "0.6cqw 1cqw"
    # construction: 1 keyword gets {components.highlight-mark} ground inline
  voice-line:
    textColor:       "{colors.coral}"
    typography:      "{typography.voice-hero}"
    # construction: single italic line, Newsreader (en) or Pretendard (ko); center-anchored
  ledger-cell:
    backgroundColor: "{colors.ground}"
    textColor:       "{colors.ink}"
    rounded:         "{rounded.nil}"
    padding:         "2cqw 2.2cqw"
    # construction: 1px top hairline in {colors.muted-ink-soft}; numeral uses {typography.numeral-ledger}; label {typography.kicker-frame} in {colors.muted-ink}
  index-chip:
    backgroundColor: "transparent"
    textColor:       "{colors.muted-ink}"
    typography:      "{typography.kicker-frame}"
    padding:         "0.3cqw 0"
    # construction: "01 / 06" style index — chrome only
  star-pop:
    backgroundColor: "{colors.marigold}"
    rounded:         "{rounded.pill}"
    # construction: 2.2cqw diameter dot or four-point star glyph; one per frame max
---

# frame.md — Ashley Lim at frame scale

**Atoms are sacred · composition is free · numbers come from the script.**

Companion to `design.md`. Reads the same brand through a video lens: the **frame** is the unit,
responsive becomes aspect-ratio behavior, and composition becomes first-class. Every hex, weight,
radius, and font is carried verbatim; nothing is invented.

---

## Overview

Ashley Lim is a **sunlit studio voice** — cream paper, soft butter, one burst of coral, a deep
teal for the close. On video the brand runs as **short stacked sentence-case lines with room to
breathe**, Korean and English drawn in matching weight so a bilingual line reads as one voice.
Confessional beats carry almost nothing; teaching beats earn one designed moment — a marigold
mark under a single word, a count-up on a butter card, a teal frame at the end. Never ALL CAPS,
never hustle, never a row of emoji.

### Frame Craft Bar

- **Squint test** — one element dominates at 3–6× its nearest neighbor. A cream frame with a
  stacked head and a kicker is a chasm, not a ramp.
- **Silence test** — identity, voice, teaching, and closer frames read **55–75% empty**. The
  **ledger/catalog** plate is the single named dense exception. Never fill a sparse frame to
  look complete; the quiet is the brand.
- **Restraint test** — the scarce element fires once per frame. **One** marigold moment (mark,
  star, fill); OR **one** coral emphasis word; never both at full strength. Demote one if two
  appear.
- **Reference bar** — aim at a quiet editorial essay / a Korean indie bakery menu card. Failure
  looks like a startup pitch deck: left-anchored head + right-side image, kicker on every slide,
  gradient background, two CTAs stacked.

---

## Colors

Tokens unchanged from `design.md`. At frame scale, read them as **grounds** first, accents
second.

- **Grounds (choose one per frame):** `{colors.ground}` cream (default), `{colors.butter-tint}`
  butter (teaching warmth), `{colors.sage-mint}` sage-mint (results/after), `{colors.teal-deep}`
  teal (closer / dark card). Never pure white, never a gradient.
- **Ink on cream:** `{colors.ink}` for all load-bearing type. `{colors.muted-ink}` for one
  secondary line; `{colors.muted-ink-soft}` for hairlines and colophon only.
- **Accent, rationed:** `{colors.coral}` owns one emphasis word or the pill on cream grounds.
  `{colors.marigold}` owns a mark/fill/star/count-up — one per frame. **Never marigold text on
  cream** (1.6:1). Marigold on ink/teal only, or marigold behind ink as a block.
- **Blush** is reserved for a large quote line; **sage-green** only reads on `sage-mint`.

Pairing rule: each frame has **one ground + ink + at most one accent moment**. Two accents at
full strength = one gets demoted or moves to the next frame.

---

## Typography

Two ramps live in the frontmatter.

- **Reading ramp** (`body`, `caption-video`, `kicker`, `subhead-voice`, `head`) carries the
  design.md px sizes and their cqw equivalents. These are chrome, captions, and secondary type —
  nothing on this ramp is the focal element of a frame.
- **Hero / display ramp** (`wordmark-mega`, `display-hero`, `voice-hero`, `section-head`,
  `numeral-mega`, `numeral-ledger`, `pill-giant`, `kicker-frame`) is frame-native. These sizes
  carry a beat.

**Legibility floor:** any load-bearing line is **≥ 1.4cqw (≈ 27px @1920)**. `kicker-frame` at
1.5cqw meets it; `body` and `kicker` from the reading ramp sit below it and are **colophon /
chrome only** — they may never carry the beat.

**Bilingual lines:** a Korean + English line uses each language's own font at the same weight on
the same baseline. Gmarket Sans Medium 500 ↔ Poppins Medium 500. Pretendard Medium 500 ↔
Newsreader Italic 400.

**Fit-to-measure heads:** the headline text block is **≤ 78cqw** wide and never touches the safe
margin. Step the hero ramp by word count: ≤ 3 words → `wordmark-mega` or `display-hero`; 4–6 →
`display-hero`; 7+ → `section-head`. Short lines go big, long lines go small.

Rules carried from design.md: **sentence case always, never ALL CAPS**, heads stay one weight
(Medium), italic is the one voice line in a beat and never a whole paragraph.

---

## Layout — The Frame

- **Primary frame:** 1920×1080 (16:9).
- **Companion frames:** 1080×1920 (9:16), 1080×1080 (1:1).
- **Safe area (engine-locked, carried verbatim):** top 270px / bottom 300px stay clear in 16:9.
  In cqw terms: top safe ≈ 25cqh, bottom safe ≈ 27.8cqh. **One text block at the top of the
  frame** is a locked engine rule; frames may still center their focal element below the top
  safe zone.
- **Interior padding:** `{spacing.frame-pad}` 5cqw default; `{spacing.frame-pad-tight}` 3cqw on
  ledger/catalog frames only.
- **The vw/cqw law:** every display value authored in **cqw** against 1920 (`px ÷ 1920 × 100`).
  Chrome atoms — border radius, hairline width, button padding minima — may stay in px because
  they are brand atoms, not frame-scale decisions.
- **Why `cqw` and not `vw`:** a `container-type: size` frame resolves `cqw` against **itself**,
  so a frame renders at true proportions whether it fills the display or sits in a review grid.
  `vw` would blow every frame out to the viewport and destroy the storyboard.

---

## Elevation & Depth

Shallow. A frame is paper, not a dashboard.

- **Allowed:** card on cream (butter / sage / teal / marigold) with 0 shadow, or a 1px
  `{colors.muted-ink-soft}` hairline rule.
- **Permitted exception:** one plate (teaching card) may carry a soft `0 2px 24px rgba(34,34,34,0.08)`
  shadow — never on cover, voice, or closer frames.
- **Banned at frame scale:** gradients, glows, inner shadows, drop shadows on type, 3D stacks,
  parallax layers.

---

## Shapes

Radius is small and consistent.

- Cards: `{rounded.md}` 14px (`card-butter`, `card-teal`, `card-sage`) / `{rounded.lg}` 22px for
  `stat-card-marigold`.
- Pills / CTAs: `{rounded.pill}` 999px. The pill is the brand's only truly-round object.
- Marks and chips: `{rounded.xs}` 4px (`highlight-mark`).
- Hairlines are 1px, `{colors.muted-ink-soft}`.

CTA geometry rule: pills are **frame-scaled** (`pill-primary-giant`) when they are the focal
element and only then — a tiny pill reads as web chrome.

---

## Components

The frontmatter `components:` block is the source of truth. Prose here is intent + the
construction a property-token set can't hold.

- **`{components.pill-primary}` / `{components.pill-primary-giant}`** — coral pill with cream
  text. Giant variant is the focal element of a cover/CTA frame; standard variant is a
  bottom-safe-zone chrome element at the engine's locked caption position.
- **`{components.pill-marigold}`** — delight variant. Used once per sequence, never on the same
  frame as a `pill-primary`. Marigold behind ink reads strongly; coral and marigold at full
  strength on the same frame break the restraint test.
- **`{components.kicker-rail}`** — the chrome eyebrow. A 1px hairline in `{colors.muted-ink-soft}`
  sits 0.5cqw below the label. **Rationed** — appears on a minority of frames, never on every
  one; the top-left kicker on every slide is the deck tell.
- **`{components.card-butter}`** — the teaching card. Ink type sits inside; the butter ground is
  the "designed moment" so the frame around it stays cream and quiet.
- **`{components.card-teal}`** — the closer. Cream text inside; voice line uses
  `{components.voice-line}` recolored to `{colors.ground}` when it sits on teal.
- **`{components.card-sage}`** — the after/result moment. Sage-green ink is the only ink colour
  that reads here; use for a single short line, never a paragraph.
- **`{components.stat-card-marigold}`** — the count-up. Marigold ground, ink numeral at
  `{typography.numeral-mega}`, a `{typography.kicker-frame}` caption below.
- **`{components.highlight-mark}`** — the marker-stroke under one word. Inline marigold block
  behind ink type. **Only one word per frame** carries this.
- **`{components.caption-karaoke}`** — the engine's single-word / karaoke caption. Keyword is
  wrapped in `{components.highlight-mark}` inline. Sits in the engine's bottom caption zone.
- **`{components.voice-line}`** — the italic confessional line. One per beat.
- **`{components.ledger-cell}`** — the catalog/menu cell. Cream ground, 1px top hairline,
  `{typography.numeral-ledger}` figure and `{typography.kicker-frame}` label. Used only in the
  one named dense plate.
- **`{components.index-chip}`** — chrome index ("01 / 06"). Never load-bearing.
- **`{components.star-pop}`** — the marigold sparkle. 2.2cqw diameter. One per frame maximum.

---

## Motion & Timing

Derived from Ashley's warm, tender register. **Cuts, not swooshes.**

- **May animate:** a line fades in on a 180ms cross-fade; a stat count-up ticks over 400–700ms
  then rests; a marigold mark draws L→R under one word in 220ms once per frame; a page cross-fades
  to the next ground over 240ms.
- **Must not animate:** headlines sliding in from off-frame, bounce easings, parallax, type
  springing, confetti, letter-by-letter typewriter on heads, zoom-and-pan on footage.
- **Dwell:** sparse frames rest **1.4–2.4s** at their end state so the quiet lands. The ledger
  plate (density exception) rests **2.4–3.2s** because it carries more to read.
- **Easing:** standard `cubic-bezier(0.22, 1, 0.36, 1)` for the fade; count-ups use a decelerating
  tick. No overshoot.
- **Export:** every frame has a stable end-state at the dwell point — that end-state is what the
  showcase renders.

---

## Frame Treatments

Six plates. Each composes frontmatter components; no treatment invents a size. Numerals and copy
below are **placeholders** — real figures come from the script.

### 1 · Sunlit Cover  (identity/cover · move: stacked wordmark on cream, one marigold pop)
**Ground** `{colors.ground}`, padding `{spacing.frame-pad}`.
**Container** flex column, centered, gap `{spacing.stack-m}`.
**Composes** `{components.star-pop}`, `{components.kicker-rail}`.
**Focal** stacked wordmark at `{typography.wordmark-mega}` in `{colors.ink}`, two lines, centered
mid-frame (below top safe).
**Chrome** `{components.kicker-rail}` top-left ("studio · season 02") at `{typography.kicker-frame}`.
**Accent** one `{components.star-pop}` to the right of the second line, baseline-aligned.
**Silence** ~65% empty.
**Fixed** cream ground; wordmark weight 500; sentence case; one star only.
**Free** the two words in the wordmark; the kicker string.
**Density** sparse.

### 2 · Confessional Voice  (editorial/oversized-claim · move: a single italic line centered on cream)
**Ground** `{colors.ground}`, padding `{spacing.frame-pad}`.
**Container** flex column, centered horizontally and vertically within the safe area.
**Composes** `{components.voice-line}`.
**Focal** `{components.voice-line}` at `{typography.voice-hero}` in `{colors.coral}`, 1–2 lines,
text block ≤ 78cqw.
**Chrome** none. No kicker, no rule, no chip.
**Accent** the coral of the voice line itself is the only accent; no star, no mark.
**Silence** ~72% empty.
**Fixed** italic Newsreader (en) or Pretendard (ko); center anchor; no second element.
**Free** the line; language.
**Density** sparse.

### 3 · Teaching Card  (focal-artifact · move: butter card lifted on cream, one marked word)
**Ground** `{colors.ground}`, padding `{spacing.frame-pad}`.
**Container** flex column centered; a single `{components.card-butter}` width 70cqw height ~56cqh.
**Composes** `{components.card-butter}`, `{components.highlight-mark}`, `{components.kicker-rail}`.
**Focal** head inside the card at `{typography.display-hero}` in `{colors.ink}`, 3–5 words
stacked over 2 lines; ONE word wrapped in `{components.highlight-mark}`.
**Chrome** `{components.kicker-rail}` above the card ("lesson 03 · patience") at
`{typography.kicker-frame}`.
**Accent** the one marigold `{components.highlight-mark}` under the word.
**Silence** ~55% empty (card bleeds generously but doesn't fill the frame).
**Fixed** butter ground only inside the card; shadow soft and only here; marker on exactly one word.
**Free** the head; which word is marked; the kicker.
**Density** standard.

### 4 · Count-up Stat  (data/ledger · move: single marigold stat card, giant ink numeral)
**Ground** `{colors.ground}`, padding `{spacing.frame-pad}`.
**Container** flex column centered; `{components.stat-card-marigold}` width 56cqw height ~52cqh.
**Composes** `{components.stat-card-marigold}`, `{components.kicker-rail}`.
**Focal** numeral at `{typography.numeral-mega}` in `{colors.ink}` — the single figure the beat is
about ("— figure —").
**Chrome** `{typography.kicker-frame}` caption inside the card below the numeral ("students, year one");
`{components.kicker-rail}` top-left ("count up · 01").
**Accent** the marigold ground is the accent — nothing else marigold on the frame.
**Silence** ~58% empty.
**Fixed** marigold card alone on cream; ink numeral; sentence-case caption.
**Free** the numeral; the caption.
**Density** standard.

### 5 · Studio Catalog  (chrome/catalog · move: a six-cell ledger of the season — the density exception)
**Ground** `{colors.ground}`, padding `{spacing.frame-pad-tight}`.
**Container** CSS grid, 3 columns × 2 rows, gap 0; cells share 1px top hairlines.
**Composes** `{components.ledger-cell}` ×6, `{components.index-chip}`, `{components.kicker-rail}`.
**Focal** the grid itself; each cell's numeral at `{typography.numeral-ledger}` in `{colors.ink}`
is the local focal.
**Chrome** `{components.kicker-rail}` top-left ("season · catalog"), `{components.index-chip}`
top-right ("01 / 06").
**Accent** ONE cell carries a `{components.star-pop}` top-right of its numeral — the one worth
pointing at.
**Silence** tight by design — the density exception.
**Fixed** six cells; sentence-case labels; one star across the whole grid.
**Free** cell labels and figures; which cell carries the star.
**Density** dense-exception.

### 6 · Teal Closer  (brand-signature · move: full-bleed deep teal with a single cream voice line)
**Ground** `{colors.teal-deep}`, padding `{spacing.frame-pad}`.
**Container** flex column, centered.
**Composes** `{components.voice-line}` (recolored `{colors.ground}` on teal), `{components.pill-marigold}`.
**Focal** the voice line at `{typography.voice-hero}` in `{colors.ground}`, 1 line, ≤ 78cqw.
**Chrome** `{components.pill-marigold}` at the bottom-safe-zone position with 2–3 words
("thanks for staying") — the single warm handoff.
**Accent** the marigold pill is the only accent; no star, no mark.
**Silence** ~70% empty.
**Fixed** teal ground; one italic line; one pill.
**Free** the line; the pill copy.
**Density** sparse.

---

## Do's and Don'ts

**Do**
- Lean centered. Cover, voice, teaching card, count-up, closer all center their focal element.
  Use left anchor for the catalog only.
- One idea per frame. Two ideas → two frames. ≤ 2–3 distinct elements (focal + at most a kicker
  and one accent).
- Ration the kicker. It appears on a minority of frames, never all.
- Vary the composition axis between consecutive frames. Full-bleed cadence: every 3–4 frames
  one element owns the whole frame (teal closer, oversized voice).
- Match weight across languages on bilingual lines.
- Sentence case, always.
- One accent moment per frame — coral emphasis OR marigold mark OR a star, not several.

**Don't**
- Don't stack two CTAs. The pill is one, or it's absent.
- Don't float a decorative motif over a headline — ≥ 2cqw keep-out from head and kicker.
- Don't let a line sit below 1.4cqw if it carries meaning.
- Don't gradient, glow, drop-shadow type, or parallax.
- Don't put marigold text on cream (1.6:1). Marigold is a block, not a letter here.
- Don't paste the same L/R split onto every frame — the slideshow tell.
- Don't ALL CAPS in Korean or English heads.

---

## Aspect-Ratio Behavior

Short edge keeps its safe zone; display re-steps so no load-bearing line drops below 1.4cqw.

| Treatment | 16:9 (1920×1080) | 9:16 (1080×1920) | 1:1 (1080×1080) |
|---|---|---|---|
| 1 · Sunlit Cover | wordmark `{typography.wordmark-mega}` 22cqw; two lines centered | wordmark re-steps to `{typography.display-hero}` 16cqw; three stacked lines | wordmark `{typography.display-hero}` 14cqw; two lines; star shifts to below |
| 2 · Confessional Voice | `voice-hero` 7.5cqw single centered line | `voice-hero` 8.5cqw; 2–3 lines; text block narrows to 70cqw | `voice-hero` 7.5cqw; 2 lines |
| 3 · Teaching Card | card 70cqw × 56cqh; head `display-hero` | card 82cqw × 48cqh; head re-steps to `section-head` 5.2cqw to protect wrap | card 74cqw × 60cqh; head `section-head` |
| 4 · Count-up Stat | card 56cqw; numeral `numeral-mega` 18cqw | card 76cqw; numeral re-steps to 22cqw; caption below | card 62cqw; numeral 18cqw |
| 5 · Studio Catalog | 3 × 2 grid | 2 × 3 grid; numerals hold `numeral-ledger`; labels stay above floor | 2 × 3 grid; same |
| 6 · Teal Closer | 1 line centered; pill at bottom-safe | voice re-steps to `section-head`; pill sits in bottom-safe | 1 line; pill below |

---

## Approved Real Entities & Numerals

- Brand name: **Ashley Lim**.
- Dual-language scripts: **Korean + English**, treated as one voice.
- Fonts (atoms, carried from design.md): Gmarket Sans, Pretendard, Poppins, Newsreader, Inter.
- Engine zones: top 270px, bottom 300px.
- Color hexes: the eleven tokens in frontmatter — nothing else.
- **Figures and headline copy must come from the script.** Any numeral in a treatment or in the
  showcase renders as `— figure —` or a placeholder; no invented stats, no fabricated
  testimonials, no fake rates.

---

## Pre-Render Self-Audit

Run before any frame is final:

- **Squint** — one element dominates at 3–6×?
- **Silence** — sparse plate reads 55–75% empty (or is the named ledger exception)?
- **Restraint** — one accent moment only (coral emphasis OR marigold mark OR star)?
- **Weight** — heads stay Medium 500; sentence case; no ALL CAPS?
- **Depth** — zero gradients/glows/type-shadows; soft shadow on teaching card only?
- **Geometry** — radius matches `{rounded.*}`; pill is `{rounded.pill}`; no custom corner?
- **Anchor** — centered-leaning; no more than ~2 consecutive frames share an anchor?
- **Element count** — ≤ 2–3 distinct elements (focal + kicker + accent)?
- **Floor** — every load-bearing line ≥ 1.4cqw?
- **Fidelity** — every size references a frontmatter token; no ad-hoc cqw in prose?
- **Script** — all figures from the script; no invented numerals?
- **Bilingual** — Korean + English share weight; no weight mismatch?

---

## Known Gaps

- `cqw` sizes are authored as strings in YAML — a spec consumer following the DESIGN.md
  property-value table should "accept; store as string" per the extension rule. No tool should
  attempt arithmetic on these without the unit.
- `Motion & Timing`, `Frame Treatments`, and `Aspect-Ratio Behavior` are **derived sections** —
  they extend the source spec which did not describe video motion or multi-aspect behavior. They
  are consistent with design.md's atoms and voice rules but are additions, not quotations.
- Aspect re-scales are guidance; the engine's locked safe zones remain authoritative for 16:9.
- The showcase renders numerals as placeholders. Real figures only come from a script context.
