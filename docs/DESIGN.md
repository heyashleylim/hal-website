# Ashley Lim — Design System

Pulled from the live computed styles of ashleylim.com sales pages at 1440px desktop width:
`/nsmb` (내성만방), `/eft` (EFT 태핑 마스터클래스), `/switch` (스위치 마스터클래스), `/chosen` (CHOSEN 마스터클래스).

Use it for any page, section, ad, email or mockup in Ashley's brand.

---

## 1. Brand feel

- **Warm and editorial.** Cream paper backgrounds, near-black ink, one terracotta CTA color, dusty rose for small accents.
- **Long-form sales letter.** The pages are narrow, text-led columns that tell a story. Space and rhythm matter more than decoration.
- **Soft, rounded, flat.** Pill buttons, rounded cards, hairline borders. Almost no shadows and no gradients.
- **Korean first.** Every type decision serves Hangul readability: line-height at 1.4 or more, medium weights, no tight tracking.

---

## 2. Typography

### Families

| Role | Family | Fallback stack |
|---|---|---|
| **Headers** (H1–H3, display numbers, prices) | **GmarketSans** | `"GmarketSans", "Pretendard", "Noto Sans KR", sans-serif` |
| **Everything else** (H4–H6, body, buttons, labels, forms, captions) | **Pretendard** | `"Pretendard", "Noto Sans KR", -apple-system, sans-serif` |

