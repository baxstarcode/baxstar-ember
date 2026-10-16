# Ember — Living Cinematic Handoff

Checkpoint date: **2026-09-20**. This is the compact continuation brief for any
builder entering Ember cold. Git history preserves the long design chronology; this
file records what is load-bearing now.

## Mission and status

Ember is Brady Baxter's desktop-first AI command center for Baxstar Fishing and Lakes
Golf Simulator. OPS, chat, Mission Control, Projects, Studio, the tools rail, and the
conditional desktop-voice experiment are surfaces of one daily operating system.

The desktop revival is implemented, locally verified, merged through PR #43, and live
through Pages deployment `1f56234b-f359-43f2-ba38-c839d2e6b415` plus Worker version
`ac3b4578-5a04-4abf-9286-8e95663517d5`. Access, the same-origin binding, public Worker
host gate, OAuth start, signed-in streamed text, ordinary main chat, live OPS sync, and
the isolated lab's browser TTS cycle passed production checks. Data-free connector
status and one controlled Drive-outbox write remain open. Desktop voice remains outside
the main app until Brady completes the physical five-run Mac Chrome gate. Reliable
iPhone voice is also preferred if feasible, with a separate isolated reliability lab
and physical test before integration.

Repository: `baxstarcode/baxstar-ember` (private). Production target:
`https://ember.baxstarfishing.com`, behind Cloudflare Access.

### Local continuation — 2026-10-16

Brady requested a review of the latest work plus a small, researched design risk.
`codex/ember-command-plate-light`, based on PR #49 / `af8d6ba`, adds pointer-lit
brass, engraved serials, asymmetric corners, and a short ignition accent to the
existing WHAT'D I MISS / BRIEF MY DAY plates. Their hit targets, prompts, and routes
are preserved. Keyboard focus gets the accent, touch stays stable, reduced-motion
mode is static, and compact chat pills omit the serial. No dependencies were added.

Verified locally: production build and Pages staging, 26/26 chat regressions,
87/87 layout/truth checks, 17/17 focused pointer/keyboard/touch/reduced-motion checks,
and desktop/phone screenshots at device scale factor 3. Full release-suite and live
deployment verification remain outstanding; the environment cannot reach the live
hostname and has no Drive/Cloudflare connector. Registry and Relay write-back remain
unavailable. The separate iPhone Shortcut PR #48 was inspected and left untouched.

**Next priority:** repair the rotated-token fallback in `currentRefresh` before
relying on `EMBER_TOKENS` for Quo recovery. A local fixture proved that one failed KV
read replays the retired secret and loses a still-valid cached access token. Then
confirm the deployed Worker/model compatibility and KV binding in an authenticated
session. The partial-sync error text also needs correction; see Known Issues §1c–1d.

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

- **OPS** shows calls/voicemail, unread mail, schedule, manual revenue, a full chat
  thread with the WHAT'D I MISS / BRIEF MY DAY push-plates either side of the reactor,
  a "Triage Inbox ›" link on the Inbox, and the slim YOUR TOOLS row. On a desktop-sized
  window it is exactly one screen tall (2026-10-15); panels scroll inside themselves.
  Sync runs on every load and again when the tab returns after 15+ minutes, per feed:
  a dead connector leaves only its own panel on the demo preview. THE WORKS moved into
  the Knowledge Graph overlay (dock), beside the embedded Knowledge Foundry.
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

The deployed host gate keeps `workers.dev` only for the registered manual OAuth GET
start/callback. Forged-Origin POSTs to all four `/api/*` routes returned 404 on both
ordinary and trailing-dot public host forms; Google OAuth start still redirected to
the provider. `Origin` remains a CORS check, never identity. For future paired releases,
prove the bound same-origin production path before changing the public host gate.

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
- The command dock is a CSS-built, fixed brass bar with six controls — since
  2026-10-15: OPS · Caption Studio · Knowledge Graph · Google Drive · FareHarbor ·
  Projects. The raster console art is texture/reference inside the controls, not a
  stretched dock or page background.
- Painted mechanisms that move (2026-09-21, extended 2026-10-15): the Caption Studio
  gear turns and its linkage lever throws; the Knowledge Graph tile's core glows like a
  furnace; the FareHarbor ship's wheel spins three turns, lands home and rests 5s; the
  Google Drive tile's gauge face is replaced by an opaque engraved plate. Nothing
  is drawn over the artwork to achieve this — each moving part is either light that can
  only brighten it, or a masked copy of the artwork's own pixels that covers the still
  version rather than adding to it. A second outline of a painted mechanism is the one
  thing dock motion may never produce.
- The reactor, odometer, brass frames, gauges, and controls remain a layered
  raster/SVG/DOM system. Reference mockups are intent references, never backgrounds.
  The brass skull arch was removed on 2026-09-22 (Brady) and the reactor crowns the
  centre chamber in its place — do not restore the skull from older notes.
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

## Current release status and remaining gates

Completed on 2026-09-20:

1. the 562/562 local matrix and 11/11 sponsor-drift check passed;
2. PR #43 merged and the exact release deployed through Pages;
3. Access challenged the custom host, custom API path, exact production Pages alias,
   and current deployment alias;
4. a connector-free `stream:false` lab request proved the binding before the paired
   Worker update;
5. the Worker host gate deployed; eight forged-Origin route probes returned 404 and
   OAuth start still redirected;
6. a signed-in streamed lab reply and browser TTS cycle completed;
7. ordinary main chat completed, connector degradation/recovery was visible, and OPS
   populated verified live panels without false-live fallback.

Still open:

1. call signed-in `/api/connectors/status` and record only its data-free result;
2. send one controlled `/api/outbox` draft and confirm the private Drive file exists;
3. have Brady complete the five-run Mac Chrome voice gate before desktop voice
   integration;
4. run the opt-in iPhone physical repeated-turn/interruption test before phone
   integration.

Physical microphone release, speech recognition, speaker audibility/quality, and
device reliability remain **PROVISIONAL** until observed on the named device.
