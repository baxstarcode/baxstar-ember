// Failure injection complements the real workerd/SQLite tests in the runtime suite.
// Every credential and provider response below is synthetic.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import worker, { EmberTokenCoordinator } from "./cloudflare-worker.js";

const ORIGIN = "https://ember.baxstarfishing.com";
const baseEnv = {
  ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_API_KEY: "fixture-api-key",
  TOKEN_COORDINATOR_REQUIRED: "true",
  QUO_CLIENT_ID: "fixture-quo-client", GOOGLE_CLIENT_ID: "fixture-google-client",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  MCP_COORDINATED_REFRESH_QUO: "fixture-quo-seed",
  MCP_COORDINATED_REFRESH_GOOGLE: "fixture-google-seed",
  MCP_REFRESH_QUO: "fixture-retired-legacy-seed",
};
const keyFor = (provider, env) => createHash("sha256").update(JSON.stringify([
  provider, provider === "google" ? env.GOOGLE_CLIENT_ID : env.QUO_CLIENT_ID,
  env[provider === "google" ? "MCP_COORDINATED_REFRESH_GOOGLE" : "MCP_COORDINATED_REFRESH_QUO"],
])).digest("base64url");
const appKeyFor = (provider, env) => createHash("sha256").update(JSON.stringify([
  "app-grant-v1", provider, provider === "google" ? env.GOOGLE_CLIENT_ID : env.QUO_CLIENT_ID,
])).digest("base64url");
const request = (connector, env) => new Request("https://ember-token.internal/access", {
  method: "POST", body: JSON.stringify({ connector, key: keyFor(connector === "quo" ? "quo" : "google", env) }),
});

