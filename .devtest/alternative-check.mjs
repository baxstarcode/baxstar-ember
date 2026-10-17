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
  for (const [name, width, height, reduced] of [['desktop', 1440, 1000, false], ['phone', 390, 844, false], ['narrow', 320, 700, false], ['landscape', 844, 390, false], ['reduced', 1440, 1000, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, deviceScaleFactor: 3, reducedMotion: reduced ? 'reduce' : 'no-preference' });
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
    check(`${name}: every graph tab and the close button fit the header`, await dialog.locator('.kg-head').evaluate(el => {
      const head = el.getBoundingClientRect();
      return [...el.querySelectorAll('[role="tab"],.kg-close,.fa-motion')].every(button => {
        const r = button.getBoundingClientRect(); return r.left >= head.left && r.right <= head.right && r.top >= head.top && r.bottom <= head.bottom;
      });
    }));
    check(`${name}: map retains usable space below its filters`, await dialog.locator('.fa-svg').evaluate(el => {
      const style = getComputedStyle(el); return el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) >= 150;
    }));
    check(`${name}: zoom controls start within the visible map`, await dialog.locator('.fa-controls').evaluate(el => {
      const controls = el.getBoundingClientRect(), workspace = el.closest('.fa-workspace').getBoundingClientRect();
      return controls.top >= workspace.top && controls.bottom <= workspace.bottom && controls.right <= workspace.right;
    }));
    check(`${name}: dashboard is inert while the graph is open`, await page.locator('.ember-shell').getAttribute('inert') !== null);
    const particle = dialog.locator('.fa-particle').first();
    const position = () => particle.evaluate(el => [el.getAttribute('cx'), el.getAttribute('cy')].join(','));
    if (reduced) {
      check('reduced: map motion respects the system setting', await dialog.getByRole('button', { name: 'Motion reduced' }).isDisabled() && await dialog.locator('.fa-gear').evaluate(el => getComputedStyle(el).animationName) === 'none');
    } else {
      const before = await position();
      await page.waitForFunction(previous => {
        const dot = document.querySelector('.fa-particle'); return [dot.getAttribute('cx'), dot.getAttribute('cy')].join(',') !== previous;
      }, before);
      check(`${name}: particles travel along the connections`, await position() !== before);
      await dialog.getByRole('button', { name: 'Pause motion' }).click();
      check(`${name}: motion pause actually parks the mechanism`, await dialog.locator('.fa-gear').evaluate(el => getComputedStyle(el).animationPlayState) === 'paused');
    }
    const parked = await position(); await page.waitForTimeout(150);
    check(`${name}: particles stay parked when motion is off`, await position() === parked);
    if (width < 900) check(`${name}: phone source drawer starts collapsed`, await dialog.getByRole('button', { name: 'Show source details' }).getAttribute('aria-expanded') === 'false' && await dialog.locator('#fa-source-details').isHidden());
    const search = dialog.getByRole('searchbox', { name: 'Find a source or system' });
    await search.fill('not-a-source');
    check(`${name}: empty search is explicit and recoverable`, /No matching/.test(await dialog.locator('.fa-status').innerText()) && await dialog.locator('.fa-node[tabindex="0"]').count() === 0);
    await search.fill('brand voice');
    check(`${name}: search isolates the right source`, await dialog.locator('.fa-node[tabindex="0"]').count() === 1);
    if (width < 900 && height > 600) await dialog.getByRole('combobox', { name: 'Choose a source' }).selectOption('VOICE');
    else if (width < 900) await search.press('Enter');
    else { await dialog.locator('.fa-node[data-node-id="VOICE"]').focus(); await page.keyboard.press('Enter'); }
    await page.waitForFunction(() => document.querySelector('.fa-inspector h2').textContent === 'Brand Voice');
    check(`${name}: selecting a source opens its correct details`, await dialog.locator('.fa-inspector h2').isVisible());
    if (width < 900) {
      check(`${name}: selected source opens the phone drawer`, await dialog.getByRole('button', { name: 'Hide source details' }).getAttribute('aria-expanded') === 'true');
      await dialog.getByRole('button', { name: 'Hide source details' }).click();
      check(`${name}: drawer collapses without losing the selected source`, await dialog.locator('#fa-source-details').isHidden() && (await dialog.locator('.fa-sheet-toggle').textContent()).includes('Brand Voice'));
    }
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
    if (name === 'desktop') {
      const router = dialog.locator('.fa-node[data-node-id="ROUTER"]');
      const center = () => router.evaluate(el => { const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; });
      const before = await center();
      await page.mouse.move(before.x, before.y); await page.mouse.down();
      await page.mouse.move(before.x + 60, before.y + 25, { steps:6 }); await page.mouse.up();
      const after = await center();
      check('desktop: dragging a node pans one screen pixel per pointer pixel', Math.abs(after.x-before.x-60)<1 && Math.abs(after.y-before.y-25)<1);
      check('desktop: dragging does not accidentally select another source', await router.getAttribute('aria-pressed') === 'true');
      const world = () => dialog.locator('.fa-viewport').evaluate((el, p) => { const point = new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM().inverse()); return {x:point.x,y:point.y}; }, after);
      const anchor = await world(); await page.mouse.move(after.x, after.y); await page.mouse.wheel(0,-120);
      await page.waitForFunction(() => document.querySelector('.fa-controls output').textContent === '112%');
      const zoomed = await world();
      check('desktop: wheel zoom keeps the point under the cursor fixed', Math.abs(anchor.x-zoomed.x)<1 && Math.abs(anchor.y-zoomed.y)<1);
      await dialog.getByRole('button', { name: 'Reset map', exact: true }).click();
      await router.click();
      check('desktop: a normal node click still opens details after dragging', await dialog.locator('.fa-inspector.expanded').count() === 1);
    }
    if (name === 'phone') {
      const cdp = await context.newCDPSession(page);
      const router = dialog.locator('.fa-node[data-node-id="ROUTER"]');
      const center = () => router.evaluate(el => { const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
      const p = await center();
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints:points.map(([id,x,y]) => ({id,x,y}))});
      await touch('touchStart', [[1,p.x,p.y]]);
      await touch('touchStart', [[1,p.x,p.y],[2,p.x+60,p.y]]);
      await touch('touchMove', [[1,p.x-30,p.y],[2,p.x+90,p.y]]);
      await page.waitForFunction(() => document.querySelector('.fa-controls output').textContent === '200%');
      check('phone: two-finger pinch doubles the map scale', (await dialog.getByRole('status', { name:'Map zoom' }).textContent()) === '200%');
      await touch('touchCancel', []);
      check('phone: pinching a node does not open its drawer', await dialog.locator('#fa-source-details').isHidden());
      const before = await center();
      await touch('touchStart', [[1,p.x,p.y]]); await touch('touchMove', [[1,p.x+20,p.y+10]]); await touch('touchEnd', []);
      const after = await center();
      check('phone: a new drag after cancellation has no stale finger or jump', Math.abs(after.x-before.x-20)<1 && Math.abs(after.y-before.y-10)<1);
      await cdp.detach();
      await dialog.getByRole('button', { name: 'Reset map', exact: true }).click();
    }
    check(`${name}: graph offers only Foundry and The Works`, (await dialog.getByRole('tab').allTextContents()).join('|') === 'Foundry|The Works');
    await dialog.getByRole('tab', { name: 'The Works', exact: true }).click();
    check(`${name}: the existing ecosystem graph remains intact`, await dialog.locator('.eco-node').count() === 39 && await dialog.locator('.eco-svg line').count() === 60);
    await page.keyboard.press('Escape');
    check(`${name}: Escape returns keyboard focus to the existing dock`, await dialog.count() === 0 && await opener.evaluate(el => el === document.activeElement));
    check(`${name}: no uncaught browser errors`, errors.length === 0);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`\n${checks}/${checks} alternative checks passed`);
