# Ember — Cinematic Handoff (checkpoint for ChatGPT)

This is a working-application checkpoint plus the tacit knowledge that is **not**
discoverable by reading the repo or a skills list. The visual redesign is paused
here on purpose. Nothing below has been simplified, reorganized, or redesigned.

---

## 1. Checkpoint facts (the "Give me:" list)

- **Repository URL:** `https://github.com/baxstarcode/baxstar-ember` (private).
  > The requested new repo `baxstar-ember-cinematic` could **not** be auto-created:
  > the `gh` CLI is not installed on this Mac and there is no API token available
  > to create a repo non-interactively. This checkpoint therefore lands on the
  > existing private repo, and a full source zip (`ember-current-source.zip`) is
  > provided as the sanctioned fallback. To also get the `baxstar-ember-cinematic`
  > repo: create it empty/private on GitHub and it can be pushed in one step.
- **Branch:** `main`
- **HEAD commit SHA:** the checkpoint commit titled *"Checkpoint: working Ember +
  cinematic handoff"* — value is reported in the delivery message and via
  `git -C ~/Desktop/baxstar-ember log -1 --format=%H`.
- **Exact command to start Ember:**
  ```bash
  cd ~/Desktop/baxstar-ember && python3 -m http.server 8787
  # then open http://localhost:8787/_preview.html
  # or simply: ./start-ember.sh
  ```
  Requirements: **python3 only**. There is no Node/npm on this machine and none is needed.
- **Main file locations:**
  | Purpose | Path |
  |---|---|
  | **Canonical app source** (single-file React) | `src/baxstar-ember.jsx` (~2,240 lines) |
  | **CSS** | there is **no separate .css file** — all styles are one inline `<style>{`…`}</style>` template literal **inside** `src/baxstar-ember.jsx`, starting at line ~1301 |
  | **Local preview harness** | `_preview.html` (generated; in-browser Babel transform of the JSX) |
  | **Standalone deploy build** | `index.html` (BLOCKED — see §4) |
  | **Voice rig** (separate, working) | `voice/ember-voice-deck.html`, `voice/ember-demo.html` |
  | **Integrated steampunk assets** | `assets/ember/**` (~1.1 MB) |
  | **Design constitution** | `docs/BUILD-PROMPT.md` |
  | **Known blockers** | `docs/KNOWN-ISSUES.md` |
  | **Launch script / env template** | `start-ember.sh`, `.env.example` |
- **Files modified during the steampunk redesign:** exactly **one source file —
  `src/baxstar-ember.jsx`** — plus the addition of `assets/ember/**`. Commit trail:
  - `cdefb3e` iconography (emoji → engraved-line EmberIcon set)
  - `84bccc0` typography (Big Shoulders → Cinzel)
  - `fe786eb` motion (comic BURST_WORDS → pressure-vent ring)
  - `7fc123e` palette (retire ember-ice/cold presets → brass/copper/gunmetal/candle)
  - `7bc400b` panels (bezels, rivets, etched hairlines)
  - `178d987` **add** ChatGPT steampunk asset pack under `assets/ember/`
  - `bc29a76` wire asset pack (BrandMark logos, Draft Reply / Create Task levers)
  - `db2a563` fix white band at top (paint dark base on html/body)
  - `d7717a1` apply exact asset-pack spec (panel `28 fill stretch`, skull placement,
    `toggle-track.svg` for VOICE, `pipe-junction`, codex-drum neighbors)

---

## 2. What currently works

- Both **OPS** and **BAXSTAR STUDIO** views render and switch.
- All **8 Studio tools** open their surfaces: Claude Chat, AI Handoff, Caption
  Studio, Google Drive, HTML Viewer, Image Filters, GitHub, Snippets.
- Model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.8) and Effort (Low/Std/High).
- **Live SYNC** with demo data; DEMO/LIVE indicator; clock.
- **BG picker** (Ember default, Dark Lake photo, Brass Lantern, Foundry Smoke, upload-your-own).
- **VOICE toggle** and **Voice Test** (mic rig lives in `voice/`, not yet merged into the app).
- Draft Reply / Create Task levers: select a Calls & Voicemail or Inbox item → levers
  arm → Draft Reply produces an **editable** draft (never auto-sends); Create Task
  produces an editable proposal that **requires confirmation** before saving.
- Steampunk skin: brass 9-slice panel frames, tool-module frames, codex-lock shells
  on model/effort/revenue, gauge on Schedule, mic-orb shell, glass tanks, skull arch,
  bronze Claude/Drive/GitHub marks, corner-gear BG badge, pipe-junction ornaments.
- Motion: codex-drum on model/effort, sync-gears on SYNC, gauge sweep, tank energy,
  tool-active glow, pressure-vent mic ring. `prefers-reduced-motion` honored.

## 3. What is incomplete or broken

- **Chat brain is dead outside a Claude artifact.** The app calls
  `https://api.anthropic.com/v1/messages` with no auth header (the artifact platform
  injects it). In `_preview.html` or any hosting, every chat / Drive / MCP call fails
  auth+CORS. UI is fully alive; responses are not. This is expected, not a bug.
- **Voice layer not merged.** `voice/*.html` is a separate, working codebase (Web
  Speech in, speechSynthesis out, mic meter). Its `emberReply()` is hardcoded string
  matching, not Claude. Merging it into `callClaude()` is the biggest open opportunity.
- **`index.html` deploy build is blocked** — see §4.
- **Cinematic gap (the current goal):** the shipped look is correct-but-flat because
  the pack assets are thin **vector** linework. The target (ChatGPT reference mockup)
  is photoreal **raster** metal. Closing this is the paused work — see §6.

## 3a. Known console / runtime errors

