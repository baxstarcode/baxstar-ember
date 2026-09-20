# Ember — Current State

Last verified against the working repository on **2026-09-20**.

**Status:** the desktop revival is source-complete and the local/simulated suites are
green. The new Cloudflare Pages build, same-origin API gateway, and Worker host gate
still need their staged production rollout and signed-in verification. Desktop voice is
an isolated experiment until Brady passes the physical five-run Mac Chrome gate.
Reliable iPhone voice is an approved experiment with a separate physical-device gate.

## What Ember is now

Ember is Brady Baxter's desktop-first AI command center for Baxstar Fishing and Lakes
Golf Simulator. It is one daily operating system, not a set of demos:

- **OPS:** calls and voicemail, unread email, schedule, manual revenue, quick actions,
  the YOUR TOOLS rail, and the collapsed THE WORKS ecosystem map.
- **Chat:** a readable persisted Claude thread with streaming replies, Stop, Retry,
  Copy, Clear, keyboard controls, safe lightweight formatting, and explicit
  connector/error states.
- **Mission Control:** browser-local project state, next actions, task lists, links,
  effort estimates, decisions, and reviewable local task drafts. Saving a task does
  not send it to Quo.
- **Projects:** the lighter session-maintained progress bars and Zapier-usage summary.
- **Baxstar Studio:** Caption Studio, AI Handoff, Drive librarian, HTML Viewer, Image
  Filters, GitHub, and reusable snippets.

Live data is deliberately honest. A degraded connector response cannot replace OPS
panels or label generated/demo data as live. Revenue remains manual until a real
booking-system source is chosen.

## Voice policy

The former phone/wake-word stack is not part of the application. Brady's latest voice
direction, recorded in the Ember Handoff Log and Agent Relay on 2026-09-20, calls for
excellent desktop voice and chat and prefers reliable iPhone voice if feasible. The
historical removal is release history, not a permanent product prohibition.

Desktop voice may return only after the isolated probe at
`work/desktop-voice-probe/` passes five real turns in desktop Chrome. The approved
interaction is explicit and one-turn: click Talk, review/correct the transcript, send
it, then optionally play the reply. Automated tests do not prove microphone release,
recognition quality, audible playback, permission recovery, or repeated timing.

Until Brady records a pass, desktop microphone and speaker behavior is
**PROVISIONAL**. A pass permits the explicit desktop interaction tested. An opt-in iPhone
lab must separately prove repeated turns, interruptions, permission recovery, playback,
and microphone handback on that phone before integration. Neither pass establishes wake
words, background listening, automatic restart, or full duplex.
The complete historical implementation remains recoverable on
`snapshot/voice-era-final`.

## Current architecture

```text
Authenticated browser
  -> https://ember.baxstarfishing.com (Cloudflare Access)
  -> Cloudflare Pages static dist/
  -> same-origin /api/* Pages Function
  -> EMBER_API service binding
  -> ember-claude-proxy Worker
  -> Anthropic / neural TTS / approved read-only MCP connectors / Drive outbox
```

- Pages builds `main` with `npm run build:pages` and publishes only `dist/`.
- `functions/api/[[path]].js` accepts the exact production hostname, the exact paths
  `/api/messages`, `/api/tts`, `/api/connectors/status`, and `/api/outbox`, and only
  POST/OPTIONS. Preview and lookalike hosts are denied.
- The Worker owns secrets, provider destinations, model/body limits, OAuth, TTS, the
  private Drive-outbox destination, and the server-controlled connector tool allowlist.
  Browser-supplied destinations, tokens, tools, and tool configuration are discarded.
- Ordinary chat can read the approved Quo, Gmail, and Calendar tools. The separate
  Drive librarian can search and read approved Drive data. Neither can send messages,
  create external tasks, alter mail/calendar data, or write Drive files.
- After the pending host-gate deploy, the public `workers.dev` hostname will accept
  only the manual OAuth start/callback GET routes; every API request there returns 404.
  `Origin` is CORS policy, not authentication.

Quo, Gmail, Calendar, and Drive credentials were all reported connected by the live
credential-status route on 2026-09-20. The new gateway/host-gate release still needs
production verification before that state is attributed to the revived build.

