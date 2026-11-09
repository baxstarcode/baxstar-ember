// Voice turn latency: end of speech → first audible reply, on the real rendered
// app. The model stream and Jenny's TTS are deterministic SIMULATIONS with fixed,
// stated timings, so two builds can be compared fairly. They are not live numbers:
// real Opus thinking time, Edge TTS synthesis time and device audio start are
// measured only on Brady's phone/Mac.
//   node .devtest/voice-latency-check.mjs            (this checkout)
//   EMBER_ROOT=/path/to/other/build node .devtest/voice-latency-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.env.EMBER_ROOT || new URL("..", import.meta.url).pathname);
const MODEL = { firstTokenMs: 2500, charsPerSecond: 280 };   // assumed reply stream
const TTS = { baseMs: 350, msPerChar: 2.5 };                  // assumed synthesis time
const SPEECH_CHARS_PER_SECOND = 15;                           // clip duration
const REPLY = "Your next trip is tomorrow at 6 AM on Detroit Lake with a party of four. " +
  "The pontoon in slip 3 is booked from 10 to 4, and the turnover is set for 2. " +
  "Two voicemails came in tonight: one asks about a 3-day pontoon rental for the 18th, and one is a missed call with no message. " +
  "Your inbox has a FareHarbor booking confirmation and a parent asking to switch Tech Camp sessions. " +
  "Nothing needs a reply before your first trip.";

const PREINSTALLED = "/opt/pw-browsers/chromium";
const executablePath = process.env.CHROME_PATH || (fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
async function measure(run, scenario = "latency") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(({ MODEL, TTS, REPLY, SPEECH_CHARS_PER_SECOND }) => {
    window.recs = []; window.marks = {};
    class Rec {
      start() { this.active = true; recs.push(this); setTimeout(() => this.onstart?.(), 0); }
      stop() { this.active = false; setTimeout(() => this.onend?.(), 0); }
      abort() { this.stop(); }
    }
    window.SpeechRecognition = Rec; window.webkitSpeechRecognition = undefined;
    window.say = (text) => { const v = [{ transcript: text }]; v.isFinal = true; marks.speechEnd = performance.now(); recs.at(-1).onresult?.({ results: [v], resultIndex: 0 }); };
    Object.defineProperty(navigator, "wakeLock", { value: { request: async () => Object.assign(new EventTarget(), { release: async () => {} }) } });
    function wav(seconds) {
      const rate = 8000, n = Math.max(1, Math.round(seconds * rate)), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
      w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / rate * 440 * 2 * Math.PI) * 500), true);
      return new Blob([buf], { type: "audio/wav" });
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.pathname === "/api/connectors/status") return Response.json({ connectors: {} });
      if (url.pathname === "/api/tts") {
        const text = JSON.parse(init.body).text;
        marks.ttsCalls = (marks.ttsCalls || 0) + 1;
        (marks.ttsTexts ||= []).push(text);
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        marks.firstTtsRequest ??= performance.now();
        await new Promise((r) => setTimeout(r, TTS.baseMs + TTS.msPerChar * text.length));
        marks.firstTtsReply ??= performance.now();
        return new Response(wav(text.length / SPEECH_CHARS_PER_SECOND), { headers: { "Content-Type": "audio/wav" } });
      }
      if (url.pathname === "/api/messages") {
        const body = JSON.parse(init.body);
        marks.sent = performance.now();
        if (!body.stream) return Response.json({ content: [{ type: "text", text: REPLY }], stop_reason: "end_turn" });
        const enc = new TextEncoder(), sse = (o) => enc.encode(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
        const stream = new ReadableStream({
          async start(ctl) {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            ctl.enqueue(sse({ type: "message_start", message: { model: body.model } }));
            await wait(MODEL.firstTokenMs);
            marks.firstToken = performance.now();
            ctl.enqueue(sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
            for (let i = 0; i < REPLY.length; i += 14) {
              ctl.enqueue(sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REPLY.slice(i, i + 14) } }));
              await wait(14 / MODEL.charsPerSecond * 1000);
            }
            marks.lastToken = performance.now();
            ctl.enqueue(sse({ type: "message_delta", delta: { stop_reason: "end_turn" } }));
            ctl.enqueue(sse({ type: "message_stop" }));
            ctl.close();
          },
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      return realFetch(input, init);
    };
    document.addEventListener("playing", () => { marks.firstAudio ??= performance.now(); marks.plays = (marks.plays || 0) + 1; }, true);
  }, { MODEL, TTS, REPLY, SPEECH_CHARS_PER_SECOND });
  const origin = "https://ember.baxstarfishing.com";
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    const file = path.resolve(root, u.pathname === "/" ? "index.html" : u.pathname.slice(1));
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ path: file }); } catch { await route.abort(); }
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Talk to Ember", exact: true }).click();
  await page.locator('[data-voice-phase="listening"]').waitFor();
  await page.evaluate(() => say("What does tomorrow look like?"));
  await page.waitForFunction(() => window.marks.firstAudio, null, { timeout: 30000 });
  await page.waitForTimeout(200);
  if (scenario === "sequence") {
    // Play every clip to its end; the turn must finish and the mic re-arm once.
    for (let i = 0; i < 20 && !(await page.locator('[data-voice-phase="listening"]').count()); i++) {
      await page.locator('audio[aria-label="Ember reply"]').evaluate((a) => { if (a.duration) a.currentTime = a.duration - 0.05; });
      await page.waitForTimeout(400);
    }
    const m = await page.evaluate(() => ({ ...window.marks, recs: recs.length, phase: document.querySelector("[data-voice-phase]")?.dataset.voicePhase }));
    await context.close();
    return m;
  }
  if (scenario === "stop") {
    await page.getByRole("region", { name: "Ember voice controls" }).getByRole("button", { name: "Stop voice" }).click();
    await page.waitForTimeout(3000);
    const m = await page.evaluate(() => ({ ...window.marks, recs: recs.length, active: recs.some((r) => r.active), paused: document.querySelector('audio[aria-label="Ember reply"]').paused }));
    await context.close();
    return m;
  }
  const m = await page.evaluate(() => window.marks);
  await context.close();
  const at = (k) => (m[k] === undefined ? null : Math.round(m[k] - m.speechEnd));
  return { run, sent: at("sent"), firstToken: at("firstToken"), lastToken: at("lastToken"), firstTtsRequest: at("firstTtsRequest"), firstTtsReply: at("firstTtsReply"), firstAudio: at("firstAudio"), ttsCalls: m.ttsCalls };
}

