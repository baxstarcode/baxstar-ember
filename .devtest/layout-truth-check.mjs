// Read-only regression checks against an already generated, locally served build.
// No connector request leaves the browser; each viewport uses a fresh context.
//
// EMBER_TEST_URL=http://127.0.0.1:8099/index.html \
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
// CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
// node .devtest/layout-truth-check.mjs
// Optional: EMBER_SHOT_DIR=/tmp/ember-layout-shots
import { mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try { return await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName); }
  catch (error) {
    const bundled = resolve(dirname(dirname(process.execPath)), 'node_modules', 'playwright', 'index.mjs');
    if (!fs.existsSync(bundled)) throw error;
    return import(pathToFileURL(bundled).href);
  }
}
const { chromium } = await loadPlaywright();
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function startStaticServer() {
  const rootPrefix = `${resolve(root)}${sep}`;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://ember.test').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = resolve(root, relative);
    if ((!file.startsWith(rootPrefix) && file !== resolve(root, 'index.html')) ||
        !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webp': 'image/webp',
    }[extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(fs.readFileSync(file));
  });
  return new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveStarted(server));
  });
}

const staticServer = process.env.EMBER_TEST_URL ? null : await startStaticServer();
const target = process.env.EMBER_TEST_URL || `http://127.0.0.1:${staticServer.address().port}/index.html`;
const origin = new URL(target).origin;
const shotDir = process.env.EMBER_SHOT_DIR ? resolve(process.env.EMBER_SHOT_DIR) : null;
const reply = 'The regression check completed. Your dashboard is ready for a typed follow-up.';
const failures = [];
let checks = 0;

function verifiedSyncContent(text) {
  const content = [];
  for (const [server, tool] of [['quo', 'fetch-missed-calls'], ['gmail', 'search_threads'], ['calendar', 'list_events']]) {
    const id = `mcp_${server}`;
    content.push({ type: 'mcp_tool_use', id, name: tool, server_name: server, input: {} });
    content.push({ type: 'mcp_tool_result', tool_use_id: id, is_error: false, content: [] });
  }
  content.push({ type: 'text', text });
  return content;
}

if (shotDir) await mkdir(shotDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

async function check(name, run) {
  checks += 1;
  try {
    const result = await run();
    const { pass, detail = '' } = typeof result === 'boolean' ? { pass: result } : result;
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
    if (!pass) failures.push(name);
    return pass;
  } catch (error) {
    const detail = String(error.message || error).split('\n').slice(0, 3).join(' ');
    console.log(`FAIL — ${name} :: ${detail}`);
    failures.push(name);
    return false;
  }
}

function panel(page, title) {
  return page.locator('.panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
}

// Include clipping ancestors, not just an element's nominal CSS dimensions.
async function bounds(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    let top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        left = Math.max(left, rect.left); right = Math.min(right, rect.right);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
      }
    }
    return {
      width: box.width, height: box.height,
      visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top),
    };
  });
}

async function noOverflow(page) {
  const extra = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - document.documentElement.clientWidth);
  return { pass: extra <= 1, detail: `${extra}px document overflow` };
}

