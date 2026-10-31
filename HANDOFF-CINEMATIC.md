# Ember — Living Cinematic Handoff

**2026-10-31 — Ember center stage (Claude):** on desktop the skull fills the upper
chamber again with no 360px cap (406px at 1440×900, 586px at 1920×1080), over a
full-width conversation; plates and Model/Effort moved into the flanks beside her. No
page scroll. Details: `docs/CURRENT-STATE.md`.

**2026-10-26 — Quo is back (Claude):** the token-coordinator Worker cutover and the
voice AI binding are live (Worker `47108b31`), and Brady completed fresh Google and Quo
consent. His signed-in page shows Quo, Gmail and Calendar lit, with a real Quo missed
call. A recheck after token expiry is PROVISIONAL. Details: `docs/CURRENT-STATE.md`.

**2026-10-23 — Signal Log rides inside the dashboard (Claude):** YOUR TOOLS → Signal
Log opens an overlay (same-origin frame, same sheet as the Knowledge Graph); cards
carry `Open in Gmail/Calendar ↗` and **Ask Ember** (card → composer, unsent). The
Schedule panel title squeeze is fixed (PR #54). Details: `docs/CURRENT-STATE.md`.

**Voice check v6 — 2026-10-22 (Claude):** switching apps mid-reply no longer cuts
Ember off; only an already-playing reply continues (mic and requests still stop).
Next physical check: start a spoken reply on CarPlay, switch to Maps, and report
whether she keeps talking. Details: `docs/VOICE-REBUILD.md`.

**2026-10-22 — Claude took over the build from Codex; Signal Log is live:** read
`docs/CURRENT-STATE.md` first. `/signal-log/` (YOUR TOOLS → Signal Log) now reads
Gmail and Calendar through the existing gateway (`signal-log/ember-feed.mjs`);
its signed-in production read is PROVISIONAL until Brady confirms it
(`docs/KNOWN-ISSUES.md` §9). The voice five-turn gate (3 of 5 physical passes),
the coordinator Worker cutover with fresh consent, and the voice AI binding remain
the open items; none of them changed here. PR #50 is superseded by this merge.
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



**Speech fix deployed, October 18 at 22:00 CT:** read the newest Current State block.
The phone screenshot confirmed provider refusal. Canonical implementation `d9a826c`
updates the obsolete v1 speech connection token to the v2 algorithm used by current
edge-tts 7.3.1, preserving Jenny. The live Worker received only this speech hotfix:
version `f8d6ac15-844d-4e59-b0ed-20f8822dcf09` at 100%, all settings/bindings retained.
It has **not** received the pending coordinator migration. Reference and Worker
tests pass, including the exact candidate in workerd. **Phone speech confirmed
2026-10-19 UTC:** Brady answered the post-repair fixed-sentence test with “I hear
Ember’s voice.” One actual phone speech-only attempt is audible. Next: a complete
phone turn, then parked wireless CarPlay playback. Repeated turns, physical mic
release and interruptions remain unverified; the orange mouth is recording-only.

**Earlier voice failure evidence, 2026-10-18:** Brady's physical phone/wireless-CarPlay tests
captured speech and returned useful text, but both failed to speak the reply.
The supplied older-lab v2 report fails before `audio-ready` and hides the exact HTTP
cause. Diagnose the speech request before changing browser or truck routing.
Read `docs/VOICE-REBUILD.md` and the top of `docs/CURRENT-STATE.md`. The selected voice
is JennyNeural; the new disabled Aura/Luna adapter is a different voice. No automatic
substitution. The signed-in connector-free chat path now has current device evidence;
Gmail/Quo freshness and spoken output remain separate open checks.
Diagnostic implementation `a608230` is now production through Pages `f484ffaa`,
completed October 18 at 21:35 CT. Open the live lab, confirm **Voice check v3**, enable
the phone experiment and tap **Test Ember’s voice**. This speech-only diagnostic
needs no mic/chat; it preserves separate safe failure records. 105 focused checks
and Pages build passed. This is not yet a repair of the unresolved spoken reply.

**Latest continuation, 2026-10-18 (America/Chicago):** read the top of
`docs/CURRENT-STATE.md`. Implementation `7ea389a` is now production at
https://ember.baxstarfishing.com (Pages `662422a8`, completed October 18 at 02:04 CT).
The full release suite passed 1008 checks across 19 suites. Brady authorized an independent Mission Control save repair and
mobile pass while voice/account checks wait. Revision-checked IndexedDB transactions
replace unsafe localStorage writes; the original copy stays intact. Mobile field
layout, touch controls and navigation are fixed without changing the pinned dock.
See Known Issues §5 and Deploy for migration/rollback details. No Worker or
credential changes; recording-only voice and pending Gmail/Quo consent are separate.
Older release-blocker/preview statements below describe their dated checkpoints.

**Latest voice continuation (2026-10-17):** read `docs/VOICE-REBUILD.md` before voice
work. Brady authorized an explicit recording experiment behind the orange mouth.
Preview supports local record/playback; new official speech adapters are implemented
but disabled/unreleased. Claude confirmed no hidden working mobile version. Physical
iPhone/CarPlay and the existing production rollout remain open. The original pinned
dock and visual checkpoint are preserved. No live Worker/secrets changed.


Checkpoint date: **2026-10-17 UTC** (alternative branch; recorded production evidence is dated
2026-09-20). This is the compact continuation brief for any
builder entering Ember cold. Git history preserves the long design chronology; this
file records what is load-bearing now.

## Latest entry point — alternative visual preview, 2026-10-17 UTC

Continue `codex/ember-brass-pressure-alt`, branched from handoff `108d444`, for
Brady's requested Argon-inspired alternative. The original
`codex/ember-command-plate-light` remains preserved. **Do not replace the pinned
OPS / Caption Studio / Knowledge Graph / Google Drive / FareHarbor / Projects dock.**
Its artwork, arrangement, and existing mechanical animations remain intact; only
press feedback is added. The larger skull is retained too.

Earlier alternative implementation: `74c3ae3fff49aa0cc6517b552067142e47545b6b`.
Successful preview: **https://3ee28ad7.baxstar-ember.pages.dev**, deployment
`3ee28ad7-c940-4575-9d2f-f7693768306a`, verified via Cloudflare API at
2026-10-17 02:54:26 UTC. No merge or production release. Validation: 830 passed,
1 existing concurrent-board-save failure; details below.

Brady's first pasted Argon HTML supplied the brass outlines, warmer vivid controls,
and 20-node/34-link orbital reference map. That paste ended mid-script. Brady then
supplied the complete **Universal Responsive Modal v2** graph (47,783 bytes). The
latest continuation adopts its exact node positions, coral/brass finish, glass
filters, concentric rings, moving particles, and mobile bottom drawer in React.
It retains neutral descriptions, keyboard access, source links, and the original
dock; it corrects header clipping and gesture coordinate scaling. Only the graph
section of application source changes. Focused validation: **285/285** checks;
desktop, phone, narrow phone, and landscape renders inspected. This does not close
the existing production/concurrent-save gates. Graph implementation `9096488` is pushed;
preview **https://1cd6c549.baxstar-ember.pages.dev** succeeded through all Cloudflare
stages at 2026-10-17 18:39:18 UTC (deployment
`1cd6c549-a673-4764-a8b0-55b98a8e9a3e`). See the preview document for details.
Brady reviewed the preview, said it looks good, and then requested removal of the
duplicate Source map tab. The overlay now contains Foundry and The Works only;
the original graph link is archived in `docs/ALTERNATIVE-PREVIEW.md`. The Works and
the pinned dock remain unchanged. The latest preview follows the branch alias
https://codex-ember-brass-pressure-a.baxstar-ember.pages.dev.
The older voice lab remains beside Enigma/Scope; the new mouth recording preview is
documented in `docs/VOICE-REBUILD.md`.
Physical Mac/iPhone gates and the staged production rollout still apply.

Read `docs/ALTERNATIVE-PREVIEW.md` for exact provenance, validation, preview links,
and remaining work. It supersedes the older capability statements below: Cloudflare
API authentication now works, and the original branch was already auto-published as
a preview at `https://5b56930b.baxstar-ember.pages.dev`. Production has not received
the coordinator/UI release. There is still no authenticated browser tool, Ask Jev,
Drive, Registry, or Relay access in this session. The separate booking app remains
untouched; the meaning of Brady's “Claw” attribution is still unconfirmed. Earlier
onboarding notes identify `baxstarcode/baxstar-booking-app` and its dated
`docs/HANDOFF_TO_CLAUDE_2026-10-14.md` at `eb3091ddf556f927f964a876df5f9fa3a13706ba`.
Those are recorded prior read-only findings, not a fresh booking-app audit in this
visual continuation. Recheck that project's current handoff before any future work.

Full validation also reopened the simultaneous Mission Control save issue: the
second tab can read stale localStorage even inside a Web Lock and replace the first
edit. The same regression reproduced against preserved `108d444`. See Known Issues
§5; the visual alternative does not change persistence code. This is an additional
production-release blocker, not a reason to report a retry as a clean release pass.

## New Codex chat entry point — 2026-10-16

Brady explicitly requested this handoff after confusion about which AI last worked
on a **booking app**. The work verified in this conversation is **Ember**. Brady
believes “Claw” may have been the booking-app builder, rather than Codex, but that
attribution was **not confirmed**. The booking app's repository, latest commit, and
handoff were not identified. Do not equate it with Ember, Pontoon check-in, or another
project merely because those products are mentioned here. Establish its identity
and provenance from the available records before changing booking-app code.

### Exact repository checkpoint

- Repository: `baxstarcode/baxstar-ember`.
- Branch: `codex/ember-command-plate-light`.
- Latest implementation commit: `34b659153cc0f96d6cc814cdfa2f27201febd274`
  (`Preserve Mission Control drafts and validate revenue amounts`).
- Local and remote branch matched, with a clean tree, immediately before this
  documentation-only handoff update. Remote `main` was
  `af8d6ba9d00742957a7a2f40214fcf8fdf5565ca`; re-check remote state on entry.
- The overnight branch work is pushed, but **has not been deployed or merged**.
  Older production evidence in this file must not be represented as proof of this
  branch's deployment.

### What is already completed

The branch contains restrained command-button material/lighting details, durable
OAuth refresh ownership, honest partial/stale sync and connection recovery guidance,
correct dollar/cent entry, and Mission Control protections against unreadable data,
failed saves, and competing tabs. Unsaved board edits survive tool switches and
offer retry/download recovery. Details and limitations are recorded below and in
`docs/KNOWN-ISSUES.md`; do not rebuild these features from scratch.

At implementation commit `34b6591`,
`CHROME_PATH=/usr/bin/chromium npm run test:release` passed **771 checks across 15
suites**. Desktop/phone screenshots were inspected. The unchanged Worker/config
passed Wrangler 4.135.0 dry-run at the preceding checkpoint. Live OAuth, authenticated
deployment, physical microphone/speaker behavior, and the controlled Drive-outbox
write are still separate, unfinished gates.

### Ask Jev and available access

Brady explicitly authorizes routine, thoughtful use of Ask Jev. His most recent
plugin reference is
[Ask Jev](plugin://dev-7ce8bdbda558819191a84ba67dd5fa90@created-by-me-remote/).
After that reference was attached, this session's tool catalog still exposed no
Jev tools or tool-search capability. **No Jev call was made.** This establishes a
session capability gap, not a broken Jev account. Re-check available tools in the
new chat and, if callable, verify with one useful read-only call. Starting a new
chat was suggested as troubleshooting, not a confirmed repair.

Git read/push worked. Cloudflare credentials, an authenticated live browser, Drive,
Registry, and Relay write-back were unavailable; GitHub API access was also blocked.
Do not infer that these limits still apply in a new environment: inspect available
capabilities. Do not claim external handoff records were updated by this session.

### Resume order and working agreement

1. Read `AGENTS.md`, `docs/CURRENT-STATE.md`, this file, `SOURCES-OF-TRUTH.md`,
   `docs/KNOWN-ISSUES.md`, and `docs/DEPLOY.md`; inspect the branch and worktree.
2. Check Ask Jev's actual callable tools. If the intended work is the booking app,
   locate its canonical repo/handoff and verify the last builder. If available
   evidence cannot identify it, ask Brady for its repo or handoff link instead of
   guessing or creating a duplicate build.
3. For Ember, the next release priority is the authenticated Worker/model/token
   coordinator rollout in `docs/DEPLOY.md`. Fresh consent uses the coordinated
   Google/Quo seed secrets; do not import uncertain legacy refresh tokens or KV.
   Deploy/verify the compatible Worker before releasing the UI through Pages.
   **Do not merge this branch just because the offline tests passed.**
4. Reuse existing authorization for ordinary work and verified commits/pushes.
   Brady asked for sustained independent progress and dislikes repeated permission
   questions. His authorization does not establish that tools or credentials exist,
   and it does not replace the documented release checks.
5. Preserve the warm steampunk identity, frozen IDs/storage keys, and review before
   external actions. Edit canonical source, regenerate outputs, and never put
   secrets in client files, Git, or logs. Voice integration still needs its physical
   gate. Continue useful local work if an external dependency remains unavailable.

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
and desktop/phone screenshots at device scale factor 3. The later full release-suite
results are recorded below. Live deployment verification remains outstanding; the
environment cannot reach the live hostname and has no Drive/Cloudflare connector.
Registry and Relay write-back remain
unavailable. The separate iPhone Shortcut PR #48 was inspected and left untouched.

**Reliability continuation, 2026-10-16:** the same branch now repairs the reproduced
token-store fallback within one Worker isolate, coalesces concurrent refreshes, keeps
and retries unsaved rotations, and serializes overlapping re-consent. The dashboard
now reports updated, retained, and demo feeds accurately; failed refreshes show STALE
instead of keeping a green LIVE lamp. Known Issues §1c–1d records the precise scope.

Reliability validation: build/Pages staging passed; 233 Worker, 36 Pages gateway,
27 outbox, 24 posting-time, 26 chat, 87 layout/truth, and 100 dashboard checks passed
(533 total). Browser checks used system Chromium with `CHROME_PATH`; dashboard
fixtures exercise the system-font fallback. The new Worker suite fails 15 checks
against the previous implementation and passes all 233 against this repair.
This is targeted local verification, not a completed release or live OAuth gate.

**Overnight continuation, 2026-10-16:** Brady authorized continued independent building.
The branch now adds a SQLite Durable Object per OAuth grant. Two independent caller
Workers share a serialized owner, including Google's 3 connectors. State survives a
full runtime restart. A durable intent marker prevents replay if a refresh's outcome
is lost; same-instance failed saves can retry without contacting the provider again.
Fresh consent uses new `MCP_COORDINATED_REFRESH_GOOGLE` / `_QUO` encrypted seed secrets;
old KV state and legacy secrets are not imported. Wrangler config includes the binding,
SQLite migration, and required-mode guard. All 23 new failure/runtime tests passed.

Miniflare is a pinned development-only dependency. Cloudflare's actual workerd runtime
caught an unsupported `redirect:error` option; the implementation uses manual redirects
and rejects non-success responses. The test harnesses now consistently honor
`CHROME_PATH`, and command-plate assertions account for the decorative aria-hidden
serials without changing label/geometry expectations. The complete release command
`CHROME_PATH=/usr/bin/chromium npm run test:release` passed: **742 checks** across
239 Worker, 23 coordinator, 36 Pages, 27 outbox, 24 posting-time, 26 chat, 100 dashboard,
87 layout, 14 streaming/effort, 38 ecosystem, 36 UI, 46 Caption Studio, 22 voice-grace,
and 24 voice-lab simulations. Wrangler 4.135.0 dry-run also passed. Physical device,
live provider, and authenticated deployment checks remain separate and unverified.

**Recovery guidance:** the next local pass adds fixed, privacy-safe status reasons
for incomplete setup, new sign-in, and temporary unavailability. OPS keeps verified
data and explains the next action; unknown provider text is discarded and successful
sync clears old guidance. Desktop/phone checks cover the three reasons, retained email,
unknown-code filtering, and recovery. No new external action or permission was added.
The combined full release rerun passed **754 checks**: coordinator coverage is now
27 and dashboard coverage 108, with all other counts above unchanged. The final
Worker dry-run passed; desktop and phone recovery renders were inspected at 3× scale.

**Local data preservation:** the next continuation reproduced two browser defects:
`$12.50` became `$1,250`, and simply opening Mission Control replaced malformed
saved JSON with defaults. Revenue now accepts validated dollars/cents, retains
invalid drafts without changing the old amount, and fits the odometer at desktop
and phone widths. The stored dollar/date shape is unchanged.

Mission Control now validates before rendering, never saves on mount, and retains
unknown metadata and older optional-list formats. Quota/read failures get visible
recovery controls, exact local downloads, and a best-effort leave warning. Unsaved
edits survive switching tools. Board and OPS task writes share a Web Lock; a newer
saved snapshot creates a recoverable conflict instead of replacing it. Explicit
discard is required before loading the other saved version. No backend or external
task write was added. See Known Issues §5–6 for the remaining browser/local limits.
The new `test:local-state` suite is part of the release command.
The final `CHROME_PATH=/usr/bin/chromium npm run test:release` passed **771 checks
across 15 suites**, including 17 new local-state scenarios. Browser checks covered
desktop/phone entry, quota/read failures, exact downloads, navigation/reload,
malformed and older records, two-tab contention, the shared OPS task lock, storage
clear, and the no-Web-Locks fallback. Desktop and phone renders were inspected.
Worker/config are unchanged from the prior successful dry-run. Live production and
physical-device checks remain outstanding.

**Next priority:** follow the fresh-consent cutover in `docs/DEPLOY.md`, then verify
the deployed Worker/model compatibility and connectors in an authenticated session.
No production deployment or external connector write was performed. Cloudflare
credentials and a signed-in live browser remain unavailable here. Ask Jev was checked
again but is still unavailable through this session's tools. GitHub API access also
remains unavailable; Git branch reads/pushes work. Drive, Registry, and Relay write-back
remain unavailable; this repository checkpoint is the exact outstanding handoff entry.

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

The new user-authorized mouth panel provides an explicit recording experiment; see
`docs/VOICE-REBUILD.md`. Production voice remains unproven. The isolated desktop probe
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
