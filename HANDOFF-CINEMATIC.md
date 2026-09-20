# Ember — Living Cinematic Handoff

Checkpoint date: **2026-09-20**. This is the compact continuation brief for any
builder entering Ember cold. Git history preserves the long design chronology; this
file records what is load-bearing now.

## Mission and status

Ember is Brady Baxter's desktop-first AI command center for Baxstar Fishing and Lakes
Golf Simulator. OPS, chat, Mission Control, Projects, Studio, the tools rail, and the
conditional desktop-voice experiment are surfaces of one daily operating system.

The desktop revival is implemented and locally verified. Production rollout of the
new Pages gateway and Worker host gate is still pending. Desktop voice remains outside
the main app until Brady completes the physical five-run Mac Chrome gate. Reliable
iPhone voice is also preferred if feasible, with a separate isolated reliability lab
and physical test before integration.

Repository: `baxstarcode/baxstar-ember` (private). Production target:
`https://ember.baxstarfishing.com`, behind Cloudflare Access.

## Source ownership

| Concern | Canonical owner |
| --- | --- |
| Application behavior, markup, and inline CSS | `src/baxstar-ember.jsx` |
| Key-holding AI, connector, OAuth, and TTS gateway | `proxy/cloudflare-worker.js` |
| Same-origin Pages API relay | `functions/api/[[path]].js` |
| Production HTML generation | `build.mjs` -> `index.html` |
| Pages public payload | `scripts/stage-pages.mjs` -> `dist/` |
| Local preview generation | `scripts/sync-standalone.py` -> `_preview.html` |
| Desktop and opt-in iPhone voice lab | `work/desktop-voice-probe/` |
| Design constitution | `docs/BUILD-PROMPT.md` |
| Active status and risks | `docs/CURRENT-STATE.md`, `docs/KNOWN-ISSUES.md` |
| Ownership/provenance | `SOURCES-OF-TRUTH.md` |

Never edit `index.html`, `_preview.html`, or `dist/` by hand. One owner per generated
artifact is the rule that prevents source/build drift.

## Product behavior

- **OPS** shows calls/voicemail, unread mail, schedule, manual revenue, quick actions,
  a full chat thread, YOUR TOOLS, and the collapsed read-only THE WORKS relationship
  map. Sync auto-runs once in the hosted app and remains manually refreshable.
- **Chat** streams and persists completed context. It supports Stop, Retry, Copy,
  Clear, Enter-to-send, Shift+Enter, useful error text, and connector-degraded truth.
  A stopped, failed, or truncated assistant turn is not reused as context.
- **Communications actions** create editable reply or local-task drafts. Nothing is
  sent automatically. Saving a task writes once to the browser-local Baxstar Ember
  Mission Control project and explicitly says it was not sent to Quo.
- **Mission Control** is editable and local to the browser. **Projects** is the lighter
  source-maintained progress view. They coexist intentionally until Brady chooses one
  authoritative shared data source.
- **Studio** contains Caption Studio, AI Handoff, Drive librarian, HTML Viewer, Image
  Filters, GitHub, and Snippets. Caption output goes through the same-origin server
  gateway to a private Drive outbox for review; the browser never receives its Apps
  Script destination or token, and it never posts directly to social media.
- **Connectors** are optional. Plain chat remains usable without them, but OPS sync
  fails honestly and keeps the last live data or demo preview rather than inventing a
  successful feed.

## Production boundary

```text
Cloudflare Access
  -> ember.baxstarfishing.com / Pages dist
  -> exact same-origin /api/* Pages Function
  -> EMBER_API service binding
  -> ember-claude-proxy Worker
  -> Anthropic, neural TTS, Quo/Gmail/Calendar/Drive MCP, private Drive outbox
```

The browser calls only `/api/messages`, `/api/tts`, `/api/connectors/status`, and
`/api/outbox`. The Pages Function rejects preview/lookalike hosts and all other paths
or methods. The Worker owns every provider URL, secret, schema limit, model allowlist,
outbox destination, and connector tool permission. Ordinary chat has an explicit
read-only MCP tool allowlist; new provider tools default off.

The source host gate keeps `workers.dev` only for the registered manual OAuth GET
start/callback. Direct API traffic there returns 404 after deployment. `Origin` remains
a CORS check, never identity. Do not deploy that host gate until the bound same-origin
production path is proven.

## Compatibility locks

Do not rename or reshape these without an explicit Brady decision and migration.

### Connector names and destinations

- `quo` -> `https://mcp.quo.com/mcp`
- `gmail` -> `https://gmailmcp.googleapis.com/mcp/v1`
- `calendar` -> `https://calendarmcp.googleapis.com/mcp/v1`
- `gdrive` -> `https://drivemcp.googleapis.com/mcp/v1`

The client may request connector names only. The Worker supplies destinations,
credentials, and tool configuration.

### API and view identifiers

