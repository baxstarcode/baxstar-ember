// Deterministic tests of the real probe script. No microphone, network, or TTS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(process.env.EMBER_VOICE_PROBE_SOURCE || new URL('./probe.js', import.meta.url), 'utf8');

function session({ mobile = false, preview = false } = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const elements = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const calls = { starts: 0, stops: 0, aborts: 0, fetches: 0 };
  const instances = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', checked: false, disabled: false, hidden: false,
      dataset: {}, listeners: new Map(),
      addEventListener(name, fn) { this.listeners.set(name, fn); },
      pause() {}, load() {}, removeAttribute() {}, focus() {}, select() {},
    });
    return elements.get(id);
  }
  class Recognition {
    constructor() { instances.push(this); }
    start() { calls.starts++; }
    stop() { calls.stops++; }
    abort() { calls.aborts++; }
  }
  const document = { hidden: false, getElementById: element,
    addEventListener: (name, fn) => documentEvents.set(name, fn) };
  const sandbox = {
    document, navigator: { userAgent: mobile ? 'iPhone' : 'Chrome desktop', platform: mobile ? 'iPhone' : 'Linux', maxTouchPoints: 0 },
    location: { origin: 'https://example.test', hostname: preview ? 'review.baxstar-ember.pages.dev' : 'example.test' }, isSecureContext: true,
    SpeechRecognition: mobile ? undefined : Recognition,
    webkitSpeechRecognition: mobile ? Recognition : undefined,
    HTMLMediaElement: class {}, URL, AbortController, Date,
    performance: { now: () => now },
    fetch: async () => { calls.fetches++; throw new Error('Unexpected network request'); },
    addEventListener: (name, fn) => windowEvents.set(name, fn),
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'probe.js' });
  function tick(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next; now = timer.due; timers.delete(id); timer.fn();
    }
    now = end;
  }
  function run(code) { return vm.runInContext(code, context); }
  function begin() { run('startTalking()'); const rec = instances.at(-1); rec.onstart(); return rec; }
  function result(rec, parts, resultIndex = 0) {
    const results = parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    rec.onresult({ results, resultIndex });
  }
  function hide() { document.hidden = true; documentEvents.get('visibilitychange')(); }
  return { run, begin, result, tick, calls, timers, element, instances, hide, windowEvents };
}

const phrase = (s, rec, words = 'Please let me finish.') => s.result(rec, [[words, true]]);

test('startup is quiet and recognition is continuous only after an explicit Talk', () => {
  const s = session(); assert.equal(s.calls.starts, 0); assert.equal(s.calls.fetches, 0);
  const rec = s.begin(); assert.equal(rec.continuous, true); assert.equal(s.calls.starts, 1);
});

test('no automatic stop at 749 ms; exactly one stop at 750 ms; release gates remain', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec);
  s.tick(749); assert.equal(s.calls.stops, 0); assert.equal(s.run('micPhase'), 'listening');
  assert.equal(s.element('send').disabled, true);
  s.tick(1); assert.equal(s.calls.stops, 1); assert.equal(s.run('micPhase'), 'stopping');
  assert.equal(s.element('send').disabled, true); assert.equal(s.element('play').disabled, true);
  rec.onend(); assert.equal(s.run('micPhase'), 'off'); assert.equal(s.element('send').disabled, false);
  assert.equal(s.calls.fetches, 0); assert.equal(s.calls.starts, 1);
});

for (const event of ['onspeechstart', 'onsoundstart']) {
  test(`${event} cancels pending stop before the next transcript arrives`, () => {
    const s = session(); const rec = s.begin(); phrase(s, rec); s.tick(500);
    assert.equal(typeof rec[event], 'function'); rec[event](); s.tick(1000);
    assert.equal(s.calls.stops, 0); assert.equal(s.run('micPhase'), 'listening');
    s.result(rec, [['Please let me finish.', true], ['One more thought.', true]], 1);
    s.tick(749); assert.equal(s.calls.stops, 0); s.tick(1); assert.equal(s.calls.stops, 1);
  });
}

