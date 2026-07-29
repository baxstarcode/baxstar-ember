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
`http://localhost:8787`, uncomment `window.EMBER_API_PROXY` in
`scripts/sync-standalone.py`'s config block, then `./start-ember.sh`. That gives you a
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
- Refuses any model outside Ember's three, so a leaked URL can't be repurposed
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

## 4. Connectors: what the proxy does NOT solve

The proxy gives hosted Ember a working brain. It does **not** by itself give it
Quo, Gmail, Calendar, or Drive.

Those are MCP connectors. Each needs an OAuth `authorization_token` for Brady's
account, and inside a Claude artifact the platform supplies them. Hosted, nothing
supplies them — so `mcp_servers` calls will fail even though chat works.

The proxy is ready for the tokens once you have them. Set any you have as secrets and
it attaches them per server:

```bash
npx wrangler secret put MCP_TOKEN_QUO
npx wrangler secret put MCP_TOKEN_GMAIL
npx wrangler secret put MCP_TOKEN_CALENDAR
npx wrangler secret put MCP_TOKEN_GDRIVE
```

Getting those tokens means running each connector's OAuth flow yourself and storing
the result — that work is not done yet. Until it is, expect this from a hosted Ember:

- **Works:** Claude Chat, Caption Studio, HTML Viewer, Image Filters, Snippets,
  AI Handoff, GitHub (its own token), and every "Brief my day"-style prompt that
  doesn't need a connector.
- **Fails:** "What'd I miss", Triage inbox, Schedule, Drive Librarian, and anything
  else that reaches Quo / Gmail / Calendar / Drive.

Deploy knowing that. Don't promise the connectors until the OAuth work is done.

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
- [ ] You know the connectors won't work yet (§4) and you're fine with that
- [ ] No API key anywhere in git — `git log -p | grep -i "sk-ant"` comes back empty
