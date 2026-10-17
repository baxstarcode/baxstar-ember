const PRODUCTION_HOSTNAME = "ember.baxstarfishing.com";

const ALLOWED_PATHS = new Set([
  "/api/messages",
  "/api/tts",
  "/api/voice/transcribe",
  "/api/voice/speak",
  "/api/connectors/status",
  "/api/outbox",
]);

const ALLOWED_METHODS = new Set(["POST", "OPTIONS"]);

function plainText(message, status, headers = {}) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function notFound() {
  return plainText("Not found", 404);
}

function serviceUnavailable() {
  return plainText("API service unavailable", 503);
}

/**
 * Same-origin entry point for Ember's key-holding Worker.
 *
 * The production custom domain is protected by Cloudflare Access. Preview Pages
 * hosts are intentionally denied so a public preview cannot bypass that gate.
 * The bound Worker remains responsible for request schemas, body limits, CORS,
 * connector policy, and upstream response handling.
 */
export async function onRequest(context) {
  const request = context?.request;
  if (!request || typeof request.url !== "string") {
    return notFound();
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return notFound();
  }

  if (url.hostname !== PRODUCTION_HOSTNAME || !ALLOWED_PATHS.has(url.pathname)) {
    return notFound();
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return plainText("Method not allowed", 405, {
      allow: "POST, OPTIONS",
    });
  }

  const api = context?.env?.EMBER_API;
  if (!api || typeof api.fetch !== "function") {
    return serviceUnavailable();
  }

  try {
    // Preserve request and response streams exactly; do not clone, inspect, or wrap.
    return await api.fetch(request);
  } catch {
    return serviceUnavailable();
  }
}
