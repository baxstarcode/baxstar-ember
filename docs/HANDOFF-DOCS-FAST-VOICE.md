# Docs, visible Fast replies, and voice comparison

Date: November 17, 2026 (America/Chicago). Owner: Codex.
Branch: `codex/ember-docs-fast-voice`. Base: `b4114c5` (main and production verified).

## Scope and evidence

Brady reported repeated successful voice conversation on his phone. Browser and
CarPlay route were not specified in that report. Preserve the existing Web Audio
handoff, recognition timing, short-answer cap, Jenny default, large centered
skull, no-scroll desktop, and six-item dock. No new background voice work.

The old Fast button existed only inside the open voice panel, usually disabled
while listening. Its real request behavior already worked. Move it beside
ENIGMA/SCOPE so it is visible before a mouth tap. Keep the same saved preference,
Low effort on the selected model for voice when enabled, selected effort when off,
and unchanged typed-chat settings. No latency reduction is claimed from relocation.

Reproduced from exact production source: “Can you access Google Docs?”, the same
question via Zapier, “Read my Google Doc”, and a docs.google.com URL produced
`liveDataNeed === null`, omitting Drive. “Google Drive” included it. Main chat now
always requests the existing read-only Drive connector. No new permissions,
provider URL or credentials. Worker omits missing grants through its existing path.
The added connector can add discovery overhead; no latency benchmark is claimed.

Document questions/follow-ups instruct search then read, and require a Drive
result, not an unrelated calendar/email result. No-tool access denials get one
bounded retry. Actual failed Drive attempts do not repeat. Without verified Drive
results the reply states it could not get a live result. This proves routing and
guard behavior; it does not prove current Google consent or access to every Doc.
Read/search/summarize are the supported scope; create/edit/share are not enabled.

## Samples

`/work/voice-samples/` provides Jenny / Aria / Michelle, identical fixed sample
text, one sample at a time, retry, native Play fallback, cached replay, Stop and
download links. It uses only the existing authenticated `/api/tts`. No mic, AI
chat or voice preference mutation. Page hide stops playback and pending fetches.
The cloud computer's allowlist rejects direct `speech.platform.bing.com` access;
no bypass or public backend was created to generate attachments. Browser tests
use fixture WAV audio and prove behavior, not the provider's voice quality.

## Verification and publication

Targeted browser checks cover actual outgoing Low/selected effort, preference
reload, visibility before microphone use, Docs phrases/URLs/follow-ups, wrong
provider results, failed reads, bounded retries, responsive layout and sample
playback/error/cancellation behavior. The full `CHROME_PATH=/usr/bin/chromium npm run test:release` completed with exit 0.
It includes 136 foreground voice checks, 50 WebKit-path/live-data checks, 41 Docs/Fast
checks and 28 sample checks, plus the existing Worker, token, Pages, UI, chat,
layout, local-state, weather, latency and Signal Log suites. After full release
validation, one final follow-up-rule refinement prevents “Read me a joke” from
being classified as another document request. The final build and all 43 Docs/Fast
checks then passed. Desktop/phone screenshots were inspected (phone at 3x).

Publication candidate is ready for the documented non-force main fast-forward.
Verify the canonical Cloudflare Pages deployment matches that final commit;
custom domain is `ember.baxstarfishing.com`. The payload includes the comparison
page and script. Worker watch paths are unchanged. GitHub PR API access is blocked
by this environment; the documented Git fast-forward route remains available.

Authenticated production document read and live Aria/Michelle synthesis were not
performed from this environment. Existing physical success belongs to Brady's
reported phone session, not simulated Chromium recognition.

## Coordination

Drive/Ask Jev connectors and the Build Registry/Relay credential path were not
available in this session. No registry or Drive handoff write is claimed. Work
uses the canonical Ember repository on a branch from verified current main;
the booking repository is untouched. The preexisting untracked
`docs/HANDOFF-GROK-VOICE-FEASIBILITY.md` is preserved and excluded from the commit.
