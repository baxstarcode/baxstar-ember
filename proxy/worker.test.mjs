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
const API_ORIGIN = ORIGIN;
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
  new Request(`${API_ORIGIN}/api/messages`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const chat = (extra = {}) => ({ model: "claude-opus-5", max_tokens: 500, messages: [{ role: "user", content: "Hello Ember." }], ...extra });

const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/AAAA";
const outbox = (extra = {}) => ({
  source: "ember-caption-studio",
  caption: "A good day on the water. #getyourbassingear",
  captionWithHandles: "A good day on the water. #getyourbassingear @mercurymarine",
  images: [JPEG_DATA_URL],
  mimeType: "image/jpeg",
  ...extra,
});

const postAt = (path, body, headers = {}) =>
  new Request(API_ORIGIN + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

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
  const scopes = new Set((loc.searchParams.get("scope") || "").split(/\s+/).filter(Boolean));
  const expectedScopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ];
  check("google start requests exactly the read-only scopes", scopes.size === expectedScopes.length && expectedScopes.every((scope) => scopes.has(scope)));
  check("google start never requests broad write scopes", !["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive"].some((scope) => scopes.has(scope)));
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
  check("quo requests only read scopes", (loc.searchParams.get("scope") || "") === "read:conversations read:account");
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

// OAuth HTML contains provider-controlled strings and, on success, secrets.
// Exercise each dynamic source instead of trusting one escaping helper test.
{
  const hostile = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;';
  const f = stubFetch([]);
  const denied = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/callback?error=" + encodeURIComponent(hostile)),
    baseEnv, {}, { fetch: f }
  );
  const deniedHtml = await denied.text();
  check("OAuth query errors are escaped before rendering", denied.status === 400 && deniedHtml.includes(escaped) && !deniedHtml.includes(hostile) && f.calls.length === 0);
  check("OAuth error pages are never cached", denied.headers.get("Cache-Control") === "no-store");

  for (const field of ["error", "error_description"]) {
    const { cookie, state } = await startAndCookie("google");
    const res = await worker.fetch(
      new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
      baseEnv, {}, { fetch: stubFetch([["token", jsonRes({ [field]: hostile }, 400)]]) }
    );
    const html = await res.text();
    check(`OAuth provider ${field} is escaped`, res.status === 400 && html.includes(escaped) && !html.includes(hostile));
  }

  const failedStart = await worker.fetch(
    new Request("https://proxy.example.workers.dev/oauth/start?p=quo"), baseEnv, {},
    { fetch: async () => { throw new Error(hostile); } }
  );
  check("Quo setup exception is escaped", failedStart.status === 502 && (await failedStart.text()).includes(escaped));

  const discovery = () => jsonRes({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token", registration_endpoint: "https://mcp.quo.com/register" });
  const registered = stubFetch([[".well-known", discovery], ["/register", () => jsonRes({ client_id: hostile })]]);
  const { cookie, state } = await startAndCookie("quo", baseEnv, registered);
  const success = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: stubFetch([
      [".well-known", discovery], ["/register", () => jsonRes({ client_id: hostile })],
      ["/token", () => jsonRes({ refresh_token: hostile })],
    ]) }
  );
  const successHtml = await success.text();
  check("OAuth refresh token and registered client ID render as text", success.status === 200 && successHtml.split(escaped).length === 3 && !successHtml.includes(hostile));
  check("OAuth token pages are never cached", success.headers.get("Cache-Control") === "no-store" && success.headers.get("X-Content-Type-Options") === "nosniff");

  const failedCallback = await worker.fetch(
    new Request(`https://proxy.example.workers.dev/oauth/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }),
    baseEnv, {}, { fetch: async () => { throw new Error(hostile); } }
  );
  check("Quo callback exception is escaped", failedCallback.status === 502 && (await failedCallback.text()).includes(escaped));
}

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
  const res = await worker.fetch(post(chat({ mcp_servers: [{ name: "gmail", url: "https://x" }, { name: "calendar", url: "https://y" }] })), env, {}, { fetch: f });
  const upstream = JSON.parse(f.calls.find((c) => c.url.includes("anthropic")).body);
  check("a connector whose refresh fails is dropped, not forwarded unauthorized", !upstream.mcp_servers.some((s) => s.name === "gmail"),
    "forwarding it would make the API reject the whole request");
  check("healthy connectors survive a sibling's failure", upstream.mcp_servers.some((s) => s.name === "calendar" && s.authorization_token === "static-cal"));
  check("only credentialed servers receive toolsets", upstream.tools.length === 1 && upstream.tools[0].mcp_server_name === "calendar" && upstream.tools[0].default_config.enabled === false);
  check("a missing requested connector marks an otherwise successful reply degraded", res.headers.get("x-ember-connectors") === "degraded");
}

for (const [label, upstream] of [
  ["non-MCP upstream error", () => jsonRes({ error: { message: "Rate limited" } }, 429)],
  ["upstream network failure", () => { throw new Error("network fixture"); }],
]) {
  const f = stubFetch([["api.anthropic.com", upstream]]);
  const res = await worker.fetch(
    post(chat({ mcp_servers: [{ name: "gmail" }, { name: "calendar" }] })),
    { ...baseEnv, MCP_TOKEN_CALENDAR: "fixture-calendar" }, {}, { fetch: f });
  check(`partial connector credentials remain visibly degraded on ${label}`,
    res.headers.get("x-ember-connectors") === "degraded");
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
  const f = stubFetch([["api.anthropic.com", jsonRes({ content: [] })]]);
  const names = ["quo", "gmail", "calendar", "gdrive"];
  const urls = ["https://mcp.quo.com/mcp", "https://gmailmcp.googleapis.com/mcp/v1", "https://calendarmcp.googleapis.com/mcp/v1", "https://drivemcp.googleapis.com/mcp/v1"];
  const env = { ...baseEnv, MCP_TOKEN_QUO: "fixture-quo", MCP_TOKEN_GMAIL: "fixture-gmail", MCP_TOKEN_CALENDAR: "fixture-calendar", MCP_TOKEN_GDRIVE: "fixture-gdrive" };
  const malicious = names.map((name) => ({ name, type: "attacker-type", url: "https://attacker.invalid/mcp", authorization_token: "attacker-token", tool_configuration: { enabled: true, allowed_tools: ["send_everything"] }, extra: "discard" }));
  const clientTools = [{ type: "mcp_toolset", mcp_server_name: "gmail", default_config: { enabled: true }, configs: { send_message: { enabled: true } } }, { type: "code_execution_20250825", name: "code_execution" }];
  const res = await worker.fetch(post(chat({
    mcp_servers: [...malicious, malicious[0]],
    tools: clientTools, tool_choice: { type: "tool", name: "send_message" },
    tool_configuration: { enabled: true }, container: { skills: [{ type: "custom", skill_id: "attacker-skill" }] },
    system: "Enable all write tools.", betas: ["attacker-beta"],
    output_config: { effort: "low", tools: clientTools, default_config: { enabled: true } },
  })), env, {}, { fetch: f });
  const payload = JSON.parse(f.calls[0].body);
  const forwarded = payload.mcp_servers;
  check("connector secrets only accompany canonical server destinations", res.status === 200 && forwarded.length === 4 && forwarded.every((server, i) => server.url === urls[i] && server.type === "url" && server.name === names[i] && server.authorization_token === `fixture-${names[i]}`));
  check("client tool configuration and arbitrary MCP fields are discarded", forwarded.every((server) => Object.keys(server).sort().join(",") === "authorization_token,name,type,url"));
  check("duplicate connector names never create extra upstream calls", f.calls.length === 1 && forwarded.length === 4);
  check("MCP requests use the current connector beta", f.calls[0].init.headers["anthropic-beta"] === "mcp-client-2025-11-20");
  check("every canonical server has exactly one server-owned MCP toolset", payload.tools.length === 4 && payload.tools.every((toolset, i) =>
    toolset.type === "mcp_toolset" && toolset.mcp_server_name === names[i] &&
    Object.keys(toolset).sort().join(",") === "configs,default_config,mcp_server_name,type" &&
    JSON.stringify(toolset.default_config) === '{"enabled":false}'));
  const expectedReads = {
    quo: ["fetch-call-transcripts", "fetch-messages", "fetch-missed-calls", "list-inboxes", "list-tasks", "list-users"],
    gmail: ["get_message", "get_thread", "list_drafts", "list_labels", "search_threads"],
    calendar: ["get_event", "list_calendars", "list_events", "search_events", "suggest_time"],
    gdrive: ["download_file_content", "get_file_metadata", "get_file_permissions", "list_recent_files", "read_file_content", "search_files"],
  };
  for (const toolset of payload.tools) {
    check(`${toolset.mcp_server_name} enables exactly the verified read tools`,
      JSON.stringify(Object.keys(toolset.configs).sort()) === JSON.stringify(expectedReads[toolset.mcp_server_name].sort()) &&
      Object.values(toolset.configs).every((config) => JSON.stringify(config) === '{"enabled":true}'));
  }
  const writes = ["create-task", "get-contact", "list-contacts", "create-contact", "update-contact", "send-message", "send_message", "create_draft", "create_label", "modify_message", "create_event", "update_event", "delete_event", "create_file", "copy_file", "update_file", "delete_file", "unknown_future_tool"];
  check("writes and newly advertised provider tools are disabled in ordinary chat", payload.tools.every((toolset) =>
    writes.every((name) => (toolset.configs[name]?.enabled ?? toolset.default_config.enabled) === false)));
  check("client capability escalation and nested output configs never reach Anthropic", Object.keys(payload).sort().join(",") === "max_tokens,mcp_servers,messages,model,output_config,tools" && JSON.stringify(payload.output_config) === '{"effort":"low"}');
}

for (const servers of [undefined, [], [{ name: "gmail" }]]) {
  const f = stubFetch([["api.anthropic.com", jsonRes({ content: [] })]]);
  const res = await worker.fetch(post(chat({ mcp_servers: servers, tools: [{ type: "mcp_toolset", mcp_server_name: "gmail", default_config: { enabled: true } }], tool_choice: { type: "any" }, authorization_token: "client-token" })), baseEnv, {}, { fetch: f });
  const payload = JSON.parse(f.calls[0].body);
  check(`no usable connector means no client tools or beta (${JSON.stringify(servers)})`, res.status === 200 && !payload.mcp_servers && !payload.tools && !payload.tool_choice && !payload.authorization_token && !f.calls[0].init.headers["anthropic-beta"]);
  if (servers?.some((server) => server.name === "gmail")) {
    check("an entirely missing requested connector is observable as degraded", res.headers.get("x-ember-connectors") === "degraded");
  }
}

for (const path of ["/", "/tts", "/connectors/status", "/outbox", "/unknown", "/api", "/api/messages/", "/api/tts/extra", "/api/outbox/", "/oauth/start"]) {
  const f = stubFetch([]);
  const res = await worker.fetch(postAt(path, chat()), baseEnv, {}, { fetch: f });
  check(`unknown POST route ${path} is refused before upstream work`, res.status === 404 && f.calls.length === 0);
}

for (const host of ["proxy.example.workers.dev", "proxy.example.workers.dev."]) {
  const f = stubFetch([]);
  const direct = await worker.fetch(
    new Request(`https://${host}/api/messages`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(chat()),
    }),
    baseEnv,
    {},
    { fetch: f }
  );
  check(`workers.dev host gate refuses direct API traffic (${host})`, direct.status === 404 && f.calls.length === 0);
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ content: [{ type: "text", text: "hello" }] })]]);
  const res = await worker.fetch(postAt("/api/messages", chat()), baseEnv, {}, { fetch: f });
  check("same-origin messages route preserves the existing request contract", res.status === 200 && f.calls.length === 1 && (await res.json()).content[0].text === "hello");
  const options = await worker.fetch(new Request(`${API_ORIGIN}/api/messages`, { method: "OPTIONS", headers: { Origin: ORIGIN } }), baseEnv, {}, { fetch: stubFetch([]) });
  check("known route still accepts allowed CORS preflight", options.status === 204);
}

