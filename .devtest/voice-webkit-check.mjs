// iPhone voice path and the live-data guard, on the real rendered app in Chromium
// with an iPhone Safari user agent (Playwright WebKit is not installed in the
// build container). Recognition, wake lock and providers are deterministic
// fixtures; Jenny's clips are real WAV audio decoded and played by Web Audio.
// These checks prove the page's logic, NOT that iOS reopens the microphone: that
// answer comes from the device's own /api/voice/trace lines in Workers Logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const PREINSTALLED = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROME_PATH || (fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
let checks = 0;
function check(label, value) { assert.ok(value, label); checks++; console.log('PASS ' + label); }
function wav(seconds) {
  const rate = 8000, n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / rate * 440 * 2 * Math.PI) * 600), 44 + i * 2);
  return b;
}
const clip = wav(0.35);

async function fixture({ ua = IPHONE, width = 390, decodeFails = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, userAgent: ua, hasTouch: width < 600 });
  const page = await context.newPage(), calls = [], errors = [];
  const state = { mode: 'tool' };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ decodeFails }) => {
    window.recs = []; window.deadAudio = 0; window.audioStart = true; window.ctxMade = 0; window.micDuringPlay = 0;
    class Rec {
      start() { this.active = true; recs.push(this); setTimeout(() => { this.onstart?.(); const dead = window.deadAudio > 0 && recs.length > 1; if (dead) window.deadAudio--; else if (window.audioStart) this.onaudiostart?.(); }, 0); }
      stop() { this.active = false; setTimeout(() => this.onend?.(), 0); }
      abort() { this.stop(); }
    }
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = Rec;
    window.say = (text) => { const v = [{ transcript: text }]; v.isFinal = true; recs.at(-1).onresult?.({ results: [v], resultIndex: 0 }); };
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { const l = new EventTarget(); l.release = async () => l.dispatchEvent(new Event('release')); return l; } } });
    Object.defineProperty(navigator, 'audioSession', { value: Object.assign(new EventTarget(), { type: 'auto', state: 'active' }) });
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...a) { super(...a); window.ctxMade++; window.lastCtx = this; }
      decodeAudioData(data) { return decodeFails ? Promise.reject(new DOMException('bad', 'EncodingError')) : super.decodeAudioData(data); }
    };
    window.webkitAudioContext = undefined;
    setInterval(() => { if (document.querySelector('[data-voice-phase="playing"]') && recs.some((r) => r.active)) window.micDuringPlay++; }, 30);
  }, { decodeFails });
  const origin = 'https://ember.baxstarfishing.com';
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      let body = {}; try { body = route.request().postDataJSON() || {}; } catch {}
      calls.push({ path: u.pathname, body, at: Date.now() });
      if (u.pathname === '/api/connectors/status') return route.fulfill({ json: { connectors: {} } });
      if (u.pathname === '/api/voice/trace') return route.fulfill({ status: 204, body: '' });
      if (u.pathname === '/api/tts') return route.fulfill({ contentType: 'audio/wav', body: clip }).catch(() => {});
      const q = body.messages?.at(-1)?.content || '';
      if (/ONLY valid JSON/.test(q)) return route.fulfill({ json: { content: [{ type: 'text', text: '{"voicemails":[],"emails":[],"events":[]}' }], stop_reason: 'end_turn' } });
      const retry = q.includes('[Ember check');
      const tools = [{ type: 'mcp_tool_use', id: 't1', name: 'list_events', server_name: 'calendar' }, { type: 'mcp_tool_result', tool_use_id: 't1', is_error: false, content: [] }];
      const reply = (text, withTools) => route.fulfill({ json: { model: body.model, content: [...(withTools ? tools : []), { type: 'text', text }], stop_reason: 'end_turn' } }).catch(() => {});
      if (state.mode === 'noTool') return reply('You have a 2 PM charter with Dale and a birthday on Friday.', false);
      if (state.mode === 'toolOnRetry') return reply(retry ? 'Your 2 PM charter with Dale is on the calendar.' : 'You have a 2 PM charter with Dale.', retry);
      if (state.mode === 'claimNoTool') return reply('Sure. Also, your calendar shows a meeting at 3.', false);
      if (state.mode === 'plain') return reply('Here is a short draft: Running late, see you soon.', false);
      return reply('Your next trip is at 6 AM tomorrow.', true);
    }
    const file = path.resolve(root, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ path: file }); } catch { await route.abort(); }
  });
  await page.goto(origin); await page.getByRole('textbox', { name: 'Ask Ember' }).waitFor();
  const panel = page.getByRole('region', { name: 'Ember voice controls' });
  const tap = async () => { await page.getByRole('button', { name: 'Talk to Ember', exact: true }).click(); await page.locator('[data-voice-phase="listening"]').waitFor(); };
  const chats = () => calls.filter((c) => c.path === '/api/messages' && !/ONLY valid JSON/.test(c.body.messages?.at(-1)?.content || ''));
  return { page, context, panel, calls, errors, state, tap, chats };
}
try {
  {
    // Five spoken turns from one tap, Jenny through Web Audio, no tap in between.
    const f = await fixture();
    await f.tap();
    for (let n = 1; n <= 5; n++) {
      await f.page.evaluate((n) => say(`Tell me fact number ${n}`), n);
      await f.page.locator('[data-voice-phase="playing"]').waitFor();
      check(`turn ${n}: Jenny plays through Web Audio, not the page player`, await f.page.evaluate(() => !document.querySelector('audio[aria-label="Ember reply"]').getAttribute('src') && document.querySelector('audio[aria-label="Ember reply"]').hidden));
      await f.page.locator('[data-voice-phase="listening"]').waitFor({ timeout: 8000 });
    }
    check('five turns need exactly one tap: six recognizers, five replies', await f.page.evaluate(() => recs.length === 6) && f.calls.filter((c) => c.path === '/api/tts').length === 5 && f.chats().length === 5);
    check('one AudioContext serves the whole conversation and stays running', await f.page.evaluate(() => ctxMade === 1 && lastCtx.state === 'running'));
    check('the mic is never live while Jenny plays', await f.page.evaluate(() => micDuringPlay === 0));
    check('Now Playing is released after each reply', await f.page.evaluate(() => navigator.mediaSession.playbackState === 'none' && navigator.mediaSession.metadata === null));
    const traces = await f.page.evaluate(() => emberVoiceTraces.filter((t) => t.outcome === 'spoke'));
    check('every turn self-reports: tap, then four automatic restarts', traces.map((t) => t.trigger).join() === 'tap,auto,auto,auto,auto' && traces.every((t) => t.out === 'web' && t.engine === 'webkit' && t.ua === 'ios-safari'));
    check('each trace carries last-words-to-first-sound time', traces.every((t) => Number.isInteger(t.lastWordsToSoundMs) && t.lastWordsToSoundMs >= 0 && t.marks['first-sound'] > t.marks.send));
    check('automatic restarts record the gap after Jenny', traces.slice(1).every((t) => t.sinceReplyEndMs >= 700 && t.sinceReplyEndMs < 3000));
    check('traces are posted to the self-report route', f.calls.filter((c) => c.path === '/api/voice/trace' && c.body.v === 1).length >= 5);
    await f.panel.getByRole('button', { name: 'Close voice' }).click();
    check('closing voice closes the AudioContext', await f.page.waitForFunction(() => lastCtx.state === 'closed').then(() => true));
    check('no runtime errors across five turns', f.errors.length === 0);
    await f.context.close();
  }
  {
    // WebKit fires audiostart whether or not sound will arrive, so it is not held to it.
    const f = await fixture();
    await f.page.evaluate(() => { window.deadAudio = 1; });
    await f.tap(); await f.page.evaluate(() => say('First question')); await f.page.locator('[data-voice-phase="playing"]').waitFor();
    await f.page.waitForFunction(() => recs.length === 2 && recs[1].active, null, { timeout: 8000 });
    await f.page.waitForTimeout(3200);
    check('WebKit skips the audio-start check (no early "didn\'t reopen")', await f.page.evaluate(() => recs.length === 2 && recs[1].active) && await f.page.getByText(/Reopening the microphone/).count() === 0);
    await f.page.evaluate(() => say('Second question')); await f.page.locator('[data-voice-phase="playing"]').waitFor();
    check('words on the restarted mic carry the conversation on', f.chats().some((c) => c.body.messages.at(-1).content === 'Second question'));
    await f.context.close();
  }
  {
    // A clip Web Audio cannot decode falls back to the page player.
    const f = await fixture({ decodeFails: true });
    await f.tap(); await f.page.evaluate(() => say('Tell me a fact')); await f.page.locator('[data-voice-phase="playing"]').waitFor();
    check('undecodable clip falls back to the page player', await f.page.evaluate(() => !!document.querySelector('audio[aria-label="Ember reply"]').getAttribute('src')));
    await f.page.locator('audio[aria-label="Ember reply"]').evaluate((a) => { a.currentTime = Math.max(0, a.duration - 0.02); });
    await f.page.locator('[data-voice-phase="listening"]').waitFor({ timeout: 8000 });
    check('fallback turn still hands the turn back', await f.page.evaluate(() => emberVoiceTraces.at(-1).out === 'element' && emberVoiceTraces.at(-1).outcome === 'spoke'));
    await f.context.close();
  }
  {
    // Chrome on the Mac keeps the page player (no change there).
    const f = await fixture({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', width: 1440 });
    await f.tap(); await f.page.evaluate(() => say('Tell me a fact')); await f.page.locator('[data-voice-phase="playing"]').waitFor();
    check('Mac Chrome plays Jenny through the page player and opens no AudioContext', await f.page.evaluate(() => !!document.querySelector('audio[aria-label="Ember reply"]').getAttribute('src') && ctxMade === 0));
    await f.context.close();
  }

  // ---- Live-data guard ----
  const typed = async (f, text) => {
    await f.page.getByRole('textbox', { name: 'Ask Ember' }).fill(text);
    await f.page.getByRole('textbox', { name: 'Ask Ember' }).press('Enter');
    await f.page.waitForFunction(() => document.querySelector('.home-thread [data-role="assistant"]:last-of-type')?.closest('[data-status]')?.dataset.status !== 'streaming' && !document.querySelector('.chat-run[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    await f.page.waitForTimeout(400);
    return f.page.locator('.home-thread [data-role="assistant"]').last().innerText();
  };
  {
    const f = await fixture({ width: 1440, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36' });
    f.state.mode = 'noTool';
    const text = await typed(f, "What's on my calendar tomorrow?");
    const asks = f.chats();
    check('a calendar answer with no tool result is re-asked once with an explicit tool instruction', asks.length === 2 && asks[1].body.messages.at(-1).content.includes('[Ember check') && asks[1].body.mcp_servers?.length > 0);
    check('still no lookup: Ember says it could not check instead of listing events', /couldn't get a live result from your calendar/.test(text) && !/Dale|birthday/.test(text));
    f.state.mode = 'toolOnRetry';
    const kept = await typed(f, 'Any birthdays or meetings this week?');
    check('a retry that does the lookup keeps its answer', /on the calendar/.test(kept) && f.chats().length === 4);
    f.state.mode = 'plain';
    const draft = await typed(f, "Write a text to Mike saying I'm running late");
    check('drafting a text is not treated as a live-data question', /Running late/.test(draft) && f.chats().length === 5);
    f.state.mode = 'claimNoTool';
    const caveat = await typed(f, 'Give me a pep talk');
    check('an unasked-for live claim without a lookup is flagged in the reply', /didn't check your live calendar, email or calls/.test(caveat) && f.chats().length === 6);
    check('every request still carries the read-only connectors', f.chats().every((c) => c.body.mcp_servers?.length > 0));
    check('the prompt says earlier replies are not tool results', f.chats().every((c) => c.body.messages[0].content.includes('Facts in earlier replies of this conversation are not tool results')));
    await f.context.close();
  }
  {
    // Spoken: Jenny says nothing of the answer before the calendar result arrives.
    const f = await fixture();
    // A timed stream through a page-side fetch override (route bodies are not streamed).
    await f.page.evaluate(() => {
      const real = window.fetch.bind(window);
      window.toolSent = 0; window.ttsTexts = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/tts') window.ttsTexts.push({ text: JSON.parse(init.body).text, at: performance.now() });
        if (url.pathname !== '/api/messages') return real(input, init);
        const body = JSON.parse(init.body);
        if (!body.stream || /ONLY valid JSON/.test(body.messages.at(-1).content)) return real(input, init);
        const retry = body.messages.at(-1).content.includes('[Ember check');
        const enc = new TextEncoder(), ev = (o) => enc.encode(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
        return new Response(new ReadableStream({ async start(ctl) {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          ctl.enqueue(ev({ type: 'message_start', message: { model: body.model } }));
          if (!retry) {
            // First attempt answers from memory: no tool block at all.
            ctl.enqueue(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
            ctl.enqueue(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'You have an invented birthday party on Friday. ' } }));
          } else {
            ctl.enqueue(ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
            ctl.enqueue(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check. ' } }));
            await wait(1400);
            ctl.enqueue(ev({ type: 'content_block_start', index: 1, content_block: { type: 'mcp_tool_use', id: 't1', name: 'list_events', server_name: 'calendar' } }));
            ctl.enqueue(ev({ type: 'content_block_start', index: 2, content_block: { type: 'mcp_tool_result', tool_use_id: 't1', is_error: false, content: [] } }));
            window.toolSent = performance.now();
            ctl.enqueue(ev({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }));
            ctl.enqueue(ev({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Your only event tomorrow is the 6 AM trip on Pelican Lake.' } }));
          }
          await wait(50);
          ctl.enqueue(ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }));
          ctl.enqueue(ev({ type: 'message_stop' }));
          ctl.close();
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
      };
    });
    await f.tap(); await f.page.evaluate(() => say("What's on my calendar tomorrow?"));
    await f.page.waitForFunction(() => window.ttsTexts.some((t) => /Pelican/.test(t.text)), null, { timeout: 15000 });
    const spoken = await f.page.evaluate(() => ({ tts: window.ttsTexts, toolSent: window.toolSent }));
    check('the made-up first answer is never spoken', !spoken.tts.some((t) => /invented/.test(t.text)));
    check('a slow lookup gets one "checking your calendar" line first', /^One moment, checking your calendar\.$/.test(spoken.tts[0].text));
    check('no answer audio is requested before the calendar result', spoken.tts.filter((t) => !/^One moment/.test(t.text)).every((t) => t.at >= spoken.toolSent));
    await f.page.locator('[data-voice-phase="listening"]').waitFor({ timeout: 10000 });
    const trace = await f.page.evaluate(() => emberVoiceTraces.filter((t) => t.outcome === 'spoke').at(-1));
    check('the spoken trace records the guard and the lookup', trace.reply?.live === 'calendar' && trace.reply?.guard === 'retried' && trace.reply?.tools === 1 && trace.marks['tool-result'] > 0);
    await f.context.close();
  }
  console.log(`iPhone voice path and live-data guard: ${checks} checks passed.`);
} finally {
  await browser.close();
}
