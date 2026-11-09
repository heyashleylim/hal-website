# NSMB waitlist v2: setup and how it works

Name and email first, then the three waitlist questions, one at a time. The same flow runs in three places,
and every answer ends up in the same ActiveCampaign fields.

| Where | Who it's for | `WL Source` |
|---|---|---|
| `/nsmb` (the form in the 등록 안내 section) | people reading the sales page | `nsmb-page` |
| `/nsmb/waitlist` (a page of its own) | Instagram bio, story links, emails | `waitlist-page`, or what `?src=` says |
| `/nsmb/waitlist?c=CODE&src=reconfirm` | people already on the waitlist (personal link) | `reconfirm` |
| ManyChat (comment keyword / DM) | Instagram, without leaving the app | `manychat` |

`?src=` accepts `nsmb-page`, `waitlist-page`, `reconfirm`, `ig-bio`. Anything else is saved as `waitlist-page`.
**Add these values as options of the `WL Source` dropdown in AC** (`manychat` too). If an option is missing,
the site leaves the field empty instead of failing (Vercel's function log says which value had no option).

Code: `site/assets/js/waitlist-flow.js` and `css/waitlist-flow.css` (form), `api/waitlist.js` (endpoint),
`api/_lib/waitlist.js` (logic), `api/_lib/admin/waitlist.js` (admin button), `tests/waitlist/` (`npm test`).
For developers: `tools/waitlist/link-codes.js` does the same as the admin button from a terminal.

## What lands in ActiveCampaign

| When | Fields | Tags |
|---|---|---|
| Step 1 (name, email, consent) | first name, `%WL_LINK_CODE%`, `%WL_SOURCE%` | `signup_waitlist_nsmb`, `nsmb_wl_incomplete` + the double opt-in email (AC form 4) |
| Q1 / Q2 (saved as soon as she moves on) | `%WL_Q1_THING_TO_CHANGE%`, `%WL_Q2_WHAT_ALREADY_TRIED%` | |
| Q3 (the last one) | `%WL_Q3_COMMITTED_TO_WORK%`, `%WL_COMPLETED%` (today, Seoul) | adds `nsmb_wl_12`, removes `nsmb_wl_incomplete` |

- **Q3's dropdown:** the site picks the option whose label or value matches the answer; failing that, the
  option in the same position (1st = 네, 2nd = 고민 중, 3rd = 소식만). Keep the three options in that order.
- **Score and group** (`%WL_SCORE%`, `%WL_GROUP%`) are yours: the site never writes them. Set them after reading
  the answers; your follow-up automations can start from `WL Group` changing.
- Tags are created automatically the first time they're used.

## Double opt-in

Unchanged: step 1 still subscribes through AC form 4 (opt-in confirmation ON, redirect to `/nsmb/confirmed`), so
your confirmation email goes out as before. Her answers are saved even before she confirms.

Two things to set in AC:
1. **Any automation that sells to the waitlist** (pre-sale, "Ready" follow-up) must also require that she has
   **confirmed** (her Master Contact List status is Active), not only a tag or a group.
2. **The `nsmb_wl_incomplete` reminder** ("3가지만 더 알려주세요"): start it from the tag, wait 1 day, check she still
   has `nsmb_wl_incomplete` and is confirmed, then send one email with her personal link (below).

People who come through a personal link are already on the list, so they don't go through the opt-in again.

## Setup checklist (once, in this order)

### 1. Two new settings in Vercel

The site needs two secret settings that only it knows. Vercel calls them "Environment Variables".

| Name | What it does | Value |
|---|---|---|
| `WAITLIST_SECRET` | Signs the personal link codes, so nobody can guess someone else's link | any long random text (40+ characters) |
| `WAITLIST_MANYCHAT_KEY` | A password ManyChat sends with each request, so only ManyChat can send answers | any random text (30+ characters). You'll paste the same text into ManyChat (step 5 of the ManyChat part) |

To make random text without any tool: use a password manager's "generate password" (40 characters, letters and
numbers only), or ask Claude to generate it for you.

In Vercel:
1. Go to vercel.com and open the project **hal-website**.
2. Click **Settings** (top menu), then **Environment Variables** (left menu).
3. Under "Add Environment Variable" (it may be a button **Add New** / **Create new**):
   - **Key:** `WAITLIST_SECRET`
   - **Value:** paste your random text
   - **Environments:** tick **Production** and **Preview** (Development is optional)
   - Leave **Sensitive** on, then click **Save**.
4. Do the same for `WAITLIST_MANYCHAT_KEY` (tick **Production** and **Preview**). Keep a copy of this value in your
   password manager: once saved as Sensitive, Vercel won't show it again, and you need it for ManyChat.
5. **Redeploy** so the site picks them up: settings only apply to new deployments. Either push/merge new code (any
   deploy counts), or go to **Deployments**, open the ⋯ menu of the latest Production deployment, **Redeploy**.

**Never change `WAITLIST_SECRET` after links are sent**: every personal link already in people's inboxes would
stop working. Changing `WAITLIST_MANYCHAT_KEY` is fine as long as you update ManyChat too.

Optional, for testing on a preview link before going live: the double opt-in settings (`AC_FORM_ACTION`,
`AC_FORM_ID`, `AC_FORM_U`, `AC_FORM_OR`) are set for **Production only**. On a preview, sign-ups would be added to
the list without a confirmation email. To test the confirmation email on a preview too: in the same Environment
Variables page, click each of those four, **Edit**, tick **Preview**, **Save**.

