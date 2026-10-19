// Real workerd/module/WebSocket execution; speech and chat providers are synthetic.
// EMBER_TTS_CANDIDATE optionally points to the narrowly patched deployed source.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Miniflare, Log, LogLevel, Response as WorkerResponse, WebSocketPair } from "miniflare";
import { edgeGecV2 } from "./vendor/edge-gec-v2.mjs";

const origin = "https://ember.baxstarfishing.com";
const scriptPath = process.env.EMBER_TTS_CANDIDATE || fileURLToPath(new URL("./cloudflare-worker.js", import.meta.url));
test("workerd: v2 upgrade produces the same MP3 response while chat and host gates remain intact", { timeout: 30000 }, async () => {
  const calls = [];
  let mode = "audio", ssml = "";
  const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3, 4]);
  const mf = new Miniflare({
    log: new Log(LogLevel.ERROR), modules: true, scriptPath, modulesRoot: dirname(scriptPath),
    compatibilityDate: "2026-07-30",
    bindings: { ALLOWED_ORIGINS: origin, ANTHROPIC_API_KEY: "fixture-key" },
    outboundService: async (request) => {
      calls.push(request.url);
      if (request.url === "https://api.anthropic.com/v1/messages") {
        return Response.json({ content: [{ type: "text", text: "Fixture reply." }] });
      }
      const url = new URL(request.url);
      assert.equal(url.hostname, "speech.platform.bing.com");
      assert.equal(url.searchParams.get("Sec-MS-GEC-Version"), "2-143.0.3650.75");
      const now = Date.now();
      assert.ok([now - 1000, now, now + 1000].some(t => edgeGecV2(t) === url.searchParams.get("Sec-MS-GEC")));
      if (mode === "refuse") return new Response("Untrusted provider text", { status: 403 });
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].addEventListener("message", event => {
        if (typeof event.data !== "string" || !event.data.includes("Path:ssml")) return;
        ssml = event.data;
        const header = new TextEncoder().encode("Content-Type:audio/mpeg\r\nPath:audio\r\n");
        const frame = new Uint8Array(2 + header.length + audio.length);
        frame[0] = header.length >> 8; frame[1] = header.length & 255;
        frame.set(header, 2); frame.set(audio, 2 + header.length);
        pair[1].send(frame.buffer);
        pair[1].send("Path:turn.end\r\n\r\n{}");
      });
      return new WorkerResponse(null, { status: 101, webSocket: pair[0] });
    },
  });
  const post = (path, body, host = origin, requestOrigin = origin) => mf.dispatchFetch(host + path, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    const response = await post("/api/tts", { text: "A < B & C", voice: "en-US-JennyNeural" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
    assert.match(ssml, /name='en-US-JennyNeural'/);
    assert.match(ssml, /A &lt; B &amp; C/);
    mode = "refuse";
    const refused = await post("/api/tts", { text: "Test" });
    assert.equal(refused.status, 502);
    assert.deepEqual(await refused.json(), { error: "Voice engine refused the connection (403)." });
    const beforeGates = calls.length;
    assert.equal((await post("/api/tts", { text: "Test" }, "https://ember-claude-proxy.brady-9d1.workers.dev")).status, 404);
    assert.equal((await post("/api/tts", { text: "Test" }, origin, "https://wrong.example")).status, 403);
    assert.equal(calls.length, beforeGates);
    const chat = await post("/api/messages", { model: "claude-sonnet-4-6", max_tokens: 20,
      stream: false, messages: [{ role: "user", content: "Fixture prompt" }] });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).content[0].text, "Fixture reply.");
  } finally { await mf.dispose(); }
});