## Verified in this revival

The latest recorded local release matrix is green: **562/562 checks**.

- production build and exact Pages staging payload;
- Worker contract and security tests: 193/193;
- Pages gateway tests: 36/36;
- chat regressions: 26/26;
- dashboard checks: 30/30;
- layout/truth checks: 81/81;
- streaming/effort checks: 9/9;
- ecosystem graph checks: 32/32;
- UI rework checks: 34/34;
- Caption Studio browser checks: 46/46;
- desktop and opt-in phone voice-lab simulations: 24/24;
- Drive outbox tests: 27/27;
- posting-time tests: 24/24.

Browser checks cover desktop, laptop, and phone widths with intercepted external calls.
They do not replace signed-in production, provider, microphone, speaker, OAuth, or
device verification.

## Remaining gates, in order

1. Publish the `npm run build:pages` output through the `main` Pages deployment and
   confirm the custom hostname, exact production `pages.dev` alias, and preview wildcard
   all challenge unauthenticated visitors through Cloudflare Access.
2. In an authenticated production session, disable the lab's **Stream reply** option
   and use a typed-only, connector-free message to prove the Pages service binding
   against the existing Worker (which incorrectly labels SSE as JSON).
3. Deploy the updated Worker promptly as the second half of the release. Confirm
   direct API POSTs on `workers.dev` return 404 while OAuth GET and the binding work.
4. Verify signed-in chat, data-free connector status, TTS, one controlled outbox draft,
   and verified OPS sync. The historical Worker cannot provide the new status/TTS/
   outbox paths before this update; see the staged sequence in `docs/DEPLOY.md`.
5. Have Brady complete the five-run physical Mac Chrome voice gate. Test the opt-in
   iPhone lab separately for repeated turns, interruptions, and microphone handback.
   Integrate only the interaction and platform that passes its physical gate.

## Canonical files

| Concern | Owner |
| --- | --- |
| Application behavior, markup, and CSS | `src/baxstar-ember.jsx` |
| Anthropic, connector, OAuth, and TTS gateway | `proxy/cloudflare-worker.js` |
| Same-origin Pages API relay | `functions/api/[[path]].js` |
| Production HTML generator | `build.mjs` |
| Exact Pages payload | `scripts/stage-pages.mjs` |
| Local preview generator | `scripts/sync-standalone.py` |
| Desktop voice feasibility gate | `work/desktop-voice-probe/` |
| Design constitution | `docs/BUILD-PROMPT.md` |
| Deployment procedure | `docs/DEPLOY.md` |
| Current risks and deliberate limits | `docs/KNOWN-ISSUES.md` |
| Locked compatibility details | `HANDOFF-CINEMATIC.md` |
| Ownership and provenance | `SOURCES-OF-TRUTH.md` |

`index.html`, `_preview.html`, and `dist/` are generated outputs. Never hand-edit or
build from them.

## Rules that must not drift

- Never put API keys, OAuth tokens, refresh tokens, or other secrets in client files
  or Git.
- Keep drafts, replies, posts, and tasks reviewable before external action. General
  chat is read-only even when a prompt asks it to act.
- Preserve frozen IDs, storage keys, business contexts, connector names/routing, and
  persisted shapes unless Brady explicitly changes them and a migration is supplied.
- Preserve the warm steampunk identity and fixed CSS brass dock. Fishing and golf are
  restrained engravings, not alternate themes.
- Keep hosted chat useful when optional connectors fail, while never presenting
  connector-free output as live business data.
- State local, simulated, production, and physical-device verification separately.

## Resume procedure

1. Read `AGENTS.md`, this file, `SOURCES-OF-TRUTH.md`, and the current Ember Handoff
   Log standing-truth block.
2. Inspect the branch and working tree before changing anything.
3. Edit the canonical owner, not a generated output.
4. Run `npm run test:release`; use targeted suites only for focused iteration.
5. Follow the staged production sequence in `docs/DEPLOY.md`; do not deploy the Worker
   host gate before the same-origin production gateway is proven.
6. Mark anything requiring Access, OAuth, providers, a real microphone, or speakers
   **PROVISIONAL** until it is tested there.
