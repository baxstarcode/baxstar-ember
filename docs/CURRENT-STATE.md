# Ember — Current State

Latest local continuation: **2026-10-16**. Production evidence below remains dated
2026-09-20 unless explicitly stated otherwise.

**Local continuation, 2026-10-16:** branch `codex/ember-command-plate-light` contains
the command-plate design refinement and subsequent connector/sync reliability
repairs. A SQLite Durable Object now coordinates refreshes across Worker instances,
persists rotations, and prevents replay after ambiguous refreshes or restarts. The
new coordinated seed secrets require fresh consent; legacy KV is not imported.
Partial/failed syncs distinguish updated, retained, and demo feeds, with STALE
indicators after failures. These changes have not been deployed. The authenticated
cutover and production verification remain open. See `docs/DEPLOY.md`,
`HANDOFF-CINEMATIC.md`, and Known Issues §1c–1d for scope and restart steps.

**Current local validation:** full `test:release` passed with system Chromium:
742 checks across all 14 suites, plus Wrangler 4.135.0 dry-run. This includes real
workerd/SQLite with synthetic providers, not live OAuth or physical-device proof.

**Recorded production status (2026-09-20):** the desktop revival is deployed. PR #43 merged to `main` at
`add4a8c28c17f70b3463d5ad786833f5e5a7880a`; release commit
`063237de6bfc45eb562eb9dbd82a9eb8b651a6f8` is live through Pages deployment
`1f56234b-f359-43f2-ba38-c839d2e6b415`. The same-origin gateway, Worker host gate,
ordinary signed-in chat, live OPS sync, and the isolated lab's streamed text/TTS browser
path have production evidence. Data-free connector status, one controlled Drive-outbox
write, real microphone behavior, and physical speaker audibility remain pending.
Desktop voice is still an isolated experiment until Brady passes the physical five-run
Mac Chrome gate. Reliable iPhone voice is an approved experiment with a separate
physical-device gate.

## What Ember is now

Ember is Brady Baxter's desktop-first AI command center for Baxstar Fishing and Lakes
Golf Simulator. It is one daily operating system, not a set of demos:

- **OPS:** calls and voicemail, unread email, schedule, manual revenue, quick actions,
  the YOUR TOOLS row, and the WHAT'D I MISS / BRIEF MY DAY push-plates beside the
  reactor; one screen tall on desktop. Dock: OPS · Caption Studio · Knowledge Graph
  (overlay: Knowledge Foundry + THE WORKS) · Google Drive · FareHarbor · Projects.
- **Chat:** a readable persisted Claude thread with streaming replies, Stop, Retry,
  Copy, Clear, keyboard controls, safe lightweight formatting, and explicit
  connector/error states.
- **Mission Control:** browser-local project state, next actions, task lists, links,
  effort estimates, decisions, and reviewable local task drafts. Saving a task does
  not send it to Quo.
- **Projects:** the lighter session-maintained progress bars and Zapier-usage summary.
- **Baxstar Studio:** Caption Studio, AI Handoff, Drive librarian, HTML Viewer, Image
  Filters, GitHub, and reusable snippets.

Live data is deliberately honest. A degraded connector response cannot replace OPS
panels or label generated/demo data as live. Revenue remains manual until a real
booking-system source is chosen.

## Voice policy

The former phone/wake-word stack is not part of the application. Brady's latest voice
direction, recorded in the Ember Handoff Log and Agent Relay on 2026-09-20, calls for
excellent desktop voice and chat and prefers reliable iPhone voice if feasible. The
historical removal is release history, not a permanent product prohibition.

Desktop voice may return only after the isolated probe at
`work/desktop-voice-probe/` passes five real turns in desktop Chrome. The approved
interaction is explicit and one-turn: click Talk, review/correct the transcript, send
it, then optionally play the reply. Automated tests do not prove microphone release,
recognition quality, audible playback, permission recovery, or repeated timing.

