import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceHandler } from "../server/iphone-voice.mjs";
import worker from "../proxy/cloudflare-worker.js";

const ORIGIN = "https://ember.baxstarfishing.com";
const ISSUER = "https://voice-test.cloudflareaccess.com";
const NOW = Date.UTC(2026, 9, 6, 12);
const KEY = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const JWK = { ...await crypto.subtle.exportKey("jwk", KEY.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
const CLAIMS = { type: "app", iss: ISSUER, aud: ["voice-audience"],
  common_name: "voice-client.access", iat: NOW / 1000 - 5, exp: NOW / 1000 + 60, sub: "" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
async function sign(claims = CLAIMS, header = { alg: "RS256", kid: "test-key" }) {
  const payload = `${b64(header)}.${b64(claims)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", KEY.privateKey, new TextEncoder().encode(payload));
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}
const TOKEN = await sign();
const responseJSON = (data, headers = {}) => new Response(JSON.stringify(data), {
  headers: { "content-type": "application/json", ...headers },
});
const answer = (text = "Ready, Brady. What do you need?", stop_reason = "end_turn") =>
  ({ content: [{ type: "text", text }], stop_reason });
function request(body = { text: "Hello Ember." }, options = {}) {
  return new Request(ORIGIN + "/api/voice", { method: "POST",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": TOKEN,
      "cf-access-client-id": "voice-client.access", "cf-access-client-secret": "test-phone-secret" },
    body: JSON.stringify(body), ...options });
}
function fixture({ api, fetcher, deadlines } = {}) {
  const calls = [], fetchCalls = [];
  const env = { EMBER_VOICE_ENABLED: "true", EMBER_ACCESS_TEAM_DOMAIN: ISSUER,
    EMBER_VOICE_AUD: "voice-audience", EMBER_VOICE_CLIENT_ID: "voice-client.access",
    EMBER_API: { fetch: async req => {
      calls.push(req.clone());
      if (api) return api(req);
      return req.url.endsWith("/api/messages") ? responseJSON(answer()) :
        new Response(new Uint8Array([73, 68, 51, 1, 2]), { headers: { "content-type": "audio/mpeg" } });
    } },
  };
  const handler = createVoiceHandler({ now: () => NOW, deadlines,
    fetch: async (...args) => { fetchCalls.push(args); return fetcher ? fetcher(...args) : responseJSON({ keys: [JWK] }); } });
  return { env, calls, fetchCalls, handler, run: (req = request(), overrides = {}) => handler({ request: req, env: { ...env, ...overrides } }) };
}

test("valid service identity produces audio using only fixed internal routes", async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.reply, "Ready, Brady. What do you need?");
  assert.equal(body.incomplete, false);
  assert.deepEqual(Buffer.from(body.audio_base64, "base64"), Buffer.from([73, 68, 51, 1, 2]));
  assert.deepEqual(f.calls.map(r => new URL(r.url).pathname), ["/api/messages", "/api/tts"]);
  for (const req of f.calls) {
    assert.deepEqual([...req.headers.keys()].sort(), ["content-type", "origin"]);
    assert.equal(req.headers.get("origin"), ORIGIN);
    assert.ok(!await req.clone().text().then(s => s.includes("test-phone-secret")));
  }
  const payload = await f.calls[0].json();
  assert.equal(payload.messages.at(-1).content, "Hello Ember.");
  assert.match(payload.messages[0].content, /READ ONLY/);
  assert.match(payload.messages[0].content, /October 6, 2026/);
  assert.match(payload.messages[0].content, /no previous conversation/);
  assert.equal(payload.max_tokens, 600);
  assert.equal(f.fetchCalls[0][0], ISSUER + "/cdn-cgi/access/certs");
  assert.equal(f.fetchCalls[0][1].redirect, "error");
});

test("disabled or unconfigured route never calls authentication or providers", async t => {
  for (const overrides of [{ EMBER_VOICE_ENABLED: undefined }, { EMBER_VOICE_ENABLED: "false" },
    { EMBER_VOICE_AUD: "" }, { EMBER_VOICE_CLIENT_ID: "" },
    { EMBER_ACCESS_TEAM_DOMAIN: "https://attacker.invalid" }]) {
    await t.test(JSON.stringify(overrides), async () => {
      const f = fixture();
      assert.equal((await f.run(request(), overrides)).status, 503);
      assert.equal(f.calls.length + f.fetchCalls.length, 0);
    });
  }
});

test("aliases, other paths, query strings and methods are denied", async t => {
  for (const target of ["https://preview.pages.dev/api/voice", "https://ember.example.workers.dev/api/voice",
    ORIGIN + "/api/messages", ORIGIN + "/api/voice/", ORIGIN + "/api/voice?url=https://attacker.invalid"]) {
    await t.test(target, async () => {
      const f = fixture();
      assert.equal((await f.run(new Request(target, { method: "POST" }))).status, 404);
      assert.equal(f.calls.length + f.fetchCalls.length, 0);
    });
  }
  const f = fixture();
  const response = await f.run(new Request(ORIGIN + "/api/voice"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("JWT claims bind access to the dedicated voice service identity", async t => {
  for (const change of [{ aud: ["other-app"] }, { common_name: "other-client.access" },
    { iss: "https://wrong.cloudflareaccess.com" }, { exp: NOW / 1000 },
    { exp: "99999999999" }, { iat: NOW / 1000 + 500 }, { nbf: NOW / 1000 + 500 },
    { type: "org" }, { common_name: undefined, email: "person@example.com" }]) {
    await t.test(JSON.stringify(change), async () => {
      const f = fixture();
      const token = await sign({ ...CLAIMS, ...change });
      const req = request(); req.headers.set("cf-access-jwt-assertion", token);
      assert.equal((await f.run(req)).status, 401);
      assert.equal(f.calls.length, 0);
    });
  }
});

test("untrusted, tampered, missing, and unsupported tokens are denied", async t => {
  const forged = TOKEN.split(".");
  forged[1] = b64({ ...CLAIMS, exp: CLAIMS.exp + 10 });
  for (const token of ["", "x.y.z", forged.join("."),
    await sign(CLAIMS, { alg: "none", kid: "test-key" }),
    await sign(CLAIMS, { alg: "RS256", kid: "test-key", crit: ["b64"] })]) {
    await t.test(token.slice(0, 18) || "empty", async () => {
      const f = fixture(); const req = request(); req.headers.set("cf-access-jwt-assertion", token);
      assert.equal((await f.run(req)).status, 401);
      assert.equal(f.calls.length, 0);
    });
  }
});

test("signing key rotation refreshes the public keys once", async () => {
  let count = 0;
  const f = fixture({ fetcher: async () => responseJSON({ keys: ++count === 1 ? [{ ...JWK, kid: "old-key" }] : [JWK] }) });
  assert.equal((await f.run()).status, 200);
  assert.equal(count, 2);
  assert.equal((await f.run()).status, 200);
  assert.equal(count, 2);
});

test("signing service failure fails closed without exposing diagnostics", async () => {
  const f = fixture({ fetcher: async () => { throw new Error("sensitive internal diagnostics"); } });
  const response = await f.run();
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /sensitive/);
  assert.equal(f.calls.length, 0);
});

test("empty, oversized and capability-expanding inputs never reach the Worker", async t => {
  for (const [body, status] of [[{ text: " " }, 400], [{ text: "a".repeat(2001) }, 413],
    [{ text: "Hi", model: "other" }, 400], [{ text: "Hi", url: "https://attacker.invalid" }, 400],
    [{ text: "Hi", history: [] }, 400], [[], 400], [{ text: "😀".repeat(5000) }, 413]]) {
    await t.test(String(status) + JSON.stringify(body).slice(0, 30), async () => {
      const f = fixture(); assert.equal((await f.run(request(body))).status, status);
      assert.equal(f.calls.length, 0);
    });
  }
  const f = fixture();
  assert.equal((await f.run(request({}, { body: "not-json" }))).status, 400);
  const wrongType = request(); wrongType.headers.set("content-type", "text/plain");
  assert.equal((await f.run(wrongType)).status, 415);
});

test("provider errors do not leak raw data and are not retried by the adapter", async () => {
  const f = fixture({ api: async () => new Response("private provider details", { status: 500 }) });
  const response = await f.run();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private provider/);
  assert.equal(f.calls.length, 1);
});

test("missing assistant answer is a visible failure", async () => {
  const f = fixture({ api: async () => responseJSON({ content: [{ type: "tool_result", text: "do not speak this" }] }) });
  const response = await f.run();
  assert.equal(response.status, 502);
  assert.equal(f.calls.length, 1);
});

test("connector degradation and incomplete replies are disclosed in speech", async () => {
  const f = fixture({ api: async req => req.url.endsWith("/api/messages") ?
    responseJSON(answer("I can't see your calendar right now.", "max_tokens"), { "x-ember-connectors": "degraded" }) :
    new Response("voice offline", { status: 503 }) });
  const body = await (await f.run()).json();
  assert.equal(body.incomplete, true);
  assert.match(body.speech, /^Live inbox and calendar access was unavailable/);
  assert.match(body.speech, /reply is incomplete/);
  assert.equal(body.audio_base64, "");
  assert.match(body.warnings.at(-1), /iPhone voice/);
});

test("long answer stays complete on screen and spoken excerpt is labeled", async () => {
  const full = "This is a long answer. ".repeat(110);
  const f = fixture({ api: async req => req.url.endsWith("/api/messages") ? responseJSON(answer(full)) : new Response("", { status: 503 }) });
  const body = await (await f.run()).json();
  assert.equal(body.reply, full.trim());
  assert.ok(body.speech.length <= 1000);
  assert.match(body.speech, /rest of the reply is on screen/);
});

test("chat timeout aborts once and returns within the deadline", async () => {
  let signal;
  const f = fixture({ deadlines: { auth: 1000, chat: 20, tts: 20 }, api: req => {
    signal = req.signal; return new Promise(() => {});
  } });
  const response = await f.run();
  assert.equal(response.status, 504);
  assert.equal(signal.aborted, true);
  assert.equal(f.calls.length, 1);
});

test("TTS body timeout returns text for native speech fallback", async () => {
  const f = fixture({ deadlines: { auth: 1000, chat: 1000, tts: 20 }, api: async req =>
    req.url.endsWith("/api/messages") ? responseJSON(answer()) :
      new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "audio/mpeg" } }) });
  const response = await f.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.audio_base64, "");
  assert.ok(body.speech);
});

test("adapter payload passes the real Worker's canonical and read-only enforcement", async () => {
  let providerPayload;
  const f = fixture({ api: async req => {
    if (req.url.endsWith("/api/tts")) return new Response("offline", { status: 503 });
    return worker.fetch(req, { ANTHROPIC_API_KEY: "test-provider-key", ALLOWED_ORIGINS: ORIGIN,
      MCP_TOKEN_QUO: "test-quo", MCP_TOKEN_GMAIL: "test-gmail", MCP_TOKEN_CALENDAR: "test-calendar" }, {}, {
      fetch: async (url, options) => {
        assert.equal(String(url), "https://api.anthropic.com/v1/messages");
        providerPayload = JSON.parse(options.body);
        assert.doesNotMatch(JSON.stringify(options), /test-phone-secret|voice-client/);
        return responseJSON(answer("Test reply."));
      }, now: () => NOW,
    });
  } });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, "Test reply.");
  assert.deepEqual(providerPayload.mcp_servers.map(s => s.name), ["quo", "gmail", "calendar"]);
  assert.ok(providerPayload.tools.length === 3);
  assert.doesNotMatch(JSON.stringify(providerPayload.tools), /send_message|create_event|create_task/);
});
