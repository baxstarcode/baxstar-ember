/**
 * EMBER — Anthropic API proxy (Cloudflare Worker)
 *
 * Why this exists: index.html ships to the browser, so it can never hold an API key.
 * This Worker holds the key server-side and is the only thing Ember's front end talks to.
 *
 * Deploy: see docs/DEPLOY.md
 *
 * Required secret:
 *   ANTHROPIC_API_KEY   your Anthropic key (wrangler secret put ANTHROPIC_API_KEY)
 *
 * Required var:
 *   ALLOWED_ORIGINS     comma-separated exact origins allowed to call this Worker,
 *                       e.g. "https://ember.baxstarfishing.com"
 *                       This is a browser CORS policy, not authentication. Protect
 *                       every API/OAuth route with Access before production use.
 *
 * Optional MCP secrets — see docs/DEPLOY.md §MCP. Without these, chat works but the
 * Quo / Gmail / Calendar / Drive connectors will not.
 *
 * Two ways to hold connector credentials, checked in this order:
 *   1. MCP_REFRESH_GMAIL / _CALENDAR / _GDRIVE / _QUO — refresh tokens. The Worker
 *      trades one for a short-lived access token per request (cached in-isolate).
 *      Get these by visiting /oauth/start?p=google and /oauth/start?p=quo.
 *   2. MCP_TOKEN_QUO / _GMAIL / _CALENDAR / _GDRIVE — static access tokens. Simpler,
 *      but they expire and chat silently drops to demo data when they do.
 *
 * OAuth handshake vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   from Google Cloud console
 *   OAUTH_REDIRECT_URI                       this Worker's /oauth/callback URL
 *   OAUTH_STATE_SECRET                       any long random string; signs the
 *                                            PKCE cookie so a stray callback can't
 *                                            be replayed against us
 *   QUO_CLIENT_ID (optional)                 set after the first Quo run to skip
 *                                            re-registering the client
 *
 * POST /tts — Ember's natural voice. Relays Microsoft Edge's free neural TTS
 * (the Read Aloud voices) over an outbound WebSocket and returns raw MP3.
 * No provider key is required. The same CORS policy applies; Access protection
 * is still needed to prevent a direct client from farming the endpoint.
 *
 * POST /api/outbox — accepts Caption Studio's bounded publish payload and relays it
 * to the private Drive outbox URL held in OUTBOX_URL. OUTBOX_TOKEN is optional.
 * Neither value is ever accepted from, or returned to, the browser.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Current connector contract: each server has one top-level MCP toolset.
// https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
const MCP_BETA = "mcp-client-2025-11-20";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUO_DISCOVERY_URL = "https://mcp.quo.com/.well-known/oauth-authorization-server";
const QUO_REGISTER_URL = "https://mcp.quo.com/register";

// One Google consent covers all three Google connectors; Brady pastes the same
// refresh token into all three secrets. Keep both consent and refreshed access
// tokens read-only. Existing broad refresh grants still need revocation/re-consent.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

// Quo exposes contact reads only through its write:contacts grant. Ordinary
// Ember chat does not need that risk: conversation/account reads remain useful.
const QUO_SCOPES = "read:conversations read:account";

const CONNECTOR_PROVIDER = {
  gmail: "google",
  calendar: "google",
  gdrive: "google",
  quo: "quo",
};

// Only the name is selected by the browser. Destinations and tool permissions
// belong to the Worker: never attach a secret to a client-owned URL.
const MCP_SERVER_DEFINITIONS = new Map([
  ["quo", { type: "url", name: "quo", url: "https://mcp.quo.com/mcp" }],
  ["gmail", { type: "url", name: "gmail", url: "https://gmailmcp.googleapis.com/mcp/v1" }],
  ["calendar", { type: "url", name: "calendar", url: "https://calendarmcp.googleapis.com/mcp/v1" }],
  ["gdrive", { type: "url", name: "gdrive", url: "https://drivemcp.googleapis.com/mcp/v1" }],
]);

// Ordinary chat can read these tools only. New provider tools remain disabled
// until explicitly reviewed here. Confirmed writes need a separate action API;
// neither a chat prompt nor client-supplied configs can enable them.
const MCP_READ_TOOLS = new Map([
  ["quo", ["fetch-call-transcripts", "fetch-messages", "fetch-missed-calls", "list-inboxes", "list-tasks", "list-users"]],
  ["gmail", ["get_message", "get_thread", "list_drafts", "list_labels", "search_threads"]],
  ["calendar", ["get_event", "list_calendars", "list_events", "search_events", "suggest_time"]],
  ["gdrive", ["download_file_content", "get_file_metadata", "get_file_permissions", "list_recent_files", "read_file_content", "search_files"]],
]);

function readOnlyToolset(name) {
  return {
    type: "mcp_toolset",
    mcp_server_name: name,
    default_config: { enabled: false },
    configs: Object.fromEntries((MCP_READ_TOOLS.get(name) || []).map((tool) => [tool, { enabled: true }])),
  };
}

const POST_ROUTES = new Map([
  ["/api/messages", "messages"],
  ["/api/tts", "tts"],
  ["/api/connectors/status", "connectors"],
  ["/api/outbox", "outbox"],
]);

// Ember's selectable models — keep in sync with MODELS in src/baxstar-ember.jsx.
// Anything else is refused so a leaked endpoint can't be repurposed into a
// general-purpose model proxy.
// The four current IDs are what the app sends. The previous five stay accepted only
// so the deployed page keeps working between this Worker deploy and the Pages
// release that switches models; remove them once that release is live.
const ALLOWED_MODELS = new Set([
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5-1",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-fable-5",
]);

// The current models always think before answering and that thinking counts
// against max_tokens; at Xtra (xhigh) effort 4096 could end before the first
// word. Billing follows tokens actually used, not this ceiling.
const MAX_TOKENS_CAP = 16000;
const ALLOWED_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MAX_BODY_BYTES = 5 * 1024 * 1024; // Ember sends resized image b64 in captions

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const ok = origin && list.includes(origin);
  const h = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // Without this, the custom degraded-connectors signal below is set on the
    // response but invisible to page JS — the browser only exposes
    // Content-Type cross-origin unless a header is named here.
    "Access-Control-Expose-Headers": "x-ember-connectors",
  };
  if (ok) h["Access-Control-Allow-Origin"] = origin;
  return { headers: h, ok };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

class RequestInputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Count the actual bytes as they arrive, including requests without a truthful
// Content-Length. The limit bounds buffering before JSON.parse, not after it.
async function readJsonBody(request, allowEmpty = false) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) {
    throw new RequestInputError("Request too large.", 413);
  }
  let raw = "";
  let bytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new RequestInputError("Request too large.", 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  let body;
  try { body = JSON.parse(allowEmpty && !raw.trim() ? "{}" : raw); }
  catch { throw new RequestInputError("Invalid JSON."); }
  if (!isRecord(body)) throw new RequestInputError("Request body must be an object.");
  return body;
}

function validateMessagesBody(body) {
  if (!ALLOWED_MODELS.has(body.model)) throw new RequestInputError("Model not allowed.");
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some((message) => {
    if (!isRecord(message) || !["user", "assistant"].includes(message.role)) return true;
    if (typeof message.content === "string") return false;
    return !Array.isArray(message.content) || !message.content.length || message.content.some((block) =>
      !isRecord(block) || !["text", "image"].includes(block.type) ||
      (block.type === "text" && typeof block.text !== "string") ||
      (block.type === "image" && (message.role !== "user" || !isRecord(block.source) ||
        block.source.type !== "base64" || block.source.media_type !== "image/jpeg" ||
        typeof block.source.data !== "string" || !block.source.data)));
  })) throw new RequestInputError("messages must contain user/assistant messages with text or content blocks.");
  const tokens = body.max_tokens === undefined ? 1000 : body.max_tokens;
  const maxTokens = typeof tokens === "number" || (typeof tokens === "string" && /^\d+$/.test(tokens))
    ? Number(tokens) : NaN;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new RequestInputError("max_tokens must be a positive integer.");
  }
  body.max_tokens = Math.min(maxTokens, MAX_TOKENS_CAP);
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new RequestInputError("stream must be a boolean.");
  }
  if (body.mcp_servers !== undefined && (!Array.isArray(body.mcp_servers) ||
      body.mcp_servers.some((server) => !isRecord(server) || typeof server.name !== "string" ||
        !MCP_SERVER_DEFINITIONS.has(server.name)))) {
    throw new RequestInputError("mcp_servers must contain canonical connector names.");
  }
  if (body.output_config !== undefined && (!isRecord(body.output_config) ||
      (body.output_config.effort !== undefined && !ALLOWED_EFFORTS.includes(body.output_config.effort)))) {
    throw new RequestInputError("Invalid output_config.");
  }
}

function messagesPayload(body) {
  // Keep the existing text/vision/effort contract, but never forward arbitrary
  // provider capabilities (tools, tool_choice, containers, server configs, etc.).
  // Rebuild nested messages too: exact canonical keys prevent hidden capability
  // fields from hitching a ride inside otherwise valid text/image blocks.
  const messages = body.messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((block) => block.type === "text"
        ? { type: "text", text: block.text }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: block.source.data,
            },
          }),
  }));
  const payload = { model: body.model, max_tokens: body.max_tokens, messages };
  if (body.stream !== undefined) payload.stream = body.stream;
  if (body.output_config?.effort !== undefined) payload.output_config = { effort: body.output_config.effort };
  return payload;
}

function upstreamHeaders(response, cors, extra = {}) {
  return {
    ...cors,
    "Content-Type": response.headers.get("Content-Type") || "application/json",
    "Cache-Control": "no-store",
    ...extra,
  };
}

// --- /outbox: private Drive staging relay ---------------------------------
//
// The Apps Script deployment URL is a capability: exposing it in generated HTML
// would let anyone bypass Ember's Access gate. The browser therefore sends only
// a same-origin JSON payload. This Worker owns the destination, strips every
// unrecognized field, and converts JPEG data URLs to the legacy base64 contract.

const OUTBOX_SURFACES = new Set(["ig_feed", "fb_page", "ig_story", "fb_story"]);
const OUTBOX_STRING_FIELDS = new Map([
  ["lockedTag", 128],
  ["species", 160],
  ["lake", 240],
  ["postWindow", 160],
  ["postAt", 64],
  ["postTimeLocal", 32],
  ["clientTime", 64],
]);
const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

function outboxDestination(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.port ||
        url.username || url.password || url.search || url.hash ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function jpegBase64(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(JPEG_DATA_URL);
  if (!match || match[1].length % 4 !== 0 || !match[1].startsWith("/9j/")) return null;
  return match[1];
}

function outboxPayload(body, token) {
  if (body.source !== "ember-caption-studio" ||
      typeof body.caption !== "string" || !body.caption.trim() || body.caption.length > 10_000 ||
      typeof body.captionWithHandles !== "string" || body.captionWithHandles.length > 10_000 ||
      !Array.isArray(body.images) || body.images.length < 1 || body.images.length > 6 ||
      (body.mimeType !== undefined && body.mimeType !== "image/jpeg")) {
    throw new RequestInputError("Invalid outbox request.");
  }

  const images = body.images.map(jpegBase64);
  if (images.some((image) => !image)) throw new RequestInputError("Invalid outbox request.");

  const payload = {
    source: "ember-caption-studio",
    caption: body.caption,
    captionWithHandles: body.captionWithHandles,
    images,
    // The Apps Script still supports its original single-slide field. Derive it
    // here so a browser cannot smuggle a second, unvalidated image through it.
    imageBase64: images[0],
    mimeType: "image/jpeg",
  };

  for (const [field, max] of OUTBOX_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].length > max) {
      throw new RequestInputError("Invalid outbox request.");
    }
    payload[field] = body[field];
  }

  if (body.hashtagCount !== undefined) {
    if (!Number.isSafeInteger(body.hashtagCount) || body.hashtagCount < 0 || body.hashtagCount > 5) {
      throw new RequestInputError("Invalid outbox request.");
    }
    payload.hashtagCount = body.hashtagCount;
  }

  if (body.sponsors !== undefined) {
    if (!Array.isArray(body.sponsors) || body.sponsors.length > 16 ||
        body.sponsors.some((item) => typeof item !== "string" || item.length > 128)) {
      throw new RequestInputError("Invalid outbox request.");
    }
    payload.sponsors = body.sponsors;
  }

  if (body.payloadVersion !== undefined) {
    if (body.payloadVersion !== 2) throw new RequestInputError("Invalid outbox request.");
    payload.payloadVersion = 2;
  }
  if (body.format !== undefined) {
    if (!["post", "carousel"].includes(body.format)) throw new RequestInputError("Invalid outbox request.");
    payload.format = body.format;
  }
  if (body.surfaces !== undefined) {
    if (!Array.isArray(body.surfaces) || !body.surfaces.length || body.surfaces.length > OUTBOX_SURFACES.size ||
        new Set(body.surfaces).size !== body.surfaces.length ||
        body.surfaces.some((surface) => !OUTBOX_SURFACES.has(surface))) {
      throw new RequestInputError("Invalid outbox request.");
    }
    payload.surfaces = body.surfaces;
  }
  if (body.storyImages !== undefined) {
    if (!Array.isArray(body.storyImages) || body.storyImages.length > 6) {
      throw new RequestInputError("Invalid outbox request.");
    }
    const storyImages = body.storyImages.map(jpegBase64);
    if (storyImages.some((image) => !image)) throw new RequestInputError("Invalid outbox request.");
    payload.storyImages = storyImages;
  }

  // Only the server-owned secret is forwarded. Client `token`, `url`, and other
  // unknown fields never enter this allowlisted payload.
  if (typeof token === "string" && token.length) {
    if (token.length > 1024) throw new RequestInputError("Outbox unavailable.", 503);
    payload.token = token;
  }
  return payload;
}

async function handleOutbox(body, env, cors, fetchImpl) {
  const destination = outboxDestination(env.OUTBOX_URL);
  if (!destination) return json({ error: "Drive outbox unavailable." }, 503, cors);

  let payload;
  try {
    payload = outboxPayload(body, env.OUTBOX_TOKEN);
  } catch (error) {
    return json(
      { error: error instanceof RequestInputError && error.status === 503 ? "Drive outbox unavailable." : "Invalid outbox request." },
      error instanceof RequestInputError ? error.status : 400,
      cors,
    );
  }

  let upstream;
  try {
    upstream = await fetchImpl(destination, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
  } catch {
    return json({ error: "Drive outbox unavailable." }, 502, cors);
  }

  if (!upstream.ok) return json({ error: "Drive outbox unavailable." }, 502, cors);
  try {
    const result = await upstream.json();
    if (!isRecord(result) || result.ok !== true) {
      return json({ error: "Drive outbox unavailable." }, 502, cors);
    }
  } catch {
    return json({ error: "Drive outbox unavailable." }, 502, cors);
  }
  return json({ ok: true }, 200, cors);
}

// --- OAuth handshake ------------------------------------------------------
//
// The PKCE verifier has to survive the round trip to Google and back. Workers
// give us no storage we can count on — isolates are recycled at will and there
// is no KV binding here — so the verifier rides in a signed, HttpOnly cookie
// instead. Stateless, and a callback that arrives without the matching cookie
// is refused rather than trusted.

function b64url(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomB64url(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

async function sha256b64url(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return b64url(d);
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return b64url(sig);
}

// Constant-time-ish compare so a signature can't be guessed byte by byte.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sealState(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return body + "." + (await hmac(secret, body));
}

async function openState(sealed, secret) {
  if (typeof sealed !== "string" || !sealed.includes(".")) return null;
  const idx = sealed.lastIndexOf(".");
  const body = sealed.slice(0, idx);
  const sig = sealed.slice(idx + 1);
  if (!safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const pad = body.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(pad))));
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function htmlPage(title, bodyHtml, status) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${htmlEscape(title)}</title>` +
      `<style>body{font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;` +
      `background:#0b0f14;color:#e6edf3}code{background:#161b22;padding:.15rem .4rem;border-radius:4px;` +
      `font-size:.95em;word-break:break-all}h1{font-size:1.35rem}li{margin:.5rem 0}a{color:#58a6ff}` +
      `.tok{display:block;background:#161b22;padding:.75rem;border-radius:6px;margin:.75rem 0}</style>` +
      bodyHtml,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
  );
}

// Quo is a public client with dynamic registration. Register once, then set
// QUO_CLIENT_ID so later runs skip this.
async function quoConfig(env, fetchImpl) {
  const disc = await fetchImpl(QUO_DISCOVERY_URL, { headers: { Accept: "application/json" } });
  if (!disc.ok) throw new Error("Quo discovery failed: " + disc.status);
  const meta = await disc.json();
  const authorize = meta.authorization_endpoint || "https://mcp.quo.com/authorize";
  const token = meta.token_endpoint || "https://mcp.quo.com/token";
  if (env.QUO_CLIENT_ID) return { authorize, token, clientId: env.QUO_CLIENT_ID, registered: false };

  const reg = await fetchImpl(meta.registration_endpoint || QUO_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Ember",
      redirect_uris: [env.OAUTH_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: QUO_SCOPES,
    }),
  });
  if (!reg.ok) throw new Error("Quo registration failed: " + reg.status);
  const client = await reg.json();
  if (!client.client_id) throw new Error("Quo registration returned no client_id");
  return { authorize, token, clientId: client.client_id, registered: true };
}

async function oauthStart(request, env, url, fetchImpl) {
  const provider = url.searchParams.get("p");
  if (provider !== "google" && provider !== "quo") {
    return htmlPage("Ember OAuth", "<h1>Unknown provider</h1><p>Use <code>?p=google</code> or <code>?p=quo</code>.</p>", 400);
  }
  if (!env.OAUTH_STATE_SECRET || !env.OAUTH_REDIRECT_URI) {
    return htmlPage("Ember OAuth", "<h1>Not configured</h1><p>Set <code>OAUTH_STATE_SECRET</code> and <code>OAUTH_REDIRECT_URI</code> first.</p>", 500);
  }

  const verifier = randomB64url(48);
  const challenge = await sha256b64url(verifier);
  const state = randomB64url(16);

  let authorizeUrl, clientId, extra = {};
  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID) {
      return htmlPage("Ember OAuth", "<h1>Not configured</h1><p><code>GOOGLE_CLIENT_ID</code> is not set.</p>", 500);
    }
    authorizeUrl = GOOGLE_AUTH_URL;
    clientId = env.GOOGLE_CLIENT_ID;
    // Without both of these Google returns no refresh token on repeat consents,
    // which is the only thing this whole flow exists to obtain.
    extra = { access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES };
  } else {
    let cfg;
    try {
      cfg = await quoConfig(env, fetchImpl);
    } catch (e) {
      return htmlPage("Ember OAuth", `<h1>Quo setup failed</h1><p>${htmlEscape(e.message || e)}</p>`, 502);
    }
    authorizeUrl = cfg.authorize;
    clientId = cfg.clientId;
    extra = { scope: QUO_SCOPES };
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  });

  const sealed = await sealState({ v: verifier, s: state, p: provider, c: clientId }, env.OAUTH_STATE_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${authorizeUrl}?${params.toString()}`,
      "Set-Cookie": `ember_oauth=${sealed}; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=900`,
      "Cache-Control": "no-store",
    },
  });
}

async function oauthCallback(request, env, url, fetchImpl) {
  const err = url.searchParams.get("error");
  if (err) return htmlPage("Ember OAuth", `<h1>Denied</h1><p>The provider returned <code>${htmlEscape(err)}</code>.</p>`, 400);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const sealed = readCookie(request, "ember_oauth");
  if (!code || !sealed) {
    return htmlPage("Ember OAuth", "<h1>Missing handshake</h1><p>Start again at <code>/oauth/start?p=google</code>.</p>", 400);
  }
  const saved = env.OAUTH_STATE_SECRET ? await openState(sealed, env.OAUTH_STATE_SECRET) : null;
  if (!saved || !safeEqual(String(state || ""), saved.s)) {
    return htmlPage("Ember OAuth", "<h1>State mismatch</h1><p>This callback does not match a handshake we started. Nothing was exchanged.</p>", 400);
  }

  const isGoogle = saved.p === "google";
  let tokenUrl = GOOGLE_TOKEN_URL;
  if (!isGoogle) {
    try {
      tokenUrl = (await quoConfig(env, fetchImpl)).token;
    } catch (e) {
      return htmlPage("Ember OAuth", `<h1>Quo setup failed</h1><p>${htmlEscape(e.message || e)}</p>`, 502);
    }
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    client_id: saved.c,
    code_verifier: saved.v,
  });
  // Quo registers with auth method "none" — a public client sends no secret.
  if (isGoogle && env.GOOGLE_CLIENT_SECRET) form.set("client_secret", env.GOOGLE_CLIENT_SECRET);

  let res, data;
  try {
    res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    data = await res.json();
  } catch (e) {
    return htmlPage("Ember OAuth", "<h1>Token exchange failed</h1><p>The provider could not be reached.</p>", 502);
  }
  if (!res.ok || !data.refresh_token) {
    const detail = data && (data.error_description || data.error) ? String(data.error_description || data.error) : "no refresh_token in response";
    return htmlPage(
      "Ember OAuth",
      `<h1>No refresh token</h1><p>${htmlEscape(detail)}</p><p>For Google this usually means the account has consented before — revoke Ember at <a href="https://myaccount.google.com/permissions">Google permissions</a> and run it again.</p>`,
      400
    );
  }

  const names = isGoogle
    ? ["MCP_REFRESH_GMAIL", "MCP_REFRESH_CALENDAR", "MCP_REFRESH_GDRIVE"]
    : ["MCP_REFRESH_QUO"];
  const clientNote =
    !isGoogle && saved.c && !env.QUO_CLIENT_ID
      ? `<li>Also add <code>QUO_CLIENT_ID</code> = <span class="tok">${htmlEscape(saved.c)}</span> so it does not register a new client each time.</li>`
      : "";

  // The Worker deliberately cannot write its own secrets — that would mean giving
  // it an API token that can rewrite its own configuration. Brady pastes them.
  return htmlPage(
    "Ember OAuth — done",
    `<h1>Authorized ${htmlEscape(isGoogle ? "Google" : "Quo")}</h1>` +
      `<p>Copy this refresh token into Cloudflare — Workers &rsaquo; your Worker &rsaquo; Settings &rsaquo; Variables, as an <strong>encrypted</strong> secret:</p>` +
      `<span class="tok">${htmlEscape(data.refresh_token)}</span>` +
      `<ul><li>Set ${names.map((n) => `<code>${htmlEscape(n)}</code>`).join(", ")} to that value.</li>${clientNote}` +
      `<li>Then redeploy the Worker.</li></ul>` +
      `<p>This page is the only time the token is shown. It is not stored anywhere — the Worker has no permission to write its own secrets, which is why this is a copy-paste step.</p>`,
    200
  );
}

// --- per-request access tokens --------------------------------------------
//
// Isolates are reused, so a short cache saves a refresh round trip on most
// requests. Keyed per connector; entries expire early so a token is never
// handed out in its last few seconds of life.
const tokenCache = new Map();

// ROTATED REFRESH TOKENS (2026-10-15). Some providers hand back a NEW refresh token
// on each refresh and retire the old one; Ember's Quo client is a public OAuth
// client, the kind that rule is written for. The secret Brady pasted can't be
// rewritten by this Worker (by design, see the callback page), so a rotated token
// used to be thrown away and the connector died at the next refresh.
// With the optional EMBER_TOKENS KV binding, the newest token is kept there and
// used first. Each saved token carries a fingerprint of the secret it descends
// from, so when Brady re-keys (a new secret) the stale saved token is ignored.
// Without the binding nothing changes. Free-tier KV: one write per rotation.
async function secretFingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function currentRefresh(connector, env) {
  const base = env["MCP_REFRESH_" + connector.toUpperCase()];
  if (!base) return null;
  const store = env.EMBER_TOKENS;
  if (!store || typeof store.get !== "function") return { refresh: base, base, store: null };
  const fp = await secretFingerprint(base);
  try {
    const saved = await store.get("refresh:" + connector, "json");
    if (saved && saved.base === fp && typeof saved.token === "string" && saved.token) {
      return { refresh: saved.token, base, store, fp };
    }
  } catch {
    // An unreadable store is the same as no store.
  }
  return { refresh: base, base, store, fp };
}

async function accessTokenFor(connector, env, fetchImpl, now) {
  const current = await currentRefresh(connector, env);
  if (!current) return null;
  const minted = await mintAccessToken(connector, current.refresh, current, env, fetchImpl, now);
  // A saved token that stopped working falls back once to the pasted secret.
  if (!minted && current.refresh !== current.base) {
    return mintAccessToken(connector, current.base, { ...current, refresh: current.base }, env, fetchImpl, now);
  }
  return minted;
}

async function mintAccessToken(connector, refresh, current, env, fetchImpl, now) {

  const hit = tokenCache.get(connector);
  if (hit && hit.exp > now && hit.refresh === refresh) return hit.token;

  const provider = CONNECTOR_PROVIDER[connector];
  let tokenUrl = GOOGLE_TOKEN_URL;
  let clientId = env.GOOGLE_CLIENT_ID;
  if (provider !== "google") {
    if (!env.QUO_CLIENT_ID) return null; // cannot refresh without the registered client
    clientId = env.QUO_CLIENT_ID;
    try {
      tokenUrl = (await quoConfig(env, fetchImpl)).token;
    } catch {
      return null;
    }
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId,
  });
  if (provider === "google" && env.GOOGLE_CLIENT_SECRET) {
    form.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  }

  try {
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.access_token) return null;
    if (current.store && typeof data.refresh_token === "string" && data.refresh_token && data.refresh_token !== refresh) {
      try {
        await current.store.put("refresh:" + connector, JSON.stringify({ base: current.fp, token: data.refresh_token }));
        refresh = data.refresh_token;
      } catch {
        // Losing the save costs one future refresh, never this request.
      }
    }
    const ttl = Math.max(30, Number(data.expires_in) || 3600);
    tokenCache.set(connector, {
      token: data.access_token,
      // 60s early so a token can't expire mid-flight upstream.
      exp: now + (ttl - 60) * 1000,
      refresh,
    });
    return data.access_token;
  } catch {
    return null; // a connector we can't authorize is dropped, not forwarded
  }
}

/**
 * Attach connector OAuth tokens from secrets. Ember's front end never sees these.
 *
 * Servers we hold no token for are dropped rather than passed through. The API
 * rejects the entire request if any listed server fails to authenticate, so
 * forwarding an unauthorized connector takes plain chat down with it — and the
 * app sends its full connector list on every message.
 */
