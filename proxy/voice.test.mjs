import assert from "node:assert/strict";
import test from "node:test";
import worker from "./cloudflare-worker.js";
const origin = "https://ember.baxstarfishing.com";
const recording = { audio: Buffer.from("fixture-audio").toString("base64"), mime: "audio/mp4" };
function setup(run = async () => ({ text: "Hello Ember" })) {
  const calls = [];
  const env = { ALLOWED_ORIGINS: origin, EMBER_VOICE_ENABLED: "true", EMBER_VOICE_AI: { run: async (...args) => { calls.push(args); return run(...args); } } };
  const post = (kind, body, options = {}) => worker.fetch(new Request(`${options.host || origin}/api/voice/${kind}`, {
    method: "POST", headers: { Origin: options.origin || origin, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: options.signal,
  }), options.env || env, {}, { fetch() { throw new Error("Speech must not call legacy TTS, Anthropic, OAuth or connectors"); } });
  return { env, calls, post };
}
test("official transcription owns the model and strips client provider options", async () => {
  const f = setup();
  const response = await f.post("transcribe", { ...recording, model: "evil", token: "private", destination: "https://evil.example" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: "Hello Ember" });
  assert.deepEqual(f.calls, [["@cf/openai/whisper-large-v3-turbo", { audio: recording.audio, task: "transcribe", language: "en", vad_filter: true, condition_on_previous_text: false }]]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("voice stays disabled without explicit activation and the AI binding", async () => {
  const f = setup();
  for (const env of [{ ...f.env, EMBER_VOICE_ENABLED: "false" }, { ...f.env, EMBER_VOICE_AI: undefined }]) {
    assert.equal((await f.post("transcribe", recording, { env })).status, 503);
  }
  assert.equal(f.calls.length, 0);
});
test("public Worker hosts and foreign origins cannot reach new speech routes", async () => {
  const f = setup();
  for (const kind of ["transcribe", "speak"]) {
    assert.equal((await f.post(kind, recording, { host: "https://ember.example.workers.dev" })).status, 404);
    assert.equal((await f.post(kind, recording, { origin: "https://evil.example" })).status, 403);
  }
  assert.equal(f.calls.length, 0);
});
test("bad formats, malformed audio, and over-limit bodies never reach inference", async () => {
  const f = setup();
  for (const body of [{ ...recording, mime: "text/html" }, { ...recording, audio: "bad!!" }, { ...recording, audio: "a===" }, { ...recording, audio: "" }, { ...recording, audio: "A".repeat(3 * 1024 * 1024) }]) {
    assert.ok((await f.post("transcribe", body)).status >= 400);
  }
  assert.equal(f.calls.length, 0);
});
test("empty or oversized transcripts cannot become user messages", async () => {
  for (const text of [" ", "a".repeat(2001)]) {
    const f = setup(async () => ({ text })); assert.equal((await f.post("transcribe", recording)).status, 422);
  }
});
test("official speech owns speaker and encoding, returns bounded noncached audio", async () => {
  const f = setup(async () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([73, 68, 51])); c.close(); } }));
  const response = await f.post("speak", { text: "Hello Brady", speaker: "evil", url: "https://evil.example" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51]);
  assert.deepEqual(f.calls[0], ["@cf/deepgram/aura-2-en", { text: "Hello Brady", speaker: "luna", encoding: "mp3" }]);
});
test("empty, long, and non-string speech text is rejected without inference", async () => {
  const f = setup();
  for (const text of [null, "", " ", "a".repeat(2001), {}]) assert.equal((await f.post("speak", { text })).status, 400);
  assert.equal(f.calls.length, 0);
});
test("provider failures are sanitized and never automatically retried", async () => {
  const f = setup(async () => { throw new Error("SECRET_provider_data"); });
  const response = await f.post("transcribe", recording);
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /SECRET|provider_data/); assert.equal(f.calls.length, 1);
});
test("empty, invalid and oversized speech output fails honestly", async () => {
  for (const result of [{ audio: "bad" }, new ReadableStream({ start(c) { c.close(); } }), new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); c.close(); } })]) {
    const f = setup(async () => result); assert.equal((await f.post("speak", { text: "Hello" })).status, 502);
  }
});
test("request abort prevents inference or discards late results", async () => {
  const f = setup(); const stopped = new AbortController(); stopped.abort();
  assert.equal((await f.post("transcribe", recording, { signal: stopped.signal })).status, 499); assert.equal(f.calls.length, 0);
  let finish; const late = setup(() => new Promise(resolve => { finish = resolve; })); const controller = new AbortController();
  const pending = late.post("transcribe", recording, { signal: controller.signal });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); assert.equal((await pending).status, 499); finish({ text: "late" });
});
test("an inference that never finishes reaches the deadline without retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = setup(() => new Promise(() => {})); const pending = f.post("transcribe", recording);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(25001);
  assert.equal((await pending).status, 504); assert.equal(f.calls.length, 1);
});
