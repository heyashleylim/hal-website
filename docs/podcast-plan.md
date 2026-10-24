# Private podcast — implementation plan

Status: **approved 2026-10-23**, built on the `podcast` branch. Phase 1 in progress.

Goal: give each NSMB student a private podcast feed in their own podcast app. The 12 modules drop weekly
from their cohort's start date, and access ends after 1 year. Several cohorts share one show, each on its
own schedule. Ashley's team runs everything from admin pages, and ActiveCampaign (AC) handles enrolment
and emails.

---

## 1. Decisions needed before building

| # | Decision | Status |
|---|---|---|
| D1 | **Add npm dependencies for the API functions only** (CLAUDE.md: "no npm without asking"). The public site keeps no build step. | ✅ A root `package.json` with `@neondatabase/serverless` and `@vercel/blob`, for the API functions only. |
| D2 | **Database** (new third party, holds student emails) | ✅ Neon Postgres (comparison in section 7). |
| D3 | **Audio storage** | ✅ Vercel Blob, private store. |
| D4 | **When the 1-year access starts** | ✅ From the cohort start date. The default length (365 days) can still be changed per show and per student. |
| D5 | **Late joiners** | ✅ They get all modules released so far at once, then follow the cohort. |
| D6 | **Which cohort a new purchase joins** | ✅ From the AC tag on the contact: each cohort has its AC tag (e.g. `nsmb-2기`) set in the admin. A student with no matching tag goes to a "needs a cohort" list with an alert, never into a guessed cohort. |
| D7 | **GTM exception** | ✅ No GTM on `/podcast/*` and `/admin/*`. |
| D8 | **Vercel plan** | ✅ Hobby now, Pro soon. Built to work on Hobby (5 functions, daily cron). On Pro the cron can run hourly. |
| D9 | **Privacy policy** (Korea PIPA) | ✅ Ashley updates the WordPress privacy policy before launch. |
| D10 | **Spotify** (section 8) | ✅ No Spotify. The web player (option C) is parked for later. |

---

## 2. What gets built

### 2.1 For students