async function injectMcpTokens(servers, env, fetchImpl, now) {
  if (!Array.isArray(servers)) return { authorized: [], missing: [] };
  const staticTokens = {
    quo: env.MCP_TOKEN_QUO,
    gmail: env.MCP_TOKEN_GMAIL,
    calendar: env.MCP_TOKEN_CALENDAR,
    gdrive: env.MCP_TOKEN_GDRIVE,
  };
  const out = [];
  const missing = [];
  const seen = new Set();
  for (const s of servers) {
    const name = s && s.name;
    const canonical = MCP_SERVER_DEFINITIONS.get(name);
    if (!canonical || seen.has(name)) continue;
    seen.add(name);
    // A refreshed token beats a static one: static tokens expire silently and
    // take the connector down until Brady notices and pastes a new one.
    const t = (await accessTokenFor(name, env, fetchImpl, now)) || staticTokens[name];
    if (t) out.push({ ...canonical, authorization_token: t });
    else missing.push(name);
  }
  return { authorized: out, missing };
}

// Privacy-safe connector check: refreshes credentials but never calls an MCP
// tool or reads mailbox, calendar, Drive, call, or message data. This exists so
// production auth can be verified without asking a model to inspect private
// records merely to prove the connection works.
async function connectorStatus(body, env, cors, fetchImpl, now) {
  let requested = ["quo", "gmail", "calendar", "gdrive"];
  if (body.connectors !== undefined) {
    if (!Array.isArray(body.connectors) || body.connectors.some((name) => typeof name !== "string")) {
      return json({ error: "connectors must be an array of names." }, 400, cors);
    }
    requested = body.connectors;
  }
  const allowed = new Set(["quo", "gmail", "calendar", "gdrive"]);
  const names = [...new Set(requested.filter((name) => allowed.has(name)))];
  const staticTokens = {
    quo: env.MCP_TOKEN_QUO,
    gmail: env.MCP_TOKEN_GMAIL,
    calendar: env.MCP_TOKEN_CALENDAR,
    gdrive: env.MCP_TOKEN_GDRIVE,
  };
  const connectors = {};
  for (const name of names) {
    const token = (await accessTokenFor(name, env, fetchImpl, now)) || staticTokens[name];
    connectors[name] = token ? "connected" : "offline";
  }
  return json({ connectors }, 200, { ...cors, "Cache-Control": "no-store" });
}

