# Dr. Mohamed Shalaby — Orthodontics landing site

Bilingual (Arabic RTL / English LTR) static site for Dr. Mohamed Ibrahim Shalaby,
consultant orthodontist — Cairo & Saudi Arabia. No build step; plain HTML/CSS/JS.

## Structure
```
index.html        Landing page (reads content.json, falls back to inline defaults)
content.json      Editable content (contact, hero, stats, guarantee, reviews, SEO, legal)
legal.html        Privacy / Terms / Medical disclaimer  (?doc=privacy|terms|disclaimer)
seohub/           Blog section bound to SEOHub (see seohub/README.md)
admin/            Content editor with live preview + GitHub publishing  (/admin/)
images/           Doctor photo + before/after case photos
robots.txt, sitemap.xml, .nojekyll
```

## Run locally
```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
(Open via a server, not file://, so `content.json` loads.)

## Editing content
Open `/admin/` → edit fields with live preview → **Publish** (needs a GitHub
fine-grained token with Contents: read/write on this repo) or **Download JSON**
and commit `content.json` yourself.

## Deploy (GitHub Pages)
Settings → Pages → Deploy from branch → `main` / root. Live at
`https://doitrous.github.io/mohibrahim/`. Update the domain in `sitemap.xml`,
`robots.txt` and the `<link rel=canonical>`/`og:` tags if you add a custom domain.

## SEOHub
Blog articles are served from `seohub/articles.json`. See `seohub/README.md`
for the exact binding contract.
