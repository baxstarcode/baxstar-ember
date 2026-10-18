# Local verification — 2026-10-18

Base: `dc830451054cb8af5637332504f899fa2f5123ec` on current default `main`.
Branch: `codex/ember-signal-log`. No shared Worker/auth/app code changed.

## Signal Log: PASS

`CHROME_PATH=/usr/bin/chromium npm run test:signal-log`

- 26/26 unit/contract scenarios.
- 22/22 browser scenarios, Chromium, device scale factor 3.
- Viewports: 1440×1000, 390×844, 375×812, 320×740, 844×390; no horizontal overflow.
- Summary 200 / combined details+prompt 750 Unicode character boundaries;
  account mismatch, malicious links/text, import limits, stable occurrence identity,
  explicit cross-source dedup, ranking and budget edge cases, source freshness.
- Keyboard dialogs, Escape/focus return, non-color labels, minimum 24px desktop
  targets and 44px phone/coarse-pointer controls, rendered foreground/background
  contrast ≥4.5 across tested gradient stops, reduced-motion setting.
- Neutral and selected button surfaces match current canonical Ember control
  CSS; the perimeter/radius match the source-backed Argon outline. Keyboard press depth, focus outlines, disabled
  controls, clipped labels, open phone filters/dialogs and reduced motion pass.
  See the [visual source comparison](STYLE-COMPARISON.md).
- State persistence, memory-only imported content, saved views, multi-tab metadata
  transaction merging, stale-undo rejection, storage-denial recovery.
- Explicit private backup download/restore including decisions; restored records
  cannot inherit trusted provider verification. Waiting items leave the time
  budget. Old deadlines require current explicit source confirmation to retain
  deadline urgency, otherwise remain visible for verification.
- Registered synthetic Gmail and Calendar readers populate/update the page,
  preserve identity and decisions, reject account mismatch, and retain stale
  data after errors. This proves the adapter seam, not a live provider connection.
- At 390×844, at least 120px of the first signal appears before scrolling;
  secondary filters collapse while all three primary focus controls stay visible.
- No uncaught browser errors or external requests.

The contrast checks cover sampled rendered text pairs, not a complete WCAG audit. Device
scale/viewport simulation does not prove physical iPhone/Safari behavior.

[Test log](local-tests.log) · [Desktop screenshot](desktop.jpg) ·
[Phone screenshot](phone.jpg). Screenshots contain synthetic demo content only.

`npm run build:pages`: PASS. All eight staged Signal Log runtime files were
byte-compared with source. Documentation/tests are excluded from `dist/`.
The root generated HTML differed only by its build timestamp; that incidental
timestamp was restored to preserve the existing owner's generated artifact.

## Existing full release command: BLOCKED by known Mission Control issue

`CHROME_PATH=/usr/bin/chromium npm run test:release` built/staged successfully and
passed Worker 239/239, token coordinator 27/27, Pages gateway 38/38, outbox 27/27,
post-time 24/24, chat 26/26, dashboard 108/108.

It then stopped in the existing local-state suite: **16 passed, 1 failed**.
Failure: `simultaneous board edits serialize and preserve the losing tab as a
recoverable draft`, `locator.waitFor` timeout at 6000ms. This is the concurrent
Mission Control issue already documented in `docs/CURRENT-STATE.md` and Known
Issues §5 on the untouched base. No repair is claimed. Later suites were not
reached in that aggregate run; the new Signal Log suite ran separately and passed.
The full log is retained in `/workspace/signal-log-evidence/release-tests.log`.

Reproduced separately on a pristine detached worktree at the exact base
`dc830451054cb8af5637332504f899fa2f5123ec` with
`CHROME_PATH=/usr/bin/chromium npm run test:local-state`: **16 passed, 1 failed**,
the same simultaneous-board-edit assertion and 6000ms timeout. The base test and
app files were not changed. See [base reproduction log](base-local-state.log).
This establishes that the failure predates this feature; it is not fixed here.

## Live integration: NOT VERIFIED / NOT CONNECTED

An anonymous HEAD request to production returned **302 Cloudflare Access**.
There is no signed-in production browser here. No token-status/MCP request, re-key,
OAuth consent, token change, connector mutation, message or reminder action ran.
The parent ChatGPT Gmail/Calendar connection is not evidence for the Ember runtime.

Existing authenticated Cloudflare configuration was read only to verify build
controls: production `main`, automatic preview branches `all`. Git commits use
the documented `[skip ci]` prefix to suppress both Pages and GitHub CI.
Before publication, GitHub Actions had 67 total runs, newest `39074964337` on
`dc83045`; Cloudflare latest deployment ID was `7ee5fdf8-ae6d-40dd-b2d4-34a8b8b14bd0`.
Final remote read-back belongs in the draft PR / task response.
