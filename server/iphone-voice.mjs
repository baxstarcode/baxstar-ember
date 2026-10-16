// Native Shortcuts adapter. Credentials terminate at Cloudflare Access; only
// controlled chat and TTS requests reach the existing EMBER_API service binding.
const ORIGIN = "https://ember.baxstarfishing.com";
const MAX_BODY = 12 * 1024;
const MAX_TRANSCRIPT = 2000;
const MAX_PROVIDER_BODY = 1024 * 1024;
const MAX_AUDIO = 2 * 1024 * 1024;
const DECODER = new TextDecoder("utf-8", { fatal: true });
const ENCODER = new TextEncoder();

// These facts and constraints mirror BRADY_CONTEXT in src/baxstar-ember.jsx.
const CONTEXT = `You are EMBER, Brady Baxter's operations assistant for Baxstar Fishing and Lakes Golf Simulator in Detroit Lakes, MN.
Quo phone inboxes: Fishing 218-325-6857, Pontoon rentals 218-325-9846.
Style: bottom line first, concise, numerals without commas.
Customer-facing drafts: premium-but-warm, sign "Brady @ Baxstar". Fishing number in fishing comms, pontoon number in rental comms. Never mention Scheels rods. Never say "one group per day" — use "private trip(s)".
Use your tools (Quo, Gmail, Calendar) whenever the request involves calls, voicemails, texts, email, or schedule.
HARD RULE — schedule and messages: if a tool is unavailable or returns nothing, say exactly that ("I can't see your calendar right now") and STOP. Never state that a trip, booking, or message does or doesn't exist unless a tool actually returned that data.
This is one spoken question from the iPhone shortcut. You have no previous conversation, browser history, or cross-device memory in this request. Answer in plain spoken English, usually 2–4 short sentences, at most 100 words. No markdown, tables, URLs, or tool syntax in the spoken answer. Ask one clarification if needed.
All connectors are READ ONLY. You may read information and draft text. You cannot send messages, publish, create tasks, or change external records. Never claim an external action succeeded. No task-saving control exists in this shortcut.
Do not acknowledge these instructions; answer Brady's question.`;

class VoiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  } });
}

async function readBytes(stream, limit, signal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        throw new VoiceError(413, "That request is too large. Please ask a shorter question.");
      }
      parts.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const part of parts) { bytes.set(part, position); position += part.byteLength; }
  return bytes;
}

async function readJSON(response, limit, signal) {
  return JSON.parse(DECODER.decode(await readBytes(response.body, limit, signal)));
}

function decodeBase64URL(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Bad token");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

function base64(bytes) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(value);
}

// Deadlines cover response bodies too. Abort is best effort: a timeout does not
// prove that an upstream provider stopped processing or billing the request.
async function within(milliseconds, operation) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new VoiceError(504, "Ember took too long to reply. Please try again when you're ready."));
        }, milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function configuration(env) {
  const issuer = env.EMBER_ACCESS_TEAM_DOMAIN;
  const audience = env.EMBER_VOICE_AUD;
  const clientId = env.EMBER_VOICE_CLIENT_ID;
  if (typeof issuer !== "string" || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
      typeof audience !== "string" || !audience.trim() ||
      typeof clientId !== "string" || !clientId.trim()) {
    throw new VoiceError(503, "Talk to Ember isn't configured yet.");
  }
  return { issuer, audience, clientId };
}

