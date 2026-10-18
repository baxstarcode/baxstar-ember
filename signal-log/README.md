# Ember Signal Log

An additive, locally verified Signal Log page at `/signal-log/`. It reuses Ember's
design tokens, iron texture, reactor bezel and icon. It does not replace the dock
or modify the existing app, Worker, gateway, OAuth configuration or automation.
There are no new dependencies, model calls, telemetry or external requests on load.

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
CHROME_PATH=/usr/bin/chromium npm run test:signal-log
CHROME_PATH=/usr/bin/chromium npm run test:release
```

The module is canonical source, not generated output. `npm run build:pages` stages
its eight runtime files and the existing design-token file in `dist/`. Source docs
and tests are not staged. The existing root `index.html` remains generated from
`src/baxstar-ember.jsx`. No root navigation changes are included in this scope.

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

## Integration boundary and exact next step

`adapters.mjs` is a functional dependency-injected contract, tested with synthetic
host responses **through the rendered page**. `registerAccountReader(...)` causes
the page to load that reader; **Refresh sources** repeats the read. Registration
before page initialization also loads after initialization. Readers registered
during an in-flight refresh are queued for another pass. Results are validated,
deduplicated and ingested; account/provider mismatches are rejected. Source IDs,
supersession references and existing dispositions survive. Transient failures
retain prior data with stale-read and provider-health labels. Current filters are
preserved. The shipped page supplies no reader; Gmail/Calendar remain
**not connected**. A browser-selected account never grants access.

See [CONNECTOR-HANDOFF.md](CONNECTOR-HANDOFF.md) for the exact callback, existing
auth route, missing attestation, and distinction between Access login and OAuth.

Inspected existing Ember paths: `src/baxstar-ember.jsx` per-feed OPS sync,
`/api/connectors/status`, `/api/messages`, the same-origin Pages service binding,
and server-controlled read-only toolsets in `proxy/cloudflare-worker.js`. Status
can mint/refresh tokens and proves only token availability, not a successful MCP
read. This page calls neither status nor messages and does not spend on a model.

**Missing step:** the Worker/auth owner must supply a bounded, authenticated,
account-attested feed through the existing boundary, map the selected records to
this contract, then verify one actual Gmail message and Calendar event end to end.
Account-specific server routing is not established by the current credential-status
response. No new endpoint, grant, token, or bypass is added here.

Runtime diagnostic on 2026-10-18: an anonymous HEAD request to
`https://ember.baxstarfishing.com` returned 302 to Cloudflare Access. There is no
signed-in Ember browser here, so per-provider runtime reads remain **PROVISIONAL**.
Gmail/Calendar reads in the parent ChatGPT connector are separate evidence. Quo was
not tested here. A new phone does not by itself prove OAuth needs replacement.
Smallest user-side diagnostic is sign into Ember on the phone and inspect its
per-feed sync result; the connector owner then investigates the specific failed
provider. Do not re-key Quo ahead of that owner's refresh-coordination cutover.

Parent's source inventory identified weekly pricing/review and risk-watch reports;
this UI imports selected reports without reviving or mutating their automations.
The Sunday Signal Sweep remains disabled. Relay is OFF. Calendar `#text` tags
belong to a separate Quo sender and are not a Signal Log transport.

## Ownership and continuity checkpoint

- Canonical repo: `baxstarcode/baxstar-ember`, verified default `main`.
- Fresh base: `dc830451054cb8af5637332504f899fa2f5123ec` (2026-10-17).
  Configured checkout `108d444` was stale; it was not used as the feature base.
- Feature branch: `codex/ember-signal-log`; local base snapshot:
  `snapshot/ember-signal-log-base-20261018`. The existing checkout and branches are
  preserved. The snapshot is local; the immutable base commit is canonical GitHub.
- Existing `codex/ember-command-plate-light` Worker/config/token coordination is
  already in the fresh main ancestry. This task changes none of those surfaces.
  PRs #48 and #11 remain independent and untouched.
- Scope: `signal-log/`, its tests, additive Pages allowlist/test-script entries,
  and short provenance pointers in existing repository handoffs.
- Read Registry row `baxstar-ember`: no active owner/lock, HANDOFF_READY,
  last touched September 21. It is stale and was not treated as ownership clearance
  over shared code. **No registry claim/write:** the API needs a secret and this
  task forbids credential access/transmission and shared Drive writes. No secret
  was read. The parent/authorized owner retains this write-back gap.
- Read current Ember/General handoffs, Relay STATE and canonical Build Standards.
  Relay is OFF; no Relay or Drive records were written.
- No merge, deployment, external message, OAuth action, reminder change or paid
  tool/model call is authorized in this delivery.

GitHub Actions and Cloudflare Pages support a `[skip ci]` commit directive.
All feature commits use this prefix, preserving code without running CI or a Pages
preview. Do not remove it or mark the draft ready without renewed release authority.
References: [GitHub skip workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs),
[Cloudflare skip builds](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message).
