// Real Chromium manifest/install checks against a local, cookie-gated fixture.
// This does not authenticate to Cloudflare or install anything on Brady's Mac.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('../dist/', import.meta.url).pathname);
let manifestCookie = false, revision = 1;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ connectors: {} })); return;
  }
  if (url.pathname === '/manifest.webmanifest') {
    manifestCookie = (req.headers.cookie || '').includes('install_fixture=1');
    if (!manifestCookie) { res.writeHead(401); res.end(); return; }
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    let data = await fs.readFile(file);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    if (url.pathname === '/') {
      res.setHeader('Set-Cookie', 'install_fixture=1; HttpOnly; SameSite=Lax; Path=/');
      data = Buffer.from(data.toString().replace('<head>', `<head><meta name="fixture-revision" content="${revision}">`));
    }
    res.setHeader('Content-Type', type); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await fs.mkdtemp('/tmp/ember-install-profile-');
const browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Talk to Ember', exact: true }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  assert.ok(manifestCookie, 'protected manifest receives the session cookie');
  const data = JSON.parse(manifest.data);
  assert.equal(new URL(data.start_url, origin).href, origin + '/');
  assert.equal(new URL(data.id, origin).href, origin + '/?tool=captions&lean=1');
  assert.equal(data.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = data.icons.find(i => i.sizes === `${size}x${size}`);
    const dimensions = await page.evaluate(async src => {
      const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight];
    }, icon.src);
    assert.deepEqual(dimensions, [size, size]);
  }
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, []);
  console.log('PASS Chromium installability; credentialed manifest; main-screen launch; stable app identity; PNG icons');
  await page.evaluate(() => navigator.serviceWorker.ready);
  revision = 2; await page.reload();
  assert.equal(await page.locator('meta[name="fixture-revision"]').getAttribute('content'), '2');
  console.log('PASS next launch receives the updated network document');
  for (const [width, height] of [[1440,900], [390,844]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Talk to Ember', exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/ember-install-${width}.png` });
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(profile, { recursive: true, force: true }); }
