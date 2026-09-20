# Deploying Ember

Ember runs in two places. Know which one you're doing.

| | Where the key comes from | What works |
|---|---|---|
| **Claude artifact** (today) | Injected by the Claude platform | Everything |
| **Hosted at a URL** | A proxy you deploy | Chat + Studio. Connectors need extra work — see §4 |

---

## 1. Build

`index.html` is generated. Never edit it by hand — that is how the deploy build
drifted an entire redesign behind `src/baxstar-ember.jsx` once already.

```bash
npm install     # once
npm run build   # regenerates index.html from src/baxstar-ember.jsx
```

The build inlines only the Tailwind utilities the source actually uses (~11KB), so
there is no CSS CDN at runtime and no flash of unstyled content.

Preview locally:

```bash
npm run serve   # http://localhost:8080
```

React, ReactDOM, and Babel still load from unpkg at runtime. That means Ember needs
network access to unpkg on first paint, and Babel compiles ~200KB in the browser on
every load. Fine for personal use; see §5 if you want it faster.

---

## 2. Stand up the proxy

`index.html` ships to every visitor, so it can never hold an API key. The proxy holds
the key server-side and is the only thing the browser talks to.

### Cloudflare Worker, browser only (recommended — no Node required)

`wrangler` needs Node, and **there is no Node on Brady's Mac**. This route installs
nothing. Everything happens at dash.cloudflare.com.

1. Get an API key at console.anthropic.com → API keys. Copy it once; you cannot see it again.
2. dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**.
   Name it `ember-claude-proxy`. Deploy the placeholder it offers.
3. **Edit code**. Select all, delete, and paste the whole of
   `proxy/cloudflare-worker.js` from this repo. **Deploy**.
4. **Settings → Variables and Secrets**:
   - Add a **Secret** — name `ANTHROPIC_API_KEY`, value your key.
     Secret, not plaintext: plaintext vars are readable from the dashboard afterwards.
   - Add a **Variable** — name `ALLOWED_ORIGINS`, value the exact origin Ember runs on.
     For local testing that is `http://localhost:8787`. No trailing slash.
5. **Deploy** again so the variables take effect.

Your endpoint is `https://ember-claude-proxy.<your-subdomain>.workers.dev`.

**Try it locally before hosting anything.** Set `ALLOWED_ORIGINS` to
`http://localhost:8787` — `window.EMBER_API_PROXY` in `scripts/sync-standalone.py`
is already pointed at the live Worker — then `./start-ember.sh`. That gives you a
live Ember with a working brain on your own machine — no hosting, no domain.

### Cloudflare Worker via CLI (needs Node)

```bash
cd proxy
npx wrangler secret put ANTHROPIC_API_KEY     # paste the key when prompted
npx wrangler deploy
```

Then edit `proxy/wrangler.toml` and set `ALLOWED_ORIGINS` to wherever Ember is hosted:

```toml
[vars]
ALLOWED_ORIGINS = "https://ember.baxstarfishing.com"
```

Redeploy after changing it. **Do not leave this permissive.** An open proxy lets
anyone on the internet spend your Anthropic balance.

### Vercel (alternative)

Copy `proxy/vercel/` into a Vercel project. The endpoint lands at `/api/claude`.
Set `ANTHROPIC_API_KEY` and `ALLOWED_ORIGINS` in the dashboard under
Settings → Environment Variables. A Netlify Function is the same file with the
handler signature swapped.

### What the proxy does for you

- Holds the key. Nothing sensitive reaches the browser.
- Adds `anthropic-version` and, for MCP requests, the `anthropic-beta:
  mcp-client-2025-04-04` header the `mcp_servers` field requires.
- Refuses any model outside Ember's five, so a leaked URL can't be repurposed
  into a general-purpose model proxy.
- Caps `max_tokens` and request size.
- Enforces the origin allowlist server-side as well as via CORS, so a non-browser
  client can't just skip the CORS check.

---

## 3. Point Ember at it

In `index.html`, uncomment the config line near the top and set your proxy URL:

```js
window.EMBER_API_PROXY = "https://ember-claude-proxy.YOUR-SUBDOMAIN.workers.dev";
```

Better: set it in `build.mjs`'s config block so it survives the next rebuild.

Left unset, Ember calls `api.anthropic.com` directly. That only works inside a Claude
artifact. Hosted, you'll get a clear error naming this file rather than a silent dead brain.

