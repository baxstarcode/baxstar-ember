// Post-voice-removal smoke test on the GENERATED build.
// Proves: the app renders with zero console/page errors, no voice control
// survives anywhere in the UI, the tools rail is present and links out, the
// dashboard panels and typed ask still work, and it holds up at phone width.
import { chromium } from 'playwright';
import fs from 'fs';
const PRE = '/opt/pw-browsers/chromium';
const b = await chromium.launch(fs.existsSync(PRE) ? { executablePath: PRE } : {});

const stub = () => {
  window.__reqs = [];
  const of_ = window.fetch;
  window.fetch = (...a) => {
    const url = String(a[0]);
    if (/workers|anthropic|proxy/i.test(url) && a[1] && a[1].method === 'POST') {
      window.__reqs.push(JSON.parse(a[1].body));
      const sync = /ONLY valid JSON/.test(a[1].body);
      const text = sync
        ? '{"voicemails":[{"from":"(218) 555-0000","line":"Fishing","time":"1:00 PM","note":"live sync landed","vm":""}],"emails":[{"from":"LiveSyncProof","time":"1:01 PM","subject":"real data"}],"events":[{"time":"3:00 PM","title":"LiveSyncEvent","detail":""}]}'
        : 'Two bookings today, Brady.';
      return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return of_(...a);
  };
  window.__EMBER_AUTOSYNC_TEST = true;
};

const fails = [];
const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${extra ? ' :: ' + extra : ''}`); if (!cond) fails.push(label); };

for (const [name, viewport] of [['DESKTOP', { width: 1440, height: 900 }], ['PHONE', { width: 393, height: 852 }]]) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: name === 'PHONE' ? 3 : 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // Google Fonts is blocked by this sandbox's TLS interception and fails
  // identically on the pre-surgery build — environmental, not the app's.
  const NOISE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT_AUTHORITY_INVALID|favicon/i;
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('console: ' + m.text()); });
  p.on('requestfailed', (r) => { if (!NOISE.test(r.url())) errs.push('net: ' + r.url().slice(0, 80)); });
  p.on('response', (r) => { if (r.status() >= 400 && !NOISE.test(r.url())) errs.push('http ' + r.status() + ': ' + r.url().slice(0, 90)); });
  await p.addInitScript(stub);
  await p.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);

  console.log(`\n===== ${name} =====`);
  ok(`${name} no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));

  // No voice affordance may survive anywhere in the rendered UI.
  const body = (await p.evaluate(() => document.body.innerText)).toUpperCase();
  const banned = ['TAP TO TALK', 'VOICE MODE', 'VOICE ON', 'HER VOICE', 'HEAR IT', 'TAP TO HEAR', 'EMBER, AWAKE', 'MIC ARMED', 'MIC RELEASED', 'LISTENING', 'SPEAKING'];
  const found = banned.filter((t) => body.includes(t));
  ok(`${name} zero voice controls in UI`, found.length === 0, found.join(','));
  const mics = await p.locator('[aria-label*="Voice"], [aria-label*="mic" i], [title*="Talk" i]').count();
  ok(`${name} no mic/voice controls in DOM`, mics === 0);

  // Steampunk identity survives.
  ok(`${name} skull present`, await p.locator('.skull-host').count() > 0);
  ok(`${name} core instrument present`, await p.locator('.reactor-stage, .scope-bezel').count() > 0);

  // Dashboard does its job.
  ok(`${name} panels filled from live sync`, body.includes('LIVE SYNC LANDED') && body.includes('LIVESYNCPROOF'));
  ok(`${name} revenue panel present`, body.includes("TODAY'S REVENUE"));

  // The tools rail.
  const links = await p.locator('.tool-link').count();
  ok(`${name} tools rail rendered`, body.includes('YOUR TOOLS') && links === 11, `${links} links`);
  const first = await p.locator('.tool-link').first();
  ok(`${name} tool links open in a new tab`, (await first.getAttribute('target')) === '_blank' && /noopener/.test(await first.getAttribute('rel') || ''));

  // No horizontal overflow at this width.
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`${name} no sideways scroll`, overflow <= 1, `overflow ${overflow}px`);

  // Typed ask still reaches the model and answers in the thread.
  await p.evaluate(() => {
    const i = document.querySelector('.cmd-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, 'how does today look'); i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await p.waitForTimeout(1200);
  ok(`${name} typed ask answers`, (await p.getByText(/Two bookings today, Brady\./).count()) > 0);
  const chat = await p.evaluate(() => (window.__reqs || []).find((r) => !/ONLY valid JSON/.test(JSON.stringify(r.messages))));
  ok(`${name} no voice-mode text in the prompt`, !!chat && !/spoken aloud|Spoken output/i.test(JSON.stringify(chat.messages)));

  if (name === 'PHONE') await p.screenshot({ path: '/tmp/claude-0/-home-user-baxstar-ember/749a3292-fd97-597e-bb97-d3ca8baf4d82/scratchpad/ember-phone.png', fullPage: true });
  else await p.screenshot({ path: '/tmp/claude-0/-home-user-baxstar-ember/749a3292-fd97-597e-bb97-d3ca8baf4d82/scratchpad/ember-desktop.png', fullPage: true });
  await ctx.close();
}
await b.close();
console.log(fails.length ? `\nDASHBOARD FAIL: ${fails.join(' | ')}` : '\nDASHBOARD PASS');
