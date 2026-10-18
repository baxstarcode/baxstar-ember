# Ember — Sources of Truth & Build Provenance

**2026-10-18, isolated Signal Log:** `codex/ember-signal-log` starts from freshly
verified `main` at `dc830451054cb8af5637332504f899fa2f5123ec`. The additive
`signal-log/` page owns its HTML/CSS/modules and import contract; see
[`signal-log/README.md`](signal-log/README.md). It reuses Ember assets/tokens,
adds local ranking/filter/state/import behavior, and is not a live connector feed.
Existing application, Worker, OAuth, gateway, voice, and dock remain untouched.
Tests run locally; no deployment, merge, automation change, or Actions run is part
of this delivery. Registry/Drive write-back remains with the authorized parent.

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

The deployed isolated lab has completed signed-in streamed text and a neural-audio
browser `playing`/`ended` cycle through the released same-origin boundary. That is
production-path evidence, not proof of physical audibility, voice quality, microphone
capture/release, or repeated-device reliability.

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

- **Codex, 2026-10-17 UTC — graph navigation cleanup:** after reviewing the styled
  preview, Brady requested removal of the Source map tab. Its iframe and unused
  source URL/styles are removed from the application; the original graph URL is
  preserved in `docs/ALTERNATIVE-PREVIEW.md`. Foundry and The Works remain, and the
  pinned dock and original version are preserved.

- **Codex, 2026-10-17 UTC — complete Argon graph integration:** Brady supplied a
  second `Pasted text.txt`, **Universal Responsive Modal v2** (47,783 bytes; SHA-256
  `f7c486e6f4af38d48839e83531bca63e390d7705e970d4071c91b2e6390d2420`).
  Its exact node positions, coral/brass palette, node faces, rings, glass filters,
  particles, and phone drawer supersede the earlier alternative's graph appearance.
  Codex integrated these in canonical React, repaired responsive header/gesture
  behavior, and retained known source links and neutral reference descriptions.
  Application source outside the graph section, including the pinned dock/skull,
  remains byte-for-byte unchanged from the previous alternative. The booking app
  and production deployment are untouched. Focused verification: 285/285 checks;
  `docs/ALTERNATIVE-PREVIEW.md` owns publication and remaining limitations.

- **Codex, 2026-10-17 UTC — requested alternative:** created
  `codex/ember-brass-pressure-alt` from `108d444`, preserving the original branch.
  Brady supplied Argon's HTML as `Pasted text.txt` (83,262 bytes; SHA-256
  `808b9abe1b68cbf18fdf3ed19bda5c871553fe1bf2b84d8e41895c07dfe40c32`).
  Its brass controls and orbital graph informed the alternative. Codex completed
  the truncated graph behavior in React, retained the existing dock/skull, brightened
  text, and added tactile controls. Prototype sync/task assertions were not imported.
  The 20-node graph's structure comes from the supplied reference; its descriptive
  copy was qualified to avoid invented live-system claims. The original source map
  remains linked. The isolated voice lab gains adjustable pause/manual finish,
  explicit transcript copy, and honest preview limits. No booking-app code, production
  Worker, or credential was changed. Verification/deployment: `docs/ALTERNATIVE-PREVIEW.md`.

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

- **Codex release, 2026‑09‑20:** PR #43 merged to `main` at
  `add4a8c28c17f70b3463d5ad786833f5e5a7880a`; release commit
  `063237de6bfc45eb562eb9dbd82a9eb8b651a6f8` shipped through Pages deployment
  `1f56234b-f359-43f2-ba38-c839d2e6b415` and Worker version
  `ac3b4578-5a04-4abf-9286-8e95663517d5`. Access, the binding, public-host gate,
  OAuth start, signed-in streamed text, ordinary chat, live OPS sync, and browser TTS
  events were verified. Data-free connector status, a controlled outbox write, and
  physical voice behavior remain open.

