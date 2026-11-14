# Student area: plan

Status: **draft 2026-11-14**, not approved. Follows the private podcast (`docs/podcast-plan.md`), which stays as it is
until this replaces it.

Goal: a place on ashleylim.com where each student finds everything from their programs (audio, video, PDFs) and
talks with their cohort (posts and comments), with access that really ends when it should. Kajabi / Circle / Skool,
but only what Ashley's programs need. Nothing is sold inside it: purchases stay on the checkout (`docs/commerce-plan.md`).

---

## 1. What the phone test proved (2026-11-14)

Test page `/podcast/<token>/listen` on the `podcast` preview, 9 real NSMB modules, Alex's iPhone, Safari **and**
added to the Home Screen. Everything worked:

| Check | Result |
|---|---|
| Keeps playing with the screen locked | ✓ |
| Keeps playing in another app | ✓ |
| Lock-screen title, cover, play/pause, skip (Media Session API) | ✓ |
| Speed (0.75–2×) kept while locked | ✓ |
| Resume where you stopped after closing the tab | ✓ (saved in the browser for the test) |
| Next module starts by itself, screen locked | ✓ |
| Home Screen icon opens full screen like an app, same behaviour | ✓ |

Not tested yet: Android (Chrome). Expected to work the same; check once before launch.

**Conclusion:** a web student area can replace the podcast app for listening. What it can't do is reliable
offline listening (iPhone limits website storage). That is the one reason for a native app later (phase 2).

---