async function snapshot(page, name) {
  if (shotDir) await page.screenshot({ path: resolve(shotDir, `${name}.png`), fullPage: true });
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    const phone = viewport.width < 600;
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [];
    const unexpectedApis = [];
    let syncRequests = 0, chatRequests = 0;
    // Allow local static build files. Intercept every write and every external
    // fetch/XHR, and stub remaining external assets so this test stays offline.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const external = new URL(request.url()).origin !== origin;
      const isApi = !['GET', 'HEAD'].includes(request.method()) ||
        (external && ['fetch', 'xhr'].includes(request.resourceType()));
      if (isApi) {
        let body;
        try { body = request.postDataJSON(); } catch { body = null; }
        // The data-free credential check OPS sync runs first (2026-10-15).
        if (!external && new URL(request.url()).pathname === '/api/connectors/status') {
          await route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ connectors: { quo: 'connected', gmail: 'connected', calendar: 'connected', gdrive: 'connected' } }) });
          return;
        }
        if (!Array.isArray(body?.messages)) {
          unexpectedApis.push(`${request.method()} ${request.url()}`);
          await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: 'Unrecognised API request in offline test' }) });
          return;
        }
        const syncing = /ONLY valid JSON/i.test(JSON.stringify(body.messages));
        if (syncing) syncRequests += 1; else chatRequests += 1;
        const text = syncing ? JSON.stringify({ voicemails: [], emails: [], events: [] }) : reply;
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ content: syncing ? verifiedSyncContent(text) : [{ type: 'text', text }], stop_reason: 'end_turn' }),
        });
        return;
      }
      if (external) {
        await route.fulfill({ status: 200, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' });
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const loaded = await check(`${name} generated page loads`, async () => {
        const response = await page.goto(target, { waitUntil: 'networkidle' });
        await page.locator('.core-chamber').waitFor({ state: 'visible' });
        await page.waitForFunction(() => [...document.querySelectorAll('.reveal')].every((node) => Number(getComputedStyle(node).opacity) >= 0.99));
        return { pass: response?.ok(), detail: `HTTP ${response?.status()}` };
      });
      if (!loaded) continue;

      await check(`${name} core has usable visible space`, async () => {
        const box = await bounds(page.locator('.core-chamber'));
        return { pass: box.height >= 360 && box.visibleHeight >= 220 && box.visibleWidth >= (phone ? 250 : 300), detail: JSON.stringify(box) };
      });
      // The brass skull arch was removed 2026-09-22 (Brady). The reactor is the
      // crown now — assert IT is the one that stays inside the chamber.
      await check(`${name} skull ornament is gone`, async () => {
        const count = await page.locator('.skull-arch').count();
        return { pass: count === 0, detail: `${count} found` };
      });
      await check(`${name} reactor crown stays inside chamber`, async () => {
        const result = await page.locator('.reactor-stage').evaluate((stage) => {
          const core = stage.getBoundingClientRect(), chamber = stage.closest('.core-chamber').getBoundingClientRect();
          return {
            topInset: core.top - chamber.top, leftInset: core.left - chamber.left,
            rightInset: chamber.right - core.right, width: core.width, height: core.height,
          };
        });
        return { pass: result.width > 100 && result.height > 100 && result.topInset >= -1 && result.leftInset >= -1 && result.rightInset >= -1, detail: JSON.stringify(result) };
      });
      await check(`${name} no initial horizontal overflow`, () => noOverflow(page));

      await check(`${name} THE WORKS is off the OPS page (it lives in the Knowledge Graph overlay)`, async () => {
        const count = await page.locator('.eco-rail').count();
        return { pass: count === 0, detail: `${count} on page` };
      });

      await check(`${name} successful empty sync reaches all three panels`, async () => {
        try {
          const sync = page.locator('.sync-control');
          await sync.waitFor({ state: 'visible' });
          await page.waitForFunction(() => {
            const button = document.querySelector('.sync-control');
            return button && !button.disabled;
          });
          const before = syncRequests;
          await sync.click();
          const started = Date.now();
          while (syncRequests <= before && Date.now() - started < 6000) await page.waitForTimeout(50);
          if (syncRequests <= before) throw new Error('SYNC did not start a new mocked request within 6000ms');
          await page.waitForFunction(() => {
            const button = document.querySelector('.sync-control');
            return button && !button.disabled;
          });
          return { pass: true, detail: `${syncRequests - before} new mocked sync request(s)` };
        } catch (error) {
          if (shotDir) {
            try { await snapshot(page, `${name}-sync-failed`); }
            catch (shotError) { console.log(`Failed to capture sync screenshot: ${shotError.message}`); }
          }
          throw error;
        }
      });
      for (const [title, count, empty] of [
        ['Calls & Voicemail', /^0\s+ITEMS$/i, /no (?:missed )?calls|no voicemails/i],
        ['Inbox', /^0\s+UNREAD$/i, /no unread|inbox (?:is )?(?:zero|empty)|no (?:new )?(?:emails|messages)/i],
        ['Schedule', /^0\s+EVENTS$/i, /nothing scheduled|no (?:calendar )?events|no .*scheduled/i],
      ]) {
        await check(`${name} ${title} shows zero and an explicit empty state`, async () => {
          const feed = panel(page, title);
          const text = await feed.innerText();
          return { pass: await feed.getByText(count).count() === 1 && empty.test(text), detail: text.replace(/\s+/g, ' ').slice(0, 180) };
        });
        await check(`${name} ${title} has no placeholder actions`, async () => {
          const feed = panel(page, title);
          const actions = await feed.locator('.row-sel, .ember-row button').count();
          const drafts = await feed.getByRole('button', { name: /draft reply|^task$/i }).count();
          return { pass: actions === 0 && drafts === 0, detail: `${actions} actionable rows/row buttons, ${drafts} draft/task buttons` };
        });
      }
      await check(`${name} greeting counts are zero`, async () => {
        const greeting = await page.locator('.greet-row').innerText();
        return { pass: /\b0\s+(?:voicemails|vm)\b/i.test(greeting) && /\b0\s+unread\b/i.test(greeting), detail: greeting.replace(/\s+/g, ' ') };
      });

      await check(`${name} typed command answers through the visible controls`, async () => {
        await page.locator('.core-chamber .cmd-input').fill('Run the layout regression check.');
        await page.locator('.core-chamber').getByRole('button', { name: 'RUN', exact: true }).click();
        await page.locator('.home-thread').getByText(reply, { exact: false }).waitFor({ state: 'visible' });
        return { pass: chatRequests > 0, detail: `${chatRequests} mocked chat request(s)` };
      });
      await check(`${name} compact reply thread is readable and not clipped`, async () => {
        const thread = page.locator('.home-thread');
        await thread.scrollIntoViewIfNeeded();
        const box = await bounds(thread);
        const minWidth = phone ? 250 : 300;
        return { pass: box.width >= minWidth && box.height >= 130 && box.height <= 170 && box.visibleWidth >= minWidth && box.visibleHeight >= 130, detail: JSON.stringify(box) };
      });
      await check(`${name} input reserves text space for RUN`, async () => {
        const result = await page.locator('.core-chamber .cmd-input').evaluate((input, minWidth) => {
          const run = [...input.parentElement.querySelectorAll('button')].find((button) => button.textContent.trim() === 'RUN');
          if (!run) return { pass: false, reason: 'RUN button missing from input control' };
          const field = input.getBoundingClientRect(), button = run.getBoundingClientRect(), style = getComputedStyle(input);
          const textLeft = field.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
          const textRight = field.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
          const overlaps = button.top < field.bottom && button.bottom > field.top && button.left < field.right && button.right > field.left;
          return {
            pass: field.width >= minWidth && textRight - textLeft >= 160 && (!overlaps || textRight <= button.left - 2),
            inputWidth: field.width, textWidth: textRight - textLeft,
            overlapProtected: !overlaps || textRight <= button.left - 2,
          };
        }, phone ? 200 : 250);
        return { pass: result.pass, detail: JSON.stringify(result) };
      });
      await check(`${name} no horizontal overflow after reply`, () => noOverflow(page));
      await snapshot(page, `${name}-chat`);

      await check(`${name} tools contain 12 valid safe links`, async () => {
        const links = await page.locator('.tools-rail .tool-link').evaluateAll((nodes) => nodes.map((node) => ({
          href: node.getAttribute('href'), target: node.target, rel: node.rel, text: node.textContent.trim(),
          tag: node.tagName, popup: node.getAttribute('aria-haspopup'),
        })));
        // Signal Log is the one in-page tool: a button that opens the overlay (aria-haspopup=dialog), no href.
        const invalid = links.filter((link) => {
          if (link.tag === 'BUTTON') return !(link.popup === 'dialog' && link.text);
          try { const url = new URL(link.href); return !/^https?:$/.test(url.protocol) || !url.hostname || link.target !== '_blank' || !/\bnoopener\b/.test(link.rel) || !link.text; }
          catch { return true; }
        });
        return { pass: links.length === 12 && invalid.length === 0, detail: `${links.length} links, ${invalid.length} invalid` };
      });
      await check(`${name} all tools are reachable by ordinary page and strip scrolling`, async () => {
        // Do not use scrollIntoView here: it can programmatically scroll an
        // overflow:hidden ancestor which a real wheel/trackpad cannot scroll.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.mouse.move(viewport.width - 4, Math.round(viewport.height * 0.6));
        const seen = new Set();
        for (let attempt = 0; attempt < 18 && seen.size < 12; attempt += 1) {
          const reachable = await page.locator('.tools-rail .tool-link').evaluateAll((links) => links.flatMap((link, index) => {
            const rect = link.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return rect.width > 0 && rect.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && hit && link.contains(hit) ? [index] : [];
          }));
          reachable.forEach((index) => seen.add(index));
          if (seen.size === 12) break;
          const strip = await page.locator('.tools-groups').evaluate((groups) => {
            const rect = groups.getBoundingClientRect();
            const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
            const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
            const hit = document.elementFromPoint(x, y);
            return {
              x, y, step: Math.round(groups.clientWidth * 0.6),
              canPan: rect.bottom > 0 && rect.top < innerHeight && hit && groups.contains(hit) &&
                groups.scrollLeft + groups.clientWidth < groups.scrollWidth - 1,
            };
          });
          if (strip.canPan) {
            await page.mouse.move(strip.x, strip.y);
            await page.mouse.wheel(strip.step, 0);
          } else {
            await page.mouse.move(viewport.width - 4, Math.round(viewport.height * 0.6));
            await page.mouse.wheel(0, Math.round(viewport.height * 0.6));
          }
          await page.waitForTimeout(90);
        }
        return { pass: seen.size === 12, detail: `${seen.size}/12 links became visible and hit-testable` };
      });

      await check(`${name} Knowledge Graph overlay opens THE WORKS with 39 parts and 60 links`, async () => {
        await page.locator('.console-dock').getByRole('button', { name: 'Knowledge Graph', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Knowledge Graph' });
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('tab', { name: 'The Works' }).click();
        const rail = dialog.locator('details.eco-rail');
        const open = await rail.evaluate((element) => element.open);
        const nodes = await rail.locator('.eco-node').count(), edges = await rail.locator('.eco-svg line').count();
        const svg = await rail.locator('.eco-svg').boundingBox();
        return { pass: open && nodes === 39 && edges === 60 && Boolean(svg?.width && svg?.height), detail: `${nodes} parts, ${edges} links, open=${open}` };
      });
      await check(`${name} no horizontal overflow with graph open`, () => noOverflow(page));
      await snapshot(page, `${name}-graph`);
      await check(`${name} Escape closes the graph and returns focus to the dock`, async () => {
        await page.keyboard.press('Escape');
        const gone = await page.getByRole('dialog', { name: 'Knowledge Graph' }).count() === 0;
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.replace(/\u00AD/g, '').trim());
        return { pass: gone && /Knowledge Graph/.test(focused || ''), detail: `gone=${gone} focus=${focused}` };
      });

      const missionOpen = await check(`${name} fresh Mission Control opens`, async () => {
        await page.locator('.console-dock').getByRole('button', { name: 'Projects', exact: true }).click();
        await page.getByRole('button', { name: 'MISSION CONTROL', exact: true }).click();
        await page.locator('.mc-grid').waitFor({ state: 'visible' });
        return true;
      });
      if (missionOpen) {
        await check(`${name} usage is blank and allowance is 1500`, async () => {
          const meter = panel(page, 'Zapier Task Meter');
          const used = await meter.getByLabel('Used', { exact: true }).inputValue();
          const allowance = await meter.getByLabel('Allowance', { exact: true }).inputValue();
          return { pass: used === '' && Number(allowance) === 1500, detail: `used=${JSON.stringify(used)}, allowance=${allowance}` };
        });
        await check(`${name} no retired voice-rig seed`, async () => {
          const values = await page.locator('.mc-grid input, .mc-grid textarea').evaluateAll((inputs) => inputs.map((input) => input.value));
          const retired = values.filter((value) => /merge (?:the )?voice rig|voice rig into the app/i.test(value));
          return { pass: retired.length === 0, detail: retired.join(' | ') };
        });
        await check(`${name} manual rollups do not claim LIVE`, async () => {
          const rollups = panel(page, 'Rollups');
          const text = await rollups.innerText();
          return { pass: !/\bLIVE\b/.test(text), detail: text.replace(/\s+/g, ' ').slice(0, 150) };
        });
        await snapshot(page, `${name}-mission`);
      }
      await check(`${name} no unexpected API routes`, () => ({ pass: unexpectedApis.length === 0, detail: unexpectedApis.join(' | ') }));
      await check(`${name} no page exceptions`, () => ({ pass: errors.length === 0, detail: errors.join(' | ') }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolveClose) => staticServer.close(resolveClose));
}

console.log(`\nLAYOUT / TRUTH ${failures.length ? 'FAIL' : 'PASS'}: ${checks - failures.length}/${checks} checks passed.`);
if (failures.length) console.log(failures.map((name) => `- ${name}`).join('\n'));
process.exitCode = failures.length ? 1 : 0;
