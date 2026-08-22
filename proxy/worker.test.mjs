/**
 * Worker tests — run with: node proxy/worker.test.mjs
 *
 * No deps and no network: every outbound call goes through a stubbed fetch
 * injected via the fourth `deps` argument, so the OAuth handshake, the token
 * refresh, and the connector-degrade path are all exercised offline.
 */
import worker from "./cloudflare-worker.js";

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

const ORIGIN = "https://ember.baxstarfishing.com";
const baseEnv = {
  ANTHROPIC_API_KEY: "sk-test",
  ALLOWED_ORIGINS: ORIGIN,
  OAUTH_STATE_SECRET: "a-long-random-signing-secret",
  OAUTH_REDIRECT_URI: "https://proxy.example.workers.dev/oauth/callback",
  GOOGLE_CLIENT_ID: "goog-client",
  GOOGLE_CLIENT_SECRET: "goog-secret",
};

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Records every outbound call so assertions can inspect what was sent.
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? String(init.body) : null });
    for (const [match, handler] of routes) {
      if (String(url).includes(match)) return typeof handler === "function" ? handler(init) : handler;
    }
    throw new Error("unstubbed fetch: " + url);
  };
  fn.calls = calls;
  return fn;
}

const post = (body, headers = {}) =>
  new Request("https://proxy.example.workers.dev/", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const chat = (extra = {}) => ({ model: "claude-opus-5", max_tokens: 500, messages: [], ...extra });

// --- OAuth start ----------------------------------------------------------

{
  const f = stubFetch([]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=google"),
    baseEnv, {}, { fetch: f }
  );
  const loc = new URL(res.headers.get("Location") || "https://x.invalid");
  const cookie = res.headers.get("Set-Cookie") || "";
  check("google start redirects with PKCE S256", res.status === 302 && loc.searchParams.get("code_challenge_method") === "S256" && !!loc.searchParams.get("code_challenge"));
  check("google start asks for offline + consent", loc.searchParams.get("access_type") === "offline" && loc.searchParams.get("prompt") === "consent",
    "without both, Google returns no refresh token on repeat consent");
  check("google start sends the three scopes", /gmail.modify/.test(loc.searchParams.get("scope") || "") && /auth\/calendar/.test(loc.searchParams.get("scope") || "") && /auth\/drive/.test(loc.searchParams.get("scope") || ""));
  check("state cookie is HttpOnly+Secure+SameSite and scoped to /oauth", /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie) && /Path=\/oauth/.test(cookie));
  // The point of PKCE: the redirect carries only the hash, never the secret.
  // Recover the verifier from the (signed but not encrypted) cookie and prove
  // the challenge really is its SHA-256 and that it is nowhere in the URL.
  const sealedVal = decodeURIComponent(cookie.split("=").slice(1).join("="));
  const payload = JSON.parse(Buffer.from(sealedVal.split(".")[0], "base64url").toString());
  const expected = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.v))
  ).toString("base64url");
  check("challenge is the SHA-256 of the stored verifier", loc.searchParams.get("code_challenge") === expected);
  check("verifier itself never appears in the redirect URL", !String(loc).includes(payload.v));
}

{
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=nope"),
    baseEnv, {}, { fetch: stubFetch([]) }
  );
  check("unknown provider is refused", res.status === 400);
}

{
  const { OAUTH_STATE_SECRET, ...noSecret } = baseEnv;
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=google"),
    noSecret, {}, { fetch: stubFetch([]) }
  );
  check("missing OAUTH_STATE_SECRET is a clear 500, not a broken redirect", res.status === 500);
}

