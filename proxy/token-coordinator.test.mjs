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
const request = (connector, env) => new Request("https://ember-token.internal/access", {
  method: "POST", body: JSON.stringify({ connector, key: keyFor(connector === "quo" ? "quo" : "google", env) }),
});

function harness(options = {}) {
  const env = { ...baseEnv, ...options.env };
  const records = new Map();
  const objects = new Map();
  const calls = [];
  let clock = 1_000_000;
  let failRead = false, failWrite = false, failFinal = false, discoveryFails = false;
  let provider = options.provider || (() => Response.json({ access_token: "fixture-access", refresh_token: "fixture-rotated", expires_in: 120 }));
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes(".well-known")) {
      if (discoveryFails) throw new Error("fixture discovery unavailable");
      return Response.json({ token_endpoint: "https://mcp.quo.com/token" });
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
          },
          blockConcurrencyWhile: (callback) => { const next = tail.then(callback); tail = next.catch(() => {}); return next; },
        };
        objects.set(key, new EmberTokenCoordinator(ctx, env, { fetch: fetchImpl, now: () => clock }));
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
  return { env, records, calls, direct, status, restart: () => objects.clear(), advance: () => { clock += 200_000; },
    set faults(value) { ({ failRead = false, failWrite = false, failFinal = false, discoveryFails = false } = value); },
    set provider(value) { provider = value; },
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
  ["provider rejection", () => Response.json({ error: "invalid_grant" }, { status: 400 })],
  ["provider timeout", () => { throw new DOMException("fixture timeout", "TimeoutError"); }],
  ["malformed JSON", () => new Response("bad json")],
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
