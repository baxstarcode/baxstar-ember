# EMBER — Master Build Prompt (v3 — Continuation Brief)

You are continuing the build of **Ember**, my personal AI command center — my Jarvis. Ember already exists and works. Your job is to evolve it, not restart it. This prompt is your constitution. Read it fully before touching code.

---

## 0. Current State — Read This First

This document is Ember's visual and product-design constitution. It is not the active
operational briefing. Before changing code, read `docs/CURRENT-STATE.md` for the verified
architecture, product surfaces, voice policy, deployment state, test totals, and remaining
gates. Then read `SOURCES-OF-TRUTH.md`, `HANDOFF-CINEMATIC.md`, and
`docs/KNOWN-ISSUES.md` for provenance and locked constraints.

Canonical ownership is simple: edit `src/baxstar-ember.jsx` for application behavior and
appearance, `proxy/cloudflare-worker.js` for the API Worker, and
`functions/api/[[path]].js` for the Pages gateway. Generate `index.html` and the exact
`dist/` payload through the build scripts; never hand-edit generated output.

Preserve verified working behavior. Ordinary chat may use only the approved read-only Quo,
Gmail, and Calendar connectors. Google Drive access remains isolated to the separate Drive
Librarian surface. Keep every external draft, reply, post, and task reviewable before action.
Do not remove or simplify a working surface without an explicit product decision and a
regression test.

**Established visual law:** Ember has no comic-book bursts, emoji tool icons, or generic
gradient skin. Preserve the serious steampunk language in §3: warm, restrained, mechanical,
and premium.

---

## 1. Active Gates — Verify These, Don't Rediscover Them

The former standalone styling and browser-auth blockers are resolved by the compiled,
self-contained production build and the same-origin Pages-to-Worker gateway. Do not restore
CDN JSX compilation, direct provider calls, browser-held destinations, or client secrets.

The active release gates live in `docs/CURRENT-STATE.md` and `docs/DEPLOY.md`: protect every
production and preview hostname with Cloudflare Access, prove the Pages service binding in a
signed-in session, then deploy and verify the Worker host gate. Desktop voice stays outside
the main app until the isolated probe passes five real turns in Mac Chrome. Reliable
iPhone voice is also preferred if feasible and needs a separate isolated repeated-turn,
interruption, and microphone-handback experiment. The historical stack is not restored
automatically; wake words, background listening, and automatic restart are outside the lab.

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
- Glow: preserve the warm ember range (`--ember-orange` / `--ember-amber`) as banked-coal
  amber, with candle-white for readouts rather than neon light.
- No blue or purple primary surfaces. Glacier Lake, Violet Sky, and the retired
  `--ember-ice` treatment must not return. Warmth only.

**Materials & texture**
- Subtle riveted panel edges, machined bezels, hairline etched borders on the existing `Panel` component
- Gauges, dials, and toggle switches as UI metaphors where they serve function — status reads like a pressure gauge, the model selector feels like a brass lever
- Restraint: texture supports, it never shouts. If a decorative element doesn't clarify state or hierarchy, cut it.

**Typography**
- Display: preserve the refined Victorian-industrial serif and engraved-brass-plate
  treatment used for headers and panel titles; do not return to sports-poster display type.
- Data/UI: clean humanist or slab, legible small; keep monospace for code/HTML surfaces
- Never gimmick "steampunk fonts" with gears baked into letterforms.

**Iconography**
- Preserve the consistent engraved-line icon set: thin brass linework, one visual language
  across every tool. Extend that same SVG treatment when a new tool is added; never use
  emoji as primary interface icons.

**Motion**
- Mechanical easing — things settle like weighted brass, not bouncy plastic
- Idle states breathe like a banked fire: slow amber pulse, nothing frantic
- BURST_WORDS and any comic-splash effects are deleted, replaced by mechanical feedback: a gauge tick, a latch-click flash, a pressure-release glow.

**Voice surface (only after the relevant physical gate passes)**
- Keep the interaction explicit and one-turn: click Talk, review or correct the transcript,
  send, then optionally play the neural reply.
- If a future desktop surface visualizes audio, house it as a restrained machined instrument:
  a brass-ringed gauge, a firebox window, or a boiler dial.
- Status states (`READY` / `LISTENING` / `SPEAKING`) read as engraved plate labels, not
  letterspaced sans. Never imply the microphone is active when it is not.
- Use the historical implementation as reference, not an automatic restore. Desktop
  proof does not prove iPhone reliability; the opt-in phone experiment needs its own
  repeated-turn and interruption results before integration.

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
