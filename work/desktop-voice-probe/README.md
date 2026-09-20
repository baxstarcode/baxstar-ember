# Ember voice reliability lab

An isolated, one-turn experiment. Nothing imports this folder into Ember, and it
does not change the production app, build, Worker, saved preferences, or business
data. Desktop Chrome is the first target; iPhone Safari is an **opt-in experiment**,
not a permanently excluded platform and not yet supported production voice. The
main dashboard stays voice-free pending physical proof. No full-duplex conversation,
wake word, automatic restart, or production voice restoration is implied.

The previous voice implementation was inspected at
`origin/snapshot/voice-era-final` (`1ea5307`). This probe uses its basic Web Speech
recognition and neural `/tts` contracts, plus the current app’s JSON/SSE request
format. On production it uses Access-protected same-origin `/api/messages` and
`/api/tts`; API credentials remain in the bound Worker.

## Physical test: Mac first, then optional iPhone Safari

The preferred test is the authenticated production page:

**https://ember.baxstarfishing.com/work/desktop-voice-probe/**

Use that production URL **after this build is deployed** for the five-run pass because
it exercises the same-origin, Access-protected text and TTS chain. For local desktop
UI/permission diagnostics only, open Terminal and run:

   ```sh
   cd /Users/bbaxter/Desktop/baxstar-ember
   python3 -m http.server 8787 --bind 127.0.0.1 --directory work/desktop-voice-probe
   ```

1. For local diagnostics, open **http://localhost:8787/** in desktop Google Chrome. If another local
   Ember preview already occupies port 8787 and serves the repository root, leave
   it running and open **http://localhost:8787/work/desktop-voice-probe/** instead.
   Do not open the HTML as a `file:` URL. The local static server has no `/api/*`
   gateway, so use it only for recognition, permission, cancellation, and layout
   diagnostics. Text and neural-audio release checks must use authenticated production.
   The loopback server cannot be reached from the phone; use authenticated HTTPS
   production for the phone test. Do not weaken the Worker allowlist to hide errors.
2. On a phone/tablet, enable the experiment for the current visit. Opt-in starts no
   microphone or API request and resets on reload. Start the iPhone experiment in
   Safari; record the actual device/browser/OS version and input/output hardware.
3. Confirm the page shows the message and voice endpoints and that no microphone prompt or active
   mic indicator appears on load. This page makes no request to the Worker on load.
4. Tap **Talk**. Allow the browser’s site microphone prompt. If macOS asks, allow
   Google Chrome under **System Settings → Privacy & Security → Microphone**.
   On iPhone, check Safari’s website microphone permission and that Siri is enabled
   if recognition is unavailable or blocked.
5. Say “Give me one sentence of encouragement.” Interim words should appear while
   you speak, then a final transcript. Tap **Finish talking** or let the browser end
   the short turn. Verify the actual device microphone indicator turns off.
6. Review/correct the final transcript and click **Send transcript**. Expect a
   short text response and a `Complete` status. One request uses Sonnet 4.6 with
   a 300-token cap. This incurs ordinary API usage. No connectors or tools are sent.
   **Stream reply** is checked by default. Uncheck it to compare a complete JSON
   response with streaming; each turn’s report records which mode was requested.
7. Click **Play response**. Expect one audible neural reply, then `Playback ended`.
   If browser policy blocks it, click the visible audio player’s Play control. A
   `playing` event only means the browser reported playback; you must confirm audibility.
   Record each turn’s result and physical observations in the page. An extra native
   player tap or other recovery is **Limited**, not a smooth Pass.
8. Complete **five full turns total**, including a new Talk tap immediately after a spoken reply.
   Click **Cancel / stop all** during recording, an AI request, and audio playback.
   Tap Talk during playback once; the old audio must stop before the new mic request.
   Switch tabs/apps while recording once; returning must require another Talk tap.
   On iPhone also try one lock/unlock, then another explicit complete turn. Browser
   suspension may delay events: record the physical indicator and what actually happened.
9. Test denial once: block the site microphone in the browser’s site controls, tap
   Talk, verify a useful error, then restore permission and retry. If Chrome needs
   a reload after changing permission, record that limitation. Prepare/copy the report
   **before reloading**. Do not loop on a chain that is consistently failing.
10. Tap **Prepare test report**, review device notes, and **Copy report** into the Ember
    task. There is no automatic upload. Desktop and iPhone outcomes are independent.

The server is loopback-only. Stop this server with **Ctrl+C** when finished. Nothing
is written to browser storage. Refreshing drops the transcript and event log.
The browser’s speech service may send speech to its provider; Send separately sends
the reviewed transcript to Ember’s Worker/Anthropic. Use a harmless test sentence.

## Pass/fail gate

Record browser/OS version, microphone/output device, and the five outcomes.

