# Deploying Ember

**Foreground voice integration:** the approved large-skull release is Pages-only.
It reuses the already-live `/api/messages` and Jenny `/api/tts` routes, replacing
the recording-only modal. Do not deploy the Worker, coordinator, or unused
`/api/voice/*` adapters for this change. Earlier recording-only gates below are
historical. The integrated phone/CarPlay surface still requires one foreground
physical check; no background test or new provider activation is part of release.

**Speech-only hotfix, 2026-10-18 (America/Chicago):** the phone's v3 check confirms HTTP 502 with
`provider-refused`, before audio preparation. The deployed v1 connection token
differs from the current edge-tts 7.3.1 v2 protocol (published October 13). The
canonical Worker now uses the v2 token while retaining Jenny and the existing
MP3/SSML contract. This is a bounded compatibility repair, not an official-service
migration or proof of actual phone audibility.

For this one hotfix, **do not deploy `proxy/wrangler.toml`**: it would activate the
separate coordinator cutover. `scripts/prepare-tts-v2-hotfix.py` accepts the private
Cloudflare source download only when its decoded source hash matches the recorded
live `6110e34c` version. It changes one import, the GEC function and the protocol
version, and copies the licensed helper as a separate server module. It proves the
rest of the live source is unchanged. Test that exact candidate with:

```sh
EMBER_TTS_CANDIDATE=/tmp/ember-tts-hotfix/cloudflare-worker.mjs node --test proxy/tts-runtime.test.mjs
```

The deployment owner must re-read the active Worker version/source/settings just
before upload, stop on drift, preserve existing `plain_text` and `secret_text`
bindings using Cloudflare's `keep_bindings` metadata, retain runtime/observability
settings, and upload only the two reviewed modules. Verify the active version,
module hashes and binding names/types after upload. No secrets are printed, copied
or replaced. The previous Worker version is the rollback target for this isolated
pre-coordinator change; after a future coordinator cutover, the older rollback
prohibitions still apply. Canonical source includes the same v2 repair, so the later
full rollout will not regress it. If the real provider still refuses v2, stop this
compatibility path and evaluate a supported Jenny speech service with Brady.

**Voice failure investigation, 2026-10-18:** Brady's signed-in physical test returned
a complete connector-free streamed reply through the production Pages binding.
Live Worker `6110e34c-2363-41c5-a5f6-fab751ecb717` supports the current `/api/*` routes
and response types. This supplies current chat/binding evidence; §3's mandatory
non-streaming first probe describes the older pre-gateway Worker. Spoken output
failed before audio preparation and needs its own diagnosis. A Pages-only lab
diagnostic update does not activate new speech providers, deploy the coordinator,
rotate credentials or establish Gmail/Quo health.

**Mission Control/mobile release, 2026-10-18:** a Pages-only update moves local
board saves to IndexedDB transactions and fixes mobile controls/navigation. No
Worker, credentials, provider consent, model selection, or voice activation changes.
The original localStorage board is retained, with migration on the first edit.
Before rolling back to a pre-transaction UI, download the current board: older
builds only read the legacy recovery copy and will not show newer IndexedDB edits.
Prefer a forward fix or an IndexedDB-aware rollback; do not clear the database.

**Pages-only publication, 2026-10-17:** Brady explicitly requested the current version
on the custom domain. Inspection of the actual live Worker source confirms that
`6110e34c-2363-41c5-a5f6-fab751ecb717` already accepts the current UI model IDs.
The UI can therefore be published while leaving the Worker, existing grants and
secrets unchanged. `EMBER_VOICE_RELEASED=false` retains recording-only voice on
production. The coordinator/fresh-consent/speech cutover below remains pending;
this publication does not perform it. The existing intermittent board multi-tab
save issue is disclosed and remains open; a later green test is not a repair.


