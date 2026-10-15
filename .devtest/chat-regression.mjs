// Offline, rendered-UI chat regression suite. Builds canonical JSX in /tmp;
// never writes index.html and never sends an upstream API request.
// Run with the bundled Node runtime. PLAYWRIGHT_MODULE, CHROME_PATH and
// EMBER_SHOT_DIR can override the bundled defaults and optional screenshot path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChatTestServer } from './chat-test-server.mjs';

async function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try { return await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName); }
  catch (error) {
    const bundled = join(dirname(dirname(process.execPath)), 'node_modules', 'playwright', 'index.mjs');
    if (!fs.existsSync(bundled)) throw error;
    return import(pathToFileURL(bundled).href);
  }
}
const { chromium } = await loadPlaywright();
const shotDir = process.env.EMBER_SHOT_DIR ? resolve(process.env.EMBER_SHOT_DIR) : null;
if (shotDir) await mkdir(shotDir, { recursive: true });
const server = await createChatTestServer();
const origin = new URL(server.url).origin;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const failures = [];
let passed = 0;

const frame = (type, fields = {}, eol = '\n') => `event: ${type}${eol}data: ${JSON.stringify({ type, ...fields })}${eol}${eol}`;
const start = () => frame('message_start', { message: { id: 'msg_fixture', model: 'claude-opus-5', role: 'assistant', content: [], stop_reason: null } }) + frame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
const delta = (text) => frame('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
const finish = (reason = 'end_turn') => frame('content_block_stop', { index: 0 }) + frame('message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 12 } }) + frame('message_stop');
const reply = (text, extra = {}) => ({ mode: 'json', text, ...extra });
const taskSyncData = {
  voicemails: [{ from: '(218) 555-0199', line: 'Fishing', time: '9:00 AM', note: 'Call fixture', vm: 'Please call about Saturday availability.' }],
  emails: [{ from: 'Fixture Email Sender', time: '9:15 AM', subject: 'Confirm the dock schedule' }], events: [],
};
const savedMission = {
  customRoot: { preserve: 'root metadata' },
  zap: { used: 29, allowance: 1500, dayOfCycle: 4, daysInCycle: 30 },
  decisions: [{ id: 'decision-existing', text: 'Keep this decision', done: false }],
  projects: [
    { id: 'ember-existing', name: 'Baxstar Ember', pct: 97, status: 'active', revenue: false, sessions: 1, hours: 2, next: 'Existing next action', updated: '2026-09-18', links: [], customProject: 'preserve this', tasks: [{ id: 'task-existing', text: 'Existing task', done: true }] },
    { id: 'other-existing', name: 'Unrelated project', pct: 50, status: 'parked', revenue: true, sessions: 2, hours: 3, next: 'Unrelated next action', updated: '2026-09-18', links: [], tasks: [{ id: 'other-task', text: 'Unrelated task', done: false }] },
  ],
};
const taskOptions = { syncData: taskSyncData, storage: { 'ember-mc': savedMission } };

async function syncCommunications(f) {
  await f.page.locator('.sync-control').click();
  await f.page.locator('.ember-row').filter({ hasText: taskSyncData.voicemails[0].from }).waitFor();
  await f.page.waitForFunction(() => !document.querySelector('.sync-control').disabled);
  return f.page.evaluate(() => __chatMock.allRequests.length);
}

async function fixture({ legacy, storage = {}, syncData = { voicemails: [], emails: [], events: [] }, viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const pageErrors = [];
  const escapedRequests = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    if (['fetch', 'xhr'].includes(request.resourceType())) escapedRequests.push(`${request.method()} ${request.url()}`);
    return route.fulfill({ status: 200, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' });
  });
  await context.addInitScript(({ legacy, storage, syncData }) => {
    if (!sessionStorage.getItem('chat-fixture-seeded')) {
      if (legacy !== undefined) localStorage.setItem('ember-chat', JSON.stringify(legacy));
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('chat-fixture-seeded', 'yes');
    }
    const originalFetch = window.fetch.bind(window);
    const mock = window.__chatMock = { plans: [], requests: [], allRequests: [], clipboard: [], voiceStarts: 0, unexpected: [], nextId: 0 };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => {
      if (mock.clipboardFail) throw new Error('Clipboard fixture denied');
      if (mock.clipboardPending) await new Promise((resolve) => { mock.resolveClipboard = resolve; });
      mock.clipboard.push(text);
    } } });
    window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { mock.voiceStarts += 1; } stop() {} abort() {} };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() { mock.voiceStarts += 1; }, cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} } });
    window.fetch = async (input, init = {}) => {
      const url = String(input?.url || input);
      let body;
      try { body = JSON.parse(init.body); } catch { body = null; }
      // The data-free credential check OPS sync runs first (2026-10-15).
      if (new URL(url, location.href).pathname === '/api/connectors/status' && init.method === 'POST') {
        return new Response(JSON.stringify({ connectors: { quo: 'connected', gmail: 'connected', calendar: 'connected', gdrive: 'connected' } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (!Array.isArray(body?.messages)) {
        if (new URL(url, location.href).origin === location.origin && (!init.method || init.method === 'GET')) return originalFetch(input, init);
        mock.unexpected.push({ url, method: init.method });
        throw new Error('Unmocked API request blocked');
      }
      mock.allRequests.push({ url, body });
      if (/ONLY valid JSON/i.test(JSON.stringify(body.messages))) {
        const content = [];
        for (const [server, tool] of [['quo', 'fetch-missed-calls'], ['gmail', 'search_threads'], ['calendar', 'list_events']]) {
          const id = `mcp_${server}`;
          content.push({ type: 'mcp_tool_use', id, name: tool, server_name: server, input: {} });
          content.push({ type: 'mcp_tool_result', tool_use_id: id, is_error: false, content: [] });
        }
        content.push({ type: 'text', text: JSON.stringify(syncData) });
        return new Response(JSON.stringify({ content, stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const plan = mock.plans.shift() || { mode: 'json', text: 'Default fixture answer.' };
      const record = { id: mock.nextId++, body, url, hasSignal: init.signal instanceof AbortSignal, aborted: Boolean(init.signal?.aborted), cancelled: false, plan };
      mock.requests.push(record);
      init.signal?.addEventListener('abort', () => { record.aborted = true; record.abort?.(); }, { once: true });
      const headers = { 'content-type': plan.mode === 'stream' ? 'text/event-stream' : 'application/json', ...(plan.headers || {}) };
      if (plan.mode === 'throw') throw new TypeError(plan.error || 'Fixture network failure');
      if (plan.mode === 'stream') {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            record.push = (chunk) => { if (!closed) controller.enqueue(encoder.encode(chunk)); };
            record.close = () => { if (!closed) { closed = true; controller.close(); } };
            record.abort = () => { if (!closed && !plan.ignoreAbort) { closed = true; controller.error(new DOMException('Fixture aborted', 'AbortError')); } };
            for (const chunk of plan.chunks || []) record.push(chunk);
            if (!plan.hold) record.close();
          },
          cancel() { record.cancelled = true; },
        });
        return new Response(stream, { status: plan.status || 200, headers });
      }
      const makeResponse = () => new Response(JSON.stringify(plan.payload || { content: [{ type: 'text', text: plan.text || '' }], stop_reason: plan.reason || 'end_turn', model: plan.model || body.model }), { status: plan.status || 200, headers });
      if (plan.mode === 'pending') return new Promise((resolve, reject) => {
        record.resolve = () => resolve(makeResponse());
        record.abort = () => { if (!plan.ignoreAbort) reject(new DOMException('Fixture aborted', 'AbortError')); };
      });
      return makeResponse();
    };
  }, { legacy, storage, syncData });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.locator('.chat-composer textarea.cmd-input').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return {
    page, context, pageErrors, escapedRequests,
    composer: page.locator('.chat-composer textarea.cmd-input'),
    assistants: page.locator('.home-thread .chat-bubble[data-role="assistant"]'),
    users: page.locator('.home-thread .chat-bubble[data-role="user"]'),
    async plan(...plans) { await page.evaluate((plans) => __chatMock.plans.push(...plans), plans); },
    async send(text) { await this.composer.fill(text); await page.locator('.chat-composer').getByRole('button', { name: 'RUN', exact: true }).click(); },
    async requests() { return page.evaluate(() => __chatMock.requests.map(({ body, hasSignal, aborted, cancelled }) => ({ body, hasSignal, aborted, cancelled }))); },
    async settle(status = 'complete') { await page.waitForFunction((status) => [...document.querySelectorAll('.home-thread .chat-bubble[data-role="assistant"]')].at(-1)?.dataset.status === status, status); await page.locator('.chat-composer').getByRole('button', { name: 'RUN', exact: true }).waitFor({ state: 'visible' }); },
    async push(index, chunk, close = false) { await page.evaluate(({ index, chunk, close }) => { __chatMock.requests[index].push?.(chunk); if (close) __chatMock.requests[index].close?.(); }, { index, chunk, close }); },
  };
}

async function test(name, run, options) {
  let f;
  try {
    f = await fixture(options);
    await run(f);
    assert.deepEqual(f.pageErrors, [], 'Uncaught browser errors');
    assert.deepEqual(f.escapedRequests, [], 'A fetch escaped the in-page API mock');
    assert.deepEqual(await f.page.evaluate(() => __chatMock.unexpected), [], 'Unexpected API request');
    console.log(`PASS — ${name}`);
    passed += 1;
  } catch (error) {
    failures.push(name);
    console.log(`FAIL — ${name}: ${String(error.message || error).split('\n').slice(0, 8).join(' ')}`);
    if (shotDir && f) await f.page.screenshot({ path: resolve(shotDir, `${name.replace(/[^\w-]+/g, '-')}-failed.png`), fullPage: true }).catch(() => {});
  } finally { if (f) await f.context.close(); }
}

try {
  await test('legacy hydration restores valid request context', async (f) => {
    assert.equal(await f.users.count(), 1);
    assert.equal(await f.assistants.count(), 1);
    await f.plan(reply('Restored context answered.'));
    await f.send('What about Sunday?');
    await f.settle();
    const messages = (await f.requests())[0].body.messages;
    assert.deepEqual(messages.slice(-3).map(({ role, content }) => ({ role, content })), [
      { role: 'user', content: 'Plan Saturday.' }, { role: 'assistant', content: 'Saturday is reserved.' }, { role: 'user', content: 'What about Sunday?' },
    ]);
    const ids = await f.page.locator('.home-thread .chat-bubble').evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId));
    assert.equal(new Set(ids).size, ids.length);
    assert(ids.every((id) => /^[\da-f]{8}-[\da-f-]{27}$/i.test(id)), `Expected stable UUIDs: ${ids}`);
    await f.page.reload({ waitUntil: 'networkidle' });
    await f.page.waitForFunction((count) => document.querySelectorAll('.home-thread .chat-bubble').length === count, ids.length);
    assert.deepEqual(await f.page.locator('.home-thread .chat-bubble').evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId)), ids);
  }, { legacy: [{ role: 'user', content: 'Plan Saturday.' }, { role: 'assistant', content: 'Saturday is reserved.' }] });

  await test('persisted transient answers are excluded from context', async (f) => {
    await f.plan(reply('Clean context.'));
    await f.send('New question');
    await f.settle();
    const contents = (await f.requests())[0].body.messages.map((message) => message.content);
    assert(!contents.includes('unfinished transient text'));
    assert(!contents.includes('failed transient text'));
    assert(contents.includes('A durable answer'));
  }, { legacy: [
    { role: 'user', content: 'Durable question' }, { role: 'assistant', content: 'A durable answer' },
    { role: 'user', content: 'Interrupted question' }, { role: 'assistant', content: 'unfinished transient text', streaming: true },
    { role: 'user', content: 'Failed question' }, { role: 'assistant', content: 'failed transient text', status: 'error' },
  ] });

  await test('chunked CRLF and multiline SSE frames complete correctly', async (f) => {
    const multiline = 'event: content_block_delta\r\ndata: {"type":"content_block_delta",\r\ndata: "index":0,"delta":{"type":"text_delta","text":"First paragraph.\\n\\nSecond paragraph."}}\r\n\r\n';
    const sse = start().replaceAll('\n', '\r\n') + ': fixture heartbeat\r\n\r\n' + multiline + finish().replaceAll('\n', '\r\n');
    const chunks = [];
    for (let offset = 0; offset < sse.length; offset += 7) chunks.push(sse.slice(offset, offset + 7));
    await f.plan({ mode: 'stream', chunks });
    await f.send('Read fragmented events');
    await f.settle();
    assert.match(await f.assistants.last().innerText(), /First paragraph\.[\s\S]*Second paragraph\./);
    assert.equal((await f.requests()).length, 1);
  });

  await test('structured SSE errors retain partial output and offer retry', async (f) => {
    await f.plan({ mode: 'stream', chunks: [start() + delta('Partial remains. ') + frame('error', { error: { type: 'overloaded_error', message: 'Fixture provider overloaded' } })] });
    await f.send('Trigger stream error');
    await f.settle('error');
    assert.match(await f.assistants.last().innerText(), /Partial remains/);
    assert.match(await f.page.locator('.chat-error').last().innerText(), /overloaded|error|failed/i);
    assert.equal(await f.users.last().getByRole('button', { name: 'Retry', exact: true }).count(), 1);
    assert.equal((await f.requests()).length, 1, 'No automatic model fallback');
  });

  await test('event-only SSE errors fail visibly', async (f) => {
    await f.plan({ mode: 'stream', chunks: ['event: error\ndata: {"error":{"type":"api_error","message":"Fixture event error"}}\n\n'] });
    await f.send('Trigger event-only error');
    await f.settle('error');
    assert(await f.page.locator('.chat-error').count() > 0);
    assert.equal((await f.requests()).length, 1);
  });

  await test('premature SSE EOF is an error and retains partial text', async (f) => {
    await f.plan({ mode: 'stream', chunks: [start() + delta('Interrupted body.')] });
    await f.send('Trigger EOF');
    await f.settle('error');
    assert.match(await f.assistants.last().innerText(), /Interrupted body/);
    assert.match(await f.page.locator('.chat-error').last().innerText(), /incomplete|interrupt|ended|stream/i);
  });

  await test('max_tokens completion is visibly truncated', async (f) => {
    await f.plan({ mode: 'stream', chunks: [start() + delta('Bounded partial answer.') + finish('max_tokens')] });
    await f.send('Trigger max tokens');
    await f.settle('truncated');
    assert.match(await f.assistants.last().innerText(), /Bounded partial answer/);
    assert.match(await f.assistants.last().innerText(), /limit|truncat|incomplete|short/i);
  });

  await test('Stop aborts fetch and keeps partial output', async (f) => {
    await f.plan({ mode: 'stream', hold: true, chunks: [start() + delta('Keep this stopped output.')] });
    await f.send('Long request');
    await f.page.waitForFunction(() => document.querySelector('.chat-bubble[data-status="streaming"]')?.textContent.includes('Keep this'));
    await f.page.locator('.chat-composer').getByRole('button', { name: 'Stop', exact: true }).click();
    await f.settle('stopped');
    const [request] = await f.requests();
    assert.equal(request.hasSignal, true);
    assert.equal(request.aborted, true);
    assert.match(await f.assistants.last().innerText(), /Keep this stopped output/);
  });

  await test('Enter and quick actions cannot submit overlapping requests', async (f) => {
    await f.plan({ mode: 'stream', hold: true, chunks: [start() + delta('Still working.')] });
    await f.composer.fill('One request only');
    await f.composer.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await f.page.locator('.chat-composer').getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await f.composer.fill('Draft while waiting');
    await f.composer.press('Enter');
    await f.page.locator('.console-dock .dock-control').evaluateAll((buttons) => buttons.filter((button) => /brief|priority|wrap/i.test(button.textContent)).forEach((button) => button.click()));
    assert.equal((await f.requests()).length, 1);
    assert.equal(await f.users.count(), 1);
    assert.equal(await f.composer.inputValue(), 'Draft while waiting');
    await f.push(0, finish(), true);
    await f.settle();
  });

  await test('clear and late completion cannot corrupt a new answer', async (f) => {
    await f.plan({ mode: 'pending', ignoreAbort: true, text: 'STALE must never appear' }, reply('Fresh answer is preserved.'));
    await f.send('Old question');
    await f.page.getByRole('button', { name: 'Clear thread', exact: true }).click();
    await f.send('Fresh question');
    await f.settle();
    const freshId = await f.assistants.last().getAttribute('data-message-id');
    await f.page.evaluate(() => __chatMock.requests[0].resolve());
    await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.users.count(), 1);
    assert.equal(await f.assistants.count(), 1);
    assert.equal(await f.assistants.last().getAttribute('data-message-id'), freshId);
    assert.match(await f.assistants.last().innerText(), /Fresh answer is preserved/);
    assert.doesNotMatch(await f.page.locator('.home-thread').innerText(), /STALE|Old question/);
    assert.equal((await f.requests())[0].aborted, true);
  });

  await test('Stop followed immediately by Send keeps new turn ownership', async (f) => {
    await f.plan({ mode: 'pending', ignoreAbort: true, text: 'Late stopped output' }, reply('New owned answer'));
    await f.send('Stop this');
    await f.page.locator('.chat-composer').getByRole('button', { name: 'Stop', exact: true }).click();
    await f.send('Send this');
    await f.settle();
    await f.page.evaluate(() => __chatMock.requests[0].resolve());
    await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.users.count(), 2);
    assert.match(await f.assistants.last().innerText(), /New owned answer/);
    assert.doesNotMatch(await f.page.locator('.home-thread').innerText(), /Late stopped output/);
    assert.equal(await f.assistants.first().getAttribute('data-status'), 'stopped');
  });

  await test('Retry replaces one assistant attempt and preserves user context', async (f) => {
    await f.plan(reply('Original answer'), reply('Replacement answer'));
    await f.send('Original retry question');
    await f.settle();
    const userId = await f.users.last().getAttribute('data-message-id');
    await f.users.last().getByRole('button', { name: 'Retry', exact: true }).click();
    await f.settle();
    const requests = await f.requests();
    assert.equal(requests.length, 2);
    assert.equal(await f.users.count(), 1);
    assert.equal(await f.users.last().getAttribute('data-message-id'), userId);
    assert.equal(await f.assistants.count(), 1);
    assert.match(await f.assistants.last().innerText(), /Replacement answer/);
    assert.equal(requests[1].body.messages.filter((message) => message.content === 'Original retry question').length, 1);
    assert(!requests[1].body.messages.some((message) => message.content === 'Original answer'));
  });

  await test('Copy writes answer and reports clipboard failures truthfully', async (f) => {
    await f.plan(reply('Copy this exact answer.'));
    await f.send('Copy fixture');
    await f.settle();
    await f.assistants.last().getByRole('button', { name: 'Copy reply', exact: true }).click();
    assert.deepEqual(await f.page.evaluate(() => __chatMock.clipboard), ['Copy this exact answer.']);
    assert.match(await f.page.locator('.chat-feedback').innerText(), /copied/i);
    await f.page.evaluate(() => { __chatMock.clipboardFail = true; });
    await f.assistants.last().getByRole('button', { name: 'Copy reply', exact: true }).click();
    assert.match(await f.page.locator('.chat-feedback').innerText(), /couldn.t|failed|unable|could not|unavailable/i);
    assert.equal(await f.page.locator('.chat-error').count(), 0);
  });

  await test('late clipboard completion cannot restore cleared feedback', async (f) => {
    await f.plan(reply('Delayed clipboard answer'));
    await f.send('Delayed clipboard fixture');
    await f.settle();
    await f.page.evaluate(() => { __chatMock.clipboardPending = true; });
    await f.assistants.last().getByRole('button', { name: 'Copy reply', exact: true }).click();
    await f.page.waitForFunction(() => typeof __chatMock.resolveClipboard === 'function');
    await f.page.getByRole('button', { name: 'Clear thread', exact: true }).click();
    await f.page.evaluate(() => __chatMock.resolveClipboard());
    await f.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.page.locator('.chat-feedback').count(), 0);
  });

  await test('clear removes persisted conversation draft error and context', async (f) => {
    await f.plan({ mode: 'throw' }, reply('New clean answer'));
    await f.send('Failed prior question');
    await f.settle('error');
    await f.composer.fill('Unsent draft to clear');
    await f.page.getByRole('button', { name: 'Clear thread', exact: true }).click();
    assert.equal(await f.page.locator('.home-thread .chat-bubble').count(), 0);
    assert.equal(await f.composer.inputValue(), '');
    assert.equal(await f.page.locator('.chat-error').count(), 0);
    const stored = await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-chat') || '[]'));
    assert.equal(Array.isArray(stored) ? stored.length : stored.messages?.length, 0);
    await f.send('New clean question');
    await f.settle();
    assert(!(await f.requests())[1].body.messages.some((message) => message.content === 'Failed prior question'));
  });

  await test('keyboard supports multiline while ignoring IME and key repeats', async (f) => {
    const run = f.page.locator('.chat-composer').getByRole('button', { name: 'RUN', exact: true });
    assert.equal(await run.isDisabled(), true);
    await f.composer.fill('Paragraph one');
    await f.composer.press('Shift+Enter');
    await f.composer.press('End');
    await f.composer.type('Paragraph two');
    assert.equal(await f.composer.inputValue(), 'Paragraph one\nParagraph two');
    await f.composer.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
    });
    assert.equal((await f.requests()).length, 0);
    await f.plan(reply('Keyboard sent.'));
    await f.composer.press('Enter');
    await f.settle();
    assert.equal((await f.requests())[0].body.messages.at(-1).content, 'Paragraph one\nParagraph two');
    assert.equal(await f.composer.getAttribute('aria-label'), 'Ask Ember');
  });

  await test('degraded connector header produces a chat-specific warning', async (f) => {
    await f.plan(reply('Answer without optional connectors.', { headers: { 'x-ember-connectors': 'degraded' } }));
    await f.send('Degraded fixture');
    await f.settle();
    assert.match(await f.page.locator('.chat-connectors').innerText(), /connector|unavailable|degraded|without/i);
    assert.equal(await f.page.locator('.chat-error').count(), 0);
    assert.match(await f.assistants.last().innerText(), /Answer without optional connectors/);
  });

  await test('paragraphs lists and code render safely', async (f) => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n\n- First bullet\n- Second bullet\n\n```html\n<img src=x onerror="window.__injected=true">\n<script>window.__injected=true</script>\n```\n\n<img src=x onerror="window.__injected=true">\n\n[Bad](javascript:alert(1)) [Data](data:text/html,unsafe) [Good](https://example.com/reference)';
    await f.plan(reply(markdown));
    await f.send('Render fixture');
    await f.settle();
    assert(await f.assistants.last().locator('p').count() >= 2);
    assert(await f.assistants.last().locator('li').count() >= 2);
    assert.equal(await f.assistants.last().locator('pre code').count(), 1);
    assert.match(await f.assistants.last().locator('pre code').innerText(), /<img src=x onerror/);
    assert.equal(await f.assistants.last().locator('img,script').count(), 0);
    assert.equal(await f.assistants.last().locator('a[href^="javascript:"],a[href^="data:"]').count(), 0);
    const safeLink = f.assistants.last().getByRole('link', { name: 'Good', exact: true });
    assert.equal(await safeLink.getAttribute('href'), 'https://example.com/reference');
    assert.equal(await safeLink.getAttribute('target'), '_blank');
    assert.match(await safeLink.getAttribute('rel'), /noopener/);
    assert.match(await safeLink.getAttribute('rel'), /noreferrer/);
    assert.equal(await f.page.evaluate(() => Boolean(window.__injected)), false);
  });

  await test('voicemail task draft saves once locally and preserves Mission Control', async (f) => {
    const requestsBefore = await syncCommunications(f);
    await f.page.getByRole('button', { name: 'Task draft', exact: true }).first().click();
    const proposal = f.page.locator('.task-proposal');
    assert.match(await proposal.getByLabel('Task title', { exact: true }).inputValue(), /Call back.*555-0199/);
    assert.equal(await proposal.getByLabel('Task due', { exact: true }).inputValue(), '');
    assert.equal(await proposal.getByLabel('Task details', { exact: true }).inputValue(), taskSyncData.voicemails[0].vm);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc'))), savedMission, 'Opening a draft must not save it');
    await proposal.getByLabel('Task title', { exact: true }).fill('Reviewed callback task');
    await proposal.getByLabel('Task due', { exact: true }).fill('Tomorrow at 9 AM');
    await proposal.getByLabel('Task details', { exact: true }).fill('Edited details remain local.');
    await proposal.getByRole('button', { name: 'Save locally', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await f.page.locator('.task-feedback').waitFor();
    assert.equal(await f.page.locator('.task-proposal').count(), 0);
    assert.match(await f.page.locator('.task-feedback').innerText(), /saved locally[\s\S]*not sent to Quo/i);
    const stored = await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc')));
    assert.deepEqual(stored.customRoot, savedMission.customRoot);
    assert.deepEqual(stored.zap, savedMission.zap);
    assert.deepEqual(stored.decisions, savedMission.decisions);
    assert.deepEqual(stored.projects[1], savedMission.projects[1]);
    assert.equal(stored.projects[0].customProject, 'preserve this');
    assert.deepEqual(stored.projects[0].tasks[0], savedMission.projects[0].tasks[0]);
    assert.equal(stored.projects[0].tasks.length, 2, 'Rapid double-save must append once');
    const task = stored.projects[0].tasks[1];
    assert.equal(task.text, 'Reviewed callback task');
    assert.equal(task.due, 'Tomorrow at 9 AM');
    assert.equal(task.details, 'Edited details remain local.');
    assert.match(task.source, /call\/voicemail from.*555-0199.*Fishing/);
    assert.equal(task.localOnly, true);
    assert.equal(task.done, false);
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), requestsBefore, 'Task draft and save must not call chat or Quo');
    await f.page.getByRole('button', { name: 'View in Mission Control', exact: true }).click();
    await f.page.locator('.mc-grid').waitFor();
    await f.page.locator('.mc-row').first().getByRole('button', { name: 'tasks (2)', exact: true }).click();
    const savedTask = f.page.locator(`[data-task-id="${task.id}"]`);
    assert.equal(await savedTask.getByLabel('Task name', { exact: true }).inputValue(), task.text);
    assert.match(await savedTask.innerText(), /not sent to Quo[\s\S]*Tomorrow at 9 AM[\s\S]*Edited details remain local/);
    assert.equal(await f.page.locator(`[data-task-id="${savedMission.projects[0].tasks[0].id}"] input[type="checkbox"]`).isChecked(), true);
  }, taskOptions);

  await test('email task draft prepares local source and discard changes nothing', async (f) => {
    const requestsBefore = await syncCommunications(f);
    await f.page.locator('.ember-row').filter({ hasText: 'Fixture Email Sender' })
      .getByRole('button', { name: 'Task draft', exact: true }).click();
    const proposal = f.page.locator('.task-proposal');
    assert.match(await proposal.getByLabel('Task title', { exact: true }).inputValue(), /Fixture Email Sender/);
    assert.equal(await proposal.getByLabel('Task details', { exact: true }).inputValue(), 'Confirm the dock schedule');
    assert.match(await proposal.innerText(), /Source: email from Fixture Email Sender/);
    await proposal.getByRole('button', { name: 'Discard', exact: true }).click();
    assert.equal(await proposal.count(), 0);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc'))), savedMission);
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), requestsBefore);
  }, taskOptions);

  await test('invalid Mission Control data is preserved and keeps the task draft', async (f) => {
    const requestsBefore = await syncCommunications(f);
    await f.page.getByRole('button', { name: 'Task draft', exact: true }).first().click();
    const proposal = f.page.locator('.task-proposal');
    for (const invalid of ['{invalid JSON', JSON.stringify({ projects: 'not an array', keep: true }), JSON.stringify({ projects: [{ name: 'Baxstar Ember', tasks: 'not an array' }], keep: true })]) {
      await f.page.evaluate((value) => localStorage.setItem('ember-mc', value), invalid);
      await proposal.getByRole('button', { name: 'Save locally', exact: true }).click();
      await f.page.locator('.task-error').waitFor();
      assert.equal(await f.page.evaluate(() => localStorage.getItem('ember-mc')), invalid);
      assert.equal(await proposal.count(), 1);
      assert.match(await f.page.locator('.task-error').innerText(), /unreadable|cannot read|nothing was overwritten/i);
      assert.equal(await f.page.locator('.task-feedback').count(), 0);
    }
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), requestsBefore);
  }, taskOptions);

  await test('storage failure leaves reviewed task draft available', async (f) => {
    const requestsBefore = await syncCommunications(f);
    await f.page.getByRole('button', { name: 'Task draft', exact: true }).first().click();
    const proposal = f.page.locator('.task-proposal');
    await proposal.getByLabel('Task title', { exact: true }).fill('Preserve reviewed task on quota failure');
    await f.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === 'ember-mc') throw new DOMException('Fixture quota exceeded', 'QuotaExceededError'); return original.call(this, key, value); };
    });
    await proposal.getByRole('button', { name: 'Save locally', exact: true }).click();
    await f.page.locator('.task-error').waitFor();
    assert.equal(await proposal.getByLabel('Task title', { exact: true }).inputValue(), 'Preserve reviewed task on quota failure');
    assert.match(await f.page.locator('.task-error').innerText(), /could not save|storage/i);
    assert.equal(await f.page.locator('.task-feedback').count(), 0);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc'))), savedMission);
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), requestsBefore);
  }, taskOptions);

  await test('mounted Mission Control refreshes on local and storage events', async (f) => {
    await f.page.locator('.console-dock').getByRole('button', { name: 'Projects', exact: true }).click();
    await f.page.getByRole('button', { name: 'MISSION CONTROL', exact: true }).click();
    await f.page.locator('.mc-grid').waitFor();
    await f.page.locator('.mc-row').first().getByRole('button', { name: 'tasks (1)', exact: true }).click();
    for (const [id, event] of [['task-custom-event', 'ember:mc-updated'], ['task-storage-event', 'storage']]) {
      await f.page.evaluate(({ id, event }) => {
        const record = JSON.parse(localStorage.getItem('ember-mc'));
        record.projects[0].tasks.push({ id, text: `Refreshed ${id}`, done: false, localOnly: true, due: 'Today', details: 'Event-refresh fixture', source: 'Local fixture' });
        localStorage.setItem('ember-mc', JSON.stringify(record));
        window.dispatchEvent(event === 'storage' ? new StorageEvent('storage', { key: 'ember-mc', newValue: JSON.stringify(record), storageArea: localStorage }) : new CustomEvent(event));
      }, { id, event });
      await f.page.locator(`[data-task-id="${id}"]`).waitFor();
      assert.equal(await f.page.locator(`[data-task-id="${id}"]`).getByLabel('Task name', { exact: true }).inputValue(), `Refreshed ${id}`);
    }
    const stored = await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc')));
    assert.equal(stored.projects[0].tasks.length, 3);
    assert.deepEqual(stored.customRoot, savedMission.customRoot);
    assert.deepEqual(stored.projects[1], savedMission.projects[1]);
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), 0);
  }, taskOptions);

  await test('phone task draft is reviewable and saves with optional due blank', async (f) => {
    const requestsBefore = await syncCommunications(f);
    await f.page.getByRole('button', { name: 'Task draft', exact: true }).first().click();
    const proposal = f.page.locator('.task-proposal');
    await proposal.getByLabel('Task title', { exact: true }).fill('   ');
    assert.equal(await proposal.getByRole('button', { name: 'Save locally', exact: true }).isDisabled(), true);
    await proposal.getByLabel('Task title', { exact: true }).fill('Phone local task');
    const geometry = await proposal.locator('input,textarea,button').evaluateAll((nodes) => nodes.map((node) => ({ name: node.getAttribute('aria-label') || node.textContent, height: node.getBoundingClientRect().height })));
    assert(geometry.every((control) => control.height >= 44), JSON.stringify(geometry));
    assert(await f.page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    await proposal.getByRole('button', { name: 'Save locally', exact: true }).click();
    await f.page.locator('.task-feedback').waitFor();
    const stored = await f.page.evaluate(() => JSON.parse(localStorage.getItem('ember-mc')));
    assert.equal(stored.projects[0].tasks.at(-1).text, 'Phone local task');
    assert.equal(stored.projects[0].tasks.at(-1).due, '');
    assert.equal(await f.page.evaluate(() => __chatMock.allRequests.length), requestsBefore);
  }, { ...taskOptions, viewport: { width: 390, height: 844 } });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await test(`${viewport.width}x${viewport.height} chat targets fit and remain voice-free`, async (f) => {
      await f.plan(reply(`Readable long code:\n\n\`\`\`text\n${'long_output_'.repeat(35)}\n\`\`\`\n\n- First item\n- Second item`));
      await f.send('Geometry fixture');
      await f.settle();
      const geometry = await f.page.evaluate(() => {
        const thread = document.querySelector('.home-thread').getBoundingClientRect();
        const controls = [...document.querySelectorAll('.chat-composer textarea,.chat-composer button,.home-thread button')].map((node) => { const rect = node.getBoundingClientRect(); return { name: node.getAttribute('aria-label') || node.textContent.trim(), width: rect.width, height: rect.height }; });
        return { overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, thread: { width: thread.width, height: thread.height }, controls };
      });
      assert(geometry.overflow <= 1, `${geometry.overflow}px document overflow`);
      assert(geometry.thread.width >= 250 && geometry.thread.height >= 220, JSON.stringify(geometry.thread));
      assert(geometry.controls.every((control) => control.width >= 44 && control.height >= 44), JSON.stringify(geometry.controls));
      assert.equal(await f.page.evaluate(() => __chatMock.voiceStarts), 0);
      assert.equal(await f.page.locator('.core-chamber').getByRole('button', { name: /microphone|start listening|read aloud|spoken replies/i }).count(), 0);
      if (shotDir) await f.page.screenshot({ path: resolve(shotDir, `chat-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }, { viewport });
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`\nChat regression: ${passed}/${passed + failures.length} passed.`);
if (failures.length) { console.log(`Failed: ${failures.join('; ')}`); process.exitCode = 1; }