### 2. Check it in the admin

Open `https://www.ashleylim.com/admin` (your admin login). The **NSMB waitlist** box shows **OK** next to both
settings once they're in and the site has been redeployed.

### 3. Give the existing waitlist their personal links

In the same **NSMB waitlist** box, click **Give personal links to the waitlist**. It fills `WL Link code` for every
contact tagged `signup_waitlist_nsmb` and shows "Done: N contacts…" when finished (about 1 second per 6 contacts;
keep the page open). New sign-ups get their code automatically. Clicking it again is harmless.

### 4. The email link

In the AC email to the existing waitlist, link the button to:
`https://www.ashleylim.com/nsmb/waitlist?c=%WL_LINK_CODE%&src=reconfirm`

She lands on Q1 with "지은님, 반가워요. 3가지만 여쭤볼게요 🙂", without typing her name or email again.
A "지은님이 아니신가요?" link lets someone else start from step 1.

Why a code and not `?email=…&name=…`: the page removes the code from the address bar before Google Tag Manager
and analytics load, the code reveals nothing about her, and it can't be guessed (it's signed with
`WAITLIST_SECRET`). Her email in a URL would end up in GA, the Meta pixel and browser history, and anyone with a
forwarded email could overwrite her answers.

### Email draft (run it through Ashley's voice before sending)

> 제목: 12기 전에, 3가지만 여쭤봐도 될까요?
>
> %FIRSTNAME%님, 내성만방 대기 리스트에 함께해 주셔서 고마워요.
>
> 12기를 준비하면서, 대기 리스트에 계신 분들께 먼저 연락드리고 싶어요.
> 지금 어떤 변화를 가장 원하시는지 3가지만 알려주시면, 그에 맞춰 안내해 드릴게요. 1분이면 충분해요.
>
> [3가지 질문에 답하기 →]  ← https://www.ashleylim.com/nsmb/waitlist?c=%WL_LINK_CODE%&src=reconfirm
>
> 답이 없으시면 대기 리스트에서는 빠지고, 뉴스레터는 그대로 받아보실 수 있어요.

## ManyChat (Pro)

ManyChat asks the same questions in the DM, then sends everything to the site in one request. The site creates
the AC contact, starts the double opt-in and saves the answers, exactly like the website.

**First:** `WAITLIST_MANYCHAT_KEY` must be set in Vercel (setup step 1). You'll paste the same value in step 9.

**In ManyChat:**
1. **Settings → Fields → User Fields:** create three text fields: `wl_q1`, `wl_q2`, `wl_q3`.
2. **Automation → New automation.** Trigger: *Instagram comment* on chosen posts with a keyword (e.g. `대기`), plus
   the same keyword as a *DM keyword* and a *story reply*.
3. **Message:** "3가지만 여쭤볼게요, 1분이면 돼요 🙂"
4. **Q1:** a message with the Q1 text, then *User Input* → reply type **Text**, save to `wl_q1`.
5. **Q2:** same, saved to `wl_q2`.
6. **Q3:** a message with three **quick replies**. On each reply, add the action *Set User Field* `wl_q3` to
   `a`, `b` or `c`:
   - ⓐ 네, 이번 12기에 시작하고 싶어요 → `a`
   - ⓑ 시작하고 싶지만 시기나 비용을 고민 중이에요 → `b`
   - ⓒ 아직은 소식만 받아보고 싶어요 → `c`
7. **Email:** *User Input* → reply type **Email**, save to the system field **Email**.
8. **Consent:** a message "소식·혜택 이메일을 보내드려도 될까요? 언제든지 수신거부할 수 있어요." with one quick
   reply **"[필수] 동의하고 등록할게요"**. Korean law requires this explicit consent before marketing emails;
   don't skip it or pre-tick it.
9. On that reply: **Action → External Request**:
   - Method `POST`, URL `https://www.ashleylim.com/api/waitlist?action=manychat`
   - Headers: `Content-Type: application/json` and `X-Waitlist-Key: <the WAITLIST_MANYCHAT_KEY value>`
   - Body (insert each `{{…}}` with ManyChat's variable picker, not by typing):
     ```json
     {
       "name": "{{first_name}}",
       "email": "{{email}}",
       "consent": "yes",
       "q1": "{{wl_q1}}",
       "q2": "{{wl_q2}}",
       "q3": "{{wl_q3}}",
       "instagram": "{{ig_username}}"
     }
     ```
   - Use *Test the request* with your own email first: the response should be `{"ok":true,"confirm":true,…}`.
10. **Last message:** "거의 다 됐어요! 이메일함에서 ‘구독 확인’ 버튼을 눌러주세요 💌" with a button to
    `https://www.ashleylim.com/nsmb` ("내성만방 자세히 보기").

If the request fails (the response isn't `"ok":true`), add a fallback message with a button to
`https://www.ashleylim.com/nsmb/waitlist?src=ig-bio` so she can still sign up there.

## Analytics

The form pushes two events to GTM's dataLayer: `waitlist_signup` (step 1 saved) and `waitlist_complete`
(Q3 saved), each with `waitlist_source`. Set up triggers or pixel events for them in GTM if wanted.
