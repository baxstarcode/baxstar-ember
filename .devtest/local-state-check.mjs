// Browser regressions for local money entry and Mission Control data preservation.
// All fixtures are synthetic; no upstream requests or real user data are used.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createChatTestServer } from './chat-test-server.mjs';

const server = await createChatTestServer();
const origin = new URL(server.url).origin;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const shotDir = process.env.EMBER_SHOT_DIR;
if (shotDir) await mkdir(shotDir, { recursive: true });
const record = {
  customRoot: { keep: 'root metadata' },
  zap: { used: 20, allowance: 1500, dayOfCycle: 5, daysInCycle: 30, custom: true },
  projects: [
    { id: 'ember', name: 'Baxstar Ember', pct: 97, status: 'active', revenue: false, sessions: 1, hours: 2, next: 'Keep the existing next action', updated: '2026-10-16', customProject: { keep: true }, links: [{ id: 'repo', label: 'repo', url: 'https://example.com' }], tasks: [{ id: 'existing', text: 'Keep this task', done: false, customTask: true }] },
    { id: 'other', name: 'Other project', pct: 20, status: 'parked', revenue: true, sessions: 2, hours: 3, next: 'Unrelated action', links: [], tasks: [] },
  ],
  decisions: [{ id: 'decision', text: 'Keep this decision', done: false, customDecision: true }],
};
const originalRaw = JSON.stringify(record);
let passed = 0;
const failures = [];

