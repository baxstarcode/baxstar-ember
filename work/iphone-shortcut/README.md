# Talk to Ember — iPhone Shortcut

**Prepared, not live. Native import and physical iPhone behavior: PROVISIONAL.**

Brady's direction: “both. start with talking to ember.” This work starts the native
voice shortcut. The Photos → Caption Studio workflow comes afterward.

Tap **Talk to Ember** → speak → tap **Done** → hear Ember's reply and see its text.
Dictation stops **On Tap**, so a short pause does not intentionally submit the question.
Each run is a fresh question. It does not read or update the browser's conversation
history. There is no wake word, background listener, automatic restart, sending,
posting, or task creation. Existing read-only inbox/calendar tools remain available
through the Worker when their credentials work.

## Files and validation

- `Talk-to-Ember.unsigned.shortcut`: blank XML plist source; **not yet installable as a signed download**.
- `build-shortcut.py`: deterministic generator using Python's standard library.
- `validate-shortcut.py`: validates the generated plist and action references.
- `sign-shortcut.command`: Mac-only Apple signing and import of the blank template.
- `../../functions/api/voice.js` and `../../server/iphone-voice.mjs`: disabled-by-default native voice endpoint.
- `../../.devtest/iphone-voice.test.mjs`: signed-JWT, error, deadline and real Worker contract checks.

```bash
npm run test:iphone-shortcut
```

Offline checks passed: 46 endpoint tests, generated-plist structural checks and the
existing Worker's 193 checks. No provider, microphone, speaker, Apple import or live
Cloudflare behavior is established by those checks. The full repository release gate
has **not** run in this preparation workspace; do not merge/deploy on targeted tests alone.

## Cloudflare setup — before enabling

Use the existing `baxstar-ember` Pages project and `EMBER_API` service binding.
The exact `functions/api/voice.js` route takes precedence over the catch-all gateway.
No Worker source change or Worker redeployment is required by this feature.

1. Inspect current Access applications and preserve the whole-host browser gate.
2. Create a separate self-hosted Access application for the exact path
   `ember.baxstarfishing.com/api/voice`. Use a **Service Auth** policy permitting only
   one dedicated **Ember iPhone** service token. Use an expiring token (30 days for the
   first trial), with no Bypass/Everyone/Any valid service token rule. Do not add the
   phone token to the main browser application's policies.
3. Brady stores the token's Client ID and Client Secret privately and enters them into
   the Shortcut on his own device. Do not put either in Git, screenshots or handoff logs.
   Do not paste the Client Secret into chat. The secret exists only in Cloudflare and
   the installed Shortcut; it grants paid AI requests and read access to connected data.
   A configured Shortcut must not be shared; revoke its token if it is exposed.
4. Set these **production Pages environment variables**. Values other than the enable
   flag come from the actual Access configuration; do not invent them:

   | Variable | Value |
   | --- | --- |
   | `EMBER_ACCESS_TEAM_DOMAIN` | `https://<actual-team>.cloudflareaccess.com`, without trailing slash |
   | `EMBER_VOICE_AUD` | AUD tag of the new exact-path Access application |
   | `EMBER_VOICE_CLIENT_ID` | Client ID of the dedicated phone service token |
   | `EMBER_VOICE_ENABLED` | Keep `false` until policy and deployment are ready; then `true` for the controlled test |

   The adapter verifies the Access JWT's RS256 signature, issuer, audience, service
   identity and lifetime. Merely supplying an Origin header, a browser identity or a
   made-up JWT cannot authorize a request. Public Pages/Worker aliases are denied.
5. De-drift against current `main`, run `npm run test:release`, review the exact diff,
   then follow the existing Pages release process. Environment changes require a new
   deployment. Preview variables should leave voice disabled.
6. Prove missing/wrong/expired credentials fail; the correct phone token works only on
   `/api/voice`; that token cannot authorize `/`, `/api/messages` or `/api/outbox` without
   a separate browser session; Pages aliases remain blocked. Only then run one live
   question and record the actual result. A returned MP3 is not proof of audible playback.

Cloudflare connector access was unavailable during preparation. Browser fallback
requires Brady's permission. No Access application, token, variable or production
deployment was changed during preparation.

