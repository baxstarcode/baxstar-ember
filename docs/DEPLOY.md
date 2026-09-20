# Deploying Ember

Last reconciled with source on **2026-09-20**.

**Release status:** source and local tests are ready; the revived Pages build,
same-origin gateway, and Worker host gate have not yet completed the staged production
verification below. Do not call the new boundary live until every release-gate check is
observed in the named environment.

## Production topology

```text
Brady's authenticated browser
  -> Cloudflare Access
  -> https://ember.baxstarfishing.com
  -> Cloudflare Pages (static dist/)
  -> Pages Function for exact /api/* routes
  -> EMBER_API service binding
  -> ember-claude-proxy Worker
  -> Anthropic / neural TTS / read-only MCP providers / private Drive outbox
```

The browser never receives a provider URL, API key, OAuth token, or Worker credential.
It calls only:

- `POST /api/messages`
- `POST /api/tts`
- `POST /api/connectors/status`
- `POST /api/outbox`

`functions/api/[[path]].js` accepts only those paths, POST/OPTIONS, and the exact
hostname `ember.baxstarfishing.com`. Preview and lookalike hosts return 404. It forwards
the original request/stream through the internal `EMBER_API` service binding.

The Worker owns request validation, the model allowlist, body/token caps, provider
destinations, OAuth credentials, connector degradation, TTS, the private Drive-outbox
destination, and server-controlled MCP permissions. Ordinary chat has a reviewed
read-only tool allowlist; all new provider tools default off. Caption Studio can write
only a validated review draft through `/api/outbox`; the browser cannot choose the
destination or supply its token.

After the pending host-gate deploy, the Worker's public `workers.dev` hostname accepts
only manual OAuth GET start/callback routes. Every non-OAuth request there returns 404.
`Origin` is retained for browser CORS, not treated as authentication.

## Canonical deployment files

| File | Responsibility |
| --- | --- |
| `src/baxstar-ember.jsx` | Application source |
| `build.mjs` | Generates self-contained `index.html` |
| `scripts/stage-pages.mjs` | Recreates the exact public `dist/` payload |
| `_routes.json` | Runs Pages Functions only for `/api/*` |
| `functions/api/[[path]].js` | Exact-host same-origin service-binding relay |
| `proxy/cloudflare-worker.js` | Key-holding API/connector/OAuth/TTS Worker |
| `proxy/wrangler.toml` | Worker deployment configuration |

`index.html`, `_preview.html`, and `dist/` are generated outputs. Never edit them by
hand. The historical Vercel adapter is not a supported deployment path.

## Cloudflare configuration

Verify these settings before each release; do not infer them from repository files.

### Pages project

- Project: `baxstar-ember`
- Production branch: `main`
- Build command: `npm run build:pages`
- Build output directory: `dist`
- Root directory: blank/default repository root
- Custom domain: `ember.baxstarfishing.com`
- Cloudflare Access: whole custom hostname, including `/api/*`
- Cloudflare Access: exact production `pages.dev` hostname and wildcard preview
  hostnames; do not leave a static alias outside Access
- Service binding in Production and Preview:
  - variable: `EMBER_API`
  - service: `ember-claude-proxy`

Preview builds are useful for static layout checks only. Their API requests are
intentionally denied by the Function's exact-host rule even though the binding exists.

### Worker

- Worker: `ember-claude-proxy`
- `workers_dev = true` only because the currently registered OAuth callback uses that
  hostname
- `preview_urls = false`
- Production API traffic arrives through the Pages service binding
- `ALLOWED_ORIGINS` remains an exact comma-separated CORS list; it is not an identity
  control

Required/used secrets and variables stay in Cloudflare, never Git:

- `ANTHROPIC_API_KEY`
- `MCP_REFRESH_QUO`, `QUO_CLIENT_ID`
- `MCP_REFRESH_GMAIL`, `MCP_REFRESH_CALENDAR`, `MCP_REFRESH_GDRIVE`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `OAUTH_REDIRECT_URI`, `OAUTH_STATE_SECRET`
- `OUTBOX_URL` (server-only Apps Script capability URL)
- `OUTBOX_TOKEN` (optional; must match the Apps Script shared token when enabled)

Static `MCP_TOKEN_*` values remain compatibility fallbacks in source but short-lived
refresh-token minting is the intended production path.

## Build and local verification

Install dependencies once, then build both the canonical HTML and exact Pages payload:

```bash
npm install
npm run build
npm run build:pages
```

`npm run build` compiles JSX with esbuild and inlines production React, ReactDOM, the
app, and used Tailwind utilities. There is no runtime React/Babel/Tailwind CDN.
`npm run build:pages` then deletes and recreates `dist/` from the explicit public-file
allowlist. Source, tests, repository metadata, and local settings are not uploaded as
static files.