function harness(options = {}) {
  const env = { ...baseEnv, ...options.env };
  const records = new Map();
  const objects = new Map();
  const alarms = new Map();
  const logs = [];
  const calls = [];
  let clock = 1_000_000;
  let failRead = false, failWrite = false, failFinal = false, discoveryFails = false;
  let provider = options.provider || (() => Response.json({ access_token: "fixture-access", refresh_token: "fixture-rotated", expires_in: 120 }));
  let tokenEndpoint = "https://mcp.quo.com/token";
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes(".well-known")) {
      if (discoveryFails) throw new Error("fixture discovery unavailable");
      return Response.json({ token_endpoint: tokenEndpoint });
    }
    calls.push(new URLSearchParams(init.body).get("refresh_token"));
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    return provider(init);
  };
  env.EMBER_TOKEN_COORDINATOR = {
    idFromName: (key) => key,
    get: (key) => {
      if (!objects.has(key)) {
        let tail = Promise.resolve();
        const ctx = {
          id: key,
          storage: {
            get: async () => { if (failRead) throw new Error("fixture read failed"); return structuredClone(records.get(key)); },
            put: async (_name, value) => {
              if (failWrite || (failFinal && value.phase === "ready")) throw new Error("fixture write failed");
              records.set(key, structuredClone(value));
            },
            setAlarm: async (at) => { alarms.set(key, at); },
            getAlarm: async () => alarms.get(key) ?? null,
          },
          blockConcurrencyWhile: (callback) => { const next = tail.then(callback); tail = next.catch(() => {}); return next; },
        };
        objects.set(key, new EmberTokenCoordinator(ctx, env, { fetch: fetchImpl, now: () => clock, log: (line) => logs.push(line) }));
      }
      const owner = objects.get(key);
      return { fetch: (input, init) => owner.fetch(input instanceof Request ? input : new Request(input, init)) };
    },
  };
  const direct = (connector = "quo") => env.EMBER_TOKEN_COORDINATOR.get(keyFor(connector === "quo" ? "quo" : "google", env)).fetch(request(connector, env));
  const status = async (connectors = ["quo"]) => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/connectors/status`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ connectors }),
    }), env, {}, { fetch: () => { throw new Error("legacy refresh must not run"); } });
    return res.json();
  };
  const owner = (key) => { env.EMBER_TOKEN_COORDINATOR.get(key); return objects.get(key); };
  const install = (provider, body) => env.EMBER_TOKEN_COORDINATOR.get(appKeyFor(provider, env)).fetch(new Request("https://ember-token.internal/app/install", {
    method: "POST", body: JSON.stringify({ connector: provider === "google" ? "gmail" : "quo", ...body }),
  }));
  return { env, records, calls, alarms, logs, direct, status, owner, install, restart: () => objects.clear(),
    advance: (ms = 200_000) => { clock += ms; }, get clock() { return clock; },
    set faults(value) { ({ failRead = false, failWrite = false, failFinal = false, discoveryFails = false } = value); },
    set provider(value) { provider = value; },
    set tokenEndpoint(value) { tokenEndpoint = value; },
  };
}

test("concurrent callers share one refresh; expiry uses the replacement", async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 8 }, () => h.direct()));
  assert.ok(results.every((r) => r.status === 200));
  assert.deepEqual(h.calls, ["fixture-quo-seed"]);
  h.advance();
  assert.equal((await h.direct()).status, 200);
  assert.deepEqual(h.calls, ["fixture-quo-seed", "fixture-rotated"]);
});

test("all Google connectors use the same durable grant and client-secret changes keep it", async () => {
  const h = harness();
  assert.deepEqual((await h.status(["gmail", "calendar", "gdrive"])).connectors, { gmail: "connected", calendar: "connected", gdrive: "connected" });
  h.env.GOOGLE_CLIENT_SECRET = "fixture-new-client-secret";
  h.advance();
  h.provider = (init) => {
    assert.equal(new URLSearchParams(init.body).get("client_secret"), "fixture-new-client-secret");
    return Response.json({ access_token: "fixture-next", expires_in: 120 });
  };
  assert.equal((await h.direct("gmail")).status, 200);
  assert.deepEqual(h.calls, ["fixture-google-seed", "fixture-rotated"]);
  assert.equal(h.records.size, 1);
});

test("owner restart retains access and refresh tokens", async () => {
  const h = harness();
  await h.direct();
  h.restart();
  assert.equal((await h.direct()).status, 200);
  assert.equal(h.calls.length, 1);
  h.advance();
  await h.direct();
  assert.equal(h.calls.at(-1), "fixture-rotated");
});

test("storage read failure and failed intent write never contact the provider", async () => {
  const h = harness();
  for (const faults of [{ failRead: true }, { failWrite: true }]) {
    h.faults = faults;
    assert.equal((await h.direct()).status, 503);
    assert.equal(h.calls.length, 0);
  }
  h.faults = {};
  assert.equal((await h.direct()).status, 200);
});

test("failed final persistence retries the save without refreshing again", async () => {
  const h = harness();
  h.faults = { failFinal: true };
  assert.equal((await h.direct()).status, 503);
  assert.equal(h.records.values().next().value.phase, "refreshing");
  assert.equal((await h.direct()).status, 503);
  assert.equal(h.calls.length, 1);
  h.faults = {};
  assert.equal((await h.direct()).status, 200);
  assert.equal(h.calls.length, 1);
  h.restart(); h.advance();
  await h.direct();
  assert.equal(h.calls.at(-1), "fixture-rotated");
});

test("a crash after a failed final save cannot replay a spent token", async () => {
  const h = harness();
  h.faults = { failFinal: true };
  await h.direct();
  h.restart(); h.faults = {};
  assert.equal((await (await h.direct()).json()).error, "reconnect_required");
  assert.equal(h.calls.length, 1);
});

for (const [name, provider] of [
  ["lost reply", () => { throw new Error("fixture response lost after rotation"); }],
  ["server error", () => Response.json({ error: "server_error" }, { status: 500 })],
  ["provider timeout", () => { throw new DOMException("fixture timeout", "TimeoutError"); }],
  ["malformed JSON", () => new Response("bad json")],
  ["null payload", () => Response.json(null)],
  ["invalid token", () => Response.json({ access_token: "fixture-access", refresh_token: {} })],
  ["invalid expiry", () => Response.json({ access_token: "fixture-access", expires_in: -1 })],
]) {
  test(`${name} leaves a durable stop across retries/restarts`, async () => {
    const h = harness({ provider });
    assert.equal((await h.direct()).status, 503);
    h.restart();
    assert.equal((await (await h.direct()).json()).error, "reconnect_required");
    assert.equal(h.calls.length, 1);
    assert.equal(h.records.values().next().value.phase, "refreshing");
  });
}

test("discovery failure is retryable because no refresh intent was committed", async () => {
  const h = harness();
  h.faults = { discoveryFails: true };
  assert.equal((await h.direct()).status, 503);
  assert.equal(h.records.size, 0);
  h.faults = {};
  assert.equal((await h.direct()).status, 200);
  assert.equal(h.calls.length, 1);
});

test("new consent recovers without overwriting the previous grant", async () => {
  const h = harness({ provider: () => { throw new Error("fixture lost reply"); } });
  await h.direct();
  const oldKey = keyFor("quo", h.env);
  h.env.MCP_COORDINATED_REFRESH_QUO = "fixture-new-consent";
  h.provider = () => Response.json({ access_token: "fixture-new-access", refresh_token: "fixture-new-rotation", expires_in: 120 });
  assert.equal((await h.direct()).status, 200);
  assert.equal(h.records.size, 2);
  assert.equal(h.records.get(oldKey).phase, "refreshing");
  assert.deepEqual(h.calls, ["fixture-quo-seed", "fixture-new-consent"]);
});

for (const fault of ["missing-binding", "missing-seed", "binding-failure"]) {
  test(`${fault}: Worker stays offline without legacy refresh or token leakage`, async () => {
    const h = harness();
    if (fault === "missing-binding") delete h.env.EMBER_TOKEN_COORDINATOR;
    if (fault === "missing-seed") delete h.env.MCP_COORDINATED_REFRESH_QUO;
    if (fault === "binding-failure") h.env.EMBER_TOKEN_COORDINATOR.get = () => { throw new Error("fixture unavailable"); };
    const status = await h.status();
    assert.equal(status.connectors.quo, "offline");
    assert.equal(status.issues.quo, fault === "binding-failure" ? "temporarily_unavailable" : "setup_required");
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(status), /fixture-|refresh|secret/);
  });
}

test("status exposes only connection states; chat receives the token server-side", async () => {
  const h = harness();
  assert.equal((await h.status()).connectors.quo, "connected");
  const response = await worker.fetch(new Request(`${ORIGIN}/api/messages`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-5", max_tokens: 100, messages: [{ role: "user", content: "hello" }], mcp_servers: [{ name: "quo" }] }),
  }), h.env, {}, { fetch: async (_url, init) => {
    assert.equal(JSON.parse(init.body).mcp_servers[0].authorization_token, "fixture-access");
    return Response.json({ content: [{ type: "text", text: "fixture reply" }] });
  } });
  assert.doesNotMatch(await response.text(), /fixture-access|fixture-quo/);
  assert.equal(h.calls.length, 1);
});

test("wrong object identity and mismatched grant requests cannot create a second owner", async () => {
  const h = harness();
  const wrong = h.env.EMBER_TOKEN_COORDINATOR.get("wrong-owner");
  assert.equal((await wrong.fetch(request("quo", h.env))).status, 403);
  const correct = h.env.EMBER_TOKEN_COORDINATOR.get(keyFor("quo", h.env));
  const bad = new Request("https://ember-token.internal/access", { method: "POST", body: JSON.stringify({ connector: "quo", key: "wrong" }) });
  assert.equal((await correct.fetch(bad)).status, 403);
  assert.equal((await correct.fetch(new Request("https://ember-token.internal/access", {
    method: "POST", body: JSON.stringify({ connector: "constructor", key: keyFor("quo", h.env) }),
  }))).status, 403);
  assert.equal((await correct.fetch(new Request("https://ember-token.internal/access"))).status, 404);
  assert.equal(h.calls.length, 0);
});

test("malformed persisted state fails closed", async () => {
  const h = harness();
  h.records.set(keyFor("quo", h.env), { version: 1, phase: "ready", refresh: "fixture-unsafe" });
  assert.equal((await h.direct()).status, 503);
  assert.equal(h.calls.length, 0);
});

test("status distinguishes transient storage trouble from an ambiguous refresh", async () => {
  const h = harness();
  h.faults = { failRead: true };
  assert.deepEqual((await h.status()).issues, { quo: "temporarily_unavailable" });
  h.faults = {};
  h.provider = () => { throw new Error("fixture provider lost reply"); };
  assert.deepEqual((await h.status()).issues, { quo: "reconnect_required" });
  h.restart();
  assert.deepEqual((await h.status()).issues, { quo: "reconnect_required" });
  assert.equal(h.calls.length, 1);
});

test("unknown coordinator error text cannot leak through status", async () => {
  const h = harness();
  h.env.EMBER_TOKEN_COORDINATOR.get = () => ({ fetch: async () => Response.json({ error: "fixture-secret-provider-detail" }, { status: 503 }) });
  const status = await h.status();
  assert.deepEqual(status.issues, { quo: "temporarily_unavailable" });
  assert.doesNotMatch(JSON.stringify(status), /fixture-|secret|detail/);
});

test("a successful reconnect or explicit static fallback clears the issue", async () => {
  const h = harness();
  h.faults = { failRead: true };
  assert.ok((await h.status()).issues.quo);
  h.faults = {};
  assert.equal((await h.status()).issues, undefined);
  h.env.MCP_TOKEN_QUO = "fixture-static-access";
  h.env.EMBER_TOKEN_COORDINATOR.get = () => { throw new Error("fixture binding unavailable"); };
  assert.deepEqual((await h.status()).connectors, { quo: "connected" });
  assert.equal((await h.status()).issues, undefined);
});

// --- 2026-11-08 grant health, in-app reconnect, keep-alive ---------------------

const SECRET_TEXT = /fixture-(quo-seed|rotated|access|google-seed|app-|next)/;

test("a provider rejection is a finished grant: recorded, logged, never retried", async () => {
  const h = harness({ provider: () => Response.json({ error: "invalid_grant", error_description: "fixture-detail" }, { status: 400 }) });
  const status = await h.status();
  assert.equal(status.issues.quo, "reconnect_required");
  assert.equal(status.health.quo.failure, "provider_rejected");
  assert.equal(status.health.quo.oauthError, "invalid_grant");
  assert.equal(status.health.quo.httpStatus, 400);
  h.restart();
  assert.equal((await h.status()).issues.quo, "reconnect_required");
  assert.equal(h.calls.length, 1);
  assert.equal(h.records.get(keyFor("quo", h.env)).phase, "rejected");
  assert.doesNotMatch(JSON.stringify(status) + h.logs.join("\n"), /fixture-/);
  assert.match(h.logs.join("\n"), /"outcome":"stopped".*"failure":"provider_rejected"/);
});

for (const [name, reply] of [
  ["HTTP 429", () => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } })],
  ["temporarily_unavailable", () => Response.json({ error: "temporarily_unavailable" }, { status: 503 })],
]) {
  test(`${name}: an unprocessed exchange keeps the same token and retries after the wait`, async () => {
    const h = harness({ provider: reply });
    const first = await h.status();
    assert.equal(first.issues.quo, "temporarily_unavailable");
    assert.equal(first.health.quo.failure, "rate_limited");
    assert.equal(h.records.get(keyFor("quo", h.env)).phase, "ready");
    assert.equal((await h.direct()).status, 503);
    assert.equal(h.calls.length, 1, "no second call inside the wait");
    h.provider = () => Response.json({ access_token: "fixture-access", refresh_token: "fixture-rotated", expires_in: 3600 });
    h.advance(61 * 60 * 1000);
    const later = await h.status();
    assert.equal(later.connectors.quo, "connected");
    assert.equal(later.health.quo.failure, undefined);
    assert.deepEqual(h.calls, ["fixture-quo-seed", "fixture-quo-seed"], "the unspent token is the one presented again");
  });
}

test("an untrusted discovered token endpoint never receives the refresh token", async () => {
  const h = harness();
  h.tokenEndpoint = "https://collector.example/token";
  assert.deepEqual((await h.status()).issues, { quo: "temporarily_unavailable" });
  assert.equal(h.calls.length, 0);
  assert.equal(h.records.size, 0);
});

test("health shows renewals and rotations accumulating, never token text", async () => {
  const h = harness();
  assert.equal((await h.status()).health.quo.renewals, 1);
  h.advance();
  const second = await h.status();
  assert.equal(second.health.quo.renewals, 2);
  // The fixture returns the same replacement twice, so only the first renewal rotated.
  assert.equal(second.health.quo.rotations, 1);
  assert.equal(second.health.quo.source, "setup");
  assert.ok(Date.parse(second.health.quo.lastRenewedAt) > Date.parse(second.health.quo.connectedAt));
  assert.doesNotMatch(JSON.stringify(second), SECRET_TEXT);
});

test("a legacy in-flight marker reports an interrupted refresh", async () => {
  const h = harness();
  h.records.set(keyFor("quo", h.env), { version: 1, key: keyFor("quo", h.env), phase: "refreshing" });
  const status = await h.status();
  assert.equal(status.issues.quo, "reconnect_required");
  assert.equal(status.health.quo.failure, "interrupted");
  assert.equal(h.calls.length, 0);
});

test("an in-app install replaces a stopped seed grant without presenting the seed", async () => {
  const h = harness({ provider: () => { throw new Error("fixture lost reply"); } });
  assert.equal((await h.status()).issues.quo, "reconnect_required");
  assert.equal((await h.install("quo", { refresh: "fixture-app-refresh", token: "fixture-app-access", expiresIn: 3600 })).status, 200);
  const status = await h.status();
  assert.equal(status.connectors.quo, "connected");
  assert.equal(status.health.quo.source, "app");
  assert.deepEqual(h.calls, ["fixture-quo-seed"], "install delivered its own access token");
  // calls already holds the token being presented: app renewal n returns rotation n.
  h.provider = () => Response.json({ access_token: "fixture-app-next", refresh_token: `fixture-app-rotated-${h.calls.length - 1}`, expires_in: 3600 });
  h.advance(2 * 3600 * 1000);
  h.restart();
  assert.equal((await h.status()).connectors.quo, "connected");
  h.advance(2 * 3600 * 1000);
  assert.equal((await h.status()).health.quo.rotations, 2);
  assert.deepEqual(h.calls, ["fixture-quo-seed", "fixture-app-refresh", "fixture-app-rotated-1"]);
  assert.equal(h.records.get(keyFor("quo", h.env)).phase, "refreshing", "the stopped seed grant is left untouched");
});

test("a second install supersedes the first app grant; its token is never presented", async () => {
  const h = harness();
  await h.install("quo", { refresh: "fixture-app-first" });
  await h.install("quo", { refresh: "fixture-app-second" });
  await h.status();
  assert.deepEqual(h.calls, ["fixture-app-second"]);
});

test("a stopped app grant falls back to a working seed grant", async () => {
  const h = harness();
  await h.install("google", { refresh: "fixture-app-google" });
  h.provider = (init) => new URLSearchParams(init.body).get("refresh_token") === "fixture-app-google"
    ? Response.json({ error: "invalid_grant" }, { status: 400 })
    : Response.json({ access_token: "fixture-access", expires_in: 3600 });
  const status = await h.status(["gmail", "calendar"]);
  assert.deepEqual(status.connectors, { gmail: "connected", calendar: "connected" });
  assert.equal(status.issues, undefined);
  assert.deepEqual(h.calls, ["fixture-app-google", "fixture-google-seed"]);
});

test("install rejects malformed grants and unknown owners", async () => {
  const h = harness();
  assert.equal((await h.install("quo", { refresh: "" })).status, 400);
  assert.equal((await h.install("quo", { refresh: "x".repeat(5000) })).status, 400);
  const wrong = h.env.EMBER_TOKEN_COORDINATOR.get("wrong-owner");
  assert.equal((await wrong.fetch(new Request("https://ember-token.internal/app/install", {
    method: "POST", body: JSON.stringify({ connector: "quo", refresh: "fixture-app-intruder" }),
  }))).status, 403);
  assert.equal(h.records.size, 0);
});

test("keep-alive: a renewal arms a 12-hour alarm that renews with the rotated token", async () => {
  const h = harness();
  await h.direct();
  const key = keyFor("quo", h.env);
  assert.equal(h.alarms.get(key), h.clock + 12 * 3600 * 1000);
  h.advance(12 * 3600 * 1000);
  await h.owner(key).alarm();
  assert.deepEqual(h.calls, ["fixture-quo-seed", "fixture-rotated"]);
  assert.equal(h.alarms.get(key), h.clock + 12 * 3600 * 1000, "re-armed after renewing");
  assert.match(h.logs.at(-1), /"trigger":"keepalive","outcome":"renewed"/);
});

test("keep-alive leaves a stopped grant stopped and re-arms after a rate limit", async () => {
  const h = harness({ provider: () => new Response("busy", { status: 429, headers: { "Retry-After": "300" } }) });
  const key = keyFor("quo", h.env);
  await h.direct();
  h.advance(6 * 60 * 1000);
  h.records.set(key, { ...h.records.get(key), mode: "seed", connector: "quo" });
  await h.owner(key).alarm();
  assert.equal(h.calls.length, 2);
  assert.equal(h.alarms.get(key), h.clock + 300 * 1000);
  h.provider = () => { throw new Error("fixture lost reply"); };
  h.advance(6 * 60 * 1000);
  await h.owner(key).alarm();
  assert.equal(h.records.get(key).phase, "refreshing");
  h.advance(12 * 3600 * 1000);
  await h.owner(key).alarm();
  assert.equal(h.calls.length, 3, "no provider call once stopped");
});

test("reconnect flow: signed-in ticket → provider consent → grant saved, token never shown", async () => {
  const h = harness({ provider: () => { throw new Error("fixture lost reply"); } });
  Object.assign(h.env, { OAUTH_STATE_SECRET: "fixture-state-secret", OAUTH_REDIRECT_URI: "https://ember-claude-proxy.fixture.workers.dev/oauth/callback" });
  assert.equal((await h.status()).issues.quo, "reconnect_required");
  const providerFetch = async (url, init = {}) => {
    if (String(url).includes(".well-known")) return Response.json({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token" });
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("client_id"), "fixture-quo-client");
    return Response.json({ access_token: "fixture-app-access", refresh_token: "fixture-app-refresh", expires_in: 3600 });
  };
  const begin = await worker.fetch(new Request(`${ORIGIN}/api/connectors/reconnect`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "quo" }),
  }), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  assert.equal(begin.status, 200);
  const { url } = await begin.json();
  assert.match(url, /^https:\/\/ember-claude-proxy\.fixture\.workers\.dev\/oauth\/start\?ticket=/);
  const start = await worker.fetch(new Request(url), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("Location"));
  const cookie = start.headers.get("Set-Cookie").split(";")[0];
  const callback = await worker.fetch(new Request(`https://ember-claude-proxy.fixture.workers.dev/oauth/callback?code=fixture-code&state=${location.searchParams.get("state")}`, {
    headers: { Cookie: cookie },
  }), h.env, {}, { fetch: providerFetch, now: () => h.clock + 60_000 });
  const page = await callback.text();
  assert.equal(callback.status, 200);
  assert.match(page, /Quo reconnected/);
  assert.doesNotMatch(page, /fixture-app/);
  assert.match(callback.headers.get("Set-Cookie"), /Max-Age=0/);
  const status = await h.status();
  assert.equal(status.connectors.quo, "connected");
  assert.equal(status.health.quo.source, "app");
});