// --- /outbox: server-owned Drive staging capability ----------------------

{
  const destination = "https://script.google.com/macros/s/server-owned-fixture/exec";
  const f = stubFetch([[destination, jsonRes({
    ok: true,
    folder: "private-folder-name-that-must-not-leak",
    images: ["private-drive-file.jpg"],
  })]]);
  const { ANTHROPIC_API_KEY, ...noAnthropic } = baseEnv;
  const res = await worker.fetch(postAt("/api/outbox", outbox({
    lockedTag: "#getyourbassingear",
    hashtagCount: 1,
    species: "Smallmouth Bass",
    lake: "Detroit Lake",
    postWindow: "4 PM CT",
    postAt: "2026-09-21T21:00:00.000Z",
    postTimeLocal: "16:00",
    sponsors: ["@mercurymarine"],
    clientTime: "2026-09-20T12:00:00.000Z",
    payloadVersion: 2,
    format: "post",
    surfaces: ["ig_feed", "ig_story"],
    storyImages: [JPEG_DATA_URL],
    token: "client-token-must-not-pass",
    url: "https://evil.example/collect",
    imageBase64: "client-second-image-must-not-pass",
    unknownCapability: { enabled: true },
  })), {
    ...noAnthropic,
    OUTBOX_URL: destination,
    OUTBOX_TOKEN: "server-token",
  }, {}, { fetch: f });
  const response = await res.json();
  const sent = JSON.parse(f.calls[0].body);

  check("same-origin outbox succeeds without an Anthropic key", res.status === 200 && response.ok === true && Object.keys(response).length === 1);
  check("outbox response is sanitized and never cached", res.headers.get("Cache-Control") === "no-store" && !JSON.stringify(response).includes("private-folder"));
  check("outbox calls only the server-owned Apps Script destination", f.calls.length === 1 && f.calls[0].url === destination);
  check("outbox uses the Apps Script text/plain redirect-follow contract",
    f.calls[0].init.method === "POST" && f.calls[0].init.headers["Content-Type"] === "text/plain;charset=utf-8" && f.calls[0].init.redirect === "follow");
  check("outbox strips JPEG data URL prefixes for the legacy Apps Script contract",
    JSON.stringify(sent.images) === JSON.stringify(["/9j/AAAA"]) && sent.imageBase64 === "/9j/AAAA" && sent.mimeType === "image/jpeg" && JSON.stringify(sent.storyImages) === JSON.stringify(["/9j/AAAA"]));
  check("outbox forwards only validated Caption Studio metadata",
    sent.source === "ember-caption-studio" && sent.lake === "Detroit Lake" && sent.hashtagCount === 1 && sent.format === "post" && sent.payloadVersion === 2 && sent.surfaces.length === 2);
  check("outbox replaces client capability fields with the server token",
    sent.token === "server-token" && !("url" in sent) && !("unknownCapability" in sent) && sent.imageBase64 !== "client-second-image-must-not-pass");
}

