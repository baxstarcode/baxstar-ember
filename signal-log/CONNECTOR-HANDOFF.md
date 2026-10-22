# Bounded connector handoff — existing Worker/auth owner

This is a concrete integration contract, **not an authorization to deploy, invoke
a metered model, change credentials or establish a grant**. Signal Log remains a
draft, with synthetic demo/manual import and no supplied production reader.

Follow the [single end-to-end roadmap](ROADMAP.md) for current phase status,
ownership blocker, implementation order, release gates and resume instructions.
This document supplies the connector details; it is not a separate completion plan.

## Current ownership and executable evidence

Verified remotely again on 2026-10-18:

- `main` / `codex/ember-brass-pressure-alt`: `dc830451054cb8af5637332504f899fa2f5123ec`.
- `codex/ember-command-plate-light`: `108d444549231f971ab6db8af81e5d413133e35b`,
  last commit 2026-10-16 19:17:54 UTC, the new-chat handoff.
- `108d444` is an ancestor of current `main`; main has seven subsequent commits.
  This proves code ancestry, not that a session is finished or that its backend
  cutover is live. No branch, Worker/config/auth file or ownership lock was changed.
- Existing repo coordination: `docs/CURRENT-STATE.md`, `docs/DEPLOY.md` §Durable
  token owner, `docs/VOICE-REBUILD.md`'s one-deployment-owner rule. They keep the
  coordinator/fresh-consent rollout separate from the current Pages publication.
- Registry is stale HANDOFF_READY with no owner/lock; Relay is OFF. That does not
  give this feature ownership of the Worker. The original Codex Worker/auth owner
  (or a newly explicitly assigned successor) must reconcile runtime state first.

## Existing route to reuse

```text
Existing-account browser login at ember.baxstarfishing.com
  → Cloudflare Access (whole host, including /api/*)
  → same-origin POST /api/messages
  → functions/api/[[path]].js exact host/path/method allowlist
  → EMBER_API service binding
  → proxy/cloudflare-worker.js server-owned read-only MCP toolsets
  → authorized Gmail or Calendar provider
```

The Pages gateway currently allows six exact routes and POST/OPTIONS only. It
forwards streams to `EMBER_API`; previews and lookalike hosts are denied. The
Worker rejects non-OAuth `workers.dev` requests. `Origin` is CORS defense, **not
authentication**. This task adds no public endpoint or alternate auth route.

Existing `src/baxstar-ember.jsx` paths:

- `callClaude` (around line 570) posts to `/api/messages` with server-name requests.
- `succeededConnectors` (around line 766) pairs `mcp_tool_use.id` and
  `mcp_tool_result.tool_use_id`, requiring `is_error === false`.
- `syncLive` (around line 2087) bounds Gmail to five unread messages from the prior
  24 hours and Calendar to today/tomorrow in America/Chicago; each successful feed
  updates independently. That request uses a model and may incur provider cost.
- Current projected email `{from,time,subject}` and event `{time,title,detail}`
  shapes omit stable provider IDs, source links and authenticated account identity.
  **Do not feed these projections into Signal Log as verified records.**

`/api/connectors/status` can mint/refresh access tokens. Its `connected` result
establishes token availability only; it does not read provider records or attest
which account returned them. Do not use it as `endToEndVerified: true`.

## Exact page seam

The owner can supply a reader with no further Signal Log UI changes:

```js
import { registerAccountReader } from '/signal-log/adapters.mjs';

registerAccountReader({
  workspaceId: 'baxstar',
  accountId: 'baxstar-fishing',
  provider: 'gmail', // register Calendar independently
  readVerifiedFeed: async ({ workspaceId, accountId, provider, limit }) => {
    // Owner-supplied transport, within the existing authenticated boundary.
    // It must not take a token, provider URL or arbitrary tool policy from the UI.
    const verified = await approvedBoundedRead({ provider, limit });
    return {
      // These values must come from trusted server/account evidence, not model text
      // or a copy of the client request. Account IDs are aliases, not secrets.
      verifiedAccount: verified.accountScope,
      endToEndVerified: verified.successfulProviderRead,
      envelope: verified.signalEnvelope // v1 contract in README
    };
  }
});
```

This is illustrative host code; `approvedBoundedRead` is the missing owner-supplied
transport, not a function shipped by this PR. Registration loads the reader;
Refresh sources repeats it. The page validates identity, provider, schema, limits
and dates, merges by stable identity, preserves decisions, and retains prior
records after errors. Backups do not preserve a trusted-live label.

## Smallest remaining owner implementation

1. Read current Worker version/config and confirm which provider grant/account the
   existing single-account routes serve. Do not infer account identity from the
   browser-selected alias, model wording, or successful credential refresh.
2. Reuse the existing authenticated `/api/messages` read pathway if the owner
   elects to keep its model-mediated provider transport. Add a **server-owned
   account/provider attestation** to the response (or an equally trusted,
   independently verified host mapping). Current code does not provide one.
3. Request one provider at a time and retain successful raw tool evidence with
   message/event IDs and links. Project only selected bounded summaries; separate
   source facts from model interpretations. Do not infer a deadline from unread
   status or mark an event/reminder complete because it appeared in a result.
4. Map the verified result to the callback above. Gmail identity is account+message
   ID; Calendar is calendar+recurrence/original-start or calendar+event ID. Limits
   and selected accounts stay server-owned. Cross-source collapse is explicit only.
5. Verify one known Gmail message and one known Calendar event through the actual
   Access → Pages → Worker → provider path, including account mismatch, expired
   session and one-provider failure. Record counts/status/IDs only in private
   operational evidence; never copy message bodies into Git or a public bundle.

A direct structured read endpoint could remove model mediation/cost, but none
exists in the current route allowlist. Building one is a separate Worker-owner
decision, not an implied part of this additive page. No callback should invent
`verifiedAccount` or set `endToEndVerified` to bypass the missing evidence.

## Access login versus provider consent

Opening the existing Ember hostname on a new phone and completing the existing
Cloudflare Access login establishes a browser session for Ember. It is **not** a
new Google/Quo OAuth grant and does not itself change server-held refresh tokens.
This session's anonymous production request returned 302 to that login gate;
there is no authenticated Ember browser here.

Opening the Worker's `/oauth/start?p=google` or `/oauth/start?p=quo`, approving
provider consent, or changing coordinated seed secrets is a different action.
It can establish persistent provider access and affects the owner's token rollout.
Those actions are not part of this task and were not initiated. No credentials
were read for this handoff. The parent's working ChatGPT Gmail/Calendar tools
remain separate from Ember. Quo runtime state is unknown here.

Smallest user diagnostic: sign into the existing Ember account on the phone and
report which per-feed indicator fails. Any data read may exercise the existing
refresh machinery; only its owner should determine whether provider re-consent
is required. A phone replacement alone is not evidence that grants are broken.
