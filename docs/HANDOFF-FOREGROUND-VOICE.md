# Resume Ember: foreground voice and the large skull

**Conversation mode update — October 26, 2026:** mouth-started voice now automatically
sends finalized speech, speaks with Jenny and listens again within the active
foreground session. The user's new instruction supersedes older mandatory
review/Send and no-rearm requirements below. Stop/close/hidden-page/typing ends the
session; unfinished or failed turns pause for recovery. Typed questions stay
text-only. Main defaults are now Opus 5.5 / High (preferences v5), including a
one-time migration; subsequent choices persist. Desktop no-scroll and the pinned
dock are retained. See `docs/VOICE-CONVERSATION-PROOF.md` for inspected primary
sources, implementation boundaries and the outstanding physical-device proof.


## Latest correction — October 26, 2026

Desktop OPS must never require page scrolling. Brady explicitly corrected the
scrolling exception in this original handoff. Use the current center-stage desktop
layout (2026-10-31: skull over a full-width conversation, Model/Effort in the flanks
beside her) and compact recent feeds; preserve phone stacking,
the pinned dock and a skull whose size is independent of history. This requirement
supersedes the older layout guidance below.

## Start here

Brady authorized either this handoff or continuing implementation after the latest
voice conversation. This checkpoint records the approved work for a text-mode
continuation using his preferred model/effort. **Implementation checkpoint:** the foreground integration and visual treatment
are now implemented on `codex/ember-foreground-voice`. See `docs/CURRENT-STATE.md`
and `docs/VOICE-REBUILD.md` for current behavior and verification. The remaining
physical check is on the integrated UI; do not restart platform research.

Repository: `baxstarcode/baxstar-ember`.
Executable base: main `5d911ba` (`Default Ember chat to Medium effort`).
Handoff branch: `codex/ember-foreground-voice-handoff`.
Production: https://ember.baxstarfishing.com/
Existing lab: https://ember.baxstarfishing.com/work/desktop-voice-probe/

Read `AGENTS.md`, `docs/CURRENT-STATE.md`, this file, and the relevant sections of
`docs/VOICE-REBUILD.md` and `docs/DEPLOY.md`. Fetch main before editing: Claude has
also worked here. Preserve concurrent changes. The Google Drive standards/registry
and Ask Jev tools were unavailable in this session; no registry/Relay write is
claimed. Use the existing repository, not a new build root.

## The approved product decision

Finish voice **while Ember remains open and visible**. Keep foreground CarPlay:
Brady already heard Jenny through his truck speakers. Background conversations,
app switching, and locking the phone are not release requirements for this work.

Do not build a native app, calling service, SIP/Discord bridge, Android solution,
embedded navigation, service-worker keepalive, or another background voice test.
Those alternatives were discussed and set aside. The older background-feasibility
handoff is historical research, not this assignment.

Brady explicitly authorized building, testing, committing, pushing, and publishing
the finished foreground version. He does not want routine permission questions or
another series of lab experiments. Use existing real-device evidence, then request
one short foreground check of the integrated feature after publication. That final
check is still needed; do not claim the new integration has been physically tested.

## Approved appearance — retain these decisions

1. **The skull stays large.** Brady dislikes it becoming “puny” after a message is
   created. Its size must not depend on whether chat history exists or grows.
   It can adapt to screen size; compare empty and populated chat at the same viewport.
2. Brief, readable phrases appear **inside/across the mouth**, then disappear.
   The lasting conversation is shown below. Long text must remain available there.
3. Final animation direction is a **hot brand pressed inward from the viewer toward
   the screen**. This supersedes the earlier idea of words coming out of the throat.
   Start slightly larger/closer; press into the mouth plane; flare molten orange on
   impact; settle into sharp ivory lettering with warm edges; hold long enough to
   read; shed a few embers and fade. Keep the skull anchored throughout.
4. The conversation box below uses smaller readable text and shows approximately
   **four to six lines**. Older messages scroll inside it. Do not allocate the whole
   chamber to history or erase full replies to meet the line budget.
5. **Preserve the pinned bottom row**, including OPS and Caption Studio. Brady has
   repeatedly called that row excellent. Preserve the brass button outlines,
   pressed-button feel, brighter text, and approved knowledge graph.
