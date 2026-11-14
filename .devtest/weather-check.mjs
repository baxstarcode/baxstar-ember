// Live weather in the rendered dashboard. The report is the Worker's own output for
// the recorded National Weather Service fixture; the model and every route are stubs.
// This proves what Ember is told and when, not what a real model says back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { weatherReport, resetWeatherCache } from '../proxy/weather.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const nws = JSON.parse(fs.readFileSync(path.join(root, 'proxy/weather.fixture.json'), 'utf8'));
const json = (body) => new Response(JSON.stringify(body), { status: 200 });
resetWeatherCache();
const report = await weatherReport(async (url) => {
  const p = new URL(url).pathname;
  return json(p.startsWith('/points/') ? nws.points : p.endsWith('/hourly') ? nws.hourly : p.endsWith('/forecast') ? nws.forecast : { features: [] });
}, Date.parse('2026-11-14T16:00:00Z'));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium' });
let checks = 0;
function check(label, value) { assert.ok(value, label); checks++; console.log('PASS ' + label); }
const origin = 'https://ember.baxstarfishing.com';
const isSync = (c) => /ONLY valid JSON/.test(c.body?.messages?.at(-1)?.content || '');

async function fixture({ weather = 'ok', answer = 'Tomorrow looks calm.' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), calls = [], errors = [];
  const state = { weather, answer };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      let body = null; try { body = route.request().postDataJSON(); } catch {}
      calls.push({ path: u.pathname, body, at: calls.length });
      if (u.pathname === '/api/connectors/status') return route.fulfill({ json: { connectors: {} } });
      if (u.pathname === '/api/weather') {
        if (state.weather === 'down') return route.fulfill({ status: 502, json: { error: 'weather_unavailable' } });
        if (state.weather === 'junk') return route.fulfill({ json: { periods: 'sunny' } });
        const fresh = { ...report, fetchedAt: new Date().toISOString(), ...(state.weather === 'alert' ? { alerts: [{ event: 'Wind Advisory', severity: 'Moderate', headline: 'Wind Advisory until 6 PM', ends: new Date(Date.now() + 3600000).toISOString() }] } : {}), ...(state.weather === 'unchecked' ? { alertsChecked: false } : {}) };
        return route.fulfill({ json: fresh });
      }
      const q = body?.messages?.at(-1)?.content || '';
      const text = /ONLY valid JSON/.test(q) ? '{"voicemails":[],"emails":[],"events":[]}' : state.answer;
      return route.fulfill({ json: { model: body?.model, content: [{ type: 'text', text }], stop_reason: 'end_turn' } }).catch(() => {});
    }
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ path: file }); } catch { await route.abort(); }
  });
  await page.goto(origin);
  const box = page.getByRole('textbox', { name: 'Ask Ember' });
  await box.waitFor();
  await page.waitForFunction(() => document.querySelector('.chat-controls button[aria-pressed="true"]'));
  const chats = () => calls.filter((c) => c.path === '/api/messages' && !isSync(c));
  const ask = async (text) => {
    const before = chats().length;
    await box.fill(text); await box.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.home-thread [data-role="assistant"]').length >= n && !document.querySelector('.home-thread [data-status="streaming"]'), await page.locator('.home-thread [data-role="assistant"]').count() + 1).catch(() => {});
    await page.waitForTimeout(250);
    return chats().slice(before);
  };
  return { page, context, calls, errors, state, chats, ask };
}

