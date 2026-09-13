'use strict';
/*
 * Dr. Mohamed Shalaby — site backend.
 * Serves the static site from /public and provides:
 *   GET  /api/content            public — site content (JSON)
 *   PUT  /api/content            admin  — replace site content (cookie auth)
 *   GET  /api/articles           public — SEOHub blog articles (JSON array)
 *   POST /api/articles           SEOHub — publish (custom-adapter envelope) (Bearer HUB_TOKEN)
 *   POST /api/seo/sync           SEOHub — snapshot ack (Bearer HUB_TOKEN)
 *   GET  /api/seo/pages          SEOHub — page registry (Bearer HUB_TOKEN)
 *   POST /api/login {password}   -> sets HttpOnly session cookie
 *   POST /api/logout
 *   GET  /api/me                 -> { admin: bool }
 * Content persists as JSON files in DATA_DIR (mount a volume there in production).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString('hex');
const HUB_TOKEN = process.env.HUB_TOKEN || '';

fs.mkdirSync(DATA, { recursive: true });

function seed(dataName, seedPath, fallback) {
  const dest = path.join(DATA, dataName);
  if (!fs.existsSync(dest)) {
    if (seedPath && fs.existsSync(seedPath)) fs.copyFileSync(seedPath, dest);
    else fs.writeFileSync(dest, fallback);
  }
  return dest;
}
const CONTENT = seed('content.json', path.join(PUBLIC, 'content.json'), '{}');
const ARTICLES = seed('articles.json', path.join(PUBLIC, 'seohub', 'articles.json'), '[]');

// ---- tiny signed-token session (no external dep) ----
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b).digest('base64url');
  return b + '.' + sig;
}
function verify(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const i = tok.lastIndexOf('.');
  const b = tok.slice(0, i), sig = tok.slice(i + 1);
  const exp = crypto.createHmac('sha256', SESSION_SECRET).update(b).digest('base64url');
  const a = Buffer.from(sig), e = Buffer.from(exp);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (_) { return null; }
}
function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach(function (c) {
    const i = c.indexOf('='); if (i < 0) return;
    out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAdmin(req) { return !!verify(parseCookies(req.headers.cookie).sid); }
function requireAdmin(req, res, next) { if (isAdmin(req)) return next(); res.status(401).json({ error: 'unauthorized' }); }
function requireHub(req, res, next) {
  const a = req.headers.authorization || '';
  if (HUB_TOKEN && a === 'Bearer ' + HUB_TOKEN) return next();
  res.status(401).json({ error: 'unauthorized' });
}

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', function (_req, res) { res.json({ ok: true }); });

app.post('/api/login', function (req, res) {
  if (!ADMIN_PASSWORD || (req.body && req.body.password) !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong password' });
  }
  const tok = sign({ role: 'admin', exp: Date.now() + 7 * 864e5 });
  const secure = (req.headers['x-forwarded-proto'] === 'https') || req.secure;
  res.setHeader('Set-Cookie', 'sid=' + tok + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + (7 * 86400) + (secure ? '; Secure' : ''));
  res.json({ ok: true });
});
app.post('/api/logout', function (_req, res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', function (req, res) { res.json({ admin: isAdmin(req) }); });

app.get('/api/content', function (_req, res) {
  res.type('application/json').send(fs.readFileSync(CONTENT, 'utf8'));
});
app.put('/api/content', requireAdmin, function (req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'invalid content' });
  fs.writeFileSync(CONTENT, JSON.stringify(body, null, 2));
  res.json({ ok: true });
});

app.get('/api/articles', function (_req, res) {
  res.type('application/json').send(fs.readFileSync(ARTICLES, 'utf8'));
});

// Public base URL for building remoteUrl (SITE_URL env, else the incoming request).
function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host);
}
function articleUrl(base, slug, lang) {
  return base + '/seohub/?slug=' + encodeURIComponent(slug) + (lang && lang !== 'ar' ? '&lang=' + lang : '');
}
// Validate the fields we render. New parity fields are optional; a present-but-malformed
// one is a 400 (its value reaches a rendered page). Returns an error string or null.
function badArticle(a, i) {
  const need = ['lang', 'title', 'slug', 'bodyMd'];
  for (const k of need) if (typeof a[k] !== 'string' || !a[k].trim()) return 'invalid articles[' + i + '].' + k;
  if (a.references != null) {
    if (!Array.isArray(a.references)) return 'invalid articles[' + i + '].references';
    for (const r of a.references) {
      if (!r || typeof r.title !== 'string' || !r.title.trim()) return 'invalid articles[' + i + '].references';
      if (typeof r.url !== 'string' || !/^https:\/\//i.test(r.url)) return 'invalid articles[' + i + '].references';
    }
  }
  if (a.faq != null && !Array.isArray(a.faq)) return 'invalid articles[' + i + '].faq';
  return null;
}

// SEOHub receiver. Accepts either the custom-adapter envelope { ..., articles:[...] }
// (returns { results:[{lang,remoteId,remoteUrl}] }) or a bare article / array (legacy).
app.post('/api/articles', requireHub, function (req, res) {
  const body = req.body || {};
  const envelope = Array.isArray(body.articles);
  const incoming = envelope ? body.articles : (Array.isArray(body) ? body : [body]);
  if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ error: 'no articles' });

  for (let i = 0; i < incoming.length; i++) {
    const err = badArticle(incoming[i] || {}, i);
    if (err) return res.status(400).json({ error: err });
  }

  let arr; try { arr = JSON.parse(fs.readFileSync(ARTICLES, 'utf8')); } catch (_) { arr = []; }
  if (!Array.isArray(arr)) arr = [];

  // Top-level envelope fields shared by every language, folded onto each stored article.
  const shared = envelope ? {
    externalId: body.externalId, author: body.author, reviewer: body.reviewer,
    reviewedAt: body.reviewedAt, checklist: body.checklist, cta: body.cta,
    plannedUpdateAt: body.plannedUpdateAt, image: body.image,
  } : {};

  const base = baseUrl(req);
  const results = [];
  incoming.forEach(function (a) {
    const lang = a.lang || 'ar';
    const stored = Object.assign({}, envelope ? shared : {}, a, { lang: lang });
    const i = arr.findIndex(function (x) { return x.slug === a.slug && (x.lang || 'ar') === lang; });
    if (i >= 0) arr[i] = stored; else arr.push(stored);
    results.push({ lang: lang, remoteId: a.slug + ':' + lang, remoteUrl: articleUrl(base, a.slug, lang) });
  });

  fs.writeFileSync(ARTICLES, JSON.stringify(arr, null, 2));
  res.json({ results: results, skipped: [], ok: true, count: arr.length });
});
// allow SEOHub to delete an article: DELETE /api/articles/:slug?lang=ar
app.delete('/api/articles/:slug', requireHub, function (req, res) {
  let arr; try { arr = JSON.parse(fs.readFileSync(ARTICLES, 'utf8')); } catch (_) { arr = []; }
  const lang = req.query.lang;
  arr = arr.filter(function (x) { return !(x.slug === req.params.slug && (!lang || (x.lang || 'ar') === lang)); });
  fs.writeFileSync(ARTICLES, JSON.stringify(arr, null, 2));
  res.json({ ok: true, count: arr.length });
});

// SEOHub runtime contract (custom adapter). On every publish tick the hub pushes a
// snapshot and pulls the page registry; both are non-fatal on the hub, but answering
// them keeps the site's runtime status green. Auth = the same Bearer HUB_TOKEN
// (register the custom site in the hub with secret = HUB_TOKEN).
app.post('/api/seo/sync', requireHub, function (_req, res) { res.json({ ok: true }); });
app.get('/api/seo/pages', requireHub, function (_req, res) { res.json({ pages: [] }); });

app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.listen(PORT, function () { console.log('Shalaby site listening on :' + PORT); });
