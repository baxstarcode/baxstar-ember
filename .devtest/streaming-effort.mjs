// Streaming + real-effort + auto-sync regression harness (added 2026-08-27).
// Runs the GENERATED index.html. Locks in the speed contract:
//   1. Chat requests carry stream:true and the picked effort level, and the
//      reply text lands in the thread progressively (SSE), not all at once.
//   2. A plain-JSON response still works (fallback for stubs/old proxies).
//   3. OPS auto-syncs once on load (opt-in here via __EMBER_AUTOSYNC_TEST),
//      on the fast model, and real data replaces the demo panels.
import { chromium } from 'playwright';
import fs from 'fs';
const PREINSTALLED = '/opt/pw-browsers/chromium';
const b = await chromium.launch(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});

const stub = () => {
  window.__EMBER_AUTOSYNC_TEST = true;
  window.__reqs = [];
  const sse = (chunks) => {
    const enc = new TextEncoder();
    const frames = [];
    frames.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    for (const c of chunks) frames.push('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }) + '\n\n');
    frames.push('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    let i = 0;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (i >= frames.length) { ctrl.close(); return; }
        const frame = frames[i++];
        return new Promise((r) => setTimeout(() => { ctrl.enqueue(enc.encode(frame)); r(); }, 120));
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const of_ = window.fetch;
  window.fetch = (...a) => {
    const url = String(a[0]);
    if (/\/tts$/.test(url)) return Promise.resolve(new Response(JSON.stringify({ error: 'off' }), { status: 502 }));
    if (/workers|anthropic|proxy/i.test(url) && a[1] && a[1].method === 'POST') {
      const body = JSON.parse(a[1].body);
      window.__reqs.push({ model: body.model, stream: !!body.stream, effort: body.output_config && body.output_config.effort, sync: /ONLY valid JSON/.test(a[1].body) });
      if (/ONLY valid JSON/.test(a[1].body)) {
        // sync goes out as plain JSON — proves the non-stream path still works
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"voicemails":[{"from":"(218) 555-TEST","line":"Fishing","time":"1:00 PM","note":"live sync landed","vm":""}],"emails":[{"from":"LiveSyncProof","time":"1:01 PM","subject":"real data"}],"events":[{"time":"3:00 PM","title":"LiveSyncEvent","detail":""}]}' }] }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(sse(['Two ', 'bookings ', 'today, ', 'Brady.']));
    }
    return of_(...a);
  };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.volume = 1; this.rate = 1; } };
  const proto = window.SpeechSynthesis && window.SpeechSynthesis.prototype;
  if (proto) {
    proto.getVoices = () => [{ name: 'Samantha', lang: 'en-US', localService: true, default: true }];
    proto.speak = function (u) { if (u.volume === 0) return; setTimeout(() => u.onstart && u.onstart(), 10); setTimeout(() => u.onend && u.onend(), 60); };
    proto.cancel = function () {};
    Object.defineProperty(proto, 'speaking', { get: () => false, configurable: true });
    Object.defineProperty(proto, 'pending', { get: () => false, configurable: true });
  }
};

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(stub);
await p.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

// Pick Low effort so the request must carry effort:"low"
await p.getByRole('button', { name: 'Low' }).first().click();
await p.waitForTimeout(200);

// Typed command → streamed reply
await p.evaluate(() => {
  const input = document.querySelector('.cmd-input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'how does today look'); input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await p.waitForTimeout(300); // two SSE frames in — partial text should be visible
const partial = await p.getByText(/Two bookings today, Brady\./).count() === 0 &&
                await p.getByText(/Two /).count() > 0;
await p.waitForTimeout(1200);
const full = await p.getByText(/Two bookings today, Brady\./).count() > 0;

// Auto-sync fires once on load (opt-in flag), on Haiku, and populates panels
await p.waitForTimeout(1800);
const syncReq = await p.evaluate(() => window.__reqs.find(r => r.sync));
const chatReq = await p.evaluate(() => window.__reqs.find(r => !r.sync));
const liveVm = await p.getByText(/live sync landed/).count();
const liveMail = await p.getByText(/LiveSyncProof/).count();

console.log('STREAM — chat request carries stream:true:', !!(chatReq && chatReq.stream));
console.log('STREAM — chat request carries effort low:', !!(chatReq && chatReq.effort === 'low'));
console.log('STREAM — partial text visible mid-stream:', partial);
console.log('STREAM — full text lands:', full);
console.log('SYNC — auto-sync fired without a button press:', !!syncReq);
console.log('SYNC — sync rides the fast model:', !!(syncReq && /haiku/.test(syncReq.model)));
console.log('SYNC — real data replaced demo panels:', liveVm > 0 && liveMail > 0);
console.log('page errors:', errs.length ? errs : 'none');
const pass = chatReq && chatReq.stream && chatReq.effort === 'low' && partial && full &&
             syncReq && /haiku/.test(syncReq.model) && liveVm > 0 && liveMail > 0 && errs.length === 0;
console.log(pass ? 'STREAMING-EFFORT PASS' : 'STREAMING-EFFORT FAIL');
await ctx.close();
await b.close();
