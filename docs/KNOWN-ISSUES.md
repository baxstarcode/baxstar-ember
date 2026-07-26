# Known Issues

Verified against the code in this repo. Fix these rather than rediscover them.

---

## 1. `index.html` has no Tailwind — layout collapses when hosted

**Severity:** blocks deployment
**Verified:** yes

`src/baxstar-ember.jsx` uses Tailwind utility classes throughout — `flex items-center gap-3`, `rounded-full`, `text-[13px]`, `grid`, `absolute`, and so on.

`index.html` loads exactly three scripts:

```
react@18 (UMD)
react-dom@18 (UMD)
@babel/standalone
```

No Tailwind. Its inline `<style>` blocks total ~16KB and contain the custom Ember CSS — variables (`--ember-red`, `--ember-orange`, `--ember-amber`, `--panel`, `--line`), panel styling, animations. Zero utility class definitions.

**Result when hosted:** colors and panel treatments survive; all layout, spacing, and alignment collapse into a stacked column.

**Fix, pick one:**
- Add the Tailwind Play CDN script to `<head>` — fastest, adds a runtime dependency and a flash of unstyled content
- Compile the used utilities into the inline stylesheet — heavier lift, fully self-contained, better for a premium feel

---

## 2. `index.html` has no API auth — hosted Ember has a dead brain

**Severity:** blocks deployment
**Verified:** yes

The app calls:

```js
fetch("https://api.anthropic.com/v1/messages", { ... })
```

with no `x-api-key` and no `Authorization` header. That works **only** inside a Claude artifact, where the platform injects credentials. Hosted anywhere else it fails on authentication and CORS — the UI loads and every chat, Drive query, and MCP call dies.

**Fix:** stand up a thin proxy that holds the key server-side and forwards to the Anthropic API — Cloudflare Worker, Netlify Function, or Vercel Edge Function. Point the app's fetch at the proxy.

**Never ship an API key in client-side code.** Anything in `index.html` is public the moment it's hosted.

---

## 3. Voice layer is not connected to the app

**Severity:** feature gap, not a bug
**Verified:** yes

`voice/` and `src/` are separate codebases. The voice rig's speech recognition, voice selection, MP3 fallback, and audio meter are solid and worth keeping verbatim. What it lacks is a real brain — `emberReply()` in `ember-demo.html` is hardcoded string matching over about a dozen keyword groups.

**Fix:** replace `emberReply()` with a call into the app's existing `callClaude()` path, so spoken questions route through the real system contexts and MCP tools. Write spoken replies for the ear — no bullet syntax, no URLs, numbers spoken the way a person says them.

---

## 4. Visual identity is mid-transition

**Severity:** cosmetic, but it's the whole point
**Verified:** yes

Comic-book DNA still in the code:
- `BURST_WORDS` — `["ZOWIE!", "POW!", "BAM!", "WHAM!", "ZING!", "SNAP!", "BOOM!", "KAPOW!"]`
- Emoji tool icons — 💬 🔀 ✍️ 🌐 🎛️ 📋
- `Big Shoulders Display` as the display face — reads sports-poster, not watchmaker

Palette conflicts with the steampunk direction:
- `--ember-ice: #5dd8ff`
- Background presets "Glacier Lake" and "Violet Sky"

Target direction is documented in `BUILD-PROMPT.md` §3. Warm metals only; no blues, no purples.

---

## 5. Version sprawl (resolved by this repo)

Eight copies of the app existed across Downloads and chat artifacts with browser-numbered filenames. Two were byte-identical to the newest; the rest were older iterations. `src/baxstar-ember.jsx` here is the newest of the set and is now the only copy that matters. Older iterations were not imported — this repo starts clean.
