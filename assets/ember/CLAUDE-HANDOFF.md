# Ember steampunk redesign handoff

## Target

Integrate this visual system into the existing single approximately 2,200-line React JSX file styled with Tailwind utility classes and CSS variables. There is no build system and no bundler. The layout must continue to flex, reflow, and resize from live content.

The mockups are intent references only. Do not place either full-screen mockup behind the application. Use the modular SVG and transparent raster assets.

## Design decision

The accepted direction combines:

- restrained skeletal architecture from the original “Ossuary Engine” concept;
- the broad, calm, readable panel spacing of “Foundry Command”;
- cyan glass tanks, physical depth, reflective brass, and cinematic lighting from “Ember Depthworks”;
- brighter warm-ivory text and recognizable monochrome bronze Claude, Google Drive, and GitHub marks.

The final OPS reference adds two contextual controls: Draft Reply and Create Task.

## What survives unchanged

- All current functionality and event handlers.
- Every current preset ID and any code that depends on those IDs.
- The MCP/config block in its entirety.
- Existing connector behavior, data fetching, state shape, message routing, and sync logic.
- Existing responsive flex/grid behavior and panel reflow.
- Existing accessibility attributes, keyboard behavior, and focus order.
- The current pressure-vent mic animation and its state machine.
- Cinzel as the display/section-heading face.
- Current live text, counts, messages, dates, revenue values, model values, and effort values.

## What this redesign replaces

- Flat panel borders and generic background surfaces.
- Decorative icon treatments for the three branded Studio tools.
- Current visual shells for model/effort selectors, mode tabs, quick actions, mic orb, gauges, and toggles.
- Nonfunctional steampunk decoration that does not map to a control.

## Do not touch

- Do not rewrite application logic while applying the skin.
- Do not rename or remove preset IDs.
- Do not alter the MCP/config block.
- Do not convert live panels, text, values, or buttons into a flattened image.
- Do not add a build system, bundler, remote image dependency, animation GIF, canvas renderer, or WebGL dependency.
- Do not hard-code the mockup's pixel positions.
- Do not make Draft Reply send anything automatically.
- Do not save a Create Task result without user review/confirmation.

## Fonts

- Display and panel headings: Google Font `Cinzel`, weights `600`, `700`.
- All body copy, metadata, buttons, and controls: Google Font `Inter`, weights `400`, `500`, `600`, `700`.
- Exact type sizes, weights, line heights, spacing, and colors are in `design-tokens.css`.

## Responsive asset placement

### Panel frames

Use `svg/frames/panel-frame.svg` as a 9-slice border image with:

```css
border: 28px solid transparent;
border-image: url("./svg/frames/panel-frame.svg") 28 fill stretch;
```

Preserve the content box and existing layout. Never place ornaments behind text.

### Skull architecture

Use `raster/skull-arch@2x.png` only as a centered overlay attached to the central OPS chamber. Recommended exact placement:

- width: `clamp(420px, 52vw, 720px)`
- left: `50%`
- top: `0`
- transform: `translate(-50%, -34%)`
- opacity: `.80`
- hide below `980px`
- pointer events: `none`
- content layer must be above it

The skull is atmospheric structure, not a button.

### Glass tanks

Use one `raster/glass-tank@2x.png` at each far edge and mirror the right copy with `scaleX(-1)`.

- height: `clamp(360px, 58vh, 620px)`
- vertical center: `50%`
- edge inset: `8px`
- opacity: `.90`
- show only at viewport widths of `1180px` or greater
- pointer events: `none`

At narrower widths, remove the tanks completely rather than allowing them to cover content.

## Real control mapping

Use the exact existing control names below. Detailed state mapping is in `control-map.json`.

- OPS / Baxstar Studio tabs
- central mic orb
- Voice Test
- What'd I miss
- Triage inbox
- Brief my day
- Handoff draft
- Calls & Voicemail
- Inbox
- Schedule
- Today's Revenue
- Claude Chat
- AI Handoff
- Caption Studio
- Google Drive
- HTML Viewer
- Image Filters
- GitHub
- Snippets
- Haiku / Sonnet / Opus
- Low / Std / High
- SYNC
- VOICE ON
- BG picker
- Draft Reply
- Create Task