// --- /tts: Ember's natural voice ------------------------------------------
//
// Edge's Read Aloud service speaks over a WebSocket: one config frame, one SSML
// frame, then binary frames whose payload (after a 2-byte-length-prefixed
// header) is MP3, until a "turn.end" text frame. It gates on looking like the
// Edge browser. Microsoft changes that handshake without notice, so this exact
// set is kept in sync with the working edge-tts client and pinned in tests.
// None of it is secret; there is no key.

const EDGE_TTS_HOST = "speech.platform.bing.com";
const EDGE_TTS_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"; // public, ships in every Edge install
const EDGE_TTS_VERSION = "1-143.0.3650.75";
const EDGE_TTS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  "Pragma": "no-cache",
  "Cache-Control": "no-cache",
  "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "Sec-WebSocket-Version": "13",
};

// What the app's picker offers, nothing more — an open voice field would let a
// caller probe Microsoft's whole catalog through us.
const TTS_VOICES = new Set([
  "en-US-JennyNeural",
  "en-US-AriaNeural",
  "en-US-MichelleNeural",
  "en-US-GuyNeural",
  "en-US-ChristopherNeural",
]);
const TTS_DEFAULT_VOICE = "en-US-JennyNeural";
// Ember speaks at most ~380 chars per reply; anything past this is not Ember.
const TTS_MAX_CHARS = 1000;

