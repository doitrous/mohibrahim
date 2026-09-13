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
 *   GET  /api/pay/config         public — online payment availability + amount
 *   POST /api/pay/create         public — start a PayTabs hosted payment
 *   POST /api/pay/callback       PayTabs IPN (HMAC-verified) · ALL /api/pay/return
 *   GET  /api/payments           admin  — list recorded payments
 *   GET  /api/schedule           public — availability (weekly + one-time exceptions)
 *   PUT  /api/schedule           admin  — set availability
 *   GET  /api/slots?date=        public — bookable times for a date
 *   GET  /api/slots/month?ym=    public — per-day available counts (calendar)
 *   POST /api/appointments       public — book a slot; GET/DELETE (admin) manage
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
const PAYMENTS = seed('payments.json', null, '[]');
const DEFAULT_SCHEDULE = {
  timezone: 'Africa/Cairo', slotMinutes: 30, capacity: 1, requirePayment: true, note: { ar: '', en: '' },
  weekly: {
    '0': { open: true, ranges: [['16:00', '21:00']] }, '1': { open: true, ranges: [['16:00', '21:00']] },
    '2': { open: true, ranges: [['16:00', '21:00']] }, '3': { open: true, ranges: [['16:00', '21:00']] },
    '4': { open: true, ranges: [['16:00', '21:00']] }, '5': { open: false, ranges: [] },
    '6': { open: true, ranges: [['16:00', '21:00']] },
  },
  exceptions: [],
};
const SCHEDULE = seed('schedule.json', null, JSON.stringify(DEFAULT_SCHEDULE, null, 2));
const APPTS = seed('appointments.json', null, '[]');

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
app.use(express.json({ limit: '4mb', verify: function (req, _res, buf) { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false })); // PayTabs return posts form-encoded

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

// ---- PayTabs online consultation payment (hosted payment page) ----
// Fully wired; needs only the keys. Set PAYTABS_PROFILE_ID + PAYTABS_SERVER_KEY
// (and PAYTABS_ENDPOINT for your region — default is Egypt, since the price is EGP).
function paytabsCfg() {
  const profileId = process.env.PAYTABS_PROFILE_ID || '';
  const serverKey = process.env.PAYTABS_SERVER_KEY || '';
  const endpoint = (process.env.PAYTABS_ENDPOINT || 'https://secure-egypt.paytabs.com').replace(/\/+$/, '');
  return { ok: !!(profileId && serverKey), profileId, serverKey, endpoint };
}
// Price is the editable consultation offer price, so /admin edits flow through to the gateway.
function consultPrice() {
  let amount = '200';
  try { const c = JSON.parse(fs.readFileSync(CONTENT, 'utf8')); if (c.offer && c.offer.price != null) amount = String(c.offer.price); } catch (_) {}
  const n = Number(amount); return { amount: (n > 0 ? n : 200), currency: process.env.PAYTABS_CURRENCY || 'EGP' };
}
function readPayments() { try { const a = JSON.parse(fs.readFileSync(PAYMENTS, 'utf8')); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function writePayments(a) { fs.writeFileSync(PAYMENTS, JSON.stringify(a, null, 2)); }
function upsertPayment(match, patch) {
  const a = readPayments();
  const i = a.findIndex(match);
  if (i >= 0) a[i] = Object.assign({}, a[i], patch); else a.push(patch);
  writePayments(a);
}
async function ptFetch(cfg, route, body) {
  const r = await fetch(cfg.endpoint + route, {
    method: 'POST',
    headers: { authorization: cfg.serverKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// Patient starts a payment; returns the PayTabs hosted-page URL to redirect to.
app.post('/api/pay/create', async function (req, res) {
  const cfg = paytabsCfg();
  if (!cfg.ok) return res.status(503).json({ error: 'payment_unconfigured' });
  const { amount, currency } = consultPrice();
  const b = req.body || {};
  const cartId = 'cons-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const appt = b.appointmentId ? readAppts().find(function (x) { return x.id === b.appointmentId; }) : null;
  const desc = appt ? ('Consultation ' + appt.date + ' ' + appt.time + ' — Dr. Mohamed Shalaby') : 'Consultation — Dr. Mohamed Shalaby';
  const base = baseUrl(req);
  try {
    const j = await ptFetch(cfg, '/payment/request', {
      profile_id: cfg.profileId, tran_type: 'sale', tran_class: 'ecom',
      cart_id: cartId, cart_currency: currency, cart_amount: amount,
      cart_description: desc,
      paypage_lang: b.lang === 'en' ? 'en' : 'ar',
      customer_details: {
        name: (b.name || (appt && appt.name) || 'Patient').slice(0, 60), email: (b.email || (appt && appt.email) || '').slice(0, 100),
        phone: (b.phone || (appt && appt.phone) || '').slice(0, 30), country: 'EG',
      },
      callback: base + '/api/pay/callback',
      return: base + '/api/pay/return',
    });
    if (!j || !j.redirect_url) return res.status(502).json({ error: 'gateway_error', detail: j });
    upsertPayment(function (x) { return x.cartId === cartId; }, {
      cartId: cartId, tranRef: j.tran_ref, amount: amount, currency: currency, status: 'pending',
      appointmentId: b.appointmentId || null,
      name: b.name || (appt && appt.name) || '', email: b.email || (appt && appt.email) || '', phone: b.phone || (appt && appt.phone) || '', createdAt: new Date().toISOString(),
    });
    res.json({ redirect_url: j.redirect_url, tran_ref: j.tran_ref });
  } catch (e) { res.status(502).json({ error: 'gateway_error', detail: String(e && e.message || e) }); }
});

// Server-to-server IPN. Verified by HMAC-SHA256(rawBody, serverKey) against the `signature` header.
app.post('/api/pay/callback', function (req, res) {
  const cfg = paytabsCfg();
  if (!cfg.ok) return res.status(503).end();
  const sig = String(req.headers.signature || '');
  const expected = crypto.createHmac('sha256', cfg.serverKey).update(req.rawBody || Buffer.from('')).digest('hex');
  const a = Buffer.from(sig), e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return res.status(400).json({ error: 'bad_signature' });
  const b = req.body || {};
  const st = (b.payment_result && b.payment_result.response_status) || b.respStatus;
  const ref = b.tran_ref || b.tranRef;
  upsertPayment(function (x) { return x.tranRef === ref || x.cartId === b.cart_id; },
    { tranRef: ref, cartId: b.cart_id, status: st === 'A' ? 'paid' : 'failed', responseStatus: st, callbackAt: new Date().toISOString() });
  if (st === 'A') markApptPaid(ref);
  res.json({ ok: true });
});

// Browser lands here after paying; we verify server-side, then redirect to the result page.
app.all('/api/pay/return', async function (req, res) {
  const cfg = paytabsCfg();
  const src = Object.assign({}, req.query, req.body);
  const ref = src.tranRef || src.tran_ref;
  let ok = false;
  if (cfg.ok && ref) {
    try {
      const j = await ptFetch(cfg, '/payment/query', { profile_id: cfg.profileId, tran_ref: ref });
      const st = j && j.payment_result && j.payment_result.response_status;
      ok = st === 'A';
      upsertPayment(function (x) { return x.tranRef === ref; }, { tranRef: ref, status: ok ? 'paid' : 'failed', responseStatus: st, verifiedAt: new Date().toISOString() });
      if (ok) markApptPaid(ref);
    } catch (_) {}
  }
  res.redirect('/pay/result?status=' + (ok ? 'success' : 'failed') + (ref ? '&ref=' + encodeURIComponent(ref) : ''));
});

// Doctor/admin can review payments.
app.get('/api/payments', requireAdmin, function (_req, res) { res.json(readPayments()); });
// Public: is online payment available + how much (so the UI can hide the button if unconfigured).
app.get('/api/pay/config', function (_req, res) { const p = consultPrice(); res.json({ enabled: paytabsCfg().ok, amount: p.amount, currency: p.currency }); });

// ---- Appointments / scheduling (availability + patient booking) ----
function readJson(file, fb) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fb; } }
function readSchedule() { const s = readJson(SCHEDULE, null); return (s && typeof s === 'object') ? s : DEFAULT_SCHEDULE; }
function readAppts() { const a = readJson(APPTS, []); return Array.isArray(a) ? a : []; }
function writeAppts(a) { fs.writeFileSync(APPTS, JSON.stringify(a, null, 2)); }
function hhmmToMin(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); if (!m) return null; const h = +m[1], mi = +m[2]; return (h > 23 || mi > 59) ? null : h * 60 + mi; }
function minToHHMM(x) { return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
function cleanRanges(r) {
  return (Array.isArray(r) ? r : []).map(function (x) {
    return (Array.isArray(x) && hhmmToMin(x[0]) != null && hhmmToMin(x[1]) != null && hhmmToMin(x[1]) > hhmmToMin(x[0])) ? [x[0], x[1]] : null;
  }).filter(Boolean);
}
// "now" in the clinic timezone, so past-slot filtering is correct regardless of server TZ.
function cairoNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: (readSchedule().timezone || 'Africa/Cairo'), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour) * 60 + (+p.minute) };
}
function rangesFor(sch, dateStr) {
  const wd = new Date(dateStr + 'T00:00:00').getDay();
  const exs = (sch.exceptions || []).filter(function (e) { return e && isDate(e.from) && dateStr >= e.from && dateStr <= (e.to || e.from); });
  if (exs.length) {
    const e = exs[exs.length - 1]; // last matching exception wins
    if (e.type === 'closed') return [];
    if (Array.isArray(e.ranges) && e.ranges.length) return e.ranges;
  }
  const w = (sch.weekly || {})[String(wd)];
  return (w && w.open && Array.isArray(w.ranges)) ? w.ranges : [];
}
function slotsFor(sch, dateStr) {
  const step = Math.max(5, +sch.slotMinutes || 30), out = [];
  rangesFor(sch, dateStr).forEach(function (r) {
    const a = hhmmToMin(r[0]), b = hhmmToMin(r[1]); if (a == null || b == null || b <= a) return;
    for (let t = a; t + step <= b; t += step) out.push(minToHHMM(t));
  });
  return out;
}
function takenCounts(dateStr) {
  const now = Date.now(), TTL = 20 * 60 * 1000, m = {};
  readAppts().forEach(function (x) {
    if (x.date !== dateStr || x.status === 'cancelled') return;
    if (x.status === 'pending' && x.createdAt && (now - Date.parse(x.createdAt)) > TTL) return; // abandoned hold expires
    m[x.time] = (m[x.time] || 0) + 1;
  });
  return m;
}
function availableSlots(sch, dateStr, today, nowMin) {
  const cap = Math.max(1, +sch.capacity || 1), taken = takenCounts(dateStr);
  return slotsFor(sch, dateStr).filter(function (t) {
    if (dateStr === today && hhmmToMin(t) <= nowMin) return false;
    return (taken[t] || 0) < cap;
  });
}
function markApptPaid(tranRef) {
  const pay = readPayments().find(function (p) { return p.tranRef === tranRef; });
  if (!pay || !pay.appointmentId) return;
  const a = readAppts(); let ch = false;
  a.forEach(function (x) { if (x.id === pay.appointmentId && x.status !== 'cancelled') { x.status = 'paid'; x.tranRef = tranRef; ch = true; } });
  if (ch) writeAppts(a);
}

app.get('/api/schedule', function (_req, res) { res.json(readSchedule()); });
app.put('/api/schedule', requireAdmin, function (req, res) {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'invalid' });
  const sch = {
    timezone: 'Africa/Cairo', slotMinutes: Math.max(5, +b.slotMinutes || 30), capacity: Math.max(1, +b.capacity || 1),
    requirePayment: b.requirePayment !== false,
    note: (b.note && typeof b.note === 'object') ? { ar: String(b.note.ar || ''), en: String(b.note.en || '') } : { ar: '', en: '' },
    weekly: {}, exceptions: [],
  };
  for (let d = 0; d < 7; d++) { const w = (b.weekly || {})[String(d)] || {}; sch.weekly[String(d)] = { open: !!w.open, ranges: cleanRanges(w.ranges) }; }
  (Array.isArray(b.exceptions) ? b.exceptions : []).slice(0, 300).forEach(function (e) {
    if (!e || !isDate(e.from)) return;
    sch.exceptions.push({
      id: String(e.id || ('ex-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'))),
      from: e.from, to: isDate(e.to) ? e.to : e.from, type: e.type === 'closed' ? 'closed' : 'open',
      ranges: cleanRanges(e.ranges),
      note: (e.note && typeof e.note === 'object') ? { ar: String(e.note.ar || ''), en: String(e.note.en || '') } : { ar: '', en: '' },
    });
  });
  fs.writeFileSync(SCHEDULE, JSON.stringify(sch, null, 2));
  res.json({ ok: true });
});

