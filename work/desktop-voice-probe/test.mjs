// Offline browser checks. Recognition, proxy, and speaker events are simulated.
// This cannot prove real speech accuracy, mic release, CORS, TTS, or audibility.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch {
  const directory = process.env.EMBER_PLAYWRIGHT_DIR || join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
  playwright = require(directory);
}
const root = dirname(fileURLToPath(import.meta.url));
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (!["index.html", "probe.js", "style.css"].includes(name)) { res.writeHead(404).end(); return; }
  try {
    const mime = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { "Content-Type": mime }).end(await readFile(join(root, name)));
  } catch { res.writeHead(500).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
const check = (label) => { count += 1; console.log(`PASS ${count}: ${label}`); };

async function session({ mobile = false, speech = true, blockedAudio = false, holdRelease = false, insecure = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(mobile ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18 Mobile Safari/604.1" } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  let mode = "stream";
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) && !url.endsWith("/api/messages") && !url.endsWith("/api/tts")) return route.continue();
    assert.ok(url === `${origin}/api/messages` || url === `${origin}/api/tts`, `Unexpected request: ${url}`);
    const payload = route.request().postDataJSON();
    requests.push({ url, payload, headers: route.request().headers() });
    if (mode === "network") return route.abort("failed");
    if (mode === "http") return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Origin not allowed"}' });
    if (mode === "pending") return; // The user cancels this intentionally unresolved request.
    if (url.endsWith("/tts")) {
      if (mode === "tts-fail") return route.fulfill({ status: 502, body: "TTS unavailable" });
      if (mode === "tts-type") return route.fulfill({ contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "audio/mpeg", body: Buffer.alloc(400, 1) });
    }
    if (mode === "json") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "A short JSON response." }], stop_reason: "end_turn" }) });
    const frames = [
      { type: "content_block_start", content_block: { type: "text", text: "" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "One " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "calm sentence." } },
    ];
    if (mode === "stream-error") frames.push({ type: "error", error: { message: "Upstream stream error" } });
    else if (mode !== "truncated") frames.push({ type: "message_stop" });
    return route.fulfill({ contentType: "text/event-stream", body: frames.map((frame) => `event: ${frame.type}\r\ndata: ${JSON.stringify(frame)}\r\n\r\n`).join("") });
  });
  page.setDefaultTimeout(8000);
  await page.addInitScript(({ speech, blockedAudio, mobile, holdRelease, insecure }) => {
    window.__mock = { starts: 0, stops: 0, aborts: 0, plays: 0, rec: null, order: [] };
    class Recognition {
      constructor() { window.__mock.rec = this; }
      start() { window.__mock.starts += 1; window.__mock.order.push("mic-start"); }
      stop() { window.__mock.stops += 1; }
      abort() {
        window.__mock.aborts += 1;
        if (!holdRelease) queueMicrotask(() => this.onend?.());
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: speech && !mobile ? Recognition : undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: speech && mobile ? Recognition : undefined });
    if (insecure) Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    HTMLMediaElement.prototype.play = function () {
      window.__mock.plays += 1;
      if (blockedAudio) return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () { window.__mock.order.push("audio-pause"); };
    HTMLMediaElement.prototype.load = function () {};
    // Never feed the intentionally fake MP3 bytes to Chrome's real decoder.
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get() { return this.__mockSrc || ""; },
      set(value) { this.__mockSrc = value; },
    });
  }, { speech, blockedAudio, mobile, holdRelease, insecure });
  await page.goto(origin);
  await page.locator("#capability").filter({ hasText: /experiment|recognition|secure/ }).waitFor();
  return { context, page, requests, errors, mode: (value) => { mode = value; } };
}