6. Provide a calm reduced-motion version. The decorative mouth text must not steal
   mouth-button clicks or repeatedly announce duplicate text to screen readers.
   Readability and a usable phone layout matter more than particle count.

No exact word-level audio timing was promised. Do not label a timed phrase animation
as accurate speech synchronization without actual timing data. Link speaking states
to real playback events and avoid animating a successful spoken reply when TTS failed.

## What works and what does not

- The separate Voice Lab has physical evidence for recognition → text response →
  Jenny playback on Mac and iPhone, including foreground wireless CarPlay.
- Device: user reports iPhone 17 Pro / iOS 27.0.1, wireless CarPlay, 2024 GMC.
  Browser context has varied between Safari, Chrome and an in-app browser; user-agent
  strings alone cannot prove which host was used.
- Latest verbal clarification: on his computer, voice continued across browser tabs,
  but stopped on switching to another program. Keep that observation; do not rewrite
  it as universal behavior or use it to reopen background-support research.
- At the handoff base, the skull opened a different, recording-only modal gated by
  `EMBER_VOICE_RELEASED=false`. The implementation replaces that modal with the
  lab-derived path; the unused recording/transcription backend was not activated.
- Main chat defaults to **Opus 5.5 / Medium**, published at `5d911ba`. Preferences v4
  apply Medium once while preserving v3 model choices; later user choices persist.
- Dashboard syncing deliberately remains Haiku 5.5 / Low. The isolated lab still
  uses Sonnet 4.6. Integrated voice must use main chat's selected model and effort.
- Keep the chosen female voice **Jenny / `en-US-JennyNeural`**. Do not silently switch
  to the unused Aura/Luna speech route or another provider.

## Exact code findings

Canonical app: `src/baxstar-ember.jsx`; generated output: `index.html`.
Line numbers below refer to base `5d911ba` and may move.

### Why the skull shrinks

- Around line 3926, `.core-chamber.has-thread .reactor-stage` sets a smaller radius
  with `clamp(96px, calc(100dvh - 760px), 170px)`.
- Around line 3953, the desktop `.ops-fit .core-chamber.has-thread .reactor-stage`
  makes it even smaller: `clamp(64px, calc(100dvh - 810px), 150px)`.
- Around lines 3967–3971, only `:not(.has-thread)` gets the larger flexible chamber
  sizing. A correct fix must reconcile both states, not patch one selector.
- Around line 3939, `.ops-fit .home-thread` consumes remaining space with flex.
  Around lines 2990–3028, other thread-height rules also compete across breakpoints.
- The mouth entry is the `.reactor-stage` in the OPS center around line 4268.
  The current asset is `assets/ember/raster/reactor-bezel@2x.webp`, with the orange
  orb positioned over its center. Preserve the approved artwork and dock.
- Old one-screen desktop constraints should not force the skull to become tiny.
  Favor stable hero size plus bounded conversation scrolling. Desktop must fit
  without page scrolling; phone layouts may scroll.

### Reuse the tested voice behavior

- `work/desktop-voice-probe/probe.js` uses `SpeechRecognition` /
  `webkitSpeechRecognition`, not the skull modal's MediaRecorder/transcription path.
- Lab `startTalking()` around line 317 includes explicit start, interim/final words,
  configurable end-of-phrase grace, a bounded turn, error handling and release checks.
  Reuse its hard-won cancellation, late-event and incomplete-draft behavior.
- Lab TTS uses same-origin `POST /api/tts` with `{ text, voice: "en-US-JennyNeural" }`.
  It uses an audio element, handles blocked playback with an explicit Play option,
  and requests `navigator.audioSession.type="playback"` when available, restoring
  `auto` afterward. The playback-session change was part of the successful truck fix.
- The lab currently slices spoken text to 1000 characters. Check the existing Worker
  contract and handle long replies explicitly; do not silently omit important text.
- Current `EmberVoice` around lines 1307–1549 instead calls disabled
  `/api/voice/transcribe` and `/api/voice/speak` and is recording-only. Consolidate
  toward the working lab path rather than activating this unverified alternative.
