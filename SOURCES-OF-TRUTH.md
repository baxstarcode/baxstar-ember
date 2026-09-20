# Ember — Sources of Truth & Build Provenance

Multiple AI tools are now touching this project. This document is the authority on
**which file is canonical for what**, and **who built which phase**, so no session or
tool has to guess.

---

## STOP — read this before touching voice (updated 2026-09-20)

**Current voice policy: excellent desktop voice/chat are goals; reliable iPhone voice
is preferred if feasible.** Brady's direction in the 2026-09-20 Ember Rebuild 2026
coordination update supersedes the blanket no-voice ban. This existing Codex task owns
the complete rebuild; that chat coordinates and is not a second code/config writer.
Do not blindly restore the former stack. The next step is the isolated page at
`work/desktop-voice-probe/`: explicit Talk, editable transcript, explicit Send, and
optional explicit Play. Production integration remains blocked until Brady completes
five real desktop-Chrome turns and confirms microphone release, recognition, text,
audible neural playback, cancellation, and recovery.

The iPhone path requires its own opt-in reliability experiment: repeated turns,
interruptions, permission recovery, playback, and microphone handback on the actual
phone. Browser capabilities and platform limits must be verified, not inferred from
the prior implementation's failures. No phone integration is proven by desktop or mock
results. Wake words, background capture, and automatic restart are outside this lab.

The full historical implementation remains on `snapshot/voice-era-final`. The Worker
keeps its tested TTS implementation because the isolated lab uses it. Older voice-repair
notes are historical evidence, not permission to bypass the relevant physical gate.

Ember today: an operations dashboard (calls/voicemail, inbox, schedule, revenue), a
typed line to Claude, Caption Studio, Projects/Mission Control, and the YOUR TOOLS rail
of links to Brady's other properties.

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
  Worker — see `docs/DEPLOY.md` §4); descoped Quo based on its then-current OAuth
  behavior (`docs/KNOWN-ISSUES.md` §11); fixed the mic auto-start and added the
  30-min ear idle sleep; built the
  **PROJECTS** status view (session-maintained `PROJECTS` constant in src); set the
  chat default to **Opus 5 / High effort** with Sonnet 4.6 as error fallback and
  versioned `ember-prefs` (`v:2`); fixed the iOS model-picker blur (removed transform
  animations on the segs); compacted the mobile header + greeting to single rows.
  PRs #22–#32 on `baxstarcode/baxstar-ember`.

- **Codex, 2026‑08‑24:** picked up the live voice failure. Confirmed production
  `/tts` returned empty audio, updated the Worker to Microsoft's current Edge 143
  handshake, removed the app's robotic Brian fallback, repaired stale voice-choice
  recovery/picker visibility, and made service-worker navigations network-first.
  Re-opened Quo after its newly published custom-agent MCP support, added a
  privacy-safe connector credential status route, and reconciled the active docs.

- **Codex, 2026‑09‑20:** rebuilt Ember as a desktop-first daily dashboard. Restored
  readable, persisted streaming chat with stop/retry/copy/clear and honest connector
  failures; made communication-to-task actions reviewable local Mission Control drafts;
  repaired the desktop/laptop/phone layout and truth states; hardened the Worker to
  server-owned read-only toolsets and least-privilege future consent; added an
  Access-protected same-origin Pages gateway; moved the Drive-outbox capability out of
  the browser and behind its validated server relay; and built the isolated desktop
  voice feasibility probe. Automated voice checks do not supersede Brady's physical
  Mac gate.

> If a later tool changes application logic, it must update this file and
> `HANDOFF-CINEMATIC.md` so provenance stays accurate.

---

## Canonical files — the source of truth for each concern

| Concern | Source of truth | Notes |
|---|---|---|
| **The application** (logic, behavior, and all CSS) | `src/baxstar-ember.jsx` | Single-file React. **CSS is inline** in the component; there is no separate application stylesheet. |
| **Design constitution** (intent, quality bar, character) | `docs/BUILD-PROMPT.md` | The "why" behind the steampunk direction. |
| **Known blockers & descopes** | `docs/KNOWN-ISSUES.md` | Living current ledger. Git history preserves the older issue chronology. |
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
- Historical `voice/*.html` rigs and voice-era branches — diagnostic history, not the
  current production surface. The active feasibility artifact is
  `work/desktop-voice-probe/`.
- Any `baxstar-ember-repo*.zip` in `~/Downloads` — pre-retheme snapshots.
- The tmp preview-harness scratch files — regenerated, never canonical.
