// Execute the actual Worker and SQLite Durable Object in workerd. Two independent
// caller Workers share one owner; provider traffic is intercepted, never live.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel } from "miniflare";

const ORIGIN = "https://ember.baxstarfishing.com";
const scriptPath = fileURLToPath(new URL("./cloudflare-worker.js", import.meta.url));
const bindings = {
  TOKEN_COORDINATOR_REQUIRED: "true", ALLOWED_ORIGINS: ORIGIN,
  ANTHROPIC_API_KEY: "fixture-key", QUO_CLIENT_ID: "fixture-runtime-quo-client",
  GOOGLE_CLIENT_ID: "fixture-runtime-google-client", GOOGLE_CLIENT_SECRET: "fixture-runtime-google-secret",
  MCP_COORDINATED_REFRESH_QUO: "fixture-runtime-quo-seed",
  MCP_COORDINATED_REFRESH_GOOGLE: "fixture-runtime-google-seed",
};
const options = (persist, outboundService, activeBindings = bindings) => ({
  log: new Log(LogLevel.ERROR), durableObjectsPersist: persist,
  workers: [{
    name: "fixture-entry", modules: true, compatibilityDate: "2026-07-30",
    serviceBindings: { EDGE_A: "edge-a", EDGE_B: "edge-b" },
    script: `export default { fetch(request, env) {
      return (request.headers.get('X-Fixture-Caller') === 'edge-b' ? env.EDGE_B : env.EDGE_A).fetch(request);
    }};`,
  }, ...["owner", "edge-a", "edge-b"].map((name) => ({
    name, modules: true, scriptPath,
    // Pinned stable workerd baseline; wrangler dry-run separately checks the
    // production compatibility date and deployment configuration.
    compatibilityDate: "2026-07-30", bindings: activeBindings, outboundService,
    durableObjects: { EMBER_TOKEN_COORDINATOR: { className: "EmberTokenCoordinator", scriptName: "owner", useSQLite: true } },
  }))],
});
async function status(mf, caller = "edge-a", connectors = ["quo"]) {
  const response = await mf.dispatchFetch(`${ORIGIN}/api/connectors/status`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Fixture-Caller": caller }, body: JSON.stringify({ connectors }),
  });
  assert.equal(response.status, 200, response.status === 200 ? undefined : await response.clone().text());
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /fixture-|refresh|secret/);
  return body.connectors;
}

