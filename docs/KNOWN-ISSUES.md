# Ember — Known Issues and Deliberate Limits

Last updated from the working repository on **2026-10-18 (America/Chicago)**. Recorded production
verification remains dated 2026-09-20 unless stated otherwise. This is the active
ledger; Git history and the Ember Handoff Log preserve the closed issue record.

## 0. Alternative preview and voice verification boundaries

**Recorded voice update (2026-10-17):** Brady authorized a new explicit recording
preview behind the orange mouth. It can record and play locally on preview hosts;
it never auto-arms and does not use SpeechRecognition. Official transcription/speech
adapters are implemented but disabled until the AI binding and existing production
rollout are ready. iPhone 17 Pro/iOS 27.0.1 (reported) with wireless GMC CarPlay still
needs physical proof. See `docs/VOICE-REBUILD.md`; the legacy probe below is a separate
historical path, not the only permitted experiment.


**Status: PREVIEW ONLY — production and physical-device gates still open**

`codex/ember-brass-pressure-alt` preserves the original branch while adding Brady's
requested button finish and Foundry graph. See `docs/ALTERNATIVE-PREVIEW.md` for its
validation and deployment checkpoint. Cloudflare API authentication now works;
the historical lack of a token is resolved. The session still lacks a signed-in
browser, and preview HTML requests are blocked by its network proxy, so successful
Cloudflare deployment metadata is separate from a live browser/device check.

The production-only Pages gateway denies preview chat/TTS. The preview Voice Lab
therefore explicitly offers recognition and transcript copying with Send/Play
disabled, and links to the existing live lab. Adjustable pauses and explicit Finish
cannot override a browser's own recognition ending. A real Mac microphone/speaker
test is still required before dashboard voice integration; mocked speech and audio
events are not that proof. The alternative is not a shortcut around §1a–1d's
Worker/model/coordinator/fresh-consent sequence.

The supplied graph is a reference map, not a live inventory. Descriptions do not
claim that its booking, data, or communication systems are connected. Only known
source links are offered. Editing this map does not identify or change the separate
booking application's repository.

## 1. Final connector-status and Drive-outbox checks remain

**Status: OPEN — post-release verification**

The revived Pages build and Worker boundary are live. PR #43 merged at
`add4a8c28c17f70b3463d5ad786833f5e5a7880a`; Pages deployment
`1f56234b-f359-43f2-ba38-c839d2e6b415` served the merged UI; Worker version
`ac3b4578-5a04-4abf-9286-8e95663517d5` deployed with its secrets preserved. Cloudflare
Access challenged the custom host, custom `/api/messages`, exact Pages alias, and the
current deployment alias before application/API access.

The paired boundary checks passed: a pre-Worker non-streaming `/api/messages` request
proved the binding, a post-Worker streamed lab reply completed, all eight forged-Origin
public-host POST probes returned 404, and Google OAuth start still redirected to the
provider. Main chat and a count-only connector follow-up completed; live OPS sync
populated provider-derived panels. One transient connector-degraded chat response was
shown honestly and the focused follow-up completed without that banner.

Still required:

1. call signed-in `/api/connectors/status` through the Pages binding and record only the
   data-free state;
2. publish one controlled Caption Studio draft and verify the private Drive file exists
   before accepting `/api/outbox` success.

The staged order remains the required procedure for future releases; see
`docs/DEPLOY.md`.

## 1a. The model update needs the Worker deployed before the UI ships

**Status: OPEN — release sequencing (2026-10-15)**

The UI now sends `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`,
`claude-fable-5-1` with effort up to `xhigh` and budgets up to 16000 tokens. The
deployed Worker refuses those new IDs. Deploy the Worker from this release FIRST (it still
accepts the old IDs, so the live page keeps working), confirm chat, then merge so Pages
ships the UI. After that, one message per model must show its served-model stamp; until
then live model access is **PROVISIONAL** (it is verified only against Anthropic's model
reference and intercepted tests). Remove the old IDs from `ALLOWED_MODELS` afterwards.

## 1b. Quo is offline

**Status: OPEN (2026-10-15)**

