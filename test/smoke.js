// SEO hygiene smoke test. No deps, no server: reads the served static files directly.
// Run: node test/smoke.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC = path.join(__dirname, '..', 'public');
const sitemap = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8');
const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

assert.ok((sitemap.match(/<loc>/g) || []).length >= 1, 'sitemap.xml must have >=1 <loc> entry');
assert.ok(robots.includes('Sitemap:'), 'robots.txt must reference a Sitemap:');
assert.ok(/<h1/.test(home), 'index.html must contain an <h1');
assert.ok(home.includes('rel="canonical"'), 'index.html must contain rel="canonical"');

console.log('smoke test passed');
