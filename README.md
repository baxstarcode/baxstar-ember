# Baxstar Ember

Brady Baxter's personal AI command center for Baxstar Fishing and Lakes Golf Simulator.

Ember is the front door to both businesses — chat, phones, email, calendar, and Drive in one interface, with a voice layer on top.

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
| `voice/ember-voice-deck.html` | Voice test rig — mic in, speech out, audio meter. | Working |
| `voice/ember-demo.html` | Voice rig + Claude brain, canned demo as fallback. Config generated from `src/`. | Working |
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

**Connected services (MCP):** Quo (phones), Gmail, Google Calendar, Google Drive.

**Studio tools (8):**
Claude Chat · AI Handoff · Caption Studio · Google Drive Librarian · HTML Viewer · Image Filters · GitHub · Snippets

**Built in:** model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.8 / Opus 5 / Fable 5), effort level (Low / Std / High), Baxstar system contexts, canned policy snippets, sponsor handles, background presets, demo data with live SYNC.

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

Hosting needs a proxy to hold the API key, and the MCP connectors need OAuth work that
isn't done yet. Read `docs/DEPLOY.md` before deploying — it is specific about what works
hosted and what doesn't.

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

## The voice layer — `voice/`

Self-contained, no build step. Open either file directly in **Chrome** (Web Speech API
support) and click through.

- Speech in: continuous `SpeechRecognition`
- Speech out: `speechSynthesis` with a scored local-voice picker, plus a two-source MP3
  fallback chain and a 1.4s watchdog
- Live mic-level meter driving an animated orb
- Full diagnostic log panel

`ember-demo.html` routes spoken questions through Claude — real Baxstar context, real
connectors, replies written for the ear. Set `EMBER_API_PROXY` at the top of the file to
turn it on. Without it, or if the call fails, it falls back to the canned demo brain, so
the offline demo still works.

Merging this voice layer into the app properly — one Ember, one brain — remains the
biggest open opportunity.

---

## Known issues

See `docs/KNOWN-ISSUES.md`. Short version:

1. **MCP connectors don't work outside a Claude artifact** — they need OAuth tokens the
   platform currently supplies. Hosted, the phone/email/calendar panels show demo data.
   **This is the largest remaining gap.**
2. **Voice is part-merged** — the rig's Baxstar config is now generated from the app so it
   can't drift, but the speech engine is still its own codebase and the live mic path has
   never been tested.

Recently closed: proxy deployed and verified · hosted at `baxstar-ember.pages.dev` behind
Cloudflare Access · glass tanks brought into the warm palette · `index.html` no longer needs
unpkg or in-browser Babel · unauthorized connectors no longer take chat down with them.

---

## Continuing the build

Open a Claude conversation, paste `docs/BUILD-PROMPT.md`, and attach whichever files that
session touches. The prompt carries the design language, the quality bar, and the known
blockers so no session rediscovers them.

---

*Detroit Lakes, MN*