Brady's signed-in `/api/connectors/status`: gmail, calendar, gdrive connected; quo
offline. Quo's account had run out of credits around the same time and was topped up
that afternoon — re-check status before anything else. If it is still offline, the
likeliest cause (unverified) is refresh-token rotation: Ember's Quo client is public and
the Worker used to discard a rotated token. The branch now includes a durable refresh
owner; follow the fresh-consent cutover in `docs/DEPLOY.md`, then re-check the live
account. Creating KV alone is insufficient for safe coordination across instances.
OPS syncs per feed, so Quo being down no longer blanks Inbox and Schedule.

## 1c. A token-store read failure replays a retired refresh token

**Status: COORDINATED REPAIR VERIFIED LOCALLY — rollout/consent pending (2026-10-16)**

Before the repair, `currentRefresh` caught `EMBER_TOKENS.get` failures and returned
the original secret. After rotation, `tokenCache` held the replacement refresh token, so that fallback
also misses the still-valid cached access token. The next request sends the retired
secret to the provider. This contradicts the intended no-reuse protection and can
drop Quo; revocation of a grant depends on the provider's reuse policy and was not
tested live.

Reproduction used only synthetic fixtures: refresh Quo once, return a new refresh
token and an access token valid for 3600 seconds, save the rotation, then make the
KV read throw 1 second later. The second status request sent the original token
again; the fixture rejected it and status changed from connected to offline.
The original rotation tests used an immediately readable Map and missed this case.

The follow-up repair now checks a credential-bound access cache before reading KV,
keeps the newest refresh token in memory even if persistence fails, retries failed
saves, and refuses cold unreadable/malformed storage instead of using the original
secret. It ignores tokens this isolate already knows were retired. Concurrent calls
share one refresh; overlapping re-consent waits so an old request cannot overwrite
the replacement grant. Regression coverage exercises these cases and fails against
the previous Worker.

The first repair was **isolate-local**, not global refresh serialization. Cloudflare's
[KV consistency documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)
confirms stale values and cached negative lookups can survive across locations.
Different or restarted isolates on that legacy path can still read an older token;
a failed persistence write can also outlive the isolate holding the only newer copy.

The next continuation adds `EmberTokenCoordinator`, a SQLite Durable Object per grant,
and routes all coordinated refreshes through it. Separate Workers now share one owner;
Google's three connectors share one grant. New seed secrets require fresh consent
instead of importing uncertain KV state. Storage persists an intent marker before
OAuth and the replacement before access is returned. Lost responses and interrupted
saves cannot cause an automatic replay after restart; they may require re-consent.

Verified with synthetic providers in real workerd/SQLite: overlapping caller Workers,
expiry, persistent access after full runtime restart, Google sharing, an ambiguous
refresh surviving restart, and recovery with fresh consent. Failure injection also
covers unavailable storage/binding, failed final writes, malformed state/responses,
timeouts, and wrong-owner requests. Wrangler accepted the binding/migration in a dry
run. No remote namespace was created, no consent was performed, and live rollout is
still unverified. See `docs/DEPLOY.md` for cutover and rollback requirements.

## 1d. Partial first sync displays contradictory error text

**Status: FIXED AND VERIFIED LOCALLY (2026-10-16)**

Before the repair, on a first sync where Gmail returned verified results but
Quo/Calendar did not, `syncLive` updated the email panel and `feedLive`, then threw
for the other feeds. Its catch still read the pre-request `live` value and appended
"Showing the demo preview; no live data was loaded." The same screen correctly said
"Live: email" and displayed the returned email. A browser fixture reproduced both
statements.

The follow-up repair builds the summary from the feeds that actually landed,
previously retained feeds, and remaining demo panels. Failed attempts mark retained
feeds as stale in the note, connector lights, and header instead of leaving green
LIVE indicators. Desktop and phone regressions cover first failure, partial success,
later failure, complete recovery, and all-offline status after live data was loaded.
Offline notes also distinguish incomplete setup, a required new sign-in, and a
temporary failure. Only fixed reason codes are rendered; successful sync removes
stale recovery guidance without discarding the previously verified data.

## 2. Desktop and iPhone microphone/speaker reliability is unproven

