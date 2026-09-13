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
.env.example         ADMIN_PASSWORD, SESSION_SECRET, HUB_TOKEN, DATA_DIR
public/              the site (index.html, legal.html, admin/, seohub/, images/, content.json seed)
data/                runtime store (content.json, articles.json) — mount a volume here
```

## API
```
GET  /api/content            public — site content
PUT  /api/content            admin  — replace content (session cookie)
GET  /api/articles           public — SEOHub blog articles
POST /api/articles           SEOHub — publish (custom-adapter envelope or bare)  (Bearer HUB_TOKEN)
POST /api/seo/sync           SEOHub — snapshot ack  (Bearer HUB_TOKEN)
GET  /api/seo/pages          SEOHub — page registry (empty)  (Bearer HUB_TOKEN)
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
1. New Resource → **Application** → your GitHub repo `doitrous/mohibrahim` → branch `main`.
2. Build pack: **Dockerfile**. Port: **3000**.
3. **Storage** → add a Persistent Volume mounted at `/app/data` (keeps content & articles).
4. **Environment**: `ADMIN_PASSWORD`, `SESSION_SECRET` (long random), `HUB_TOKEN` (for SEOHub).
5. Set the domain, then **Deploy**. Update the domain in `public/sitemap.xml`,
   `public/robots.txt` and the canonical/`og:` tags in `public/index.html`.

## SEOHub
This site is a **custom-adapter receiver**. Register it in SEOHub as a `custom`
site with `url` = the deployed site and `secret` = this site's `HUB_TOKEN`; the
hub's built-in `custom` adapter then publishes over HTTP (no code needed in the
hub). See `public/seohub/README.md` for the envelope, response and endpoints.