try {
  {
    const f = await fixture();
    const sent = await f.ask("What's the weather tomorrow?");
    const first = sent[0]?.body.messages[0].content || '';
    check('a weather question sends exactly one model request (no calendar lookup forced)', sent.length === 1);
    check('the forecast is fetched before the model is asked', f.calls.some((c) => c.path === '/api/weather' && c.at < sent[0].at));
    check('the request carries the National Weather Service block for Detroit Lakes', first.includes('LIVE WEATHER: National Weather Service forecast for Detroit Lakes, MN'));
    check('periods carry high/low, wind and precipitation', first.includes('Today (high 41°F, wind SSE 7 to 10 mph, precip 0%): Mostly sunny. High near 41') && /Tonight \(low \d+°F/.test(first));
    check('hourly wind is included', /Hourly \(time, temp, wind, precip chance\): \d{1,2} [AP]M -?\d+° [A-Z]{1,3} \d+ mph \d+%/.test(first));
    check('a checked, empty alert list reads "none active"', first.includes('Weather alerts: none active.'));
    check('the block tells Ember how far the forecast reaches and never to invent', /It covers through [A-Z][A-Za-z ]+; .*Never invent conditions\./.test(first));
    check('the weather request sends no question, place or personal data', f.calls.filter((c) => c.path === '/api/weather').every((c) => JSON.stringify(c.body) === '{}'));
    check('the answer is shown without a "did not check" caveat', await f.page.locator('.home-thread [data-role="assistant"]').last().innerText().then((t) => t.includes('Tomorrow looks calm.') && !/didn't check|couldn't get a live result/.test(t)));
    const weatherCalls = f.calls.filter((c) => c.path === '/api/weather').length;
    const again = await f.ask('Will it rain tonight?');
    check('a fresh forecast is reused, not refetched, on the next question', f.calls.filter((c) => c.path === '/api/weather').length === weatherCalls && again[0].body.messages[0].content.includes('LIVE WEATHER: National Weather Service'));
    const loose = await f.ask('How does tomorrow look for wind?');
    check('"how does tomorrow look for wind" is a forecast question, not a calendar one', loose.length === 1);
    check('weather adds no runtime errors', f.errors.length === 0);
    await f.context.close();
  }
  {
    const f = await fixture({ answer: 'You have a charter at 8 AM Saturday and it will be windy.' });
    const sent = await f.ask("What's the weather for my charter tomorrow?");
    check('a weather question that names a trip still requires the calendar', sent.length === 2 && /Ember check: this question needs Brady's live calendar/.test(sent[1].body.messages.at(-1).content));
    check('an unverified trip claim is still refused', await f.page.locator('.home-thread [data-role="assistant"]').last().innerText().then((t) => /couldn't get a live result from your calendar/.test(t)));
    await f.context.close();
  }
  for (const mode of ['down', 'junk']) {
    const f = await fixture({ weather: mode });
    const sent = await f.ask('Is it windy today?');
    const first = sent[0]?.body.messages[0].content || '';
    check(`${mode}: no forecast means Ember is told it is unavailable and not to guess`, first.includes('LIVE WEATHER: unavailable right now') && first.includes('Never guess weather.') && !first.includes('high 41'));
    check(`${mode}: the question still goes through`, sent.length === 1);
    await f.context.close();
  }
  {
    const f = await fixture({ weather: 'alert' });
    const first = (await f.ask('Any weather alerts?'))[0].body.messages[0].content;
    check('an active alert is passed with its severity and end time', /Weather alerts: Wind Advisory \(Moderate\) until [A-Z][a-z]{2},? \d{1,2}:\d{2} [AP]M: Wind Advisory until 6 PM/.test(first));
    f.state.weather = 'unchecked';
    await f.page.evaluate(() => { const real = Date.now; Date.now = () => real() + 11 * 60 * 1000; });
    const later = (await f.ask('Any weather alerts now?'))[0].body.messages[0].content;
    check('a stale forecast is refetched for a weather question', f.calls.filter((c) => c.path === '/api/weather').length >= 2);
    check('a failed alert lookup never reads as "none"', later.includes('Weather alerts: not checked') && !later.includes('none active'));
    await f.context.close();
  }
  {
    const f = await fixture();
    await f.page.waitForFunction(() => true);
    const before = f.chats().length;
    await f.page.getByRole('button', { name: /brief my day/i }).first().click();
    await f.page.waitForTimeout(1500);
    const sent = f.chats().slice(before);
    check('Brief my day asks for a weather line first', /open with one weather line for tomorrow from the live weather block/.test(sent[0]?.body.messages.at(-1).content || ''));
    check('Brief my day carries the forecast and still requires live lookups', sent[0].body.messages[0].content.includes('LIVE WEATHER: National Weather Service') && sent.length === 2);
    await f.context.close();
  }
  {
    const f = await fixture();
    const sent = await f.ask('Draft a thank-you text for a guest.');
    check('a non-weather question is not delayed and still carries the weather block or its absence', sent.length === 1 && sent[0].body.messages[0].content.includes('LIVE WEATHER'));
    await f.context.close();
  }
  console.log(`Weather: ${checks} checks passed.`);
} finally { await browser.close(); }
