# Signal Log visual correction — 2026-10-18

The previous mobile preview did **not** carry over Ember's newer button finish.
It reused the artwork and static asset tokens, then added a tan selected state
and separate brown controls. That was an incomplete match.

## References inspected before editing

- Default `main` and `codex/ember-brass-pressure-alt` both resolved to
  `dc830451054cb8af5637332504f899fa2f5123ec`. The preserved
  `codex/ember-command-plate-light` remained at `108d444`; it does not contain the
  later `ALTERNATIVE_CSS` finish. No reference branch was modified.
- [`74c3ae3`](https://github.com/baxstarcode/baxstar-ember/commit/74c3ae3)
  introduced the Argon-inspired general controls. [`9096488`](https://github.com/baxstarcode/baxstar-ember/commit/9096488)
  added the separate v2 Foundry presentation. Both are included in current main.
- [Current general control styles](https://github.com/baxstarcode/baxstar-ember/blob/dc830451054cb8af5637332504f899fa2f5123ec/src/baxstar-ember.jsx#L1242)
  and [recorded design provenance](https://github.com/baxstarcode/baxstar-ember/blob/dc830451054cb8af5637332504f899fa2f5123ec/docs/ALTERNATIVE-PREVIEW.md#L40).
- Current OPS and Foundry were rendered locally at 1440×1000 and 390×844,
  device scale 3, with network/provider calls blocked. Their actual computed
  colors, gradients, borders and shadows were inspected, as were the screenshots.
  These are local canonical-source renders, not a signed-in production check.
- The later supplied Argon review rejects pastel coral and simplified artwork in
  favor of cast bronze, furnace orange, white lettering and textured assets.
  Its visual direction informed this scoped correction. Its unrelated proposed
  features and unverified behavior claims are not implementation authority.

Current main's Foundry still has a **different coral variant** at
[`FOUNDRY_CSS`](https://github.com/baxstarcode/baxstar-ember/blob/dc830451054cb8af5637332504f899fa2f5123ec/src/baxstar-ember.jsx#L5596).
Signal Log follows the later furnace direction and the existing general Ember
controls. It does not claim every Ember surface has one identical palette, and
does not recolor the shared Foundry.

## Concrete differences and corrections

| Element | Previous Signal Log | Corrected source / decision |
| --- | --- | --- |
| Neutral buttons | Flat `#19140f`, rim `#715537`, shallow shadow | Exact general Ember `#302821 → #1b1510 → #100c09` face and layered raised shadow with 3px bottom lip; Argon `#9e7339` perimeter. |
| Button contour | Generic 5px corners; some control types had inconsistent outlines | Argon action buttons: 1px solid perimeter and 6px corners. Primary focus buttons: 1px perimeter and 5px corners. Straight sides, inset top highlight, no pill/diagonal/hexagonal reconstruction. |
| Selected focus | Tan `#d0a46a → #9b703b`, near-black letters | Exact general Ember `#cf4814 → #ab3409 → #802304`, white letters, `#ff9b62` rim, dark bottom edge and state-linked orange glow. |
| Pressed controls | Background change only | Exact Ember sunk shadow and 3px `top` travel; no transform/filter on small text. Reduced motion removes travel. Disabled controls stay still and unlit. |
| Focus | Custom 3px pale-yellow ring | Exact Ember 2px `#ffce85` outline with 3px offset. |
| Lettering | Older static `#f3e9d8`, many unrelated tan shades | White primary lettering follows the later review; secondary `#eee2ce`, muted `#d2c4b0` and dim `#b4a28b` reuse current Ember overrides. |
| Surfaces | Several one-off brown fills | `#130f0a` obsidian follows the later review; panels reuse existing `--ember-panel` / `--ember-panel-alt`. Existing iron texture and reactor artwork remain unchanged. |
| Phone controls | Some 30–40px controls; smaller primary labels | All actionable buttons, select/input fields and checkbox label targets have a 44px minimum on phone/coarse-pointer layouts. Primary focus labels are 12px. |

The furnace faces, mechanical shadows and press behavior come from current
general Ember CSS at lines 1248–1299. The outline follows the inspected Argon
`.brass-action-btn` (6px / 1px brass-mid), `.btn-ember-primary` (5px / 1px), and
small-corner keycap family. The action outline is also present in the repository's
[`.fa-control` definition](https://github.com/baxstarcode/baxstar-ember/blob/dc830451054cb8af5637332504f899fa2f5123ec/src/baxstar-ember.jsx#L5604).
Brady explicitly selected Argon's outline in the current request; the exact
historical outline-comparison conversation was not recovered. No claim of a
recovered historical approval is needed or made. The recessed 7px outer / 5px
inner capsule is a distinct reference grouping; this page keeps its existing
three-button layout rather than adding another navigation container.

Combining the requested Argon contour with the later furnace direction is a
**scoped adaptation**. The white primary text, obsidian surface, brighter orange card
accent and larger phone targets are explicitly scoped interpretations of the
requested direction, not a claim that the root app already uses each one there.
The restrained green Good News label remains a semantic cue paired with text/icon;
it does not become a primary control color.

The supplied review suggested `translateY(3px)`. Current Ember deliberately uses
`top` and shadow instead to avoid transform-rasterized small text on iOS. That
existing implementation is retained. Furnace illumination follows the existing
`aria-pressed` selection; no fake loading state, decorative continuous pulse or
unrelated RUN/voice/skull behavior was added.

## Verification and limits

- The browser suite compares computed neutral/selected gradients, shadows and
  text shadows with the real `ALTERNATIVE_CSS`, and the action perimeter/radius
  with the Argon outline definition read from source in a test-only fixture.
  It checks the 5px primary contour and exercises focus, keyboard press,
  reduced motion and disabled controls.
- Responsive checks cover 1440×1000, 390×844, 375×812, 320×740 and 844×390 at
  scale 3, including clipped button labels, open filters/dialogs and 44px phone
  targets. The first signal retains at least 120px above the fold at 390×844.
- Contrast checks now read rendered colors and gradient stops rather than a
  stale hand-maintained color list. White on the selected furnace face is at
  least 4.5:1; the brighter orange accent is not used as a white-text fill.
- Existing import, triage, state, storage, backup, reader and keyboard behavior
  remains covered by the Signal Log suite. Application JavaScript is unchanged.
- Desktop and phone screenshots are synthetic demos. Chromium simulation is
  not physical iPhone/Safari verification or a complete accessibility audit.

[Updated desktop](desktop.jpg) · [Updated phone](phone.jpg) ·
[Local test log](local-tests.log)