async function fixture({ raw = originalRaw, viewport = { width: 1440, height: 900 }, noLocks = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [], requests = [];
  context.on('page', (page) => page.on('pageerror', (e) => errors.push(e.message)));
  await context.route('**/*', (route) => {
    const r = route.request();
    if (new URL(r.url()).origin === origin && ['GET', 'HEAD'].includes(r.method())) return route.continue();
    if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url());
    return route.fulfill({ status: 200, contentType: r.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' });
  });
  await context.addInitScript(({ raw, noLocks }) => {
    if (!localStorage.getItem('local-state-fixture')) {
      if (raw !== null) localStorage.setItem('ember-mc', raw);
      localStorage.setItem('local-state-fixture', 'yes');
    }
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const mock = window.__localTest = {
      writes: 0, failRead: false, failWrite: false,
      raw: () => get.call(localStorage, 'ember-mc'),
      setRaw: (value) => set.call(localStorage, 'ember-mc', value),
    };
    Storage.prototype.getItem = function (key) {
      if (key === 'ember-mc' && mock.failRead) throw new DOMException('Fixture read denied', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ember-mc') {
        mock.writes++;
        if (mock.failWrite) throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
      }
      return set.call(this, key, value);
    };
    if (noLocks) Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  }, { raw, noLocks });
  const newPage = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.locator('.chat-composer textarea').waitFor();
    return page;
  };
  return { context, page: await newPage(), newPage, errors, requests };
}
async function openBoard(page) {
  await page.locator('.console-dock').getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'MISSION CONTROL', exact: true }).click();
  await page.locator('.mc-grid').waitFor();
}
async function saved(page) {
  await page.locator('.mc-grid').getByText('Saved on this device.', { exact: true }).waitFor();
}
async function stored(page) { return page.evaluate(() => JSON.parse(__localTest.raw())); }
async function download(page, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await pending;
  assert.match(file.suggestedFilename(), /^ember-mission-\d{4}-\d\d-\d\d\.json$/);
  return readFile(await file.path(), 'utf8');
}
async function unloadBlocked(page) {
  return page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
}
async function holdLock(page) {
  await page.evaluate(() => {
    window.__lockHeld = false;
    void navigator.locks.request('ember-mc', () => new Promise((resolve) => { window.__releaseMC = resolve; window.__lockHeld = true; }));
  });
  await page.waitForFunction(() => __lockHeld);
}
async function test(name, run, options) {
  let f;
  try {
    f = await fixture(options);
    await run(f);
    assert.deepEqual(f.errors, [], 'Uncaught browser errors');
    assert.deepEqual(f.requests, [], 'No external actions were requested');
    console.log(`PASS — ${name}`); passed++;
  } catch (error) {
    failures.push(name);
    console.log(`FAIL — ${name}: ${error.stack}`);
  } finally { await f?.context.close(); }
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await test(`${viewport.width}: revenue keeps cents, reloads, fits, and clears explicitly`, async ({ page }) => {
      for (const [input, expected] of [['$12.50', 12.5], ['$1,234.56', 1234.56], ['0.01', 0.01], ['999999.99', 999999.99], ['0', 0]]) {
        await page.getByRole('button', { name: /^(Set today's number|Update)$/ }).click();
        await page.getByLabel("Today's revenue in dollars", { exact: true }).fill(input);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForFunction((n) => JSON.parse(localStorage.getItem('ember-prefs'))?.revToday?.n === n, expected);
        const text = (await page.locator('.odometer').textContent()).replace(/[$,]/g, '');
        assert.equal(Number(text), expected);
        if (!Number.isInteger(expected)) assert.match(text, /\.\d{2}$/);
        const fits = await page.locator('.odometer').evaluate((node) => {
          const panel = node.closest('.panel').getBoundingClientRect();
          return { panelRight: panel.right, tiles: [...node.children].map((c) => ({ text: c.textContent, right: c.getBoundingClientRect().right, scroll: c.scrollWidth, client: c.clientWidth })) };
        });
        assert(fits.tiles.every((c) => c.right <= fits.panelRight && c.scroll <= c.client + 1), `${input}: amount tiles stay inside their panel without clipping: ${JSON.stringify(fits)}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (shotDir && expected === 1234.56) await page.screenshot({ path: resolve(shotDir, `revenue-${viewport.width}.png`), fullPage: true });
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(Number((await page.locator('.odometer').textContent()).replace(/[$,]/g, '')), expected);
      }
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await page.getByLabel("Today's revenue in dollars", { exact: true }).fill('');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: "Set today's number", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ember-prefs')).revToday), null);
    }, { viewport });

    await test(`${viewport.width}: invalid revenue preserves the previous amount and draft`, async ({ page }) => {
      await page.getByRole('button', { name: "Set today's number", exact: true }).click();
      const field = page.getByLabel("Today's revenue in dollars", { exact: true });
      await field.fill('450.50'); await field.press('Enter');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      for (const input of ['-100', '12.345', '1,23', 'abc123', '1e3', '1000000', '9007199254740993', 'NaN', 'Infinity', '$']) {
        await field.fill(input); await field.press('Enter');
        await page.locator('#revenue-error').waitFor();
        assert.equal(await field.inputValue(), input);
        assert.equal(await field.getAttribute('aria-invalid'), 'true');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ember-prefs')).revToday.n), 450.5);
      }
      await field.press('Escape');
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      assert.equal(await field.inputValue(), '450.5');
      assert.equal(await page.locator('#revenue-error').count(), 0);
      await field.fill('10');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ember-prefs')).revToday.n), 450.5);
    }, { viewport });

    await test(`${viewport.width}: failed board saves retain edits across tools and offer an exact backup`, async ({ page }) => {
      await openBoard(page);
      await page.evaluate(() => { __localTest.failWrite = true; });
      await page.getByLabel('Project name', { exact: true }).first().fill('My unsaved project name');
      await page.getByText(/Could not save on this device/).waitFor();
      assert.equal(await page.evaluate(() => __localTest.raw()), originalRaw);
      assert(await unloadBlocked(page));
      const backup = JSON.parse(await download(page, 'Download my edits'));
      assert.equal(backup.projects[0].name, 'My unsaved project name');
      assert.deepEqual(backup.customRoot, record.customRoot);
      assert.deepEqual(backup.projects[1], record.projects[1]);
      if (shotDir) await page.screenshot({ path: resolve(shotDir, `mission-recovery-${viewport.width}.png`), fullPage: true });
      const buttons = await page.locator('.mc-save-note button').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
      assert(buttons.every((height) => height >= 44));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('.console-dock').getByRole('button', { name: 'OPS', exact: true }).click();
      await page.getByRole('button', { name: 'Review unsaved edits', exact: true }).click();
      assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'My unsaved project name');
      await page.evaluate(() => { __localTest.failWrite = false; });
      await page.getByRole('button', { name: 'Retry save', exact: true }).click();
      await saved(page);
      assert.equal((await stored(page)).projects[0].name, 'My unsaved project name');
      assert.equal(await unloadBlocked(page), false);
      await page.reload({ waitUntil: 'networkidle' }); await openBoard(page);
      assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'My unsaved project name');
    }, { viewport });
  }

  await test('opening a saved board never writes and edits preserve unrelated fields', async ({ page }) => {
    await openBoard(page);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
    assert.equal(await page.evaluate(() => __localTest.raw()), originalRaw);
    await page.getByLabel('Project name', { exact: true }).first().fill('Edited name'); await saved(page);
    const next = await stored(page);
    assert.deepEqual(next.customRoot, record.customRoot);
    assert.deepEqual(next.zap, record.zap);
    assert.deepEqual(next.decisions, record.decisions);
    assert.deepEqual(next.projects[1], record.projects[1]);
    assert.deepEqual(next.projects[0].tasks, record.projects[0].tasks);
    assert.deepEqual(next.projects[0].customProject, record.projects[0].customProject);
  });

  await test('a starter board stays unsaved until the first deliberate edit', async ({ page }) => {
    await openBoard(page);
    assert.equal(await page.evaluate(() => __localTest.raw()), null);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
    await page.getByText('Starter board · edits save on this device.', { exact: true }).waitFor();
    await page.getByLabel('Used', { exact: true }).fill('17'); await saved(page);
    assert.equal((await stored(page)).zap.used, '17');
  }, { raw: null });

  await test('malformed saved records stay byte-for-byte intact and can be downloaded', async ({ page }) => {
    await openBoard(page);
    assert.equal(await page.locator('.mc-row').count(), 0);
    const invalids = ['{broken JSON — preserve me', 'null', '[]', '{"projects":"wrong"}', JSON.stringify({ ...record, projects: [null] }), JSON.stringify({ ...record, projects: [{ ...record.projects[0], tasks: 'wrong' }] }), JSON.stringify({ ...record, projects: [{ ...record.projects[0], links: [null] }] }), JSON.stringify({ ...record, decisions: [{ id: 'bad', text: { wrong: true } }] }), JSON.stringify({ ...record, zap: [] }), JSON.stringify({ ...record, projects: [record.projects[0], record.projects[0]] })];
    for (const raw of invalids) {
      await page.evaluate((raw) => __localTest.setRaw(raw), raw);
      await page.getByRole('button', { name: 'Try reading again', exact: true }).click();
      await page.getByText(/Cannot read saved Mission Control data/).waitFor();
      assert.equal(await page.evaluate(() => __localTest.raw()), raw);
      assert.equal(await page.evaluate(() => __localTest.writes), 0);
      assert.equal(await page.locator('.mc-row').count(), 0);
    }
    assert.equal(await download(page, 'Download saved data'), invalids.at(-1));
    await page.evaluate((raw) => __localTest.setRaw(raw), originalRaw);
    await page.getByRole('button', { name: 'Try reading again', exact: true }).click();
    await saved(page);
    assert.equal(await page.locator('.mc-row').count(), 2);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
  }, { raw: '{broken JSON — preserve me', viewport: { width: 390, height: 844 } });

  await test('a denied storage read never replaces the existing board', async ({ page }) => {
    await page.evaluate(() => { __localTest.failRead = true; });
    await openBoard(page);
    await page.getByText(/Cannot read saved Mission Control data/).waitFor();
    assert.equal(await page.evaluate(() => __localTest.raw()), originalRaw);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
    await page.getByRole('button', { name: 'Download saved data', exact: true }).click();
    await page.getByText(/Could not download a copy/).waitFor();
    await page.evaluate(() => { __localTest.failRead = false; });
    await page.getByRole('button', { name: 'Try reading again', exact: true }).click(); await saved(page);
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), record.projects[0].name);
  });

  await test('older records with absent optional lists remain usable without a mount rewrite', async ({ page }) => {
    await openBoard(page);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
    await page.getByRole('button', { name: 'tasks (0)', exact: true }).click();
    await page.getByRole('button', { name: '+ task', exact: true }).click(); await saved(page);
    assert.equal((await stored(page)).projects[0].tasks[0].text, 'New task');
    assert.equal((await stored(page)).customRoot.keep, 'legacy');
  }, { raw: JSON.stringify({ customRoot: { keep: 'legacy' }, projects: [{ id: 'old', name: 'Older project', pct: 10, status: 'active', sessions: 1, hours: 2, next: '' }] }) });

  await test('another tab cannot erase unsaved work; loading its version requires an explicit discard', async ({ page, newPage }) => {
    await openBoard(page);
    await page.evaluate(() => { __localTest.failWrite = true; });
    await page.getByLabel('Project name', { exact: true }).first().fill('First tab draft');
    await page.getByText(/Could not save on this device/).waitFor();
    const second = await newPage(); await openBoard(second);
    await second.getByLabel('Project name', { exact: true }).first().fill('Second tab saved'); await saved(second);
    await page.getByText(/Saved data changed in another tab or tool/).waitFor();
    await page.evaluate(() => { __localTest.failWrite = false; });
    await page.getByLabel('Project name', { exact: true }).first().fill('First tab continued');
    assert.equal((await stored(page)).projects[0].name, 'Second tab saved');
    assert.equal(JSON.parse(await download(page, 'Download my edits')).projects[0].name, 'First tab continued');
    await page.getByRole('button', { name: 'Load saved version', exact: true }).click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'First tab continued');
    await page.getByRole('button', { name: 'Load saved version', exact: true }).click();
    await page.getByRole('button', { name: 'Discard my edits and load', exact: true }).click(); await saved(page);
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'Second tab saved');
    assert.equal(await unloadBlocked(page), false);
  });

  await test('simultaneous board edits serialize and preserve the losing tab as a recoverable draft', async ({ page, newPage }) => {
    await openBoard(page);
    const second = await newPage(); await openBoard(second);
    await holdLock(page);
    await page.getByLabel('Project name', { exact: true }).first().fill('First concurrent edit');
    await second.getByLabel('Project name', { exact: true }).first().fill('Second concurrent edit');
    await page.waitForFunction(async () => (await navigator.locks.query()).pending.filter((l) => l.name === 'ember-mc').length === 2);
    assert.equal(await page.evaluate(() => __localTest.raw()), originalRaw);
    await page.evaluate(() => __releaseMC());
    await saved(page);
    await second.getByText(/Saved data changed in another tab or tool/).waitFor();
    assert.equal((await stored(page)).projects[0].name, 'First concurrent edit');
    assert.equal(await second.getByLabel('Project name', { exact: true }).first().inputValue(), 'Second concurrent edit');
    assert(await unloadBlocked(second));
  });

  await test('failed recovery reads keep the unsaved version and malformed storage intact', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => { __localTest.failWrite = true; });
    await page.getByLabel('Project name', { exact: true }).first().fill('Keep my recovery draft');
    await page.getByText(/Could not save on this device/).waitFor();
    await page.evaluate(() => { __localTest.failWrite = false; __localTest.setRaw('{malformed newer data'); });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.getByText(/Saved data changed in another tab or tool/).waitFor();
    await page.getByRole('button', { name: 'Load saved version', exact: true }).click();
    await page.getByRole('button', { name: 'Discard my edits and load', exact: true }).click();
    await page.getByText(/Cannot read saved Mission Control data/).waitFor();
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'Keep my recovery draft');
    assert.equal(await page.evaluate(() => __localTest.raw()), '{malformed newer data');
    assert.equal(JSON.parse(await download(page, 'Download my edits')).projects[0].name, 'Keep my recovery draft');
    assert(await unloadBlocked(page));
  });

  await test('OPS task saves share the board lock and retain a queued project edit', async ({ page }) => {
    await openBoard(page); await holdLock(page);
    await page.getByPlaceholder('next action', { exact: true }).first().fill('Queued board edit');
    await page.locator('.console-dock').getByRole('button', { name: 'OPS', exact: true }).click();
    await page.getByRole('button', { name: 'Task draft', exact: true }).first().click();
    await page.getByLabel('Task title', { exact: true }).fill('Queued reviewed task');
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await page.waitForFunction(async () => (await navigator.locks.query()).pending.filter((l) => l.name === 'ember-mc').length === 2);
    assert.equal(await page.getByLabel('Task title', { exact: true }).isDisabled(), true);
    await page.evaluate(() => __releaseMC());
    await page.locator('.task-feedback').waitFor();
    const next = await stored(page);
    assert.equal(next.projects[0].next, 'Queued board edit');
    assert.equal(next.projects[0].tasks.at(-1).text, 'Queued reviewed task');
    assert.equal(next.projects[0].tasks.length, 2);
    await page.getByRole('button', { name: 'View in Mission Control', exact: true }).click();
    await saved(page);
    await page.getByRole('button', { name: 'tasks (2)', exact: true }).click();
    assert.equal(await page.getByLabel('Task name', { exact: true }).last().inputValue(), 'Queued reviewed task');
  });

  await test('a storage-clear event refreshes a clean board without recreating deleted data', async ({ page, newPage }) => {
    await openBoard(page);
    const second = await newPage();
    await second.evaluate(() => localStorage.clear());
    await page.getByText('Starter board · edits save on this device.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => __localTest.raw()), null);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
  });

  await test('without Web Locks, changed snapshots still block overwrites', async ({ page }) => {
    await openBoard(page);
    await page.evaluate((raw) => __localTest.setRaw(raw), JSON.stringify({ ...record, customRoot: { newer: true } }));
    await page.getByLabel('Project name', { exact: true }).first().fill('Fallback draft');
    await page.getByText(/Saved data changed in another tab or tool/).waitFor();
    assert.equal((await stored(page)).customRoot.newer, true);
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'Fallback draft');
  }, { noLocks: true });
} finally {
  await browser.close(); await server.close();
}
console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