## Apple signing and phone installation

After the route passes the controlled live test:

1. Download the **blank** unsigned file and `sign-shortcut.command` together to a Mac.
2. Run `bash sign-shortcut.command`. This invokes Apple's `shortcuts sign --mode anyone`
   and opens the result in Shortcuts. Apple receives the blank template to validate it;
   the script refuses a template with populated credential fields.
3. Answer the two import questions with the dedicated phone token's Client ID and
   Client Secret. If import does not show the questions, fill the two blank Text
   actions in the Shortcut editor before running it. Never export this configured copy.
4. Sync Shortcuts to the iPhone with the same Apple account, or transfer the signed
   **blank** file to the phone and configure it there. Add **Talk to Ember** to the Home
   Screen after the first successful phone test.
5. Allow Dictation and access to `ember.baxstarfishing.com` when iOS asks. Start with the
   unlocked phone and the Shortcuts app in the foreground.

If Apple rejects the generated source, record the exact error and build the equivalent
actions in Apple's editor. Do not use a third-party signing/upload service or claim
that plist validation proves native compatibility.

## Equivalent actions in the Shortcuts editor

1. **Text**: phone Client ID. **Text**: phone Client Secret. Keep both private.
2. **Dictate Text**: English (US), stop listening **On Tap**. If empty, stop.
3. **Get Contents of URL**: `https://ember.baxstarfishing.com/api/voice`, POST.
   Add headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` using the two Text
   variables. JSON request body: key `text`, value the **Dictated Text** magic variable.
4. Get dictionary values `reply`, `speech`, `audio_base64` from the URL result.
5. If `audio_base64` has a value: **Base64 Encode**, mode **Decode** → **Set Name** to
   `Ember-reply.mp3` → **Play Sound**. Otherwise **Speak Text** using `speech`.
6. **Show Result** using `reply`.

Apple may stop the URL action on network/authentication errors before later actions
run. A Cloudflare login page is an authentication failure, not a JSON reply. Do not
silently retry: another run may incur another provider request.

## Physical acceptance gate

Record the iPhone model, iOS version and outcome; all rows are currently **NOT TESTED**.

| Check | Pass requirement |
| --- | --- |
| Import/setup | Apple accepts the signed file, prompts bind to the two correct fields |
| Long pause | Pause mid-sentence, resume, then tap Done; the complete question arrives |
| Repeated turns | Five separate runs, each dictating once and playing one reply |
| Audio | Ember's MP3 is audible; a forced TTS failure uses native speech and still displays text |
| Permission denial | Deny Dictation/network access; recover after changing the relevant permission |
| Interruption | Cancel, lock/unlock or receive a call; no stuck recording or duplicate request |
| Live data | Ask one bounded inbox/calendar question; data or an explicit unavailable message |
| Authentication | Revoke the trial token; the Shortcut loses access while browser Ember still works |

No automatic conversation memory or photo handling is included in this first gate.
The adapter limits questions to 2000 characters and replies to 600 output tokens.
It applies 28-second chat and 10-second TTS deadlines; timeouts do not prove provider
cancellation. The existing Worker can retry a connector failure without connectors;
the adapter adds no AI retries. Voice uses an excerpt if a reply exceeds the TTS limit,
while retaining the complete available text on screen and marking incomplete output.

## Rollback and continuity

Set `EMBER_VOICE_ENABLED=false` and redeploy Pages, or revoke the dedicated service
token for immediate edge denial. Existing browser chat is unchanged. Remove only the
new exact-path Access application when retiring the experiment; preserve the main gate.

Preparation base: `5d60c83b34ec18af9d8202a5a5604cab5bb3528d`.
Snapshot: `snapshot/iphone-shortcut-20261005`.
Work branch: `codex/ember-iphone-shortcut`.
Build registry ownership remains **unclaimed**: automatic approval review rejected
transmitting the registry credential to the Apps Script endpoint. Do not retry by
another route. Resolve that approval before shared deployment work.

Primary references: [Apple signing](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac),
[Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[service-token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/),
and [Cherri's native action definitions](https://github.com/electrikmilk/cherri/tree/main/actions).
