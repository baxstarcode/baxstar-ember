// Real Chromium MediaRecorder with a synthetic microphone; providers intercepted.
// This proves lifecycle/codec handling, not physical iPhone or CarPlay behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS — ${name}`); };
async function fixture({ preview = true, width = 390, permission = 'normal', blockedPlay = false } = {}) {
  const origin = preview ? 'https://voice-test.baxstar-ember.pages.dev' : 'https://ember.baxstarfishing.com';
  const context = await browser.newContext({ viewport: { width, height: width > 500 ? 1000 : 844 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'], reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const calls = [], errors = []; let lastAudio, mode = 'success';
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ permission, blockedPlay }) => {
    window.voiceStreams = []; window.voiceRequests = 0; window.voiceLegacy = 0;
    window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor() { window.voiceLegacy++; } };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.voiceRequests++;
      if (permission === 'denied') throw new DOMException('no', 'NotAllowedError');
      const stream = await get(constraints); window.voiceStreams.push(stream);
      if (permission === 'pending') await new Promise(resolve => { window.finishPermission = resolve; });
      return stream;
    };
    if (blockedPlay) HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  }, { permission, blockedPlay });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/voice/transcribe')) {
        lastAudio = { data: Buffer.from(body.audio, 'base64'), mime: body.mime };
        if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"disabled"}' });
        if (mode === 'pending') { await new Promise(resolve => setTimeout(resolve, 1200)); }
        return route.fulfill({ contentType: 'application/json', body: '{"text":"Give me one short voice test."}' }).catch(() => {});
      }
      if (url.pathname.endsWith('/voice/speak')) {
        if (mode === 'speechPending') await new Promise(resolve => setTimeout(resolve, 1200));
        return route.fulfill({ contentType: lastAudio.mime, body: lastAudio.data }).catch(() => {});
      }
      if (url.pathname.endsWith('/connectors/status')) return route.fulfill({ contentType: 'application/json', body: '{"connectors":{}}' });
      const question = body.messages?.at(-1)?.content || '';
      if (mode === 'chatPending' && question === 'Give me one short voice test.') await new Promise(resolve => setTimeout(resolve, 1200));
      const answer = question === 'Give me one short voice test.' ? 'Your voice test is ready.' : '{"voicemails":[],"emails":[],"events":[]}';
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', model: 'claude-sonnet-5-5' }) }).catch(() => {});
    }
    try {
      const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({ contentType: type, body: await fs.readFile(file) });
    } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  });
  await page.goto(origin); await page.locator('.reactor-stage').waitFor();
  const open = async () => { await page.getByRole('button', { name: 'Talk to Ember', exact: true }).click(); await page.getByRole('dialog', { name: 'Talk to Ember' }).waitFor(); };
  const dialog = page.getByRole('dialog', { name: 'Talk to Ember' });
  const record = async () => { await dialog.getByRole('button', { name: 'Record', exact: true }).click(); await dialog.locator('[data-phase="recording"]').waitFor(); await page.waitForTimeout(450); await dialog.getByRole('button', { name: 'Finish recording' }).click(); await dialog.getByRole('button', { name: 'Play my recording' }).waitFor(); await page.waitForFunction(() => !document.querySelector('.voice-console button:nth-child(3)')?.disabled && document.querySelector('.voice-status').dataset.phase === 'ready'); };
  const released = () => page.evaluate(() => voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  return { context, page, dialog, calls, errors, open, record, released, mode: value => { mode = value; } };
}
try {
  for (const width of [1440, 390]) {
    const f = await fixture({ width }); await f.open();
    check(`${width}: page and mouth panel do not acquire the mic`, await f.page.evaluate(() => voiceRequests === 0 && voiceLegacy === 0));
    check(`${width}: preview blocks live voice controls`, await f.dialog.getByRole('button', { name: 'Transcribe', exact: true }).isDisabled() && await f.dialog.getByRole('button', { name: 'Send to Ember' }).isDisabled());
    check(`${width}: dialog fits viewport`, await f.dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    for (let turn = 1; turn <= 5; turn++) { await f.record(); check(`${width}: turn ${turn} releases every capture track`, await f.released()); }
    await f.dialog.getByRole('button', { name: 'Play my recording' }).click();
    await f.page.waitForFunction(() => document.querySelector('.voice-console audio').readyState >= 2);
    check(`${width}: captured media decodes in the audio player`, await f.dialog.locator('audio').evaluate(a => !a.error && a.readyState >= 2));
    check(`${width}: preview sends no voice requests`, !f.calls.some(c => c.path.includes('/voice/')));
    await f.page.screenshot({ path: `/tmp/ember-recorded-voice-${width}.png` });
    await f.dialog.getByRole('button', { name: 'Record', exact: true }).click(); await f.dialog.locator('[data-phase="recording"]').waitFor();
    await f.dialog.getByRole('button', { name: 'Close voice' }).click();
    check(`${width}: closing during recording releases capture`, await f.released());
    check(`${width}: original dock remains intact`, (await f.page.locator('.dock-label').allTextContents()).map(t => t.replace(/\u00ad/g,'')).join('|') === 'OPS|Caption Studio|Knowledge Graph|Google Drive|FareHarbor|Projects');
    check(`${width}: no uncaught browser errors`, !f.errors.length); await f.context.close();
  }
  {
    const f = await fixture({ preview: false }); await f.open(); await f.record();
    await f.dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
    await f.page.waitForFunction(() => document.querySelector('#voice-words').value === 'Give me one short voice test.');
    check('transcription requires an explicit action after capture releases', await f.released() && f.calls.filter(c => c.path.endsWith('transcribe')).length === 1);
    await f.dialog.getByRole('button', { name: 'Send to Ember' }).click();
    await f.dialog.locator('.voice-answer').waitFor();
    await f.page.waitForFunction(() => document.querySelector('.voice-console audio').readyState >= 2);
    check('reviewed words use the ordinary chat, then official speech', f.calls.some(c => c.path.endsWith('/messages') && c.body.messages.at(-1).content === 'Give me one short voice test.') && f.calls.some(c => c.path.endsWith('/voice/speak') && c.body.text === 'Your voice test is ready.'));
    check('reply remains visible and the mic never auto-restarts', (await f.dialog.locator('.voice-answer').textContent()) === 'Your voice test is ready.' && await f.page.evaluate(() => voiceRequests === 1));
    await f.dialog.getByRole('button', { name: 'Stop everything' }).click();
    check('stop clears playback source and keeps the text', await f.dialog.locator('audio').getAttribute('src') === null && (await f.dialog.locator('#voice-words').inputValue()).includes('voice test'));
    const speechCalls = f.calls.filter(c => c.path.endsWith('/voice/speak')).length;
    await f.dialog.getByRole('button', { name: 'Read reply', exact: true }).click();
    check('replaying a generated reply does not repeat chat or speech inference', f.calls.filter(c => c.path.endsWith('/voice/speak')).length === speechCalls && await f.dialog.locator('audio').getAttribute('src') !== null);

    await f.context.close();
  }
  {
    const f = await fixture({ permission: 'denied' }); await f.open(); await f.dialog.getByRole('button', { name: 'Record', exact: true }).click();
    await f.page.getByText(/Microphone access was denied/).waitFor();
    check('denied permission offers browser permission recovery, without a Shortcut', /No Shortcut/.test(await f.dialog.getByRole('status').textContent())); await f.context.close();
  }
  {
    const f = await fixture({ permission: 'pending' }); await f.open(); await f.dialog.getByRole('button', { name: 'Record', exact: true }).click();
    await f.page.waitForFunction(() => window.finishPermission);
    await f.dialog.getByRole('button', { name: 'Close voice' }).click(); await f.page.evaluate(() => finishPermission());
    await f.page.waitForFunction(() => voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
    check('permission granted after closing cannot leave a microphone active', await f.released()); await f.context.close();
  }
  {
    const f = await fixture({ blockedPlay: true }); await f.open(); await f.record(); await f.dialog.getByRole('button', { name: 'Play my recording' }).click();
    await f.page.getByText('Audio is ready. Tap Play on the audio player below.').waitFor();
    check('blocked autoplay retains an explicit playable recording', await f.dialog.locator('audio').isVisible() && await f.released()); await f.context.close();
  }
  {
    const f = await fixture({ preview: false }); await f.open(); await f.record(); f.mode('failure');
    await f.dialog.getByRole('button', { name: 'Transcribe', exact: true }).click(); await f.page.getByText(/Voice service is not enabled yet/).waitFor();
    check('unconfigured provider preserves recording without retry', await f.dialog.getByRole('button', { name: 'Play my recording' }).isEnabled() && f.calls.filter(c => c.path.includes('/voice/')).length === 1);
    f.mode('pending'); await f.dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
    await f.dialog.getByRole('button', { name: 'Stop everything' }).click(); await f.page.waitForTimeout(1400);
    check('cancelled transcription cannot insert a late result', (await f.dialog.locator('#voice-words').inputValue()) === '');
    await f.dialog.getByRole('button', { name: 'Record', exact: true }).click(); await f.dialog.locator('[data-phase="recording"]').waitFor();
    await f.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    check('leaving the page releases the microphone without auto-resume', await f.released());
    await f.dialog.getByText('iPhone & truck check', { exact: true }).click(); await f.dialog.getByRole('button', { name: 'Copy test report' }).click();
    const report = await f.page.evaluate(() => navigator.clipboard.readText());
    check('report excludes conversation and audio data', !/Give me one|fixture-audio|base64|Your voice test/.test(report) && JSON.parse(report).verification.startsWith('PROVISIONAL'));
    await f.context.close();
  }
  {
    const f = await fixture({ preview: false }); await f.open(); f.mode('chatPending');
    await f.dialog.locator('#voice-words').fill('Give me one short voice test.');
    await f.dialog.getByRole('button', { name: 'Send to Ember' }).click();
    await f.dialog.locator('[data-phase="thinking"]').waitFor();
    await f.dialog.getByRole('button', { name: 'Stop everything' }).click(); await f.page.waitForTimeout(1400);
    check('cancelling voice chat prevents a late reply from speaking', !f.calls.some(c => c.path.endsWith('/voice/speak')) && await f.dialog.locator('.voice-answer').count() === 0);
    check('cancelled voice chat permits a fresh recording', await f.dialog.getByRole('button', { name: 'Record', exact: true }).isEnabled());
    f.mode('speechPending'); await f.record(); await f.dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
    await f.page.waitForFunction(() => document.querySelector('#voice-words').value === 'Give me one short voice test.');
    await f.dialog.getByRole('button', { name: 'Send to Ember' }).click(); await f.dialog.locator('[data-phase="preparing"]').waitFor();
    await f.dialog.getByRole('button', { name: 'Stop everything' }).click(); await f.page.waitForTimeout(1400);
    check('cancelling speech generation keeps text and cannot play late audio', (await f.dialog.locator('.voice-answer').textContent()) === 'Your voice test is ready.' && await f.dialog.locator('audio').getAttribute('src') === null);
    await f.context.close();
  }
  console.log(`${checks} voice checks passed. Physical iPhone/CarPlay remains PROVISIONAL.`);
} finally { await browser.close(); }
