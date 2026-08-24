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
- **Original Claude redesign:** exactly **one source file —
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
- **Cinematic continuation:** `src/baxstar-ember.jsx`, the synchronized
  `_preview.html`/`index.html`, two compressed raster assets, the asset manifest,
  control map, motion spec, README, and handoff/known-issues documentation.

---

## 2. What currently works

- Both **OPS** and **BAXSTAR STUDIO** views render and switch.
- All **8 Studio tools** open their surfaces: Claude Chat, AI Handoff, Caption
  Studio, Google Drive, HTML Viewer, Image Filters, GitHub, Snippets.
- Model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.8 / Opus 5 / Fable 5) and Effort (Low/Std/High).
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
- **`index.html` can render the complete layout**, but live Claude/MCP actions remain
  blocked outside a Claude artifact until a server-side API proxy is added — see §4.
- **Target-device visual QA remains:** confirm proportions at the normal 16-inch Mac
  display setting and Chrome 90%. The cinematic raster/DOM hybrid is implemented — see §6.

## 3a. Known console / runtime errors

- In the **local preview / hosted** (no key): `fetch` to `api.anthropic.com` returns
  401/CORS on any Claude action. Silent to the user (caught → "Command failed").
- `window.storage` is a **Claude-artifact API**. Outside the artifact it's `undefined`;
  all persistence is wrapped in try/catch and no-ops, so **settings don't survive a
  reload in the local preview**. No thrown errors.
- With assets served from the repo root, **no other console errors**; both views mount
  clean (verified via headless Chrome render).

---

## 4. `index.html` deployment status

- **Layout blocker resolved, and the two builds now have separate generators.**
  `_preview.html` comes from `python3 scripts/sync-standalone.py` (Tailwind Play CDN,
  React dev builds — right for local iteration). `index.html` comes from `npm run build`
  (`build.mjs`), which compiles only the utilities the source actually uses and inlines
  them — no runtime CSS CDN, no FOUC. **Nothing else may write `index.html`;** two
  generators for one file is how it drifted a whole redesign behind `src/`.
- **Remaining blocker — no API auth.** As in §3. The proxy is now written and wired:
  `proxy/cloudflare-worker.js` and `proxy/vercel/api/claude.js` hold the key server-side,
  with an origin allowlist enforced server-side as well as by CORS, a model allowlist, a
  token cap, and the `anthropic-beta: mcp-client-2025-04-04` header `mcp_servers` needs.
  Point the app at it with `window.EMBER_API_PROXY`. **It still has to be deployed** — see
  `docs/DEPLOY.md`. Note that even deployed, the MCP connectors need per-connector OAuth
  tokens the artifact platform currently supplies, so hosted chat works while the
  phone/email/calendar panels do not.
  **Never ship a key in client code.**
- For a hardened production build, compile the used utilities instead of relying
  on the Tailwind CDN.

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
  - Existing model IDs remain frozen: `claude-haiku-4-5`, `claude-sonnet-4-6`,
    `claude-opus-4-8`. Added models: `claude-opus-5`, `claude-fable-5`.
    Default is `claude-opus-5` on High effort; Sonnet 4.6 is the error fallback.
    Effort keys: `low`, `std`, `high`.
- **Persisted keys** (via `window.storage`): `ember-bg`, `ember-prefs`
  (`voiceOn, voiceChoice, chatModel, chatEffort, lake, postWindow, coreMode, studioTool`),
  `ember-chat`, `ember-drive`. Don't rename keys or change their shapes.
- **System contexts:** `BRADY_CONTEXT` (business facts, Quo line numbers) and
  `DRIVE_CONTEXT`. Keep verbatim unless Brady changes the facts.
- **Handlers / connector logic / state shape / message routing / SYNC logic** — the
  redesign is skin-only. Do not rewrite logic while restyling.
- **The mic pressure-vent state machine and standalone voice-rig fallback** are
  hard-won. The production app deliberately has no Brian MP3 fallback; its order is
  Worker neural voice → scored device voice → bridge.
- **Cinzel** as the display face.

---

## 6. Cinematic implementation

