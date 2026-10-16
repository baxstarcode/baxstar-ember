# Working on Ember

Start with `docs/CURRENT-STATE.md`. It is the concise active briefing for this
repository. Use `SOURCES-OF-TRUTH.md`, `HANDOFF-CINEMATIC.md`, and
`docs/KNOWN-ISSUES.md` for deeper history and constraints.

## Product intent

Ember is Brady Baxter's personal AI command center for Baxstar Fishing and Lakes
Golf Simulator. Treat OPS, Mission Control, Studio, and voice as surfaces of one
product. Optimize for a reliable daily operating system, not a collection of demos.

## Working preference

Brady explicitly welcomes routine use of [Ask Jev](plugin://dev-7ce8bdbda558819191a84ba67dd5fa90@openai-curated-remote).
Use it for everyday work as well as thoughtful, creative exploration; it does not
need an exceptional use case or separate permission for ordinary use. Check its
available tools and skills, give it useful context, and evaluate its output against
Ember's goals and constraints. If it is unavailable in the session, say so briefly
and continue useful work.

## Canonical files

- Edit `src/baxstar-ember.jsx` for application behavior and appearance.
- Edit `proxy/cloudflare-worker.js` for the live API proxy.
- Do not hand-edit `index.html`; regenerate it with `npm run build`.
- Do not treat `_preview.html` as source; regenerate it with `./start-ember.sh`.
- Reuse the assets and mappings under `assets/ember/`.

## Guardrails

- Preserve working behavior and avoid unrelated redesign.
- Never put API keys, OAuth tokens, credentials, or secrets in client files or Git.
- Preserve frozen IDs, storage keys, business contexts, and connector routing unless
  Brady explicitly changes them.
- Drafts, posts, replies, and tasks must remain reviewable before external action.
- Keep hosted chat usable when optional connectors are unavailable.
- Do not claim live microphone, OAuth, deployment, or device behavior is verified
  unless it was actually tested in that environment. Mark it PROVISIONAL otherwise.
- Keep generated outputs synchronized with their canonical source.

## Verification

For application changes:

1. Run `npm run build`.
2. Run `npm run test:worker` when the proxy or connector behavior could be affected.
3. Exercise the changed view in a browser at desktop and phone widths.
4. For voice changes, test what can be simulated and explicitly hand off the real-device
   cases that still require Brady's microphone or phone.

Before committing, inspect the changed-file list and staged diff, stage only task files,
and verify no secrets are present. This repository belongs to `baxstarcode`; normal
commits and pushes are expected after verified requested changes.
