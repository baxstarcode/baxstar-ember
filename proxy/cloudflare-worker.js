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
 *   MCP_TOKEN_QUO, MCP_TOKEN_GMAIL, MCP_TOKEN_CALENDAR, MCP_TOKEN_GDRIVE
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Required for the mcp_servers field. Without it the API rejects MCP requests.
const MCP_BETA = "mcp-client-2025-04-04";

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

/**
 * Attach connector OAuth tokens from secrets. Ember's front end never sees these.
 *
 * Servers we hold no token for are dropped rather than passed through. The API
 * rejects the entire request if any listed server fails to authenticate, so
 * forwarding an unauthorized connector takes plain chat down with it — and the
 * app sends its full connector list on every message.
 */
function injectMcpTokens(servers, env) {
  if (!Array.isArray(servers)) return [];
  const tokens = {
    quo: env.MCP_TOKEN_QUO,
    gmail: env.MCP_TOKEN_GMAIL,
    calendar: env.MCP_TOKEN_CALENDAR,
    gdrive: env.MCP_TOKEN_GDRIVE,
  };
  return servers.flatMap((s) => {
    const t = s && s.name ? tokens[s.name] : null;
    return t ? [{ ...s, authorization_token: t }] : [];
  });
}

export default {
  async fetch(request, env) {
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
      const authorized = injectMcpTokens(body.mcp_servers, env);
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

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: "Upstream request failed." }, 502, cors);
    }

    // Pass the response through, but only headers we choose.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
