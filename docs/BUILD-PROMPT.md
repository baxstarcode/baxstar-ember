# EMBER — Master Build Prompt (v3 — Continuation Brief)

You are continuing the build of **Ember**, my personal AI command center — my Jarvis. Ember already exists and works. Your job is to evolve it, not restart it. This prompt is your constitution. Read it fully before touching code.

---

## 0. Current State — Read This First

Ember exists in three pieces. Know what each one is before you change anything.

**1. `baxstar-ember.jsx` — the app (canonical source of truth).** A working React artifact:
- Claude API chat with MCP servers wired (Quo phones, Gmail, Google Calendar, Google Drive)
- 8 tools: Claude Chat, AI Handoff, Caption Studio, Drive Librarian, HTML Viewer, Image Filters, GitHub, Snippets
- System contexts (BRADY_CONTEXT, DRIVE_CONTEXT), canned policy snippets, sponsor handles, model + effort selectors, demo data with live SYNC
- Ember-orange-on-dark palette, CSS variables already defined (`--ember-red`, `--ember-orange`, `--ember-amber`, `--panel`, `--line`)

**2. `index.html` — the standalone deploy wrapper.** The same app (99.8% identical code) packaged to run in a plain browser via React UMD + Babel Standalone from CDN. This is the path to Ember living at a real URL instead of inside a chat window. **It is currently broken in two specific ways — see §1.**

**3. `ember-demo.html` / `ember-voice-deck.html` — the voice rig.** Separate, self-contained, and working. Web Speech API for speech-in, `speechSynthesis` with a scored local-voice picker and MP3 fallback for speech-out, a live mic-level meter, and an animated "gas" orb that scales and shifts with audio level. `ember-demo.html` adds a canned Baxstar demo brain (pontoon rates, guided trips, booking curve, golf sim, tech camp). This voice layer is **not yet connected to the real app** — the demo brain is hardcoded string matching, not Claude.

**Preserve all of it functionally.** Every tool, every MCP call, every context string, every snippet works today. Do not break, remove, or "simplify" working features. Refactor only when a change requires it, and verify behavior survives.

**What must change visually:** the current skin has comic-book DNA — BURST_WORDS ("ZOWIE!", "POW!"), emoji tool icons, generic gradient backgrounds. All of that is replaced by the design language in §3. The warm ember palette stays; the cartoon energy goes.

---

## 1. Known Blockers — Fix These, Don't Rediscover Them

**Blocker A — `index.html` has no Tailwind.** The JSX uses Tailwind utility classes throughout (`flex items-center gap-3`, `rounded-full`, `text-[13px]`, `grid`, `absolute`). The file loads React, ReactDOM, and Babel from CDN — and nothing else. Its 15KB inline `<style>` block defines the custom Ember CSS (variables, panels, animations) but zero utility classes. Result: hosted standalone, the colors survive and the entire layout collapses. Either add a Tailwind CDN build or compile the utilities into the inline stylesheet.

**Blocker B — `index.html` has no API auth.** It calls `fetch("https://api.anthropic.com/v1/messages")` with no `x-api-key` and no `Authorization` header. That works only inside a Claude artifact, where the platform injects the key. Hosted anywhere else it fails on auth and CORS — Ember renders with a dead brain. Any real deployment needs a thin proxy (Cloudflare Worker, Netlify/Vercel function) holding the key server-side. Never ship a key in client code.

Flag it if I ask you to deploy without solving B. Don't quietly ship something that will fail on first use.

---

## 2. What Ember Is

Ember is a premium, personal AI operations interface built for one user: me, Brady Baxter. It is not a demo, not a template, not a toy. It is the front door to how I run my businesses — and it should feel like stepping into a private study aboard a Victorian airship: warm, mechanical, alive.

The name is the design brief. **Ember** = a live coal. Warm amber light against dark iron. Slow glow, not neon flash. Everything about Ember should feel like it's quietly burning, ready to flare when called.

---

## 3. Design Language: Steampunk, Done Seriously

Steampunk is the foundation — executed at a luxury-brand level, never costume-party. Think a Swiss watchmaker who builds in brass, not a Halloween store.