{
  const destination = "https://script.google.com/macros/s/server-owned-preflight/exec";
  const options = await worker.fetch(
    new Request(`${API_ORIGIN}/api/outbox`, { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: stubFetch([]) });
  check("outbox route accepts the allowed CORS preflight", options.status === 204);
}

for (const [label, configured] of [
  ["missing", undefined],
  ["non-HTTPS", "http://script.google.com/macros/s/fixture/exec"],
  ["wrong host", "https://evil.example/macros/s/fixture/exec"],
  ["lookalike host", "https://script.google.com.evil.example/macros/s/fixture/exec"],
  ["wrong path", "https://script.google.com/macros/s/fixture/dev"],
  ["query-bearing", "https://script.google.com/macros/s/fixture/exec?token=legacy"],
  ["credential-bearing", "https://user:pass@script.google.com/macros/s/fixture/exec"],
]) {
  const f = stubFetch([]);
  const env = { ...baseEnv };
  if (configured !== undefined) env.OUTBOX_URL = configured;
  const res = await worker.fetch(postAt("/api/outbox", outbox()), env, {}, { fetch: f });
  const response = await res.json();
  check(`outbox refuses ${label} server configuration without leaking it`,
    res.status === 503 && response.error === "Drive outbox unavailable." && !JSON.stringify(response).includes(String(configured)) && f.calls.length === 0);
}

for (const [label, body] of [
  ["wrong source", outbox({ source: "other-client" })],
  ["missing caption", outbox({ caption: undefined })],
  ["empty caption", outbox({ caption: "" })],
  ["numeric captionWithHandles", outbox({ captionWithHandles: 42 })],
  ["no images", outbox({ images: [] })],
  ["too many images", outbox({ images: Array(7).fill(JPEG_DATA_URL) })],
  ["raw base64 image", outbox({ images: ["/9j/AAAA"] })],
  ["PNG data URL", outbox({ images: ["data:image/png;base64,iVBORw0KGgo="] })],
  ["non-JPEG bytes under a JPEG label", outbox({ images: ["data:image/jpeg;base64,QUFBQQ=="] })],
  ["wrong mimeType", outbox({ mimeType: "image/png" })],
  ["oversized locked tag", outbox({ lockedTag: "x".repeat(129) })],
  ["unsafe hashtag count", outbox({ hashtagCount: 6 })],
  ["malformed sponsors", outbox({ sponsors: [42] })],
  ["unknown surface", outbox({ surfaces: ["ig_feed", "tiktok"] })],
  ["duplicate surface", outbox({ surfaces: ["ig_feed", "ig_feed"] })],
  ["malformed story image", outbox({ storyImages: ["/9j/AAAA"] })],
  ["unknown format", outbox({ format: "video" })],
  ["unknown payload version", outbox({ payloadVersion: 3 })],
]) {
  const destination = "https://script.google.com/macros/s/server-owned-invalid/exec";
  const f = stubFetch([[destination, jsonRes({ ok: true })]]);
  const res = await worker.fetch(postAt("/api/outbox", body), { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  check(`outbox validation rejects ${label} before Drive`, res.status === 400 && f.calls.length === 0);
}

for (const [label, response] of [
  ["HTTP rejection", jsonRes({ ok: false, error: "private upstream detail" }, 403)],
  ["logical rejection", jsonRes({ ok: false, error: "private upstream detail" })],
  ["non-JSON success", new Response("private upstream detail", { status: 200 })],
]) {
  const destination = "https://script.google.com/macros/s/server-owned-failure/exec";
  const f = stubFetch([[destination, response]]);
  const res = await worker.fetch(postAt("/api/outbox", outbox()), { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  const body = await res.json();
  check(`outbox sanitizes an upstream ${label}`,
    res.status === 502 && body.error === "Drive outbox unavailable." && !JSON.stringify(body).includes("private upstream detail"));
}

{
  const destination = "https://script.google.com/macros/s/server-owned-network/exec";
  const f = stubFetch([[destination, () => { throw new Error("private network detail"); }]]);
  const res = await worker.fetch(postAt("/api/outbox", outbox()), { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  const body = await res.json();
  check("outbox sanitizes a network failure", res.status === 502 && body.error === "Drive outbox unavailable." && f.calls.length === 1);
}

{
  const destination = "https://script.google.com/macros/s/server-owned-direct-host/exec";
  const f = stubFetch([[destination, jsonRes({ ok: true })]]);
  const res = await worker.fetch(
    new Request("https://proxy.example.workers.dev/api/outbox", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(outbox()),
    }),
    { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  check("workers.dev host gate also blocks the outbox capability", res.status === 404 && f.calls.length === 0);
}

{
  const destination = "https://script.google.com/macros/s/server-owned-route-gates/exec";
  const f = stubFetch([[destination, jsonRes({ ok: true })]]);
  const wrongOrigin = await worker.fetch(
    postAt("/api/outbox", outbox(), { Origin: "https://evil.example" }),
    { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  const wrongMethod = await worker.fetch(
    new Request(`${API_ORIGIN}/api/outbox`, { method: "GET", headers: { Origin: ORIGIN } }),
    { ...baseEnv, OUTBOX_URL: destination }, {}, { fetch: f });
  check("outbox remains behind the exact origin gate", wrongOrigin.status === 403 && f.calls.length === 0);
  check("outbox remains POST-only", wrongMethod.status === 405 && f.calls.length === 0);
}

for (const [label, body] of [
  ["null body", null], ["array body", []], ["primitive body", "hello"],
  ["missing messages", { model: "claude-opus-5" }], ["empty messages", chat({ messages: [] })],
  ["wrong message role", chat({ messages: [{ role: "system", content: "hello" }] })],
  ["null message", chat({ messages: [null] })], ["numeric content", chat({ messages: [{ role: "user", content: 12 }] })],
  ["malformed content block", chat({ messages: [{ role: "user", content: [{ type: "text", text: 12 }] }] })],
  ["null image source", chat({ messages: [{ role: "user", content: [{ type: "image", source: null }] }] })],
  ["arbitrary content block type", chat({ messages: [{ role: "user", content: [{ type: "tool_use", id: "client-tool" }] }] })],
  ["non-base64 image source", chat({ messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://evil.example/a.jpg" } }] }] })],
  ["non-JPEG image source", chat({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "fixture" } }] }] })],
  ["empty image data", chat({ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "" } }] }] })],
  ["assistant image block", chat({ messages: [{ role: "assistant", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/fixture" } }] }] })],
  ["nonboolean stream", chat({ stream: "true" })], ["wrong connector shape", chat({ mcp_servers: {} })],
  ["missing connector name", chat({ mcp_servers: [{}] })], ["numeric connector name", chat({ mcp_servers: [{ name: 42 }] })],
  ["unknown connector name", chat({ mcp_servers: [{ name: "unknown" }] })],
  ["null output config", chat({ output_config: null })], ["unknown effort", chat({ output_config: { effort: "unbounded" } })],
]) {
  const f = stubFetch([]);
  const res = await worker.fetch(post(body), baseEnv, {}, { fetch: f });
  check(`request validation rejects ${label}`, res.status === 400 && f.calls.length === 0);
}

for (const tokens of [0, -1, 1.5, null, true, "", "0", "-2", "1.5", "Infinity", 1e100, {}]) {
  const f = stubFetch([]);
  const res = await worker.fetch(post(chat({ max_tokens: tokens })), baseEnv, {}, { fetch: f });
  check(`max_tokens refuses ${JSON.stringify(tokens)}`, res.status === 400 && f.calls.length === 0);
}

{
  const f = stubFetch([["api.anthropic.com", () => jsonRes({ content: [] })]]);
  await worker.fetch(post(chat({ max_tokens: undefined })), baseEnv, {}, { fetch: f });
  await worker.fetch(post(chat({ max_tokens: "123" })), baseEnv, {}, { fetch: f });
  check("omitted and legacy numeric-string token budgets remain supported", JSON.parse(f.calls[0].body).max_tokens === 1000 && JSON.parse(f.calls[1].body).max_tokens === 123);
  const vision = [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/fixture" } }, { type: "text", text: "Analyze the photo." }] }];
  const res = await worker.fetch(post(chat({ messages: vision, output_config: { effort: "low" }, stream: false })), baseEnv, {}, { fetch: f });
  check("caption vision blocks and effort survive validation unchanged", res.status === 200 && JSON.stringify(JSON.parse(f.calls[2].body).messages) === JSON.stringify(vision) && JSON.parse(f.calls[2].body).output_config.effort === "low");
  check("caption requests remain tool-free and preserve non-streaming mode", !JSON.parse(f.calls[2].body).tools && JSON.parse(f.calls[2].body).stream === false && !f.calls[2].init.headers["anthropic-beta"]);
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ content: [] })]]);
  const messages = [{
    role: "user",
    authorization_token: "nested-client-token",
    tool_choice: { type: "any" },
    content: [
      { type: "text", text: "Analyze this.", cache_control: { type: "ephemeral" }, tool_choice: { type: "any" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/fixture", url: "https://evil.example", authorization_token: "nested-client-token" }, cache_control: { type: "ephemeral" } },
    ],
  }];
  const res = await worker.fetch(post(chat({ messages })), baseEnv, {}, { fetch: f });
  const forwarded = JSON.parse(f.calls[0].body).messages;
  check("nested message and content-block capability fields are canonicalized away",
    res.status === 200 &&
    Object.keys(forwarded[0]).sort().join(",") === "content,role" &&
    Object.keys(forwarded[0].content[0]).sort().join(",") === "text,type" &&
    Object.keys(forwarded[0].content[1]).sort().join(",") === "source,type" &&
    Object.keys(forwarded[0].content[1].source).sort().join(",") === "data,media_type,type" &&
    !JSON.stringify(forwarded).includes("nested-client-token") &&
    !JSON.stringify(forwarded).includes("evil.example"));
}

{
  const raw = JSON.stringify(chat({ messages: [{ role: "user", content: "é".repeat(2_700_000) }] }));
  const f = stubFetch([]);
  const res = await worker.fetch(new Request(`${API_ORIGIN}/api/messages`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": "1" }, body: raw,
  }), baseEnv, {}, { fetch: f });
  check("body limit counts actual UTF-8 bytes even with an understated length", raw.length < 5 * 1024 * 1024 && res.status === 413 && f.calls.length === 0);
}

{
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  const f = stubFetch([]);
  const res = await worker.fetch(new Request(`${API_ORIGIN}/api/messages`, {
    method: "POST", headers: { Origin: ORIGIN }, body, duplex: "half",
  }), baseEnv, {}, { fetch: f });
  check("oversized chunked input is cancelled without waiting for EOF", res.status === 413 && cancelled && f.calls.length === 0);
}

// An intentionally unfinished upstream proves the Worker returns the live body,
// including after connector degradation; buffering would wait for the terminal
// chunk and fail the first assertion. No actual provider/network is involved.
for (const degraded of [false, true]) {
  const encoder = new TextEncoder();
  const first = encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n');
  const last = encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  let source;
  const stream = new ReadableStream({ start(controller) { source = controller; controller.enqueue(first); } });
  const upstream = new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  let calls = 0;
  const f = stubFetch([["api.anthropic.com", () => {
    calls++;
    return degraded && calls === 1 ? jsonRes({ error: { message: "MCP server offline" } }, 400) : upstream;
  }]]);
  const pending = worker.fetch(post(chat({ stream: true, ...(degraded ? { mcp_servers: [{ name: "gmail" }] } : {}) })),
    { ...baseEnv, MCP_TOKEN_GMAIL: "fixture-stream" }, {}, { fetch: f });
  let timer;
  const early = await Promise.race([pending, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1000); })]);
  clearTimeout(timer);
  check(`${degraded ? "degraded" : "normal"} SSE returns before upstream completion`, !!early);
  const reader = early?.body.getReader();
  const initial = reader ? await reader.read() : null;
  source.enqueue(last); source.close();
  const res = early || await pending;
  const terminal = reader ? await reader.read() : null;
  const eof = reader ? await reader.read() : null;
  check(`${degraded ? "degraded" : "normal"} SSE preserves content type and exact event bytes`,
    res.headers.get("Content-Type") === "text/event-stream; charset=utf-8" && initial && Buffer.from(initial.value).equals(Buffer.from(first)) && terminal && Buffer.from(terminal.value).equals(Buffer.from(last)) && eof.done);
  if (reader) reader.releaseLock();
  check(`${degraded ? "degraded" : "normal"} SSE retains CORS and cache policy`, res.headers.get("Access-Control-Allow-Origin") === ORIGIN && res.headers.get("Cache-Control") === "no-store");
  if (degraded) check("degraded SSE remains observable and removes every connector capability", res.headers.get("x-ember-connectors") === "degraded" && res.headers.get("Access-Control-Expose-Headers").includes("x-ember-connectors") && !JSON.parse(f.calls[1].body).mcp_servers && !JSON.parse(f.calls[1].body).tools && !f.calls[1].init.headers["anthropic-beta"]);
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  const res = await worker.fetch(
    new Request(`${API_ORIGIN}/api/messages`, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }),
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
  check("max_tokens cap still holds", JSON.parse(f.calls[0].body).max_tokens === 16000);
}

for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  const res = await worker.fetch(post(chat({ model, output_config: { effort: "xhigh" } })), baseEnv, {}, { fetch: f });
  const sent = f.calls[0] ? JSON.parse(f.calls[0].body) : {};
  check(`${model} accepted with xhigh effort forwarded`,
    res.status === 200 && sent.model === model && sent.output_config?.effort === "xhigh");
}

{
  const f = stubFetch([["api.anthropic.com", jsonRes({ ok: true })]]);
  const res = await worker.fetch(post(chat({ output_config: { effort: "turbo" } })), baseEnv, {}, { fetch: f });
  check("unknown effort level still refused", res.status === 400 && f.calls.length === 0);
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
  check("retry drops connectors, toolsets, and the beta header", !JSON.parse(f.calls[1].body).mcp_servers && !JSON.parse(f.calls[1].body).tools && !f.calls[1].init.headers["anthropic-beta"]);
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
    new Request(`${API_ORIGIN}/api/messages`, { method: "GET", headers: { Origin: ORIGIN } }),
    baseEnv, {}, { fetch: f }
  );
  check("non-OAuth GET is still refused", res.status === 405);
}

