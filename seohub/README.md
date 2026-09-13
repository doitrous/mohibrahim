# Binding this site to SEOHub

This is a **static** site (GitHub Pages), not WordPress. SEOHub's WordPress adapter
does not apply here — instead SEOHub binds by committing an articles file to this repo.
GitHub Pages then serves it and `/seohub/` renders it.

## The contract

**File:** `seohub/articles.json` (repo root of the published site — i.e. this folder).
**Shape:** a JSON array of article objects. One object **per language** (localize:`<lang>`
steps each produce their own entry, same `slug`, different `lang`).

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

A `static` / `github` adapter (analogous to the WordPress one) should, per publish:

1. `GET  /repos/doitrous/mohibrahim/contents/seohub/articles.json` → read + `sha`.
2. Upsert the article entries (by `slug`+`lang`).
3. `PUT` the file back with the new content + `sha` (Contents API, Bearer token).

GitHub Pages rebuilds automatically; the article appears at
`/seohub/?slug=<slug>` and in the index at `/seohub/`.

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