| Feature | Details |
|---|---|
| **Personal feed** `/f/<token>.rss` | Valid podcast RSS (Apple/iTunes tags, `ko` language, artwork, `itunes:duration`, enclosure byte length). Lists only the episodes released for that student. After expiry or revocation it still loads, but with no episodes and a short Korean notice. |
| **Personal audio links** `/a/<token>/<episode>.mp3` | Checks access on every request, then streams the file from private Blob with **byte-range support** (Apple Podcasts requires it) and answers `HEAD` requests. Old or shared links stop working when access ends. |
| **Subscribe page** `/podcast/<token>` | Korean, in Ashley's design (`brand.css`). Includes: <br>• one-tap "Apple 팟캐스트에 추가" link<br>• buttons for Pocket Casts, Overcast and YouTube Music<br>• "링크 복사" (copy link)<br>• a QR code for desktop → phone<br>• the student's cohort and next drop date<br>• a friendly "access ended" state. |
| **Help page** `/podcast/help` | Step-by-step for iPhone and Android with screenshots, plus "Spotify는 지원되지 않아요" (Spotify isn't supported). Copy written with the ashley-lim-voice skill. |
| **Privacy and safety** | `noindex` and `X-Robots-Tag`, `Referrer-Policy: no-referrer`, blocked in `robots.txt`, no GTM. Tokens are random 128-bit. |

### 2.2 Admin pages (`/admin/podcast`)

Protected by a login page like `/preview`, with its own credentials (`ADMIN_USER` / `ADMIN_PASSWORD`) and cookie.
Static HTML + vanilla JS that calls one admin API. Labels in English (decided 2026-10-24).

1. **Dashboard**
   - Per active cohort: students, % subscribed, the latest released module and its download rate, the next drop.
   - Alerts: students not subscribed after 7 days, possible link sharing, failed AC syncs, access ending in 30 days.
2. **Show settings**
   - Show details: title, description, author, artwork (validated 1400–3000px square), category, copyright.
   - Schedule: release time (KST), default drip interval (7 days), default access length (365 days).
   - Pages: subscribe-page intro text, support email.
   - The data model allows several shows, so EFT or SWITCH could get a podcast later without rework.
3. **Episodes**
   - Upload the MP3 straight from the browser to Blob (no 4.5 MB function limit). Duration and size are read automatically, with a warning above 128 kbps (spoken word: 64–96 kbps mono is plenty).
   - Fields: title, show notes, episode number, **release day offset** (module 1 = day 0, module 2 = day 7…), status (draft/published).
   - Actions: replace audio, reorder, built-in player for preview.
   - "Bonus" episodes can be released to everyone at once or to chosen cohorts.
4. **Cohorts**
   - Fields: name ("1기", "2기"…), **AC tag**, start date, status (upcoming / active / finished, from the dates).
   - **Schedule preview**: a table of each module's drop date for that cohort.
   - **Per-cohort date overrides**, e.g. to skip a holiday week.
   - Changing the start date moves the whole schedule and every student's expiry date (unless set by hand).
5. **Students**
   - Search, and filters by cohort, status, "never subscribed" and "stuck at module N".
   - Student detail:
     - email, name, cohort, start and expiry dates
     - subscribe link (copy button), status, apps used
     - a timeline of episode downloads, number of distinct networks/countries
     - AC sync history
   - Actions:
     - add manually, move cohort, change start date (own schedule)
     - extend or shorten access, revoke or restore
     - **reset link** (new token: the old feed stops; AC sends the new link)
     - resend welcome email
   - **CSV import** for existing students (cohort A), **CSV export**, bulk actions.
6. **Analytics**
   - Per cohort:
     - subscription funnel (enrolled → subscribed → module 1 … module 12)
     - downloads per episode
     - median time from release to download
     - app breakdown
   - Downloads follow IAB rules: one per student, episode and 24 hours, with bots filtered out.
   - CSV export.
7. **Automation (AC)**
   - Shows the field and tag names used, and the webhook URL to paste into AC (with a copy button).
   - A log of every inbound webhook and outbound AC call, with **retry** for failures and a "send test" button.
8. **Activity log**: who changed what and when (admin actions), for safety.

### 2.3 ActiveCampaign automation

**AC → site (webhooks into `/api/podcast-ac?key=…`).** AC webhooks can't send custom headers, so the secret goes in the URL.

| AC trigger (Ashley's automation) | What the site does |
|---|---|
| Cohort tag added (e.g. `nsmb-2기`) | Enrols the student in the cohort whose AC tag matches (read from the webhook, or from AC if the webhook doesn't include tags), creates a token, writes the AC fields below, and adds tag `podcast-nsmb-enrolled`. A repeat call doesn't create a duplicate. |
| Refund / cancellation tag | Revokes access and adds tag `podcast-nsmb-revoked`. |
| Optional "access extended" tag | Adds N days of access. |

**Site → AC (contact fields and tags, sent through a queue with retries so a failed call is never lost).**

| AC custom field | Value |
|---|---|
| `PODCAST_NSMB_LINK` | Subscribe page URL (used in Ashley's welcome email) |
| `PODCAST_NSMB_COHORT` | e.g. "2기" |
| `PODCAST_NSMB_START` / `PODCAST_NSMB_EXPIRES` | Dates (for email copy) |
| `PODCAST_NSMB_LAST_EPISODE` | Last module downloaded (number) |

| Tag the site adds | When | AC can then… |
|---|---|---|
| `podcast-nsmb-subscribed` | First feed request from a podcast app | stop the "how to subscribe" reminders |
| `podcast-nsmb-not-subscribed-3d` / `-7d` | Daily check | send a how-to email or a personal DM |
| `podcast-nsmb-ep01-released` … `ep12` | On the day that module drops for the student's cohort | send the "new module" email |
| `podcast-nsmb-ep01-downloaded` … `ep12` | First download of that module | branch nudges ("stuck at module 3") |
| `podcast-nsmb-completed` | All 12 downloaded | upsell / testimonial request |
| `podcast-nsmb-expiring-30d` | 30 days before access ends | renewal or next-program offer |
| `podcast-nsmb-expired` | On the expiry date | close the loop |

The tag names are configurable in show settings, so they can match Ashley's existing naming. The AC
automations and email copy are built in AC by Ashley or Alex. We provide a setup checklist (section 6).

### 2.4 Daily job (Vercel Cron, around 00:00 UTC = 09:00 KST)

- Adds the "released" tags for drops due today, the not-subscribed tags, and the expiring and expired tags.
- Retries failed AC calls.
- Rolls raw events up into daily totals and deletes raw events older than 13 months (D9).

Episode release doesn't depend on the cron: the feed works out what's released on every request, so drops
happen on time even if the job is late.

---

## 3. Technical design

**Files** (5 functions, keeps within Hobby limits; `_lib` files are not deployed as endpoints):

```
api/
  podcast-feed.js     ← GET  /f/<token>.rss            (rewrite in vercel.json)
  podcast-audio.js    ← GET/HEAD /a/<token>/<ep>.mp3   (range streaming from private Blob)
  podcast-page.js     ← GET  /podcast/<token>          (server-rendered subscribe page)
  podcast-ac.js       ← POST AC webhooks
  podcast-admin.js    ← admin JSON API + Blob upload tokens + cron entry point
  _lib/db.js, _lib/ac.js (shared with waitlist.js), _lib/rss.js, _lib/auth.js, _lib/release.js
db/
  schema.sql          ← tables + indexes, versioned migrations
site/
  admin/podcast/      ← static admin pages (HTML/CSS/JS), protected by middleware
  podcast/help/       ← static help page
middleware.js         ← extended: /admin/* login (separate credentials and cookie)
vercel.json           ← rewrites, cron, noindex headers
```

**Tables**
- `shows`: settings above, including tag names.
- `episodes`: show, number, title, notes, blob path, bytes, duration, day offset, status.
- `cohorts`: show, name, AC tag, start date, access length (optional override).
- `cohort_episode_dates`: per-cohort overrides.
- `listeners`: show, cohort, email, name, AC contact id, token, status, own start date (nullable),
  expiry, source (webhook/import/manual), created.
- `events`: listener, episode (nullable for feed requests), type, time, app, hashed IP (salted with a secret), country.
- `daily_stats`: rolled-up totals that are kept after raw events are deleted.
- `ac_outbox`: pending AC operations, attempts, last error.
- `webhook_log`, `admin_log`.

**Release rule** (one function, unit-tested):
- An episode is visible when `now ≥ release_at` and `now < expires_at`, and the student is active.
- `release_at` is the cohort override if there is one. Otherwise it is (the student's own start date, or else
  the cohort start) + `day_offset`, at the show's release time (KST).

**Security**
- Tokens: 128-bit random.
- AC webhook: a secret key in the URL, compared in constant time.
- Admin: cookie with `SameSite=Strict`, plus a same-origin check on every write.
- Rate limiting: Vercel Firewall rule on `/f/` and `/a/`.
- Sharing alert: more than N distinct networks per student in 7 days.
- No student data is ever committed (the repo is **public**).

**Environments**
- During the build, one database serves every environment (no students yet). **Before launch**, Preview gets its own fixed Neon branch
  (its `DATABASE_URL` is set for the Preview environment only) and its own Blob store, so testing never touches real students.
  Neon's automatic branch-per-deployment stays off: each new branch would need its migrations run by hand.
- Production data only on `main`.
- Local testing needs the Vercel CLI (`vercel dev`), because the static preview server can't run functions.

---

## 4. Phases and effort

| Phase | Content | Effort |
|---|---|---|
| 0. Setup | Decisions D1–D9, create Neon and Blob through Vercel, env vars, AC custom fields | 0.5 day (+ Ashley's time) |
| 1. Foundation ✅ code done 2026-10-23 | `package.json`, schema and migrations, `_lib` (db, ac, auth, release rule with tests), admin login, admin health page | 1 day |
| 2. Delivery 🟡 code done 2026-10-24, needs the Blob store + app testing | Feed, audio streaming with ranges, subscribe page, help page, admin test tools (test upload ≤ 4 MB, test student). **Milestone:** a test student subscribes in Apple Podcasts, Pocket Casts and Overcast and receives a weekly drip on a compressed test schedule. QR code moved to phase 7. | 1.5–2 days |
| 3. Admin: content | Show settings, episodes (direct upload), cohorts with schedule preview and overrides | 1.5–2 days |
| 4. Admin: students | List, filters, detail, all actions, CSV import/export, activity log | 1.5 days |
| 5. AC automation | Inbound webhooks, outbound fields/tags through the outbox, daily cron, automation log page | 1–1.5 days |
| 6. Analytics | Event logging, IAB counting, rollups, dashboard and analytics pages, alerts | 1–1.5 days |
| 7. QA and launch | 375/768/1024/1440px checks, accessibility, a second-cohort test, expiry and revocation tests, privacy policy, runbook in `docs/`, CLAUDE.md update, import cohort A | 1 day |

**Total: about 9–11 working days.** Built on a `podcast` branch, shared through the Vercel preview URL
before merging, as CLAUDE.md asks for big changes. Phases 1–2 alone give a working private podcast,
managed by hand, within about 3 days, if cohort A needs to start before everything is ready.

**Running costs** (to confirm against current Vercel pricing): Neon free or low tier at this size, plus Blob
storage (12 episodes ≈ 0.5 GB) and data transfer. Per cohort that is roughly 12 × 30 MB × number of
students: about 70 GB for 200 students.

---

## 5. What it can't do (same with any private podcast host)

- Spotify doesn't accept private RSS feeds. It only works through an approved Spotify Open Access partner (section 8).
- Episodes already downloaded stay on the phone after access ends.
- A student can share their link. We can detect it and reset or revoke, but not prevent it.
- "Minutes listened" and completion are not measurable. Analytics are based on downloads.

## 6. Setup checklist for Ashley / Alex (outside the code)

- [ ] Approve D1–D9.
- [ ] Artwork 3000×3000 JPEG/PNG, show title and description (Korean), short trailer (optional).
- [ ] Audio for 12 modules as MP3 (64–96 kbps mono), titles and show notes.
- [ ] AC: create the custom fields above. Add the webhook step to the purchase, refund and extension automations.
      Build the emails: welcome with `%PODCAST_NSMB_LINK%`, new module, not-subscribed reminders, expiring.
- [ ] Privacy policy update on WordPress (listening data, processors).
- [ ] Cohort A start date, and the student list (CSV) if some students have already bought.

---

## 7. Database comparison (D2)

Prices are from third-party summaries dated 2026. Check them on the providers' own pages before signing up.

| Option | Fit for this project | Cost at our size | Notes |
|---|---|---|---|
| **Neon Postgres** (Vercel Marketplace) | ✅ Relational, SQL, a separate copy of the data per preview deployment | Free plan: 0.5 GB storage, 100 compute-hours/month. Paid, usage-based: about $0.11 per compute-hour + $0.35/GB-month | Goes to sleep after 5 min idle. Podcast apps check feeds often, so it will rarely sleep. With feed caching, expect free at first, then roughly $5–20/month. |
| Supabase Postgres | ✅ Same SQL, plus a spreadsheet-like table editor | Free plan, then $25/month flat (Pro) | Free projects pause after a week of inactivity. Extras (auth, storage) aren't needed. |
| Prisma Postgres | ✅ Postgres | Free plan up to about 100k operations/month, then priced per operation | Every feed check counts as an operation, so the free plan runs out fast. |
| Upstash Redis | ⚠️ Key-value store, not relational | Free plan, then priced per request | Fast and cheap for "is this token valid?", but awkward for cohort, student and analytics queries. |
| Airtable / Google Sheets | ❌ | — | Easy to edit by hand, but too slow and rate-limited to check on every podcast-app request. |

**Leaving Neon later:** it's standard Postgres, and every query lives in one file (`api/_lib/db.js`).
- **To another Postgres host** (Supabase, AWS, Prisma Postgres): export, import, change the connection
  setting, test. About half a day.
- **To a different kind of database**: rewrite `db.js`. About 1–2 days.

## 8. Spotify (D10)

- Spotify doesn't accept private RSS links. Private shows only reach Spotify through
  **Spotify Open Access (SOA)**, which is limited to **approved partner platforms**. Hello Audio is one of
  about 29 partners, along with Transistor, Supercast, Patreon and Memberful.
- Spotify publishes no application process. Its support page says platforms that aren't listed
  "won't be able to use this integration" for now.
- How it works for the listener (Hello Audio): on the invitation page they tap Spotify, link their Spotify
  account, and enter their email plus an access code. The show then appears in their Spotify library,
  locked to them.
  - Free Spotify accounts can only stream. Downloading for offline listening needs Premium.
  - Show and episode titles may be publicly searchable.
- **Not confirmed:** whether SOA works for Spotify accounts registered in **South Korea**.

**Options**
- **A. Ask Spotify for partner access** for our own system. Uncertain approval, no timeline, and Spotify
  can change the API at any time. Not realistic as a plan.
- **B. Hybrid:** our system for everything, plus a Hello Audio feed only for students who choose Spotify.
  Enrolment adds them there through Hello Audio's webhook, and their cohort start date is set there by hand.
  Cost: Hello Audio Pro (about $39–47/month) plus our build. Two places to manage, and Spotify listeners
  are missing from our analytics.
- **C. No Spotify, but a web player** (parked 2026-10-23, may come back later): `/podcast/<token>` gets a built-in player. It needs no app,
  supports lock-screen controls and can be added to the home screen. Students who only use Spotify can
  listen there. About +1 day of work.
- **D. Hello Audio only**, no custom build, if Spotify is essential and B's double management is too much.

**Before deciding, check two things (cheap):**
1. With Hello Audio's 7-day free trial, a Korean Spotify account tries a test Spotify-enabled feed.
2. Ask Ashley's students (AC poll or Instagram story) which podcast app they use.
