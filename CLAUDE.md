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
as a secret; the Worker's URL is safe in git only because it enforces an origin allowlist
**server-side**, so a leaked URL used from curl still gets a 403. Never widen
`ALLOWED_ORIGINS` to `*`.

## Tests

```bash
npm test              # proxy worker + Drive outbox — no network, no deps, no browser
npm run test:caption  # Caption Studio end-to-end in headless Chromium (needs playwright)
```

`npm run test:caption` drives the **generated** `index.html`, so run `npm run build` first.

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

## Commercialization-first (Baxstar_AI_Context Rule 17, 2026-08-22)

Every build here is constructed as if a paying client will one day receive a copy — Brady's
hard rule, and the drivers are security, commercial-grade strength, and flexibility:

- Secrets server-side only (the Worker pattern — already law above). Server-side
  authorization on every endpoint. Key-rotation path documented.
- Brady-specifics — names, IDs, URLs, sponsor lists, prices, endpoints — live in declared
  config blocks (`SPONSORS`, `PROJECTS`, `EMBER_API_PROXY`...), never scattered through
  logic. A second client means new config, not a rewrite.
- Tests and a deploy doc a stranger could follow are part of "done", not extras.
- Zero-marginal-cost infra by default (Workers/Pages/Apps Script); a metered dependency
  needs a stated reason and a monthly-cost line.
- No assets or licenses that would block resale.
- Existing code is brought up to this standard when touched — never a big-bang rewrite.

The full rule and the C-suite review hats ([CEO] scope / [CFO] cost+pricing / [IT]
security red-team, findings tagged in logs and the Agent Relay) live in Baxstar_AI_Context.

## Doc discipline (Baxstar_AI_Context Rule 15, 2026-08-01)

**After finishing any piece of work here, update Brady's docs before the turn ends.** Not a
draft for him to paste — write it.

- Ember / Mission Control / this repo → `Baxstar_Ember_Handoff_Log`
  (`1WVjv426vSaxp6BbQPRXOfifD2UQUJcweT3RB6xp5znE`). Everything else → `Baxstar_Handoff_Log`.
  Unsure goes to master, never both.
- Any durable rule or decision must ALSO land in its owning domain doc per the router
  (`Baxstar Source of Truth`), not only in a log.
- **Unless it's already there.** Read first — reads are free. A duplicate entry is worse
  than none: it pushes real content toward the trim threshold and creates two versions of
  one fact that can later disagree. If existing text is wrong or incomplete, correct it in
  place rather than appending a second copy.
- Verify by re-reading the live doc. A write tool's success response is not proof
  (Rule 6 — this rule exists because prior tooling falsely reported successful writes).

What counts as finishing: shipped code, a pushed branch or PR, an adopted decision, a
discovered bug, a corrected earlier claim. Exploration that reached no conclusion still
gets one line.

Shipping work on any Baxstar project also means bumping the `PROJECTS` constant in
`src/baxstar-ember.jsx` (pct / outstanding / sessions) — the Projects dashboard is
session-maintained, and a stale bar misleads Brady the same way a stale log does.

## Git

Routine `add`/`commit`/`push` on this repo is pre-approved (Rule 12). Always ask first for
force push, branch deletes, `reset --hard`, or anything that might commit a secret.
Work that is committed but not **pushed** does not survive — verify the push.