- Browser API paths: `/api/messages`, `/api/tts`, `/api/connectors/status`,
  `/api/outbox`.
- Main view IDs: `ops`, `studio`, `projects`, `mission`.
- Studio tool IDs: `handoff`, `captions`, `drive`, `html`, `filters`, `github`,
  `snippets`.

### Model and effort identifiers

- Models: `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-8`,
  `claude-opus-5`, `claude-fable-5`.
- Default model: `claude-opus-5`.
- Effort keys: `low`, `standard`, `high`; default `low`.
- Preference schema version: `PREFS_V = 3`.

Do not silently retry a failed model request: connector calls may already have run.

### Background and persistence identifiers

- Background choice IDs: `default`, `darklake`, `embersky`, `topo`, `glacier`,
  `aurora`, `custom`.
- Persisted keys: `ember-bg`, `ember-prefs`, `ember-chat`, `ember-drive`,
  `ember-caption-draft`, `ember-mc`.
- Retired key: `ember-outbox-url`; startup deletes it so older browsers cannot bypass
  the same-origin server relay.
- Mission Control update event: `ember:mc-updated`.

`ember-prefs` currently carries its version plus surfaces, model, effort, lake,
posting window, Studio tool, core mode, and manual revenue. Preserve saved-data
compatibility or ship an intentional migration.

### Business and safety context

- Businesses: Baxstar Fishing and Lakes Golf Simulator, Detroit Lakes, Minnesota.
- Quo lines: Fishing `218-325-6857`; Pontoon rentals `218-325-9846`.
- Customer-facing drafts are premium-but-warm, signed `Brady @ Baxstar`, and use the
  business-appropriate phone line.
- Never mention Scheels rods. Never say “one group per day”; use “private trip(s).”
- Never claim a booking, schedule item, message, or absence when the relevant tool did
  not return that data.
- Drafts, replies, tasks, posts, and files remain reviewable before external action.
  A prompt or UI confirmation cannot grant tools that the Worker does not allow.
- Caption Studio keeps the locked `#getyourbassingear` tag and the five-hashtag cap;
  sponsor mappings live in the source `SPONSORS` table.

## Design law

- Steampunk is Ember's identity. Fishing and golf appear as restrained engravings or
  operational content, never as competing themes.
- Warm brass, copper, gunmetal, candle, ember, and coal tones dominate. No blue or
  purple primary UI.
- Cinzel remains the display face; readable controls and data remain live DOM.
- The command dock is a CSS-built, fixed brass bar with six controls. The raster
  console art is texture/reference inside the controls, not a stretched dock or page
  background.
- The skull, reactor, odometer, brass frames, gauges, and controls remain a layered
  raster/SVG/DOM system. Reference mockups are intent references, never backgrounds.
- Preserve reduced-motion support, visible focus, no sideways overflow, and touchable
  controls. Do not trade legibility or behavior for cinematic decoration.
- Preserve working behavior while fixing defects; do not use a reliability pass as an
  unrelated redesign.

## Voice boundary

The main application has no microphone or voice controls. The isolated desktop probe
uses explicit user gestures and sends no connectors. It must pass startup, five
recognition turns, mic release, five text replies, five audible neural replies,
cancellation, tab-return, and permission-denial recovery on Brady's actual Mac.

Passing the simulated probe suite is necessary but not sufficient. A physical
failure blocks integration. A physical pass permits only a separately designed
desktop one-turn surface. The opt-in iPhone experiment must independently prove repeated
turns, interruptions, playback, permission recovery, and microphone handback. It is an
approved experiment, not a permanent prohibition or an already-working feature. Wake
word, background capture, automatic listening restart, and full duplex remain outside
the experiment.

## Reproduce and verify

Local preview:

```bash
./start-ember.sh
```

Production build and exact upload payload:

```bash
npm install
npm run build
npm run build:pages
```

Core regression commands:

```bash
npm run test:release
```

The local preview is for UI iteration. It uses same-origin API paths that a static
Python server cannot relay; use intercepted tests or the authenticated production
hostname for live API and voice-gate testing.

## Current release gates

1. Pages deployment from `main` succeeds with `npm run build:pages` and `dist`.
2. Cloudflare Access covers the custom hostname, exact production `pages.dev` alias,
   and preview wildcard, including `/api/*`.
3. A connector-free typed lab request with **Stream reply** off proves the service
   binding against the old Worker, which labels SSE incorrectly.
4. The paired Worker update deploys; direct `workers.dev` API POSTs return 404; OAuth GET
   still starts; authenticated streaming chat, TTS, connector status, and controlled
   outbox calls work through the Pages binding.
5. OPS shows verified provider data without false-live fallback.
6. Brady completes the five-run Mac Chrome voice gate before desktop voice integration.
   The opt-in iPhone lab needs its own physical repeated-turn/interruption test before
   phone integration.

Until each environment-specific check is observed, label it **PROVISIONAL** rather
than inferring it from source or mocks.
