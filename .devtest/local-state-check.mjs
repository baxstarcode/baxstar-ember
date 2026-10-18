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
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    const idbGet = IDBObjectStore.prototype.get, idbPut = IDBObjectStore.prototype.put;
    const idbTransaction = IDBDatabase.prototype.transaction;
    const isBoard = (store) => store.name === 'boards' && store.transaction.db.name === 'ember-local';
    const openDatabase = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('ember-local', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('boards')) request.result.createObjectStore('boards');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const head = async () => {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = idbTransaction.call(db, 'boards', 'readonly');
        const request = idbGet.call(transaction.objectStore('boards'), 'ember-mc');
        transaction.oncomplete = () => { db.close(); resolve(request.result ?? null); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      });
    };
    const mock = window.__localTest = {
      writes: 0, legacyWrites: 0, readwriteStarted: 0,
      failRead: false, failWrite: false, abortAfterPut: false, putSucceeded: false,
      holdNextCommit: false, commitHeld: false, releaseCommit: false,
      staleRead: undefined,
      head,
      raw: async () => (await head())?.raw ?? get.call(localStorage, 'ember-mc'),
      legacyRaw: () => get.call(localStorage, 'ember-mc'),
      setLegacyRaw: (value) => value === null ? remove.call(localStorage, 'ember-mc') : set.call(localStorage, 'ember-mc', value),
      setRaw: async (value) => {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
          const transaction = idbTransaction.call(db, 'boards', 'readwrite');
          const store = transaction.objectStore('boards');
          const request = idbGet.call(store, 'ember-mc');
          request.onsuccess = () => idbPut.call(store, {
            format: 1, revision: (request.result?.revision ?? 0) + 1,
            raw: value, legacyRaw: request.result?.legacyRaw ?? get.call(localStorage, 'ember-mc'),
          }, 'ember-mc');
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
        });
      },
    };
    Storage.prototype.getItem = function (key) {
      if (key === 'ember-mc' && mock.failRead) throw new DOMException('Fixture read denied', 'SecurityError');
      if (key === 'ember-mc' && mock.staleRead !== undefined) return mock.staleRead;
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ember-mc') mock.legacyWrites++;
      return set.call(this, key, value);
    };
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (this.name === 'ember-local' && mode === 'readwrite') mock.readwriteStarted++;
      return idbTransaction.call(this, stores, mode, ...args);
    };
    IDBObjectStore.prototype.get = function (key) {
      if (isBoard(this) && mock.failRead) throw new DOMException('Fixture database read denied', 'SecurityError');
      return idbGet.call(this, key);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (!isBoard(this)) return idbPut.apply(this, args);
      mock.writes++;
      if (mock.failWrite) throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
      const request = idbPut.apply(this, args);
      const store = this, transaction = this.transaction;
      request.addEventListener('success', () => {
        mock.putSucceeded = true;
        if (mock.abortAfterPut) { transaction.abort(); return; }
        if (!mock.holdNextCommit) return;
        mock.holdNextCommit = false;
        mock.commitHeld = true;
        // Real requests keep the real transaction alive until the test releases it.
        // This is an explicit scheduling barrier, never a timing-dependent sleep.
        const keepAlive = () => {
          if (mock.releaseCommit) { mock.commitHeld = false; return; }
          idbGet.call(store, 'fixture-keepalive').addEventListener('success', keepAlive);
        };
        keepAlive();
      });
      return request;
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
  await page.getByText('Reading saved board…', { exact: true }).waitFor({ state: 'hidden' });
}
async function saved(page) {
  await page.locator('.mc-grid').getByText('Saved on this device.', { exact: true }).waitFor();
}
async function stored(page) { return page.evaluate(async () => JSON.parse(await __localTest.raw())); }
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
    assert.equal(await f.page.evaluate(() => __localTest.legacyWrites), 0, 'New saves never rewrite the legacy localStorage recovery copy');
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
    assert.equal(await page.evaluate(() => __localTest.head()), null, 'Mount does not migrate or create a canonical board');
    await page.getByLabel('Project name', { exact: true }).first().fill('Edited name'); await saved(page);
    const head = await page.evaluate(() => __localTest.head());
    assert.equal(head.format, 1);
    assert.equal(head.revision, 1);
    assert.equal(head.legacyRaw, originalRaw);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), originalRaw);
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


  await test('denied IndexedDB access preserves the previous copy and offers an explicitly labelled export', async ({ page }) => {
    await page.evaluate(() => {
      const open = indexedDB.open;
      window.__restoreDatabaseOpen = () => { indexedDB.open = open; };
      indexedDB.open = () => { throw new DOMException('Fixture database access denied', 'SecurityError'); };
    });
    await openBoard(page);
    await page.getByText(/Cannot read saved Mission Control data/).waitFor();
    assert.equal(await page.locator('.mc-row').count(), 0);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), originalRaw);
    assert.equal(await download(page, 'Download previous board copy'), originalRaw);
    await page.evaluate(() => __restoreDatabaseOpen());
    await page.getByRole('button', { name: 'Try reading again', exact: true }).click(); await saved(page);
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), record.projects[0].name);
    assert.equal(await page.evaluate(() => __localTest.head()), null);
    assert.equal(await page.evaluate(() => __localTest.writes), 0);
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

  await test('simultaneous edits retain both versions even when localStorage reads stay stale', async ({ page, newPage }) => {
    await openBoard(page);
    const second = await newPage(); await openBoard(second);
    await page.evaluate((raw) => { __localTest.staleRead = raw; }, originalRaw);
    await second.evaluate((raw) => { __localTest.staleRead = raw; }, originalRaw);
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
    assert.equal(JSON.parse(await download(second, 'Download my edits')).projects[0].name, 'Second concurrent edit');
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), originalRaw);
  });

  await test('failed recovery reads keep the unsaved version and malformed storage intact', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => { __localTest.failWrite = true; });
    await page.getByLabel('Project name', { exact: true }).first().fill('Keep my recovery draft');
    await page.getByText(/Could not save on this device/).waitFor();
    await page.evaluate(async () => { __localTest.failWrite = false; await __localTest.setRaw('{malformed newer data'); });
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

  await test('without Web Locks, transactions protect against a stale-read competing tab', async ({ page, newPage }) => {
    await openBoard(page);
    const second = await newPage(); await openBoard(second);
    await page.evaluate((raw) => { __localTest.staleRead = raw; __localTest.holdNextCommit = true; }, originalRaw);
    await second.evaluate((raw) => { __localTest.staleRead = raw; }, originalRaw);
    await page.getByLabel('Project name', { exact: true }).first().fill('First atomic edit');
    await page.waitForFunction(() => __localTest.commitHeld);
    await second.getByLabel('Project name', { exact: true }).first().fill('Second retained draft');
    await second.waitForFunction(() => __localTest.readwriteStarted > 0);
    await page.evaluate(() => { __localTest.releaseCommit = true; });
    await saved(page);
    await second.getByText(/Saved data changed in another tab or tool/).waitFor();
    assert.equal((await stored(page)).projects[0].name, 'First atomic edit');
    assert.equal((await page.evaluate(() => __localTest.head())).revision, 1);
    assert.equal(await second.getByLabel('Project name', { exact: true }).first().inputValue(), 'Second retained draft');
    assert.equal(JSON.parse(await download(second, 'Download my edits')).projects[0].name, 'Second retained draft');
    assert(await unloadBlocked(second));
    assert.equal(await second.evaluate(() => __localTest.legacyWrites), 0);
  }, { noLocks: true });

  await test('an abort after put success never reports a saved board and retry preserves the draft', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => { __localTest.abortAfterPut = true; });
    await page.getByLabel('Project name', { exact: true }).first().fill('Aborted but recoverable');
    await page.getByText(/Could not save on this device/).waitFor();
    assert.equal(await page.evaluate(() => __localTest.putSucceeded), true, 'The individual put succeeded before the transaction abort');
    assert.equal(await page.evaluate(() => __localTest.head()), null);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), originalRaw);
    assert.equal(JSON.parse(await download(page, 'Download my edits')).projects[0].name, 'Aborted but recoverable');
    assert(await unloadBlocked(page));
    await page.evaluate(() => { __localTest.abortAfterPut = false; });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click(); await saved(page);
    assert.equal((await stored(page)).projects[0].name, 'Aborted but recoverable');
    assert.equal((await page.evaluate(() => __localTest.head())).revision, 1);
  });

  await test('typing during an unfinished commit is retained and saved against the committed revision', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => { __localTest.holdNextCommit = true; });
    const field = page.getByLabel('Project name', { exact: true }).first();
    await field.fill('Earlier pending value');
    await page.waitForFunction(() => __localTest.commitHeld);
    await field.fill('Latest typed value');
    assert.equal(await field.inputValue(), 'Latest typed value');
    assert(await unloadBlocked(page));
    await page.evaluate(() => { __localTest.releaseCommit = true; });
    await saved(page);
    assert.equal((await stored(page)).projects[0].name, 'Latest typed value');
    assert.equal(await field.inputValue(), 'Latest typed value');
    assert.equal((await page.evaluate(() => __localTest.head())).revision, 2);
    assert.equal(await unloadBlocked(page), false);
  });

  await test('two OPS task saves without Web Locks append against the latest transaction state', async ({ page, newPage }) => {
    const second = await newPage();
    const prepare = async (tab, title) => {
      await tab.getByRole('button', { name: 'Task draft', exact: true }).first().click();
      await tab.getByLabel('Task title', { exact: true }).fill(title);
    };
    await prepare(page, 'First reviewed concurrent task');
    await prepare(second, 'Second reviewed concurrent task');
    await page.evaluate(() => { __localTest.holdNextCommit = true; });
    await page.getByRole('button', { name: 'Save locally', exact: true }).click();
    await page.waitForFunction(() => __localTest.commitHeld);
    await second.getByRole('button', { name: 'Save locally', exact: true }).click();
    await second.waitForFunction(() => __localTest.readwriteStarted > 0);
    await page.evaluate(() => { __localTest.releaseCommit = true; });
    await page.locator('.task-feedback').waitFor();
    await second.locator('.task-feedback').waitFor();
    const next = await stored(page);
    assert.deepEqual(next.projects[0].tasks.map((task) => task.text), ['Keep this task', 'First reviewed concurrent task', 'Second reviewed concurrent task']);
    assert.equal(new Set(next.projects[0].tasks.map((task) => task.id)).size, 3);
    assert.equal((await page.evaluate(() => __localTest.head())).revision, 2);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), originalRaw);
    assert.equal(await second.evaluate(() => __localTest.legacyWrites), 0);
  }, { noLocks: true });

  await test('older tabs cannot replace the canonical board and their separate edits remain downloadable', async ({ page, newPage }) => {
    await openBoard(page);
    await page.getByLabel('Project name', { exact: true }).first().fill('Current canonical board'); await saved(page);
    const second = await newPage();
    const olderRaw = JSON.stringify({ ...record, projects: [{ ...record.projects[0], name: 'Older tab edit' }, record.projects[1]] });
    await second.evaluate((raw) => __localTest.setLegacyRaw(raw), olderRaw);
    await page.getByRole('button', { name: 'Download older-tab data', exact: true }).waitFor();
    assert.equal((await stored(page)).projects[0].name, 'Current canonical board');
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'Current canonical board');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download older-tab data', exact: true }).click();
    assert.equal(await readFile(await (await pending).path(), 'utf8'), olderRaw);
    await page.getByRole('button', { name: 'Keep current board', exact: true }).click();
    await page.getByRole('button', { name: 'Download older-tab data', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await stored(page)).projects[0].name, 'Current canonical board');
    assert.equal((await page.evaluate(() => __localTest.head())).legacyRaw, olderRaw);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), olderRaw);
    await page.reload({ waitUntil: 'networkidle' }); await openBoard(page); await saved(page);
    assert.equal(await page.getByLabel('Project name', { exact: true }).first().inputValue(), 'Current canonical board');
    assert.equal(await page.getByRole('button', { name: 'Download older-tab data', exact: true }).count(), 0);
  });


  await test('typing while acknowledging an older-tab copy preserves the new edit without Web Locks', async ({ page, newPage }) => {
    await openBoard(page);
    const field = page.getByLabel('Project name', { exact: true }).first();
    await field.fill('Current board before acknowledgement'); await saved(page);
    const second = await newPage();
    const olderRaw = JSON.stringify({ ...record, customRoot: { olderTab: true } });
    await second.evaluate((raw) => __localTest.setLegacyRaw(raw), olderRaw);
    await page.getByRole('button', { name: 'Keep current board', exact: true }).waitFor();
    await page.evaluate(() => { __localTest.holdNextCommit = true; });
    await page.getByRole('button', { name: 'Keep current board', exact: true }).click();
    await page.waitForFunction(() => __localTest.commitHeld);
    await field.fill('Typed while acknowledgement commits');
    assert(await unloadBlocked(page));
    await page.evaluate(() => { __localTest.releaseCommit = true; });
    await saved(page);
    assert.equal(await field.inputValue(), 'Typed while acknowledgement commits');
    assert.equal((await stored(page)).projects[0].name, 'Typed while acknowledgement commits');
    const head = await page.evaluate(() => __localTest.head());
    assert.equal(head.revision, 3);
    assert.equal(head.legacyRaw, olderRaw);
    assert.equal(await page.evaluate(() => __localTest.legacyRaw()), olderRaw);
    assert.equal(await unloadBlocked(page), false);
  }, { noLocks: true });

} finally {
  await browser.close(); await server.close();
}
console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