> The live site also uses English accent serifs (Newsreader on `/nsmb` "Are you ready?", Abhaya Libre on `/chosen` "Be Selfish, Get Chosen") and Poppins in places. **This system leaves them out.** Set those taglines in GmarketSans (if they're headings) or Pretendard Medium.

### @font-face

The font files are in [`fonts/`](fonts/). GmarketSans ships in three weights (Light, Medium, Bold). Pretendard ships in nine (Thin through Black).

```css
/* Fallback (an @import must come first in the stylesheet) */
@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap");

/* GmarketSans: headers */
@font-face { font-family: "GmarketSans"; src: url("fonts/GmarketSansTTFLight.ttf")  format("truetype"); font-weight: 300; font-display: swap; }
@font-face { font-family: "GmarketSans"; src: url("fonts/GmarketSansTTFMedium.ttf") format("truetype"); font-weight: 500; font-display: swap; }
@font-face { font-family: "GmarketSans"; src: url("fonts/GmarketSansTTFBold.ttf")   format("truetype"); font-weight: 700; font-display: swap; }

/* Pretendard: everything else */
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Thin.woff2")       format("woff2"); font-weight: 100; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-ExtraLight.woff2") format("woff2"); font-weight: 200; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Light.woff2")      format("woff2"); font-weight: 300; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Regular.woff2")    format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Medium.woff2")     format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-SemiBold.woff2")   format("woff2"); font-weight: 600; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Bold.woff2")       format("woff2"); font-weight: 700; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-ExtraBold.woff2")  format("woff2"); font-weight: 800; font-display: swap; }
@font-face { font-family: "Pretendard"; src: url("fonts/Pretendard-Black.woff2")      format("woff2"); font-weight: 900; font-display: swap; }
```

### Type scale

These values were measured on the live pages. Mobile values were measured at about 400px width.

| Token | Use | Family · Weight | Desktop | Mobile | Line-height |
|---|---|---|---|---|---|
| `display` | Hero headline, prices | GmarketSans · 500 | 50px | 32px | 1.4 |
| `h2` | Section titles | GmarketSans · 500 | 38px (40 on /switch) | 26px | 1.4 (1.5 for 2-line titles) |
| `h3` | Sub-section, card titles | GmarketSans · 500 | 28px | 22px | 1.4 |
| `h3-sm` | Key-sentence lead-in | GmarketSans · 300–500 | 22px | 18px | 1.4 |
| `h4` | Card titles, testimonial quotes, list leads | Pretendard · 500 | 22px | 20px | 1.4–1.5 |
| `h5` | Sub-headlines, attributions | Pretendard · 500 | 19px | 18px | 1.4–1.5 |
| `h6` / `eyebrow` | Section kickers, step labels | Pretendard · 400 | 14–18px | 14–16px | 1.4 |
| `lead` | Intro paragraphs | Pretendard · 400 | 18px | 16px | 1.4 |
| `body` | Paragraphs | Pretendard · 400 | 16px | 15px | **1.4** (UI), **1.5** (cards), **1.95** (long-form story) |
| `small` | Captions, fine print, meta | Pretendard · 400 | 13–14px | 13px | 1.4 |
| `tag` | Pill labels on testimonial cards | Pretendard · 700 | 12px | 12px | 1.4 |
| `button` | CTAs | Pretendard · 700 | 16–20px | 15–16px | 1 |

**Weight notes**
- The site asks for GmarketSans at 400 on H1. The attached set has no 400 weight, so the browser renders Medium (500) anyway. Specify **500** for every GmarketSans heading and **700** only for rare, punchy numbers.
- Body copy stays at **400**. Emphasis inside paragraphs uses `<strong>` at **700** (Pretendard Bold) or the highlight marker (see §5). Never bold an entire paragraph.
- Letter-spacing stays `normal` everywhere. Don't track Hangul.

---

## 3. Color

### Core

| Token | Hex | Role |
|---|---|---|
| `--accent` | `#DB4A2B` | **Terracotta.** Every CTA button, price, key emphasis word in a headline, quote rule |
| `--accent-hover` | `#F16344` | Button hover/focus |
| `--rose` | `#C37568` | **Dusty rose.** Eyebrows, step labels ("STEP 1 · WEEK 1–2"), numbered markers (01/02/03), chevrons, accent line in a hero headline |
| `--ink` | `#222222` | Headings and body text. Never use pure `#000` |
| `--ink-2` | `#555555` | Secondary body, card copy |
| `--muted` | `#777777` | Captions, attributions, fine print |
| `--strike` | `#BABABA` | Crossed-out original price |

### Surfaces

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#FFFDF7` | **Page background** (warm cream). Default for every section |
| `--surface` | `#FFFFFF` | Cards, step boxes, pricing card |
| `--bg-alt` | `#F4F2EE` | Quiet bands: testimonials, FAQ, callout boxes |
| `--bg-butter` | `#F8F6D3` | Butter-yellow bands and the **highlight marker** behind key sentences |
| `--bg-butter-2` | `#F2F4D1` | Butter variant used on /eft |
| `--bg-blush` | `#F9F2F2` | Very soft blush panels (sparingly) |
| `--deep` | `#082D2E` | **Deep teal-black.** The one dark band per page (e.g. the "why the nervous system first" section on /eft) and the footer. White text on top |

### Supporting (testimonials and proof only)

| Token | Hex | Role |
|---|---|---|
| `--star` | `#E8A030` | ★★★★★ rating stars |
| `--proof-bg` | `#EDF7EE` | Pale mint pill behind the before→after tag on testimonial cards |
| `--proof-fg` | `#3A7A4A` | Text on that pill |

These three only appear on proof elements. Don't use them anywhere else.

### Borders

| Token | Hex | Role |
|---|---|---|
| `--line` | `#D7D7D7` | Default card border, dividers |
| `--line-soft` | `#E5E5E5` | Lighter card border |
| `--line-butter` | `#E6E3C9` | Borders on butter-yellow panels |

### Usage ratio

Roughly **75% cream/white · 15% ink · 5% terracotta · 5% rose and everything else.** If terracotta shows up outside CTAs, prices and one or two keywords per screen, it's overused.

---

## 4. Layout and spacing

### Containers

| Token | Max width | Use |
|---|---|---|
| `--w-full` | 1280px | Header, hero image bounds |
| `--w-wide` | 1000px | Card grids, testimonials, pricing |
| `--w-text` | 760px | **Default reading column** for story sections |
| `--w-narrow` | 600–640px | Pull quotes, CTA blocks, FAQ |

Side gutter: 20px on mobile, 40px or more on tablet.

### Spacing scale (base 10px, with 5px steps)

`5 · 10 · 15 · 20 · 30 · 40 · 50 · 80 · 100 · 120`

- Between elements in a section: **20px** (Elementor default)
- Card padding: **25–40px** desktop, **20px** mobile
- Section vertical padding: **80–120px** desktop, **50–60px** mobile
- Hero: full viewport height on desktop

### Breakpoints

| Name | Range |
|---|---|
| Mobile | ≤ 767px. Single column, everything centered |
| Tablet | 768–1024px |
| Desktop | ≥ 1025px |

---

## 5. Components

### Radius

| Token | Value | Use |
|---|---|---|
| `--r-sm` | 10px | Square-ish buttons (/switch style), small boxes |
| `--r-md` | 15–16px | Pain-point cards, step cards |
| `--r-lg` | 20–25px | Feature cards, callouts, image frames |
| `--r-xl` | 30px | Testimonial cards, large section cards, CTA buttons |
| `--r-pill` | 100px | Header CTA, eyebrow badges, tags |
| `50%` | | Avatars, icon dots |

### Buttons

| Variant | Spec |
|---|---|
| **Primary CTA** (main) | bg `--accent`, text `#FFF`, Pretendard 700 16–18px, padding `15px 40px`, radius 30px, no shadow. Hover: bg `--accent-hover`. Label ends in an arrow: `내성만방 신청하기 →` |
| **Checkout CTA** | Same, but 20px text, padding `20px 40px`, full width inside the pricing card |
| **Header CTA** | bg `--accent`, white, Pretendard 700 14–16px, padding `12px 25px`, radius 100px. Sits top-right in the sticky header |
| **Inverse CTA** (on `--deep`) | bg `#FFF`, text `--deep`, Pretendard 700 16px, padding `20px 50px`, radius 30px |
| **PayPal** | bg `#FFD03F`, text `#001C65`, same shape as the checkout CTA |

Center CTAs. Repeat one after each major section, at least every two screens.

### Header

- Transparent over the hero, then cream `--bg` once scrolled. Sticky.
- Left: "Ashley Lim" wordmark (serif logotype image). Right: header CTA pill.

### Hero (two variants)

1. **Full-bleed photo** (/nsmb, /chosen): landscape photo of Ashley with a dark overlay. Centered stack: eyebrow pill badge → white `display` headline (the last line or key phrase in `--rose` or `--accent`) → white `h5` subhead → primary CTA → `small` note in 80% white.
2. **Split** (/eft): cream background. Left: `display` headline in ink with the second line in `--accent`, then `lead`, CTA, a row of three ✓ benefit chips, and two mini testimonial cards. Right: product image in a rounded frame.

### Eyebrow badge (hero)

Pill with radius 100px, 1px border in white or `--line`, padding `6px 16px`, Pretendard 400 13–14px. Example: `내성만방 · 내가 원하는 성공의 삶을 만드는 방법`.

### Section eyebrow + title

```
영상 후기              ← Pretendard 400 14–18px, --rose, centered
그 후, 모든 것이       ← GmarketSans 500 38px, --ink
달라졌어요
```

### Cards

| Card | Spec |
|---|---|
| **Pain-point card** | `--surface`, 1px `--line`, radius 15px, padding 25px. A `›` chevron in `--rose` sits before the text. 3-column grid, gap 20px |
| **Step / module card** | `--surface`, 1px `--line`, radius 20px, padding 40px. `h6` eyebrow in `--rose` ("STEP 3 · WEEK 5–9"), `h4` title ("Emotional Mastery — 패턴 통합"), body, then a highlight-marker summary line |
| **Numbered point** | `h4` numeral "01 / 02 / 03" in `--rose` above a short paragraph. No box |
| **Testimonial card** | `--surface`, 1px `--line`, radius 30px, padding 30px. ★★★★★ in `--star`, then a mint before→after pill (`--proof-bg`/`--proof-fg`, Pretendard 700 12px, radius 100px), then the quote in body, then `muted` attribution "이름 · 직업" |
| **Video testimonial** | Video embed with radius 20px. Pull quote below in `h4` with curly quotes, attribution in `h5` |
| **Callout box** | `--bg-alt`, radius 20px, padding 40px, centered. First line in `--rose` italic ("그런데… 삶에서 뭐가 달라졌나요?"), second line in `h5` ink |
| **Pricing card** | `--surface`, radius 30px, centered. Old price in GmarketSans 50px `--strike` with line-through. Deadline in `h3` ink. New price in GmarketSans 50px `--accent`. Bullets of what's included, then the full-width checkout CTA and the PayPal button |
| **Fit / not-fit** | Two columns. `h6` headers in `--rose`: "이런 분께 추천해요 ✓" / "이런 분께는 맞지 않아요 ✕" |

### Inline treatments

- **Highlight marker:** `<span>` with background `--bg-butter` (#F8F6D3), padding `2px 4px`. Use on the single sentence a reader must not miss.
- **Story quote:** 4px left border in `--accent`, padding-left 20px, text in `--accent` italic at 18px.
- **Bold:** Pretendard 700 for a key phrase inside a paragraph, at most once or twice per paragraph.
- **Lists:** ✔︎, ✧ or ◇ glyphs instead of bullets. `◇` separates inline sequences ("신경계 ◇ 잠재의식 ◇ 감정 & 에너지").

### FAQ

Accordion on `--bg` or `--bg-alt`. Each row has a 1px `--line` bottom border, the question in Pretendard 500 18px, and a +/− toggle. Max width 800px.

### Dark band

One per page at most: `--deep` background, white `h2`, `h6` body at 1.95 line-height, and an inverse CTA.

---

## 6. Imagery

- Warm, natural-light lifestyle photos of Ashley outdoors (Paris, coastal cliffs, countryside), with a soft dark overlay for hero text.
- Product art is a cream or neutral photo with a large GmarketSans title and a script subtitle (the "EFT 태핑 *masterclass*" cover).
- Photos sit in frames with a radius of 20–30px. No hard rectangles, no heavy drop shadows.

---

## 7. Do / Don't

**Do**
- Default to cream `#FFFDF7`, not white, for page backgrounds
- Use terracotta for action and rose for labels
- Keep reading columns at 760px or narrower and generous line-height
- Use GmarketSans 500 for every H1–H3

**Don't**
- Use cool colors (blue, teal accents, purple). The deep teal `#082D2E` is a near-black band, not an accent
- Add gradients or heavy shadows (the only shadow on the site is `0 4px 6px rgba(0,0,0,.1)`, and it's rare)
- Use sharp 0px corners on cards, buttons or images
- Set body text in GmarketSans, or headers in Pretendard
- Use pure black `#000`, or letter-space Hangul
- Make the CTA rose, or make labels terracotta

---

## 8. Tokens (copy-paste)

```css
:root {
  /* Fonts */
  --font-head: "GmarketSans", "Pretendard", "Noto Sans KR", sans-serif;
  --font-body: "Pretendard", "Noto Sans KR", -apple-system, BlinkMacSystemFont, sans-serif;

  /* Color: core */
  --accent: #DB4A2B;
  --accent-hover: #F16344;
  --rose: #C37568;
  --ink: #222222;
  --ink-2: #555555;
  --muted: #777777;
  --strike: #BABABA;

  /* Color: surfaces */
  --bg: #FFFDF7;
  --surface: #FFFFFF;
  --bg-alt: #F4F2EE;
  --bg-butter: #F8F6D3;
  --bg-blush: #F9F2F2;
  --deep: #082D2E;

  /* Color: proof */
  --star: #E8A030;
  --proof-bg: #EDF7EE;
  --proof-fg: #3A7A4A;

  /* Lines */
  --line: #D7D7D7;
  --line-soft: #E5E5E5;

  /* Radius */
  --r-sm: 10px;
  --r-md: 15px;
  --r-lg: 20px;
  --r-xl: 30px;
  --r-pill: 100px;

  /* Layout */
  --w-full: 1280px;
  --w-wide: 1000px;
  --w-text: 760px;
  --w-narrow: 600px;

  /* Shadow (rare) */
  --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 400 16px/1.4 var(--font-body);
  -webkit-font-smoothing: antialiased;
  word-break: keep-all;           /* keep Hangul words intact */
}

h1, h2, h3 { font-family: var(--font-head); font-weight: 500; line-height: 1.4; margin: 0 0 20px; }
h4, h5, h6 { font-family: var(--font-body); line-height: 1.4; margin: 0 0 20px; }

h1 { font-size: 50px; }
h2 { font-size: 38px; }
h3 { font-size: 28px; }
h4 { font-size: 22px; font-weight: 500; }
h5 { font-size: 19px; font-weight: 500; }
h6 { font-size: 16px; font-weight: 400; }

@media (max-width: 767px) {
  body { font-size: 15px; }
  h1 { font-size: 32px; }
  h2 { font-size: 26px; }
  h3 { font-size: 22px; }
  h4 { font-size: 20px; }
  h5 { font-size: 18px; }
}

.eyebrow   { font: 400 16px/1.4 var(--font-body); color: var(--rose); }
.prose     { max-width: var(--w-text); margin-inline: auto; line-height: 1.95; }
.mark      { background: var(--bg-butter); padding: 2px 4px; }

.btn {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  font: 700 18px/1 var(--font-body);
  padding: 15px 40px;
  border-radius: var(--r-xl);
  text-decoration: none;
  transition: background .2s;
}
.btn:hover, .btn:focus-visible { background: var(--accent-hover); }
.btn--header  { font-size: 15px; padding: 12px 25px; border-radius: var(--r-pill); }
.btn--inverse { background: #fff; color: var(--deep); padding: 20px 50px; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 40px;
}
.card--testimonial { border-radius: var(--r-xl); padding: 30px; }
.stars     { color: var(--star); letter-spacing: 2px; }
.proof-tag { background: var(--proof-bg); color: var(--proof-fg); font: 700 12px/1.4 var(--font-body); padding: 4px 12px; border-radius: var(--r-pill); }
.callout   { background: var(--bg-alt); border-radius: var(--r-lg); padding: 40px; text-align: center; }
.quote     { border-left: 4px solid var(--accent); padding-left: 20px; color: var(--accent); font-style: italic; font-size: 18px; }
```

### Tailwind (optional)

```js
theme: {
  extend: {
    fontFamily: {
      head: ['GmarketSans', 'Pretendard', '"Noto Sans KR"', 'sans-serif'],
      body: ['Pretendard', '"Noto Sans KR"', 'sans-serif'],
    },
    colors: {
      accent: { DEFAULT: '#DB4A2B', hover: '#F16344' },
      rose: '#C37568',
      ink: { DEFAULT: '#222222', 2: '#555555', muted: '#777777' },
      cream: '#FFFDF7',
      alt: '#F4F2EE',
      butter: '#F8F6D3',
      blush: '#F9F2F2',
      deep: '#082D2E',
      star: '#E8A030',
      proof: { bg: '#EDF7EE', fg: '#3A7A4A' },
      line: '#D7D7D7',
    },
    borderRadius: { sm: '10px', md: '15px', lg: '20px', xl: '30px', pill: '100px' },
    maxWidth: { full: '1280px', wide: '1000px', text: '760px', narrow: '600px' },
  },
}
```