try {
  const runs = [];
  for (let i = 1; i <= 3; i++) runs.push(await measure(i));
  console.log(`build: ${root}`);
  console.log(`simulated: first token ${MODEL.firstTokenMs}ms, ${MODEL.charsPerSecond} chars/s, TTS ${TTS.baseMs}ms + ${TTS.msPerChar}ms/char, reply ${REPLY.length} chars`);
  console.table(runs);
  const median = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
  console.log(`median end-of-speech → first audio: ${median("firstAudio")}ms (send ${median("sent")}ms, first token ${median("firstToken")}ms, first TTS request ${median("firstTtsRequest")}ms, first TTS reply ${median("firstTtsReply")}ms)`);
  if (process.env.EMBER_STREAM_CHECKS) {
    const seq = await measure(0, "sequence");
    const said = seq.ttsTexts.join(" ").replace(/\s+/g, " ").trim();
    assert.equal(said, REPLY.replace(/\s+/g, " ").trim(), "every sentence is spoken once, in order");
    assert.ok(seq.ttsTexts.length >= 2 && seq.plays >= seq.ttsTexts.length, `all ${seq.ttsTexts.length} clips played`);
    assert.equal(seq.phase, "listening", "the conversation hands the turn back after the last clip");
    assert.equal(seq.recs, 2, "the mic re-arms exactly once");
    console.log(`PASS streamed reply: ${seq.ttsTexts.length} clips (${seq.ttsTexts.map((t) => t.length).join("/")} chars) played in order; mic re-armed once`);
    const stopped = await measure(0, "stop");
    assert.ok(stopped.paused && !stopped.active && stopped.recs === 1, "Stop mid-reply silences Jenny and never re-arms the mic");
    assert.ok((stopped.plays || 0) === 1, "no later clip starts after Stop");
    console.log(`PASS Stop during the first clip: playback stopped, ${stopped.plays} clip played, mic stayed off`);
  }
  if (process.env.EMBER_LATENCY_BUDGET_MS) assert.ok(median("firstAudio") <= Number(process.env.EMBER_LATENCY_BUDGET_MS), "first audio over budget");
} finally {
  await browser.close();
}
