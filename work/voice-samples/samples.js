const voices = { jenny: 'en-US-JennyNeural', aria: 'en-US-AriaNeural', michelle: 'en-US-MichelleNeural' };
const status = document.querySelector('#status');
const players = [...document.querySelectorAll('audio')];
const urls = new Map();
let pending, epoch = 0;
const session = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
function stop() {
  epoch++;
  pending?.abort(); pending = null;
  players.forEach(a => a.pause());
  session('auto');
}
for (const button of document.querySelectorAll('[data-voice]')) {
  button.addEventListener('click', async () => {
    stop();
    const key = button.dataset.voice, turn = epoch;
    const card = document.getElementById(key), player = card.querySelector('audio');
    const name = key[0].toUpperCase() + key.slice(1);
    status.textContent = `Preparing ${name}…`;
    const controller = new AbortController(); pending = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (!urls.has(key)) {
        const response = await fetch('/api/tts', {
          method: 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: document.querySelector('#sample').textContent, voice: voices[key] })
        });
        if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'Open Ember and sign in, then return here.' : `Speech service returned HTTP ${response.status}. Try again later.`);
        if (!(response.headers.get('content-type') || '').startsWith('audio/')) throw new Error('No audio returned. Open Ember and check your sign-in.');
        const blob = await response.blob();
        if (blob.size < 200 || blob.size > 2 * 1024 * 1024) throw new Error('The voice sample was empty or invalid.');
        if (turn !== epoch) return;
        urls.set(key, URL.createObjectURL(blob));
      }
      if (turn !== epoch) return;
      clearTimeout(timeout); pending = null;
      player.src = urls.get(key); player.hidden = false;
      const download = card.querySelector('a'); download.href = urls.get(key); download.hidden = false;
      session('playback');
      try { await player.play(); if (turn === epoch) status.textContent = `Playing ${name}.`; }
      catch { if (turn === epoch) { session('auto'); status.textContent = `${name} is ready. Tap Play on the audio player.`; } }
    } catch (error) {
      if (turn === epoch) { session('auto'); status.textContent = error.name === 'AbortError' ? 'The voice sample timed out. Tap the voice to retry.' : error.message; }
    } finally { clearTimeout(timeout); if (pending === controller) pending = null; }
  });
}
for (const player of players) {
  player.addEventListener('play', () => {
    // Native replay controls also cancel pending preparation and other samples.
    epoch++; pending?.abort(); pending = null;
    players.filter(a => a !== player).forEach(a => a.pause());
    session('playback'); status.textContent = `Playing ${player.getAttribute('aria-label')}.`;
  });
  player.addEventListener('ended', () => { if (players.every(a => a.paused)) { session('auto'); status.textContent = 'Sample finished. Try another voice.'; } });
  player.addEventListener('pause', () => { if (players.every(a => a.paused)) session('auto'); });
  player.addEventListener('error', () => { session('auto'); status.textContent = 'Audio could not play. Tap the voice to retry.'; });
}
document.querySelector('#stop').addEventListener('click', () => { stop(); status.textContent = 'Stopped.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); status.textContent = 'Paused. Tap a voice when you return.'; } });
window.addEventListener('pagehide', stop);
if (location.hostname !== 'ember.baxstarfishing.com') {
  document.querySelectorAll('[data-voice]').forEach(b => b.disabled = true);
  status.textContent = 'Open this comparison on ember.baxstarfishing.com to hear the voices.';
}