**Weather route (2026-11-14):** `/api/weather` (Pages allowlist + Worker, `proxy/weather.mjs`)
takes an empty POST and returns the National Weather Service report for the one place named in
`WEATHER_PLACE` (Detroit Lakes). The browser sends nothing that selects a URL. The Worker calls
only `api.weather.gov` (points, forecast, hourly forecast, active alerts), with a generic
`User-Agent` and no contact details, an 8 s timeout per call and no redirects. Reports are
cached in the isolate for 10 minutes and the grid lookup for a day; an outage serves the last
report marked `stale` for up to 3 hours, then answers 502 `weather_unavailable` and writes one
`{"ember":"weather","outcome":"unavailable"}` line to Workers Logs. No secret, binding or
setting is needed; it ships with the merge through Pages and Workers Builds. To move the
location, change `WEATHER_PLACE` and the place name follows.

**Voice trace route (2026-11-11):** `/api/voice/trace` (Pages allowlist + Worker) accepts
one small JSON record per spoken turn, keeps only allowlisted fields
(`proxy/voice-trace.mjs`), writes one `voice-trace` line to Workers Logs and answers 204.
No secrets, bindings or settings change; it ships with the next merge through Pages and
Workers Builds.

**Voice preview addition (2026-10-17):** the branch adds exact
`/api/voice/transcribe` and `/api/voice/speak` routes, disabled until explicitly
configured. Follow `docs/VOICE-REBUILD.md` for the AI binding, activation, single-writer
check, and real-device/provider proof. This does not replace the staged rollout below
or enable preview API access. No live Worker/secrets were changed for the preview.


Last reconciled with source on **2026-09-20**.

**Release status:** the revived boundary is live. PR #43 merged to `main` at
`add4a8c28c17f70b3463d5ad786833f5e5a7880a`; release commit
`063237de6bfc45eb562eb9dbd82a9eb8b651a6f8` shipped through Pages deployment
`1f56234b-f359-43f2-ba38-c839d2e6b415` and Worker version
`ac3b4578-5a04-4abf-9286-8e95663517d5`. Access, the Pages binding, the public Worker
host gate, OAuth start, signed-in streamed text, ordinary main chat, live OPS sync, and
the isolated lab's browser TTS cycle have production evidence. The dedicated
connector-status call, one controlled Drive-outbox write, and physical voice gates
remain open.

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

The deployed Worker's public `workers.dev` hostname accepts only manual OAuth GET
start/callback routes. Forged-Origin POSTs to all four `/api/*` routes returned 404 on
both ordinary and trailing-dot host forms. `Origin` is retained for browser CORS, not
treated as authentication.

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
- `MCP_COORDINATED_REFRESH_QUO`, `QUO_CLIENT_ID`
- `MCP_COORDINATED_REFRESH_GOOGLE` (one fresh grant shared by Gmail, Calendar, Drive)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `OAUTH_REDIRECT_URI`, `OAUTH_STATE_SECRET`
- `OUTBOX_URL` (server-only Apps Script capability URL)
- `OUTBOX_TOKEN` (optional; must match the Apps Script shared token when enabled)

Static `MCP_TOKEN_*` values remain compatibility fallbacks in source but short-lived
refresh-token minting is the intended production path.

### Durable token owner — deployed 2026-10-26

