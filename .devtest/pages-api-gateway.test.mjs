import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequest } from "../functions/api/[[path]].js";

const PRODUCTION_ORIGIN = "https://ember.baxstarfishing.com";

function request(path, init = {}) {
  return new Request(`${PRODUCTION_ORIGIN}${path}`, {
    method: "POST",
    ...init,
  });
}

function serviceReturning(response, calls = []) {
  return {
    fetch(incoming) {
      calls.push(incoming);
      return response;
    },
  };
}

async function call(incoming, binding) {
  return onRequest({
    request: incoming,
    env: binding === undefined ? {} : { EMBER_API: binding },
  });
}

test("forwards only the six exact API paths on the production hostname", async (t) => {
  for (const path of [
    "/api/messages",
    "/api/tts",
    "/api/voice/transcribe",
    "/api/voice/speak",
    "/api/connectors/status",
    "/api/outbox",
  ]) {
    await t.test(path, async () => {
      const calls = [];
      const incoming = request(path);
      const upstream = new Response("ok", { status: 200 });
      const response = await call(incoming, serviceReturning(upstream, calls));

      assert.strictEqual(response, upstream);
      assert.deepEqual(calls, [incoming]);
    });
  }
});

test("denies preview and lookalike hosts without invoking the Worker", async (t) => {
  for (const host of [
    "baxstar-ember.pages.dev",
    "revival.baxstar-ember.pages.dev",
    "ember.baxstarfishing.com.evil.example",
    "www.ember.baxstarfishing.com",
  ]) {
    await t.test(host, async () => {
      const calls = [];
      const incoming = new Request(`https://${host}/api/messages`, { method: "POST" });
      const response = await call(
        incoming,
        serviceReturning(new Response("should not run"), calls),
      );

      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Not found");
      assert.equal(calls.length, 0);
    });
  }
});

test("denies path variants and unrelated routes", async (t) => {
  for (const path of [
    "/api",
    "/api/",
    "/api/messages/",
    "/api/messages/extra",
    "/api/outbox/",
    "/api/connector/status",
    "/tts",
    "/",
  ]) {
    await t.test(path, async () => {
      const calls = [];
      const response = await call(
        request(path),
        serviceReturning(new Response("should not run"), calls),
      );

      assert.equal(response.status, 404);
      assert.equal(calls.length, 0);
    });
  }
});

test("allows POST and OPTIONS but rejects every other method at the gateway", async (t) => {
  for (const method of ["POST", "OPTIONS"]) {
    await t.test(`allows ${method}`, async () => {
      const calls = [];
      const incoming = request("/api/messages", { method });
      const upstream = new Response(null, { status: 204 });
      const response = await call(incoming, serviceReturning(upstream, calls));

      assert.strictEqual(response, upstream);
      assert.deepEqual(calls, [incoming]);
    });
  }

  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
    await t.test(`rejects ${method}`, async () => {
      const calls = [];
      const incoming = request("/api/messages", { method });
      const response = await call(
        incoming,
        serviceReturning(new Response("should not run"), calls),
      );

      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST, OPTIONS");
      assert.equal(calls.length, 0);
    });
  }
});

test("fails closed when the service binding is missing, malformed, or throws", async (t) => {
  const cases = [
    ["missing", undefined],
    ["null", null],
    ["not a Fetcher", {}],
    ["fetch is not callable", { fetch: true }],
    ["fetch rejects", { fetch: async () => { throw new Error("binding unavailable"); } }],
  ];

  for (const [name, binding] of cases) {
    await t.test(name, async () => {
      const response = await call(request("/api/messages"), binding);

      assert.equal(response.status, 503);
      assert.equal(await response.text(), "API service unavailable");
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  }
});

test("passes the original Request object without consuming its body", async () => {
  const incoming = request("/api/messages?trace=kept", {
    headers: {
      "content-type": "application/json",
      "x-ember-test": "preserved",
    },
    body: JSON.stringify({ message: "hello" }),
  });
  let received;

  const response = await call(incoming, {
    fetch(boundRequest) {
      received = boundRequest;
      assert.strictEqual(boundRequest, incoming);
      assert.equal(boundRequest.bodyUsed, false);
      return new Response("accepted", { status: 202 });
    },
  });

  assert.strictEqual(received, incoming);
  assert.equal(received.url, `${PRODUCTION_ORIGIN}/api/messages?trace=kept`);
  assert.equal(received.headers.get("x-ember-test"), "preserved");
  assert.equal(incoming.bodyUsed, false);
  assert.equal(response.status, 202);
});

test("returns the upstream streaming Response without wrapping or buffering it", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: first\n\n"));
      controller.enqueue(encoder.encode("data: second\n\n"));
      controller.close();
    },
  });
  const upstream = new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });

  const response = await call(
    request("/api/messages"),
    serviceReturning(upstream),
  );

  assert.strictEqual(response, upstream);
  assert.strictEqual(response.body, stream);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(await response.text(), "data: first\n\ndata: second\n\n");
});

test("_routes.json invokes Functions only for /api/*", async () => {
  const routes = JSON.parse(
    await readFile(new URL("../_routes.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(routes, {
    version: 1,
    include: ["/api/*"],
    exclude: [],
  });
});
