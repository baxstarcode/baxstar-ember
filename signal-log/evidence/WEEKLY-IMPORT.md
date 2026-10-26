# Claude / weekly-report continuation — October 26, 2026

Branch `codex/signal-feed-reliability`, [draft PR #59](https://github.com/baxstarcode/baxstar-ember/pull/59),
based on verified default `main` `5d911babdc77bf1f62789a9fe285bc7423d974ff`.
This continues the bounded-read change in the same PR. No merge or deployment.

## Working manual route

Import signals now supplies a copyable Claude report prompt and accepts
`ember-weekly-report` v1. One whole JSON code block is supported. Task/run/item
identity distinguishes a new week from a revision; revisions retain decisions,
newer publication wins and an old report stays old when reimported. Every card
links to the full report, and provenance survives private backup/restore.
The claimed source remains unverified; no automation, model call or provider
action runs on import. Imported instructions are inert text.

The contract enforces account/workspace, IDs, publication/occurrence timestamps,
safe source URLs, duplicate IDs, 50-record/256-KiB limits and 200/750 text limits.
Records cannot override the report identity or provenance. The existing v1
report/backup paths remain compatible. See the [synthetic example](../weekly-example.json).

## Validation

- **44/44 contract tests and 28/28 browser scenarios pass locally.** The new
  scenarios exercise revision/decision retention, distinct weekly runs, full
  report links, private backup provenance and phone clipboard failure fallback.
- Phone/desktop rendering inspected at device scale factor 3. The general suite
  covers 1440×1000, 390×844, 375×812, 320×740 and 844×390; the new dialog is checked
  at 375×812 and 1440×1000. Phone controls include 44px targets. No uncaught browser
  errors or external browser requests.
- `CHROME_PATH=/usr/bin/chromium SIGNAL_FAST=1 npm run test:release`: **exit 0**.
  Includes Worker 239 + TTS 5, token coordinator 27, Pages 38, outbox 27,
  post-time 24, chat 26, dashboard 127, local-state 24, mobile 45, layout 87,
  streaming 14, UI 36, alternative 122, caption 46, voice grace 32 + probe 50,
  voice contracts 11 + recording browser 43, and Signal Log 44 + 28.
  The ecosystem suite also completes successfully. No physical device or live
  provider behavior is implied by these synthetic/automated results.
- A final review restricted the code-fence opener to spaces/tabs on its opening
  line, avoiding repeated cross-line whitespace scanning. The relevant contract
  now checks CRLF and a long unterminated whitespace input. Signal Log 44/28 and
  the Pages build were rerun after this narrow change; the other release files
  stayed unchanged.
- All nine staged runtime files match source byte for byte. The new example and
  documentation stay outside the public runtime bundle. Root generated HTML's
  incidental timestamp was restored; shared application/Worker/auth/config untouched.

Two initial new-test failures are retained locally: one asserted before an async
card expansion completed (fixed its wait); the other exposed a real accessible-name
problem for the prefilled prompt (fixed with an explicit accessible label).

Test log: [weekly import tests](weekly-import-tests.log).
Full release/build logs and the original file archive are retained privately in
`/workspace/signal-weekly-evidence/`.

## Inventory evidence and remaining dependency

Read-only task lookup returned 8 accessible ChatGPT tasks, cursor null: 2 enabled
non-weekly items, 6 disabled. This set contains no eligible enabled weekly item.
The dated Agent OS Activation Index / October 4 handoff name 2 historical weekly
candidates but explicitly do not verify the current Claude scheduler. No native
Claude scheduler list/export capability is available here. Current enabled state,
task IDs, cadence/timezone and output locations must be obtained from that source
before complete coverage or automated delivery can be claimed. Other platforms
also remain unenumerated; unknown global coverage is not zero.

Exact IDs and exclusions are in the private, non-Git
`/workspace/signal-weekly-evidence/inventory-2026-10-26.json` (mode 0600).
Only counts are committed. No reminder was changed or resurrected; the relay is
retired. No shared Drive record was written under the original write hold.
Cross-device private state, additional accounts and signed-in production/Safari
acceptance remain the roadmap's later gates.

## Screenshots — synthetic demo only

[Phone](weekly-import-phone.jpg) · [Desktop](weekly-import-desktop.jpg).
The report prompt is local help text; none of the underlying demo cards is real
Gmail, Calendar, Quo, a customer report or an authenticated Claude delivery.
