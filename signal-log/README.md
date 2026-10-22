# Ember Signal Log

A Signal Log page at `/signal-log/`, reached from YOUR TOOLS on the dashboard. It
reuses Ember's design tokens, iron texture, reactor bezel and icon, and does not
touch the dock, the Worker, the gateway allowlist or any OAuth configuration.

**Live since 2026-10-22:** signed in at `ember.baxstarfishing.com`, the page reads
Gmail and Calendar by itself on load and on **Refresh sources** — through Ember's
own gateway, one provider per call, with Haiku 5.5 at low effort turning the bounded
results into cards (`ember-feed.mjs`, below). Anywhere else (previews, localhost)
the readers stay inert and the page keeps the demo and manual JSON import. Each
refresh is two short model calls on Ember's existing key; nothing is marked read,
completed or sent. **Start/resume here: [end-to-end roadmap](ROADMAP.md).**

The visual finish combines Argon's small-corner outlined buttons with current
Ember's machined shadows and dark furnace selection, white lettering and the
later Argon review's obsidian surface.
The earlier tan selection has been removed. See the [source comparison](evidence/STYLE-COMPARISON.md)
for exact reused styles, deliberate adaptations and the separate coral Foundry
variant that is not this page's target.

## Run and verify

From the repository root:

```sh
python3 -m http.server 8080
# Open http://localhost:8080/signal-log/
CHROME_PATH=/opt/pw-browsers/chromium npm run test:signal-log   # or /usr/bin/chromium
CHROME_PATH=/opt/pw-browsers/chromium npm run test:release
```

The module is canonical source, not generated output. `npm run build:pages` stages
its nine runtime files and the existing design-token file in `dist/`. Source docs
and tests are not staged. The existing root `index.html` remains generated from
`src/baxstar-ember.jsx`; the YOUR TOOLS link to this page lives in its `TOOL_LINKS`.

## Working behavior

- Deterministic ranking, configurable 5–240 minute budget, visible oversized or
  blocked critical work, and per-card explanation. Unknown effort stays unknown.
- Triage, Good News, Needs Attention, search, OR category filters, states, stale
  sources, and named combinations across all five businesses.
- Independent read state; done/resolved, waiting, snoozed, dismissed, accepted
  risk, reopen and undo. Snoozes expire; accepted/dismissed decisions persist.
- Full-source links, observation/update timestamps, freshness, source-reported
  facts versus interpretations/next steps, and reviewed copy-only AI prompts.
- Native keyboard controls, focus outlines, dialog focus containment and Escape
  return, responsive layout, non-color status labels, reduced-motion support.
- Local JSON import for Claude and other reports. No reminder is created or changed.
- Explicit private JSON backup download and restore, including read/action states.
  Restoring decisions requires a separate choice; no source text is silently stored.
- Registered account-attested readers populate/update the log. Each provider has
  independent health; transient errors retain its prior records with stale labels.

The initial **DEMO** dataset is synthetic and uses a fixed illustrative clock
(`2026-10-18T15:00:00Z`). It is separate from **My log**. It does not represent a
booking, actual customer feedback, current weather, source report or provider result.
Demo source links point to the full synthetic record in `demo.json`.

## Privacy and persistence

Imported summaries exist only in this tab's memory. Reload/close removes them;
reimport the source report or restore an explicitly downloaded private backup.
**Export → Download private backup** includes curated source summaries, links,
prompts and disposition states. The dialog warns that the local file is private;
nothing is uploaded. **Import signals** validates a backup, then separately offers
signals-only or signals-plus-decisions restore. The latter can replace current
device decisions and says so before the action. Provider verification is not trusted
on restore: a fresh authenticated read is required. Cross-device/server persistence
remains dependent on the authenticated integration; this is a local file workflow.
There is deliberately no broad mail
copying, persistent message store, or content in localStorage/sessionStorage.

IndexedDB `ember-signal-log-v1` stores SHA-256 identity hashes with boolean read
state, status, snooze expiry, timestamps and a revision, plus user-named saved
filter combinations. It stores no card title, summary, detail, provider ID, prompt
or source URL. Do not put confidential information in saved view names/searches.
Metadata is device/origin-specific, not a cloud sync. Transactional updates merge
independent patches across tabs. Undo rejects if another tab has changed that
record. Storage errors keep the in-memory state and expose Retry save.

Imported text is treated only as data: DOM `textContent`/textarea values, never
`innerHTML`, `eval`, executable instructions or AI tool calls. A strict CSP permits
only same-origin assets/scripts; source links accept credential-free HTTPS only,
with `noopener noreferrer`. An import is all-or-nothing after validation.

## Import contract v1

Start with [example.json](./example.json). Replace its clearly marked example
content and placeholder link with selected, authorized source summaries. The
envelope requires:

```json
{
  "version": 1,
  "workspaceId": "baxstar",
  "accountId": "baxstar-fishing",
  "source": "claude",
  "signals": []
}
```