Run the complete local release contract before deployment:

```bash
npm run test:release
```

This rebuilds and stages the exact Pages payload, then runs all current Worker, Pages,
Apps Script, posting-time, chat, dashboard, layout, streaming, Caption Studio, and
voice-probe contracts. Do not convert an obsolete expectation into product behavior;
update the harness when a deliberate contract change is verified.

`./start-ember.sh` remains the fast Python UI preview. It uses same-origin API paths;
the static Python server cannot relay those requests. Use intercepted local tests
and the authenticated production hostname for live API checks.

## Staged release procedure

The order matters. Pages must prove the internal path before the public direct Worker
API is closed.

### 1. Review the release candidate

1. Confirm `git status` contains only intended files.
2. Run the build and relevant tests above.
3. Inspect `dist/`; it should contain only the explicit runtime payload assembled by
   `scripts/stage-pages.mjs`.
4. Review staged changes and scan for keys, tokens, refresh tokens, cookies, or other
   secrets before committing.

### 2. Publish Pages first

1. Push the candidate branch if a preview is useful. Expect the static UI to render and
   `/api/*` to return 404 on the preview hostname.
2. Fast-forward or merge the reviewed commit to `main`; do not force-push.
3. Wait for the `baxstar-ember` production deployment to succeed.
4. Confirm the custom domain serves the new build, not merely the `pages.dev` hostname.
5. From signed-out requests, confirm Cloudflare Access challenges or denies the custom
   hostname, the exact production `pages.dev` alias, and a current preview alias before
   any application HTML or API response is reached.

### 3. Prove the service binding before the Worker host gate

Open the isolated voice lab in a signed-in production tab. Turn **Stream reply** off,
use its typed-only path to send one harmless, connector-free prompt, and confirm a
complete JSON reply through `POST /api/messages`. This proves the Access-protected Pages Function can
reach the existing Worker through `EMBER_API` without exposing credentials.

The historical Worker labels even SSE responses as JSON, so this first binding check
must use `stream:false`. It routes `/tts` and `/connectors/status` separately and has no
outbox relay. It does not yet recognize their new `/api/*` paths, so do not require
the new status, TTS, or outbox checks before deploying the updated Worker. Ordinary
chat/OPS also needs the new Worker's server-owned connector mapping. Treat the Pages
and Worker changes as one release: continue the paired rollout promptly after the
connector-free binding check passes; if it fails, repair or roll back Pages first.

After the Worker deploy, verify the data-free credential check in an authenticated
session:

```js
await fetch("/api/connectors/status", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ connectors: ["quo", "gmail", "calendar", "gdrive"] }),
}).then((response) => response.json());
```

This confirms credentials are available without reading calls, email, calendar, or
Drive content. Complete these checks after the Worker update:

1. enable **Stream reply** again, send one harmless chat prompt, and confirm text streams
   to completion;
2. confirm errors and connector-degraded replies remain readable;
3. open the desktop voice probe and confirm one TTS request returns playable audio;
4. publish one controlled Caption Studio draft and confirm `/api/outbox` returns a
   readable success only after the private Drive file exists;
5. verify the browser network panel shows only same-origin `/api/*` application calls.

If the pre-deploy connector-free message fails, fix the Pages Function, Access policy,
or service binding before touching the Worker host gate. Any failed post-deploy route
keeps the release provisional and requires diagnosis or paired rollback.

### 4. Deploy the Worker host gate

Use a logged-in Wrangler environment. Store the outbox capability interactively before
the first relay deploy; never put its value in source, `wrangler.toml`, command history,
or a browser-visible setting:

```bash
npx wrangler@4.135.0 secret put OUTBOX_URL --config proxy/wrangler.toml
# If the Apps Script deployment has a shared token:
npx wrangler@4.135.0 secret put OUTBOX_TOKEN --config proxy/wrangler.toml
```

A dry run is safe before the live deploy:

```bash
npx wrangler@4.135.0 deploy --dry-run --config proxy/wrangler.toml
npx wrangler@4.135.0 deploy --config proxy/wrangler.toml
```

Cloudflare secrets are retained across ordinary source deploys. Never put them in
`wrangler.toml` or command history.

### 5. Verify both sides after the Worker deploy

Direct API traffic on `workers.dev` must fail before any upstream work, even when a
caller forges the production Origin:

```bash
curl -i -X POST \
  'https://ember-claude-proxy.brady-9d1.workers.dev/api/connectors/status' \
  -H 'Origin: https://ember.baxstarfishing.com' \
  -H 'Content-Type: application/json' \
  --data '{"connectors":["quo"]}'
```

