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

Sponsor handles live in exactly one place — the `SPONSORS` map in `src/baxstar-ember.jsx` —
and are the canonical set shared with the standalone tool at
[baxstarcode/caption-studio](https://github.com/baxstarcode/caption-studio). **When either
side changes, check the other.** These two drifted once already, and the result was Ember
tagging `@vexusboats` when Brady's sponsor is `@therealvexusboats` — a different account,
notified on every sponsored post. Two front doors is deliberate (bookmarkable URL at the
lake vs. command center); the drift is the cost, so this is the first thing to check.

Other rules that are load-bearing, not stylistic:
- Hashtags are hard-capped at 5 **including** the locked `#getyourbassingear`.
- The auto-post caption omits `@handles` — they ride as on-photo Instagram tags, which is
  the version that actually notifies. Repeating them in the body double-tags.
- The lake travels as a **name**, never a location ID. An ID is what made the 2026-07-07
  publish attempt fail with "Location ID invalid".

## Design law

Steampunk is the identity; fishing and golf are engraving only. **Warmth only — no blues,
no purples in primary UI.**

The dock spec changed 2026-08-01 per Brady: `command-console@2x.webp` is **retired as the
dock**. Stretched to arbitrary bar sizes it read flat and distorted, and its painted
nameplates forced absolutely-positioned labels that drifted off-center on phones. The dock
is now a CSS-built brass bar, `position:fixed` to the bottom of the screen at every width,
with natively centered labels — do not bring the raster back as the bar. The asset stays
in `assets/ember/raster/` as reference art only.

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

## Git

Routine `add`/`commit`/`push` on this repo is pre-approved (Rule 12). Always ask first for
force push, branch deletes, `reset --hard`, or anything that might commit a secret.
Work that is committed but not **pushed** does not survive — verify the push.