// --- connector status: credential-only, no private-data lookup ------------

{
  const f = stubFetch([
    ["oauth2.googleapis.com/token", () => jsonRes({ access_token: "AT-status", expires_in: 3600 })],
  ]);
  const env = {
    ...baseEnv,
    MCP_REFRESH_GMAIL: "RT-status-gmail",
    MCP_REFRESH_CALENDAR: "RT-status-calendar",
    MCP_TOKEN_QUO: "AT-status-quo",
  };
  const res = await worker.fetch(
    new Request(`${API_ORIGIN}/api/connectors/status`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ connectors: ["quo", "gmail", "calendar", "gdrive"] }),
    }),
    env, {}, { fetch: f, now: () => 1_234_567 }
  );
  const body = await res.json();
  check("connector status verifies credentials without reading private data",
    res.status === 200 &&
    body.connectors.quo === "connected" &&
    body.connectors.gmail === "connected" &&
    body.connectors.calendar === "connected" &&
    body.connectors.gdrive === "offline",
    JSON.stringify(body));
  check("connector status never calls Anthropic or an MCP data endpoint",
    !f.calls.some((c) => c.url.includes("anthropic") || c.url.includes("/mcp")));
  check("connector status is origin-gated and never cached",
    res.headers.get("Access-Control-Allow-Origin") === ORIGIN &&
    res.headers.get("Cache-Control") === "no-store");
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
  new Request(`${API_ORIGIN}/api/tts`, {
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
    call.init.headers["Upgrade"] === "websocket" && /Edg\/143/.test(call.init.headers["User-Agent"] || "") &&
    (call.init.headers["Origin"] || "").startsWith("chrome-extension://") &&
    call.init.headers["Sec-WebSocket-Version"] === "13" &&
    call.init.headers["Accept-Encoding"] === "gzip, deflate, br, zstd",
    "the service silently changes its browser-shaped handshake");
  check("tts upgrade includes a fresh Edge MUID cookie",
    /^muid=[A-F0-9]{32};$/.test(call.init.headers["Cookie"] || ""),
    "the current service accepts the socket but returns no audio without MUID");
  // Pinned from the live handshake that produced audible MP3 on 2026-08-22.
  // If the ticks math regresses (seconds vs ticks, missing 5-min floor), this
  // catches it offline instead of as a mystery 403 in production.
  check("tts Sec-MS-GEC is the pinned hash for the fixed clock",
    u.searchParams.get("Sec-MS-GEC") === "2306AEBD08A72D452BD975BCC36E7B41335FE42E975869D2C28FAD6F70998FC0" &&
    u.searchParams.get("Sec-MS-GEC-Version") === "1-143.0.3650.75" &&
    u.searchParams.get("TrustedClientToken") === "6A5AA1D4EAFF4E9FB37E23D68491D6F4");

  const ssml = sock.sent.find((s) => s.includes("Path:ssml")) || "";
  const config = sock.sent.find((s) => s.includes("Path:speech.config")) || "";
  check("tts requests mp3 output and the asked-for voice",
    /audio-24khz-48kbitrate-mono-mp3/.test(config) && /name='en-US-JennyNeural'/.test(ssml));
  check("tts uses the Edge JavaScript timestamp wire format",
    config.includes("X-Timestamp:Fri Aug 22 2025 05:20:00 GMT+0000 (Coordinated Universal Time)") &&
    ssml.includes("X-Timestamp:Fri Aug 22 2025 05:20:00 GMT+0000 (Coordinated Universal Time)Z"),
    "ISO timestamps can negotiate successfully and still produce an empty turn");
  const connectionId = u.searchParams.get("ConnectionId") || "";
  const requestId = (ssml.match(/X-RequestId:([a-f0-9]+)/i) || [])[1] || "";
  check("tts uses distinct connection and request ids",
    connectionId.length === 32 && requestId.length === 32 && requestId !== connectionId);
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

{
  const sock = fakeEdgeSocket();
  const f = stubFetch([["speech.platform.bing.com", { status: 101, webSocket: sock }]]);
  const res = await worker.fetch(postAt("/api/tts", { text: "Alias check." }), baseEnv, {}, { fetch: f });
  check("same-origin TTS route returns audio", res.status === 200 && res.headers.get("Content-Type") === "audio/mpeg" && (await res.arrayBuffer()).byteLength > 0);
}

{
  const f = stubFetch([]);
  const res = await worker.fetch(postAt("/api/connectors/status", { connectors: ["gmail", "unknown", "gmail"] }),
    { ...baseEnv, MCP_TOKEN_GMAIL: "fixture-status" }, {}, { fetch: f });
  const body = await res.json();
  check("same-origin connector-status route stays credential-only", res.status === 200 && body.connectors.gmail === "connected" && Object.keys(body.connectors).length === 1 && f.calls.length === 0);
  const empty = await worker.fetch(new Request(`${API_ORIGIN}/api/connectors/status`, { method: "POST", headers: { Origin: ORIGIN } }), baseEnv, {}, { fetch: f });
  check("empty connector-status request still checks all four connectors", empty.status === 200 && Object.keys((await empty.json()).connectors).length === 4);
}

for (const [path, body] of [["/api/tts", null], ["/api/tts", []], ["/api/connectors/status", null], ["/api/connectors/status", { connectors: [12] }], ["/api/connectors/status", { connectors: "gmail" }]]) {
  const f = stubFetch([]);
  const res = await worker.fetch(postAt(path, body), baseEnv, {}, { fetch: f });
  check(`${path} rejects malformed request shape ${JSON.stringify(body)}`, res.status === 400 && f.calls.length === 0);
}

{
  const f = stubFetch([]);
  const res = await worker.fetch(new Request(`${API_ORIGIN}/api/messages`, { method: "POST", headers: { Origin: ORIGIN }, body: "{broken" }), baseEnv, {}, { fetch: f });
  check("malformed JSON is rejected without an upstream call", res.status === 400 && f.calls.length === 0);
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
