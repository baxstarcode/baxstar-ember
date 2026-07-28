/**
 * EMBER — Anthropic API proxy (Vercel serverless function)
 *
 * Alternative to proxy/cloudflare-worker.js. Same contract, same protections.
 * Drop this repo's proxy/vercel/ directory into a Vercel project and the endpoint
 * lands at /api/claude. Point Ember at it with window.EMBER_API_PROXY.
 *
 * Environment variables (Vercel dashboard → Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   required
 *   ALLOWED_ORIGINS     required — comma-separated exact origins
 *   MCP_TOKEN_QUO / _GMAIL / _CALENDAR / _GDRIVE   optional, see docs/DEPLOY.md
 *
 * A Netlify Function is the same file with the handler signature swapped for
 * (event, context) and `res.*` replaced by a returned { statusCode, headers, body }.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MCP_BETA = "mcp-client-2025-04-04";

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-fable-5",
]);

const MAX_TOKENS_CAP = 4096;

const origins = () =>
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function injectMcpTokens(servers) {
  if (!Array.isArray(servers)) return servers;
  const tokens = {
    quo: process.env.MCP_TOKEN_QUO,
    gmail: process.env.MCP_TOKEN_GMAIL,
    calendar: process.env.MCP_TOKEN_CALENDAR,
    gdrive: process.env.MCP_TOKEN_GDRIVE,
  };
  return servers.map((s) => {
    const t = s && s.name ? tokens[s.name] : null;
    return t ? { ...s, authorization_token: t } : s;
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const list = origins();
  const originOk = origin && list.includes(origin);

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (originOk) res.setHeader("Access-Control-Allow-Origin", origin);

  if (req.method === "OPTIONS") return res.status(originOk ? 204 : 403).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!list.length)
    return res
      .status(500)
      .json({ error: "Proxy misconfigured: ALLOWED_ORIGINS is not set." });
  if (!originOk) return res.status(403).json({ error: "Origin not allowed." });
  if (!process.env.ANTHROPIC_API_KEY)
    return res
      .status(500)
      .json({ error: "Proxy misconfigured: ANTHROPIC_API_KEY is not set." });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || !ALLOWED_MODELS.has(body.model))
    return res
      .status(400)
      .json({ error: `Model not allowed: ${body && body.model}` });

  body.max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP);
  if (body.mcp_servers) body.mcp_servers = injectMcpTokens(body.mcp_servers);

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (body.mcp_servers) headers["anthropic-beta"] = MCP_BETA;

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: "Upstream request failed." });
  }
}
