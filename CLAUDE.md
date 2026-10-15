# Baxstar Ember — repo rules

## Two generated files. Never edit either by hand.

| File | Rebuild with | For |
|---|---|---|
| `index.html` | `npm run build` (node) | the hosted deploy build |
| `_preview.html` | `./start-ember.sh` (python3 only) | local iteration |

Edit `src/baxstar-ember.jsx` and regenerate. Hand-editing a generated file is how the
deploy build once drifted **an entire redesign** behind the source with nobody noticing —
the hosted app was still the pre-steampunk version through six retheme commits. One
generator per artifact, and the generator is the only thing that writes it.

The python path is preserved deliberately: there is no Node on Brady's Mac, and
`./start-ember.sh` must keep working with python3 alone.

## The key — non-negotiable

No API key ever lands in this repo or in any generated file. `index.html` is public the
moment it's hosted. The key lives in the Cloudflare Worker (`proxy/cloudflare-worker.js`)
as a secret. Production calls the Worker only through the Access-protected same-origin
Pages Function and its `EMBER_API` service binding. `ALLOWED_ORIGINS` is browser CORS,
not authentication; never describe a forged-Origin 403 as an authorization boundary and
never widen the allowlist to `*`.

## Tests

```bash
npm run test:release  # rebuild/stage, then run every release contract
```

The browser suites drive the **generated** `index.html`; `test:release` rebuilds it before
running them. Use an individual `test:*` script only for focused iteration.

## Caption Studio

