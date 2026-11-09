# Muse Gadget SDK vs Ember — evaluation (2026-11-08)

Question (Brady): could Meta's Muse make Ember substantially more useful, as a
companion or even as a replacement for Ember's assistant? Source read:
[facebookincubator/muse-gadget-sdk](https://github.com/facebookincubator/muse-gadget-sdk)
at commit `463bd2a` (2026-11-06): README, `linux/`, `esp32/`, LICENSE, open issues.
**DOC** = stated in that repo. **2ND** = press/blog, not checked against Meta's pages.
**PROP** = proposal. The cloud session could not open gadgets.muse.ai, so **the Gadget
SDK Terms were not read**; Brady should read them before any build.

## What it is

- **DOC:** Muse is Meta's assistant in the Muse iOS/Android app; each account has a
  "Muse VM". A *gadget* is a device you build — an ESP32 board or a Linux box such as a
  Raspberry Pi — paired over Bluetooth with an SDK token and the app's Developer mode.
  No Meta glasses are mentioned.
- **DOC:** Muse can run commands on the gadget (`system.run`, file read/write, health,
  plus custom JSON-defined commands). The gadget can push text or an image into a Muse
  chat (`send-user-msg`) and wait up to 600 s for a text reply. Realtime voice is
  experimental.
- **DOC, by absence:** no general model API, no way to attach your own MCP servers, no
  supported access without a paired device.
- **DOC:** code is Apache-2.0; Linux package 0.1.0; no releases; 42 open issues and 71
  open PRs; the README calls it "just for fun".
- **2ND:** US launch 2026-09-08 with Free/$20/$100 monthly tiers; terms reportedly
  personal, non-commercial, revocable, "not a supported product".

## Options

| Option | Keeps Ember's UI, knowledge, Quo/Gmail/Calendar/Drive tools and review-first workflows? | Needs | Verdict |
|---|---|---|---|
| 1. Improve Ember's current backend (Claude + MCP connectors) | Yes, all of it | Nothing new | **Do this** |
| 2. Muse companion gadget (a Pi that answers Muse by calling Ember) | Ember stays intact; adds a second chat surface | Pi, Muse account, Access service token + new route; business data flows into Meta's VM; terms unverified for business use | Hobby experiment only, after Brady reads the terms |
| 3. Replace Ember's backend with Muse | No | A model API this SDK does not have | **Not feasible** with this SDK (2ND: a separate "Meta Model API" preview exists; switching would mean rebuilding every connector) |

## Ranked opportunities (benefit vs effort, PROP)

1. **Faster OPS sync** — cache feed results and use prompt caching in the Worker. Brady
   reported "sync is slow". ~1–2 days.
2. **Scheduled morning brief** — a Worker cron builds BRIEF MY DAY at dawn with the same
   read-only tools. ~2–3 days.
3. **Memory across phone and Mac** — keep the thread and a short business-facts memory
   in a Durable Object instead of one browser. ~3–5 days.
4. **Reviewed drafts** — Gmail drafts / Calendar proposals behind an Approve button.
   ~3–5 days plus a Google re-consent; scope change is Brady's decision.
5. **Voice provider fallback** — Jenny relies on the unofficial Edge TTS service. ~1–2 days.
6. Muse gadget (option 2). 7. Replacement (option 3, no supported path).

Already done on 2026-11-08: spoken replies now start on the first sentence (voice
latency), which was the biggest voice-speed lever inside Ember's own code.

## Recommendation

Keep Claude and the current Worker. Do items 1 and 2 next (about a week). Build a Muse
gadget only if Brady reads gadgets.muse.ai's SDK terms and is comfortable sending
business mail, call and calendar data to Meta. **No migration decision is due**: this
SDK offers no replacement path. A trial of Meta's separate model API would be its own
decision and would mean rebuilding the connectors; not recommended now.
