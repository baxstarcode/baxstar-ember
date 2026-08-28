// Never-silent contract (added 2026-08-27): when every speech path fails, the
// answer is parked behind a visible TAP TO HEAR button — and the tap (a real
// gesture) rebuilds the audio channel and speaks. Silence with no explanation
// is the one outcome the voice stack is not allowed to produce.
import { chromium } from 'playwright';
import fs from 'fs';
const PREINSTALLED = '/opt/pw-browsers/chromium';
const b = await chromium.launch(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});

const stub = () => {
  window.__audioOK = false; window.__spoken = [];
  const of_ = window.fetch;
  window.fetch = (...a) => {
    const url = String(a[0]);
    if (/\/tts$/.test(url)) return Promise.resolve(new Response(JSON.stringify({ error: 'down' }), { status: 502 }));
    if (/workers|anthropic|proxy/i.test(url) && a[1] && a[1].method === 'POST') {
      if (/ONLY valid JSON/.test(String(a[1].body))) return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"voicemails":[],"emails":[],"events":[]}' }] }), { headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Wind lays down after four.' }] }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return of_(...a);
  };
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.volume = 1; this.rate = 1; } };
  const proto = window.SpeechSynthesis && window.SpeechSynthesis.prototype;
  if (proto) {
    proto.getVoices = () => [{ name: 'Samantha', lang: 'en-US', localService: true, default: true }];
    proto.speak = function (u) {
      if (u.volume === 0) return;
      if (window.__audioOK) { window.__spoken.push(u.text); setTimeout(() => u.onstart && u.onstart(), 10); setTimeout(() => u.onend && u.onend(), 60); }
      else setTimeout(() => u.onerror && u.onerror({ error: 'blocked' }), 10);
    };
    proto.cancel = function () {};
    Object.defineProperty(proto, 'speaking', { get: () => false, configurable: true });
    Object.defineProperty(proto, 'pending', { get: () => false, configurable: true });
  }
  window.Audio = class {
    constructor(src) { this.src = src || ''; }
    play() { return window.__audioOK ? (setTimeout(() => this.onplaying && this.onplaying(), 15), setTimeout(() => this.onended && this.onended(), 120), Promise.resolve()) : Promise.reject(new Error('blocked')); }
    pause() {}
  };
  class SR { start() { setTimeout(() => this.onstart && this.onstart(), 10); } abort() { setTimeout(() => this.onend && this.onend(), 20); } stop() { this.abort(); } }
  window.SpeechRecognition = SR; window.webkitSpeechRecognition = SR;
};

const ctx = await b.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(stub);
await p.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.getByRole('button', { name: /TAP TO TALK/i }).first().click(); // voice mode + unlock attempt (all audio dead)
await p.waitForTimeout(400);
await p.evaluate(() => {
  const input = document.querySelector('.cmd-input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, 'how does today look'); input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await p.waitForTimeout(4500); // cascade exhausts every dead path
const textShown = await p.getByText(/Wind lays down after four\./).first().count();
const btn = p.getByRole('button', { name: /TAP TO HEAR/i });
const btnShown = await btn.count();
await p.evaluate(() => { window.__audioOK = true; }); // audio channel recovers
if (btnShown) await btn.first().click();
await p.waitForTimeout(2500);
const spoken = await p.evaluate(() => window.__spoken.length);
const btnGone = await p.getByRole('button', { name: /TAP TO HEAR/i }).count() === 0;
console.log('NEVER-SILENT — answer text still shown:', textShown > 0);
console.log('NEVER-SILENT — TAP TO HEAR appeared when all audio died:', btnShown > 0);
console.log('NEVER-SILENT — tap replayed the answer out loud:', spoken > 0);
console.log('NEVER-SILENT — button cleared after replay:', btnGone);
console.log('page errors:', errs.length ? errs : 'none');
const pass = textShown > 0 && btnShown > 0 && spoken > 0 && btnGone && errs.length === 0;
console.log(pass ? 'NEVER-SILENT PASS' : 'NEVER-SILENT FAIL');
await ctx.close(); await b.close();