## Draft Reply and Create Task

These are contextual actions attached to the currently selected Calls & Voicemail or Inbox item.

### Draft Reply

- `idle`: no communication selected; disabled; use `action-lever-idle.svg`.
- `ready`: a supported communication is selected; use `action-lever-ready.svg`.
- `active`: generation is running; use `action-lever-active.svg`.
- `pending-review`: return the lever to ready and pulse its status point every `900ms`.
- Result: place an editable draft in the existing central work area.
- Never send automatically.

### Create Task

- `idle`: no source item selected; disabled; use `action-lever-idle.svg`.
- `ready`: a source item is selected; use `action-lever-ready.svg`.
- `active`: extraction/generation is running; use `action-lever-active.svg`.
- `pending-review`: return the lever to ready and pulse its status point every `900ms`.
- Result: show editable title, source, suggested due date, and task details.
- Require confirmation before saving.

Keep existing item-level Draft Reply and Task buttons. The two central levers are faster global actions on the selected item, not replacements for the precise item-level controls.

## Studio logos

Inside the current mechanical tool modules:

- Claude Chat: `svg/logos/claude-mark.svg`
- Google Drive: `svg/logos/google-drive-mark.svg`
- GitHub: `svg/logos/github-mark.svg`

Render each in `#B08D57` when inactive and `#D6B36A` when active. Keep the live HTML tool label beneath the mark. Do not rasterize or recolor them by editing the files; inline them or use them as masks/CSS-driven SVG.

## Motion

Implement motion in CSS/JS from `motion-spec.json`. Do not add GIFs. Honor `prefers-reduced-motion`.

Important defaults:

- lever transition: `220ms cubic-bezier(.2,.8,.2,1)`
- gauge sweep: `600ms cubic-bezier(.22,1,.36,1)`
- codex drum: `320ms cubic-bezier(.2,.8,.2,1)`
- tool selection: `140ms cubic-bezier(.2,.8,.2,1)`
- preserve existing mic pressure-vent timing

## Readability requirements

- Body text: minimum `14px / 21px`, weight `500`, color `#D8C9B5`.
- Primary text: `#F3E9D8`.
- Metadata: minimum `11px / 16px`, weight `600`, color `#B8A78F`.
- Panel headings: `13px / 18px`, weight `700`, tracking `.12em`.
- No texture, glare, skull, pipe, tank, gear, or shadow may sit behind text.
- Maintain a minimum contrast ratio of `4.5:1` for normal text.

## Integration order

1. Import or merge `design-tokens.css` variables into the existing root variables.
2. Apply the repeatable iron texture and scalable panel frames without changing layout.
3. Skin persistent header, mode tabs, quick actions, toggles, model/effort controls, and mic shell.
4. Add Studio tool frames and the three bronze company marks.
5. Add the responsive skull overlay and mirrored glass tanks.
6. Add contextual selection state and wire Draft Reply/Create Task to existing selected-item context.
7. Add motion from `motion-spec.json`.
8. Test all original functions, presets, MCP/config behavior, keyboard interactions, reduced motion, and responsive breakpoints.

## Required functional verification

Before declaring completion, verify:

- Both OPS and Baxstar Studio modes render and switch correctly.
- All eight Studio tools still open the correct surface.
- Model and effort values are unchanged.
- SYNC, VOICE ON, BG picker, Voice Test, and the central mic orb retain behavior.
- All four quick actions retain existing preset IDs and behavior.
- Calls & Voicemail, Inbox, Schedule, and Today's Revenue still reflow with real data.
- Draft Reply and Create Task remain disabled without a selected source item.
- Draft Reply generates an editable draft but does not send.
- Create Task requires confirmation before saving.
- No decorative asset blocks pointer events.
- The MCP/config block is byte-for-byte untouched.
- Raster implementation assets remain below the stated budget.

## Files

Use `manifest.json` as the authoritative asset inventory and `control-map.json` as the authoritative function mapping. See `docs/integration-snippets.md` for React/Tailwind examples.