Goal: reach the fidelity of Brady's reference mockup (photoreal steampunk console —
machined tool controls, a central mechanical reactor/iris, split-flap revenue
odometer, brass lever pulls, corner gauges) **while staying lightweight and keeping
the app functional with realistic motion.**

Implementation rules:
- The reference is a **flat AI painting**, not a UI. The asset-pack spec explicitly
  forbids using either mockup as an app background ("intent references only").
- Photoreal + lightweight + functional resolves to exactly one approach: generate
  **transparent-PNG assets for the fixed, non-reflowing pieces** (the 6 console tools,
  the reactor, the odometer, corner gauges, lever housings, a richer frame) and keep
  **all live text / data / buttons as DOM layered on top.** No WebGL/canvas engine.
- The center now uses `raster/reactor-bezel@2x.webp` as a 127 KB photoreal shell.
  The existing mic orb, pressure vent, hit target, and two rotating DOM rings remain
  separate interactive layers inside its opening.
- The bottom rail now uses six independently sized DOM control housings. Each owns
  its live hit target, label, and CSS mechanism (lever, paired gears, reactor,
  gauge, compass, or piston). `raster/command-console@2x.webp` is retained only as
  a low-opacity metal texture with `object-fit: cover`; it is never stretched.
- The center chamber has no internal scrollbar. Reactor sizing is capped against
  viewport height so its mode controls, Voice Test, and command input remain in
  the same scene.
- Today's Revenue now uses live DOM split-flap cells. The number remains selectable
  and updateable; it is not painted into an image.
- The scene shell now fills the viewport instead of stopping at `max-w-7xl`, reserves
  a fixed in-scene console region, and scrolls content inside panels rather than
  turning OPS and Studio into one tall page.
- **Weight budget:** the pack's `manifest.json` sets `rasterBudgetBytes` = 2,097,152
  (2 MB). Current `assets/ember` ≈ 1.1 MB. New photoreal rasters must fit the remaining
  headroom — enforce transparency + compression + a sprite sheet for the console rail.
- Asset production does not require Higgsfield. The two photoreal modules were
  generated as isolated chroma-key components, alpha-extracted locally, resized,
  and compressed to WebP. Continue with the same modular process only when a new
  raster materially improves depth; keep labels, values, states, and moving parts
  in DOM/CSS/SVG.

Current implementation raster total is 1,249,589 bytes, below the 2 MB budget.

---

## 7. Active checkpoint — 2026-08-24

- Production voice failure was isolated to the Worker's obsolete Edge Read Aloud
  handshake: live `POST /tts` returned 502 with no audio.
- Source now follows the working Edge 143 protocol (MUID cookie, JavaScript-style UTC
  timestamps, separate connection/request IDs). Worker suite: 55/55.
- App recovery changes: stale stored voice names reset to Automatic, the selector is
  visible/wrapping on mobile, HEAR IT and per-answer playback keep voice mode on, and
  the robotic Brian network fallback is removed. The first pointer gesture anywhere
  in Ember now primes the reusable neural `<audio>` element, so a normal typed RUN is
  allowed to speak on iOS instead of requiring HEAR IT first.
- Browser regression: `npm run test:voice` passes desktop + iPhone-sized scenarios for
  picker visibility, stale-choice recovery, no mobile overflow, automatic reply TTS,
  sticky HEAR IT state, and the iOS gesture-blessing rule (2/2).
- `sw.js` v3 serves navigations network-first so a phone does not launch the
  pre-picker cached shell after a deploy.
- Quo's former descope is obsolete. Its new official custom-agent endpoint is
  `https://mcp.quo.com/mcp`; dynamic registration accepts Ember's Worker callback.
  User consent plus `MCP_REFRESH_QUO` / `QUO_CLIENT_ID` Worker secrets remain.
- Google Calendar/Gmail production MCP handshake returned 200 without reading any
  private data. The new `POST /connectors/status` route gives a data-free credential
  check once the Worker is deployed.

Deployment order: push/rebuild Pages, deploy `proxy/cloudflare-worker.js`, complete
Quo consent/secrets, run `/connectors/status`, then do iPhone + Mac spoken-reply tests.

---

## 8. How to reproduce / verify (no Node on this machine)

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
