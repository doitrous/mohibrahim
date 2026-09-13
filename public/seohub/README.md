# Binding this site to SEOHub

This site runs its own **Node backend** (`server.js`), so SEOHub binds over **HTTP**,
exactly like an adapter — no GitHub commits involved. Articles are pushed to the
site's API and stored server-side; `/seohub/` renders them from `/api/articles`.

## The API contract (a `static`/`http` adapter on the hub)

Base URL = the deployed site (e.g. `https://mohibrahim.doitrous.com`).
Auth = `Authorization: Bearer <HUB_TOKEN>` (the same `HUB_TOKEN` env you set on the site).

```
GET    /api/articles                 → the full array (public)
POST   /api/articles                 → upsert one article or an array (Bearer HUB_TOKEN)
DELETE /api/articles/:slug?lang=ar   → remove one (Bearer HUB_TOKEN)
```

`POST` upserts by (`slug` + `lang`). Send one object or an array of them.

## Article shape

One object **per language** (localize:`<lang>` steps each produce their own entry,
same `slug`, different `lang`).

```json
[
  {
    "slug": "invisible-braces-guide",
    "lang": "ar",
    "title": "دليلك الكامل للتقويم الشفاف",
    "metaTitle": "التقويم الشفاف: المزايا والتكلفة | د. محمد شلبي",
    "metaDescription": "كل ما تريد معرفته عن التقويم الشفاف…",
    "keyword": "تقويم شفاف",
    "bodyMd": "## ما هو التقويم الشفاف؟\nنص المقال بصيغة Markdown…\n\n- نقطة\n- نقطة",
    "faq": [{ "q": "هل التقويم الشفاف مؤلم؟", "a": "لا، …" }],
    "internalLinks": [{ "title": "خطوات العلاج", "slug": "treatment-steps" }],
    "date": "2026-09-13"
  }
]
```

Field names match SEOHub's `draft` step payload (`title, metaTitle, metaDescription,
slug, bodyMd, keyword, faq[], internalLinks[]`) plus `lang` and `date`. `bodyMd` is
Markdown (`##`/`###` headings, `-` lists, `**bold**`, `[text](url)`).

## What the hub adapter needs to do

Add an adapter (analogous to the WordPress one) whose config is `{ baseUrl, hubToken }`
and which, per publish, `POST`s the localized article object(s) to `POST {baseUrl}/api/articles`
with the bearer token. The article appears immediately at `/seohub/?slug=<slug>` and in
the index at `/seohub/`. No rebuild/commit needed.

## SEO plumbing already provided by the site (the WP plugin's job, done statically)

- `/robots.txt` and `/sitemap.xml` at the site root.
- `hreflang` alternates (`ar`, `en`, `x-default`) on the home page.
- Per-article `<title>`, meta description and `Article` JSON-LD injected on render.
- Site-verification `<meta>` is editable in `/admin` (SEO tab) → written to `content.json`.

## Known limit (be honest about it)

Articles render client-side from `articles.json`. Google renders JS and will index them,
but for maximum crawlability a future improvement is to have the adapter also commit a
pre-rendered `seohub/<slug>.html` per article and add it to `sitemap.xml`. The data
contract above stays the same either way.