- In the **local preview / hosted** (no key): `fetch` to `api.anthropic.com` returns
  401/CORS on any Claude action. Silent to the user (caught → "Command failed").
- `window.storage` is a **Claude-artifact API**. Outside the artifact it's `undefined`;
  all persistence is wrapped in try/catch and no-ops, so **settings don't survive a
  reload in the local preview**. No thrown errors.
- With assets served from the repo root, **no other console errors**; both views mount
  clean (verified via headless Chrome render).

---

## 4. `index.html` deploy blockers (do not rediscover — from docs/KNOWN-ISSUES.md)

- **Blocker A — no Tailwind.** The JSX uses Tailwind utility classes throughout;
  `index.html` loads only React+ReactDOM+Babel from CDN. Hosted, colors survive but
  **layout collapses to a stacked column.** Fix: add Tailwind Play CDN, or compile the
  used utilities into the inline stylesheet.
- **Blocker B — no API auth.** As in §3. Fix: a thin server-side proxy holding the key.
  **Never ship a key in client code.**
- `index.html` is also **not re-synced** to the current steampunk skin — it still
  trails `src/baxstar-ember.jsx`. Any deploy must re-derive it from `src/` first.

---

## 5. MUST NOT CHANGE (preserve exactly)

These are load-bearing. The asset-pack handoff and BUILD-PROMPT both require them intact.

- **MCP / config block** — `src/baxstar-ember.jsx` lines ~21–26:
  - `MCP_SERVERS`: `quo` → `https://mcp.quo.com/mcp`; `gmail` →
    `https://gmailmcp.googleapis.com/mcp/v1`; `calendar` →
    `https://calendarmcp.googleapis.com/mcp/v1`
  - `DRIVE_SERVER`: `gdrive` → `https://drivemcp.googleapis.com/mcp/v1`
  - the `callClaude()` fetch to `https://api.anthropic.com/v1/messages` and its
    `mcp_servers` / `anthropic-beta` wiring.
- **Preset IDs (never rename/remove):**
  - Background presets: `default`, `darklake`, `glacier` (label "Brass Lantern"),
    `aurora` (label "Foundry Smoke"), `custom`. The **IDs are frozen** because saved
    user choices key off them; only labels were rethemed.
  - Model IDs: `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-8`
    (default `claude-sonnet-4-6`). Effort keys: `low`, `std`, `high`.
- **Persisted keys** (via `window.storage`): `ember-bg`, `ember-prefs`
  (`voiceOn, chatModel, chatEffort, lake, postWindow, coreMode, studioTool`),
  `ember-chat`, `ember-drive`. Don't rename keys or change their shapes.
- **System contexts:** `BRADY_CONTEXT` (business facts, Quo line numbers) and
  `DRIVE_CONTEXT`. Keep verbatim unless Brady changes the facts.
- **Handlers / connector logic / state shape / message routing / SYNC logic** — the
  redesign is skin-only. Do not rewrite logic while restyling.
- **The mic pressure-vent state machine and voice-rig scoring/MP3 fallback** — hard-won,
  keep exactly.
- **Cinzel** as the display face.

---

## 6. Cinematic target + the constraint (color-in for ChatGPT)

Goal: reach the fidelity of Brady's reference mockup (photoreal steampunk console —
machined tool controls, a central mechanical reactor/iris, split-flap revenue
odometer, brass lever pulls, corner gauges) **while staying lightweight and keeping
the app functional with realistic motion.**

Hard truths to design around:
- The reference is a **flat AI painting**, not a UI. The asset-pack spec explicitly
  forbids using either mockup as an app background ("intent references only").
- Photoreal + lightweight + functional resolves to exactly one approach: generate
  **transparent-PNG assets for the fixed, non-reflowing pieces** (the 6 console tools,
  the reactor, the odometer, corner gauges, lever housings, a richer frame) and keep
  **all live text / data / buttons as DOM layered on top.** No WebGL/canvas engine.
- A pixel-clone of a hand-painted frame is **not** attainable at "lightweight." The
  achievable bar: same machine, same components as photoreal rasters, same layout,
  fully functional, plus motion a static image can't have (iris pulse on mic level,
  needle sweeps, physical lever pulls, LED flicker, odometer roll on revenue change,
  gear spin on SYNC).
- **Weight budget:** the pack's `manifest.json` sets `rasterBudgetBytes` = 2,097,152
  (2 MB). Current `assets/ember` ≈ 1.1 MB. New photoreal rasters must fit the remaining
  headroom — enforce transparency + compression + a sprite sheet for the console rail.
- Asset production plan (paused, awaiting go): generate via **Higgsfield** image gen
  (transparent-PNG components, auto background-cut), then composite as positioned layers.
  ChatGPT and Gemini are **not** needed for assets — Higgsfield yields layered
  components; more flat paintings just create cutting work.

---

## 7. How to reproduce / verify (no Node on this machine)

`_preview.html` is generated by transforming `src/baxstar-ember.jsx` in the browser:
- swap `import { useState, useEffect, useRef } from "react"` → `const { … } = React`
- drop `export default`
- load React 18 UMD + ReactDOM UMD + **@babel/standalone pinned to @7** (unpinned now
  serves Babel 8, whose react preset emits `import`-based output that dies with
  "Cannot use import statement outside a module" and renders blank) + Tailwind Play CDN
- serve from the **repo root** so `assets/ember/**` resolve; open `/_preview.html`

The critical gotcha for anyone judging the look: **in a bare Claude artifact the
`assets/ember/*` files 404** (they're repo files, not bundled into the artifact), so
frames/skull/tanks/marks vanish and it looks flat. The correct experience is the
asset-served preview above, or a real deploy that ships the `assets/` folder.
