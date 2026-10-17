# Recorded voice rebuild — 2026-10-17

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

Preview hosts allow only local record/playback. No recording is uploaded there.
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