test('cumulative interim speech cancels grace and final continuation gets a full new window', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec, 'First phrase.'); s.tick(500);
  s.result(rec, [['First phrase.', true], ['Second', false]], 1); s.tick(1000);
  assert.equal(s.calls.stops, 0); assert.equal(s.element('transcript').value, 'First phrase.');
  s.result(rec, [['First phrase.', true], ['Second phrase.', true]], 1);
  s.tick(749); assert.equal(s.calls.stops, 0); s.tick(1); assert.equal(s.calls.stops, 1);
  assert.equal(s.element('transcript').value, 'First phrase. Second phrase.');
});

for (const words of ['still talking', '']) {
  test(`final plus ${words ? 'nonempty' : 'empty'} interim never arms a cutoff`, () => {
    const s = session(); const rec = s.begin();
    s.result(rec, [['Earlier phrase.', true], [words, false]], 0); s.tick(1500);
    assert.equal(s.calls.stops, 0); assert.equal(s.run('micPhase'), 'listening');
  });
}

test('a changed result containing no new final does not finalize old text', () => {
  const s = session(); const rec = s.begin();
  s.result(rec, [['Earlier phrase.', true]], 1); s.tick(1000);
  assert.equal(s.calls.stops, 0);
});

test('manual Finish is immediate and cannot be doubled by a pending timer or late final', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.tick(100);
  s.run('finishTalking()'); assert.equal(s.calls.stops, 1);
  phrase(s, rec); s.run('finishTalking()'); s.tick(1000); assert.equal(s.calls.stops, 1);
  rec.onend(); assert.equal(rec.onspeechstart, null); assert.equal(rec.onsoundstart, null);
});

test('Cancel immediately aborts, clears grace, and detaches all speech callbacks', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.tick(100);
  s.run('stopAll()'); assert.equal(s.calls.aborts, 1);
  assert.equal(rec.onresult, null); assert.equal(rec.onspeechstart, null); assert.equal(rec.onsoundstart, null);
  rec.onend(); s.tick(1000); assert.equal(s.calls.stops, 0); assert.equal(s.calls.starts, 1);
});

test('tab hiding clears the pending grace and never restarts recognition', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.hide();
  assert.equal(s.calls.aborts, 1); rec.onend(); s.tick(1000);
  assert.equal(s.calls.stops, 0); assert.equal(s.calls.starts, 1); assert.equal(s.run('micPhase'), 'off');
});

test('pagehide clears grace and immediately requests release', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.windowEvents.get('pagehide')();
  assert.equal(s.calls.aborts, 1); rec.onend(); s.tick(1000); assert.equal(s.calls.stops, 0);
});

test('native recognition end during grace is respected; no automatic restart', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.tick(100); rec.onend(); s.tick(1000);
  assert.equal(s.calls.stops, 0); assert.equal(s.calls.starts, 1); assert.equal(s.run('micPhase'), 'off');
  assert.equal(s.element('transcript').value, 'Please let me finish.');
});

test('recognition errors clear grace and allow a new explicit turn after release', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); rec.onerror({ error: 'network' });
  assert.equal(s.calls.aborts, 1); rec.onend(); s.tick(1000); assert.equal(s.calls.stops, 0);
  const next = s.begin(); phrase(s, next); s.tick(750); assert.equal(s.calls.stops, 1);
});

test('cancelled timer callbacks cannot terminate a newer grace window in the same session', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec);
  const stale = [...s.timers.values()].find((t) => t.due === 750).fn;
  s.tick(500); s.result(rec, [['Please let me finish.', true], ['A continuation.', true]], 1);
  stale(); assert.equal(s.calls.stops, 0); s.tick(749); assert.equal(s.calls.stops, 0);
  s.tick(1); assert.equal(s.calls.stops, 1);
});

test('old recognition callbacks cannot alter the next explicit turn', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec);
  const staleActivity = rec.onspeechstart; const staleResult = rec.onresult;
  s.run('stopAll()'); rec.onend(); const next = s.begin(); phrase(s, next, 'Current turn.');
  staleActivity(); staleResult({ results: [] }); s.tick(750);
  assert.equal(s.calls.stops, 1); assert.equal(s.element('transcript').value, 'Current turn.');
});