Expected: HTTP 404. Do not accept 200, credential data, an Anthropic response, or a
CORS-only rejection as equivalent.

The registered OAuth GET path must still start without completing consent:

```bash
curl -sS -o /dev/null -D - \
  'https://ember-claude-proxy.brady-9d1.workers.dev/oauth/start?p=google'
```

Expected: a redirect into the Google authorization flow. Do not paste, print, or log
any returned authorization code or token.

Finally repeat the signed-in same-origin credential check, harmless streaming chat,
one controlled OPS sync, TTS probe, and a controlled outbox draft. The release is not
complete if the direct host is closed but the bound production path is broken.

## Connector and OAuth maintenance

The canonical Worker destinations are:

| Name | Endpoint |
| --- | --- |
| Quo | `https://mcp.quo.com/mcp` |
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` |
| Drive | `https://drivemcp.googleapis.com/mcp/v1` |

### Google

One Google consent can supply the three Google refresh secrets. Start it at the
Worker's registered `/oauth/start?p=google` route, complete the signed PKCE flow, and
store the refresh token as each of:

- `MCP_REFRESH_GMAIL`
- `MCP_REFRESH_CALENDAR`
- `MCP_REFRESH_GDRIVE`

Future consent asks for Gmail read, Calendar list/event/free-busy read, and Drive read.
Existing refresh grants created with the former broad scopes are not retroactively
narrowed. Revoke and re-consent before describing the token itself as least-privilege.
Until then, the Worker's read-only tool allowlist is the active write barrier.

### Quo

Start `/oauth/start?p=quo`, approve Ember, and store the returned values as encrypted
`MCP_REFRESH_QUO` and `QUO_CLIENT_ID`. Quo consent requests only
`read:conversations read:account`. Contact reads are omitted because Quo currently
bundles them with a write-capable contact scope.

Never use a Quo API key as an OAuth refresh token. Never put OAuth values in source,
screenshots, logs, chat, or the browser bundle.

### Ordinary chat permissions

The Worker uses `mcp-client-2025-11-20`, creates one top-level `mcp_toolset` per
credentialed server, sets the default to disabled, and enables only reviewed read
tools. It strips browser-supplied server URLs, tokens, toolsets, tool choice, and extra
capability fields.

General chat cannot send messages, create external tasks, modify mail/calendar data,
or write Drive files. Confirmed external actions require a separate API with narrow
permissions, validated arguments, and explicit human review. No such general action
path exists in this release.

## Desktop and iPhone voice release gates

Production hosts the isolated test at:

`https://ember.baxstarfishing.com/work/desktop-voice-probe/`

Its automated suite uses mocked speech, model, TTS, and audio events. Brady must still
complete the README's five-run desktop Chrome checklist with the real microphone and
speakers. Do not merge voice controls into the main app based on HTTP 200, MP3 bytes,
headless playback events, or one successful turn.

Reliable iPhone voice is also an approved goal if feasible. The same isolated lab has
an opt-in phone experiment; its repeated-turn, interruption, permission-recovery, and
microphone-handback results must be recorded on the actual phone before integration.
Desktop results do not satisfy this separate gate.

## Rollback

- If the static app or Pages Function fails, roll Pages back to the last known-good
  production deployment.
- If the Worker host gate breaks the service binding or OAuth, use Cloudflare Worker
  version rollback, then diagnose the mismatch before redeploying.
- Do not restore public direct API access as a permanent workaround. Roll back the
  paired release or fix the internal binding.
- Do not disable `workers.dev` while it remains the registered OAuth callback. Migrate
  `OAUTH_REDIRECT_URI`, Google authorized redirects, and Quo registration together
  before disabling it.
- Rollback does not authorize changing or exposing secrets.

## Production checklist

- [ ] `npm run build:pages` succeeds and recreates the expected `dist/`
- [ ] Worker, Pages, chat, layout, dashboard, and voice-probe suites pass
- [ ] Staged diff contains no secrets and only intended files
- [ ] Pages production deployment from `main` succeeds
- [ ] Custom hostname serves the new build behind Cloudflare Access
- [ ] Unauthenticated custom-host request is challenged/denied
- [ ] Signed-in `/api/connectors/status` works through the Pages binding
- [ ] Signed-in chat streams and degraded/error states remain honest
- [ ] One signed-in TTS request returns playable audio
- [ ] Worker host gate deploy succeeds
- [ ] Direct `workers.dev` API request returns 404 with a forged allowed Origin
- [ ] OAuth start GET still redirects and the Pages API still works
- [ ] Controlled OPS sync returns verified provider data
- [ ] Brady completes the five-run physical Mac voice gate before voice integration
- [ ] iPhone integration, if attempted, follows a separate passing physical lab result