---

## 4. Connectors: Quo live; Google revoked 2026-09-06, re-key to restore

**Current state (verified 2026-09-20 via `/connectors/status`):** `quo` connected;
`gmail`, `calendar`, `gdrive` offline. Google is offline because the 2026-09-06 Ember
park deliberately revoked the Worker's Google grant (the `brady-9d1.workers.dev` client),
which invalidated the `MCP_REFRESH_*` tokens. Nothing else changed — the re-key flow
below is the whole fix. (An Apps Script "Ember Google Connector" was built 08-15 while
the MCP endpoints were blocked on preview enrollment; enrollment was approved 08-22, the
MCP path went live, and the Apps Script connector was never wired in and is archived.
It is not the plan of record.)

The Worker holds Google OAuth **refresh tokens** as secrets (`MCP_REFRESH_GMAIL`,
`MCP_REFRESH_CALENDAR`, `MCP_REFRESH_GDRIVE` — same token, all three) and mints access
tokens per request for the **Google Workspace MCP** endpoints
(`calendarmcp` / `gmailmcp` / `drivemcp.googleapis.com`). Those endpoints are a
Developer Preview and require project enrollment — Google Cloud project
**ember-504105** was approved 2026-08-22. Verified live the same day: real
calendar events, real unread Gmail, real Drive files through hosted chat.

To (re-)run the OAuth flow, e.g. after token revocation: visit the Worker's
`/oauth/start?p=google` as brady@baxstarfishing.com, click Allow, paste the shown
refresh token into all three `MCP_REFRESH_*` secrets on the Worker's Variables and
Secrets page and use that page's own Deploy button — no code paste is needed.
`OAUTH_STATE_SECRET` and `OAUTH_REDIRECT_URI` must be set in Worker variables first.
Brady pastes the token himself; no agent reads or repeats it.

**Quo changed its MCP setup in Aug 2026.** Custom clients now use
`https://mcp.quo.com/mcp` with OAuth 2.1. The old descope is historical
(`docs/KNOWN-ISSUES.md` §11).

To connect Quo:

1. Visit the Worker's `/oauth/start?p=quo` URL and approve Ember in Quo.
2. On the callback page, copy the returned refresh token and generated client ID.
3. In Cloudflare Worker variables, add both as encrypted secrets:
   `MCP_REFRESH_QUO` and `QUO_CLIENT_ID`.
4. Redeploy the Worker.

Do not use a Quo API key as `MCP_TOKEN_QUO`; Quo's MCP server expects an OAuth
access token.

After deploying the current Worker, credential health can be checked without
reading any calls, messages, email, calendar, or Drive data:

```bash
curl -sS https://ember-claude-proxy.brady-9d1.workers.dev/connectors/status \
  -H 'Origin: https://ember.baxstarfishing.com' \
  -H 'Content-Type: application/json' \
  --data '{"connectors":["quo","gmail","calendar","gdrive"]}'
```

If a connector call fails, the Worker retries without connectors and flags the
response with the `x-ember-connectors: degraded` header, which the app surfaces —
so a dead connector degrades to plain chat instead of a dead brain.

---

## 5. Optional hardening

- **Vendor React and Babel.** Drops the unpkg runtime dependency and the in-browser
  compile. Precompiling the JSX at build time would cut first paint substantially.
- **Put Ember behind auth.** It's a personal command center. Cloudflare Access or
  Zero Trust in front of the whole page costs nothing on the free tier.
- **Rotate the key** if it was ever pasted into a chat, a file, or a screenshot.

---

## Checklist before going live

- [ ] `npm run build` run, `index.html` regenerated
- [x] Proxy deployed, `ANTHROPIC_API_KEY` set as a secret (not in any file)
- [ ] `ALLOWED_ORIGINS` set to the real origin, redeployed
- [x] `window.EMBER_API_PROXY` pointed at the proxy (in `scripts/sync-standalone.py`)
- [x] Chat tested end to end through the proxy (7 probes, incl. a live reply)
- [x] Gmail, Calendar, and Drive OAuth installed and live (§4)
- [ ] Quo consent complete; `MCP_REFRESH_QUO` + `QUO_CLIENT_ID` stored and Worker redeployed
- [ ] No API key anywhere in git — `git log -p | grep -i "sk-ant"` comes back empty