Until Brady records a pass, desktop microphone and speaker behavior is
**PROVISIONAL**. A pass permits the explicit desktop interaction tested. An opt-in iPhone
lab must separately prove repeated turns, interruptions, permission recovery, playback,
and microphone handback on that phone before integration. Neither pass establishes wake
words, background listening, automatic restart, or full duplex.
The complete historical implementation remains recoverable on
`snapshot/voice-era-final`.

## Current architecture

```text
Authenticated browser
  -> https://ember.baxstarfishing.com (Cloudflare Access)
  -> Cloudflare Pages static dist/
  -> same-origin /api/* Pages Function
  -> EMBER_API service binding
  -> ember-claude-proxy Worker
  -> Anthropic / neural TTS / approved read-only MCP connectors / Drive outbox
```

- Pages builds `main` with `npm run build:pages` and publishes only `dist/`.
- `functions/api/[[path]].js` accepts the exact production hostname, the exact paths
  `/api/messages`, `/api/tts`, `/api/connectors/status`, and `/api/outbox`, and only
  POST/OPTIONS. Preview and lookalike hosts are denied.
- The Worker owns secrets, provider destinations, model/body limits, OAuth, TTS, the
  private Drive-outbox destination, and the server-controlled connector tool allowlist.
  Browser-supplied destinations, tokens, tools, and tool configuration are discarded.
- The local branch adds the private `EMBER_TOKEN_COORDINATOR` binding. Each grant
  has one SQLite Durable Object; Google's 3 connectors share an owner. The namespace
  and fresh-consent secrets have not been provisioned by this session.
- Ordinary chat can read the approved Quo, Gmail, and Calendar tools. The separate
  Drive librarian can search and read approved Drive data. Neither can send messages,
  create external tasks, alter mail/calendar data, or write Drive files.
- The deployed public `workers.dev` hostname accepts only the manual OAuth
  start/callback GET routes. Forged-Origin POSTs to all four `/api/*` routes returned
  404 on both ordinary and trailing-dot host forms; Google OAuth start still redirected
  to `accounts.google.com`. `Origin` is CORS policy, not authentication.

Quo, Gmail, Calendar, and Drive credentials were all reported connected by the live
credential-status route earlier on 2026-09-20. The revived release has not yet repeated
that data-free status call. It did complete a signed-in live OPS auto-sync without
model-generated fallback: the panels reported 0 calls, 5 unread messages, and 0 calendar
events; no private item content was recorded in this repository. Main chat completed,
surfaced one transient connector-degraded response honestly, and completed the focused
follow-up without the degraded banner. That recovery is evidence of the released path,
not a blanket guarantee that every connector is continuously available.

## Verified in this revival

The historical September release matrix was green: **562/562 checks**. The October
branch's complete 742-check matrix is recorded above and in `HANDOFF-CINEMATIC.md`.

- production build and exact Pages staging payload;
- Worker contract and security tests: 193/193;
- Pages gateway tests: 36/36;
- chat regressions: 26/26;
- dashboard checks: 30/30;
- layout/truth checks: 81/81;
- streaming/effort checks: 9/9;
- ecosystem graph checks: 32/32;
- UI rework checks: 34/34;
- Caption Studio browser checks: 46/46;
- desktop and opt-in phone voice-lab simulations: 24/24;
- Drive outbox tests: 27/27;
- posting-time tests: 24/24.

Browser checks cover desktop, laptop, and phone widths with intercepted external calls.
Production verification also established:

- the merged Pages build rendered successfully on the custom hostname;
- unauthenticated requests to the custom host, its `/api/messages` path, the exact production
  Pages alias, and the current deployment alias all redirected to Cloudflare Access;
- before the Worker update, a signed-in connector-free `stream:false` lab request
  completed through the Pages binding in 1.3 seconds;
- Worker version `ac3b4578-5a04-4abf-9286-8e95663517d5` deployed with existing secrets
  preserved and the server-only `OUTBOX_URL` configured;