**Cutover record, 2026-10-26 (Claude Code, Brady's Quo-reconnection handoff):**
before the change, live was `f8d6ac15-844d-4e59-b0ed-20f8822dcf09` at 100%, with 2
vars (both identical in `wrangler.toml`) and 10 secrets, plus no KV/DO/service/AI
bindings, crons or custom domains. One full `npx wrangler deploy` from merged main
`b10b1d1` (PR #60) produced `0283d68b-553e-4b09-9b14-896445227cde`, which carries the
coordinator, migration `ember-token-coordinator-v1`, `EMBER_VOICE_AI` and all 10
secrets. Brady completed fresh consent and saved both seeds in the dashboard. Cloudflare
auto-deployed `4d824627` (Google seed, 20:19 UTC) and then
`47108b31-7ae5-46af-982c-337eaf15eb4e` (Quo seed, 20:25 UTC), keeping every binding.
At 15:32 CDT Brady's signed-in page showed QUO / GMAIL / CALENDAR lit, LIVE, a real
Quo missed call, live Gmail and Calendar rows, and a chat reply. He reported that
the Signal Log and a spoken reply also worked. Anonymous `workers.dev` API routes
still return 404. **PROVISIONAL (never run; the grant died between 10-26 and 11-01
unnoticed, see `docs/KNOWN-ISSUES.md` 1b):** the step-4 recheck after access-token expiry. The
legacy `MCP_REFRESH_*` secrets remain on the Worker unused (required mode never reads
them); deleting them and revoking the old grants is Brady's call.

`proxy/wrangler.toml` now declares `EMBER_TOKEN_COORDINATOR`, a SQLite-backed
`EmberTokenCoordinator` Durable Object, and migration `ember-token-coordinator-v1`.
`TOKEN_COORDINATOR_REQUIRED = "true"` prevents a missing/broken binding from falling
back to legacy refreshes. One object owns each provider/client/consent grant; Google's
three connectors share that object. Changing the Google client secret retains the
owner; fresh consent creates a new owner. Bind this namespace only to Ember.

Since 2026-10-26 the same file also sets `EMBER_VOICE_ENABLED = "true"` and the
`[ai]` binding `EMBER_VOICE_AI` (`docs/VOICE-REBUILD.md`), so one full
`npx wrangler deploy` from `proxy/` ships the coordinator and the speech routes
together.

The owner stores access and refresh tokens server-side, serializes refreshes, and
commits a refresh-intent marker before calling the provider. It saves the replacement
before returning access. If the provider reply is lost, malformed, rejected, or times
out, the marker prevents token reuse after a restart. A failed final save can be
retried while the same object retains the response; if that object is lost first,
fresh consent is required. OAuth and local storage cannot form one atomic transaction.
This deliberately favors reconnecting over replaying a possibly spent token.

Do not copy old `MCP_REFRESH_*` values or KV records into the new seed secrets. They
may already be retired. The old isolate-local/KV path remains only for configurations
that have neither the binding nor the required-mode variable; it is not the rollout
target. Existing `MCP_TOKEN_*` static access tokens remain explicit compatibility
fallbacks, but cannot refresh a grant.

Cut over with an authenticated Cloudflare operator:

1. Record the active Worker version/bindings and verify the Access-protected Pages
   gateway and connector-free chat. Use a full Worker deployment, not a gradual split
   between legacy and coordinated refresh code. Preserve existing API/OAuth secrets.
2. Deploy the coordinator configuration before the Pages UI release. Until fresh
   seed secrets exist, refreshed connectors report offline; ordinary chat still works.
   Do not disable required mode to hide that expected setup state.
3. Complete fresh Google and Quo consent via the registered `/oauth/start` routes.
   Store the returned values only in the encrypted secrets named by the callback:
   `MCP_COORDINATED_REFRESH_GOOGLE` and `MCP_COORDINATED_REFRESH_QUO`. Preserve/set
   the matching client IDs. Do not share these grants with the legacy path or another
   application. Revoke superseded grants as appropriate; never paste tokens into chat.
4. Through the authenticated Pages binding, check data-free connector status, one
   approved read per provider, and model compatibility. Repeat status after access
   expiry and after a Worker redeploy to verify persistent ownership on the real account.
   Record states and timings only. Then complete the Pages/model rollout below.

If a durable grant reports offline after an ambiguous refresh, re-consent and replace
its coordinated seed secret; deleting its record or namespace would risk replaying
the original token. Do not roll back to legacy refresh code or reuse its seeds after
cutover. Keep the binding, migration history, and durable state during rollback.
If a provider returns the same seed again, revoke Ember's old grant there and repeat
consent to obtain a new grant; do not erase the stop marker to force a retry.

The data-free status route may include an `issues` map for offline connectors:
`setup_required`, `reconnect_required`, or `temporarily_unavailable`. The dashboard
renders these as setup incomplete, needs a new sign-in, or try Sync again. Only those
fixed codes leave the Worker; tokens, grant identities, and raw provider/storage errors
remain private. Successful authorization clears the issue and a successful feed sync
clears the stale note.

### In-app reconnect and grant health — deployed 2026-11-08 (Worker `7736245b`)

Why: on 11-08 Quo read `reconnect_required` 13 days after the 10-26 consent, and the
owner had recorded nothing about why. Recovery also meant copying a token from the
callback page into the Cloudflare dashboard.

What changes (Worker and Pages gateway; same `EmberTokenCoordinator` class, so **no new
binding or migration**):

- The owner classifies each renewal: HTTP 400/401/403 = `provider_rejected` (record
  becomes `rejected`, finished; Quo's MCP docs treat `invalid_grant` as "authorize
  again", never a retry loop); HTTP 429 or OAuth `temporarily_unavailable`/`slow_down`
  = `rate_limited` (the unspent token is kept and retried after Retry-After, 1–60 min).
  **Ambiguous outcomes retry (second 11-08 pass, root-cause fix):** no reply, 5xx,
  redirects, an unreadable reply (`no_reply`, `provider_error`, `bad_reply`) and a call
  cut off by a restart (`interrupted`) keep the held token and retry it at 1, 5, 15,
  30, 60, 60, 60 and 60 minutes (about 5 hours), with the Durable Object alarm armed
  for each slot so retries happen while Ember is closed. The ninth consecutive
  ambiguous failure ends the grant (`phase: "stopped"`, token dropped). The old
  durable stop could never save a grant: if the provider had rotated, the new token
  was already lost; if it had not, the stop threw away a working one. A pre-11-08
  marker that kept no token still reads `interrupted` and needs Reconnect. Token
  call timeout is 15 s (was 8 s); discovery stays 8 s, is cached for a day and is
  re-run after an ambiguous failure; the discovered Quo token endpoint must be
  HTTPS on `quo.com` or a subdomain.
- Every outcome writes one Workers Logs line, e.g.
  `{"ember":"token-owner","provider":"quo","mode":"app","trigger":"keepalive","outcome":"renewed","rotated":true,"renewals":3}`.
  Fixed words and counts only; never a token.
- `POST /api/connectors/status` adds `health` per connector: `source` (`app`/`setup`),
  `connectedAt` (an app grant's consent time; for a setup-seed grant, the first renewal
  this Worker recorded), `lastRenewedAt`, `renewals`, `rotations`, and when stopped or
  retrying `failure`, `failedAt`, `httpStatus`, `oauthError`, `retryAt`, `attempts`.
- The status route answers **HTTP 207** (same JSON body) whenever a requested connector
  is down, and **200 only when every requested connector is up**, plus one
  `{"ember":"connector-status","down":{…}}` log line naming each down connector's
  reason and failure. Before this, it answered 200 for the whole week Quo was dead, so
  Workers Logs looked healthy. 207 is still `res.ok`, so every existing caller keeps
  working.
- A successful renewal or install arms a Durable Object alarm 12 hours out; the alarm
  renews the grant and re-arms. A stopped grant is never renewed.
- `POST /api/connectors/reconnect` (Access-gated Pages route) returns a 10-minute signed
  ticket link to `/oauth/start?ticket=…`. Consent that starts from a ticket is saved by
  the callback straight into one fixed **app owner** per provider and client (name =
  hash of `app-grant-v1`, provider, client id). The token is never shown. A newer
  reconnect replaces the previous app grant; the setup-seed owner is never touched and
  its seed is never adopted. Access tries the app owner first, then the seed owner.
  The manual `/oauth/start?p=…` copy-paste route still works unchanged.

Release order (one owner):

1. **Cloudflare access — Workers Builds (Brady's decision, 2026-11-08: "Connect Worker
   to GitHub").** The Worker is connected to `baxstarcode/baxstar-ember` in Cloudflare
   (Worker → Settings → Build): production branch `main`, root directory `proxy`,
   deploy command `npx wrangler deploy`, build watch path `proxy/*` (UI- or docs-only
   merges do not redeploy the Worker). Merging a change under `proxy/` to `main` deploys
   the Worker the way Cloudflare Pages already ships the UI, with Cloudflare's own build
   token; no agent needs a Cloudflare API token. First build: `a157305a` → `7736245b`
   (2026-11-08 23:47 CST), replacing `47108b31`. Undo: Worker → Settings → Build → Disconnect.
   A manual deploy still works with an **Edit Cloudflare Workers** token (7-day expiry,
   never pasted into chat) or `wrangler login` on a Mac with Node.
2. Record the live state: `npx wrangler deployments status` and
   `npx wrangler versions view <id>` in `proxy/`. Expect `47108b31-7ae5-46af-982c-337eaf15eb4e`
   with `EMBER_TOKEN_COORDINATOR`, `EMBER_VOICE_AI`, `ALLOWED_ORIGINS`,
   `OAUTH_REDIRECT_URI`, `TOKEN_COORDINATOR_REQUIRED`, `EMBER_VOICE_ENABLED` and the
   existing secrets. Stop if anything else changed. Optional: `npx wrangler tail
   ember-claude-proxy --format json` while Brady presses SYNC; the old Worker logs no
   reason, so expect only the 503 from the stopped owner.
3. Deploy the Worker from the reviewed branch or merged main: `npx wrangler deploy`
   (full deployment). Check `/api/connectors/status` still answers through Pages; Quo
   stays offline until step 5, now with `health.quo.failure`.
4. Merge the PR so Pages ships the Reconnect button (it calls the route from step 3;
   shipped first it would show "Could not start the Quo sign-in").
5. **Brady:** open ember.baxstarfishing.com → Calls & Voicemail → **Reconnect Quo** →
   approve in the Quo tab → close it. Ember re-syncs on return. Expect the Quo light lit,
   real calls, and the Signal Log Quo row reading Verified read.
6. Persistence evidence, not just one fresh request: after more than 1 hour (first access
   token expiry) and again after 12+ hours, check `wrangler tail`/Workers Logs for
   `"outcome":"renewed"` with `"rotated":true`, and `health.quo.renewals` climbing in
   status. Record times and counts only. **Done 2026-11-09:** four rotating renewals at
   08:27, 14:08, 16:14 and 21:37 UTC (renewals 1→4), no `deferred`/`stopped` lines; the
   idle 12-hour keep-alive has not fired yet because each renewal re-arms it.
7. Clean up: delete the API token in Cloudflare; remove the stale, invalid
   `CLOUDFLARE_API_TOKEN` variable from the `baxstar-booking` and Default cloud
   environments.

Rollback: `npx wrangler rollback` to `47108b31`. The app grant stays in Durable Object
storage, unread by the old code, so Quo would go offline again until the new Worker
returns; never delete owner records or the namespace.

Platform constraints verified from Cloudflare's
[state API](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile),
[SQLite migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/),
and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):
SQLite Durable Objects are available on Workers Free, subject to daily limits.
Provider calls are bounded at 8 seconds each, below the concurrency guard's 30-second
deadline. Local workerd/SQLite tests and Wrangler dry-run passed; account provisioning,
fresh consent, live provider behavior, and deployment remain unverified.

Model releases go Worker first: the Worker's `ALLOWED_MODELS` must accept a model before
the Pages build that sends it is merged (2026-10-15: the four newest IDs, old IDs kept
for the cut-over).

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
Apps Script, coordinated-token workerd/SQLite, posting-time, chat, dashboard, layout, streaming, Caption Studio, and
voice-probe contracts, including local board concurrency/recovery and touch mobile
usability. Do not convert an obsolete expectation into product behavior;
update the harness when a deliberate contract change is verified.

For a managed environment with system Chromium, run
`CHROME_PATH=/usr/bin/chromium npm run test:release`. All browser harnesses honor the
explicit path; CI keeps its pinned Playwright Chromium and branded Chrome defaults.
The voice suite mocks recognition/playback. Neither browser selection proves physical
microphone or speaker behavior. Miniflare is a pinned development-only dependency;
the coordinator adds no browser dependency and makes no live provider calls in tests.

`./start-ember.sh` remains the fast Python UI preview. It uses same-origin API paths;
the static Python server cannot relay those requests. Use intercepted local tests
and the authenticated production hostname for live API checks.

## Current deployment evidence

The 2026-09-20 release recorded:

- 562/562 local release checks and 11/11 matching sponsor handles;
- the merged release rendered through Pages on the custom hostname;
- unauthenticated requests to the custom host, custom `/api/messages`, exact production
  Pages alias, and current deployment alias redirected to Cloudflare Access;
- a signed-in connector-free `stream:false` lab request completed through the Pages
  binding in 1.3 seconds before the Worker update;
- the Worker deployed with existing secrets preserved and server-only `OUTBOX_URL`
  configured; no provider key or OAuth grant was rotated for this release;
- after the Worker update, a signed-in streamed lab reply completed in 1.4 seconds;
- explicit lab Play reached browser `playing` and `ended`, then returned the UI to
  `Playback ended` with the mic off; physical audibility and quality were not tested;
- all eight forged-Origin public-host POST probes returned 404, while Google OAuth
  start redirected to `accounts.google.com`;
- ordinary main chat completed, live OPS auto-sync populated provider-derived panels,
  one connector-degraded response was surfaced honestly, and the focused follow-up
  completed without the degraded banner;
- the Drive librarian found the Ember Handoff Log by title; no file contents were read.

Still pending: the signed-in data-free `/api/connectors/status` call, one controlled
`/api/outbox` write confirmed by the private Drive file, and the Mac/iPhone physical
voice gates.

## Staged release procedure

The 2026-09-20 release completed the paired Pages → binding proof → Worker deployment;
the remaining post-release checks are listed above. Keep this as the required
procedure for future paired releases: Pages must prove the internal path before the
public direct Worker API is closed.

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

One fresh Google consent supplies `MCP_COORDINATED_REFRESH_GOOGLE` for all three
Google connectors. Start at the Worker's registered `/oauth/start?p=google` route,
complete the signed PKCE flow, and store the returned token as that encrypted secret.
The callback names the legacy three `MCP_REFRESH_*` secrets only when coordinated
mode is absent; do not use that legacy configuration for this rollout.

Future consent asks for Gmail read, Calendar list/event/free-busy read, and Drive read.
Existing refresh grants created with the former broad scopes are not retroactively
narrowed. Revoke and re-consent before describing the token itself as least-privilege.
Until then, the Worker's read-only tool allowlist is the active write barrier.

### Quo

Start `/oauth/start?p=quo`, approve Ember, and store the returned values as encrypted
`MCP_COORDINATED_REFRESH_QUO` and `QUO_CLIENT_ID`. Quo consent requests only
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
- If the Worker host gate breaks the service binding or OAuth, use a known-good
  coordinator-capable Worker version after token cutover. Preserve durable state and
  the binding; returning to legacy refresh code can replay retired tokens. Diagnose
  the mismatch before redeploying.
- Do not restore public direct API access as a permanent workaround. Roll back the
  paired release or fix the internal binding.
- Do not disable `workers.dev` while it remains the registered OAuth callback. Migrate
  `OAUTH_REDIRECT_URI`, Google authorized redirects, and Quo registration together
  before disabling it.
- Rollback does not authorize changing or exposing secrets.

## Production checklist

- [x] `npm run build:pages` succeeds and recreates the expected `dist/`
- [x] Worker, Pages, chat, layout, dashboard, and voice-probe suites pass
- [x] Staged diff contains no secrets and only intended files
- [x] Pages production deployment from `main` succeeds
- [x] Custom hostname serves the new build behind Cloudflare Access
- [x] Custom host, API path, exact Pages alias, and deployment alias are challenged
- [ ] Signed-in `/api/connectors/status` works through the Pages binding
- [x] Signed-in chat streams and connector degradation/recovery remain honest
- [x] One signed-in TTS request reaches browser `playing` and `ended` states
- [x] Worker host gate deploy succeeds
- [x] All four direct API routes return 404 on ordinary and trailing-dot public hosts
- [x] OAuth start GET still redirects and the Pages API still works
- [x] Controlled OPS sync returns verified provider data
- [ ] Controlled `/api/outbox` draft creates the expected private Drive file
- [ ] Brady completes the five-run physical Mac voice gate before voice integration
- [ ] iPhone integration, if attempted, follows a separate passing physical lab result