app.get('/api/slots', function (req, res) {
  const date = String(req.query.date || ''); if (!isDate(date)) return res.status(400).json({ error: 'bad date' });
  const sch = readSchedule(); const n = cairoNow();
  res.json({ date: date, slotMinutes: sch.slotMinutes, slots: date < n.date ? [] : availableSlots(sch, date, n.date, n.min) });
});
app.get('/api/slots/month', function (req, res) {
  const ym = String(req.query.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'bad ym' });
  const sch = readSchedule(); const n = cairoNow(); const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate(); const out = {};
  for (let d = 1; d <= days; d++) { const ds = ym + '-' + String(d).padStart(2, '0'); out[ds] = ds < n.date ? 0 : availableSlots(sch, ds, n.date, n.min).length; }
  res.json({ ym: ym, days: out });
});

// Patient books a slot. Re-validates availability server-side (capacity + not past).
app.post('/api/appointments', function (req, res) {
  const b = req.body || {}, sch = readSchedule(), n = cairoNow();
  const date = String(b.date || ''), time = String(b.time || '');
  const name = String(b.name || '').trim(), phone = String(b.phone || '').trim(), email = String(b.email || '').trim();
  if (!isDate(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'bad_slot' });
  if (!name || !phone) return res.status(400).json({ error: 'missing_details' });
  if (availableSlots(sch, date, n.date, n.min).indexOf(time) < 0) return res.status(409).json({ error: 'slot_unavailable' });
  const payEnabled = paytabsCfg().ok && sch.requirePayment !== false;
  const appt = {
    id: 'apt-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'), date: date, time: time,
    name: name.slice(0, 80), phone: phone.slice(0, 30), email: email.slice(0, 100),
    status: payEnabled ? 'pending' : 'booked', createdAt: new Date().toISOString(),
  };
  const a = readAppts(); a.push(appt); writeAppts(a);
  const p = consultPrice();
  res.json({ ok: true, id: appt.id, pay: payEnabled, amount: p.amount, currency: p.currency });
});
app.get('/api/appointments', requireAdmin, function (_req, res) { res.json(readAppts()); });
app.delete('/api/appointments/:id', requireAdmin, function (req, res) {
  const a = readAppts().map(function (x) { return x.id === req.params.id ? Object.assign({}, x, { status: 'cancelled' }) : x; });
  writeAppts(a); res.json({ ok: true });
});

app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.listen(PORT, function () { console.log('Shalaby site listening on :' + PORT); });