**Palette**
- Base: deep charcoal iron, near-black walnut, oxblood leather (the existing `#080606` / `#100b0b` family is on target)
- Metals: aged brass, burnished copper, gunmetal — accents and structure, never full-surface chrome
- Glow: keep the existing ember range (`--ember-orange` / `--ember-amber`) but push it warmer and less neon — banked-coal amber, candle-white for readouts
- No blues, no purples for primary UI. Retire `--ember-ice` (`#5dd8ff`), the Glacier Lake and Violet Sky backgrounds, or rebuild them as brass-and-smoke variants. Warmth only.

**Materials & texture**
- Subtle riveted panel edges, machined bezels, hairline etched borders on the existing `Panel` component
- Gauges, dials, and toggle switches as UI metaphors where they serve function — status reads like a pressure gauge, the model selector feels like a brass lever
- Restraint: texture supports, it never shouts. If a decorative element doesn't clarify state or hierarchy, cut it.

**Typography**
- Display: refined Victorian-industrial serif or engraved-brass-plate for headers and panel titles (the current Big Shoulders Display is closer to sports-poster than watchmaker — replace it)
- Data/UI: clean humanist or slab, legible small; keep monospace for code/HTML surfaces
- Never gimmick "steampunk fonts" with gears baked into letterforms.

**Iconography**
- Replace emoji tool icons (💬 🔀 ✍️ 🌐 🎛️ 📋) with a consistent engraved-line icon set — thin brass linework, one style across all 8 tools. The existing custom GitHub/Drive SVGs show the right instinct; extend that.

**Motion**
- Mechanical easing — things settle like weighted brass, not bouncy plastic
- Idle states breathe like a banked fire: slow amber pulse, nothing frantic
- BURST_WORDS and any comic-splash effects are deleted, replaced by mechanical feedback: a gauge tick, a latch-click flash, a pressure-release glow.

**Voice surface (from the voice rig)**
- The blurred "gas" orb becomes a machined instrument: a brass-ringed pressure gauge, glowing coal in a firebox window, or a boiler dial whose needle rides the mic level. Same live audio data, mechanical housing.
- Status states (`READY` / `LISTENING` / `SPEAKING`) read as engraved plate labels, not letterspaced sans.
- Keep the mic meter, the local-voice scoring, and the MP3 fallback chain intact — that logic is hard-won and works.

---

## 4. Fishing & Golf: Nods Only

I run a premium guided fishing operation and a golf simulator business. Ember should *acknowledge* that heritage the way a gentleman's study does — a mounted detail here, an engraving there. **Never a theme.**

Approved:
- A single engraved fish or hook motif etched into a brass panel corner
- A gauge needle shaped like a golf tee, or a compass rose with a subtle hook at north
- Classy naming in copy only if it reads refined, not cute

Forbidden:
- Fish/golf clip art, ball or bobber icons as primary UI elements
- Anything that would make a first-time viewer say "oh, a fishing app"
- More than 2–3 total nods visible on any single screen

Steampunk is the identity. Fishing and golf are the engraving on the pocket watch.

---

## 5. Quality Bar

- Every screen ships at a standard I'd put in front of a paying premium client. If a section looks templated, generic, or "AI-built," it fails.
- Complete, ready-to-deploy output — full file, no placeholders, no "you can add X later."
- Self-audit before presenting: visual hierarchy, contrast/legibility on the dark palette, mobile behavior, consistency of the metal/ember system across every component — AND a functional pass: chat, SYNC, each of the 8 tools, MCP calls, and (if touched) mic-in and voice-out. Fix before showing me, not after.
- Ember's in-product copy stays confident, warm, capable — a trusted steward, not a chatbot. Short sentences. No hedging.

---

## 6. Ember's Character

When Ember speaks — on screen or out loud:
- Steady, dry warmth. A butler with a machinist's hands.
- Bottom line first. It tells me what matters, then stops.
- Brief and direct: "Furnace lit. Three items need your eye." — not paragraphs.
- Spoken lines are written for the ear: no bullet syntax, no URLs, numbers said the way a person says them.

---

## 7. Build Conduct

- Before building, confirm scope for this session in one short list (e.g., "this pass: full retheme + icon set + motion; voice merge and deploy fixes deferred"). Then build without stopping to ask permission at every step.
- Work from the files I attach. If a technical constraint forces a compromise, state it in one line, pick the best option, and proceed.
- If you think part of this brief is wrong for the goal, push back with a reasoned position — don't silently comply and don't silently deviate.

Acknowledge this brief in one sentence, then confirm the session scope and begin.
