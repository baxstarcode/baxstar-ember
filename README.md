# Baxstar Ember

Brady Baxter's desktop-first AI command center for Baxstar Fishing and Lakes Golf
Simulator. Ember combines daily operating feeds, a high-functioning Claude thread,
Mission Control, Caption Studio, project status, and direct links to the rest of the
Baxstar system in one cinematic steampunk dashboard.

Production: `https://ember.baxstarfishing.com` behind Cloudflare Access.

The desktop revival shipped through PR #43 on 2026-09-20. Pages deployment
`1f56234b-f359-43f2-ba38-c839d2e6b415` and Worker version
`ac3b4578-5a04-4abf-9286-8e95663517d5` passed the staged binding, Access, public-host
gate, OAuth-start, signed-in streaming-lab, ordinary-chat, live-OPS, and browser TTS
checks. A data-free connector-status call, one controlled Drive-outbox write, and all
physical voice tests remain pending; see `docs/CURRENT-STATE.md`.

## Current product

- **OPS:** calls/voicemail, unread mail, calendar, manual revenue, readable chat with
  WHAT'D I MISS / BRIEF MY DAY push-plates, Triage on the Inbox, and the tools row —
  one screen on desktop. THE WORKS and the Knowledge Foundry open from the dock.
- **Chat:** streaming replies, persisted context, Stop, Retry, Copy, Clear, keyboard
  controls, safe lightweight formatting, and explicit connector/error states.
- **Mission Control:** browser-local project state and reviewable local task drafts.
  Saving a task never sends it to Quo.
- **Studio:** Caption Studio, Drive librarian, AI handoff, HTML viewer, image filters,
  GitHub browser, and reusable snippets.
- **Connectors:** Quo, Gmail, Calendar, and Drive are supported through server-held
  OAuth. The revived release completed a signed-in live OPS sync, found the Ember
  Handoff Log by title through the Drive librarian without reading its contents, and
  observed chat recovery after one honestly surfaced connector-degraded response. The
  dedicated data-free status call is still pending, so this is not a blanket
  all-connected claim. Ordinary chat receives only a reviewed read-tool allowlist.

Live sync is deliberately honest: a degraded connector response cannot replace the
panels or mark demo/model-generated data as live. Revenue stays manual until a real
booking-system source exists.

## Voice policy

Excellent desktop voice and chat are rebuild goals. Reliable iPhone voice is also
preferred if feasible, per Brady's current direction recorded in the Ember Handoff Log
on 2026-09-20. The old implementation remains removed from the released dashboard;
that release history is not a permanent product ban.

Desktop voice is a conditional experiment, not a restored production feature. The
isolated page under `work/desktop-voice-probe/` provides one explicit turn:

1. click **Talk**;
2. review or correct the transcript;
3. click **Send transcript**;
4. optionally click **Play response**.

Automated checks pass, and the deployed lab completed signed-in streaming text plus a
neural-audio browser `playing`/`ended` cycle. Real microphone release, recognition
accuracy, physical speaker audibility, and voice quality remain **PROVISIONAL** until
Brady completes the five-run Mac Chrome gate in that folder's README. An opt-in iPhone
experiment must independently prove repeated
turns, interruption recovery, and microphone handback on the actual phone before phone
integration. Desktop success does not prove phone reliability. Neither experiment
automatically restores wake words, background capture, or automatic listening restart.

## Canonical files

| Path | Purpose |
| --- | --- |
| `src/baxstar-ember.jsx` | Canonical application behavior, markup, and inline CSS |
| `proxy/cloudflare-worker.js` | Key-holding Anthropic, connector, OAuth, TTS, and Drive-outbox Worker |
| `functions/api/[[path]].js` | Access-gated same-origin Pages gateway to the Worker binding |
| `build.mjs` | Generates `index.html`; never edit generated HTML by hand |
| `scripts/stage-pages.mjs` | Copies only public runtime files into `dist/` |
| `scripts/sync-standalone.py` | Generates the gitignored local `_preview.html` |
| `work/desktop-voice-probe/` | Isolated desktop and opt-in iPhone voice reliability lab |
| `signal-log/` | Signal Log page: ranked Gmail/Calendar attention cards, read through the same gateway (`ember-feed.mjs`); opens in a dashboard overlay, cards link to Gmail/Calendar and hand themselves to the composer via Ask Ember |
| `docs/CURRENT-STATE.md` | Concise active briefing and remaining work |
| `docs/KNOWN-ISSUES.md` | Current open risks and deliberate limitations |
| `SOURCES-OF-TRUTH.md` | File authority, voice policy, and provenance |

`index.html`, `_preview.html`, and `dist/` are outputs. Edit their owners instead.

## Build and run

The everyday local preview needs Python only:

```bash
./start-ember.sh
```

For the deploy build:

```bash
npm install
npm run build
npm run build:pages
```

`npm run build` produces a self-contained `index.html` with production React and the
used Tailwind utilities inlined. `npm run build:pages` also stages the exact public
payload in `dist/`. Cloudflare Pages is configured to run that command and publish
`dist`; the repository source and tests are not part of the static upload.

## API boundary

The browser calls only same-origin `/api/messages`, `/api/tts`,
`/api/connectors/status`, and `/api/outbox`. The Pages Function:

- runs only on the exact production hostname;
- denies preview and lookalike hosts;
- allows only those four routes and POST/OPTIONS;
- passes streams directly through the internal `EMBER_API` service binding.

The Worker owns secrets, provider destinations, tool permissions, body/token caps,
request validation, and the private Drive-outbox destination. Caption Studio sends a
reviewable draft to the same-origin outbox route; the browser never receives or chooses
the Apps Script URL or token. The Worker's `workers.dev` hostname remains available
only for the manual OAuth GET callbacks; direct API traffic is refused. `Origin`
remains CORS, not authentication.

Ordinary chat can read approved Quo, Gmail, and Calendar data. The separate Drive
librarian can search and read approved Drive data. Neither path can send messages,
create external tasks, modify mail or calendar records, or write files. Any future
action path needs separate permissions, validated arguments, and explicit human review.

## Tests

```bash
npm run test:release
```

That command rebuilds and stages the deploy payload, then runs the Worker, durable
token-owner workerd/SQLite, Pages gateway, Apps Script contract, posting-time, chat, dashboard, layout, streaming,
ecosystem, UI, Caption Studio, and voice-probe suites. Browser suites intercept model
and external calls. The voice-probe suite simulates browser events; it does not prove a
real microphone, Chrome speech service, audio decoder, or speaker.

All browser suites accept `CHROME_PATH=/usr/bin/chromium` when a managed environment
provides system Chromium. This does not replace the physical voice/device gates.
The durable token owner uses fresh-consent seeds and requires the staged cutover in
[`docs/DEPLOY.md`](docs/DEPLOY.md#durable-token-owner--rollout-pending-2026-10-16)
before deployment; it never imports old KV tokens automatically.

## Non-negotiables

- Never put API keys, OAuth tokens, refresh tokens, or secrets in browser or Git files.
- Never edit generated HTML by hand.
- Keep drafts, replies, posts, and tasks reviewable before external action.
- Preserve frozen IDs, storage keys, business context, and connector routing unless
  Brady explicitly changes them.
- Keep the warm steampunk identity; no unrelated redesign while fixing behavior.
- Mark live microphone, OAuth, deployment, and device claims PROVISIONAL unless they
  were actually verified in that environment.

See `docs/DEPLOY.md` for the production topology and OAuth maintenance procedure.