test('stop timeout, abort timeout, and physical release confirmation remain enforced', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec); s.tick(750);
  s.tick(3000); assert.equal(s.calls.aborts, 1); assert.equal(s.run('micPhase'), 'releasing');
  s.tick(3000); assert.equal(s.run('micPhase'), 'unconfirmed');
  assert.equal(s.element('talk').disabled, true); assert.equal(s.element('send').disabled, true);
  s.element('confirm-release').listeners.get('click')(); assert.equal(s.run('micPhase'), 'off');
  assert.equal(rec.onend, null); assert.equal(rec.onspeechstart, null);
});

test('the existing 30-second listening cap is not extended by grace or interim speech', () => {
  const s = session(); const rec = s.begin(); s.tick(29900); phrase(s, rec); s.tick(100);
  assert.equal(s.calls.stops, 1); s.tick(750); assert.equal(s.calls.stops, 1);
});

test('mobile remains explicit opt-in; 750 ms applies to a prefixed recognition session', () => {
  const s = session({ mobile: true }); s.run('startTalking()'); assert.equal(s.calls.starts, 0);
  s.element('mobile-opt-in').checked = true; s.element('mobile-opt-in').listeners.get('change')();
  assert.equal(s.calls.starts, 0); const rec = s.begin(); phrase(s, rec); s.tick(750);
  assert.equal(s.calls.stops, 1); assert.equal(s.calls.fetches, 0);
});

test('reports include the configured grace but no transcript and remain provisional', () => {
  const s = session(); const rec = s.begin(); phrase(s, rec, 'PRIVATE SENTENCE MUST NOT LEAK'); s.tick(750); rec.onend();
  const report = s.run('report()'); assert.equal(report.environment.endOfSpeechGraceMs, 750);
  assert.match(report.status, /PROVISIONAL/); assert.equal(JSON.stringify(report).includes('PRIVATE SENTENCE'), false);
  assert.ok(report.events.some((e) => e.event === 'end-of-speech-grace-elapsed'));
});

test('API requests cannot start during the grace period', async () => {
  const s = session(); const rec = s.begin(); phrase(s, rec);
  await s.run('sendTranscript()'); await s.run('playResponse()');
  assert.equal(s.calls.fetches, 0); assert.equal(s.run('micPhase'), 'listening');
});

test('starting-phase manual Finish cancels permission/start without waiting for grace', () => {
  const s = session(); s.run('startTalking()'); const rec = s.instances.at(-1);
  s.run('finishTalking()'); assert.equal(s.calls.aborts, 1); assert.equal(s.calls.stops, 0);
  rec.onend(); assert.equal(s.run('micPhase'), 'off');
});

test('longer pause waits for 1600 ms and still stops exactly once', () => {
  const s = session(); s.element('pause-window').value = '1600';
  const rec = s.begin(); phrase(s, rec); s.tick(1599);
  assert.equal(s.calls.stops, 0); assert.equal(s.element('pause-window').disabled, true);
  s.tick(1); assert.equal(s.calls.stops, 1); rec.onend();
  assert.equal(s.element('pause-window').disabled, false);
  assert.equal(s.run('report()').environment.endOfSpeechGraceMs, 1600);
});

test('manual finish mode keeps the turn open after a final phrase without restarting it', () => {
  const s = session(); s.element('pause-window').value = '0';
  const rec = s.begin(); phrase(s, rec); s.tick(2500); assert.equal(s.calls.stops, 0);
  s.run('finishTalking()'); assert.equal(s.calls.stops, 1); rec.onend(); s.tick(5000);
  assert.equal(s.calls.starts, 1); assert.equal(s.element('send').disabled, false);
});

test('manual finish mode retains the bounded 30-second turn cap', () => {
  const s = session(); s.element('pause-window').value = '0';
  const rec = s.begin(); phrase(s, rec); s.tick(30000); assert.equal(s.calls.stops, 1);
});

test('preview can dictate and copy but cannot call protected APIs even directly', async () => {
  const s = session({ preview: true }); const rec = s.begin(); phrase(s, rec); s.tick(750); rec.onend();
  assert.equal(s.element('preview-notice').hidden, false);
  assert.equal(s.element('copy-transcript').disabled, false); assert.equal(s.element('send').disabled, true);
  await s.run('sendTranscript()'); await s.run('playResponse()'); assert.equal(s.calls.fetches, 0);
  assert.equal(s.run('report()').environment.previewHost, true);
});

