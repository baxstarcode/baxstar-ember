# Known Issues

Verified against the code in this repo. Fix these rather than rediscover them.

Last audited at commit `d7717a1` + this pass. Each item says how it was verified.

---

## ~~0. THE NEWEST DESIGN IS NOT IN THIS REPO~~ — RESOLVED

Brady supplied `embercinematicrebuildv2.zip` (`ember-current-source/`, source stamped
Jul 28 06:14). It is now merged and `src/baxstar-ember.jsx` is the cinematic v2 build.

**What landed:** the v2 source (+20KB over the old one), the two raster assets it needs —
`reactor-bezel@2x.webp` and `command-console@2x.webp` — updated `manifest.json`,
`control-map.json`, `motion-spec.json`, `docs/generated-assets.md`,
`docs/HANDOFF-CINEMATIC.md`, plus the python-only local harness (`start-ember.sh`,
`scripts/sync-standalone.py`, `.env.example`).

Only two new rasters were needed, not the eight estimated below — the whole bottom
console is one composite strip rather than six separate assets.

**Kept from this repo instead of the zip:** `voice/ember-demo.html` (the zip still had the
pre-Claude-brain version) and `README.md`. The proxy patch was re-applied to the new
source, and the proxy model allowlist was widened to all five models the v2 app offers
(Opus 5 and Fable 5 were added upstream).

**Verified:** rendered from `npm run build` in headless Chromium. Odometer, reactor bezel,
six-panel dock, brass frame, glass tanks and Cinzel all present. 240 class tokens, **0
unresolved**. No console errors, **no ≥400 responses**. Mobile 390px: zero overflow.
Studio module switches and renders.

The generator split that prevents this recurring is below in "Two generators, one file".

---

### Historical detail — what the gap looked like

**Verified:** against a screenshot of the newer build, dated Sun Jul 26 10:36 PM

(Written before the zip arrived.) A materially more advanced build of Ember existed
outside git and `src/baxstar-ember.jsx` was behind it. Anything generated from this repo renders the older look — correctly,
but it is not the current design.

**What the newer build has that this source does not:**

| Feature in the newer build | This repo |
|---|---|
| Full-page ornate brass frame, riveted, with pipework | thin SVG panel bezels only |
| Revenue as a mechanical odometer — `$ 0 1 , 2 4 0` in digit tiles | plain text `count="+$1,240"` (`src:1826`) |
| Ornate concentric core gauge (deep iris/mandala) | a single soft circular glow |
| Six sculpted instrument panels for the bottom nav — lever, gears, gauge, compass gauge, compass rose, cannon | text chips with a thin `quick-action-frame.svg` border |
| Analog clock faces in the lower corners | absent |
| "MIC ARMED" banner spanning the top | present in source but not styled as a banner |

**Hard evidence it isn't here:** `assets/ember/raster/` contains exactly two files —
`glass-tank@2x.png` and `skull-arch@2x.png`. The newer build needs roughly eight more
photoreal rasters. And the source has zero occurrences of `compass`, `cannon`,
`odometer`, `split-flap`, or `counter`.

**This cannot be rebuilt from a screenshot.** Reconstructing photoreal brass instruments
and an odometer from one JPEG would be guesswork that does not match.

