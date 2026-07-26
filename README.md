# Baxstar Ember

Brady Baxter's personal AI command center for Baxstar Fishing and Lakes Golf Simulator.

Ember is the front door to both businesses — chat, phones, email, calendar, and Drive in one interface, with a voice layer on top.

---

## What's in here

| Path | What it is | Status |
|---|---|---|
| `src/baxstar-ember.jsx` | **The app.** Canonical React source. This is Ember. | Working |
| `index.html` | **Deploy build.** Same app packaged to run standalone in a browser via CDN. | Blocked — see Known Issues |
| `voice/ember-voice-deck.html` | Voice test rig — mic in, speech out, audio meter. | Working |
| `voice/ember-demo.html` | Voice rig + canned Baxstar demo brain. Wife/investor demo. | Working, not wired to the real app |
| `docs/BUILD-PROMPT.md` | Master brief for any AI session that continues this build. | Current |
| `docs/KNOWN-ISSUES.md` | Open blockers with detail. | Current |

---

## The app — `src/baxstar-ember.jsx`

Two modules: **OPS** and **BAXSTAR STUDIO**.

**Connected services (MCP):** Quo (phones), Gmail, Google Calendar, Google Drive.

**Studio tools (8):**
Claude Chat · AI Handoff · Caption Studio · Google Drive Librarian · HTML Viewer · Image Filters · GitHub · Snippets

**Built in:** model selector (Haiku / Sonnet / Opus), effort level (Low / Std / High), Baxstar system contexts, canned policy snippets, sponsor handles, background presets, demo data with live SYNC.

### Running it
Today Ember runs as a Claude artifact — paste `src/baxstar-ember.jsx` into a Claude conversation. The Claude API key is injected by the platform there, which is why the app has no key in its code.

Standalone hosting is the goal but is not yet working. See Known Issues.

---

## The voice layer — `voice/`

Self-contained, no build step. Open either file directly in **Chrome** (Web Speech API support) and click through.

- Speech in: continuous `SpeechRecognition`
- Speech out: `speechSynthesis` with a scored local-voice picker, plus a two-source MP3 fallback chain and a 1.4s watchdog
- Live mic-level meter driving an animated orb
- Full diagnostic log panel

`ember-demo.html` answers Baxstar questions (pontoon rates, guided trips, booking curve, golf sim, tech camp) from **hardcoded string matching** — not Claude. It is a demo, not a brain.

Merging this voice layer into the real app is the biggest open opportunity.

---

## Known issues

See `docs/KNOWN-ISSUES.md`. Short version:

1. **`index.html` has no Tailwind** — layout collapses when hosted.
2. **`index.html` has no API auth** — needs a server-side key proxy before it can live at a URL.
3. **Voice is not connected to the app** — two separate codebases today.
4. **Visual identity is mid-transition** — moving from comic-book styling to steampunk. See `docs/BUILD-PROMPT.md`.

---

## Continuing the build

Open a Claude conversation, paste `docs/BUILD-PROMPT.md`, and attach whichever files that session touches. The prompt carries the design language, the quality bar, and the known blockers so no session rediscovers them.

---

*Detroit Lakes, MN*