**Status: PROVISIONAL — Brady's physical gate required**

**Latest result, October 21:** another v4 microphone turn physically passed, with
mic indicator off and audible reply; device notes say “All worked well.” This is
two full turns across two sessions. The fixed voice-test sentences do not count
as microphone turns. Repeated handoff and active interruption/recovery remain open.

**Latest result, October 20:** Brady reports “Worked” after the standalone Safari
comparison and supplies a v4 full microphone turn marked Pass, mic indicator off,
reply audible. This is the first complete physical pass in the ongoing truck test;
four further turns and interruption/recovery proof remain. In-app browser playback
had failed; the report does not establish the browser switch as the sole cause.
See the newest Voice Rebuild entry for exact evidence and limits.

**October 20 CarPlay evidence:** fixed-sentence Jenny audio was heard through truck
speakers before Talk; subsequent reply audio was silent after recognition. Five
HTTP 200/audio attempts played to browser completion. Mic indicator off was physically
confirmed on the final turn. Voice check v4 adds a feature-detected playback-mode
handoff and safe session/media diagnostics; its physical fix is unproven. The
previous provider refusal is not present in this report. See Voice Rebuild.

**Post-repair phone result, 2026-10-19 UTC:** Brady heard Ember in the fixed-sentence
speech-only test after the v2 compatibility hotfix. This closes the single-attempt
phone audibility check. Full spoken turns, repeated cycles, physical mic release,
interruptions and wireless CarPlay playback still need post-repair device evidence.

**October 18 follow-up (America/Chicago):** the speech-only v3 screenshot confirms provider connection
refusal (HTTP 502), before playback. A concrete protocol mismatch was found: the
live code uses v1 while current edge-tts 7.3.1 uses v2. A narrowly scoped server
compatibility repair preserves Jenny. See Voice Rebuild/Deploy for validation,
deployment scope and the stop rule if the real provider continues refusing it.

**October 18 device evidence:** Brady reports working microphone transcription and
text replies on the phone and wireless CarPlay, but no spoken audio on either.
The supplied older-lab v2 report fails twice before `audio-ready`; its generic error
does not identify the HTTP/provider failure or prove an autoplay problem. Physical
mic release remains unconfirmed. Live `/api/tts` still uses JennyNeural through the
unofficial Edge service. See `docs/VOICE-REBUILD.md` for the evidence and next proof.
The earlier successful browser cycle below is historical, not a current device pass.

The isolated page at `work/desktop-voice-probe/` has automated simulation coverage. Those
mocks cannot prove the actual Mac microphone, Chrome speech service, recognition
accuracy, microphone release, MP3 decoding, speaker audibility, permission recovery,
or five repeated listen/request/play cycles.

The deployed lab has now returned a complete signed-in streamed reply and neural audio.
The browser reported `playing`, then `ended`, and the UI returned to `Playback ended`
with the mic off. That proves the released text/TTS browser path, not that Brady heard
the audio, that its quality is acceptable, or that any physical microphone behavior
works.

Brady must run the production probe in desktop Chrome five times and record the gate
in its README. Any failed row blocks integration into Ember. A pass applies only to an
explicit desktop one-turn design.

Brady's current direction also permits an isolated iPhone experiment. It must separately
prove repeated turns, interruption recovery, playback, and microphone handback before
phone integration. The old implementation stays removed pending that proof; iPhone
voice is not permanently banned. Wake words, background capture, automatic restart,
and full duplex are outside the current experiment.

## 3. Existing Google OAuth grant may still be broader than the new consent

**Status: OPEN — security maintenance, currently bounded by server tools**

Future Google consent asks only for Gmail read, Calendar list/event/free-busy read,
and Drive read. The current refresh grant was created under the older broad scope set;
changing scope strings in source does not narrow an already-issued token.

Until Brady revokes and re-consents, the Worker's explicit read-only tool allowlist is
the active write barrier. It disables all unreviewed/new provider tools by default.
Do not describe the existing token itself as least-privilege until the revoke/re-consent
cycle is completed and verified.

## 4. Local preview is not a live-API release environment

**Status: DELIBERATE LIMIT**