// Quo: dynamic registration on first run.
{
  const f = stubFetch([
    [".well-known", jsonRes({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token", registration_endpoint: "https://mcp.quo.com/register" })],
    ["/register", jsonRes({ client_id: "quo-generated-id" })],
  ]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=quo"),
    baseEnv, {}, { fetch: f }
  );
  const loc = new URL(res.headers.get("Location") || "https://x.invalid");
  const reg = f.calls.find((c) => c.url.includes("/register"));
  check("quo discovers then registers a client", res.status === 302 && loc.searchParams.get("client_id") === "quo-generated-id");
  check("quo registers as a public client (auth method none)", JSON.parse(reg.body).token_endpoint_auth_method === "none");
  check("quo requests the three declared scopes", (loc.searchParams.get("scope") || "") === "read:conversations write:contacts read:account");
}

// Quo: registration skipped once QUO_CLIENT_ID is set.
{
  const f = stubFetch([[".well-known", jsonRes({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token" })]]);
  await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=quo"),
    { ...baseEnv, QUO_CLIENT_ID: "already-registered" }, {}, { fetch: f }
  );
  check("quo skips re-registration when QUO_CLIENT_ID is set", !f.calls.some((c) => c.url.includes("/register")));
}

// --- OAuth callback -------------------------------------------------------

// Drive a real start to get a genuinely signed cookie, then complete it.
async function startAndCookie(provider, env = baseEnv, f = stubFetch([])) {
  const res = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/start?p=${provider}`),
    env, {}, { fetch: f }
  );
  const cookie = (res.headers.get("Set-Cookie") || "").split(";")[0];
  const state = new URL(res.headers.get("Location")).searchParams.get("state");
  return { cookie, state };
}

{
  const { cookie, state } = await startAndCookie("google");
  const f = stubFetch([["oauth2.googleapis.com/token", jsonRes({ refresh_token: "RT-google-123", access_token: "AT", expires_in: 3600 })]]);
  const res = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: f }
  );
  const html = await res.text();
  const sent = new URLSearchParams(f.calls[0].body);
  check("callback exchanges the code with the stored verifier", res.status === 200 && sent.get("grant_type") === "authorization_code" && !!sent.get("code_verifier"));
  check("google exchange sends the client secret", sent.get("client_secret") === "goog-secret");
  check("success page shows the refresh token", html.includes("RT-google-123"));
  check("success page names all three Google secrets", html.includes("MCP_REFRESH_GMAIL") && html.includes("MCP_REFRESH_CALENDAR") && html.includes("MCP_REFRESH_GDRIVE"));
}

{
  const { cookie } = await startAndCookie("google");
  const f = stubFetch([["token", jsonRes({ refresh_token: "should-not-happen" })]]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/callback?code=abc&state=WRONG", { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: f }
  );
  check("state mismatch is refused before any exchange", res.status === 400 && f.calls.length === 0,
    "a forged callback must not reach the token endpoint");
}

{
  const f = stubFetch([["token", jsonRes({ refresh_token: "nope" })]]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/callback?code=abc&state=anything"),
    baseEnv, {}, { fetch: f }
  );
  check("callback with no cookie is refused", res.status === 400 && f.calls.length === 0);
}

{
  // Tampered signature: flip a character in the cookie body.
  const { cookie, state } = await startAndCookie("google");
  const [name, val] = cookie.split("=");
  const tampered = `${name}=${val[0] === "A" ? "B" : "A"}${val.slice(1)}`;
  const f = stubFetch([["token", jsonRes({ refresh_token: "nope" })]]);
  const res = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: tampered } }),
    baseEnv, {}, { fetch: f }
  );
  check("tampered state cookie is rejected", res.status === 400 && f.calls.length === 0);
}

{
  const { cookie, state } = await startAndCookie("google");
  const f = stubFetch([["token", jsonRes({ access_token: "AT-only", expires_in: 3600 })]]);
  const res = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: f }
  );
  const html = await res.text();
  check("a response without a refresh token explains how to fix it", res.status === 400 && /revoke/i.test(html),
    "Google silently omits refresh_token on repeat consent");
}

{
  const { cookie, state } = await startAndCookie("google");
  const f = stubFetch([["token", jsonRes({ error: "invalid_grant", error_description: "Bad code" }, 400)]]);
  const res = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: f }
  );
  check("provider error is surfaced, not swallowed", res.status === 400 && (await res.text()).includes("Bad code"));
}

// --- per-request token refresh --------------------------------------------

{
  let clock = 1_000_000;
  const f = stubFetch([
    ["oauth2.googleapis.com/token", jsonRes({ access_token: "AT-fresh", expires_in: 3600 })],
    ["api.anthropic.com", jsonRes({ ok: true })],
  ]);
  const env = { ...baseEnv, MCP_REFRESH_GMAIL: "RT-gmail" };
  const req = () => worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }] })), env, {}, { fetch: f, now: () => clock });

  await req();
  const upstream = JSON.parse(f.calls.find((c) => c.url.includes("anthropic")).body);
  check("refresh token becomes an injected access token", upstream.mcp_servers[0].authorization_token === "AT-fresh");

  const before = f.calls.filter((c) => c.url.includes("googleapis")).length;
  await req();
  check("second request reuses the cached token", f.calls.filter((c) => c.url.includes("googleapis")).length === before,
    "isolates are reused; refreshing per request would be a round trip each time");

  clock += 3600 * 1000;
  await req();
  check("expired cache refreshes again", f.calls.filter((c) => c.url.includes("googleapis")).length > before);
}

{
  const f = stubFetch([
    ["oauth2.googleapis.com/token", jsonRes({ error: "invalid_grant" }, 400)],
    ["api.anthropic.com", jsonRes({ ok: true })],
  ]);
  const env = { ...baseEnv, MCP_REFRESH_GMAIL: "RT-dead", MCP_TOKEN_CALENDAR: "static-cal" };
  await worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }, { name: "calendar", url: "https://y" }] })), env, {}, { fetch: f });
  const upstream = JSON.parse(f.calls.find((c) => c.url.includes("anthropic")).body);
  check("a connector whose refresh fails is dropped, not forwarded unauthorized", !upstream.mcp_servers.some((s) => s.name === "gmail"),
    "forwarding it would make the API reject the whole request");
  check("healthy connectors survive a sibling's failure", upstream.mcp_servers.some((s) => s.name === "calendar" && s.authorization_token === "static-cal"));
}

{
  const f = stubFetch([
    ["oauth2.googleapis.com/token", jsonRes({ access_token: "AT-fresh", expires_in: 3600 })],
    ["api.anthropic.com", jsonRes({ ok: true })],
  ]);
  const env = { ...baseEnv, MCP_REFRESH_GMAIL: "RT", MCP_TOKEN_GMAIL: "static-should-lose" };
  await worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }] })), env, {}, { fetch: f });
  const upstream = JSON.parse(f.calls.find((c) => c.url.includes("anthropic")).body);
  check("a refreshed token beats a stale static one", upstream.mcp_servers[0].authorization_token === "AT-fresh");
}

// --- guarantees the earlier blocks established ----------------------------

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }),
    baseEnv, {}, { fetch: f }
  );
  check("origin allowlist still refuses unknown origins", res.status === 403 && f.calls.length === 0);
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  const res = await worker.fetch(post(chat({ model: "gpt-4" })), baseEnv, {}, { fetch: f });
  check("model allowlist still holds", res.status === 400 && f.calls.length === 0);
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  await worker.fetch(post(chat({ max_tokens: 999999 })), baseEnv, {}, { fetch: f });
  check("max_tokens cap still holds", JSON.parse(f.calls[0].body).max_tokens === 4096);
}

{
  let n = 0;
  const f = stubFetch([
    ["api.anthropic.com", () => {
      n++;
      return n === 1
        ? jsonRes({ error: { message: "MCP server auth failed for gmail" } }, 400)
        : jsonRes({ ok: true });
    }],
  ]);
  const env = { ...baseEnv, MCP_TOKEN_GMAIL: "stale" };
  const res = await worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }] })), env, {}, { fetch: f });
  check("block 2 degrade path intact: chat survives a dead connector", res.status === 200 && res.headers.get("x-ember-connectors") === "degraded");
  check("retry drops connectors and the beta header", !JSON.parse(f.calls[1].body).mcp_servers);
  check("degraded header is exposed cross-origin, not just set", (res.headers.get("access-control-expose-headers") || "").includes("x-ember-connectors"));
}

{
  // Live failure, 2026-08: Anthropic's real error text is "Error while communicating
  // with MCP server." — no "auth" substring. A guard requiring both words never
  // fires on it, so a single dead connector took plain chat down with it, which is
  // the exact failure this retry exists to prevent. Regression-locked here because
  // the previous test's fixture text happened to contain "auth" and passed either way.
  let n = 0;
  const f = stubFetch([
    ["api.anthropic.com", () => {
      n++;
      return n === 1
        ? jsonRes({ error: { message: "Error while communicating with MCP server." } }, 400)
        : jsonRes({ ok: true });
    }],
  ]);
  const env = { ...baseEnv, MCP_TOKEN_GMAIL: "stale" };
  const res = await worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }] })), env, {}, { fetch: f });
  check("degrades on Anthropic's real error text, which never mentions auth", res.status === 200 && res.headers.get("x-ember-connectors") === "degraded");
}

{
  const f = stubFetch([]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/", { method: "GET", headers: { Origin: ORIGIN } }),
    baseEnv, {}, { fetch: f }
  );
  check("non-OAuth GET is still refused", res.status === 405);
}

// --- /tts: the natural voice ----------------------------------------------
//
// The Edge synth speaks WebSocket, so the stub fetch returns a fake upgraded
// socket: on receiving the SSML frame it emits two binary audio frames in the
// real wire format (2-byte big-endian header length, then the header, then MP3
// payload) and a turn.end text frame.

function edgeFrame(headerText, payload) {
  const h = new TextEncoder().encode(headerText);
  const p = new TextEncoder().encode(payload);
  const buf = new Uint8Array(2 + h.length + p.length);
  buf[0] = h.length >> 8;
  buf[1] = h.length & 0xff;
  buf.set(h, 2);
  buf.set(p, 2 + h.length);
  return buf.buffer;
}

function fakeEdgeSocket(opts = {}) {
  const listeners = {};
  const sent = [];
  const emit = (data) => (listeners.message || []).forEach((fn) => fn({ data }));
  const sock = {
    sent,
    accepted: false,
    closed: false,
    accept() { this.accepted = true; },
    close() { this.closed = true; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    send(frame) {
      sent.push(String(frame));
      if (!String(frame).includes("Path:ssml")) return;
      queueMicrotask(() => {
        if (!opts.silent) {
          emit(edgeFrame("X-RequestId:x\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n", "MP3A"));
          emit(edgeFrame("X-RequestId:x\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n", "MP3B"));
          // Metadata frames ride the same socket — they must not land in the audio.
          emit(edgeFrame("X-RequestId:x\r\nPath:audio.metadata\r\n", "{\"Metadata\":[]}"));
        }
        emit("X-RequestId:x\r\nPath:turn.end\r\n\r\n{}");
      });
    },
  };
  return sock;
}

const ttsPost = (body, headers = {}) =>
  new Request("https://proxy.example.workers.dev/tts", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

{
  const sock = fakeEdgeSocket();
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  const res = await worker.fetch(ttsPost({ text: "Hey Brady.", voice: "en-US-JennyNeural" }), baseEnv, {}, { fetch: f, now: () => 1755840000000 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const audio = new TextDecoder().decode(bytes);
  check("tts returns the concatenated audio frames as audio/mpeg", res.status === 200 && res.headers.get("Content-Type") === "audio/mpeg" && audio === "MP3AMP3B",
    "got " + res.status + " " + JSON.stringify(audio));
  check("tts response carries CORS for the allowed origin", res.headers.get("Access-Control-Allow-Origin") === ORIGIN);
  check("tts closes the synth socket when the turn ends", sock.closed);

  const call = f.calls[0];
  const u = new URL(call.url);
  check("tts upgrade asks for a websocket with the Edge disguise",
    call.init.headers["Upgrade"] === "websocket" && /Edg\/140/.test(call.init.headers["User-Agent"] || "") &&
    (call.init.headers["Origin"] || "").startsWith("chrome-extension://") && /Microsoft Edge/.test(call.init.headers["sec-ch-ua"] || ""),
    "a Chromium-shaped request without these gets an empty-body 403 (probed live 2026-08-22)");
  // Pinned from the live handshake that produced audible MP3 on 2026-08-22.
  // If the ticks math regresses (seconds vs ticks, missing 5-min floor), this
  // catches it offline instead of as a mystery 403 in production.
  check("tts Sec-MS-GEC is the pinned hash for the fixed clock",
    u.searchParams.get("Sec-MS-GEC") === "2306AEBD08A72D452BD975BCC36E7B41335FE42E975869D2C28FAD6F70998FC0" &&
    u.searchParams.get("Sec-MS-GEC-Version") === "1-140.0.3485.14" &&
    u.searchParams.get("TrustedClientToken") === "6A5AA1D4EAFF4E9FB37E23D68491D6F4");

  const ssml = sock.sent.find((s) => s.includes("Path:ssml")) || "";
  const config = sock.sent.find((s) => s.includes("Path:speech.config")) || "";
  check("tts requests mp3 output and the asked-for voice",
    /audio-24khz-48kbitrate-mono-mp3/.test(config) && /name='en-US-JennyNeural'/.test(ssml));
}

{
  const sock = fakeEdgeSocket();
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  await worker.fetch(ttsPost({ text: "Bass < 5 lbs & \"hot\" bite, Brady's spot", voice: "en-US-GuyNeural" }), baseEnv, {}, { fetch: f, now: () => 1755840000000 });
  const ssml = sock.sent.find((s) => s.includes("Path:ssml")) || "";
  check("tts escapes SSML metacharacters in the spoken text",
    ssml.includes("Bass &lt; 5 lbs &amp; &quot;hot&quot; bite, Brady&apos;s spot") && !/<\s*5/.test(ssml),
    "unescaped text would let a spoken reply inject markup into the synth");
  check("tts honors a voice from the allowlist", /name='en-US-GuyNeural'/.test(ssml));
}

{
  const sock = fakeEdgeSocket();
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  await worker.fetch(ttsPost({ text: "hi", voice: "en-US-SomethingElseNeural" }), baseEnv, {}, { fetch: f, now: () => 1755840000000 });
  const ssml = sock.sent.find((s) => s.includes("Path:ssml")) || "";
  check("tts falls back to the default voice off the allowlist", /name='en-US-JennyNeural'/.test(ssml),
    "an open voice field would let callers probe the whole catalog through us");
}

{
  const res = await worker.fetch(ttsPost({ text: "hi" }, { Origin: "https://evil.example" }), baseEnv, {}, { fetch: stubFetch([]) });
  check("tts is behind the same origin gate as chat", res.status === 403);
}

{
  const res = await worker.fetch(ttsPost({ text: "" }), baseEnv, {}, { fetch: stubFetch([]) });
  const res2 = await worker.fetch(ttsPost({ text: "x".repeat(1001) }), baseEnv, {}, { fetch: stubFetch([]) });
  check("tts refuses empty and oversized text", res.status === 400 && res2.status === 400);
}

{
  const f = stubFetch([["speech.platform.bing.com", { status: 403, webSocket: null }]]);
  const res = await worker.fetch(ttsPost({ text: "hi" }), baseEnv, {}, { fetch: f, now: () => 1755840000000 });
  check("tts surfaces a refused upgrade as 502, not a hang", res.status === 502);
}

{
  const sock = fakeEdgeSocket({ silent: true });
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  const res = await worker.fetch(ttsPost({ text: "hi" }), baseEnv, {}, { fetch: f, now: () => 1755840000000 });
  check("tts with a turn that produced no audio is 502, so the app falls back", res.status === 502);
}

{
  const { ANTHROPIC_API_KEY, ...noKey } = baseEnv;
  const sock = fakeEdgeSocket();
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  const res = await worker.fetch(ttsPost({ text: "hi" }), noKey, {}, { fetch: f, now: () => 1755840000000 });
  check("tts works without an Anthropic key — it never touches the API", res.status === 200);
}

// --- report ---------------------------------------------------------------

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