async function sendTyped(s) {
  await s.page.locator("#transcript").fill("Say one calm sentence.");
  await s.page.locator("#send").click();
}
async function state(page, id, text) {
  await page.locator(`#${id}`).filter({ hasText: text }).waitFor();
}
async function speak(s, text = "Give me one sentence.") {
  await s.page.locator("#talk").click();
  await s.page.evaluate((words) => {
    window.__mock.rec.onstart();
    const result = [{ transcript: words }];
    result.isFinal = true;
    window.__mock.rec.onresult({ results: [result] });
  }, text);
  await s.page.locator("#talk").click();
  await s.page.evaluate(() => window.__mock.rec.onend());
  await state(s.page, "mic-state", "recognition ended");
}
async function hide(s) {
  await s.page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function healthy(s) {
  assert.deepEqual(s.errors, []);
  assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await s.context.close();
}

try {
  // Automated recognition/playback are mocked here. An explicit Chromium path
  // makes those offline checks portable; it does not replace the real Chrome gate.
  browser = await playwright.chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: "chrome", headless: true });
  const s = await session();
  assert.equal(await s.page.evaluate(() => window.__mock.starts), 0);
  assert.equal(s.requests.length, 0);
  assert.equal(await s.page.locator("#send").isDisabled(), true);
  check("load never opens microphone or sends an API request");

  await s.page.locator("#talk").click();
  await state(s.page, "mic-state", "Requesting");
  assert.equal(await s.page.locator("#send").isDisabled(), true);
  await s.page.evaluate(() => window.__mock.rec.onstart());
  await state(s.page, "mic-state", "Listening");
  await s.page.evaluate(() => {
    const result = [{ transcript: "Give me one sentence" }];
    result.isFinal = false;
    window.__mock.rec.onresult({ results: [result] });
  });
  await state(s.page, "interim", "Give me one sentence");
  assert.equal(await s.page.locator("#transcript").inputValue(), "");
  await s.page.evaluate(() => {
    const result = [{ transcript: "Give me one sentence." }];
    result.isFinal = true;
    window.__mock.rec.onresult({ results: [result] });
  });
  await s.page.locator("#talk").click();
  await state(s.page, "mic-state", "stopping");
  await s.page.evaluate(() => window.__mock.rec.onend());
  await state(s.page, "mic-state", "recognition ended");
  assert.equal(await s.page.locator("#transcript").inputValue(), "Give me one sentence.");
  assert.equal(s.requests.length, 0);
  assert.equal(await s.page.evaluate(() => window.__mock.starts), 1);
  check("interim/final recognition and explicit stop work; no auto-send or restart");

  await s.page.locator("#send").click();
  await state(s.page, "request-state", "Complete");
  assert.equal(await s.page.locator("#reply").innerText(), "One calm sentence.");
  assert.equal(s.requests.length, 1);
  const body = s.requests[0].payload;
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 300);
  assert.equal(body.stream, true);
  assert.equal(body.system, undefined);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.match(body.messages[0].content, /one short plain sentence under 60 words/);
  assert.match(body.messages[0].content, /Reviewed transcript:\nGive me one sentence\.$/);
  assert.equal(body.mcp_servers, undefined);
  assert.equal(body.tools, undefined);
  assert.equal(s.requests[0].headers.authorization, undefined);
  assert.equal(s.requests[0].headers["x-api-key"], undefined);
  assert.equal(await s.page.evaluate(() => window.__mock.plays), 0);
  check("SSE response completes using the app proxy contract; no client keys, tools, or autoplay");

  await s.page.locator("#play").click();
  await state(s.page, "audio-state", "Playing");
  assert.deepEqual(s.requests[1].payload, { text: "One calm sentence.", voice: "en-US-JennyNeural" });
  assert.equal(await s.page.evaluate(() => window.__mock.starts), 1);
  await s.page.evaluate(() => document.getElementById("audio").dispatchEvent(new Event("ended")));
  await state(s.page, "audio-state", "Playback ended");
  assert.equal(await s.page.evaluate(() => window.__mock.starts), 1);
  await s.page.screenshot({ path: "/tmp/ember-desktop-voice-probe.png", fullPage: true });
  check("optional /tts request and simulated playback end keep the microphone off");

  await s.page.locator("#talk").click();
  await s.page.evaluate(() => window.__mock.rec.onerror({ error: "not-allowed" }));
  await state(s.page, "message", "Microphone blocked");
  assert.equal(await s.page.locator("#talk").isEnabled(), true);
  await s.page.locator("#talk").click();
  await s.page.evaluate(() => window.__mock.rec.onstart());
  await s.page.locator("#cancel").click();
  await state(s.page, "mic-state", "Mic off");
  assert.equal(await s.page.evaluate(() => window.__mock.rec.onresult), null);
  check("permission denial recovers; cancellation detaches late recognition callbacks");

  s.mode("json");
  await sendTyped(s);
  await state(s.page, "request-state", "Complete");
  assert.equal(await s.page.locator("#reply").innerText(), "A short JSON response.");
  check("ordinary JSON response also works");
  await s.page.locator("#stream-reply").uncheck();
  await sendTyped(s);
  await state(s.page, "request-state", "Complete");
  assert.equal(s.requests.at(-1).payload.stream, false);
  assert.equal(await s.page.locator("#reply").innerText(), "A short JSON response.");
  await s.page.locator("#stream-reply").check();
  check("explicit non-streaming choice sends stream:false and completes the JSON response");

  for (const [mode, expected] of [["stream-error", "Upstream stream error"], ["truncated", "stream ended early"], ["http", "Proxy HTTP 403"], ["network", "Cannot reach the proxy"]]) {
    s.mode(mode);
    await sendTyped(s);
    await state(s.page, "message", expected);
    assert.equal(await s.page.locator("#play").isDisabled(), true);
    assert.equal(await s.page.locator("#talk").isEnabled(), true);
    check(`${mode} is explicit and never marks an incomplete reply playable`);
  }
  s.mode("pending");
  await sendTyped(s);
  await s.page.locator("#cancel").click();
  await state(s.page, "request-state", "Cancelled");
  assert.equal(await s.page.locator("#send").isEnabled(), true);
  check("an in-flight request can be cancelled without locking the controls");
  await healthy(s);

  const blocked = await session({ blockedAudio: true });
  await sendTyped(blocked);
  await state(blocked.page, "request-state", "Complete");
  await blocked.page.locator("#play").click();
  await state(blocked.page, "audio-state", "Playback blocked");
  assert.equal(await blocked.page.locator("#audio").isVisible(), true);
  check("autoplay rejection leaves visible native controls and an honest error");
  blocked.mode("tts-fail");
  await blocked.page.locator("#play").click();
  await state(blocked.page, "message", "TTS HTTP 502");
  assert.equal(await blocked.page.locator("#reply").innerText(), "One calm sentence.");
  check("TTS failure preserves the text response");
  await healthy(blocked);

  const unsupported = await session({ speech: false });
  assert.equal(await unsupported.page.locator("#talk").isDisabled(), true);
  await sendTyped(unsupported);
  await state(unsupported.page, "request-state", "Complete");
  check("unsupported speech API still permits the typed proxy test");
  await healthy(unsupported);

  const phone = await session({ mobile: true });
  assert.equal(await phone.page.locator("#talk").isDisabled(), true);
  await phone.page.locator("#transcript").fill("Test");
  assert.equal(await phone.page.locator("#send").isDisabled(), true);
  assert.equal(phone.requests.length, 0);
  assert.equal(await phone.page.locator("#mobile-experiment").isVisible(), true);
  await phone.page.locator("#mobile-opt-in").check();
  assert.equal(await phone.page.locator("#talk").isEnabled(), true);
  assert.equal(phone.requests.length, 0);
  assert.equal(await phone.page.evaluate(() => window.__mock.starts), 0);
  check("phone stays off until explicit opt-in; enabling it starts no microphone or request");

  for (let n = 1; n <= 5; n++) {
    await speak(phone, `Harmless private test phrase ${n}.`);
    assert.equal(phone.requests.length, (n - 1) * 2);
    await phone.page.locator("#send").click();
    await state(phone.page, "request-state", "Complete");
    await phone.page.locator("#play").click();
    await state(phone.page, "audio-state", "Playing");
    await phone.page.evaluate(() => document.getElementById("audio").dispatchEvent(new Event("ended")));
    await state(phone.page, "audio-state", "Playback ended");
    await phone.page.locator("#result").selectOption("pass");
    if (n === 1) {
      await phone.page.locator("#record-result").click();
      await state(phone.page, "message", "your confirmation");
    }
    await phone.page.locator("#released").check();
    await phone.page.locator("#heard").check();
    await phone.page.locator("#record-result").click();
    await state(phone.page, "turn-number", `Turn ${n} · pass`);
  }
  assert.equal(await phone.page.evaluate(() => window.__mock.starts), 5);
  assert.equal(await phone.page.evaluate(() => window.__mock.plays), 5);
  check("five prefixed mobile recognition turns require reviewed Send and explicit Play without auto-restart");

  await phone.page.locator("#device-notes").fill("Simulated iPhone: real mic and speaker not tested.");
  await phone.page.locator("#prepare-report").click();
  const report = JSON.parse(await phone.page.locator("#report").inputValue());
  assert.equal(report.turns.length, 5);
  assert.equal(report.environment.mobileOptIn, true);
  assert.ok(report.turns.every((t) => t.observation.result === "pass" && t.marks["audio-ended"] >= t.marks["mic-start-requested"]));
  assert.ok(report.events.some((event) => event.event === "recognition-ended"));
  assert.ok(report.events.some((event) => event.event === "text-complete"));
  assert.equal(JSON.stringify(report).includes("Harmless private test phrase"), false);
  assert.equal(JSON.stringify(report).includes("One calm sentence"), false);
  assert.match(report.status, /PROVISIONAL/);
  check("report captures per-turn timing and user observations, excludes transcript/reply content, and remains provisional");

  await phone.page.locator("#talk").click();
  await phone.page.evaluate(() => window.__mock.rec.onstart());
  await hide(phone);
  await state(phone.page, "mic-state", "recognition ended");
  assert.equal(await phone.page.evaluate(() => window.__mock.starts), 6);
  assert.equal(await phone.page.evaluate(() => window.__mock.rec.onresult), null);
  assert.equal(await phone.page.locator("#talk").isEnabled(), true);
  check("hiding and returning during recognition aborts, detaches late results, and requires a new Talk tap");

  phone.mode("pending");
  await sendTyped(phone);
  await hide(phone);
  await state(phone.page, "request-state", "Cancelled");
  assert.equal(await phone.page.locator("#play").isDisabled(), true);
  phone.mode("stream");
  await speak(phone);
  await phone.page.locator("#send").click();
  await state(phone.page, "request-state", "Complete");
  await phone.page.locator("#play").click();
  await state(phone.page, "audio-state", "Playing");
  await phone.page.locator("#talk").click();
  const order = await phone.page.evaluate(() => window.__mock.order);
  assert.deepEqual(order.slice(-2), ["audio-pause", "mic-start"]);
  assert.equal(await phone.page.locator("#audio").isVisible(), false);
  assert.equal(await phone.page.locator("#play").isDisabled(), true);
  await phone.page.locator("#cancel").click();
  await state(phone.page, "mic-state", "recognition ended");
  check("hidden requests cancel; playback-to-mic handoff pauses old audio before requesting new recognition");

  await sendTyped(phone);
  await state(phone.page, "request-state", "Complete");
  await phone.page.locator("#play").click();
  await state(phone.page, "audio-state", "Playing");
  const beforeHide = await phone.page.evaluate(() => window.__mock.plays);
  await hide(phone);
  assert.equal(await phone.page.locator("#audio").isVisible(), false);
  assert.equal(await phone.page.evaluate(() => window.__mock.plays), beforeHide);
  await phone.page.locator("#mobile-opt-in").uncheck();
  assert.equal(await phone.page.locator("#talk").isDisabled(), true);
  assert.equal(await phone.page.locator("#send").isDisabled(), true);
  await phone.page.locator("#mobile-opt-in").check();
  await phone.page.reload();
  assert.equal(await phone.page.locator("#mobile-opt-in").isChecked(), false);
  assert.equal(await phone.page.locator("#talk").isDisabled(), true);
  await phone.page.screenshot({ path: "/tmp/ember-iphone-voice-lab.png", fullPage: true });
  check("tab hiding stops playback; opting out stops the experiment, and reload never retains opt-in");
  await healthy(phone);

  const missingMobile = await session({ mobile: true, speech: false });
  await missingMobile.page.locator("#mobile-opt-in").check();
  assert.equal(await missingMobile.page.locator("#talk").isDisabled(), true);
  await state(missingMobile.page, "capability", "microphone voice is unsupported");
  await sendTyped(missingMobile);
  await state(missingMobile.page, "request-state", "Complete");
  await missingMobile.page.locator("#result").selectOption("pass");
  await missingMobile.page.locator("#released").check();
  await missingMobile.page.locator("#heard").check();
  await missingMobile.page.locator("#record-result").click();
  await state(missingMobile.page, "message", "A full pass needs a microphone turn");
  check("missing mobile recognition is reported honestly; typed-only testing cannot be recorded as a full voice pass");
  await healthy(missingMobile);

  const insecure = await session({ mobile: true, insecure: true });
  await insecure.page.locator("#mobile-opt-in").check();
  await insecure.page.locator("#transcript").fill("Test");
  assert.equal(await insecure.page.locator("#talk").isDisabled(), true);
  assert.equal(await insecure.page.locator("#send").isDisabled(), true);
  assert.equal(insecure.requests.length, 0);
  check("phone opt-in cannot bypass a missing secure context");
  await healthy(insecure);

  const stuck = await session({ holdRelease: true });
  await stuck.page.clock.install();
  await stuck.page.locator("#talk").click();
  await stuck.page.evaluate(() => window.__mock.rec.onstart());
  await stuck.page.locator("#cancel").click();
  await state(stuck.page, "mic-state", "release requested");
  assert.equal(await stuck.page.locator("#talk").isDisabled(), true);
  await stuck.page.clock.fastForward(3100);
  await state(stuck.page, "mic-state", "release unconfirmed");
  assert.equal(await stuck.page.locator("#talk").isDisabled(), true);
  assert.equal(await stuck.page.locator("#send").isDisabled(), true);
  assert.equal(await stuck.page.locator("#confirm-release").isVisible(), true);
  await stuck.page.locator("#confirm-release").click();
  await state(stuck.page, "mic-state", "indicator confirmed by you");
  assert.equal(await stuck.page.locator("#talk").isEnabled(), true);
  assert.equal(await stuck.page.evaluate(() => window.__mock.rec.onend), null);
  check("missing recognition end blocks new turns until an explicit physical-indicator confirmation");
  await healthy(stuck);
  console.log(`\n${count}/${count} offline checks passed. Real Mac/iPhone microphone, service, neural audio, speaker, interruptions and handoff remain PROVISIONAL.`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
