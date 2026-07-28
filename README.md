# Baxstar Ember

Brady Baxter's personal AI command center for Baxstar Fishing and Lakes Golf Simulator.

Ember is the front door to both businesses — chat, phones, email, calendar, and Drive in one interface, with a voice layer on top.

---

> ### ⚠ The newest design is not in this repo
>
> A more advanced build exists outside git — full-page brass frame, a mechanical
> odometer for revenue, an ornate concentric core gauge, and six sculpted instrument
> panels for the bottom nav. It needs roughly eight raster assets that are not in
> `assets/ember/raster/` (which holds only `glass-tank` and `skull-arch`).
>
> `src/baxstar-ember.jsx` here is **behind** that build. Getting the newer source and
> its assets committed is the highest-priority task in this repo — see
> `docs/KNOWN-ISSUES.md` §0. Until then, anything built from this source renders the
> older look, correctly.

---

## What's in here

| Path | What it is | Status |
|---|---|---|
| `src/baxstar-ember.jsx` | **The app.** Canonical React source in git. | Working, but behind the newest design |
| `index.html` | **Deploy build. Generated — never edit by hand.** | Builds clean; needs a proxy to host |
| `build.mjs` | Generates `index.html` from the source. `npm run build`. | Working |
| `proxy/cloudflare-worker.js` | Key-holding API proxy so Ember can live at a URL. | Written, not yet deployed |
| `proxy/vercel/api/claude.js` | Same proxy for Vercel / Netlify. | Written, not yet deployed |
| `voice/ember-voice-deck.html` | Voice test rig — mic in, speech out, audio meter. | Working |
| `voice/ember-demo.html` | Voice rig + Claude brain, canned demo as fallback. | Working |
| `docs/BUILD-PROMPT.md` | Master brief for any AI session that continues this build. | Current |
| `docs/DEPLOY.md` | How to build, deploy the proxy, and go live. | Current |
| `docs/KNOWN-ISSUES.md` | Open blockers with detail. | Current |
| `assets/ember/` | Steampunk asset pack — SVG controls, frames, logos, textures. | Wired in, incomplete |

---

## The app — `src/baxstar-ember.jsx`

Two modules: **OPS** and **BAXSTAR STUDIO**.

**Connected services (MCP):** Quo (phones), Gmail, Google Calendar, Google Drive.

**Studio tools (8):**
Claude Chat · AI Handoff · Caption Studio · Google Drive Librarian · HTML Viewer · Image Filters · GitHub · Snippets

**Built in:** model selector (Haiku 4.5 / Sonnet 4.6 / Opus 4.8), effort level (Low / Std / High), Baxstar system contexts, canned policy snippets, sponsor handles, background presets, demo data with live SYNC.

### Running it

**As a Claude artifact (works fully today).** Paste `src/baxstar-ember.jsx` into a Claude
conversation. The API key and the MCP connector tokens are injected by the platform there,
which is why the app has no key in its code.

**Hosted at a URL.**

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

0. **The newest design isn't in git** — see the warning at the top. Highest priority.
1. **Proxy is written but not deployed** — needed before Ember can live at a URL.
2. **MCP connectors don't work outside a Claude artifact** — they need OAuth tokens the
   platform currently supplies. Hosted, chat works and the phone/email/calendar panels don't.
3. **Voice is half-merged** — real brain wired in, but `voice/` and `src/` are still two codebases.
4. **The glass-tank asset is cyan**, which contradicts the warm-metals-only palette rule.
5. **Runtime still depends on unpkg + in-browser Babel** — slow first paint, and a hard
   dependency on a CDN being up.

---

## Continuing the build

Open a Claude conversation, paste `docs/BUILD-PROMPT.md`, and attach whichever files that
session touches. The prompt carries the design language, the quality bar, and the known
blockers so no session rediscovers them.

---

*Detroit Lakes, MN*
