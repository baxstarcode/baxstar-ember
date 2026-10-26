# Foreground conversation: evidence and limits

Brady's October 26, 2026 instruction supersedes explicit review/Send for normal
mouth-started conversations. One tap authorizes a foreground session: listen,
finish a finalized phrase, send through normal chat, play Jenny, listen again.
Stop, close, leaving OPS, typing, hiding the page and errors stop the loop. Nothing
starts on load. Ordinary typed questions produce text only. External writes still
require review; automatic conversation does not authorize sending email or texts.

## Sources inspected

Official MDN content was read from its GitHub source because the environment
network policy blocked the MDN website:

- [SpeechRecognition end](https://github.com/mdn/content/blob/main/files/en-us/web/api/speechrecognition/end_event/index.md): fires when recognition disconnects. This is the boundary before starting the answer.
- [SpeechRecognition continuous](https://github.com/mdn/content/blob/main/files/en-us/web/api/speechrecognition/continuous/index.md): controls continuous recognition results, not a complete assistant conversation or background entitlement.
- [HTMLMediaElement ended](https://github.com/mdn/content/blob/main/files/en-us/web/api/htmlmediaelement/ended_event/index.md): playback completion event provides the next-listening trigger.
- [HTMLMediaElement play](https://github.com/mdn/content/blob/main/files/en-us/web/api/htmlmediaelement/play/index.md): returns a promise; script playback can be rejected with NotAllowedError. A visible Play recovery remains necessary.
- [Anthropic's SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts): lists `claude-opus-5-5` and `OutputConfig.effort` including `high`. The existing Worker already allows these values; no Worker rollout is needed.

These sources support the implementation mechanics. They do not prove physical
CarPlay routing, permission persistence or repeated microphone starts on Brady's
particular iPhone/browser. The prior reports prove foreground recognition and Jenny
playback separately. The new automatic sequence remains PROVISIONAL on hardware.

## Implementation boundary

A finalized phrase gets a 1100ms grace period before recognition stops. Once the
browser reports recognition ended, the answer is sent automatically. Interim-only
words, failed microphone release, denied permission and failed requests never
trigger an automatic send/retry. Playback completion schedules the next turn after
450ms, only if the same conversation is still active and visible. Generation guards
and Stop cancel pending work. The mic is off while Jenny speaks, preventing her
reply from being captured as the next question. This is turn-taking, not full-duplex
barge-in or a claim of ChatGPT's realtime architecture. Foreground scope is unchanged.

Opus 5.5 / High defaults apply once to existing preferences (v5); later explicit
choices persist. Dashboard sync remains Haiku/Low. The separate Voice Lab is historical.

Browser tests simulate recognition and provider responses with real HTML audio
playback. They cover three automatic turns from one mouth tap, no microphone over
speech, switching to text-only chat, cancellation, late completion, partial speech,
preference migration and desktop fit. The remaining physical check is the same
foreground sequence on iPhone/CarPlay. If the browser blocks repeated turns, stop
and report that constraint; do not reopen background/native/phone workarounds.

Validation: Pages build, 97 foreground voice/desktop checks, 132 dashboard checks,
26 chat checks and 14 streaming/model-effort checks pass. The automatic-turn tests
exercise desktop and 3x phone rendering with simulated recognition and intercepted
provider responses; they are not hardware proof.
