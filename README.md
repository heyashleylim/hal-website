# HAL website

Ashley Lim's marketing site. Static HTML/CSS/JS, deployed on Vercel from this repo.

## Preview locally

```bash
python3 -m http.server 8791 --directory site
```

Then open http://localhost:8791. (In Claude Code, start the `site` preview from `.claude/launch.json`.)

## Deploy

- Push to `main` → production.
- Push any other branch → Vercel preview URL.
- Vercel serves only the `site/` folder (`vercel.json` → `outputDirectory`).

## Where things live

| Path | What |
|------|------|
| `site/` | Everything that is published |
| `site/assets/css/` | `tokens.css` (variables) → `base.css` → `components.css` |
| `site/assets/js/main.js` | Page behaviour (countdown, reveal, video, forms) |
| `site/assets/img/` | WebP images: `shared/` + one folder per page |
| `docs/` | Design system, frame guide, source copy, decisions (not published) |
| `CLAUDE.md` | Working rules for Claude Code |

## NSMB waitlist → ActiveCampaign

The `/nsmb` waitlist form posts to `/api/waitlist` (`api/waitlist.js`, a Vercel function). Each sign-up is
created/updated in ActiveCampaign, tagged `signup_waitlist_nsmb` and added to **Master Contact List**.

Set the variables from `.env.example` in Vercel → Settings → Environment Variables (Production), then redeploy.
For double opt-in, also set `AC_FORM_ACTION`, `AC_FORM_ID`, `AC_FORM_U` and `AC_FORM_OR` (from the form's embed code) for an ActiveCampaign form that subscribes to
Master Contact List with opt-in confirmation turned on; visitors then see the "확인 이메일" message.

The local `python3 -m http.server` preview can't run the function; test the form on a Vercel preview deployment.
