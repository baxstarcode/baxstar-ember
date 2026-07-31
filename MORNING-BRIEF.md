# Morning brief — 31 July

Overnight work on `claude/baxstar-emper-repository-7rikvg`. Nothing was merged
and production was not touched.

---

## Needs your hands

**1. Try the voice branch before it merges.** ~10 minutes.

<https://claude-baxstar-emper-reposit.baxstar-ember.pages.dev>

Four things, in this order — they're where the remaining risk sits:

- ask her something and **talk over her mid-answer** → your command should run
  when she finishes, not get dropped, and not cut her off
- **hit STOP mid-answer** → she stops, and the next command still works
- **close the mic popup while she's talking** → app keeps accepting commands
- ask something with **prices or times** in the answer ("what's the trip total")
  → the mic shouldn't reopen until she's actually finished speaking

If any of those misbehave, tell me what you heard. That's a far better target
than another review round.

**2. Deploy the Worker by hand.** It isn't Git-connected, so the OAuth code in
`proxy/cloudflare-worker.js` is sitting in the branch doing nothing until you
paste it into the Cloudflare dashboard.

**3. Then run the OAuth flow, once per provider.** After the Worker is deployed:

- set `OAUTH_STATE_SECRET` (any long random string) and `OAUTH_REDIRECT_URI`
  (your Worker's `/oauth/callback` URL) in Worker → Settings → Variables
- visit `/oauth/start?p=google`, click Allow
- copy the refresh token it shows into `MCP_REFRESH_GMAIL`,
  `MCP_REFRESH_CALENDAR` and `MCP_REFRESH_GDRIVE` (same value, all three)
- visit `/oauth/start?p=quo`, click Allow, paste into `MCP_REFRESH_QUO`, and
  also set `QUO_CLIENT_ID` to the id shown
- redeploy

The Worker can't write its own secrets — that's why this is copy-paste. Giving
it a Cloudflare API token that could write them would mean a compromised proxy
could rewrite its own config.

---

## What shipped to the branch

**Voice: mic gating + command queue** (PR #5, still draft)

The mic is muted while she speaks, so she stops hearing her own replies.
Commands spoken over the top of her are queued and run when she finishes.

**Worker: connectors degrade instead of taking chat down**

One dead connector used to make the API reject the whole request, so a stale
Gmail token took plain chat with it. Now the connector is dropped and chat
answers anyway, with an `x-ember-connectors: degraded` header so the panels can
say "offline" instead of guessing.

**Worker: OAuth plumbing** (new, needs the manual deploy above)

`/oauth/start` and `/oauth/callback` with PKCE S256, per-request refresh →
access token with a short in-isolate cache. 33 tests, `npm run test:worker`,
all offline against a stubbed fetch.

---

## Why PR #5 is still a draft

I did not merge it, and I'd rather you drove the decision.

The voice gate went through five passes. Each one fixed the last pass's bugs
and introduced new ones:

| pass | what adversarial review found |
|---|---|
| 1 — initial gate | 13 defects |
| 2 — rework | 2 permanent lockups (app dead until reload) |
| 3 — lockup fix | promise release ended the *wrong* utterance |
| 4 — ownership fix | a queue-wide `synth.cancel()` silenced the reply it was guarding |
| 5 — ownership fixes | 3 HIGH: the anti-lockup ceiling *caused* a lockup; VOICE TEST talked over her; STOP was swallowed |
| 6 — current | the fixes for pass 5 |

It has not converged. The pass-5 review was the most damning: the 60-second
ceiling I added *as* the anti-lockup safety valve turned out to create one —
it released the waiting promise but never reopened the mic, so a stalled audio
stream left the gate shut until reload. That is the same bug class as pass 2,
reintroduced by its own fix.

Pass 6 fixes all three HIGH findings and each is covered by a simulation that
fails against the old code. But pass 6 is itself unreviewed, which is exactly
what I said about pass 5.

What's actually verified: three headless concurrency simulations (lockup
recovery, promise ownership, echo window), the generated bridge script parses
with its guards intact, the app mounts in headless Chromium, and the Pages
preview builds. The ownership simulation fails against the pre-fix logic, so
it's discriminating rather than decorative.

What is *not* verified: any of it against a real microphone, a real voice, or
your phone. Every remaining failure mode is timing-dependent on the actual
speech engine, which is exactly what a simulation can't reach. Hence the ask
at the top.

---

## Still open

- **PR #5 merge** — waiting on your 10 minutes with the preview
- **Worker deploy + OAuth consent** — manual, above
- **A second PR** for the Worker OAuth code, opened as a draft off the same
  branch
- **My actual recommendation: stop patching this and rewrite `speak()`.** Six
  passes have each fixed the last and broken something new. The file now
  carries four overlapping concurrency mechanisms — an epoch counter, a
  promise-ownership token, per-path watchdogs, and a global ceiling — and the
  last three bugs all came from them disagreeing with each other. That is a
  design problem, not a bug-count problem. A single explicit state machine for
  one utterance (idle → starting → speaking → ending) would make most of these
  states unrepresentable instead of merely guarded. I'd rather spend a session
  on that than a seventh patch.

---

## Notes

Two automated review rounds came back empty for infrastructure reasons, not
because the code was clean — one died on schema validation, one had every tool
call blocked by a permission fault. Both were discarded rather than read as a
pass. The reviews I acted on were run by inlining the diff into the prompt so
the reviewers needed no tools at all.
