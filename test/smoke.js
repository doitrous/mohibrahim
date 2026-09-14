// SEO hygiene smoke test. No deps: reads the served static files directly, then spawns the
// real server once to check the seo-runtime health route.
// Run: node test/smoke.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const sitemap = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8');
const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

assert.ok((sitemap.match(/<loc>/g) || []).length >= 1, 'sitemap.xml must have >=1 <loc> entry');
assert.ok(robots.includes('Sitemap:'), 'robots.txt must reference a Sitemap:');
assert.ok(/<h1/.test(home), 'index.html must contain an <h1');
assert.ok(home.includes('rel="canonical"'), 'index.html must contain rel="canonical"');

// GET /api/seo/health (@omary98/seo-runtime-express): 401 with no bearer, 200 + siteSlug with
// the right one.
async function checkSeoHealth() {
  const PORT = 34567;
  const SECRET = 'test-secret';
  const DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mohibrahim-smoke-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: DATA_DIR, SEO_HUB_SECRET: SECRET, SEO_SITE_SLUG: 'mohibrahim',
      SEO_HUB_URL: '', ADMIN_PASSWORD: 'x', SESSION_SECRET: 'x',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start in time')), 8000);
      child.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited early with code ' + code)); });
    });

    const base = 'http://127.0.0.1:' + PORT;
    const unauthed = await fetch(base + '/api/seo/health');
    assert.strictEqual(unauthed.status, 401, '/api/seo/health must be 401 without a bearer');

    const authed = await fetch(base + '/api/seo/health', { headers: { Authorization: 'Bearer ' + SECRET } });
    assert.strictEqual(authed.status, 200, '/api/seo/health must be 200 with the right bearer');
    const body = await authed.json();
    assert.strictEqual(body.siteSlug, 'mohibrahim', '/api/seo/health must report siteSlug');
  } finally {
    child.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

checkSeoHealth()
  .then(() => console.log('smoke test passed'))
  .catch((err) => { console.error(err); process.exit(1); });
