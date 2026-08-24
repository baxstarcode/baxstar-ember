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
 *                       Leave this open at your peril — an unrestricted proxy lets
 *                       anyone on the internet spend your Anthropic balance.
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
 * No key, no secret, no per-use cost. The same origin allowlist gates it, so
 * a leaked Worker URL cannot be farmed as an open TTS service.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Required for the mcp_servers field. Without it the API rejects MCP requests.
const MCP_BETA = "mcp-client-2025-04-04";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUO_DISCOVERY_URL = "https://mcp.quo.com/.well-known/oauth-authorization-server";
const QUO_REGISTER_URL = "https://mcp.quo.com/register";

// One Google consent covers all three Google connectors; Brady pastes the same
// refresh token into all three secrets.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
].join(" ");

const QUO_SCOPES = "read:conversations write:contacts read:account";

const CONNECTOR_PROVIDER = {
  gmail: "google",
  calendar: "google",
  gdrive: "google",
  quo: "quo",
};

// Ember's selectable models — keep in sync with MODELS in src/baxstar-ember.jsx.
// Anything else is refused so a leaked endpoint can't be repurposed into a
// general-purpose model proxy.
const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-fable-5",
]);

const MAX_TOKENS_CAP = 4096;
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
    headers: { ...headers, "Content-Type": "application/json" },
  });
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

