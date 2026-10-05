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