## 2. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| S1 | **How students sign in** | ✅ (Alex, 2026-11-14) **Email + one-time code** (6 digits, valid 10 minutes), then remembered on that device for 1 year. No passwords to forget or share. The current personal link (`/podcast/<token>`) keeps working and signs them in directly, so the welcome email doesn't change. |
| S2 | **Where it lives** | `www.ashleylim.com/learn` (Korean label "내 강의실"). Same site and design, no new domain. |
| S3 | **Video hosting** (new third party) | ✅ (Alex, 2026-11-14) **Mux**, with signed playback links, the student's name as a watermark on the video, **no DRM**. Chosen over Cloudflare Stream for per-video encoding and multi-CDN delivery (Cloudflare reportedly sends some Korean viewers to Tokyo/Hong Kong); over Bunny Stream for maturity; Vimeo and Wistia don't give per-student expiring links on their regular plans. Before launch: check playback in Korea on SKT/KT/LG U+ with Mux Data's per-country start time and buffering. About 20–25 h of video per cohort (Alex, 2026-11-14). Requirement: students must not be able to share a link or download the videos. See section 4. |
| S4 | **Community scope** | ✅ (Alex, 2026-11-14) **One space per cohort.** |
| S5 | **Names shown in the community** | The **first name** from AC (Ashley's team keeps the Korean full name there, e.g. 김지연), editable by the student once. Ashley's posts marked as hers. |
| S6 | **Moderation** | Posts go live immediately. Ashley's team can hide or delete any post or comment and mute a student. Email alert to the team on each new post (not comment) for the first cohorts. |
| S7 | **Podcast feed after launch** | Keep it during phase 1 (offline listening). Decide in phase 2 whether to retire it. |
| S8 | **The Facebook group** | NSMB's private Facebook community is part of the published offer. Moving it here changes what's sold, so Ashley decides when, and the sales page copy changes then. |

---

## 3. Phase 1: web student area

Built on what exists: students, enrolments, cohorts, release rules (`api/_lib/release.js`), access dates, the
private Blob store, the admin and the AC outbox. Each step ships on its own.

### 1a. Listening (replaces the test page) — built 2026-11-14 on `podcast`, not linked yet

Done: sign-in by email code (sent through Google Workspace's Gmail API, Alex 2026-11-14) and by the personal link,
1-year sessions, `/learn` home with "이어 듣기", program page with the player, chapters (ID3 on upload, bulk read and
editing on the Episodes page), progress saved to the account. Still to do in 1a: the admin view of each student's
listening, the AC "listened" tags, and counting web listening as "subscribed" for the `_not_subscribed_3d/7d` reminders
(otherwise web-only students would get them).

- Sign-in (S1) and a home page listing the student's programs, with "이어 듣기" (continue) at the top.
- A program page: modules in order, released / coming (with date) / listened, access end date.
- The player from the test, with progress **saved to the account** (works across phone and computer).
- **Chapters** (Alex, 2026-11-14): the module page lists the chapters made in Podcast Studio (time + title); tapping
  one jumps there, and the current chapter is highlighted while playing. They're also sent to the lock screen title.
  The chapters are already inside each MP3 (ID3 tags, written by the Studio): the site reads them when a file is
  uploaded and saves them with the episode (`episodes.chapters`), and reads them once from the 9 files already uploaded.
  The admin can correct a chapter title or time without re-uploading.
- Audio through the same access-checked route: revoked or expired = stops immediately, nothing left on the phone.
- Admin: per student, which modules they listened to and how far (real listening, not just downloads).
- AC: the existing `_epNN_downloaded` tags get a listened equivalent (e.g. `_epNN_completed` at 90%).

### 1b. Video and PDFs
- A module can have audio, video and files (workbooks, slides). Students see what that module has.
- PDFs from the private Blob store through an access-checked link (download allowed: a PDF can't be protected once opened).
- Video per S3.
- Admin: the Episodes page becomes "Modules", with the extra files.

### 1c. Community
- Posts (text, optional image) and comments, in Korean, per S4–S6.
- Ashley can pin a post (e.g. this week's assignment) and post as herself.
- Email notification when someone replies to your post or comment (through AC, or a plain email sender: to decide).
- Admin: moderation queue, hide/delete, mute.

### 1d. Polish before launch
- "Add to Home Screen" prompt with instructions (the test showed it behaves like an app).
- Android check, accessibility pass, 375px check, load with slow 4G.
- Help page update, welcome email update (the link now opens the student area).

---

## 4. Video protection (S3)

What each layer stops, for 20–25 h per cohort:

| Layer | Stops | Doesn't stop |
|---|---|---|
| Video only plays inside the signed-in student area, through **signed links that expire** (minutes) and are made per student | Copying the link and sending it, embedding it elsewhere | Download tools that grab the stream while it plays |
| **DRM** (FairPlay on Apple, Widevine on Android/Chrome) | Download tools and browser extensions; on iPhone/iPad, screen recordings come out black | Filming the screen with another phone; screen recording on some computers |
| **Watermark** with the student's name on the video | Nothing technically, but a shared or recorded copy shows who it came from, which is the strongest deterrent in practice | — |

Nothing can stop someone filming the screen with another phone. The combination above makes it hard and traceable.

Cost estimates (third-party summaries of the providers' prices, Nov 2026; check the official pages before deciding).
Assumes one cohort = 1,500 min of 1080p video, about 15 students watching it 1.5 times (~34,000 min watched):

| | Mux | Cloudflare Stream |
|---|---|---|
| Storage | ~$0.003/min/month → ~$4.50/month per cohort kept online | $5 per 1,000 min/month → ~$7.50/month per cohort |
| Watching | first 100,000 min/month free → ~$0 | $1 per 1,000 min → ~$34 per cohort |
| Signed links | included | included |
| DRM | add-on, ~$100/month + $0.003 per play | no price found |

Decided: **Mux**, signed links + watermark, no DRM. Vimeo and Wistia were also considered: both lock videos to a domain and hide the download button, but their regular plans have no per-student links that expire, so a link copied from the page keeps working elsewhere. Bunny Stream (signed expiring links included, priced per GB) is the other real option next to Mux.

---

## 5. Phase 2: native app (later)

Only if offline listening or push notifications turn out to matter. iOS + Android from one codebase, using the
same accounts and API as phase 1, so phase 1 is not thrown away:
- Downloads stored encrypted inside the app, deleted when access ends or after N days offline.
- Push notifications (new module, replies).
- App Store review is simpler because the app sells nothing (no in-app purchase rules).
- Needs Apple and Google developer accounts in the company's name.

---

## 6. What stays out

Live chat, direct messages between students, selling inside the student area, gamification (points, levels),
course builder tools beyond what Ashley's programs use.