| Check | Pass | Fail |
|---|---|---|
| Startup | No mic prompt, capture, or proxy request until a click | Background capture/request |
| Recognition | Five short turns produce usable final text; interim text appears | Repeated missing/wrong text, stuck `Listening`, or no final result |
| Mic release | Real device mic indicator turns off after stop/cancel/tab hide; next turn works | Mic remains active, needs repeated reloads, or restarts without a tap |
| Text request | Five reviewed prompts return complete text | CORS/auth/network failures, blank answer, truncated stream |
| Neural response | Five replies are audible and stop on cancel | Silence, blocked playback with no usable recovery, stuck audio |
| Recovery | Permission denial, cancellation, returning to the tab, and phone lock permit another explicit turn | Reload loops, overlapping audio, stuck controls |

**Pass applies only to the tested device and explicit-turn interaction.** A permission
reload or native-player tap is a limitation. Any failed row blocks treating that
platform’s voice as proven; it does not prove the platform can never work. Do not
restore production voice based on automated results alone. Full-duplex conversation,
background listening, and wake words remain outside this experiment.

An unconfirmed recognition end keeps Talk/Send/Play blocked. After an abort has waited
three seconds, the lab asks for an explicit physical mic-indicator check. Confirm
only if the indicator is actually off; otherwise close the tab. This manual recovery
cannot count as a clean Pass. Late recognition callbacks are detached.

## Timing and results report

The report contains up to 30 turns and 300 events held only in page memory: mic
request/start/first final/end, text send/first text/end, audio request/ready/play/end,
cancellation, tab hiding, recovery, and the tester’s observations. Timings are elapsed
milliseconds from each turn’s start; events also carry session-relative time.

It excludes transcripts, reply text, audio, credentials, and business data. Freeform
device notes are included, so review them before sharing. A reload clears the record.
The page rejects a full Pass for typed-only or incomplete turns, missing physical
observations, or a turn that needed error recovery. It still labels the report
PROVISIONAL: browser events cannot prove physical release or audibility.

## Primary browser references

Checked September 20, 2026. These establish prerequisites, not physical reliability:

- WebKit documents Safari speech recognition powered by Siri and says Siri must be
  enabled. [Safari Web Speech support](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/)
- Apple documents alternative-engine entitlements by region, including the EU and
  Japan. Do not assume all iPhone browsers always share an engine or behavior.
  [Apple browser-engine entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser-engine.host)
- Audible playback remains subject to interaction and browser policy even on desktop
  Chrome. [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay)

The lab checks secure context, Web Speech recognition (prefixed or unprefixed),
request APIs, and audio APIs. It reports missing capabilities explicitly. Presence
of an API is not proof of service availability, permission, or hardware behavior.

If a request fails, the UI reports HTTP, CORS/network, empty/truncated response,
or timeout. Use the production URL for the pass; do not change Worker secrets or its
allowlist to hide a failure. Requests time out at 45 seconds, TTS at 15 seconds,
microphone startup at 15 seconds, and a listening turn requests stop at 30 seconds.
Stop waits three seconds before abort; abort waits three seconds before the manual
release gate. Background suspension can delay JavaScript timers.

## Offline verification

With Node and this repo’s Playwright dependency available:

```sh
node --check work/desktop-voice-probe/probe.js
node --check work/desktop-voice-probe/test.mjs
node work/desktop-voice-probe/test.mjs
```

On this Mac, Codex’s bundled runtime is also available without installing packages:

```sh
/Users/bbaxter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node work/desktop-voice-probe/test.mjs
```

The test resolves repo Playwright first, then the Codex bundled Playwright path.
Set `EMBER_PLAYWRIGHT_DIR` to an absolute Playwright package directory if needed.
It runs installed desktop Chrome headlessly, serves only this folder on a temporary
local port, and intercepts every non-local request. Speech events, AI/SSE responses,
TTS bytes, and audio playback events are mocks. It exercises permissions/errors,
interim/final transcript, explicit send, cancellation, opt-in/missing mobile capabilities,
JSON/SSE responses, HTTP/network/truncated-stream failures, optional TTS, and blocked
playback, repeated turns, interruption, release confirmation, and report privacy.
Mobile tests use a phone viewport/user agent with mocked prefixed recognition;
they are **not Safari-engine or iPhone-device tests**. Screenshots are saved at
`/tmp/ember-desktop-voice-probe.png` and `/tmp/ember-iphone-voice-lab.png`.

**PROVISIONAL:** physical microphone capture/release, recognition accuracy, browser
speech service availability, deployed proxy/CORS, actual TTS generation/decoding,
speaker audibility, interruption recovery, and repeated real-device mic/audio handoff
timing until Brady runs the steps above on each intended device.
