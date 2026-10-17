# Ember alternative — brass controls and Foundry atlas

Checkpoint: 2026-10-17 UTC. Branch: `codex/ember-brass-pressure-alt`.
Base: preserved handoff `108d444549231f971ab6db8af81e5d413133e35b` on
`codex/ember-command-plate-light`. This is a separately requested visual preview,
not a production replacement or a change to the booking app.

## Review the design

- Original preview: https://5b56930b.baxstar-ember.pages.dev
- Alternative: Cloudflare Pages preview for `codex/ember-brass-pressure-alt`.
  The exact successful deployment URL will be recorded after publication.
- Production remains https://ember.baxstarfishing.com and has not received this branch.

Brady explicitly liked the larger skull and pinned bottom dock. Both remain. The
six dock destinations, their artwork/crop geometry, and existing mechanical motion
are preserved. The alternative adds warmer vivid button faces, etched brass tool
outlines, brighter text, and physical press depth using shadow/top changes instead
of transformed small text. Reduced motion suppresses travel.

Knowledge Graph opens the new Foundry atlas: 20 sources, 34 relationships, 5 domains,
animated illustrated pipes/gears, source search, filters, pan/zoom, reset, and an
inspector. Phone controls remain visible and a source selector provides readable
access to every result. The existing Works graph and original external source map
remain available as tabs. The atlas is a reference illustration, not live traffic.

## Supplied reference

Brady supplied Argon's implementation as `Pasted text.txt`, 83,262 bytes, via
`sediment://file_00000000dc8081f58d353b8b0655004d`. SHA-256:
`808b9abe1b68cbf18fdf3ed19bda5c871553fe1bf2b84d8e41895c07dfe40c32`.
The upload ends mid-JavaScript; its CSS, graph markup, and 20-node/34-link data were
available. The graph interactions were completed in canonical React source.
Prototype fake sync/task completion and unsupported live-system assertions were
excluded. Only known source URLs were added. The raw paste is not a new app root
or repository source of truth.

## Voice

**Voice Lab** is reachable beside Enigma/Scope. The isolated lab adds a brass
instrument tied to actual recognition/playback events, a 750 ms default or 1600 ms
pause window, explicit-Finish mode, Escape cancellation, and Copy transcript.
Manual mode retains the 30-second cap and cannot override a browser-ended session.

On Pages preview hosts the lab permits microphone/transcript testing and copying.
Send/Play are guarded and disabled because the existing API gateway accepts only
the production hostname. The notice links to the existing authenticated live lab;
that page keeps its deployed version until the separate production rollout.

The physical five-turn Mac Chrome gate remains open: capture, transcript, mic
release, text request, audible neural reply, and interruption/recovery must work on
Brady's device. iPhone has a separate opt-in gate. Simulated events do not establish
physical reliability. See `work/desktop-voice-probe/README.md`.

## Verification

The build and exact 25-file Pages staging passed. Desktop 1440×1000 and phone
390×844 renders were inspected at device scale factor 3. New browser checks cover
pressed controls, preserved dock destinations, graph interactions, visible phone
zoom controls, keyboard focus, and reduced motion: **53/53 passed**.

Combined regression results: **830 passed, 1 failed across 16 suites**. This is
not a passing full release run. `test:release` stopped at the existing concurrent
board-save failure; the remaining suites were then run explicitly.

| Suite | Passed / total |
| --- | --- |
| Worker | 239 / 239 |
| Token coordinator / workerd | 27 / 27 |
| Pages gateway | 36 / 36 |
| Outbox | 27 / 27 |
| Posting time | 24 / 24 |
| Chat | 26 / 26 |
| Dashboard | 108 / 108 |
| Local state | **16 / 17** |
| Layout / truth | 87 / 87 |
| Streaming / effort | 14 / 14 |
| Ecosystem graph | 40 / 40 |
| Existing UI | 36 / 36 |
| Alternative interactions | 53 / 53 |
| Caption Studio | 46 / 46 |
| Voice timing | 27 / 27 |
| Voice browser simulations | 24 / 24 |

The failed simultaneous-save test also reproduced against original source at
`108d444`. Instrumented synthetic fixtures show the second tab reading a stale
localStorage snapshot after the first tab writes, despite serial Web Locks; both
then display the second edit as saved. No persistence code or test expectation was
changed to conceal this. See Known Issues §5. Use one Mission Control editing tab
until the shared transaction/revision boundary is repaired. Do not promote this
preview to production on the strength of a later green retry.

Local test logs are `/workspace/ember-alt-release-checks.log`,
`/workspace/ember-alt-remaining-checks.log`, and
`/workspace/ember-baseline-concurrent-check.log`; these are workspace evidence,
not deployed public files. Browser/provider calls in the automated suites are
intercepted or synthetic. No real Google/Quo content or physical microphone was tested.

## Cloudflare and live data

The configured API token verifies as active. Authenticated read-only checks confirm
Pages project `baxstar-ember` and Worker `ember-claude-proxy` in account
`9d1afb55bb78592212916ec0244bd8e4`. Preview builds include all branches. The Worker
still serves version `6110e34c-2363-41c5-a5f6-fab751ecb717`, deployed October 16 at
00:08 UTC; it lacks the new coordinator binding/seed secrets. No Worker deployment,
secret change, new OAuth consent, merge, or production deployment occurred here.

The workspace can read Cloudflare deployment metadata but cannot render Pages
preview hosts through its network proxy. No authenticated production browser tool
is available. Distinguish a successful Cloudflare build from signed-in live-device
verification. Ask Jev has no callable tools; Drive/Registry/Relay write-back is also
unavailable. This Git checkpoint is the continuation record.

For Gmail/Quo live sections, follow `docs/DEPLOY.md` in order:

1. Prove connector-free chat through the existing signed-in Pages binding.
2. Deploy the compatible Worker/models/coordinator while preserving existing secrets.
3. Obtain fresh Google and Quo consent for the intended accounts. Google read access
   covers Gmail, Calendar, and Drive; Quo uses `read:conversations read:account`.
   Use new coordinated seed secrets; never import uncertain legacy refresh tokens.
4. Verify data-free status, controlled provider reads, model stamps, expiry/restart,
   then the live UI and physical voice gates. Repair the concurrent-board-save
   regression before a production release.

The user needs to sign into the desired Google/Quo accounts at the consent step,
not share passwords or paste more tokens into chat. Existing OAuth clients are
already configured. Quo service/account health still needs a live check.