**Root cause was version sprawl recurring.** Issue 5 in the old version of this file
claimed the repo had solved it ("eight copies across Downloads and chat artifacts…
this repo starts clean"). It hadn't — the best build was still living outside git. The
habit to fix is that work happens in an artifact or on the Mac and nothing commits it
back. Until a session ends with a commit, the repo is not the source of truth, and the
next session rediscovers the wrong design.

---

## Two generators, one file — fixed, don't reintroduce

`scripts/sync-standalone.py` (from the zip) wrote **both** `_preview.html` and
`index.html`. `build.mjs` also wrote `index.html`. Two generators for one artifact is
precisely the drift that caused issue 0 and the old issue 1.

Ownership is now split and each file says so in its own header:

| File | Owner | Toolchain | Tailwind | React |
|---|---|---|---|---|
| `_preview.html` | `scripts/sync-standalone.py` | python3 only | Play CDN | dev builds |
| `index.html` | `build.mjs` | node | compiled + inlined | production |

The python path is preserved deliberately: **there is no Node on Brady's Mac**, and
`./start-ember.sh` must keep working with python3 alone. It now regenerates the preview
before serving, so the preview can never be stale either. `_preview.html` is gitignored
since it's generated.

---

## RESOLVED THIS PASS

### ~~1. `index.html` has no Tailwind~~ — fixed

`npm run build` now compiles the utilities the source actually uses (~11KB) and inlines
them. No runtime CSS CDN, no flash of unstyled content.

**Verified:** headless Chromium render at 1440×900. A probe element with
`flex items-center gap-3 max-w-7xl text-[13px]` computes to `display:flex`, `gap:12px`,
`max-width:1280px`, `font-size:13px`. 22 of 22 flex rows lay out horizontally. Mobile at
390px wide has zero horizontal overflow. A class-coverage audit found 0 unresolved class
tokens out of 197 used.

### ~~5. `index.html` had silently drifted a full redesign behind `src/`~~ — fixed

This was the big one, and it was not in this file before. `index.html` was last written
by the Jul 26 consolidation commit and never regenerated after the six retheme commits
landed on `src/baxstar-ember.jsx`. The hosted build was still the **pre-steampunk** app:
`BURST_WORDS`, ZOWIE, emoji tool icons, Big Shoulders Display, `--ember-ice` ×10,
Glacier Lake, and zero references to `EmberIcon`, `BrandMark`, or the asset pack.

Root cause was that `index.html` was maintained by hand. `build.mjs` now generates it
from `src/baxstar-ember.jsx`, so the two cannot diverge again.

**Verified:** every retheme marker matches across both files. After the v2 merge that
reads `Cinzel` 3/3, `EmberIcon` 15/15, `BrandMark` 2/2, `reactor-bezel` 2/2,
`command-console` 1/1, comic markers 0/0.

**Rule going forward: never edit `index.html` by hand. Run `npm run build`.**

---

## OPEN

## ~~2. Hosted Ember has no API auth of its own~~ — RESOLVED, proxy is live

**Status:** deployed and verified against the live Worker.

`https://ember-claude-proxy.brady-9d1.workers.dev` is up on Cloudflare's free tier with
`ANTHROPIC_API_KEY` as a secret and `ALLOWED_ORIGINS` set to `http://localhost:8787`.
`scripts/sync-standalone.py` points the local preview at it, so `./start-ember.sh` now
gives Ember a working brain outside a Claude artifact for the first time.

**Verified against the deployment, not just the code:**

| Probe | Result |
|---|---|
| Browser `GET` | 405 `POST only` |
| `POST`, no `Origin` header | 403 `Origin not allowed` |
| `POST`, forged origin | 403 |
| Preflight, wrong origin | 403, no allow-header leaked |
| Preflight, allowed origin | 204, echoes origin, `Vary: Origin` |
| `gpt-4o` (off the allowlist) | 400 `Model not allowed` |
| `claude-haiku-4-5`, allowed origin | 200, real reply |

The origin check being enforced **server-side and not only via CORS** is the load-bearing
part: a leaked URL used from curl or a script still gets a 403, so the Anthropic balance
is not exposed. That is why the Worker URL is safe to keep in git.

**Before hosting Ember at a real domain:** change `ALLOWED_ORIGINS` to that origin and
redeploy, or every request from it will 403.

**Never ship an API key in client-side code.** Anything in `index.html` is public the
moment it's hosted — that constraint has not changed.

### Historical detail

**Severity was:** blocks deployment

The app used to hardcode `fetch("https://api.anthropic.com/v1/messages")` with no
credentials — fine inside a Claude artifact where the platform injects them, dead
anywhere else.

Now the endpoint is configurable:

```js
window.EMBER_API_PROXY = "https://…"   // set in index.html's config block
```

Unset, behavior is exactly as before (direct call, artifact-only). Set, traffic goes
through a key-holding proxy. `proxy/cloudflare-worker.js` and `proxy/vercel/api/claude.js`
are ready to deploy — origin allowlist, model allowlist, token cap, key server-side only.
A 401/403 without a proxy now returns an error that names the fix instead of failing silently.

**Remaining work:** actually deploy it and set `ALLOWED_ORIGINS`. See `docs/DEPLOY.md`.

**Never ship an API key in client-side code.** Anything in `index.html` is public the
moment it's hosted.

## 3. MCP connectors don't work outside a Claude artifact

**Severity:** blocks the OPS module when hosted
**Verified:** by inspection of the API contract
**New this pass** — previously hidden underneath issue 2.

Quo, Gmail, Calendar, and Drive are MCP connectors. Each needs an OAuth
`authorization_token` per server, which the Claude platform injects inside an artifact.
Hosted, nothing injects them, so those calls fail even with the proxy deployed and chat
working.

The proxy will attach tokens from `MCP_TOKEN_QUO` / `_GMAIL` / `_CALENDAR` / `_GDRIVE`
secrets once they exist. Obtaining them means running each connector's OAuth flow and
storing the result. That work is not done.

Hosted today: chat, Caption Studio, HTML Viewer, Image Filters, Snippets, AI Handoff,
and GitHub all work. "What'd I miss", Triage inbox, Schedule, and Drive Librarian do not.
See `docs/DEPLOY.md` §4.

## 4. Voice layer: real brain wired, app merge still open

**Severity:** feature gap
**Status:** half done

`voice/ember-demo.html` no longer answers only from hardcoded string matching. It now
routes spoken questions through Claude via the same proxy, with the real `BRADY_CONTEXT`,
the MCP server list, rolling conversation history, and a spoken-output ruleset (no
bullets, no URLs, numbers said the way a person says them). If no proxy is configured —
or the call fails — it falls back to the canned demo brain, so the offline
wife/investor demo still works exactly as before.

Also fixed while in there: Ember used to be able to hear itself talk. Recognition is now
aborted while speaking and restarted after, mirroring the guard the app's own mic bridge
already used.

**Still open:** `voice/` and `src/` remain two codebases. The voice rig duplicates the
context and model config instead of importing the app's. Truly merging them — one
Ember, one brain, voice as a surface of the app rather than a sibling page — is the
remaining work, and it's still the biggest open opportunity.

**Not verified end to end:** the real-brain path needs a deployed proxy and a
microphone. Neither exists in CI. The canned path and the syntax are verified; the
live path is written but untested.

## ~~5. The dock console was hidden behind duplicate CSS chrome~~ — FIXED

`command-console@2x.webp` is a 1600×322 photoreal brass console: six panels, each with a
brass mechanism and an empty engraved nameplate for its label. It **is** the dock.

The v2 CSS treated it as a faint texture — `opacity:.24; mix-blend-mode:luminosity` — and
synthesised a second set of panels (`.dock-control` borders and gradients) plus line-art
mechanisms (`.dock-machine`) on top. Worse, `object-fit:cover` on a bar this wide cropped
the artwork vertically and took the nameplates with it.

Fixed by letting the asset be the dock: full opacity, `object-fit:fill` so the whole
console is visible, no synthetic panel chrome, `.dock-machine` hidden (it duplicated the
painted mechanisms), and labels repositioned onto the nameplates at 64–86% of panel height.
The grid gets a 6.25% side inset so each column lands on one painted panel — the asset's
panels run x 100–1500 of 1600.

**Verified:** element screenshot of `.console-dock` — six photoreal panels, all six labels
seated on their nameplates, alignment correct at 1427px wide.

### Motion restored — as light, not geometry

The CSS mechanisms were animated, and hiding them cost that motion. It is back, via a
`DockMotion` layer (`.dock-motion` / `.dm-*`) that replaces `DockMechanism` entirely.

The rule it follows: **animate light, never geometry.** Every part is a glint, glow or
travelling sheen composited with `mix-blend-mode:screen`, so it can only brighten the
artwork — it cannot occlude or duplicate it. That constraint is not stylistic. The gears
already have painted teeth and the gauge already has a painted needle, so any synthetic
shape laid on top reads as a duplicate, which is what the old layer did.

| Panel | Painted part | Motion |
|---|---|---|
| OPS | lever press, two lamps | lamps breathe; highlight strokes the drum |
| Baxstar Studio | gear train | glint orbits each gear, middle one counter-rotating |
| What'd I miss | reactor porthole | core pulses, slow ring sweep |
| Triage inbox | pressure gauge | broad illuminated wash rides the dial |
| Brief my day | ship's wheel | slow glint around the rim |
| Handoff draft | piston cannon | lamp breathes; sheen strokes barrel, then cylinder |

Two details worth keeping in mind if this is touched again:

- **The painted circles are ellipses on screen.** `object-fit:fill` stretches a 1600×322
  asset into roughly 1285×137, so a painted circle renders about 2:1 wide. Round glints
  therefore sit in a `.dm-round` wrapper carrying `scaleY(var(--dock-squash))`, which a
  `ResizeObserver` on the dock measures live — `(h/322)/(w/1600)`. The child stays a true
  circle so it can rotate cleanly. Without this the glints were twice as tall as their
  mechanism and crept onto the nameplates. Values >1 are legitimate: on a narrow dock the
  asset is stretched taller than its own aspect.
- **The gauge wash is deliberately broad and low-alpha.** A narrow wedge reads as a second
  needle beside the painted one.

Glints are masked to each mechanism's rim (`mask-image: radial-gradient(...)`) because an
unmasked conic gradient reads as a pie wedge rather than a turning part.

**Verified** headless at 1440×900: 13 motion parts, all `mix-blend-mode:screen` and
`pointer-events:none`; zero elements from the old duplicate layer remain; a 750ms frame
diff over the dock region changes ~306KB, confirming it animates. Label geometry is
byte-identical to before the change — `top:64%`, `height:22%`, horizontally centred, on
all six. The lowest-reaching motion part bottoms out at **57%** of the cell against a
nameplate starting at 64%, and holds at 57% across 1920 / 1440 / 1024 / 390px because the
squash tracks the measured value exactly (0.3934 / 0.5292 / 0.7655 / 1.8777). No console
errors, no HTTP ≥400, no mobile overflow. `prefers-reduced-motion` is already honoured
globally, so these animations disable with everything else.

## ~~6. Draft Reply / Create Task levers collided with the greeting~~ — FIXED

A CSS specificity bug, not a layout one:

- `.skull-host > :not(.skull-arch)` → `position:relative`, specificity **(0,2,0)**
- `.ctx-lever` → `position:absolute`, specificity **(0,1,0)**

The broader rule won, so both levers lost absolute positioning, fell into the flex column,
and landed on top of "Morning, Brady." — visible in Brady's own reference screenshot too.

The `skull-host` rule only needs `position` so its `z-index:1` works, and `.ctx-lever`
already carries `z-index:4`, so excluding it is the correct fix:
`.skull-host > :not(.skull-arch):not(.ctx-lever)`.

**Verified:** both levers compute `position:absolute` at x=494 and x=870, flanking the
reactor, with `collidesWithGreeting: false`. VOICE TEST is no longer clipped either.

## ~~7. Blue glass tanks contradict the palette rule~~ — FIXED

`BUILD-PROMPT.md` §3 is explicit: "No blues, no purples for primary UI… Warmth only."
`--ember-ice` had been retired from the CSS, but `glass-tank@2x.png` is painted cyan and
renders full-height down **both** edges of the OPS view, which made it the most saturated
thing on screen and left it fighting every brass surface around it.

Three sources of cyan, all now warm:

- the artwork, via `sepia(1) saturate(2.5) hue-rotate(-14deg)` on `.tank-wrap img` —
  sepia strips the cyan outright, then saturate and hue-rotate bring it back as
  banked-coal amber so the glass still reads as lit fluid rather than going grey
- `.tank-energy`, from `rgba(25,215,230,.4)` to amber
- the rising bubbles in `.tank-wrap::after`, from cyan-white to warm

Filtering rather than repainting is deliberate: one line to revert if the raster is ever
redrawn in brass, and it avoids committing a second copy of a 227KB texture.

**Verified:** element screenshot of the tank plus the full OPS view at 1440×900 — brass
housing, amber fluid, no cyan anywhere on screen.

## ~~8. Runtime depends on unpkg + in-browser Babel~~ — FIXED

`index.html` used to fetch React, ReactDOM and Babel Standalone from unpkg and then
compile ~225KB of JSX in the browser on **every** page load — roughly 2.9MB of Babel
downloaded to do work that belongs at build time. Worse, the page did not render at all
when unpkg was unreachable. That was not hypothetical: it is exactly what happened while
verifying an earlier commit in a sandbox that blocks unpkg.

`build.mjs` now compiles the JSX with esbuild and inlines React, ReactDOM, the compiled
app and the Tailwind utilities into one file. The browser never sees JSX and never loads
Babel.

| Part | Size |
|---|---|
| react + react-dom, inlined | 139.2KB |
| compiled app | 229.1KB |
| tailwind utilities | 10.9KB |
| **total, single file** | **380.5KB** |

Bigger on disk, far smaller and far more reliable over the wire. The only network Ember
needs to *load itself* is now the Google Fonts stylesheet, which degrades to a system
serif rather than breaking the page; every other request is a deliberate runtime API call.

**Verified:** rendered the built file — mounts, six dock labels, 13 motion parts, both
levers absolute, Cinzel applied, Studio switches, no mobile overflow at 390px, and the
only external request is the font stylesheet.

## 9. The local preview still uses CDN Tailwind and React dev builds

**Severity:** none for its purpose — stated so nobody "fixes" it by accident

`_preview.html` deliberately keeps the Tailwind Play CDN and React development builds.
That is the right trade for local iteration: no compile step, readable component stack
traces, and it runs on python3 alone, which matters because there is no Node on Brady's
Mac. `index.html` is the artifact that must be self-contained, and it is.
