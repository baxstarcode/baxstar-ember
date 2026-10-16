# Ember — Known Issues and Deliberate Limits

Last reconciled with the working repository on **2026-09-20**. This is the active
ledger, not the historical chronology; Git history and the Ember Handoff Log preserve
the closed issue record.

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
deployed Worker refuses all three. Deploy the Worker from this release FIRST (it still
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
the Worker used to discard a rotated token. Create the `EMBER_TOKENS` KV binding
(`proxy/wrangler.toml`), deploy, then re-consent once at `/oauth/start?p=quo`. OPS now
syncs per feed, so Quo being down no longer blanks Inbox and Schedule.

## 1c. A token-store read failure replays a retired refresh token

**Status: LOCAL REPAIR VERIFIED — distributed coordination remains open (2026-10-16)**

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

This is an **isolate-local repair**, not global refresh serialization. Cloudflare's
[KV consistency documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)
confirms stale values and cached negative lookups can survive across locations.
Different or restarted isolates can still read an older token; a failed persistence
write can also outlive the isolate holding the only newer copy. A strongly consistent
refresh owner (for example, a Durable Object) is needed before claiming rotation is
safe across all instances. No new binding was created or deployed in this pass.

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

## 2. Desktop and iPhone microphone/speaker reliability is unproven

**Status: PROVISIONAL — Brady's physical gate required**

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

Mission Control lives in browser `localStorage`; local tasks do not sync to Quo or
another device. The Projects bars are maintained in the source `PROJECTS` constant.
Both views are useful, but neither is a durable shared project database.

Do not silently add a backend or turn local task drafts into external actions. Brady
must choose the shared owner and migration path first.

## 6. Revenue is manual

**Status: DELIBERATE LIMIT / DATA-SOURCE DECISION PENDING**

Today's revenue persists on the device but is entered by hand. No verified booking or
accounting source is wired to Ember. The app must never invent a revenue value or imply
that manual revenue is synced.

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
  Only the isolated desktop probe can advance voice now.
- `baxstar-ember.pages.dev` is not the production origin. The custom Access-protected
  hostname is `ember.baxstarfishing.com`.
