# Binding this site to SEOHub

This site runs its own **Node backend** (`server.js`), so it is a **custom-adapter
receiver** for SEOHub — no GitHub commits, no rebuilds. The hub's built-in
`custom` adapter (`lib/adapters/custom.ts`) pushes articles over HTTP; this site
stores them and renders them at `/seohub/`.

## Register the site in SEOHub

Add it as a **custom** site with:

```
url    = https://mohibrahim.com     (the deployed site)
secret = <the same value as this site's HUB_TOKEN env>
```

The hub authenticates every call with `Authorization: Bearer <secret>`, so
`secret` on the hub must equal `HUB_TOKEN` on the site.

## Endpoints the hub calls (all Bearer HUB_TOKEN)

```
POST   /api/articles        publish/update — the custom-adapter envelope (below)
POST   /api/seo/sync        snapshot push  — acked (200); site has no hub-managed settings
GET    /api/seo/pages       page registry  — returns { "pages": [] } (no provider pages)
```

Plus the public/maintenance routes:

```
GET    /api/articles                 → the full stored array (public, for the renderer)
DELETE /api/articles/:slug?lang=ar   → remove one (Bearer HUB_TOKEN)
```

## POST /api/articles — the envelope

The `custom` adapter sends **one POST per publish** carrying every language, plus
shared top-level fields:

```json
{
  "externalId": 42,
  "author":   { "name": "Dr. Mohamed Shalaby" },
  "reviewer": { "name": "…", "credentials": "…", "bio": "…" },
  "reviewedAt": { "medical": "2026-09-01T10:00:00.000Z", "seo": null },
  "checklist": {},
  "cta": { "text": "احجز استشارتك", "url": "https://…/#book" },
  "plannedUpdateAt": null,
  "image": { "url": "https://hub/api/images/job/42", "alt": "…" },
  "articles": [
    {
      "lang": "ar",
      "title": "دليلك الكامل للتقويم الشفاف",
      "slug": "invisible-braces-guide",
      "metaTitle": "التقويم الشفاف | د. محمد شلبي",
      "metaDescription": "…",
      "bodyMd": "## ما هو التقويم؟\nنص Markdown…",
      "faq": [{ "q": "…", "a": "…" }],
      "references": [{ "title": "WHO", "url": "https://who.int" }],
      "introduction": "…", "secondaryKeywords": ["…"], "searchIntent": "informational",
      "og": { "title": "…", "description": "…" }, "hreflang": [], "schemaJsonld": null, "sections": null
    }
  ]
}
```

- The receiver **upserts by (`slug` + `lang`)** and folds the shared top-level
  fields (`cta`, `reviewer`, `reviewedAt`, `image`, …) onto each stored article so
  the renderer can show them.
- A **bare article object or array** (no `articles` wrapper) is also accepted for
  manual/legacy pushes.
- Required per article: `lang`, `title`, `slug`, `bodyMd` (non-empty). New parity
  fields are **optional**; a present-but-malformed one is a **400**
  (`invalid articles[0].references`). **Reference URLs must be `https://`.**

### Response (what the adapter expects)

```json
{ "results": [ { "lang": "ar", "remoteId": "invisible-braces-guide:ar",
                 "remoteUrl": "https://mohibrahim.com/seohub/?slug=invisible-braces-guide" } ],
  "skipped": [] }
```

`remoteUrl` is built from `SITE_URL` (env) or the incoming request host.

## SEO plumbing already provided by the site

- `/robots.txt` and `/sitemap.xml` at the site root.
- `hreflang` alternates (`ar`, `en`, `x-default`) on the home page.
- Per-article `<title>`, meta description and `Article` JSON-LD injected on render.
- Site-verification `<meta>` editable in `/admin` (SEO tab) → written to `content.json`.

## Known limit

Articles render client-side from `/api/articles`. Google renders JS and indexes
them, but for maximum crawlability a future step is to have the receiver also
write a pre-rendered `seohub/<slug>.html` and add it to `sitemap.xml`. The data
contract above is unchanged either way.
