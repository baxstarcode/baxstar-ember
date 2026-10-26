# Signal Log bounded-read follow-up — October 26, 2026

Later checkpoint in the same PR: [weekly import and full local release evidence](WEEKLY-IMPORT.md).
The counts and scoped-only release note below describe the earlier reliability checkpoint.

Base: `5d911babdc77bf1f62789a9fe285bc7423d974ff` (`main`).
Branch: `codex/signal-feed-reliability`. Local synthetic verification only;
this task does not merge, deploy, change grants or use live provider/model calls.

## Changes and evidence

- The 75-second deadline includes the response body, aborts/cancels stalled reads,
  and releases the UI even if a test transport ignores abort. No automatic retry.
- Response data is limited to 512 KiB. Provider caps (Gmail 25, Calendar 40, Quo 20)
  are enforced in code. The Gmail prompt includes weekly reports and meaningful
  positive news without inventing an action; this is not complete inventory coverage.
- Missing/non-array or wholly unusable results fail. A valid empty list remains
  valid. Partial reads report invalid and over-limit counts while keeping good cards.
- Previous cards absent from a bounded read become stale, preserving decisions;
  they are never automatically deleted or resolved. Each feed shows its last
  attempt and last successful read separately and recovers independently.
- Raw upstream error messages are not rendered. Provider-labelled links are
  restricted to provider hosts/paths, with a provider fallback.

Three new assertions fail on the untouched base: malformed output being treated
as empty success, missing per-provider record caps, and hidden partial counts.
All pass on this candidate. The stalled-header/body and oversized-response tests
add cancellation checks; error tests assert one request and no private error text.

## Local validation

- `CHROME_PATH=/usr/bin/chromium SIGNAL_FAST=1 npm run test:signal-log`:
  **38/38 contract tests, 26/26 browser scenarios**. Exit 0.
- The new phone scenario exercises partial → malformed → empty → recovered
  results, independent provider health, retained read decisions and stale cards.
  Existing responsive checks cover 1440×1000, 390×844, 375×812, 320×740 and 844×390
  at device scale factor 3. No external browser requests or uncaught errors.
- `npm run test:worker`: **239/239 Worker checks and 5/5 TTS checks**. Exit 0.
  Worker/config/gateway source was not changed; provider responses are synthetic.
- `npm run build:pages`: exit 0. All nine staged Signal Log runtime files match
  source byte for byte. Root generated HTML changed only by its build timestamp;
  that incidental change was restored.
- `git diff --check` and Markdown relative-link checks pass.

An initial browser-test attempt waited for a phone filter-panel button while the
panel was collapsed. The test now opens the panel as a user would; no production
change was needed for that test failure. The corrected scenario passes.

The full release matrix was not rerun for this isolated review branch. Signed-in
production behavior and physical Safari are unverified here. Cross-device private
state, complete weekly coverage and additional accounts remain roadmap work.
No authentication bypass, model/API spending, automation mutation or shared Drive
write is part of this change. Registry was read only; no claim is asserted.

Test output: [Signal Log](feed-reliability-tests.log),
[base regression reproduction](feed-reliability-before.log).
Local build/Worker logs and the pre-edit file archive are retained under
`/workspace/signal-feed-reliability-evidence/`.