test("workerd: two caller Workers serialize rotation and SQLite survives a full restart", { timeout: 30_000 }, async () => {
  const persist = await mkdtemp(join(tmpdir(), "ember-tokens-runtime-"));
  const calls = [];
  let validRefresh = bindings.MCP_COORDINATED_REFRESH_QUO;
  let mf;
  const provider = async (request) => {
    const url = new URL(request.url);
    if (url.pathname.includes(".well-known")) return Response.json({ token_endpoint: "https://mcp.quo.com/token" });
    assert.equal(url.href, "https://mcp.quo.com/token");
    const token = new URLSearchParams(await request.text()).get("refresh_token");
    calls.push(token);
    // Make the cross-worker overlap real, so a missing owner would replay it.
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(token, validRefresh, "retired token was replayed");
    validRefresh = `fixture-runtime-rotated-${calls.length}`;
    return Response.json({ access_token: `fixture-runtime-access-${calls.length}`, refresh_token: validRefresh, expires_in: calls.length === 1 ? 61 : 3600 });
  };
  try {
    mf = new Miniflare(options(persist, provider));
    const states = await Promise.all(Array.from({ length: 12 }, (_, i) => status(mf, i % 2 ? "edge-a" : "edge-b")));
    assert.ok(states.every((s) => s.quo === "connected"));
    assert.deepEqual(calls, [bindings.MCP_COORDINATED_REFRESH_QUO]);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await status(mf, "edge-b")).quo, "connected");
    assert.deepEqual(calls, [bindings.MCP_COORDINATED_REFRESH_QUO, "fixture-runtime-rotated-1"]);
    await mf.dispose();
    mf = new Miniflare(options(persist, provider));
    assert.equal((await status(mf)).quo, "connected");
    assert.equal(calls.length, 2, "restart should use the durably cached access token");
    assert.equal((await mf.dispatchFetch(`${ORIGIN}/access`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" })).status, 404);
  } finally {
    if (mf) await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});

test("workerd: ambiguous refresh stays stopped after restart; fresh consent gets a new owner", { timeout: 30_000 }, async () => {
  const persist = await mkdtemp(join(tmpdir(), "ember-tokens-crash-"));
  const calls = [];
  let mf;
  const provider = async (request) => {
    if (request.url.includes(".well-known")) return Response.json({ token_endpoint: "https://mcp.quo.com/token" });
    const token = new URLSearchParams(await request.text()).get("refresh_token");
    calls.push(token);
    // Provider may have consumed the seed before its response became unreadable.
    return token === bindings.MCP_COORDINATED_REFRESH_QUO ? new Response("truncated response")
      : Response.json({ access_token: "fixture-reconsented-access", refresh_token: "fixture-reconsented-rotation", expires_in: 3600 });
  };
  try {
    mf = new Miniflare(options(persist, provider));
    assert.equal((await status(mf)).quo, "offline");
    await mf.dispose();
    mf = new Miniflare(options(persist, provider));
    assert.equal((await status(mf, "edge-b")).quo, "offline");
    assert.equal(calls.length, 1);
    await mf.dispose();
    mf = new Miniflare(options(persist, provider, { ...bindings, MCP_COORDINATED_REFRESH_QUO: "fixture-fresh-consent" }));
    assert.equal((await status(mf)).quo, "connected");
    assert.deepEqual(calls, [bindings.MCP_COORDINATED_REFRESH_QUO, "fixture-fresh-consent"]);
  } finally {
    if (mf) await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});

test("workerd: Gmail, Calendar and Drive share one Google grant across caller Workers", { timeout: 30_000 }, async () => {
  const persist = await mkdtemp(join(tmpdir(), "ember-tokens-google-"));
  let calls = 0;
  const provider = async (request) => {
    assert.equal(request.url, "https://oauth2.googleapis.com/token");
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return Response.json({ access_token: "fixture-google-access", refresh_token: "fixture-google-rotated", expires_in: 3600 });
  };
  const mf = new Miniflare(options(persist, provider));
  try {
    const states = await Promise.all([status(mf, "edge-a", ["gmail", "calendar", "gdrive"]), status(mf, "edge-b", ["gdrive", "calendar", "gmail"])]);
    for (const state of states) assert.deepEqual(state, { gmail: "connected", calendar: "connected", gdrive: "connected" });
    assert.equal(calls, 1);
  } finally {
    await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});

test("workerd: in-app reconnect saves a fresh grant that survives restart and keeps rotating", { timeout: 30_000 }, async () => {
  const persist = await mkdtemp(join(tmpdir(), "ember-tokens-reconnect-"));
  const calls = [];
  let valid = "fixture-runtime-app-refresh";
  const oauth = { ...bindings, OAUTH_STATE_SECRET: "fixture-runtime-state", OAUTH_REDIRECT_URI: "https://ember-claude-proxy.fixture.workers.dev/oauth/callback" };
  const provider = async (request) => {
    const url = new URL(request.url);
    if (url.pathname.includes(".well-known")) {
      return Response.json({ authorization_endpoint: "https://mcp.quo.com/authorize", token_endpoint: "https://mcp.quo.com/token" });
    }
    const form = new URLSearchParams(await request.text());
    if (form.get("grant_type") === "authorization_code") {
      return Response.json({ access_token: "fixture-runtime-app-access", refresh_token: valid, expires_in: 61 });
    }
    const token = form.get("refresh_token");
    calls.push(token);
    // The setup seed is dead; only the app grant's newest token is accepted.
    if (token !== valid) return Response.json({ error: "invalid_grant" }, { status: 400 });
    valid = `fixture-runtime-app-rotated-${calls.length}`;
    return Response.json({ access_token: `fixture-runtime-app-access-${calls.length}`, refresh_token: valid, expires_in: 3600 });
  };
  let mf;
  try {
    mf = new Miniflare(options(persist, provider, oauth));
    assert.equal((await status(mf)).quo, "offline");
    const begin = await mf.dispatchFetch(`${ORIGIN}/api/connectors/reconnect`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "quo" }),
    });
    const { url } = await begin.json();
    const start = await mf.dispatchFetch(url, { redirect: "manual" });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get("Location")).searchParams.get("state");
    const callback = await mf.dispatchFetch(`https://ember-claude-proxy.fixture.workers.dev/oauth/callback?code=fixture-code&state=${state}`, {
      headers: { Cookie: start.headers.get("Set-Cookie").split(";")[0] }, redirect: "manual",
    });
    const page = await callback.text();
    assert.equal(callback.status, 200, page);
    assert.doesNotMatch(page, /fixture-runtime-app/);
    assert.equal((await status(mf, "edge-b")).quo, "connected");
    await mf.dispose();
    mf = new Miniflare(options(persist, provider, oauth));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const states = await Promise.all(Array.from({ length: 6 }, (_, i) => status(mf, i % 2 ? "edge-a" : "edge-b")));
    assert.ok(states.every((s) => s.quo === "connected"));
    assert.deepEqual(calls, [bindings.MCP_COORDINATED_REFRESH_QUO, "fixture-runtime-app-refresh"],
      "dead seed tried once before reconnect; the app grant then renewed exactly once after restart");
  } finally {
    if (mf) await mf.dispose();
    await rm(persist, { recursive: true, force: true });
  }
});