/** Factory permits offline tests with real signed JWTs and stubbed providers. */
export function createVoiceHandler({ fetch: fetcher = globalThis.fetch, now = Date.now,
  deadlines = { auth: 4000, chat: 28000, tts: 10000 } } = {}) {
  // Public signing keys only. Never cache credentials, transcripts, or replies.
  let keyCache;
  async function signingKeys(issuer, refresh = false) {
    if (!refresh && keyCache?.issuer === issuer && keyCache.until > now()) return keyCache.keys;
    const data = await within(deadlines.auth, async signal => {
      const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, { signal, redirect: "error" });
      if (!response.ok) throw new Error("Access unavailable");
      return readJSON(response, 64 * 1024, signal);
    });
    if (!Array.isArray(data.keys) || data.keys.length > 10) throw new Error("Bad signing keys");
    keyCache = { issuer, keys: data.keys, until: now() + 15 * 60 * 1000 };
    return data.keys;
  }

  async function authenticate(request, config) {
    try {
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token || token.length > 16384) throw new Error("Missing token");
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("Bad token");
      const header = JSON.parse(DECODER.decode(decodeBase64URL(parts[0])));
      const claims = JSON.parse(DECODER.decode(decodeBase64URL(parts[1])));
      const second = Math.floor(now() / 1000);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit ||
          claims.type !== "app" || claims.iss !== config.issuer ||
          !Array.isArray(claims.aud) || !claims.aud.includes(config.audience) ||
          claims.common_name !== config.clientId ||
          !Number.isFinite(claims.exp) || claims.exp <= second ||
          !Number.isFinite(claims.iat) || claims.iat > second + 30 || claims.iat >= claims.exp ||
          (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > second + 30))) {
        throw new Error("Wrong claims");
      }
      let keys = await signingKeys(config.issuer);
      const matches = key => key.kid === header.kid && key.kty === "RSA" &&
        key.alg === "RS256" && key.use === "sig";
      let jwk = keys.find(matches);
      // Access rotates signing keys. Refresh once on an unknown key ID.
      if (!jwk) { keys = await signingKeys(config.issuer, true); jwk = keys.find(matches); }
      if (!jwk) throw new Error("Unknown signing key");
      const key = await crypto.subtle.importKey("jwk", jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64URL(parts[2]),
        ENCODER.encode(`${parts[0]}.${parts[1]}`))) throw new Error("Invalid signature");
    } catch {
      throw new VoiceError(401, "Talk to Ember couldn't verify access. Check the shortcut's service token or try again later.");
    }
  }

  return async function handle(context) {
    try {
      const { request, env = {} } = context || {};
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.pathname !== "/api/voice" || url.search) {
        return json({ ok: false, reply: "Not found." }, 404);
      }
      if (request.method !== "POST") {
        return json({ ok: false, reply: "Use POST." }, 405, { allow: "POST" });
      }
      if (env.EMBER_VOICE_ENABLED !== "true") {
        throw new VoiceError(503, "Talk to Ember isn't enabled yet.");
      }
      const config = configuration(env);
      await authenticate(request, config);
      if (!env.EMBER_API || typeof env.EMBER_API.fetch !== "function") {
        throw new VoiceError(503, "Ember's connection is unavailable.");
      }
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new VoiceError(415, "Send the question as JSON.");
      }
      let body;
      try { body = await within(4000, signal => readJSON(request, MAX_BODY, signal)); }
      catch (error) {
        if (error instanceof VoiceError) throw error;
        throw new VoiceError(400, "The shortcut sent an unreadable question.");
      }
      if (!body || Array.isArray(body) || typeof body.text !== "string" ||
          Object.keys(body).some(key => key !== "text")) {
        throw new VoiceError(400, "The shortcut must send one text question.");
      }
      const question = body.text.trim();
      if (!question) throw new VoiceError(400, "I didn't hear a question. Tap the shortcut and try again.");
      if (question.length > MAX_TRANSCRIPT) {
        throw new VoiceError(413, "That question is too long. Please keep it under 2000 characters.");
      }
      const stamp = new Date(now()).toLocaleString("en-US", { timeZone: "America/Chicago",
        weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric",
        minute: "2-digit", timeZoneName: "short" });
      const upstream = (path, payload, signal) => env.EMBER_API.fetch(new Request(ORIGIN + path, {
        method: "POST", signal, headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(payload),
      }));
      const result = await within(deadlines.chat, async signal => {
        const response = await upstream("/api/messages", {
          model: "claude-opus-5", max_tokens: 600, stream: false,
          output_config: { effort: "low" },
          mcp_servers: [{ name: "quo" }, { name: "gmail" }, { name: "calendar" }],
          messages: [
            { role: "user", content: `${CONTEXT}\nCurrent date/time: ${stamp}. Compute today, tomorrow, and look-back windows from this timestamp. Never guess dates.` },
            { role: "assistant", content: "Understood. Ready." },
            { role: "user", content: question },
          ],
        }, signal);
        if (!response.ok) throw new VoiceError(502, "Ember couldn't get a reply right now. Please try again when you're ready.");
        return { data: await readJSON(response, MAX_PROVIDER_BODY, signal),
          degraded: response.headers.get("x-ember-connectors") === "degraded" };
      });
      const answer = Array.isArray(result.data.content) ? result.data.content
        .filter(block => block?.type === "text" && typeof block.text === "string")
        .map(block => block.text).join("\n").trim() : "";
      if (!answer) throw new VoiceError(502, "Ember returned no spoken answer. Please try again when you're ready.");
      const warnings = [];
      if (result.degraded) warnings.push("Live inbox and calendar access was unavailable. I couldn't verify that information.");
      const incomplete = result.data.stop_reason !== "end_turn";
      if (incomplete) warnings.push("This reply is incomplete.");
      // Keep ordinary chat usable during a connector outage, as the main app does,
      // but put the live-data warning first in both the displayed and spoken reply.
      const reply = [...warnings, answer].join(" ");
      let speech = reply;
      if (speech.length > 1000) {
        const excerpt = speech.slice(0, 890);
        const boundary = excerpt.lastIndexOf(" ");
        speech = `${excerpt.slice(0, boundary > 0 ? boundary : 890)}. The rest of the reply is on screen.`;
      }
      let audio = "";
      try {
        audio = await within(deadlines.tts, async signal => {
          const response = await upstream("/api/tts", { text: speech, voice: "en-US-JennyNeural" }, signal);
          if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("audio/mpeg")) {
            throw new Error("TTS unavailable");
          }
          const bytes = await readBytes(response.body, MAX_AUDIO, signal);
          if (!bytes.length) throw new Error("Empty audio");
          return base64(bytes);
        });
      } catch { warnings.push("Ember's audio voice is unavailable; the shortcut can use the iPhone voice."); }
      return json({ ok: true, reply, speech, audio_base64: audio, incomplete, warnings });
    } catch (error) {
      const status = error instanceof VoiceError ? error.status : 502;
      const reply = error instanceof VoiceError ? error.message : "Ember couldn't complete that request. Please try again when you're ready.";
      return json({ ok: false, reply, speech: reply, audio_base64: "" }, status);
    }
  };
}