The account ID is a configured internal alias, **not authentication**. A mismatched
account/workspace is rejected. Sources: `claude`, `manual`, `gmail`, `calendar`;
`demo` is reserved and rejected by the manual import path. All manual imports,
including those labelled Gmail/Calendar, remain **unverified imported claims**.

| Signal field | Contract |
| --- | --- |
| `id` | Stable source record/task ID, 1–100 characters. Never derive identity from a title. |
| `occurrenceAt` | Optional scheduled occurrence as an ISO instant with timezone. Distinguishes weekly runs of the same task. |
| `canonicalSignalId` | Optional, explicit cross-source identity. Only use when sources refer to the same claim; never fuzzy-match titles. |
| `title`, `summary` | Title ≤90; summary ≤200 Unicode code points. |
| `details` | `signal`, `why`, `next`, optional `prompt`. **Combined ≤750** Unicode code points. Required sections cannot be empty. |
| `categories` | Nonempty subset of `fishing`, `rentals`, `golf`, `consulting`, `software`. |
| `kind` | `attention`, `good`, `information`. Positive information may be non-actionable. |
| `priority` | `safety`, `disruption`, `waiting`, `opportunity`, `routine`. Treat this as an author-supplied classification. |
| `impact` | Number 1–5. |
| `effortMinutes` | Number 1–480 for the next step, or `null` for unknown/no action. |
| `confidence` | Number 0–1; source author's estimate, not measured probability. |
| `actionable`, `blocked` | Booleans. Missing flags are false. |
| `dueKind`, `dueAt` | `hard` with a sourced ISO due instant; `unknown` or `none` with no `dueAt`. |
| `overdueConfirmedAt` | Optional explicit source confirmation that a past-due obligation remains open. Must be after the due date and no later than observation. Expires after 24 hours. A fresh observation alone is not confirmation. |
| `reviewAt` | Optional suggested review instant, never a deadline or urgency boost. |
| `observedAt` | Required timezone-qualified ISO timestamp; no future observation beyond 5-minute skew. |
| `sourceUpdatedAt` | Optional source's update timestamp; unknown stays null. |
| `sources` | 1–5 `{label,url}` full-source references; label ≤80; URL ≤2048, HTTPS, no embedded credentials. |
| `supersedes`, `resolves` | Optional stable reference ≤100. Displayed for review; do not auto-complete another signal. |

Maximum 256 KiB and 200 records per import/tab. Unknown object fields are dropped,
not persisted. Overlong text is rejected rather than silently truncated; include a
concise bounded excerpt and the full source link.

Private backup format: `format: "ember-signal-log-backup"`, `version: 1`, matching
workspace/account, `exportedAt`, and at most 200 `entries`. Each entry contains
`source`, a normal signal `record`, and `disposition` (boolean `read`, known `status`,
nullable numeric `snoozeUntil`, `observedAt`). Backups allow 3 MiB to hold source
links and metadata accumulated across bounded imports. Invalid states, dates,
duplicate identities, links or account mismatches reject the entire backup before
restore. No secrets, raw message bodies or attachments belong in a backup.

Dedup key: workspace + account + provider + stable ID + occurrence. An explicit
`canonicalSignalId` substitutes for provider/ID for deliberate cross-source merges.
The latest source update (falling back to observation time) wins; up to five source
links survive. Decisions remain attached to identity. Updated source observations
are called out after a prior decision rather than silently resetting it.

Recommended adapter IDs:

- Claude: task ID + scheduled UTC `occurrenceAt`; retain the task's original timezone
  in the source report. Never treat a firing as completion.
- Gmail: message ID within the attested account. Thread ID groups evidence but
  **must not collapse separate messages**. Unread is not synonymous with open work.
- Calendar: calendar ID + recurring-event ID + original start for recurring events;
  otherwise calendar ID + event ID. Preserve original timezone in the source report.
- Drive report (manual): document + stable entry/date/author/heading digest.
  Handoff entry numbers can repeat and are insufficient by themselves.

## Ranking and evidence

This is a transparent **design inference**, not a scientifically validated score.
Tier first: safety/service disruption; material hard deadline (impact ≥3 within
7 days); people waiting; high-value opportunity; routine improvement; non-actionable
good news/information. Within a tier, score is impact×9 (max 45), deadline (30 for
≤24h, 20 for ≤72h, 10 for ≤7d), feasible next-step effort (0–10), confidence×15.
Ties use applicable due time then stable identity. A past date without an explicit
source confirmation within the last 24 hours receives **zero deadline points**, no
deadline tier, no old-date tie advantage and no time-budget selection. It stays
visible as **Past deadline · verify current status**. A current explicit
`overdueConfirmedAt` preserves a genuine still-open obligation's deadline priority;
that confirmation expires. Review dates do not score. Waiting-on-others state is
treated as a dependency even when the imported `blocked` flag was false. Waiting
and blocked work cannot consume the actionable budget, but critical dependencies
stay called out. Greedy budget selection never hides unselected cards.

All dates display in **America/Chicago**, including DST. Source freshness becomes
stale after 168 hours. The resolution count records log actions, not actual revenue
or business success. Positive signals do not imply tasks or safety clearance.

