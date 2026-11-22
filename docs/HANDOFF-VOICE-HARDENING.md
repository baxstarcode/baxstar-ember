# Foreground voice hardening — November 21, 2026

Brady wants faster, more natural conversation with no new paid voice service.
Keep Aria, the chosen model/effort, Google Drive reads, the large skull and the
desktop layout. The current task is not a native app, background voice rebuild,
or booking-app task. Changes are on `codex/ember-voice-hardening`, based on
`d89baf9`; the executable authority is `src/baxstar-ember.jsx`.

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
old build. The controlled short-answer test measured about 6051 ms before and
4143 ms after to first sound, with unchanged simulated provider timings. These
are not measurements of Brady's phone, real model latency or real speech service.

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