test("reconnect tickets expire, cannot be forged, and the manual route still only displays", async () => {
  const h = harness();
  Object.assign(h.env, { OAUTH_STATE_SECRET: "fixture-state-secret", OAUTH_REDIRECT_URI: "https://ember-claude-proxy.fixture.workers.dev/oauth/callback" });
  const providerFetch = async (url) => String(url).includes(".well-known")
    ? Response.json({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token" })
    : Response.json({ access_token: "fixture-manual-access", refresh_token: "fixture-manual-refresh", expires_in: 3600 });
  const begin = await worker.fetch(new Request(`${ORIGIN}/api/connectors/reconnect`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "quo" }),
  }), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  const { url } = await begin.json();
  const expired = await worker.fetch(new Request(url), h.env, {}, { fetch: providerFetch, now: () => h.clock + 11 * 60 * 1000 });
  assert.equal(expired.status, 400);
  const forged = await worker.fetch(new Request(url.replace(/.(?=$)/, (c) => (c === "A" ? "B" : "A"))), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  assert.equal(forged.status, 400);
  // The public workers.dev host cannot mint tickets.
  const direct = await worker.fetch(new Request("https://ember-claude-proxy.fixture.workers.dev/api/connectors/reconnect", {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "quo" }),
  }), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  assert.equal(direct.status, 404);
  const manual = await worker.fetch(new Request("https://ember-claude-proxy.fixture.workers.dev/oauth/start?p=quo"), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  const state = new URL(manual.headers.get("Location")).searchParams.get("state");
  const shown = await worker.fetch(new Request(`https://ember-claude-proxy.fixture.workers.dev/oauth/callback?code=fixture-code&state=${state}`, {
    headers: { Cookie: manual.headers.get("Set-Cookie").split(";")[0] },
  }), h.env, {}, { fetch: providerFetch, now: () => h.clock });
  assert.match(await shown.text(), /fixture-manual-refresh/, "manual flow keeps its copy-paste page");
  assert.equal(h.records.size, 0, "manual flow saved nothing");
});
