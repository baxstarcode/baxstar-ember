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

- **Claude Code, 2026‑07‑28 (after the checkpoint):** landed the cinematic v2 source into
  git from `embercinematicrebuildv2.zip`, then built the plumbing that stops generated
  files drifting again — `build.mjs` for `index.html`, split ownership with
  `scripts/sync-standalone.py` for `_preview.html`, compiled Tailwind inline (Blocker A
  closed), and a key-holding API proxy under `proxy/` (Blocker B ready to deploy). Also
  fixed three defects in the v2 source: the command dock was buried under duplicate CSS
  chrome, the Draft Reply / Create Task levers collided with the greeting via a CSS
  specificity bug, and dock motion was restored as additive light rather than duplicated
  geometry. On branch `claude/baxstar-emper-repository-7rikvg`, PR #1.

- **Claude Code, 2026‑08‑19 → 2026‑08‑23:** connector + product phase. Deployed and
  verified the live connector stack (Google Workspace MCP, refresh-token minting in the
  Worker — see `docs/DEPLOY.md` §4); **descoped Quo permanently** (`docs/KNOWN-ISSUES.md`
  §11); fixed the mic auto-start and added the 30-min ear idle sleep; built the
  **PROJECTS** status view (session-maintained `PROJECTS` constant in src); set the
  chat default to **Opus 5 / High effort** with Sonnet 4.6 as error fallback and
  versioned `ember-prefs` (`v:2`); fixed the iOS model-picker blur (removed transform
  animations on the segs); compacted the mobile header + greeting to single rows.
  PRs #22–#32 on `baxstarcode/baxstar-ember`.

> If a later tool changes application logic, it must update this file and
> `HANDOFF-CINEMATIC.md` so provenance stays accurate.

---

## Canonical files — the source of truth for each concern

| Concern | Source of truth | Notes |
|---|---|---|
| **The application** (logic, behavior, and all CSS) | `src/baxstar-ember.jsx` | Single-file React, ~2,240 lines. **CSS is inline** — one `<style>{`…`}</style>` literal at ~line 1301. There is **no** separate `.css` file. |
| **Design constitution** (intent, quality bar, character) | `docs/BUILD-PROMPT.md` | The "why" behind the steampunk direction. |
| **Known blockers & descopes** | `docs/KNOWN-ISSUES.md` | Living ledger, 12 entries. The original Tailwind/API-auth blockers are closed; §11 (Quo descope) and §12 (iOS picker blur pattern) are the ones later tools trip over. |
| **Steampunk asset spec** (authoritative for the skin) | `assets/ember/CLAUDE-HANDOFF.md`, `manifest.json`, `control-map.json`, `motion-spec.json`, `design-tokens.css` | Manifest = asset inventory; control-map = function mapping; motion-spec = timings. Mockups in `assets/ember/mockups/` are **intent references only**, never app backgrounds. |
| **Current state, must-not-change list, reproduce recipe** | `HANDOFF-CINEMATIC.md` | The living checkpoint doc. Start here to resume. |
| **Provenance & this file map** | `SOURCES-OF-TRUTH.md` (this file) | — |
| **Deployed/repo truth** | GitHub `baxstarcode/baxstar-ember` @ `main` | Private. Checkpoint SHA `1ac6be7`. |
| **Local run** | `_preview.html` via `./start-ember.sh` | Generated + gitignored. `start-ember.sh` regenerates it before serving, so it cannot go stale. Ephemeral; not a source of truth, a way to view one. |
| **Deploy build** | `index.html` via `npm run build` (`build.mjs`) | Generated. Compiled inline Tailwind, production React. **Exactly one generator writes it** — that rule is what stopped it drifting a whole redesign behind `src/`. |
| **Cinematic visual target** | Brady's ChatGPT reference mockup (`~/Downloads/ChatGPT Image Jul 27…png`) | The look to match; a flat painting, **not** a UI to embed. |

## Not sources of truth (do not build from these)

- `index.html` — **generated** from `src/baxstar-ember.jsx` by `build.mjs`. Never edit it
  by hand and never build from it; it is an output. It is no longer stale (the generator
  guarantees that) and the Tailwind blocker is fixed, but hosting it still needs the API
  proxy deployed.
- `_preview.html` — **generated** by `scripts/sync-standalone.py`, and gitignored. The
  copy that was briefly committed on `main` was already stale.
- `voice/*.html` — separate voice rig. Its brain is no longer hardcoded: spoken questions
  route through Claude via the same proxy, falling back to the canned demo answers when no
  proxy is configured or the call fails.
- Any `baxstar-ember-repo*.zip` in `~/Downloads` — pre-retheme snapshots.
- The tmp preview-harness scratch files — regenerated, never canonical.
