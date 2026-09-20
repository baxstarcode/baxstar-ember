# Ember — Known Issues and Deliberate Limits

Last reconciled with the working repository on **2026-09-20**. This is the active
ledger, not the historical chronology; Git history and the Ember Handoff Log preserve
the closed issue record.

## 1. New production topology is not live-verified

**Status: OPEN — release gate**

The source now contains an exact static Pages build, an Access-gated same-origin
`/api/*` Pages Function, an internal `EMBER_API` Worker binding, and a Worker host gate
that refuses direct API traffic on `workers.dev`. Local tests cover the contracts, but
the combined release has not yet been verified in production.

Required evidence:

1. the `main` Pages deployment builds with `npm run build:pages` and publishes `dist`;
2. an unauthenticated request to `ember.baxstarfishing.com` is challenged or denied by
   Cloudflare Access before the application/API is reached;
3. a signed-in session can stream chat, read data-free connector status, and receive
   TTS audio and relay one controlled Drive-outbox draft through the four same-origin
   routes;
4. after the Worker deploy, direct non-OAuth requests to its `workers.dev` hostname
   return 404 even with a forged allowed `Origin`;
5. the registered OAuth GET flow and the Pages service binding still work after that
   host gate lands.

Deploy Pages and prove the internal route before deploying the Worker host gate. See
`docs/DEPLOY.md`.

## 2. Desktop and iPhone microphone/speaker reliability is unproven

**Status: PROVISIONAL — Brady's physical gate required**

The isolated page at `work/desktop-voice-probe/` has automated simulation coverage. Those
mocks cannot prove the actual Mac microphone, Chrome speech service, recognition
accuracy, microphone release, MP3 decoding, speaker audibility, permission recovery,
or five repeated listen/request/play cycles.

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

**Status: PROVISIONAL outside local tests**

Caption Studio prepares images and text and sends them through Access-protected,
same-origin `/api/outbox`. The Worker owns the Apps Script destination and optional
shared token; neither is present in the browser bundle or storage. Local relay and
Apps Script tests are green, but this revival has not yet re-verified one controlled
production Drive write or any downstream posting automation. Ember does not publish
directly to social media.

Keep the private-outbox review step. Test any downstream automation with a disposable
item before enabling it.

## 8. Provider and live-feed claims require a signed-in check

**Status: PROVISIONAL for the revived release**

Quo, Gmail, Calendar, and Drive credentials were all reported connected by the live
status route on 2026-09-20. The new Worker source also degrades ordinary chat safely
when a connector fails and makes OPS sync refuse connector-free fallback data.

After deployment, verify actual signed-in status and one controlled OPS sync before
calling the revived dashboard live. Do not infer provider availability from local
mocks, secret names, or an HTTP 200 from a different route.

## Expected behavior that is not a bug

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
