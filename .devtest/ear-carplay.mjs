// CarPlay/ear regression harness — recreated 2026-08-26 from the session record
// after container recycling wiped the scratchpad copy. Runs the GENERATED
// index.html. Contract per Brady's punch list: 15s of TRUE silence ends the
// conversation (measured from the END of an exchange after the talk-window fix),
// no mic self-start ever, wake word drives the desktop ear.
import { chromium } from 'playwright';
import fs from 'fs';
const PREINSTALLED = '/opt/pw-browsers/chromium';
const b = await chromium.launch(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});

const stub = () => {
  window.__log = []; window.__instances = 0; window.__posts = [];
  class SR {
    constructor() { window.__instances++; this.__used = false; this.__dead = false; }
    start() {
      if (this.__used || this.__dead) { window.__log.push('START-ON-DEAD'); throw new DOMException('InvalidStateError'); }
      this.__used = true; window.__live = this;
      window.__log.push('start');
      setTimeout(() => this.onstart && this.onstart(), 10);
    }
    abort() { this.__dead = true; window.__log.push('abort');
      setTimeout(() => { window.__log.push('end'); window.__live = (window.__live === this ? null : window.__live); this.onend && this.onend(); }, 40); }
    stop() { this.abort(); }
    feed(t) { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
      this.__dead = true;
      setTimeout(() => { window.__log.push('end'); window.__live = (window.__live === this ? null : window.__live); this.onend && this.onend(); }, 25); }
  }
  window.SpeechRecognition = SR; window.webkitSpeechRecognition = SR;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.volume = 1; this.rate = 1; } };
  const proto = window.SpeechSynthesis && window.SpeechSynthesis.prototype;
  if (proto) {
    proto.getVoices = () => [
      { name: 'Samantha', lang: 'en-US', localService: true, default: true },
      { name: 'Ava (Enhanced)', lang: 'en-US', localService: true, default: false },
    ];
    proto.speak = function (u) {
      if (u.volume === 0) { window.__log.push('unlock'); return; }
      window.__log.push('speak:' + (u.voice ? u.voice.name : 'auto'));
      setTimeout(() => u.onstart && u.onstart(), 15);
      setTimeout(() => u.onend && u.onend(), 150);
    };
    proto.cancel = function () {};
    Object.defineProperty(proto, 'speaking', { get: () => false, configurable: true });
    Object.defineProperty(proto, 'pending', { get: () => false, configurable: true });
  }
  const of_ = window.fetch;
  window.fetch = (...a) => {
    const url = String(a[0]);
    if (/\/tts$/.test(url)) return Promise.resolve(new Response(JSON.stringify({ error: 'stubbed off' }), { status: 502 }));
    if (/workers|anthropic|proxy/i.test(url) && a[1] && a[1].method === 'POST') {
      window.__posts.push(JSON.parse(a[1].body).messages.at(-1).content);
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Yep, done.' }] }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return of_(...a);
  };
};

// ================= PHONE: the CarPlay guarantee =================
{
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.addInitScript(stub);
  await p.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const heldAtLoad = await p.evaluate(() => !!window.__live);
  await p.getByRole('button', { name: /TAP TO TALK/i }).first().click();
  await p.waitForTimeout(300);
  const heldAfterTap = await p.evaluate(() => !!window.__live);
  await p.evaluate(() => window.__live && window.__live.feed('what is my revenue today'));
  await p.waitForTimeout(1500);
  const inWindow = await p.evaluate(() => !!window.__live);
  await p.waitForTimeout(9000);
  const heldMidWindow = await p.evaluate(() => !!window.__live);
  await p.waitForTimeout(11000); // now past 15s of true post-exchange silence
  const heldAfterWindow = await p.evaluate(() => !!window.__live);
  await p.waitForTimeout(2500);
  const heldLater = await p.evaluate(() => !!window.__live);
  const posts = await p.evaluate(() => window.__posts.length);
  const deadStarts = await p.evaluate(() => window.__log.filter(l => l === 'START-ON-DEAD').length);

  console.log('PHONE — mic held at load:', heldAtLoad, '(must be false)');
  console.log('PHONE — mic held after tap:', heldAfterTap, '(true)');
  console.log('PHONE — mic held during talk window:', inWindow, '(true)');
  console.log('PHONE — still held at 10s:', heldMidWindow, '(true)');
  console.log('PHONE — mic released after window:', !heldAfterWindow, '(MUST release — CarPlay)');
  console.log('PHONE — mic re-grabbed later:', heldLater, '(must be false)');
  console.log('PHONE — commands sent:', posts, '| dead starts:', deadStarts);
  const pass = !heldAtLoad && heldAfterTap && heldMidWindow && !heldAfterWindow && !heldLater && posts === 1 && deadStarts === 0;
  console.log(pass ? 'PHONE PASS' : 'PHONE FAIL');
  await ctx.close();
}

// ================= DESKTOP: the ear =================
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(stub);
  await p.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);
  const selfStarted = await p.evaluate(() => !!window.__live);
  await p.locator('[aria-label="Voice input"]').first().click();
  await p.waitForTimeout(500);
  const earOn = await p.evaluate(() => !!window.__live);
  await p.evaluate(() => window.__live && window.__live.feed('so anyway I told him the pontoon needs gas'));
  await p.waitForTimeout(700);
  const postsAfterNoise = await p.evaluate(() => window.__posts.length);
  await p.evaluate(() => window.__live && window.__live.feed('ember awake what is my revenue today'));
  await p.waitForTimeout(900);
  const postsAfterTail = await p.evaluate(() => window.__posts.length);
  const tailCmd = await p.evaluate(() => window.__posts[0] || '');
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.__live && window.__live.feed('amber awake'));
  await p.waitForTimeout(500);
  const armedShown = await p.getByText(/AWAKE — WHAT DO YOU NEED/i).count();
  await p.evaluate(() => window.__live && window.__live.feed('draft a reply to the last text'));
  await p.waitForTimeout(900);
  const postsAfterArmed = await p.evaluate(() => window.__posts.length);

  console.log('DESKTOP — no mic self-start at load:', !selfStarted, '(true)');
  console.log('DESKTOP — ear on after orb click:', earOn, '(true)');
  console.log('DESKTOP — noise discarded:', postsAfterNoise === 0, '(true)');
  console.log('DESKTOP — "ember awake <cmd>" ran immediately:', postsAfterTail === 1, '| cmd:', JSON.stringify(tailCmd).slice(0, 60));
  console.log('DESKTOP — AWAKE pill shown after bare wake:', armedShown > 0);
  console.log('DESKTOP — command after wake ran:', postsAfterArmed === 2);
  const pass = !selfStarted && earOn && postsAfterNoise === 0 && postsAfterTail === 1 && /revenue/.test(tailCmd) && armedShown > 0 && postsAfterArmed === 2;
  console.log(pass ? 'DESKTOP PASS' : 'DESKTOP FAIL');
  await ctx.close();
}
await b.close();
