# Recorded voice rebuild — 2026-10-17

**Voice check v6 background playback — October 22, 2026 (Claude):**
Brady's CarPlay report (session `2026-10-22T13:02:49Z`, iPhone Safari 27.0.1,
v5) played the fixed test sentence through to the end (8.3 s), then replayed it
from the native player and switched apps 2.6 s in; the hide handler's `stopAll`
cut Ember off by design and he marked the attempt Failed (mic off, audible: yes).
v6 keeps a reply that is **already playing** when the page is hidden: no pause,
the `playback` audio session is kept so iOS can continue over CarPlay, and the
session returns to `auto` when the clip ends. Everything else on hide is unchanged:
the microphone still closes at once (and v5 keeps received words), any in-flight
text or speech request still cancels, audio that has not started yet is not
started, and nothing restarts on return. The report records `tab-hidden /
playback-kept`. Not proven: whether iOS actually keeps a backgrounded Safari
`<audio>` element playing through CarPlay — that is the next physical check.
This was a speech-only test, so it does not count toward the five-turn gate.

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


## CarPlay post-capture audibility — 2026-10-20

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

References checked against current upstream text on October 20:
- [W3C Audio Session draft](https://github.com/w3c/audio-session/blob/main/index.bs)
- [MDN AudioSession.type](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)

These describe audio-mode intent, not guaranteed Web Speech release or CarPlay
routing. The web page cannot claim to select or observe the GMC speaker route.

## Confirmed refusal and compatibility repair — 2026-10-18 (America/Chicago)

Brady's v3 screenshot shows **Neural TTS HTTP 502. The speech provider refused the
connection.** This is the known Worker refusal error, not a browser autoplay or
CarPlay routing failure. No further microphone/vehicle test is needed to reproduce
that layer. The upstream status number remains absent from the screenshot.

Pre-repair read-only inspection found the live v1 `Sec-MS-GEC` algorithm. PyPI's current
edge-tts 7.3.1 (October 13) uses v2 with a different combined digest, while retaining
the same browser-version constant. Both the version parameter and token algorithm
must change together. The licensed server-side port matches the unmodified Python
reference across 38 timestamps, including a five-minute boundary. Existing Worker
contracts pass; the exact hotfix candidate also runs in workerd with a synthetic
WebSocket delivering MP3 frames, and retains the chat and hostname gates.

Only speech compatibility is being changed. JennyNeural is preserved; no provider
account, billing change, new key, alternate voice, microphone flow or connector
cutover is part of this repair. The source/module deployment is described in
`docs/DEPLOY.md`. The endpoint remains unofficial; one actual signed-in TTS request
must establish whether v2 restores live output. If rejected again, stop adding
protocol workarounds. Local mocks/reference agreement are not live provider proof.

Deployed at **October 18, 22:00:33 America/Chicago** (October 19 03:00:33 UTC):
Worker `f8d6ac15-844d-4e59-b0ed-20f8822dcf09`, 100% traffic. The two deployed modules
match the tested hotfix hashes and all 12 existing bindings/runtime settings match
the pre-upload metadata. The deployed connector code remains the old version;
no coordinator rollout was bundled into this repair.

**Post-repair physical result — 2026-10-19 UTC:** Brady reports **“I hear Ember’s
voice”** in response to the fixed-sentence phone test. This confirms audible live
speech on the phone for one speech-only attempt. No success diagnostic export or
exact browser/output route was supplied. It does not prove a full microphone/chat/
playback cycle, repeated turns, mic release, interruptions, wireless CarPlay playback,
or the integrated skull panel. Next: a full phone turn, then a parked truck test.
Keep the integrated orange mouth recording-only until its separate release gates pass.

## Physical report and speech investigation — 2026-10-18

Brady reports successful microphone transcription and useful text replies on his
iPhone alone and through wireless CarPlay in his 2024 GMC. Neither attempt produced
an audible spoken reply. The supplied report covers the first session: iPhone
17 Pro / reported iOS 27.0.1, Chrome iOS 155, production origin, lab report v2,
started `2026-10-18T19:33:44.065Z`. This is the **older isolated Web Speech lab**,
not the orange mouth's MediaRecorder experiment.

Its event list records recognition ending and a complete streamed text reply, then
two TTS failures after 356 ms and 684 ms. Neither reached `audio-ready`. The v2
`request-or-audio-error` category cannot distinguish HTTP rejection, non-audio
responses, download failures or audio preparation. Autoplay rejection has a separate
event after `audio-ready`, so this report does not establish an iOS/CarPlay playback
policy failure. Repeated events overwrite v2 turn marks; use the chronological events
for those timings. The unchecked microphone-off box means physical release was
**not confirmed**, not that the microphone necessarily stayed active. No second
session JSON or visible HTTP error was supplied.

Authenticated inspection confirms live Worker `6110e34c-2363-41c5-a5f6-fab751ecb717`
still implements `/api/tts` using the unofficial Microsoft Edge consumer WebSocket
and **`en-US-JennyNeural`**. Pages forwards that exact route. Both deployed and local
legacy TTS code use the same voice and handshake. The voice selection is now explicit:
the disabled new adapter's Aura/Luna voice is a different voice and must not be
activated as a silent substitute for Jenny. Preserve the chosen voice or obtain
Brady's preference before any provider change that changes its sound.

The successful signed-in, connector-free streamed reply is current evidence for
the Pages → Worker chat path. The non-streaming-only preflight in Deploy §3 addresses
a historical Worker predating the live version; repeating it is not required merely
to re-prove this binding. This does not verify current Gmail/Quo credentials.

Next proof: isolate a single TTS request with the microphone off and capture its
safe HTTP/failure category. Fix that confirmed layer before repeating truck tests.
Do not infer provider rejection, change browsers, add microphone Shortcuts, activate
a new provider or deploy the coordinator based only on v2's generic failure.
The cloud workspace has authenticated configuration access but no signed-in
production browser; direct production requests return 403. Provider audio and actual
speaker output therefore remain open verification steps.

## Earlier implementation checkpoint

Status: **implemented for preview and simulated end-to-end; physical iPhone, CarPlay,
provider inference, and production deployment remain PROVISIONAL**. This continuation
is on `codex/ember-brass-pressure-alt`. The original visual branch, dock, graph, existing
chat, older voice lab, and legacy `/api/tts` remain available.

## Recovered work and what it proves

- Integrated voice source: [`snapshot/voice-era-final` at `1ea5307`](https://github.com/baxstarcode/baxstar-ember/blob/1ea5307d935c62dabb8bae6634eebe574091fce3/src/baxstar-ember.jsx).
  Contains Web Speech recognition, mic/speaker ownership, mobile warmups, voice selection,
  wake/armed modes, several delay-based iPhone handoffs, and TAP TO HEAR recovery.
- Native Shortcut attempt: [`codex/ember-iphone-shortcut` at `74c6642`](https://github.com/baxstarcode/baxstar-ember/blob/74c66428602feb329b43b73f919f06e4226d8bd6/work/iphone-shortcut/README.md), also PR #48's head.
  Native Dictate Text → private endpoint → MP3/Apple spoken reply. Its own handoff says
  **prepared, not live; native import and physical iPhone behavior provisional**.
  It has no working-device proof and is not a grant of Safari microphone permission.
- Current `work/desktop-voice-probe/` contributed explicit turns, cancellation epochs,
  honest preview limits, bounded waits, and content-free diagnostics. It still depends
  on browser SpeechRecognition; the new mouth panel does not.
- Historical `ios-voice`, `ios-voice2`, `neural-voice`, and the removed stack describe
  attempted repairs. Commit messages claiming iOS repair are not physical evidence.
- Brady relayed Claude's confirmation: no hidden working iPhone/CarPlay build; the
  iPhone failure led to voice removal in September. Claude also warned that the old
  app auto-armed on load and transcribed room audio. The new path never auto-arms.
- Checked remote branches: `claude/works-graph` (`a3aba28`) and PR #1 (`afe1935`)
  are ancestors of both this branch and main. `claude/overnight-tasks-rf3tue`
  (`973feb6`) has three unmerged commits: `3ea2198`, `3c2c49e`, `973feb6`.
  Their production-host link repairs already exist in current source; their generated
  build and September connector status do not supersede today's canonical build or
  fresh-consent rollout. No blind merge was performed.

Git refs, code, and repository handoffs were read directly. Past-chat/memory tools,
Ask Jev, Drive, and Registry are not callable on this host. Do not claim those records
were searched or updated.

## Decision and stop rule

This is a high-risk hardware integration because earlier iPhone attempts repeatedly
failed, browser audio routing is platform-controlled, and the old TTS service uses
an unofficial Microsoft Edge consumer WebSocket. Preserve the useful lifecycle
safeguards, not the old automatic rearming and timing guesses.

Use HTTPS `getUserMedia` + `MediaRecorder` for one explicit recording, stop every
capture track, review a transcription, use the existing Claude conversation, then
play an official speech-service response. This avoids browser SpeechRecognition and
Siri recognition availability. It does not bypass microphone permission or guarantee
CarPlay input/output routing. The experimental Audio Session API is feature-detected
as a routing hint, never treated as evidence of the actual hardware route.

The kill dependency is five usable, repeatable phone turns with correct capture,
audible output, cancellation and interruptions; repeat independently in the truck.
First prove local record/playback. Then prove the complete service-backed turn after
rollout. A recording-only pass is not a conversation pass. If capture/routing still
fails reproducibly, record the failure and stop adding delay/retry workarounds.
Evaluate a native audio client with Brady; do not silently create an iOS project.

## Implemented path

`src/baxstar-ember.jsx` owns the mouth entry and `EmberVoice` panel. Opening either
starts no microphone. Record is an explicit tap; Finish releases tracks before any
transcription or playback. Capture is capped at 40 seconds/2 MiB. Permission timeout
is 15 seconds, recorder finalization 4 seconds, and browser speech-service calls 30 seconds. The voice chat request is capped at 45 seconds.
Microphone grants arriving after Stop/close are immediately released. Tab hiding,
page exit, device track end and reported audio interruption cancel the active turn;
returning never restarts it. Stop cancels that voice turn's chat without cancelling
an unrelated request. Escape/close also stop and discard the recording.

`EMBER_VOICE_RELEASED=false` currently allows only local record/playback on **all**
hosts, including production. Keep this off until backend/provider/device verification.
Even after that flag is enabled, preview hosts allow only local record/playback. No recording is uploaded there.
Production flow is Record → Finish → Transcribe → review/edit → Send. Sent words
enter the existing persisted chat with its selected model, business context and
read-only connector policy. Spoken replies are requested only after a complete
response; failed/truncated chat does not speak. Reply text survives speech failure. Read reply retries speech independently without
resending the question; already-generated audio is reused within the open panel.
If autoplay is denied, an explicit native audio player remains available. Long replies
over 2000 characters stay readable rather than being silently cut off. No automatic
service retries, hidden alternate providers, wake word, full duplex or background
listening are introduced. This is an explicit-turn proof, not finished hands-free UX.

`proxy/voice.mjs` supplies two exact routes through the existing Pages binding:

- `/api/voice/transcribe`: server-selected `@cf/openai/whisper-large-v3-turbo`,
  English transcription, VAD enabled, previous-text conditioning disabled.
- `/api/voice/speak`: server-selected `@cf/deepgram/aura-2-en`, Luna, MP3.

Provider models, voice and destinations cannot be selected by the client. Audio input
is limited to 2 MiB; body reads, transcription length, speech length/output and response
waits are bounded. Empty speech/transcripts and provider failures fail honestly. No
raw audio, transcripts or upstream errors are logged or cached by this code. The
Cloudflare/provider data policies still apply; this is not a claim of zero provider
retention. Timed-out inference may finish upstream and incur usage; it is never retried
automatically. Audio is not written to Ember storage. Closing the panel discards it;
sent text remains in ordinary chat. Copy test report includes only device/origin,
codec, event names and timings, never conversation text or audio.

Legacy `/api/tts` is unchanged. It remains the Edge consumer endpoint used by the old
lab; the new path does not silently fall back to it. Existing origin/hostname controls
remain: previews and public `workers.dev` cannot call the new speech endpoints.

## Activation and release blockers

No live Worker or secret was changed. New speech routes return 503 unless both
`EMBER_VOICE_ENABLED=true` and an `EMBER_VOICE_AI` Workers AI binding are present.
There is no new API key to paste into the browser or a Shortcut. Neither activation
nor a billing/terms change has been performed. Verify account availability, model
terms and current inference pricing before activating; free capacity is not promised.

After the existing `docs/DEPLOY.md` Worker/model/coordinator/fresh-consent sequence is
ready, add the binding and variable in the *same coordinated Worker release*:

```toml
# Add inside the existing [vars] table:
EMBER_VOICE_ENABLED = "true"

# Add as its own top-level table:
[ai]
binding = "EMBER_VOICE_AI"
```

One deployment owner only. Read the current Worker version/settings immediately
before deployment and stop if another writer changed them since review. Preserve
existing secrets; never copy uncertain legacy refresh grants. Prove signed-in
connector-free chat through the Pages binding first. Deploy the Worker before Pages
starts sending new speech routes, then test actual Whisper and Aura output and disabled,
auth-expired and failed-service recovery. API token readiness does not prove Access
browser login or provider availability. This session has no signed-in production
browser tool. The pre-existing Mission Control simultaneous-save release blocker also
remains open. Do not promote this branch to production while those gates remain.

## Physical checkpoint for Brady

Device reported: iPhone 17 Pro, iOS **27.0.1** (user-reported, not independently
verified). CarPlay connection: **wireless**, confirmed by Brady. Priority: truck
mic/speakers while Ember stays on phone. Dashboard controls are excluded unless shown
to add at most 25% implementation work without sacrificing reliability.

1. Open the latest alternative preview in Safari, sign into Access if asked, and tap
   the orange mouth. Confirm no microphone prompt until **Record**.
2. Tap **Record**, allow microphone access, say a harmless sentence, **Finish**, then
   **Play my recording**. Confirm both the microphone indicator turning off and
   audible playback. Repeat five times on the phone alone.
3. While parked, connect CarPlay and repeat. Record the actual input/output route:
   truck mic vs phone mic, truck speakers vs phone speaker, wired vs wireless.
4. Test Stop while recording/playing, deny and restore permission once, switch apps,
   and try a call/lock interruption. Returning must require a new Record tap.
5. Open **iPhone & truck check → Copy test report**. Add what you actually heard,
   where it played, and which step failed. Report real outcomes, including limitations.
6. After backend rollout, repeat five full transcribe → chat → speech turns. The
   synthetic browser suite or local recording check cannot substitute for this.

No Shortcut is required for browser microphone permission. Safari is the initial
test target. Switching to Chrome/Firefox is not assumed to fix iOS audio behavior;
engines and OS policies vary by browser, region and version. A home-screen PWA is a
convenient launch route, not a grant of native audio or CarPlay privileges.

## Native option, if the physical gate fails

A native audio layer (SwiftUI/AVAudioSession/AVAudioEngine, or a native audio bridge
around the existing UI) can manage audio route changes, interruptions and audio
session configuration more directly. Keep Claude, connectors and provider credentials
in the existing backend; use proper mobile authentication, not a bundled service
secret. Reusing the web UI alone in a WebView does not provide these improvements.
A shared phone/web conversation needs a history/auth design because existing chat
history is stored in the browser; do not promise cross-device sync automatically.

An app entails a Mac/Xcode build, microphone usage declarations, signing/provisioning,
a real iPhone/vehicle test matrix, and TestFlight/App Store distribution and maintenance.
Apple Developer Program membership is generally US$99/year (verify current regional
pricing/enrollment before purchase); development builds have other distribution limits.
Brady must authorize enrollment/access, but signing can later be managed by an
approved team/CI process—it is not inherently a manual action only Brady can perform.
A native app improves control; it still does not prove GMC routing or solve provider
latency by itself. CarPlay dashboard UI additionally requires checking current Apple
eligibility/entitlements, templates and review. Current iOS 27/CarPlay eligibility was
not verified here; direct Apple documentation is blocked by the environment network.
Do not assert that conversational CarPlay apps are either forbidden or automatically
eligible. There is no evidence that dashboard integration fits the 25% budget, so it
is deliberately outside this first implementation.

## References and validation

Primary source repositories inspected on 2026-10-17:

- [MDN getUserMedia](https://github.com/mdn/content/blob/main/files/en-us/web/api/mediadevices/getusermedia/index.md): HTTPS, explicit user permission, iframe delegation.
- [MDN MediaRecorder](https://github.com/mdn/content/blob/main/files/en-us/web/api/mediarecorder/index.md) and [AudioSession](https://github.com/mdn/content/blob/main/files/en-us/web/api/audiosession/index.md): capture and experimental audio-session behavior.
- [Cloudflare Whisper schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/whisper-large-v3-turbo.json), [Aura schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/aura-2-en.json), [AI bindings](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers-ai/configuration/bindings.mdx).

`npm run test:voice-recording` covers server contracts and Chromium's real
MediaRecorder with a **synthetic microphone** and intercepted providers. It checks
repeated captures, track release, codec decoding, explicit upload/send, denied/late
permission, cancelled transcription, playback rejection, preview gating, report
privacy and the preserved dock. It is not Safari/WebKit, physical hardware, actual
transcription accuracy, speaker quality or live inference evidence. Existing chat,
Worker, Pages gateway and token-coordinator regressions are also required.


Local validation: the complete `test:release` run succeeded, including the existing
chat, persistence, layout/graph, connector, and old voice-lab suites. The known
intermittent cross-tab save failure did not reproduce in this run; that is **not a
repair**, and its release blocker remains open. The final speech replay/clipboard
refinements pass **41 browser checks + 11 speech adapter checks**, with **108/108**
dashboard regressions also passing. Desktop and phone-size panel renders were inspected. Wrangler
4.135.0 deployment dry-run passed. No provider, physical-phone, vehicle, or live
speech verification is implied by these results.

The preview follows https://codex-ember-brass-pressure-a.baxstar-ember.pages.dev/ .
The immutable https://9dddb9ec.baxstar-ember.pages.dev/ preserves the prior visual
checkpoint without this new mouth panel.