`./start-ember.sh` remains the fast Python preview for UI work. Its generated page uses
same-origin `/api/messages`; the static Python server has no API relay, so local live
chat/TTS are unavailable there. Use intercepted tests or authenticated production for
those checks. Direct non-OAuth `workers.dev` calls are denied by the new Worker gate.

Do not weaken the host gate or expand `ALLOWED_ORIGINS` to make local live calls work.
Use intercepted tests for local behavior and the authenticated custom hostname for
production API and physical voice checks.

## 5. Mission Control and Projects are not a shared authority

**Status: DELIBERATE LIMIT / PRODUCT DECISION PENDING**

Mission Control lives in this browser's IndexedDB after its first edit; local tasks do not sync to Quo or
another device. The Projects bars are maintained in the source `PROJECTS` constant.
Both views are useful, but neither is a durable shared project database.

**Local preservation repair (2026-10-16, awaiting deployment):** opening the board
used to overwrite unreadable saved JSON with defaults. It now validates the saved
record and writes only after an edit. Read errors leave the original bytes intact;
write failures retain the draft across tool switches and offer retry/download.
Loading another saved version requires an explicit discard, and a failed recovery
read keeps the draft. Missing optional lists in older records remain supported;
unknown root/project/task metadata is preserved.

**Transaction repair, 2026-10-18:** board saves now compare a shared revision and
write the next record within one IndexedDB readwrite transaction. OPS task drafts
append inside the same transaction boundary. Web Locks retain ordering where
available but are not the correctness mechanism. A losing tab keeps its draft and
download/recovery controls; the saved board is not replaced. A save is acknowledged
only after transaction completion, and text entered while it waits stays dirty
until its own save commits. Storage denial/abort never falls back to unsafe writes.

The original `localStorage['ember-mc']` bytes remain untouched. The first successful
edit imports them into database `ember-local`, store `boards`, key `ember-mc`.
Opening a board never writes a board record. Old tabs can still change the legacy
copy, but cannot overwrite the current database record. Ember flags that separate
copy and offers both downloads; **Keep current board** acknowledges it without
discarding either stored version. Close older tabs after updating. No cloud backend,
cross-device sync, external tasks, or new paid service was added.

Clearing all site data or losing the browser profile still removes local data.
Browser termination can lose an unsaved in-memory draft; the leave warning is best
effort, so download the copy when storage is failing. Physical iPhone/Safari keyboard
behavior remains unverified; automated touch Chromium checks cover phone layouts.

**Historical reproduction, 2026-10-17 UTC:** the existing
`simultaneous board edits serialize and preserve the losing tab as a recoverable draft`
browser test failed during alternative validation. Two tabs queue edits behind one
held `ember-mc` lock. After release, the first writes its edit; the second acquires
the lock but reads the old localStorage snapshot and writes its own edit about 1 ms
later. Both tabs then show the second edit as saved, so the first draft is lost.
Instrumented synthetic fixtures confirmed the stale read. The identical test also
failed against preserved source at `108d444` (second repeated baseline attempt),
establishing that this is not a new visual/voice logic change. The earlier 771-pass
run did not establish reliable cross-tab atomicity.

The October 18 repair was verified against permanently stale legacy reads and
actual IndexedDB transactions, including concurrent tabs without Web Locks, abort
after a successful put, typing during a pending commit, and concurrent OPS appends.
The forced-stale-read regression fails against untouched `dc83045` and passes with
the repair; this is not a retry-until-green result. Full release evidence belongs
in `docs/CURRENT-STATE.md`.

Do not silently add a backend or turn local task drafts into external actions. Brady
must choose the shared owner and migration path first.

## 6. Revenue is manual

**Status: DELIBERATE LIMIT / DATA-SOURCE DECISION PENDING**

Today's revenue persists on the device but is entered by hand. No verified booking or
accounting source is wired to Ember. The app must never invent a revenue value or imply
that manual revenue is synced.

