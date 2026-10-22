# Signal Log — end-to-end completion roadmap

**Status: functional preview complete; whole connected build NOT complete.**
This is the single progress and execution roadmap for Signal Log. Maintain it
after each meaningful checkpoint. [README](README.md) owns the data contract;
[CONNECTOR-HANDOFF](CONNECTOR-HANDOFF.md) owns the existing transport seam;
neither a screenshot nor a credential indicator proves live ingestion.

Last checkpoint: **2026-10-18**. Last tested implementation:
`dc8105c8e2269145eaeda6f737cb1e487a8ebfc2`, branch `codex/ember-signal-log`,
[draft PR #50](https://github.com/baxstarcode/baxstar-ember/pull/50).
Last verified default `main`: `dc830451054cb8af5637332504f899fa2f5123ec`.
These are dated observations. Refresh remote heads, PRs and ownership on resume.

## Exact next action and present blocker

**Next action:** obtain and record an acknowledged coordination handoff from the
current Ember Worker/connector owner, or an explicit assignment of a successor.
The task coordinator reports that the ownership coordination request is still
**unanswered**; no affirmative handoff is recorded for this feature. A stale
registry row, old branch timestamp or merged ancestry is not ownership clearance.

The acknowledgement must identify the owner, current backend version/config,
actual authorized provider/account mapping, status of refresh coordination, the
bounded feed implementation they will supply, and who controls its eventual
release. Record a dated, sanitized decision here; keep private operational
evidence in its authorized private location. Do not publish credentials, account
payloads, consent URLs or real message/event content in this public repository.

Until that exists, **do not make parallel Worker/auth/config changes or establish
new OAuth grants**. The safe current work is documentation, read-only source
comparison, local fixtures and the already-working manual import workflow.
This roadmap is a completion plan, not permission to contact others, activate
automations, spend on model calls, change grants, merge or deploy.

## What is actually complete

| Area | Evidence-backed state |
| --- | --- |
| Responsive steampunk interface | Complete locally: Argon outlines, Ember furnace controls, existing artwork, five business categories, filters and named combinations. |
| BLUF and expansion constraints | Tested: summary ≤200 Unicode characters; signal/why/next/prompt together ≤750; full-source links; source claims separated from suggestions. |
| Ranking and time-budget triage | Tested: deterministic impact/deadline/effort/confidence ranking, explanations, waiting/dependency exclusions, overdue verification, positive no-action signals. |
| Local decisions | Tested: read, resolve, snooze, waiting, dismiss, accept risk, undo and cross-tab conflict protection for metadata. |
| Manual Claude/report import | Functional: bounded v1 JSON, account validation, inert text, safe links, explicit dedup, provenance/freshness and private backup/restore. |
| Accessibility and responsive checks | 26 contract tests and 22 browser scenarios pass; keyboard/focus, sampled contrast, 44px phone controls, 375px/390px and desktop layouts. Not a full WCAG audit or physical iPhone sign-off. |
| Local build | Pages build passes; eight staged runtime files match source. [Evidence](evidence/VALIDATION.md), [visual comparison](evidence/STYLE-COMPARISON.md). |

## Contracts/scaffolding versus missing implementation

| Surface | What exists | What is still missing |
| --- | --- | --- |
| Gmail/Calendar | `registerAccountReader` and validated ingestion through the page, tested with synthetic callbacks | Supplied production readers, trusted account attestation, bounded provider projection and real end-to-end evidence |
| Persistence | Device-local hashed decision metadata; source text in memory; explicit private JSON backup | Private authenticated server storage, retention/deletion policy, sync/conflict protocol and cross-device verification |
| Weekly reports | Prior inventory identified pricing/review and risk-watch report families | Complete authoritative inventory, per-item transport mapping and measured coverage; do not infer every weekly reminder is known |
| Claude automation | Working manual JSON import | Verified supported automated delivery, authenticated ingress and replay controls, if selected and authorized |
| Additional accounts | Account fields and rejection tests; one configured Baxstar Fishing alias | Server-owned memberships/grant mappings, account switching and cross-account isolation tests |
| Release | Durable draft commits and local evidence | Real-data acceptance, release-blocker resolution, owner approval, merge/deployment and live verification |

Imported text disappearing after a reload is an explicit current limit, not
durable cloud storage. A successful synthetic callback is not a live connection.
The no-feed demo must never be described as the completed connected build.

## Ordered implementation phases

### 1. Reconcile ownership and authorized transport — BLOCKED

1. Complete the next action above. Read `AGENTS.md`, `docs/CURRENT-STATE.md`,
   `docs/DEPLOY.md`, `docs/VOICE-REBUILD.md`, open PRs and current handoffs first.
   Preserve the other builder's refresh/coordinator work and one-deployment-owner
   rule. Record the reply or explicit succession; silence is not consent.
2. Owner checks the existing Access → Pages gateway → `EMBER_API` → Worker path
   and determines which actual Google account the current grant serves.
   `/api/connectors/status` can refresh tokens and proves availability only.
3. Owner chooses reuse of `/api/messages` with successful raw provider evidence
   and a trusted account mapping, or a dedicated structured read route. The latter
   is a **proposed addition**, absent from today's gateway allowlist. Model-mediated
   reads may incur cost; do not silently enable them.
4. If grant repair, broader access, fresh consent or persistent credentials are
   necessary, obtain explicit action-time approval and let the authorized owner
   complete them. Ordinary existing-account Access login is a separate action.

**Targets:** existing `proxy/cloudflare-worker.js`, its config/coordinator files,
`functions/api/[[path]].js`, and `src/baxstar-ember.jsx` are **owner-controlled**.
The Signal Log builder must not edit them until scope is explicitly assigned.
**Exit:** acknowledged owner, verified account identity plan, chosen transport,
bounded read scope and any required authorizations are recorded.

### 2. Inventory all intended weekly inputs — NOT COMPLETE

Use read-only authoritative listings from each relevant reminder/automation
platform and account. Obtain exports from the authorized operator when a listing
is unavailable. Do not equate Gmail search results, Calendar recurrence or names
of report families with a complete automation inventory.

For each inventory entry capture privately: stable source/task ID, platform,
workspace/account, enabled/paused/retired status, cadence and timezone, output
location/link, latest actual output, business categories, intended read transport,
occurrence identity, coverage result and owner. Keep only sanitized counts and
coverage decisions in this public roadmap. Unknown items stay explicitly unknown.

Current evidence boundary:

- Pricing/review and risk-watch report families were identified in prior work;
  complete task IDs, schedules and coverage are **not recorded here**.
- Sunday Signal Sweep remains disabled. Relay remains OFF. Neither is a missing
  active feed to resurrect. Do not recreate a retired relay under another name.
- Calendar `#text` tags belong to a separate Quo sender, not this log's transport.
- Reading/importing an output does not change its reminder, mark its task complete,
  authorize a message, or create a new schedule.

Choose a transport for each **confirmed eligible active** item: an existing
Gmail/Calendar output, bounded manual JSON, or an explicitly approved authenticated
automation integration. Prevent double counting when one report reaches multiple
channels. A weekly occurrence gets its own identity; a revision of that same
occurrence updates it. Positive information remains eligible without an action.

**Targets:** contract in `README.md`/`core.mjs`, synthetic examples in
`example.json`, and a private inventory owned by the authorized operator.
**Exit:** report `eligible N / verified routes M / excluded E / unknown U` with
an evidence date and reasons. “All weekly reminders covered” requires `U = 0`
and a verified route for every eligible item, not merely a filled demo.

### 3. Supply real Gmail and Calendar readers — NOT STARTED

1. Implement the owner's selected transport. A proposed page bootstrap such as
   `signal-log/ember-reader.mjs` may register both providers independently; that
   filename is a future target, not an existing production integration.
2. Use `registerAccountReader({workspaceId, accountId, provider,
   readVerifiedFeed})` from `adapters.mjs`. Return `{verifiedAccount,
   endToEndVerified, envelope}` exactly as described in the connector handoff.
   Attestation must come from trusted server/account evidence, never copied client
   aliases, model output, or a successful credential-status response.
3. Project selected authorized records to the v1 envelope in `README.md`.
   Gmail uses stable message IDs; Calendar uses calendar+event identity and
   recurrence/original-start identity. Preserve full-source HTTPS links,
   source-update and observation timestamps. Apply the 200/750 text limits and
   ≤200 records per accepted envelope/tab; the server can impose a smaller bound.
   Do not copy full mail bodies, attachments or broad inbox archives.
4. Keep `details.signal` source-backed. Interpretations, suggested next steps and
   AI prompts stay distinct. Unknown dates/effort remain unknown. Fresh observation
   alone cannot confirm an overdue obligation; explicit source evidence is needed.
5. Exercise the real rendered-page path: load, manual refresh, duplicate update,
   supersession references, existing dispositions and independent feed health.
   Preserve earlier records as stale on timeout, invalid response or provider
   failure. Empty bounded results do not imply prior records were deleted/resolved.
6. Add bounded timeout/backoff and retry behavior to the actual transport, honor
   rate limits, avoid refresh loops and prevent stale/out-of-order responses from
   overwriting newer records or another account. Display last success separately
   from last attempt and each provider's health; never turn failure into DEMO/LIVE.

**Targets:** `adapters.mjs`, `app.mjs`, proposed reader bootstrap, owner-assigned
backend files, `.devtest/signal-log/` and relevant existing gateway/Worker tests.
**Exit:** one known real Gmail message and one known Calendar event reach the
correct account's cards through the authenticated path, with source links and
safe failure behavior. Evidence must distinguish provider reads from fixtures.

### 4. Complete Claude and weekly-output routing — PARTIAL

The functional interim route is manual v1 JSON: selected summaries, stable IDs,
occurrence timestamps and source links, validated by `core.mjs` and imported via
`app.mjs`. Maintain this route even if automation is later added.

For automation, first verify what the actual Claude/reminder environment supports.
Choose an existing approved output channel read by phase 3, or an owner-approved
authenticated server ingress. No cross-platform reminder API is assumed to exist.
If none is supported, record manual delivery as the explicit remaining limitation;
do not call the requested automated build complete unless Brady accepts that
reduced scope. Do not silently replace or reschedule existing reminders.

An automated ingress needs a server-authenticated sender/account mapping, schema
validation, size/rate limits, idempotency keys per task occurrence/revision, replay
protection and audit metadata. Imported instructions are still inert data. A
Claude-labelled payload is not automatically a verified provider fact. Credentials
belong in owner-managed server configuration, never URLs, client bundles or Git.

**Targets:** `core.mjs` import contract, `adapters.mjs` or a proposed scoped intake
adapter, `app.mjs` provenance display, synthetic fixtures; backend transport only
after phase 1. **Exit:** each phase-2 item has a tested delivery/replay route, or an
explicitly accepted manual exception. Produce fresh coverage counts.

### 5. Add private durable state and account expansion — NOT STARTED

1. Have the owner choose an authorized private storage service and minimal data
   policy before provisioning. Do not repurpose the token coordinator or silently
   introduce a public database. Decide retention, deletion, export and who can read
   curated summaries versus action/filter metadata. No broad email copying.
2. Define a versioned sync contract: server-verified user/workspace/account scope,
   stable signal identity, source revision, decision revision, idempotent writes,
   conflict responses and deletion tombstones. Keep read/resolved/snoozed states
   separate from provider completion. Concurrent changes must merge independent
   fields or expose a recoverable conflict, never silently lose another device.
3. Implement a scoped client (proposed `signal-log/state-client.mjs`) alongside
   `storage.mjs`; keep local fallback and explicit export. An owner-assigned private
   backend module/route is a separate future target and must pass gateway/auth tests.
   Do not persist source text in localStorage/sessionStorage. A local hash is not
   authentication, encryption or a substitute for server access checks.
4. Migrate only explicitly selected valid local decisions. Preserve prior data and
   backups on failed migration; support revisions and rollback without destructive
   reset. Test reload, offline edits, reconnect, concurrent devices and deletion.
5. Add accounts only after the server owns membership and provider-grant mappings.
   Extend `CONFIG`/account selection and adapters without treating an alias as
   authorization. Clear in-memory account content on switch/sign-out, cancel old
   reads, reject late responses for the previous scope and partition every cache,
   state key, saved view, backup and source identity. Obtain separate approved
   provider access when required; never reuse one account's grant by assumption.

**Exit:** the same authorized account sees consistent selected records and
decisions on two devices, including failure/conflict recovery. Two-account tests
prove no data/decision leakage. A new account is labelled connected only after its
own successful authorized provider read. Retention/deletion/export work as agreed.

### 6. Real-data acceptance and release — NOT AUTHORIZED YET

Before proposing release, use minimal owner-approved real samples in private
operational evidence. Public fixtures, screenshots and logs remain synthetic.

- Verify one Gmail message, Calendar event/recurrence, and each intended weekly
  output route against its real source and actual account; counts alone do not
  prove content accuracy. Confirm positive/no-action signals and full-source links.
- Verify duplicate deliveries, changed/deleted/cancelled records, repeat weekly
  occurrences, stale dates, unsupported sources, wrong-account responses, expired
  login, one-provider outage and retry recovery. Source disappearance must not
  silently resolve a task. Display retention/tombstone behavior explicitly.
- Verify reload/reopen and two-device continuity, conflict preservation,
  sign-out/account-switch isolation, and private export/deletion. No payloads or
  credentials may leak through browser storage, public assets, logs or URLs.
- Retain all existing ranking/BLUF, 200/750, XSS, keyboard, contrast and responsive
  checks. Test the actual phone/Safari workflow, including source links and import/
  export; Chromium screenshots alone are not physical-device evidence.
- Run scoped local suites for each change. Before release run the required local
  build and full release matrix for the integrated candidate. The known Mission
  Control concurrent-save failure reproduced on the base remains a separate
  release blocker for its owner; repeated green reruns are not a repair.

**Release gate:** obtain explicit approval for the exact reviewed commit, target,
private access boundary, integration scope and operational owner. Merge and
deployment are **not authorized by this roadmap or the current docs-only task**.
Keep `[skip ci]` on commits and verify workflow triggers before pushing; do not
dispatch Actions, enable paid CI or consume Actions minutes. If a future release
needs a build, use the approved local/cloud mechanism and cost boundary.

**Release procedure after authorization:** refresh default/head, reconcile through
the assigned owners, verify the candidate and record a rollback point. Publish via
the existing Ember deployment procedure; do not bypass Access or open an alternate
API host. An owner-approved navigation link in `src/baxstar-ember.jsx` can make the
page discoverable at that stage. Verify deployed bytes/version, authenticated
provider reads, private persistence, phone behavior and health from the actual URL.

**Rollback:** the deployment owner restores the last known-good artifact/version,
disables only the new feed/sync bootstrap if needed and preserves existing decisions
and private backups. Backend schema changes must be backward compatible or have a
tested non-destructive rollback before release. Never roll back grants/coordinator
state by replaying old tokens, delete private state to hide errors, or reactivate
retired relays. Record trigger, owner, exact reverted version and post-rollback proof.

## Final definition of done

The whole build is complete only when:

- [ ] Shared ownership and provider/account authority are acknowledged.
- [ ] Gmail and Calendar are verified live for each enabled account.
- [ ] The complete eligible weekly inventory has verified routes; every exclusion
      or manual-only exception is explicit and accepted, with no unknown coverage.
- [ ] Claude delivery is functional by the chosen approved route and its automation
      status is described accurately.
- [ ] Private cross-device persistence, conflict recovery, retention/deletion,
      account isolation and export are verified.
- [ ] Source facts, suggestions, dedup, freshness and per-feed failure recovery
      remain truthful; all functional/security/accessibility checks pass.
- [ ] Real-data and physical-phone acceptance are recorded privately with a safe
      public summary; no secrets or private payloads are committed.
- [ ] Release blockers are resolved, exact release is approved, rollback is tested,
      and the deployed authenticated system passes live verification.
- [ ] This roadmap and the owner-approved handoff contain current evidence,
      operational ownership, recovery instructions and no unacknowledged blockers.

Until then, report the completed phase and outstanding gates. Do not label an
attractive no-feed preview, scaffolded reader, imported backup or passing mock as
the finished connected Signal Log.

## Resume and checkpoint instructions

1. Read this file first, then `AGENTS.md`, current repository state, the README
   contract, connector handoff and validation record. Refresh remote default/head,
   PR #50, open PRs and ownership; do not assume the SHAs above are still current.
2. Preserve existing working trees and other builders' work. Continue the scoped
   branch or an acknowledged successor. Create a recoverable snapshot before edits.
   While Worker/auth ownership is unresolved, make no parallel changes there.
3. Resume at the first incomplete phase and its exit criterion. Record decisions
   before adding an endpoint, storage system, account or automated delivery. Do not
   use old chat claims as fresh live evidence or revive OFF/retired infrastructure.
4. Use the repository's locked local toolchain. For runtime work run
   `CHROME_PATH=/usr/bin/chromium npm run test:signal-log` and
   `npm run build:pages`, plus suites relevant to the owned files. Broader release
   checks belong at phase 6. For docs-only edits verify links, scope and diff; no
   runtime/provider calls or CI are needed. Preserve generated/shared files.
5. Inspect/stage only assigned files, commit with `[skip ci]`, push the durable
   branch, read back the head and ensure no Actions run was triggered. Keep the PR
   draft until the release gate is met. Write shared Drive/registry records only
   when their target and write are authorized; otherwise record the outstanding gap.
6. Replace the checkpoint below with current facts and update phase statuses.
   Keep private payload evidence outside Git; identify the authorized private
   custodian/reference without publishing its contents.

```text
Checkpoint date / builder / acknowledged owner:
Verified default SHA / feature SHA / PR:
Phase and state (complete locally / synthetic-only / verified live / blocked):
Assigned files and interfaces changed:
Evidence (safe links, counts, source/version, private evidence custodian):
Local tests/build + exact outcomes; device/live checks and limitations:
Inventory coverage (eligible N / verified M / excluded E / unknown U):
Auth/access/cost/release approvals obtained (or explicitly absent):
Current blocker + who must resolve it:
Exact next action + target files/interface + exit criterion:
Rollback/recovery checkpoint:
Shared handoff write completed or outstanding:
```

**Current checkpoint:** UI/manual workflows and synthetic adapter path pass locally
at `dc8105c`; inventory completeness, real readers, private cloud state and release
remain outstanding. Connector-owner acknowledgement is the immediate blocker.
The current change creates this roadmap and its two inbound links only; no runtime,
grant, integration, automation, shared handoff or deployment is changed.