- **Claude Code, 2026‑09‑21 — dock motion restored:** the three animations the dock lost
  on 2026-08-01 are back on the six `.dock-art` tiles: the Caption Studio gear turns, its
  linkage lever throws on press, and the reactor core breathes. They were not rebuilt from
  the retired `DockMotion` layer — that layer was pinned to the stretched full-bar mounting
  and died with it in `f278227`; `615c7c0` restored the art without it. This pass keys the
  motion to the tile geometry instead, so it needs no `--dock-squash` observer and no JS
  measurement at all. Regions were measured off the asset's pixels, not estimated. The
  governing rule — **no second outline of a painted mechanism** — is recorded in `CLAUDE.md`
  under Design law and is enforced by containment proof: outside each moving part's mask,
  consecutive frames are pixel-identical.

- **Claude Code, 2026‑10‑15 — Ember improvement pass (Brady's handoff of that date):**
  OPS fits one desktop screen (YOUR TOOLS no longer hides under the dock); chat text
  1pt smaller, composer capped at 192px, Model + Effort on one row; models are the
  newest per family (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1) with Low/Med/High/Xtra
  effort always sent, a served-model stamp on every reply and visible refusals; brass
  push-plates replace the levers; dock reorganised (Knowledge Graph overlay embedding the
  Knowledge Foundry + THE WORKS, Google Drive plate, FareHarbor wheel); OPS sync is per
  feed with per-connector header lights; the Worker allows the new models, `xhigh` and a
  16000 token ceiling, and can keep rotated refresh tokens (optional `EMBER_TOKENS` KV).
  Live state that prompted it, Brady's signed-in check 2026-10-15: gmail, calendar, gdrive
  connected, quo offline; Google's AI-agent client setting already on. Brady's handoff
  assigned this pass to Claude; Codex's PR #48 (iPhone Shortcut) is untouched.

> If a later tool changes application logic, it must update this file and
> `HANDOFF-CINEMATIC.md` so provenance stays accurate.

- **Codex, 2026-10-16 — local review and command-plate detail:** reviewed PR #49
  at `af8d6ba`, reproduced the token-store fallback and partial-sync wording defects
  recorded in `docs/KNOWN-ISSUES.md`, and added a restrained material interaction to
  the two existing command plates. Engraved serials, asymmetric corners, pointer-lit
  brass, and an ignition hairline preserve the controls' geometry and original
  prompts. Keyboard focus receives equivalent illumination; touch does not track,
  reduced-motion mode remains static, and serials hide in the compact chat layout.
  Research: [Codrops Magnetic Buttons](https://github.com/codrops/MagneticButtons)
  for expressive interaction, adapted without moving hit targets or adding a library;
  [W3C Media Queries 5](https://drafts.csswg.org/mediaqueries-5/#prefers-reduced-motion)
  for reduced-motion behavior. Implementation is original; no demo code/assets copied.
  Branch: `codex/ember-command-plate-light`. Local build, 26 chat regressions, 87
  layout/truth checks, and 17 focused interaction checks passed. Production deployment
  was not checked: the environment proxy refused the production hostname. Drive,
  Registry, and Relay were unavailable in this session and were not updated.

- **Codex, 2026-10-16 — reliability continuation:** preserved cached access tokens
  across KV read failures, retained rotated tokens after failed saves, retried
  persistence, rejected unreadable/malformed cold storage, and serialized refreshes
  and re-consent within a Worker isolate. The partial-sync error now describes which
  feeds updated, stayed cached, or remain demo; failed refreshes also change LIVE
  indicators to STALE. Added discriminating Worker and desktop/phone browser
  regressions. Cloudflare KV remains eventually consistent across isolates; stronger
  coordination and authenticated deployment verification are still open. No production
  configuration, connector permissions, or model choices changed.

- **Codex, 2026-10-16 — authorized overnight continuation:** added a SQLite Durable
  Object per OAuth grant, shared by separate Worker instances and Google's 3 connectors.
  Refresh intent and replacement state are persisted to prevent replay after an
  ambiguous provider outcome or restart. Fresh-consent seed secrets separate the
  coordinated path from uncertain legacy/KV state; missing coordinator configuration
  cannot activate legacy refresh. Added 23 unit/failure and actual workerd/SQLite tests,
  a pinned development-only Miniflare dependency, and the binding/migration config.
  Wrangler dry-run accepted the config. All browser harnesses accept `CHROME_PATH`;
  updated command-plate assertions distinguish decorative serials from command labels.
  The full release command passed 742 checks across all 14 suites using system Chromium.
  See `docs/DEPLOY.md` for platform sources, consent cutover, and rollback restrictions.
  No production deploy, consent, namespace provisioning, or external write occurred;
  Cloudflare/live-browser/Drive/Ask Jev capabilities are still unavailable here.

- **Codex, 2026-10-16 — connection recovery guidance:** added a fixed status-reason
  vocabulary and readable OPS guidance for setup, sign-in, and temporary failures.
  Unknown error text is filtered at both the Worker and browser boundaries; status
  does not expose credentials or grant identities. Retained data stays visible, and
  healthy authorization/sync clears stale guidance. Added failure and desktop/phone
  regressions; screenshots were rendered at device scale factor 3. The combined full
  release rerun passed 754 checks across 14 suites, and Wrangler dry-run passed.

- **Codex, 2026-10-16 — local data preservation:** reproduced money-entry corruption
  and Mission Control's destructive mount save. Revenue now validates full dollar/
  cent amounts and preserves invalid drafts. Mission Control validates saved records,
  writes only after edits, keeps unsaved changes across tools, offers retry/download
  recovery, and requires explicit discard before loading a competing saved version.
  Both board and reviewed OPS task writes share a Web Lock; snapshot conflicts retain
  the losing draft. Existing keys, dollar/date shapes, and unknown metadata remain.
  Added offline browser regression coverage to the release command. These are local
  protections; no external task, database, or deployment action was performed.
  The full release command passed 771 checks across 15 suites, including 17 local
  preservation scenarios; desktop and phone screenshots were inspected. Production
  rollout still requires the existing Worker/model/fresh-consent gates.

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
| **Deployed/repo truth** | GitHub `baxstarcode/baxstar-ember` @ `main` | Private. Revival merge `add4a8c2`; release commit `063237d`. Historical checkpoint `1ac6be7`. |
| **Local run** | `_preview.html` via `./start-ember.sh` | Generated + gitignored. `start-ember.sh` regenerates it before serving, so it cannot go stale. Ephemeral; not a source of truth, a way to view one. |
| **Deploy build** | `index.html` via `npm run build` (`build.mjs`) | Generated. Compiled inline Tailwind, production React. **Exactly one generator writes it** — that rule is what stopped it drifting a whole redesign behind `src/`. |
| **Cinematic visual target** | Brady's ChatGPT reference mockup (`~/Downloads/ChatGPT Image Jul 27…png`) | The look to match; a flat painting, **not** a UI to embed. |

## Not sources of truth (do not build from these)

- `index.html` — **generated** from `src/baxstar-ember.jsx` by `build.mjs`. Never edit it
  by hand and never build from it; it is an output. It is no longer stale (the generator
  guarantees that) and the Tailwind blocker is fixed. Production serves it through the
  deployed Access-protected Pages gateway and Worker boundary in `docs/DEPLOY.md`.
- `_preview.html` — **generated** by `scripts/sync-standalone.py`, and gitignored. The
  copy that was briefly committed on `main` was already stale.
- Historical `voice/*.html` rigs and voice-era branches — diagnostic history, not the
  current production surface. The active feasibility artifact is
  `work/desktop-voice-probe/`.
- Any `baxstar-ember-repo*.zip` in `~/Downloads` — pre-retheme snapshots.
- The tmp preview-harness scratch files — regenerated, never canonical.

## Recorded voice continuation — 2026-10-17

`docs/VOICE-REBUILD.md` owns recovered voice provenance, Claude's relayed findings,
branch reconciliation, the new browser/Worker contract, physical iPhone/CarPlay gates,
and native-app decision. Source owners: `EmberVoice` in `src/baxstar-ember.jsx`,
`proxy/voice.mjs`, the existing Worker router and Pages gateway. This is a preview;
legacy `/api/tts`, production secrets and the booking app were not changed.
