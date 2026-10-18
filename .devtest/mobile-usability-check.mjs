// Focused regressions for the observed phone layout and navigation defects.
// Touch Chromium at scale factor 3 is not proof of physical iOS keyboard behavior.
// The app builds in an isolated snapshot; all API/external requests are stubbed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createChatTestServer } from './chat-test-server.mjs';

const server = await createChatTestServer();
const origin = new URL(server.url).origin;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const shotDir = process.env.EMBER_SHOT_DIR;
if (shotDir) await mkdir(shotDir, { recursive: true });
let passed = 0;
const failures = [];

async function check(name, run) {
  try { await run(); passed++; console.log(`PASS — ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL — ${name}: ${error.message}`); }
}
async function screenshot(page, name) {
  if (shotDir) await page.screenshot({ path: resolve(shotDir, `${name}.png`) });
}
async function noOverflow(page) {
  const extra = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
  assert.ok(extra <= 1, `${extra}px document overflow`);
}
async function pinnedDock(page, expectedLabels) {
  const dock = await page.locator('.console-dock').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { position: getComputedStyle(element).position, bottomGap: innerHeight - rect.bottom,
      labels: [...element.querySelectorAll('.dock-label')].map((label) => label.textContent.trim().replace(/\s+/g, ' ')),
      controls: element.querySelectorAll('.dock-control').length };
  });
  assert.equal(dock.position, 'fixed');
  assert.ok(Math.abs(dock.bottomGap) <= 1, `${dock.bottomGap}px dock bottom gap`);
  assert.equal(dock.controls, 6);
  if (expectedLabels) assert.deepEqual(dock.labels, expectedLabels);
  return dock.labels;
}
async function controlSizes(locator) {
  return locator.evaluateAll((elements) => elements.filter((element) => element.getBoundingClientRect().width > 0).map((element) => {
    const rect = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.title || element.placeholder || element.textContent.trim().slice(0, 40),
      width: rect.width, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize) };
  }));
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [];
    const writes = [];
    await context.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`);
      if (url.origin === origin && url.pathname === '/api/connectors/status') {
        return route.fulfill({ status: 200, json: { connectors: { quo: 'offline', gmail: 'offline', calendar: 'offline', gdrive: 'offline' } } });
      }
      if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
      return route.fulfill({ status: 200, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.locator('.core-chamber').waitFor();
      const labels = await pinnedDock(page);
      await check(`${name} OPS stays within the viewport`, () => noOverflow(page));
      await check(`${name} touch fixture uses coarse pointer`, async () => assert.equal(await page.evaluate(() => matchMedia('(pointer:coarse)').matches), true));
      await screenshot(page, `${name}-ops`);

      // Reproduce the original bug: navigating from the inbox landed halfway
      // down Caption Studio, leaving the upload area above the viewport.
      await page.evaluate(() => scrollTo(0, 1400));
      await page.locator('.console-dock').getByRole('button', { name: 'Caption Studio', exact: true }).click();
      await page.locator('.upzone').waitFor();
      await check(`${name} navigation opens Caption Studio at its beginning`, async () => {
        await page.waitForFunction(() => scrollY <= 1);
        assert.ok(await page.locator('.upzone').evaluate((element) => element.getBoundingClientRect().top >= 0));
      });
      await check(`${name} Lake remains readable and editable`, async () => {
        const lake = page.getByRole('textbox', { name: 'Lake', exact: true });
        const [size] = await controlSizes(lake);
        assert.ok(size.width >= 160, `Lake is ${size.width}px wide`);
        assert.ok(size.font >= 16, `Lake is ${size.font}px text`);
        await lake.fill('Detroit Lake');
        assert.equal(await lake.inputValue(), 'Detroit Lake');
      });
      await check(`${name} posting controls fit inside their panel`, async () => {
        const layout = await page.locator('.caption-post-times').evaluate((element) => {
          const panel = element.closest('.panel').getBoundingClientRect();
          return [...element.querySelectorAll('button,input')].map((control) => {
            const rect = control.getBoundingClientRect();
            return { label: control.getAttribute('aria-label') || control.textContent.trim(), left: rect.left, right: rect.right,
              width: rect.width, height: rect.height, min: Math.max(0, panel.left), max: Math.min(innerWidth, panel.right) };
          });
        });
        assert.ok(layout.length >= 3, 'Missing posting choices');
        for (const control of layout) {
          assert.ok(control.left >= control.min && control.right <= control.max, `${control.label} is clipped: ${JSON.stringify(control)}`);
          assert.ok(control.width >= 44 && control.height >= 44, `${control.label} has a small touch target`);
        }
      });
      await check(`${name} Caption Studio preserves the pinned six-button dock`, () => pinnedDock(page, labels));
      await check(`${name} Caption Studio has no horizontal overflow`, () => noOverflow(page));
      await page.locator('.caption-schedule').scrollIntoViewIfNeeded();
      await screenshot(page, `${name}-caption-schedule`);

      await page.locator('.console-dock').getByRole('button', { name: 'Projects', exact: true }).click();
      await page.locator('.proj-cat').first().waitFor();
      await check(`${name} Projects has no horizontal overflow`, () => noOverflow(page));
      await page.getByRole('button', { name: 'MISSION CONTROL', exact: true }).click();
      await page.locator('.mc-grid').waitFor();
      await page.locator('.mc-row').first().getByRole('button', { name: /^tasks \(/ }).click();
      await check(`${name} Mission Control editable text avoids small mobile fonts`, async () => {
        const inputs = await controlSizes(page.locator('.mc-grid input:not([type="checkbox"]), .mc-grid textarea'));
        assert.ok(inputs.length >= 10, 'Mission Control fields did not render');
        for (const input of inputs) assert.ok(input.font >= 16, `${input.label || 'Field'} is ${input.font}px text`);
      });
      await check(`${name} Mission Control controls remain touch-sized in either orientation`, async () => {
        const controls = await controlSizes(page.locator('.mc-grid .mc-input, .mc-grid button, .mc-linkchip a'));
        for (const control of controls) assert.ok(control.height >= 44 && control.width >= 44, `${control.label || 'Field'} is ${control.width}×${control.height}px`);
      });
      await check(`${name} task and decision checkboxes have generous tap targets`, async () => {
        const targets = await page.locator('.mc-grid input[type="checkbox"]').evaluateAll((checkboxes) => checkboxes.map((checkbox) => {
          const rect = (checkbox.closest('label') || checkbox).getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }));
        assert.ok(targets.length >= 4, 'Tasks and decisions did not both render');
        for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `Checkbox target is ${target.width}×${target.height}px`);
      });
      await check(`${name} Mission Control has no horizontal overflow`, () => noOverflow(page));
      await check(`${name} Mission Control preserves the pinned six-button dock`, () => pinnedDock(page, labels));
      await page.getByRole('textbox', { name: 'Project name', exact: true }).first().scrollIntoViewIfNeeded();
      await screenshot(page, `${name}-mission-control`);
      await check(`${name} no uncaught browser errors`, async () => assert.deepEqual(errors, []));
      await check(`${name} navigation and local edits make no external writes`, async () => assert.deepEqual(writes, []));
    } finally { await context.close(); }
  }
} finally { await browser.close(); await server.close(); }

console.log(`\n${passed} mobile checks passed; ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
