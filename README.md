# Baxstar Ember

Brady Baxter's personal AI command center for Baxstar Fishing and Lakes Golf Simulator.

Ember is the front door to both businesses — a dashboard over phones, email, calendar and Drive, with a typed line to Claude and a rail of links to every other Baxstar tool.

---

> ### Two generated files. Never edit either by hand.
>
> | File | Rebuild with | For |
> |---|---|---|
> | `_preview.html` | `./start-ember.sh` (python3 only) | local iteration |
> | `index.html` | `npm run build` (node) | the hosted deploy build |
>
> Edit `src/baxstar-ember.jsx` and regenerate. Hand-editing a generated file is how the
> deploy build once drifted an entire redesign behind the source with nobody noticing.

---

## What's in here

| Path | What it is | Status |
|---|---|---|
| `src/baxstar-ember.jsx` | **The app.** Canonical React source — cinematic v2. | Working |
| `index.html` | **Deploy build. Generated — never edit by hand.** | Self-contained, no CDN |
| `_preview.html` | **Local preview. Generated, gitignored.** | Working |
| `build.mjs` | Generates `index.html`. `npm run build`. | Working |
| `scripts/sync-standalone.py` | Generates `_preview.html`. No Node needed. | Working |
| `start-ember.sh` | Regenerates the preview, then serves it on :8787. | Working |
| `proxy/cloudflare-worker.js` | Key-holding API proxy. | **Deployed & verified** |
| `proxy/vercel/api/claude.js` | Same proxy for Vercel / Netlify. | Written, unused (Cloudflare is live) |
| `docs/BUILD-PROMPT.md` | Master brief for any AI session that continues this build. | Current |
| `docs/DEPLOY.md` | How to build, deploy the proxy, and go live. | Current |
| `docs/HANDOFF-CINEMATIC.md` | Checkpoint notes for the cinematic v2 build. | Current |
| `docs/KNOWN-ISSUES.md` | Open blockers with detail. | Current |
| `assets/ember/` | Steampunk asset pack — SVG controls, frames, rasters, textures. | Wired in |

---

## The app — `src/baxstar-ember.jsx`

Three views: **OPS** (home — the skeleton, the chat thread, the panels), **BAXSTAR

**Mission Control:** editable project fuses, next actions, task lists, resumable page
links, Zapier usage and pacing, effort rollups, and a decision queue. Its state persists
in browser local storage.

STUDIO** (tools), and **PROJECTS** (the status dashboard: every open project as a
horizontal bar under Revenue Generating / Supporting, with outstanding work, session
estimates, and the Zapier task strip). Projects data is the session-maintained
`PROJECTS` constant in `src/baxstar-ember.jsx` — update it when work ships.

**Connected services (MCP):** Gmail, Google Calendar, and Google Drive are live
on the hosted app. Quo now supports custom clients and is back in the app on its
required `/mcp` endpoint; its one-time user consent and Worker secrets remain
to be completed (`docs/DEPLOY.md` §4).

**Studio tools (8):**
Claude Chat · AI Handoff · Caption Studio · Google Drive Librarian · HTML Viewer · Image Filters · GitHub · Snippets

**Built in:** model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.8 / Opus 5 / Fable 5 — defaults to **Opus 5 on High effort**, Sonnet 4.6 is the error fallback), effort level (Low / Std / High), Baxstar system contexts, canned policy snippets, sponsor handles, background presets, demo data with live SYNC.

#### Caption Studio

Takes up to **6 photos as one carousel**, scans the whole set in a single vision call for
species and sponsor gear, drafts the caption, hard-caps the post at **5 hashtags** (the
locked `#getyourbassingear` holds one slot), and publishes full-quality ≤1440px renders to
a **private Drive outbox** for review. It does not post to Instagram itself.

Sponsor handles live in one place — the `SPONSORS` map in `src/baxstar-ember.jsx` — and are
the canonical set shared with the standalone tool at
[baxstarcode/caption-studio](https://github.com/baxstarcode/caption-studio). Deploy the
outbox from `apps-script/outbox/` (see its `README-DEPLOY.md`).

Phone shortcut: `?tool=captions` opens straight into it, `&lean=1` strips everything else.

### Running it

**Locally — python3 only, no Node.** The everyday loop.

```bash
./start-ember.sh          # regenerates _preview.html, serves http://localhost:8787/_preview.html
```

**As a Claude artifact (works fully today).** Paste `src/baxstar-ember.jsx` into a Claude
conversation. The API key and the MCP connector tokens are injected by the platform there,
which is why the app has no key in its code.

**Hosted at a URL.** Needs Node for the build.

```bash
npm install
npm run build     # regenerates index.html from src/
npm run serve     # http://localhost:8080
```

Hosting uses the deployed Worker to hold the API key and connector refresh tokens.
Google OAuth is live; Quo authorization is the remaining connector setup. Read
`docs/DEPLOY.md` before deploying.

> **`index.html` is generated.** Edit `src/baxstar-ember.jsx` and rebuild. Editing
> `index.html` directly is how the deploy build once ended up a full redesign behind the
> source with nobody noticing.

### Tests

```bash
npm test              # proxy worker + Drive outbox — no network, no deps, no browser
npm run test:caption  # Caption Studio end-to-end in headless Chromium (needs playwright)
```

`npm test` is safe to run anywhere: the worker tests stub every outbound call, and the
outbox tests evaluate the real `Code.gs` against a stubbed Drive. `test:caption` drives the
generated `index.html` with the model and the outbox intercepted — so it exercises the
canvas renders and the published payload without an API key, a Drive write, or a deploy.
Run `npm run build` first; it tests the build, not the source.

---

## Voice — retired 2026-09-18

Ember had a full voice stack: wake word, mic handoff, neural TTS through the Worker,
a device-voice picker, a never-silent fallback ladder. **It is gone from the app**, by
Brady's decision, after it failed on his phone across three rounds of fixes.

It was not one bug. Talking to a web page is a five-link chain — mic capture, speech
recognition, the network round trip, audio playback, and the browser handing the mic
back — and on iOS every link is owned by Safari, which suspends the tab, kills requests
at about 60 seconds, gates audio behind a gesture and takes the mic back at will. Every
iPhone browser, Chrome included, runs Safari's engine, so there is no way around it from
a web page. Each fix worked and the failure moved to the next link. The result was an
assistant that worked *sometimes*, which is worse than one that never did.

**Do not re-add voice to this app.** If voice comes back it belongs somewhere that owns
the whole chain — a native app, an iOS Shortcut calling the Worker, or a WebRTC agent
platform. Two things are deliberately kept for that day:

- `POST /tts` in `proxy/cloudflare-worker.js` — the neural voice Brady liked. Unused by
  the app now, still tested (55/55), zero cost while idle.
- Branch `snapshot/voice-era-final` — the complete voice implementation, recoverable.

## Known issues

See `docs/KNOWN-ISSUES.md`. Short version:

1. **Revenue is entered by hand.** Nothing invents the number — there is no booking-system
   connection to pull it from, and FareHarbor has no public API.

Recently closed: proxy deployed and verified · hosted at `ember.baxstarfishing.com` behind
Cloudflare Access (the old `baxstar-ember.pages.dev` origin is no longer allowlisted) · glass
tanks brought into the warm palette · `index.html` no longer needs
unpkg or in-browser Babel · unauthorized connectors no longer take chat down with them.

---

## Continuing the build

Open a Claude conversation, paste `docs/BUILD-PROMPT.md`, and attach whichever files that
session touches. The prompt carries the design language, the quality bar, and the known
blockers so no session rediscovers them.

---

*Detroit Lakes, MN*
