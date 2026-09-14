# Dr. Mohamed Shalaby — Orthodontics site + backend

Bilingual (Arabic RTL / English LTR) marketing site for Dr. Mohamed Ibrahim Shalaby,
consultant orthodontist — Cairo & Saudi Arabia. A small Node/Express app serves the
static site **and** a content API so the `/admin` dashboard and SEOHub can edit it
live, with no rebuilds and no GitHub commits.

## Layout
```
server.js            Express: static site + content/admin/SEOHub API
package.json         deps: express
Dockerfile           container (node:20-alpine, port 3000)
docker-compose.yml   local run with a persisted volume
.env.example         ADMIN_PASSWORD, SESSION_SECRET, HUB_TOKEN, DATA_DIR,
                     SEO_HUB_URL, SEO_HUB_SECRET, SEO_SITE_SLUG
public/              the site (index.html, legal.html, admin/, seohub/, images/, content.json seed)
data/                runtime store (content.json, articles.json) — mount a volume here
```

## API
```
GET  /api/content            public — site content
PUT  /api/content            admin  — replace content (session cookie)
GET  /api/articles           public — SEOHub blog articles
POST /api/articles           seo-runtime — publish (spec-1 envelope)         (Bearer SEO_HUB_SECRET)
/api/seo/health, /api/seo/sync, /api/seo/pages,
/api/seo/pending|approve|reject|publish-now       seo-runtime contract       (Bearer SEO_HUB_SECRET)
GET  /api/pay/config         public — { enabled, amount, currency }
POST /api/pay/create         public — start a PayTabs payment -> { redirect_url }
POST /api/pay/callback       PayTabs IPN (HMAC-verified)
ALL  /api/pay/return         PayTabs browser return -> redirects to /pay/
GET  /api/payments           admin  — list payments (session cookie)
POST /api/login {password}   -> HttpOnly session cookie
POST /api/logout · GET /api/me
```
Content persists as JSON in `DATA_DIR`. The site falls back to `public/content.json`
if the API is unavailable, so it still renders as a plain static site too.

## Run locally
```bash
npm install
ADMIN_PASSWORD=secret SESSION_SECRET=dev node server.js   # http://localhost:3000
# or: docker compose up --build
```

## Edit content
Open `/admin/`, log in with `ADMIN_PASSWORD`, edit with live preview, **Save & publish**
(writes to the backend — live immediately). Tabs: Content · Offer · Contact · Reviews · SEO · Legal.

## Deploy on Coolify (project: mohibrahim)
Already deployed at **https://mohibrahim.com** (build pack **Nixpacks** — `npm start`
runs `node server.js`; Dockerfile also works). Auto-deploy on push to `main` is on.
1. New Resource → **Application** → your GitHub repo `doitrous/mohibrahim` → branch `main`.
2. Build pack: **Nixpacks** (or Dockerfile). Port: **3000**.
3. **Storage** → add a Persistent Volume mounted at `/app/data` (keeps content,
   articles & payments across redeploys — **without it these reset on every deploy**).
4. **Environment**: `ADMIN_PASSWORD`, `SESSION_SECRET` (long random), `HUB_TOKEN` (legacy
   custom-adapter SEOHub, still used by `DELETE /api/articles/:slug`), `SITE_URL=https://mohibrahim.com`,
   the PayTabs keys below, and the seo-runtime vars: `SEO_HUB_URL`, `SEO_HUB_SECRET`, `SEO_SITE_SLUG=mohibrahim`.
5. Domains/canonical/sitemap already point to `mohibrahim.com`. Push to `main` to deploy.

## Online payment (PayTabs)

Patients pay the consultation online from the offer section ("ادفع استشارتك أونلاين").
The gateway is **fully wired** — it just needs the merchant keys. Until they are set,
the pay button stays hidden and the site falls back to WhatsApp booking.

Set these env vars (from your PayTabs merchant dashboard → **Profile**):

```
PAYTABS_PROFILE_ID   your PayTabs Profile ID
PAYTABS_SERVER_KEY   your PayTabs Server Key
PAYTABS_ENDPOINT     region base URL (default https://secure-egypt.paytabs.com)
PAYTABS_CURRENCY     default EGP
SITE_URL             https://mohibrahim.com  (used for callback/return URLs)
```

Region endpoints: Egypt `https://secure-egypt.paytabs.com` · Saudi `https://secure.paytabs.sa`
· UAE/global `https://secure.paytabs.com`. The charged amount is the **offer price** in
`/admin` (currently 200), so editing the price also changes what patients pay.

Flow: the offer button opens the branded checkout page **`/pay/`** (collects name/phone/
email, shows what's included + the refund guarantee), which `POST`s `/api/pay/create` to
open a PayTabs hosted page → patient pays → PayTabs calls `POST /api/pay/callback`
(HMAC-verified) and returns the browser to `/api/pay/return`, which verifies server-side
and redirects to the result page **`/pay/result?status=…`**. Records land in
`data/payments.json`; the doctor can review them at `GET /api/payments` (admin cookie).
In the PayTabs dashboard no extra config is needed — the callback/return URLs are sent
per transaction.

## SEOHub

The site runs [`@omary98/seo-runtime-express`](https://www.npmjs.com/package/@omary98/seo-runtime-express)
(mounted in `server.js`, after the static file handler so the existing `/robots.txt` and
`/sitemap.xml` under `public/` keep winning). It gives the hub `/api/seo/health`,
`/api/seo/sync`, `/api/seo/pages`, the pending/approve/reject/publish-now proxy, and
`POST /api/articles` — the last one still writes into the same `data/articles.json` the
public `GET /api/articles` blog listing reads, via an `onArticle` hook, so nothing about the
visible blog changes.

Set these three env vars in Coolify (the hub owner does this after merge):

```
SEO_HUB_URL      https://<seo-hub-host>
SEO_HUB_SECRET   this site's runtime secret, registered in the hub
SEO_SITE_SLUG    mohibrahim   (only required until the first successful sync)
```

The runtime's own snapshot/article store is a `JsonFileStore` at `data/seo-runtime.json`
(inside `DATA_DIR`, so it survives redeploys as long as the existing volume is mounted).

The old custom-adapter routes (`Bearer HUB_TOKEN`) are gone except for
`DELETE /api/articles/:slug`, which SEOHub's `custom` adapter never called in practice —
see `public/seohub/README.md` for that adapter's original envelope shape, now superseded by
the seo-runtime contract above.