Sponsor handles live in the `SPONSORS` map in `src/baxstar-ember.jsx` and are shared with
the standalone tool at [baxstarcode/caption-studio](https://github.com/baxstarcode/caption-studio).
Drift between the two is checked by a machine, not by you: `npm run test:sponsors`
(`scripts/check-sponsor-drift.mjs`) compares the two sets exactly, and the `sponsor-drift`
GitHub Action runs it on sponsor-touching pushes, PRs, and weekly. If it fails, fix the
side that is wrong in its own repo — the historical failure was `@vexusboats` shipping when
the sponsor is `@therealvexusboats`, a different real account notified on every post. If
you change `SPONSORS`, run the check before pushing; that's the whole obligation.

Other rules that are load-bearing, not stylistic:
- Hashtags are hard-capped at 5 **including** the locked `#getyourbassingear`.
- The auto-post caption omits `@handles` — they ride as on-photo Instagram tags, which is
  the version that actually notifies. Repeating them in the body double-tags.
- The lake travels as a **name**, never a location ID. An ID is what made the 2026-07-07
  publish attempt fail with "Location ID invalid".

## Design law

Steampunk is the identity; fishing and golf are engraving only. **Warmth only — no blues,
no purples in primary UI.**

The dock spec changed twice, both per Brady. 2026-08-01: `command-console@2x.webp` retired
as one stretched bar — `object-fit:fill` distorted it and its painted nameplates forced
absolutely-positioned labels that drifted on phones. 2026-08-15: Brady wanted the steampunk
buttons back, so the asset returned **as six per-button tiles** (`.dock-art`): each button
shows its own panel slice at a locked aspect ratio, cropped above the painted nameplates,
with the label as natively-centered HTML text below. The bar itself stays CSS-built and
`position:fixed`. Never render the raster as one stretched strip, and never put label text
on the painted nameplates — those are the two failures that got it benched the first time.

2026-09-21: the dock's **motion** is back — gear spin and lever throw on Caption Studio,
an idle amber breath on the reactor. The motion was never judged bad; it was collateral
damage when `f278227` (2026-08-01) deleted the bar it was pinned to, and `615c7c0`
(2026-08-15) restored the art without it. The rule that governs any future dock motion is
load-bearing and predates this pass: **nothing may draw a second outline of a painted
mechanism.** The gears have painted teeth and the gauge has a painted needle, so a
synthetic shape on top *is* a duplicate — that is what benched the original `.dock-machine`
layer. Two ways satisfy the rule, and only two: add light that can only brighten
(`mix-blend-mode:screen`, as the reactor glow does), or move the painted pixels themselves
under an opaque mask that covers the still artwork (as the gear and lever do). A moving
layer must be provably contained: outside its mask, consecutive frames must be pixel-identical.

Containment is necessary but not sufficient, and that caught this pass out once. A clip can
hold a neighbouring mechanism's brass **inside** it, where a containment test cannot see it —
the gear's first radius (r=47) swallowed the lever's ball joint, and the joint then orbited the
gear once per turn while "nothing outside the disc changes" stayed perfectly true. So measure
the boundary ring itself: sample luminance all the way round it and require near-zero bright
brass. For this gear the usable window is exactly r=45 — two pixels wide, between tooth tips at
r~44 and the ball joint at r~46. A mask edge on bare plate is the requirement; a wide moat is a
convenience, and assuming one is how you ship a moving artefact that every containment check
still passes.

2026-10-15: the dock became OPS · Caption Studio · Knowledge Graph · Google Drive · FareHarbor ·
Projects (Brady). The quick-action prompts moved, not vanished: WHAT'D I MISS and BRIEF MY DAY
are brass push-plates beside the reactor, Triage is a link on the Inbox. New motion obeys the
same rule — the Knowledge Graph furnace is screen-blended light; the FareHarbor wheel is a masked
copy of the painted wheel; the Drive tile is an opaque plate that replaces the gauge face whole.
The wheel adds a third lesson: **a quiet boundary is still not enough — the disc's contents must
also survive the turn.** Its lowest-scoring ring (r=74.5, 0.49% bright) carried a band of plate
lit from the upper left, and turning it showed the disc as a moving crescent. The clip is r=70.5,
just outside the rim, so the disc holds only the wheel; prove it on frames (outside mask+feather:
0 changed pixels; rest frames identical to frame 0).

## Source-of-truth preflight

For work that changes Ember code/config/live behavior, depends on a prior Ember decision,
or states Ember's current status:

1. Read `SOURCES-OF-TRUTH.md`, `HANDOFF-CINEMATIC.md`, and relevant sections of
   `docs/KNOWN-ISSUES.md` before editing.
2. A Drive-capable chat agent also follows the current preflight/write-back protocol in
   **Baxstar Source of Truth Router**
   (`1AgIxAj0YM8XNTTMHVcJInNAquLKnon-WB4i2DMzTzRQ`) and checks
   **Baxstar_Ember_Handoff_Log**
   (`1WVjv426vSaxp6BbQPRXOfifD2UQUJcweT3RB6xp5znE`) for recent state/open items.
3. Build-only agents that cannot read Drive work repo-first from these synced constraints
   and must not claim Drive was updated.

The Router, Ember Handoff Log, repo source-of-truth files, and live production have distinct
jobs and are all preserved. Do not create a replacement Ember context document unless Brady
explicitly decides to.

## Commercialization-aware, Gremlin-safe build rule

The canonical build doctrine is **Baxstar_Build_Standards**
(`1VfETYcTNktp-6cZLVAHbAUDBmR1NqlwMGCgl2Xo5DY0`). Apply it proportionally:

- Security remains hard law: secrets server-side only, appropriate endpoint authorization,
  least privilege, and no credentials in repo/generated/client-visible files.
- Keep replaceable Brady/client-specific values centralized when the task benefits from it.
- Prefer reliable zero-marginal-cost infrastructure and clean/licensed IP.
- Testing, documentation, cost review, tenant-readiness, live probing, and device checks
  scale to the scope and risk. Targeted edits get targeted verification; releases and
  merges get the broader proof they need.
- **No retrofit-on-touch.** Do not broaden a requested change into a commercial rewrite.
- CEO/CFO/IT are optional decision lenses, not a mandatory all-hats ceremony. Use only a
  lens capable of changing the current decision or release.

## Doc discipline

After durable Ember state changes, update the appropriate existing records before the turn
ends when write access exists:

- Repo implementation/provenance belongs in the relevant repo docs.
- Ember recent changes and open items belong in `Baxstar_Ember_Handoff_Log` under its
  established discipline; it remains an active operational record.
- Durable cross-project rules/decisions also go to the Router-designated owning Drive source.
- `Baxstar_Agent_Relay` is used when another AI has a concrete next action, unresolved
  dependency, or important current-state handoff.
- Read first and correct existing text in place rather than creating duplicate versions.
- Verify any Drive write by re-reading it. A tool success response is not proof.
- Exploration that reached no adopted outcome does not require a ceremonial log/Relay write.

Update the `PROJECTS` constant only when the task materially changes a tracked project's
status. Do not bump it merely because an unrelated edit shipped.

## Git

Routine `add`/`commit`/`push` on this repo is pre-approved (Rule 12). Always ask first for
force push, branch deletes, `reset --hard`, or anything that might commit a secret.
Work that is committed but not **pushed** does not survive — verify the push.

## Merge law (Brady, 2026-08-23)

**Merge by default.** When work on this repo is verified green, do not stop at a draft
PR and wait — open the PR, merge it, and report what shipped. Brady's words: "Merge and
always do this by default in the future." Asking permission to merge verified work is
now the exception, not the rule (destructive or scope-changing work still asks).

**De-drift before every merge — this is the other half of the same order.** Multiple AI
lines (Claude, ChatGPT/Codex) touch this project, so before opening or merging any PR:

1. `git fetch origin main` and merge main into the branch — a branch even a few days
   old can be many commits behind.
2. Rebuild the generated files from merged src (`npm run build`) — never resolve an
   `index.html` conflict by hand.
3. Re-run every suite on the merged tree, not just the pre-merge one.
4. Sweep the sources of truth for staleness the work exposed (`SOURCES-OF-TRUTH.md`,
   `README.md`, `docs/DEPLOY.md`, `docs/KNOWN-ISSUES.md`) and update
   `Baxstar_Ember_Handoff_Log` under the discipline above.
