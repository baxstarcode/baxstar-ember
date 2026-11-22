# Foreground voice hardening — November 21, 2026

**Review update, November 22:** Claude's findings were repaired on
`codex/ember-voice-review-fixes` from `77096b1`. The pre-tool lead-in regression
and both delayed-audio races were reproduced before repair. The first-lookup
allowance is guarded against a second lookup after tiny real answers. An audio
generation counter prevents stale playback without invalidating chat completion.
Decorative-only speech clips and extra sentence counts are filtered. See
`docs/CURRENT-STATE.md` for verification and the corrected speed qualification.

Brady wants faster, more natural conversation with no new paid voice service.
Keep Aria, the chosen model/effort, Google Drive reads, the large skull and the
desktop layout. The current task is not a native app, background voice rebuild,
or booking-app task. The November 21 changes were built on
`codex/ember-voice-hardening` from `d89baf9`; the executable authority is
`src/baxstar-ember.jsx`.

## This pass

- A short first complete sentence can enter TTS immediately. Previously the
  24-character minimum held “Yes.” until another sentence arrived. Abbreviations,
  initials and list numbers are not mistaken for complete sentences.
- Stop/close/hiding clears pending microphone retry state. A delayed recognition
  end previously could revive a cancelled retry and turn capture back on.
- A failed speech clip or chat turn cancels queued speech and stops current audio.
  Previously the UI could say the turn failed while an earlier clip kept playing.
- During active conversation, Space interrupts playback and listens; Escape
  stops voice, including while the skull has focus. Space preserves focused
  button/link activation; editing fields, dialogs, modified keys and key repeat
  retain their normal behavior. Keyboard hints are on existing controls.

The original retry race and continued-playback bug were reproduced against the
old build. The 6051 ms → 4143 ms short-answer measurement used a deliberate 1800 ms
pause after “Yes.” It proves earlier first sound in that stalled fixture, not a
general two-second improvement; playback can then fall silent awaiting the rest.
Claude's supplied continuous-stream comparison improved about 420 ms, and a
single sentence showed no meaningful improvement. Nothing measured phone speed.

## Focused second opinion for Claude

Review the above changes against main. Do not deploy or edit the Worker in
parallel with another builder. The existing unit/browser tests simulate speech
recognition; they cannot establish physical echo cancellation or CarPlay routing.

If investigating hands-free interruption, prove one narrow dependency first:
can the existing foreground browser stack hear the user during Aria playback
without recognizing its own output or degrading the phone/truck audio route?
Distinguish Chrome on Mac from iPhone/CarPlay. A microphone-live indicator or
synthetic browser event is not proof. No new paid provider, unbounded retry loop,
background workaround or always-on capture is authorized by this hardening pass.
Keep the shipped microphone-off-during-playback behavior until that proof exists.

## Continuity

Build/test/deploy details belong in `docs/CURRENT-STATE.md`. The cloud session
cannot update the shared Drive registry/relay; repository records are the durable
checkpoint. `docs/HANDOFF-GROK-VOICE-FEASIBILITY.md` is pre-existing untracked work
and was left untouched.