- after the Worker update, a signed-in streamed lab reply completed in 1.4 seconds;
- explicit lab playback received neural audio, entered the browser's `playing` state,
  reached `ended`, and left the UI at `Playback ended` with the mic off;
- ordinary main chat and a count-only connector follow-up completed, live OPS sync
  populated verified panels, a Drive librarian title search found the Ember Handoff Log
  without reading its contents, and all 11 sponsor handles matched their owner source.

These checks still do not prove a real microphone, physical speaker audibility or audio
quality, continuous connector availability, or a successful Drive-outbox write.

## Remaining gates

0. (2026-10-15 release) Deploy the Worker before merging the UI that sends the new
   model IDs, then send one message per model and confirm each served-model stamp; re-check
   Quo's status (see `docs/KNOWN-ISSUES.md` §1a–1b). This branch also requires the durable
   owner/fresh-consent cutover in `docs/DEPLOY.md`; do not copy legacy refresh secrets.
1. Run the data-free signed-in `/api/connectors/status` call through the Pages binding.
   Treat the earlier all-connected report, the verified live OPS sync, and the observed
   chat recovery as separate evidence rather than substitutes for this route check.
2. Publish one controlled Caption Studio draft and confirm `/api/outbox` reports success
   only after the private Drive file exists. The Worker secret is configured; the write
   itself is not yet verified for this release.
3. Have Brady complete the five-run physical Mac Chrome voice gate. Test the opt-in
   iPhone lab separately for repeated turns, interruptions, and microphone handback.
   Integrate only the interaction and platform that passes its physical gate.

## Canonical files

| Concern | Owner |
| --- | --- |
| Application behavior, markup, and CSS | `src/baxstar-ember.jsx` |
| Anthropic, connector, OAuth, and TTS gateway | `proxy/cloudflare-worker.js` |
| Same-origin Pages API relay | `functions/api/[[path]].js` |
| Production HTML generator | `build.mjs` |
| Exact Pages payload | `scripts/stage-pages.mjs` |
| Local preview generator | `scripts/sync-standalone.py` |
| Desktop voice feasibility gate | `work/desktop-voice-probe/` |
| Design constitution | `docs/BUILD-PROMPT.md` |
| Deployment procedure | `docs/DEPLOY.md` |
| Current risks and deliberate limits | `docs/KNOWN-ISSUES.md` |
| Locked compatibility details | `HANDOFF-CINEMATIC.md` |
| Ownership and provenance | `SOURCES-OF-TRUTH.md` |

`index.html`, `_preview.html`, and `dist/` are generated outputs. Never hand-edit or
build from them.

## Rules that must not drift

- Never put API keys, OAuth tokens, refresh tokens, or other secrets in client files
  or Git.
- Keep drafts, replies, posts, and tasks reviewable before external action. General
  chat is read-only even when a prompt asks it to act.
- Preserve frozen IDs, storage keys, business contexts, connector names/routing, and
  persisted shapes unless Brady explicitly changes them and a migration is supplied.
- Preserve the warm steampunk identity and fixed CSS brass dock — including the tile
  animations (gear spin, lever throw, furnace glow, FareHarbor wheel) and the rule that no
  dock motion may draw a second outline of a painted mechanism. Fishing and golf are
  restrained engravings, not alternate themes.
- Keep hosted chat useful when optional connectors fail, while never presenting
  connector-free output as live business data.
- State local, simulated, production, and physical-device verification separately.

## Resume procedure

1. Read `AGENTS.md`, this file, `SOURCES-OF-TRUTH.md`, and the current Ember Handoff
   Log standing-truth block.
2. Inspect the branch and working tree before changing anything.
3. Edit the canonical owner, not a generated output.
4. Run `npm run test:release`; use targeted suites only for focused iteration.
5. Follow the staged production sequence in `docs/DEPLOY.md`; do not deploy the Worker
   host gate before the same-origin production gateway is proven.
6. Mark anything requiring Access, OAuth, providers, a real microphone, or speakers
   **PROVISIONAL** until it is tested there.