function htmlPage(title, bodyHtml, status) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<style>body{font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;` +
      `background:#0b0f14;color:#e6edf3}code{background:#161b22;padding:.15rem .4rem;border-radius:4px;` +
      `font-size:.95em;word-break:break-all}h1{font-size:1.35rem}li{margin:.5rem 0}a{color:#58a6ff}` +
      `.tok{display:block;background:#161b22;padding:.75rem;border-radius:6px;margin:.75rem 0}</style>` +
      bodyHtml,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
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
      return htmlPage("Ember OAuth", `<h1>Quo setup failed</h1><p>${String(e.message || e)}</p>`, 502);
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
  if (err) return htmlPage("Ember OAuth", `<h1>Denied</h1><p>The provider returned <code>${err}</code>.</p>`, 400);

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
      return htmlPage("Ember OAuth", `<h1>Quo setup failed</h1><p>${String(e.message || e)}</p>`, 502);
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
      `<h1>No refresh token</h1><p>${detail}</p><p>For Google this usually means the account has consented before — revoke Ember at <a href="https://myaccount.google.com/permissions">Google permissions</a> and run it again.</p>`,
      400
    );
  }

  const names = isGoogle
    ? ["MCP_REFRESH_GMAIL", "MCP_REFRESH_CALENDAR", "MCP_REFRESH_GDRIVE"]
    : ["MCP_REFRESH_QUO"];
  const clientNote =
    !isGoogle && saved.c && !env.QUO_CLIENT_ID
      ? `<li>Also add <code>QUO_CLIENT_ID</code> = <span class="tok">${saved.c}</span> so it does not register a new client each time.</li>`
      : "";

  // The Worker deliberately cannot write its own secrets — that would mean giving
  // it an API token that can rewrite its own configuration. Brady pastes them.
  return htmlPage(
    "Ember OAuth — done",
    `<h1>Authorized ${isGoogle ? "Google" : "Quo"}</h1>` +
      `<p>Copy this refresh token into Cloudflare — Workers &rsaquo; your Worker &rsaquo; Settings &rsaquo; Variables, as an <strong>encrypted</strong> secret:</p>` +
      `<span class="tok">${data.refresh_token}</span>` +
      `<ul><li>Set ${names.map((n) => `<code>${n}</code>`).join(", ")} to that value.</li>${clientNote}` +
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

async function accessTokenFor(connector, env, fetchImpl, now) {
  const refresh = env["MCP_REFRESH_" + connector.toUpperCase()];
  if (!refresh) return null;

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
  if (!Array.isArray(servers)) return [];
  const staticTokens = {
    quo: env.MCP_TOKEN_QUO,
    gmail: env.MCP_TOKEN_GMAIL,
    calendar: env.MCP_TOKEN_CALENDAR,
    gdrive: env.MCP_TOKEN_GDRIVE,
  };
  const out = [];
  for (const s of servers) {
    const name = s && s.name;
    if (!name) continue;
    // A refreshed token beats a static one: static tokens expire silently and
    // take the connector down until Brady notices and pastes a new one.
    const t = (await accessTokenFor(name, env, fetchImpl, now)) || staticTokens[name];
    if (t) out.push({ ...s, authorization_token: t });
  }
  return out;
}

// Privacy-safe connector check: refreshes credentials but never calls an MCP
// tool or reads mailbox, calendar, Drive, call, or message data. This exists so
// production auth can be verified without asking a model to inspect private
// records merely to prove the connection works.
async function connectorStatus(request, env, cors, fetchImpl, now) {
  let requested = ["quo", "gmail", "calendar", "gdrive"];
  try {
    const body = JSON.parse(await request.text() || "{}");
    if (Array.isArray(body.connectors)) requested = body.connectors;
  } catch {
    return json({ error: "Invalid JSON." }, 400, cors);
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

async function handleTts(request, cors, fetchImpl, now) {
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Invalid JSON." }, 400, cors);
  }
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
        if (e.data.includes("Path:turn.end")) finish(audio);
        return;
      }
      const buf = new Uint8Array(e.data);
      if (buf.length < 2) return;
      const headerLen = (buf[0] << 8) | buf[1];
      const header = new TextDecoder().decode(buf.subarray(2, 2 + headerLen));
      // Exact path only: "Path:audio.metadata" frames carry JSON, and a
      // substring match would splice it into the MP3 as a burst of noise.
      if (/(^|\r\n)Path:audio(\r\n|$)/.test(header)) audio.push(buf.subarray(2 + headerLen));
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

  if (!parts || !parts.length) return json({ error: "Voice engine produced no audio." }, 502, cors);
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
      // Blocked here as well as by CORS, so a non-browser client can't bypass it.
      return json({ error: "Origin not allowed." }, 403, cors);
    }
    // The natural voice needs no Anthropic key — routed after the origin gate
    // but before the key check, so a voice-only misconfiguration still speaks.
    if (url.pathname === "/tts") {
      return handleTts(request, cors, fetchImpl, now);
    }
    if (url.pathname === "/connectors/status") {
      return connectorStatus(request, env, cors, fetchImpl, now);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json(
        { error: "Proxy misconfigured: ANTHROPIC_API_KEY is not set." },
        500,
        cors
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: "Request too large." }, 413, cors);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON." }, 400, cors);
    }

    if (!ALLOWED_MODELS.has(body.model)) {
      return json({ error: `Model not allowed: ${body.model}` }, 400, cors);
    }
    body.max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP);
    if (body.mcp_servers) {
      const authorized = await injectMcpTokens(body.mcp_servers, env, fetchImpl, now);
      if (authorized.length) body.mcp_servers = authorized;
      else delete body.mcp_servers;
    }

    // Build headers ourselves — nothing from the client is forwarded.
    const upstreamHeaders = {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (body.mcp_servers) upstreamHeaders["anthropic-beta"] = MCP_BETA;

    const call = (payload, headers) =>
      fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

    let upstream;
    try {
      upstream = await call(body, upstreamHeaders);
    } catch (e) {
      return json({ error: "Upstream request failed." }, 502, cors);
    }

    // A connector whose token is missing, expired, or simply the wrong kind of
    // credential makes the API reject the WHOLE request — so one dead connector
    // takes plain chat down with it. That is never the right trade: answer the
    // question, let the connector panels fall back to demo data.
    if (upstream.status >= 400 && body.mcp_servers) {
      const raw = await upstream.clone().text();
      if (/mcp server/i.test(raw)) {
        const { mcp_servers, ...withoutConnectors } = body;
        const retryHeaders = { ...upstreamHeaders };
        delete retryHeaders["anthropic-beta"];
        try {
          const retry = await call(withoutConnectors, retryHeaders);
          if (retry.ok) {
            return new Response(retry.body, {
              status: retry.status,
              headers: {
                ...cors,
                "Content-Type": "application/json",
                // So the app can say "connectors offline" instead of guessing.
                "x-ember-connectors": "degraded",
              },
            });
          }
        } catch (e) {
          // fall through and return the original error
        }
      }
      return new Response(raw, {
        status: upstream.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Pass the response through, but only headers we choose.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
