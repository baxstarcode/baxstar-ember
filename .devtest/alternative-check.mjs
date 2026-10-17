// User-visible interactions in the alternative: preserve the dock, operate the
// Argon-derived graph, recover an empty search, and keep keyboard/motion access.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const server = http.createServer((req, res) => {
  const file = path.join(root, (req.url || '/').split('?')[0] === '/' ? 'index.html' : (req.url || '/').split('?')[0]);
  if (!file.startsWith(root + '/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS — ${name}`); };
try {
  for (const [name, width, reduced] of [['desktop', 1440, false], ['phone', 390, false], ['reduced', 1440, true]]) {
    const context = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, deviceScaleFactor: 3, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(origin) && !url.includes('/api/')) return route.continue();
      if (url.includes('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test offline"}' });
      return route.abort();
    });
    await page.goto(origin); await page.locator('.core-chamber').waitFor();
    await page.waitForTimeout(reduced ? 50 : 850);
    check(`${name}: six existing dock destinations retained`, (await page.locator('.dock-label').allTextContents()).map(t => t.replace(/\u00ad/g, '')).join('|') === 'OPS|Caption Studio|Knowledge Graph|Google Drive|FareHarbor|Projects');
    check(`${name}: voice lab is reachable from the instrument`, (await page.getByRole('link', { name: 'VOICE LAB' }).getAttribute('href')) === '/work/desktop-voice-probe/');
    const revenue = page.getByRole('button', { name: "Set today's number", exact: true });
    await revenue.scrollIntoViewIfNeeded(); await revenue.hover();
    await page.mouse.down();
    await page.waitForFunction((el) => Number.parseFloat(getComputedStyle(el).top) === (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3), await revenue.elementHandle());
    check(`${name}: pressed control has visible depth without transforming text`, await revenue.evaluate((el) => {
      const c = getComputedStyle(el); return c.transform === 'none' && c.boxShadow.includes('inset') && Number.parseFloat(c.top) === (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3);
    }));
    await page.mouse.up(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const opener = page.locator('.console-dock').getByRole('button', { name: 'Knowledge Graph', exact: true });
    await opener.click(); const dialog = page.getByRole('dialog', { name: 'Knowledge Graph', exact: true });
    await dialog.locator('.fa-atlas').waitFor();
    check(`${name}: all reference nodes and relationships render`, await dialog.locator('.fa-node').count() === 20 && await dialog.locator('.fa-conduit').count() === 34);
    check(`${name}: zoom controls start within the visible map`, await dialog.locator('.fa-controls').evaluate(el => {
      const controls = el.getBoundingClientRect(), workspace = el.closest('.fa-workspace').getBoundingClientRect();
      return controls.top >= workspace.top && controls.bottom <= workspace.bottom && controls.right <= workspace.right;
    }));
    check(`${name}: dashboard is inert while the graph is open`, await page.locator('.ember-shell').getAttribute('inert') !== null);
    if (reduced) {
      check('reduced: map motion respects the system setting', await dialog.getByRole('button', { name: 'Motion reduced' }).isDisabled() && await dialog.locator('.fa-gear').evaluate(el => getComputedStyle(el).animationName) === 'none');
    } else {
      await dialog.getByRole('button', { name: 'Pause motion' }).click();
      check(`${name}: motion pause actually parks the mechanism`, await dialog.locator('.fa-gear').evaluate(el => getComputedStyle(el).animationPlayState) === 'paused');
    }
    const search = dialog.getByRole('searchbox', { name: 'Find a source or system' });
    await search.fill('not-a-source');
    check(`${name}: empty search is explicit and recoverable`, /No matching/.test(await dialog.locator('.fa-status').innerText()) && await dialog.locator('.fa-node[tabindex="0"]').count() === 0);
    await search.fill('brand voice');
    check(`${name}: search isolates the right source`, await dialog.locator('.fa-node[tabindex="0"]').count() === 1);
    if (width < 900) await dialog.getByRole('combobox', { name: 'Choose a source' }).selectOption('VOICE');
    else { await dialog.locator('.fa-node[data-node-id="VOICE"]').focus(); await page.keyboard.press('Enter'); }
    check(`${name}: selecting a source opens its correct details`, (await dialog.locator('.fa-inspector h2').innerText()) === 'Brand Voice');
    await search.fill(''); await dialog.getByRole('button', { name: 'business', exact: true }).click();
    check(`${name}: domain filter selects five business sources`, await dialog.locator('.fa-node[tabindex="0"]').count() === 5);
    await dialog.getByRole('button', { name: 'Reset map', exact: true }).click();
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    check(`${name}: zoom controls change the map`, (await dialog.getByRole('status', { name: 'Map zoom' }).textContent()) === '120%');
    if (width >= 900) {
      const map = dialog.locator('.fa-svg'); await map.focus(); await page.keyboard.press('ArrowRight');
      check(`${name}: keyboard can pan without a mouse`, /translate\(-40 0\)/.test(await dialog.locator('.fa-viewport').getAttribute('transform')));
    }
    await dialog.getByRole('button', { name: 'Reset map', exact: true }).click();
    check(`${name}: reset restores the whole map and clears filters`, (await dialog.locator('.fa-viewport').getAttribute('transform')) === 'translate(0 0) scale(1)' && await dialog.locator('.fa-node[tabindex="0"]').count() === 20);
    await dialog.getByRole('tab', { name: 'Source map', exact: true }).click();
    check(`${name}: original source map remains accessible`, (await dialog.locator('.kg-frame').getAttribute('src')) === 'https://baxstar-knowledge-network.pages.dev/');
    await dialog.getByRole('tab', { name: 'The Works', exact: true }).click();
    check(`${name}: the existing ecosystem graph remains intact`, await dialog.locator('.eco-node').count() === 39 && await dialog.locator('.eco-svg line').count() === 60);
    await page.keyboard.press('Escape');
    check(`${name}: Escape returns keyboard focus to the existing dock`, await dialog.count() === 0 && await opener.evaluate(el => el === document.activeElement));
    check(`${name}: no uncaught browser errors`, errors.length === 0);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`\n${checks}/${checks} alternative checks passed`);
