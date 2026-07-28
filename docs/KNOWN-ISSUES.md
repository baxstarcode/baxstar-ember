# Known Issues

Verified against the code in this repo. Fix these rather than rediscover them.

Last audited at commit `d7717a1` + this pass. Each item says how it was verified.

---

## 0. THE NEWEST DESIGN IS NOT IN THIS REPO — highest priority

**Severity:** blocks all visual work
**Verified:** yes — against a screenshot of the newer build, dated Sun Jul 26 10:36 PM

A materially more advanced build of Ember exists outside git. `src/baxstar-ember.jsx` at
HEAD is behind it. Anything generated from this repo renders the older look — correctly,
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

**To close this, land these in git:**

1. The newer `.jsx` (or the artifact HTML) → replaces `src/baxstar-ember.jsx`
2. Every raster asset it references → `assets/ember/raster/`
3. Then `npm run build` — everything downstream is already wired and will pick it up
   automatically: Tailwind recompiles against the new class set, the proxy hook and the
   asset-root hook are re-emitted, no hand-editing.

**Root cause: this is version sprawl recurring.** Issue 5 in the old version of this file
claimed the repo had solved it ("eight copies across Downloads and chat artifacts…
this repo starts clean"). It hadn't — the best build still lives in a chat artifact
rather than in git. The habit to fix is that the artifact is where work happens and
nothing commits it back. Until a session ends with a commit, the repo is not the source
of truth, and the next session rediscovers the wrong design.

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

**Verified:** every retheme marker now matches across both files
(`Cinzel` 3/3, `EmberIcon` 18/18, `BrandMark` 2/2, comic markers 0/0).

**Rule going forward: never edit `index.html` by hand. Run `npm run build`.**

---

## OPEN

## 2. Hosted Ember has no API auth of its own

**Severity:** blocks deployment
**Status:** proxy written and wired; needs deploying

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

## 5. Blue glass tanks contradict the palette rule

**Severity:** cosmetic, but it's a direct brief conflict
**Verified:** visual render
**New this pass**

`BUILD-PROMPT.md` §3 is explicit: "No blues, no purples for primary UI… Warmth only,"
and `--ember-ice` was duly retired from the CSS. But
`assets/ember/raster/glass-tank@2x.png` — rendered large down both edges of the OPS
view (`src/baxstar-ember.jsx:1654`, `:1658`) — is vivid cyan. It's now the most
saturated color on the screen.

It arrived deliberately in `d7717a1` ("apply exact spec deviations"), so it's left
alone pending a call from Brady rather than quietly changed. Two ways out:

- Regenerate the asset in the brass/copper family.
- Filter it in place — `filter: sepia(.7) saturate(2.2) hue-rotate(-35deg)` on those
  two `<img>` tags brings it to amber with no new asset.

## 6. Runtime still depends on unpkg + in-browser Babel

**Severity:** performance and fragility, not a blocker
**Verified:** the render test failed to mount until React/Babel were vendored locally,
because this sandbox blocks unpkg — a live demonstration of the failure mode.

`index.html` loads React, ReactDOM, and Babel Standalone from unpkg, then compiles
~200KB of JSX in the browser on every page load. If unpkg is slow, blocked, or down,
Ember does not start. Precompiling the JSX at build time and vendoring the two React
files would remove both the dependency and the compile. `build.mjs` is the natural
place for it.
