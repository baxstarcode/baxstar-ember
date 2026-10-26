# Ember — Current State

**Signal Log continuation — 2026-10-26 (Codex, draft PR #59; not deployed):**
`codex/signal-feed-reliability` starts from current `main` `5d911ba`. Bounded reads
now cover the response body, enforce provider record/byte caps, expose partial
results and preserve stale cards/decisions with attempt/success timestamps. The
manual Claude route adds a copyable prompt and whole-report JSON import with stable
task/run/item identity, revision handling and full-report provenance in backups.
`signal-log/ROADMAP.md` and its evidence own completion status. Read-only inventory
found no enabled weekly item in the 8 accessible ChatGPT tasks; current Claude
scheduled-task coverage is unverified and needs the native listing/export. Shared
Worker/auth/config, grants, automations and deployment are outside this follow-up.

**Main chat defaults to Medium — 2026-10-23 (Codex):** Brady requested Medium
effort. Opus 5.5 remains the default model. Preference version 4 applies Medium
once to older saved effort settings while preserving model choices from version 3.
Later manual effort choices still persist. Dashboard sync remains Haiku 5.5/Low;
the separate Voice Lab is unchanged. Build/Pages staging and 14 streaming-effort
checks pass. Browser checks verified fresh phone defaults, existing desktop
preference migration, and a saved override, including subsequent choice/reload.

**Signal Log in the dashboard — 2026-10-23 (Claude):** YOUR TOOLS → Signal Log now
opens the page in an overlay (same sheet as the Knowledge Graph, a same-origin
frame; the dock's six tiles are unchanged). Every card carries its action links:
`Open in Gmail ↗` / `Open in Google Calendar ↗` in a new tab, and **Ask Ember**,
which closes the overlay and places the card (title, summary, source fact, why, next
step) in the composer unsent; standalone it is `index.html?ask=…`. Same-origin
messages only (`ember-signal-ask`, `ember-signal-close`). The OPS Inbox and
Schedule rows got the same treatment: the sync prompt now returns each message's
Gmail id and each event's htmlLink, and a row shows `Open in Gmail ↗` /
`Open in Calendar ↗` only when the page can build or allowlist the URL itself
(Gmail id pattern; Google calendar hosts over https). Hostile values render no
link; the dashboard check proves both. The Signal Log gained a third reader, Quo
(missed calls and voicemails, 48 h, both inboxes, `source: "quo"`), with its own
health row; it reports Unavailable until the coordinator cutover restores the Quo
grant and never blocks Gmail or Calendar. Also: the Schedule panel's
one-word-per-line titles are fixed (PR #54, long calendar details wrap under the
title). Verified here: dashboard 117/117, layout 87/87, UI 36/36, Signal Log 25
browser scenarios + 31 contract tests. Worker, grants, voice and dock unchanged.

**Voice check v6 — 2026-10-22 (Claude):** switching apps mid-reply no longer cuts
Ember off; only an already-playing reply continues (mic and requests still stop).
Next physical check: start a spoken reply on CarPlay, switch to Maps, and report
whether she keeps talking. Details: `docs/VOICE-REBUILD.md`.

**Signal Log live feed — 2026-10-22 (Claude, taking over from Codex):** Codex's
`/signal-log/` page (draft PR #50) is merged onto main and now reads Gmail and
Calendar by itself when opened signed in at ember.baxstarfishing.com: one
`/api/messages` call per provider, Haiku 5.5 at low effort, bounded to 25 inbox
messages from 7 days and 40 events from −2 to +14 days, verified only by a
successful `mcp_tool_result` for that provider, projected per record into the
page's v1 contract. YOUR TOOLS gained a Signal Log link (12 links; the rail still
fits on one screen at 1440×900). Verified here: full release matrix green with the
new feed tests (24 browser scenarios, 31 contract tests). PROVISIONAL: the
signed-in read on the custom domain, recorded in Known Issues §9 once Brady
confirms it. Worker, grants, voice and the dock are unchanged.
**Voice check v5 interruption recovery — October 22, 2026 (America/Chicago):**
Brady clarified that text disappeared on return, leaving nothing to replay. v4's
hide handler aborted recognition and discarded provisional words; the interrupted
report had no finalized transcript. v5 preserves words already received as an
editable, clearly marked draft before stopping capture. Continue talking appends
to the reviewed draft only after an explicit tap; Send remains explicit. Completed
text/replies remain available after tab hiding, and playback still needs a tap.
Late result callbacks during abort cannot overwrite the recovered draft. If no words
arrived, the page explains that; it cannot recover unrecognized speech or a full
page reload. Drafts stay in memory only. Recovery is marked Limited, not a fresh
uninterrupted Pass. No Worker, voice/model, connector or dashboard activation change.
Validation: 32 timing/recovery checks, 50 browser checks and 38 Pages gateway checks
pass; Pages build passes. Desktop and phone rendering checked (phone at 3x scale).
Real tab/app-switch recovery remains to be checked when Brady returns; no more
physical testing was requested tonight. Latest main `f92be1c` was fast-forwarded
before publication, preserving Claude's model-rollout documentation correction.


**Extended Mac report — October 22, 2026 (America/Chicago):** the pasted file
extends the same `2026-10-22T07:29:36.775Z` session; do not count its first turn again.
Brady says the computer tests worked very well until tab switching, which turned
the mic off. Events preserve the first full turn's original Pass at 34840 ms and a
later Failed recording at 191722 ms; the turn's latest observation overwrites its
earlier Pass. Retain both observations. The first tab hide occurred after completed
reply playback. After returning, a new speech-only request played and a new microphone
session started, showing recognition restart without reload. A second tab hide
then aborted that capture; recognition ended 1 ms later. No subsequent full
Talk/Send/Play recovery cycle is present. The visible cutoff matches the lab's
explicit `visibilitychange` → `stopAll` behavior, not proof of an OS/browser inability
to run background audio. Background conversation remains outside this lab's scope.
No new runtime repair or repeated tab-cutoff test is needed on this evidence.


**Mac Chrome physical pass — October 22, 2026 (America/Chicago):** Brady's v4
report started at `2026-10-22T07:29:36.775Z` (02:29 CT), with notes “done on m4 mac
in chrome. worked well.” One full microphone turn records Pass, mic indicator off
and reply audible. Chrome 155 reported recognition end, complete streamed text,
HTTP 200/audio (45792 bytes), and playback ending. First reply text arrived 806 ms
after Send; playback began 971 ms after Play. Audio-session `unavailable` /
`not-applicable` is expected on this desktop path, not a failure. This is **one Mac
Chrome full pass**, separate from the two previous iPhone/CarPlay full passes.
Repeated-turn and interruption/recovery gates remain open; no runtime change is
justified by this success. The skull panel remains recording-only.

**Outstanding phone interruption evidence:** the October 21 session beginning
`13:02:27.399Z` stopped capture on tab hide and reported recognition end 48 ms later.
No text or TTS request followed. Brady's notes say the recording light went out,
but the saved result is Failed with both physical checkboxes false; retain that
conflict rather than silently marking Pass. He subsequently reported failure on
switching tabs/apps. No fresh Talk/Send/Play attempt after returning appears in that
report, so expected cancellation is observed but recovery failure/success is not
isolated. Next phone check: return to Safari and explicitly start a new turn without
reloading. Do not add automatic listening or claim background voice is supported.


**Second full v4 physical pass — 2026-10-21 UTC:** the supplied session began
at `12:59:42.536Z`, with device notes “All worked well.” In the ongoing Safari/
wireless-CarPlay test context, one microphone turn records `pass`,
`micIndicatorOff: true`, `replyAudible: true`. Recognition ended after the 750 ms
grace, streamed text completed, and reply TTS returned HTTP 200/audio (33984 bytes).
The browser accepted playback mode and emitted playing/ended, then requested auto.
The separate fixed-sentence test also completed, but is not a microphone turn.
There are now **two confirmed full v4 turns across two sessions**, not five repeated
turns. Three additional complete turns are needed for the requested five-turn count;
keep the same page open for the next turns to exercise repeated handoff. Active-turn
cancellation, interruption and recovery still need evidence. Tab hiding in this
report occurred before testing and after completed playback; it does not prove
interruption recovery. No new runtime repair is warranted by this successful report.
The integrated skull panel remains recording-only pending its release gates.


**First full v4 physical pass — 2026-10-20 UTC:** after reporting silent playback
in ChatGPT's in-app browser, Brady was asked to compare in standalone Safari and
replied **“Worked”**, supplying the v4 session begun at `02:42:06.673Z`. The successful
microphone turn explicitly records `result: pass`, `micIndicatorOff: true` and
`replyAudible: true`. Recognition ended, the streamed text completed, and the reply
returned HTTP 200/audio (75888 bytes), with accepted `playback` mode, playing/ended
events and a request to restore `auto`. This is one user-confirmed complete spoken
turn in the ongoing wireless-CarPlay test context. The report cannot identify the
physical speaker route or independently distinguish embedded from standalone Safari.
Do not attribute causality solely to either the browser switch or v4 mode request.

The initial fixed-sentence test was paused and later cleared/cancelled before Talk;
it is not a second full pass. Session state is unavailable in this browser, while
type is reported; that alone is not an error. Use standalone Safari as the current
successful test path. Next: four more complete turns for the five-turn gate, then
cancellation/interruption/recovery checks. No further speculative audio fix is
warranted by this successful report. Keep the main skull panel recording-only and
repeated-device reliability PROVISIONAL until the release gates are met.


**Wireless CarPlay handoff — 2026-10-20 UTC:** Brady's v3 report began at
02:29:15.636Z. He explicitly confirmed the initial fixed test sentence was audible
through the truck speakers before Talk. After microphone use, replies were silent.
All five speech attempts returned HTTP 200/audio (22320–40464 bytes) and emitted
playing/ended; none reported provider refusal, decode failure or autoplay rejection.
Three spoken questions produced completed text replies. One recognition attempt
aborted and the following attempt recovered. Brady witnessed the mic indicator off;
the last turn records `micIndicatorOff: true`, `replyAudible: false`. Earlier turns
are physically unrecorded. This isolates a post-capture audibility problem; it does
not identify the actual output route or prove an iOS audio-session defect.

**Bounded lab repair:** Voice check v4 feature-detects the experimental Audio Session
API on iPhone/iPad and requests `playback` before playing, only while recognition is
off. It returns to `auto` after playback, error, cancellation, page hide and before
new capture; native-player replay can reacquire playback mode. Missing/rejected APIs
fall back to the existing player. Report v4 adds allowlisted session state/type and
media-element mute/volume snapshots (not hardware volume or output-device identity).
No mic auto-arm, extra microphone acquisition, forced volume, provider/voice change,
Worker/connector deployment or dashboard voice activation. Next physical proof:
on v4, hear the fixed sentence, then complete one Talk → Send → Play turn through
the truck speakers. If still silent, stop adding speculative audio workarounds and
compare routing/volume/session evidence with one phone-only turn. Hardware outcome
remains PROVISIONAL until Brady reports it.

Validation: 27 timing checks, 46 browser checks and 38 Pages gateway checks pass;
`npm run build:pages` passes. Browser microphone/audio/session events are simulated.

Production publication verified: Pages deployment `df6104be-2984-4a77-943b-b92b33a9fec7`
completed successfully at **2026-10-20 02:40:35 UTC**, serving commit `2f955d0` on
`https://ember.baxstarfishing.com`. Worker/settings were not changed. Workspace public
probe returns HTTP 403 without a signed-in session; actual signed-in v4 playback
still requires Brady's device check. No claim of a physical CarPlay fix yet.



**Speech compatibility hotfix — 2026-10-18, 22:00 America/Chicago:** Brady's
speech-only v3 screenshot confirmed HTTP 502 / provider connection refusal. The
current edge-tts 7.3.1 client uses a v2 connection-token algorithm while the live
Worker used v1. Implementation `d9a826c` updates the canonical Worker and adds a
licensed server-only port verified against 38 independent Python reference vectors.
239 existing Worker checks and five new tests pass. The exact narrow deployment
candidate additionally passes its WebSocket/MP3/chat/host-gate test in workerd.
The application build also passes; application code and generated UI behavior are
unchanged. All speech-provider responses in these tests are synthetic.

Live Worker version **`f8d6ac15-844d-4e59-b0ed-20f8822dcf09`** is at 100%, deployment
`6f00f0b8-39bc-4078-9cc1-4f6645fdf18e`, created October 19 03:00:33 UTC. The upload
changes only the existing live Worker's token function/version plus the helper
import/module. Downloaded deployed module hashes match the tested candidate. All
12 existing bindings and runtime settings were verified unchanged; there is no
coordinator migration, new secret/provider account, alternate voice or Access change.
Jenny remains `en-US-JennyNeural`. The rest of the deployed Worker still uses the
older connector implementation; do not confuse this narrow hotfix with deploying
the canonical coordinator configuration. See Deploy for the reproducible patch.

**Phone speech confirmed — 2026-10-19 UTC:** after the deployed repair, Brady
answered the fixed-sentence **Test Ember’s voice** check: **“I hear Ember’s voice.”**
This is user-reported live provider output and physical phone audibility for one
speech-only attempt, beyond the synthetic tests above. No success report/export or
exact browser/output route was supplied. Full spoken turns, repeated cycles,
physical mic release, interruptions and wireless CarPlay playback remain unverified
after the repair. Next: one complete phone turn, then a parked CarPlay test.
Jenny remains selected; the orange mouth remains recording-only.

Latest local continuation: **2026-10-18 (America/Chicago)**. Production evidence below remains dated
2026-09-20 unless explicitly stated otherwise.

**Voice device report, 2026-10-18:** Brady reports successful microphone transcription
and text replies on his iPhone alone and through wireless CarPlay, with no audible
reply in either test. The supplied older-lab v2 report records two failures before
`audio-ready`; the generic error omits the HTTP/provider cause. This is partial
physical success, not a complete voice pass. Mic release remains unconfirmed.
The successful signed-in streamed reply supplies current connector-free Pages/Worker
chat evidence; the earlier pending typed binding probe need not be repeated.
Live Worker `6110e34c-2363-41c5-a5f6-fab751ecb717` still uses JennyNeural through the
unofficial Edge TTS service. The disabled new adapter uses a different voice and
must not silently replace Jenny. The next diagnostic isolates one speech request
without mic or chat and preserves safe failure details. No backend, credentials or
voice activation change is implied. See `docs/VOICE-REBUILD.md` for precise evidence.

**Voice check v3:** the isolated lab now has a fixed-sentence **Test Ember’s voice**
button beside phone opt-in. It uses the existing Jenny endpoint without mic/chat.
Reports preserve separate, bounded attempts with HTTP/content/stage/failure details,
including known provider rejection categories, while excluding raw response text.
Retry, cancellation and playback blocks remain distinct. The v3 script URL is
versioned to avoid the earlier cached-script ambiguity. Local verification passed
**105 focused checks** (27 phrase-grace, 40 lab/browser, 38 Pages gateway), plus
`npm run build:pages`; desktop/phone layouts were inspected. These are simulated
speech/provider checks, not a live audio repair or physical speaker pass.
Implementation `a608230ae8000771f7430938f78d686e22bb7b85` is pushed to `main` and
the alternative branch. Cloudflare production deployment
`f484ffaa-d2b5-4c90-8bcf-09fcce24eb64` completed every stage successfully at
**2026-10-18 21:35:18 America/Chicago** (October 19 02:35 UTC), with
https://ember.baxstarfishing.com as its alias. Immutable checkpoint:
https://f484ffaa.baxstar-ember.pages.dev . The actual service error and an audible
physical reply remain pending. The workspace cannot perform the signed-in request;
historical observability queries also return permission-denied with the current
deployment token. No additional token scope or Access bypass was added.


**Mission Control/mobile continuation, 2026-10-18:** Brady authorized fixing the
two-tab save conflict and mobile usability without waiting for voice testing.
Canonical saves now use revision-checked IndexedDB transactions shared by board
edits and reviewed OPS tasks. The old localStorage bytes stay as a recovery copy;
new saves never overwrite them. Losing tabs retain downloadable drafts. Commit
aborts, typing while saving, denied storage, malformed records and old-version
tabs retain explicit recovery paths. See Known Issues §5 for migration/limits.
The deterministic stale-read regression fails on untouched `dc83045` and passes
with the repair. Mobile Lake/time controls now wrap correctly, Mission Control
uses readable text and larger touch targets in portrait/landscape, and switching
tools starts at the top. The pinned six-item dock and existing visual design remain.
`CHROME_PATH=/usr/bin/chromium npm run test:release` passed with exit 0: **1008 checks
across 19 suites**, including
24 local-state, 26 chat and 45 touch-mobile checks, the unchanged backend contracts,
graph/Caption Studio regressions and simulated voice checks. Generated HTML matches
the staged Pages payload. Phone portrait/landscape screenshots were inspected.
Implementation `7ea389ad0c625fb4fcc89178d092af5ab8518842` is pushed to `main` and the
alternative branch. Production deployment `662422a8-fa47-4ef8-903f-203dcb1d27b3`
completed at **2026-10-18 02:04:46 America/Chicago** (07:04:46 UTC), with every
Cloudflare stage successful and the custom domain as its alias. Immutable URL:
https://662422a8.baxstar-ember.pages.dev . Authenticated API metadata confirms
this as the canonical production deployment. The custom domain is active; the
workspace's unauthenticated live probe still returns 403, so signed-in rendering
and real iPhone behavior are not claimed as verified here.
This is UI-only: Worker `6110e34c-2363-41c5-a5f6-fab751ecb717`, credentials, model
choice and `EMBER_VOICE_RELEASED=false` remain unchanged. Gmail/Quo fresh consent
and the signed-in gateway check still await Brady; physical iPhone/CarPlay tests
remain open. The selected female Ember voice is the intended voice (no voice clone).

**Production publication request, 2026-10-17:** Brady explicitly requested the current
website on `ember.baxstarfishing.com`. This is a Pages-only release: authenticated
inspection of the live Worker source confirms all four current model IDs are already
accepted by version `6110e34c-2363-41c5-a5f6-fab751ecb717`. No Worker, OAuth grant,
secret, coordinator, or speech-provider activation is part of this publication.
`EMBER_VOICE_RELEASED=false` keeps the mouth panel recording/playback-only on the
production hostname too. The future backend cutover remains separate. The known
intermittent Mission Control multi-tab save issue remains open; use one editing tab.
The complete release matrix passed in the preceding continuous session; the small
production voice gate receives a fresh build and focused voice verification.

**Voice continuation, 2026-10-17:** the orange mouth now opens an explicit recorded-
voice preview. Opening Ember/panel never arms the mic. Preview hosts permit local
record/playback only. The new production path records with MediaRecorder, releases
capture, transcribes through official Workers AI, reviews/sends into ordinary chat,
and requests official speech output. It does not use browser SpeechRecognition or
replace legacy `/api/tts`. New speech routes remain disabled pending an AI binding,
activation, existing backend rollout and actual provider/device proof. No live Worker
or secrets changed. See `docs/VOICE-REBUILD.md` for recovered code, Claude's corroborating
handoff, branch reconciliation, iPhone 17 Pro/iOS 27.0.1 (reported) test plan, and native
app tradeoffs. This preview is not proven hands-free voice or a production release.

**Alternative visual continuation:** `codex/ember-brass-pressure-alt` starts at the
saved handoff `108d444`; `codex/ember-command-plate-light` and its working design are
preserved. Brady supplied Argon HTML and asked for vivid warm colors, outlined/tactile
buttons, brighter text, and its knowledge graph, while explicitly retaining the large
skull and pinned six-item dock. The alternative adds that finish and an interactive
20-node/34-link Foundry atlas. Brady's newer, complete **Universal Responsive Modal
v2** upload now supplies the graph's exact node layout, coral/brass finish, glass
filters, rotating rings, and moving particles. Desktop source details become a
collapsible phone drawer. Search, domain filters, drag/pinch/wheel/keyboard zoom,
motion pause, reduced motion, and phone source selection work locally. Brady then
requested removal of the duplicate Source map tab: the overlay now offers Foundry
and The Works, with the original graph linked only in `docs/ALTERNATIVE-PREVIEW.md`.
The atlas describes reference
relationships; it does not represent live data flow or change another application's
repository. See `docs/ALTERNATIVE-PREVIEW.md` for provenance and the release checkpoint.

The earlier alternative was pushed at implementation commit `74c3ae3` and published to
**https://3ee28ad7.baxstar-ember.pages.dev**. Cloudflare's API confirms all preview
deployment stages succeeded at 2026-10-17 02:54:26 UTC. Combined local verification
is 830 passing checks and the one pre-existing concurrent-save failure described
below; this is not a production release or a fully passing release matrix.

The v2 graph continuation passes **285/285 focused browser checks** (alternative,
ecosystem, UI, layout/truth), plus the production build/Pages staging. Desktop,
phone portrait, 320 px narrow phone, and phone landscape were visually inspected.
All application source outside the graph section is unchanged. The full release
matrix was not rerun; the concurrent-save blocker remains open. See the alternative
preview document for upload provenance. Implementation `9096488` is pushed and
published at **https://1cd6c549.baxstar-ember.pages.dev**; all Cloudflare preview stages
succeeded at 2026-10-17 18:39:18 UTC. Brady subsequently signed into that preview,
reported that it looks good, and provided a styled screenshot. The latest preview
follows https://codex-ember-brass-pressure-a.baxstar-ember.pages.dev; the immutable
`1cd6c549` checkpoint retains the old third tab.

The dashboard now links to the isolated Voice Lab. Adjustable phrase grace, manual
Finish, Escape cancellation, transcript copy, and state-driven instrument lighting
are implemented there. Pages previews allow microphone/transcript testing only;
their gateway deliberately cannot send chat or TTS requests. Physical voice and the
Worker/model/fresh-consent production rollout remain open gates.

**Access rechecked, 2026-10-17 UTC:** the environment's Cloudflare API token verifies
as active, and authenticated reads confirm the Ember Worker and Pages project in
account `9d1afb55bb78592212916ec0244bd8e4`. The preserved original branch already has
a successful Pages **preview**, `https://5b56930b.baxstar-ember.pages.dev` at `108d444`.
That is distinct from a production release. The Worker still serves version
`6110e34c-2363-41c5-a5f6-fab751ecb717` from October 16; the coordinator binding/new
consent seeds are absent. This session has no signed-in production browser, and its
network proxy cannot render the preview host. Ask Jev, Drive, Registry, and Relay
tools remain unavailable. No production or booking-app changes were made.

**Newly reproduced release blocker:** full alternative validation exposed a stale
cross-tab localStorage read in the existing simultaneous-board-edit test. It also
reproduces against preserved `108d444`. Web Locks alone did not prevent the second
tab from replacing the first edit; see Known Issues §5. The persistence code is
unchanged in the visual alternative. Do not treat a later passing rerun as a repair
or release production until the regression is resolved.

**Local continuation, 2026-10-16:** branch `codex/ember-command-plate-light` contains
the command-plate design refinement and subsequent connector/sync reliability
repairs. A SQLite Durable Object now coordinates refreshes across Worker instances,
persists rotations, and prevents replay after ambiguous refreshes or restarts. The
new coordinated seed secrets require fresh consent; legacy KV is not imported.
Partial/failed syncs distinguish updated, retained, and demo feeds, with STALE
indicators after failures. These changes have not been deployed. The authenticated
cutover and production verification remain open. See `docs/DEPLOY.md`,
`HANDOFF-CINEMATIC.md`, and Known Issues §1c–1d for scope and restart steps.
Offline notes now distinguish incomplete setup, a needed sign-in, and a temporary
failure; they preserve verified data and discard unknown provider error text.
The latest continuation also repairs manual revenue parsing and Mission Control's
local persistence. Money entry preserves cents; unreadable boards are never reset
on mount. Failed or conflicting saves retain the draft across tool switches with
retry/download controls. Board edits and reviewed OPS tasks share a Web Lock where
supported. These local protections do not add cross-device sync or external writes.

**Preserved baseline validation:** full `test:release` passed with system Chromium:
771 checks across all 15 suites, including 17 local-state regressions. The unchanged
Worker/config also passed Wrangler 4.135.0 dry-run at the prior checkpoint. This
includes real workerd/SQLite with synthetic providers, not live OAuth or physical-device proof.

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
  (alternative overlay: Foundry + The Works) · Google Drive · FareHarbor · Projects.
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

The former phone/wake-word stack is not part of the application. The new explicit
recording preview is a separate user-authorized experiment; see `docs/VOICE-REBUILD.md`. Brady's latest voice
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
  `/api/messages`, `/api/tts`, `/api/connectors/status`, `/api/outbox`,
  `/api/voice/transcribe`, and `/api/voice/speak`, and only
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

The historical September release matrix was green: **562/562 checks**. The preserved
October branch's complete 771-check matrix is recorded above and in
`HANDOFF-CINEMATIC.md`; alternative validation is in `docs/ALTERNATIVE-PREVIEW.md`.

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
