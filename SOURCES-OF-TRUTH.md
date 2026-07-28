# Ember — Sources of Truth & Build Provenance

Multiple AI tools are now touching this project. This document is the authority on
**which file is canonical for what**, and **who built which phase**, so no session or
tool has to guess.

---

## Provenance — who did what

- **Claude Code (Anthropic CLI)** started and carried this build. Working with Brady
  Baxter, it consolidated the app + deploy build + voice rig into this repo, then did
  the full **steampunk retheme** and **integrated the ChatGPT steampunk asset pack**
  to spec — iconography, typography, motion, palette, panels, brand marks, context
  levers, and the exact asset-pack control/motion mapping. It also fixed the top
  white-band bug and produced the local-preview harness. Span: **2026‑07‑26 → 2026‑07‑28**.
- **Checkpoint of that work:** commit **`1ac6be7`** on `main`
  (`baxstarcode/baxstar-ember`, private) — *"Checkpoint: working Ember + cinematic
  handoff."* Everything through this SHA is Claude Code's build, unmodified and working.
- **Hand-off to ChatGPT (2026‑07‑28):** the next phase — pushing the visuals to
  **photoreal, cinematic fidelity** (matching Brady's reference mockup) while keeping
  the app lightweight, functional, and in motion — was handed to **ChatGPT**. Claude
  Code paused visual-redesign work at the checkpoint above and produced the handoff so
  ChatGPT could continue from a known-good, fully-documented state. Full details:
  **`HANDOFF-CINEMATIC.md`**.
- **Higgsfield** is the intended image-generation tool for the cinematic raster assets
  (transparent-PNG components). **ChatGPT** owns the concept/reference; **Gemini** is
  not in the loop. See `HANDOFF-CINEMATIC.md` §6.

> If a later tool changes application logic, it must update this file and
> `HANDOFF-CINEMATIC.md` so provenance stays accurate.

---

## Canonical files — the source of truth for each concern

| Concern | Source of truth | Notes |
|---|---|---|
| **The application** (logic, behavior, and all CSS) | `src/baxstar-ember.jsx` | Single-file React, ~2,240 lines. **CSS is inline** — one `<style>{`…`}</style>` literal at ~line 1301. There is **no** separate `.css` file. |
| **Design constitution** (intent, quality bar, character) | `docs/BUILD-PROMPT.md` | The "why" behind the steampunk direction. |
| **Known blockers** | `docs/KNOWN-ISSUES.md` | `index.html` Tailwind + API-auth blockers; voice-merge gap. |
| **Steampunk asset spec** (authoritative for the skin) | `assets/ember/CLAUDE-HANDOFF.md`, `manifest.json`, `control-map.json`, `motion-spec.json`, `design-tokens.css` | Manifest = asset inventory; control-map = function mapping; motion-spec = timings. Mockups in `assets/ember/mockups/` are **intent references only**, never app backgrounds. |
| **Current state, must-not-change list, reproduce recipe** | `HANDOFF-CINEMATIC.md` | The living checkpoint doc. Start here to resume. |
| **Provenance & this file map** | `SOURCES-OF-TRUTH.md` (this file) | — |
| **Deployed/repo truth** | GitHub `baxstarcode/baxstar-ember` @ `main` | Private. Checkpoint SHA `1ac6be7`. |
| **Local run** | `_preview.html` via `./start-ember.sh` (or `python3 -m http.server 8787`) | Ephemeral; not a source of truth, a way to view one. |
| **Cinematic visual target** | Brady's ChatGPT reference mockup (`~/Downloads/ChatGPT Image Jul 27…png`) | The look to match; a flat painting, **not** a UI to embed. |

## Not sources of truth (do not build from these)

- `index.html` — trails `src/baxstar-ember.jsx` (stale skin) and is deploy-blocked.
- `voice/*.html` — separate, working voice rig; its brain is hardcoded, not Claude.
- Any `baxstar-ember-repo*.zip` in `~/Downloads` — pre-retheme snapshots.
- The tmp preview-harness scratch files — regenerated, never canonical.