The in-page **Sources & method** panel links the parent's urgency and implementation-
intention research, Harkin et al.'s progress-monitoring meta-analysis, W3C hierarchy,
contrast/color/target guidance, Stripe recurring-revenue definitions, NIST monitoring,
NWS boating and Minnesota ice-safety references. Publisher access to the first two
papers was blocked in this environment and is labelled accordingly. The parent
supplied their recommendations. No effect size or validated-ranking claim is made.

Primary sources: [mere urgency effect](https://academic.oup.com/jcr/article-abstract/45/3/673/4847790?login=true),
[implementation-intention meta-analysis](https://doi.org/10.1080/10463283.2024.2334563),
[progress-monitoring meta-analysis](https://pubmed.ncbi.nlm.nih.gov/26479070/),
[W3C familiar design](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p02-familiar-design/),
[contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[non-color meaning](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html),
[target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[Stripe MRR definitions](https://support.stripe.com/questions/understanding-monthly-recurring-revenue-%28mrr%29-and-annual-recurring-revenue-%28arr%29?locale=en-GB),
[NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/),
[NWS boating/thunderstorms](https://www.weather.gov/safety/safeboating-thunderstorms),
[Minnesota DNR ice safety](https://www.dnr.state.mn.us/safety/ice/index.html).

Future metrics require period, source and denominator: guide slots, rental hours,
house nights, golf bay-hours, booking readiness, payment exceptions, response age,
client dependencies, software incidents/evaluation success and cost per successful
outcome. No invented benchmarks. One-time consulting revenue is not MRR. Weather
and ice signals always need human review.

## Live feed — how Gmail and Calendar get in

`ember-feed.mjs` registers one reader per provider through `registerAccountReader`
(`adapters.mjs`) before `app.mjs` initialises, so the first load refreshes by itself.

```text
signed-in browser at ember.baxstarfishing.com
  → POST /api/messages (same origin; Cloudflare Access cookie)
  → functions/api/[[path]].js exact host/path allowlist
  → EMBER_API service binding → proxy/cloudflare-worker.js
  → server-owned read-only MCP toolset for ONE provider (gmail or calendar)
  → Haiku 5.5, effort low, max_tokens 6000, JSON-only reply
```

- **Bounds, fixed in the prompt:** Gmail — up to 25 inbox messages from the last
  7 days that need attention (newsletters, receipts and automated notices skipped
  unless they signal a problem or money). Calendar — up to 40 events from 2 days
  ago to 14 days ahead. Timestamps are computed by the page and passed verbatim.
- **Verification is the OPS standard:** a provider counts as read only when the
  reply carries a successful `mcp_tool_result` paired to that provider's own
  `mcp_tool_use`, and the Worker did not flag `x-ember-connectors: degraded`.
  A connector-free fallback answer, however plausible its JSON, is reported as
  "no successful tool result" and the previous records are kept, labelled stale.
- **Projection, then the normal contract:** the model's records are coerced into
  the v1 envelope (text fitted to the 90/200/750 limits, numbers clamped, unknown
  categories dropped, past event starts never turned into deadlines, Gmail links
  built from the message id when the model omits one). Each record is validated on
  its own, so one malformed card never discards the read; the drop count is
  returned. Identity is `provider + id` (Gmail message id; Calendar event id plus
  original start for recurring instances), so decisions survive refreshes.
- **What the labels mean:** `VERIFIED READ` = the provider answered through Ember's
  gateway this session. The account alias (`baxstar-fishing`) is the Worker's single
  configured Google grant; the Worker does not yet return a per-request account
  attestation, so a second account would need its own server mapping first.
  Classification, impact, effort and confidence are Haiku's judgment of the source
  text, not facts; the full-source link is always one tap away.
- **Not on production** (preview hosts, `localhost`): the readers refuse before any
  request, the health labels say so, and the demo plus manual import still work.
  Tests set `window.__emberSignalFeedAnyHost = true` and intercept `/api/messages`.
- **Failure copy** names the real cause: Access sign-in needed (HTML came back),
  gateway/HTTP error text, timeout (75 s), or a provider with no successful tool
  result ("check the OPS lights").

## Ownership and continuity checkpoint

- Canonical repo: `baxstarcode/baxstar-ember`, default `main`.
- Built by Codex on `codex/ember-signal-log` (draft PR #50, 2026-10-18, demo and
  manual import only); merged onto main and wired to the live feed by Claude on
  2026-10-22 (`ember-feed.mjs`, YOUR TOOLS link, tests, this document). PR #50 is
  closed as superseded; its evidence folder is kept as history.
- Scope on main: `signal-log/`, its tests under `.devtest/signal-log/`, the staged
  file list in `scripts/stage-pages.mjs`, one `TOOL_LINKS` entry in
  `src/baxstar-ember.jsx`, and two tools-rail count assertions.
- Live verification: the gateway path is exercised with intercepted responses in
  `browser.mjs`; a signed-in read on the custom domain is recorded in
  `docs/KNOWN-ISSUES.md` §9 when Brady confirms it.