**Entry repair (2026-10-16, awaiting deployment):** the old parser changed `$12.50`
to `$1,250` and `-100` to `$100`. Entry now validates the complete amount, accepts
optional dollar/comma formatting and up to two decimal places, and preserves cents
in the existing `{ n, d }` dollar/date shape. Invalid input keeps both the previous
amount and the open editor; empty input explicitly clears it. The supported entry
range is $0–$999,999.99. Desktop/phone checks cover formatting, invalid input,
reload, clearing, and instrument fit. Previously mis-entered amounts cannot be
reconstructed from the saved number and need manual correction.

## 7. Caption publishing still has an external review boundary

**Status: PROVISIONAL pending one controlled production write**

Caption Studio prepares images and text and sends them through Access-protected,
same-origin `/api/outbox`. The Worker owns the Apps Script destination and optional
shared token; neither is present in the browser bundle or storage. Local relay and
Apps Script tests are green, the deployed Worker has its server-only `OUTBOX_URL`
configured, and the public Worker host is closed. This revival has not yet re-verified
one controlled production Drive write or any downstream posting automation. Ember does
not publish directly to social media.

The controlled release test stopped at the browser automation file picker: selection
did not return, and no Generate, review, or Publish action occurred. A metadata check
of the existing outbox found no new files. This is a verification-tool limitation,
not evidence that the application upload or relay failed. A future signed-in manual
test can use the disposable `EMBER RELEASE TEST — DO NOT POST` image; inspect the
review-outbox JPEG and text sidecar before calling this route verified.

Keep the private-outbox review step. Test any downstream automation with a disposable
item before enabling it.

## 8. Provider and live-feed claims require a signed-in check

**Status: PARTIALLY VERIFIED in the revived release**

Quo, Gmail, Calendar, and Drive credentials were all reported connected by the live
status route earlier on 2026-09-20. The revived release has not yet repeated the
data-free status call, so do not turn that earlier report into a fresh all-connected
claim.

A signed-in OPS auto-sync did complete as LIVE and populated provider-derived panels
with counts only: 0 calls, 5 unread messages, and 0 calendar events. Main chat completed;
one response exposed the connector-degraded banner and the focused count-only follow-up
completed without it. The Drive librarian also found the Ember Handoff Log by title;
no file contents were read. This verifies honest failure/recovery behavior and bounded
live provider reads, not uninterrupted availability of all four providers. Run the dedicated
`/api/connectors/status` check before recording current per-provider state. Do not infer
provider availability from local mocks, secret names, or an HTTP 200 from another route.

## Expected behavior that is not a bug

- In the Knowledge Graph overlay, Escape closes it unless focus is inside the embedded
  Knowledge Foundry: browsers never pass keystrokes from a cross-origin frame to the page
  around it. The ✕ button and a click or tap outside the sheet always close it.

- Preview Pages hosts return 404 for `/api/*`; only the exact production hostname is
  allowed through the Pages Function. The static `pages.dev` production and preview
  aliases must still remain behind Cloudflare Access so application HTML is not public.
- General chat cannot send messages, create Quo tasks, change mail/calendar records,
  or write Drive files. Drafting is allowed; external action is not.
- A connector-degraded response can still answer from conversation context, but it
  must say live business data was not checked.
- OPS keeps its last live data or demo preview after a failed sync instead of replacing
  it with model-generated emptiness.
- The service worker never caches API POSTs.
- Google Fonts may fall back to a system serif if the stylesheet is unavailable; React,
  ReactDOM, the app, and used Tailwind utilities are compiled/inlined in production.

## Closed claims that must not return

- `index.html` is not the source and is not hand-edited. `build.mjs` owns it.
- Production does not depend on runtime React, Babel, Tailwind, or unpkg CDNs.
- Quo is not “unsupported” or “authorization pending”; its credential was reported
  connected on 2026-09-20.
- Vercel is not an active deployment alternative. The checked-in adapter is historical
  only; Cloudflare Pages + Worker is the supported production path.
- The old standalone `voice/` rigs and blanket “restore voice” notes are historical.
  The explicit recorded-voice preview and older isolated probe have separate physical
  gates; see `docs/VOICE-REBUILD.md`.
- `baxstar-ember.pages.dev` is not the production origin. The custom Access-protected
  hostname is `ember.baxstarfishing.com`.