// Sec-MS-GEC: uppercase SHA-256 of (Windows-epoch ticks floored to 5 minutes,
// concatenated with the client token). Derived from the clock, so it cannot be
// hardcoded — but it CAN be pinned in a test with a fixed clock.
async function edgeGec(now) {
  const WIN_EPOCH = 11644473600n;
  const s = BigInt(Math.floor(now / 1000)) + WIN_EPOCH;
  const ticks = (s - (s % 300n)) * 10000000n;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ticks}${EDGE_TTS_TOKEN}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// The service expects the JavaScript Date.toString() shape in UTC — ISO dates
// negotiate a socket but can yield a turn with no audio. Build it explicitly so
// the Worker does not depend on an isolate's locale or timezone.
function edgeTimestamp(now) {
  const d = new Date(now);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return days[d.getUTCDay()] + " " + months[d.getUTCMonth()] + " " + pad(d.getUTCDate()) + " " +
    d.getUTCFullYear() + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" +
    pad(d.getUTCSeconds()) + " GMT+0000 (Coordinated Universal Time)";
}

// The reply text rides inside SSML — escape it or a spoken "<" ends the voice
// element and arbitrary markup reaches the synthesizer.
function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
}

async function handleTts(body, cors, fetchImpl, now) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "No text to speak." }, 400, cors);
  if (text.length > TTS_MAX_CHARS) return json({ error: "Text too long." }, 400, cors);
  const voice = TTS_VOICES.has(body.voice) ? body.voice : TTS_DEFAULT_VOICE;

  const connId = crypto.randomUUID().replace(/-/g, "");
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const muid = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const wsUrl =
    `https://${EDGE_TTS_HOST}/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${EDGE_TTS_TOKEN}&Sec-MS-GEC=${await edgeGec(now)}` +
    `&Sec-MS-GEC-Version=${EDGE_TTS_VERSION}&ConnectionId=${connId}`;

  let sock;
  try {
    const up = await fetchImpl(wsUrl, {
      headers: { Upgrade: "websocket", ...EDGE_TTS_HEADERS, Cookie: `muid=${muid};` },
    });
    sock = up.webSocket;
    if (!sock) return json({ error: `Voice engine refused the connection (${up.status}).` }, 502, cors);
  } catch {
    return json({ error: "Voice engine unreachable." }, 502, cors);
  }

  // Live failure, 2026-08-22: the runtime delivered binary frames as Blobs
  // (browser default binaryType), not the ArrayBuffers the offline tests feed.
  // new Uint8Array(blob) is an empty array, so every audio frame was silently
  // skipped while text frames parsed fine — a fast turn.end with zero audio.
  // Force arraybuffer delivery, and keep a diag trail in the failure body so
  // the next silent mismatch names itself instead of reading as "no audio".
  try { sock.binaryType = "arraybuffer"; } catch {}
  const diag = { text: 0, bin: 0, odd: 0, header: "" };
  const parts = await new Promise((resolve) => {
    const audio = [];
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      try { sock.close(); } catch {}
      resolve(v);
    };
    // A wedged socket must fail the request, not hang the Worker until the
    // platform kills it — the app treats any /tts failure as "use device voice".
    const guard = setTimeout(() => finish(audio.length ? audio : null), 12000);
    sock.accept();
    sock.addEventListener("message", (e) => {
      if (typeof e.data === "string") {
        diag.text++;
        if (e.data.includes("Path:turn.end")) finish(audio);
        return;
      }
      let buf;
      if (e.data instanceof ArrayBuffer) buf = new Uint8Array(e.data);
      else if (ArrayBuffer.isView(e.data)) buf = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      else { diag.odd++; return; } // Blob or unknown — counted, never silently zero
      diag.bin++;
      if (buf.length < 2) return;
      const headerLen = (buf[0] << 8) | buf[1];
      const header = new TextDecoder().decode(buf.subarray(2, 2 + headerLen));
      if (!diag.header) diag.header = header.slice(0, 80);
      // "Path:audio.metadata" frames carry JSON — excluded, or they'd splice
      // into the MP3 as a burst of noise.
      if (header.includes("Path:audio") && !header.includes("Path:audio.metadata")) audio.push(buf.subarray(2 + headerLen));
    });
    sock.addEventListener("error", () => finish(null));
    sock.addEventListener("close", () => finish(audio.length ? audio : null));
    const ts = edgeTimestamp(now);
    sock.send(
      `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } }) + "\r\n"
    );
    sock.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'><prosody pitch='+0Hz' rate='+4%' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`
    );
  });

  if (!parts || !parts.length) {
    return json({ error: "Voice engine produced no audio.", diag }, 502, cors);
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return new Response(out, {
    status: 200,
    headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env, ctx, deps = {}) {
    // deps lets the tests drive this with a stubbed fetch/clock; production
    // passes nothing and gets the real ones.
    const fetchImpl = deps.fetch || fetch;
    const now = deps.now ? deps.now() : Date.now();

    // OAuth is a browser navigation Brady does by hand, so it is routed before
    // the POST-only and Origin checks below — a top-level GET carries no Origin
    // header and would be refused by them.
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/oauth/start") {
      return oauthStart(request, env, url, fetchImpl);
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      return oauthCallback(request, env, url, fetchImpl);
    }

    const origin = request.headers.get("Origin");
    const { headers: cors, ok: originOk } = corsHeaders(origin, env);

    // workers.dev remains enabled only for the manual OAuth GET callbacks above.
    // Production API traffic arrives through the Access-gated Pages service
    // binding and retains Ember's custom hostname in request.url. Refusing every
    // non-OAuth workers.dev request closes the old public direct-call bypass;
    // browser Origin checks alone are not authentication.
    const requestHostname = url.hostname.replace(/\.+$/, "").toLowerCase();
    if (requestHostname.endsWith(".workers.dev")) {
      return json({ error: "Not found." }, 404, cors);
    }

    const route = POST_ROUTES.get(url.pathname);

    if (!route) return json({ error: "Not found." }, 404, cors);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, cors);
    }
    if (!allowedOrigins(env).length) {
      return json(
        { error: "Proxy misconfigured: ALLOWED_ORIGINS is not set." },
        500,
        cors
      );
    }
    if (!originOk) {
      // This is CORS defense only: non-browser clients can forge Origin.
      // Access protection for every API/OAuth entry point is a deployment gate.
      return json({ error: "Origin not allowed." }, 403, cors);
    }
    let body;
    try { body = await readJsonBody(request, route === "connectors"); }
    catch (error) {
      return json({ error: error instanceof RequestInputError ? error.message : "Could not read request body." },
        error instanceof RequestInputError ? error.status : 400, cors);
    }
    // The natural voice needs no Anthropic key — routed after the origin gate
    // but before the key check, so a voice-only misconfiguration still speaks.
    if (route === "tts") {
      return handleTts(body, cors, fetchImpl, now);
    }
    if (route === "connectors") {
      return connectorStatus(body, env, cors, fetchImpl, now);
    }
    if (route === "outbox") {
      return handleOutbox(body, env, cors, fetchImpl);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json(
        { error: "Proxy misconfigured: ANTHROPIC_API_KEY is not set." },
        500,
        cors
      );
    }

    try { validateMessagesBody(body); }
    catch (error) { return json({ error: error.message }, 400, cors); }
    const requestedServers = body.mcp_servers;
    body = messagesPayload(body);
    let connectorsDegraded = false;
    if (requestedServers) {
      const { authorized, missing } = await injectMcpTokens(requestedServers, env, fetchImpl, now);
      connectorsDegraded = missing.length > 0;
      if (authorized.length) {
        body.mcp_servers = authorized;
        body.tools = authorized.map((server) => readOnlyToolset(server.name));
      }
    }

    // Build headers ourselves — nothing from the client is forwarded.
    const requestHeaders = {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (body.mcp_servers) requestHeaders["anthropic-beta"] = MCP_BETA;

    const call = (payload, headers) =>
      fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

    let upstream;
    try {
      upstream = await call(body, requestHeaders);
    } catch (e) {
      return json(
        { error: "Upstream request failed." },
        502,
        { ...cors, ...(connectorsDegraded ? { "x-ember-connectors": "degraded" } : {}) },
      );
    }

    // A connector whose token is missing, expired, or simply the wrong kind of
    // credential makes the API reject the WHOLE request — so one dead connector
    // takes plain chat down with it. That is never the right trade: answer the
    // question, let the connector panels fall back to demo data.
    if (upstream.status >= 400 && body.mcp_servers) {
      const raw = await upstream.clone().text();
      if (/mcp server/i.test(raw)) {
        const { mcp_servers, tools, ...withoutConnectors } = body;
        const retryHeaders = { ...requestHeaders };
        delete retryHeaders["anthropic-beta"];
        try {
          const retry = await call(withoutConnectors, retryHeaders);
          if (retry.ok) {
            return new Response(retry.body, {
              status: retry.status,
              headers: upstreamHeaders(retry, cors, {
                // So the app can say "connectors offline" instead of guessing.
                "x-ember-connectors": "degraded",
              }),
            });
          }
        } catch (e) {
          // fall through and return the original error
        }
      }
      return new Response(raw, {
        status: upstream.status,
        headers: upstreamHeaders(upstream, cors, connectorsDegraded ? { "x-ember-connectors": "degraded" } : {}),
      });
    }

    // Pass the response through, but only headers we choose.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstreamHeaders(upstream, cors, connectorsDegraded ? { "x-ember-connectors": "degraded" } : {}),
    });
  },
};