test('invalid pause choices fall back to the original bounded grace', () => {
  const s = session(); s.element('pause-window').value = 'Infinity';
  const rec = s.begin(); phrase(s, rec); s.tick(750); assert.equal(s.calls.stops, 1);
});


test('tab hiding preserves provisional-only words as an unsent draft without fabricating final recognition', () => {
  const s = session(); const rec = s.begin();
  s.result(rec, [['Please help with this draft', false]]);
  const staleResult = rec.onresult;
  s.hide();
  assert.equal(s.element('transcript').value, 'Please help with this draft');
  assert.equal(s.element('draft-notice').hidden, false);
  assert.equal(s.calls.aborts, 1);
  assert.equal(s.calls.fetches, 0);
  assert.equal(s.calls.starts, 1);
  assert.equal(s.element('send').disabled, true);
  assert.match(s.element('message').textContent, /draft is kept/);
  assert.equal(s.run('"first-final-transcript" in turn.marks'), false);
  staleResult({ results: [Object.assign([{ transcript: 'late unwanted words' }], { isFinal: true })] });
  assert.equal(s.element('transcript').value, 'Please help with this draft');
  rec.onend();
  assert.equal(s.element('send').disabled, false);
  assert.equal(s.element('talk').textContent, 'Continue talking');
  assert.equal(s.calls.fetches, 0);
  assert.equal(s.run('JSON.stringify(report()).includes("Please help with this draft")'), false);
});

test('continued recording appends to the edited interrupted draft once across cumulative results and another interruption', () => {
  const s = session(); const rec = s.begin();
  s.result(rec, [['First final.', true], ['Partial words', false]]);
  s.hide(); rec.onend();
  assert.equal(s.element('transcript').value, 'First final. Partial words');
  s.element('transcript').value = 'Reviewed draft.';
  const next = s.begin();
  assert.equal(s.element('transcript').value, 'Reviewed draft.');
  assert.equal(s.run('"interrupted-draft-carried" in turn.marks'), true);
  s.result(next, [['New words.', true]]);
  s.result(next, [['New words.', true], ['More words', false]], 1);
  assert.equal(s.element('transcript').value, 'Reviewed draft. New words.');
  s.hide(); next.onend();
  assert.equal(s.element('transcript').value, 'Reviewed draft. New words. More words');
  s.windowEvents.get('pagehide')();
  assert.equal(s.element('transcript').value, 'Reviewed draft. New words. More words');
  assert.equal(s.calls.starts, 2);
  assert.equal(s.calls.fetches, 0);
});

test('interruption before any recognition words explains the empty draft and permits fresh Talk after release', () => {
  const s = session(); const rec = s.begin(); s.hide();
  assert.equal(s.element('transcript').value, '');
  assert.match(s.element('message').textContent, /before the browser returned any words/);
  rec.onend();
  assert.equal(s.element('draft-notice').hidden, true);
  assert.equal(s.element('talk').textContent, 'Talk');
  assert.equal(s.element('send').disabled, true);
  assert.equal(s.calls.starts, 1);
});

test('direct pagehide also preserves received words, bounded to the existing transcript limit', () => {
  const s = session(); const rec = s.begin();
  s.result(rec, [['a'.repeat(990), true], ['b'.repeat(50), false]]);
  s.windowEvents.get('pagehide')(); rec.onend();
  assert.equal(s.element('transcript').value.length, 1000);
  assert.equal(s.element('transcript').value, 'a'.repeat(990) + ' ' + 'b'.repeat(9));
  assert.equal(s.calls.fetches, 0);
});

test('clearing an interrupted draft explicitly starts fresh and explicit Cancel does not promote provisional words', () => {
  const s = session(); const rec = s.begin();
  s.result(rec, [['Keep temporarily', false]]); s.hide(); rec.onend();
  s.element('transcript').value = '';
  s.element('transcript').listeners.get('input')();
  assert.equal(s.element('talk').textContent, 'Talk');
  assert.equal(s.element('draft-notice').hidden, true);
  const next = s.begin();
  assert.equal(s.run('"interrupted-draft-carried" in turn.marks'), false);
  s.result(next, [['Discard this provisional speech', false]]);
  s.run('stopAll()'); next.onend();
  assert.equal(s.element('transcript').value, '');
});