- Main `sendCommand(text, { voiceSignal })` around line 2005 already persists normal
  conversation, uses selected model/effort and connectors, requests concise spoken
  answers, supports scoped cancellation, and returns a completed reply. Reuse it.
  Never resend a chat question just to retry failed speech output.

## Required behavior and boundaries

- Explicit user action starts microphone capture; no mic on load or automatic rearm.
- Release the mic before playback. Distinguish “release requested” from confirmation;
  handle timeout/error without claiming the physical indicator is off.
- Preserve received words and completed replies on interruption. Incomplete words
  remain reviewable, and partial model responses must not be presented as complete.
- Keep typed input, Stop, Send/review and Replay usable. Avoid silent repeated API
  calls. The lab's explicit turns are the verified starting point; full-duplex and
  continuously rearming hands-free behavior are not part of this scope.
- Request Screen Wake Lock while an explicitly active voice session needs it, where
  supported. Report actual acquisition/denial and release it on Stop/exit. It cannot
  override manual lock or app switching. No silent restart on returning to Ember.
- Maintain existing preview API restrictions, authentication and server-only secrets.
- Preserve normal chat history/model controls, Mission Control protections and the
  dock. Do not touch the separate booking app or unrelated connector/OAuth work.
- No Worker rollout is expected for reuse of `/api/messages` and `/api/tts`. Do not
  deploy `proxy/wrangler.toml` casually: it includes a separate OAuth coordinator
  rollout requiring documented fresh consent. Stop and investigate if the existing
  endpoints actually fail; do not migrate them merely for this UI integration.

## Implementation and validation plan

1. Refresh main, read relevant instructions, and record this narrow scope. Preserve
   the last approved build/commit as a comparison and rollback point.
2. Implement stable skull sizing, the mouth-text treatment and the compact transcript
   region together so the layout is tested with actual conversation content.
3. Integrate the working foreground voice path with main chat and Jenny. Add wake
   lock handling. Keep all capture explicitly started and foreground-only.
4. Test fresh/repeated turns, failures, Stop during capture/request/playback, late
   callbacks, speech retry without duplicate chat, preserved transcript, wake-lock
   denial/release, and reduced motion. Use mocks/synthetic inputs for engineering
   checks and label them correctly; they are not new physical iPhone evidence.
5. Compare empty/short/long history at desktop and phone widths. Verify the skull
   does not shrink; four-to-six-line transcript remains usable; mouth text fits;
   the pinned dock remains visible and functional. Inspect real rendered screenshots
   at phone scale factor 3, including the impact and settled animation frames.
6. Run build and relevant regression suites. Existing scripts include `test:chat`,
   `test:streaming`, `test:layout`, `test:mobile`, `test:alternative`, `test:ui`,
   `test:voice-probe`, `test:voice-recording` and `test:pages`. Update obsolete
   recording-only UI expectations to the newly approved feature instead of weakening
   cancellation/permission assertions. Broaden checks where the actual changes warrant.
7. Inspect the staged diff and publish the reviewed Pages build using documented
   deployment steps. Preserve any newer main changes. Verify deployment commit and
   alias. A signed-out HTTP 403 is Access behavior, not a signed-in functional check.
8. Give Brady the production link and one short, parked foreground CarPlay check:
   tap the skull, speak, receive a normal chat response, hear Jenny, and confirm the
   skull remains large. No app-switch/lock test is an acceptance requirement here.

Build-system warning: `build.mjs` uses `transformSync` on the single JSX source,
replaces one exact React import, and inlines globals. It is not presently a general
module bundler. Adding arbitrary source imports without adapting the build and test
snapshot helpers will break it. Favor the smallest supported change.

## Completion standard

Done means the published skull entry runs the foreground conversation using the
chosen main-chat model/effort and Jenny; text remains in normal chat; the large skull
and inward hot-brand effect meet the approved appearance; Stop/retry/wake-lock paths
are covered; and remaining physical verification is described honestly.

The earlier “2–4 hours” was a rough estimate, not a guarantee. Do not spend another
session inventing platform alternatives. If a new architectural dependency blocks
this narrow version, identify it precisely and stop that dependent work.
