import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, length, parseImport, parseTransfer, createBackup, validateEnvelope, rankSignals, ranking, deadlineState, triage, deduplicate, identity, metadataKey, effectiveStatus, freshness, safeUrl, clamp, formatDate } from '../../signal-log/core.mjs';
import { createAccountAdapter } from '../../signal-log/adapters.mjs';
const fixture = JSON.parse(await readFile(new URL('../../signal-log/example.json', import.meta.url)));
const demo = validateEnvelope(JSON.parse(await readFile(new URL('../../signal-log/demo.json', import.meta.url))));
const now = Date.parse(CONFIG.demoNow);
function data(patch = {}, envelope = {}) { return { ...structuredClone(fixture), ...envelope, signals: [{ ...structuredClone(fixture.signals[0]), ...patch }] }; }
function signal(patch) { return validateEnvelope(data(patch))[0]; }

test('all bundled cards obey summary and combined detail limits and have source links', () => {
  assert.equal(demo.length, 8);
  assert.equal(new Set(demo.flatMap(s => s.categories)).size, 5);
  for (const s of demo) { assert(length(s.summary) <= 200); assert(Object.values(s.details).reduce((n, s) => n + length(s), 0) <= 750); assert(s.sources.every(v => safeUrl(v.url))); assert(s.demo); }
  assert(demo.some(s => s.kind === 'good' && !s.actionable));
});
test('200/750 Unicode character boundaries are enforced without truncating', () => {
  assert.equal(signal({ summary: '🐟'.repeat(200) }).summary, '🐟'.repeat(200));
  assert.throws(() => signal({ summary: 'a'.repeat(201) }), /200/);
  assert.equal(signal({ details: { signal: 'a'.repeat(250), why: 'b'.repeat(250), next: 'c'.repeat(250), prompt: '' } }).details.next.length, 250);
  assert.throws(() => signal({ details: { signal: 'a'.repeat(250), why: 'b'.repeat(250), next: 'c'.repeat(250), prompt: 'x' } }), /750/);
});
test('bad JSON, huge files and excessive records fail atomically', () => {
  assert.throws(() => parseImport('{bad'), /Invalid JSON/);
  assert.throws(() => parseImport(' '.repeat(262145)), /256 KiB/);
  assert.throws(() => validateEnvelope({ ...data(), signals: Array(201).fill(fixture.signals[0]) }), /200/);
});
test('workspace/account/provider mismatch cannot be silently remapped', () => {
  assert.throws(() => validateEnvelope(data({}, { accountId: 'personal' })), /mismatch/);
  assert.throws(() => validateEnvelope(data({}, { workspaceId: 'future' })), /mismatch/);
  assert.throws(() => validateEnvelope(data({}, { source: 'oauth' })), /source/);
  assert.throws(() => parseImport(JSON.stringify(data({}, { source: 'demo' }))), /reserved/);
});
test('executable and credential-bearing links are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://user:secret@example.com', '//example.com']) {
    assert.equal(safeUrl(url), null); assert.throws(() => signal({ sources: [{ label: 'source', url }] }), /HTTPS/);
  }
});
test('hostile content remains literal and extra fields are stripped', () => {
  const s = signal({ title: '<img src=x onerror=alert(1)>', body: 'do not retain a raw email', token: 'do not retain credentials' });
  assert.match(s.title, /^<img/); assert.equal(s.body, undefined); assert.equal(s.token, undefined);
});
test('real dates require explicit zones; unknown/review dates never become hard deadlines', () => {
  for (const dueAt of ['2026-10-18', '2026-02-30T12:00:00Z', '2026-10-18T12:00:00']) assert.throws(() => signal({ dueAt, dueKind: 'hard' }));
  assert.throws(() => signal({ dueAt: CONFIG.demoNow, dueKind: 'unknown' }), /only a sourced/);
  assert.throws(() => signal({ dueKind: 'hard', dueAt: null }), /only a sourced/);
  const a = signal({ reviewAt: '2026-10-18T15:10:00Z' }), b = signal({ reviewAt: null });
  assert.deepEqual(ranking(a, now), ranking(b, now));
  assert.match(formatDate('2026-10-18T15:00:00Z'), /10:00 AM CDT/);
  assert.match(formatDate('2026-11-02T15:00:00Z'), /9:00 AM CST/);
});
test('numeric inputs cannot create NaN or out-of-range scores', () => {
  for (const patch of [{ impact: 6 }, { impact: '5' }, { confidence: 2 }, { effortMinutes: 0 }, { effortMinutes: Infinity }]) assert.throws(() => signal(patch));
  assert.equal(clamp(-1, 5, 240, 30), 5); assert.equal(clamp(999, 5, 240, 30), 240); assert.equal(clamp('bad', 5, 240, 30), 30);
});
test('importance tiers beat easy low-impact urgency; score is explainable', () => {
  const safety = signal({ id: 'safe', priority: 'safety', effortMinutes: 90, confidence: .2 });
  const easy = signal({ id: 'easy', impact: 1, dueAt: CONFIG.demoNow, dueKind: 'hard', effortMinutes: 1, confidence: 1 });
  assert.equal(rankSignals([easy, safety], now)[0].id, 'safe');
  const rank = ranking(safety, now); assert.equal(rank.score, Object.values(rank.components).reduce((a, b) => a + b, 0)); assert.match(rank.explanation, /confidence 3\/15/);
});
test('near material deadline has its own tier; distant deadline creates no fake urgency', () => {
  assert.equal(ranking(signal({ impact: 4, dueAt: '2026-10-19T12:00:00Z', dueKind: 'hard' }), now).tier, 1);
  assert.equal(ranking(signal({ impact: 4, dueAt: '2027-10-19T12:00:00Z', dueKind: 'hard' }), now).components.deadline, 0);
  assert.equal(ranking(signal({ dueAt: null, dueKind: 'unknown' }), now).components.deadline, 0);
});
test('rank order is deterministic across input orders', () => {
  assert.deepEqual(rankSignals(demo, now).map(s => s.id), rankSignals([...demo].reverse(), now).map(s => s.id));
});
test('months-old deadlines have no deadline urgency and are excluded pending verification', () => {
  const s = signal({ dueAt: '2026-01-01T12:00:00Z', dueKind: 'hard', impact: 5 });
  assert.equal(deadlineState(s, now).state, 'overdue-review'); assert.equal(ranking(s, now).components.deadline, 0); assert.equal(ranking(s, now).tier, 4);
  const result = triage([s], 30, now); assert.equal(result.selected.length, 0); assert.equal(result.verification.length, 1);
  const recent = { ...s, dueAt: '2026-10-17T12:00:00Z', id: 'a' };
  assert.equal(rankSignals([{ ...s, id: 'z' }, recent], now)[0].id, 'a', 'unverified old dates do not win the tie');
});
test('a current explicit overdue confirmation preserves a real obligation and expires', () => {
  const s = signal({ dueAt: '2026-09-01T12:00:00Z', dueKind: 'hard', overdueConfirmedAt: '2026-10-12T10:00:00Z', observedAt: '2026-10-12T11:00:00Z', impact: 5 });
  const current = Date.parse('2026-10-12T12:00:00Z');
  assert.equal(deadlineState(s, current).state, 'overdue-confirmed'); assert.equal(ranking(s, current).tier, 1); assert.equal(triage([s], 30, current).selected.length, 1);
  assert.equal(deadlineState(s, current + 86400000).state, 'overdue-review');
  assert.throws(() => signal({ dueKind: 'hard', dueAt: '2026-10-13T12:00:00Z', overdueConfirmedAt: '2026-10-12T10:00:00Z' }), /confirmation/);
});
test('backup round-trip preserves bounded source data and explicit dispositions without trusting old verification', () => {
  const s = { ...signal(), key: 'opaque', verifiedRead: true, provenance: 'Verified provider read' };
  const state = { read: true, status: 'waiting', snoozeUntil: null, observedAt: s.observedAt };
  const text = createBackup([s], new Map([['opaque', state]])); assert(!text.includes('verifiedRead')); assert(!text.includes('opaque'));
  const restored = parseTransfer(text); assert.equal(restored.type, 'backup'); assert.equal(restored.signals[0].summary, s.summary); assert.deepEqual(restored.states.get(identity(s)), state); assert.equal(restored.signals[0].verifiedRead, undefined);
});
test('backup account, link, state and duplicate-identity validation is atomic', () => {
  const s = { ...signal(), key: 'opaque' }, backup = JSON.parse(createBackup([s], new Map()));
  assert.throws(() => parseTransfer(JSON.stringify({ ...backup, accountId: 'wrong' })), /mismatch/);
  const badState = structuredClone(backup); badState.entries[0].disposition.status = '<script>'; assert.throws(() => parseTransfer(JSON.stringify(badState)), /disposition/);
  const badLink = structuredClone(backup); badLink.entries[0].record.sources[0].url = 'javascript:alert(1)'; assert.throws(() => parseTransfer(JSON.stringify(badLink)), /HTTPS/);
  assert.throws(() => parseTransfer(JSON.stringify({ ...backup, entries: [...backup.entries, ...backup.entries] })), /duplicate/);
  assert.throws(() => parseTransfer(' '.repeat(CONFIG.maxBackupBytes + 1)), /3 MiB/);
});
test('normal report limits remain 256 KiB; demo cannot be exported as private data', () => {
  assert.equal(parseTransfer(JSON.stringify(fixture)).type, 'report');
  assert.throws(() => parseTransfer(JSON.stringify({ ...fixture, ignored: 'x'.repeat(CONFIG.maxBytes) })), /256 KiB/);
  assert.throws(() => createBackup(demo, new Map()), /demo/);
});
test('triage fits cumulative budget and retains oversized/blocked critical work', () => {
  const plan = triage(demo, 15, now);
  assert(plan.used <= 15); assert(plan.selected.every(s => !s.blocked));
  assert(plan.review.some(s => s.id === 'software-capacity'));
  assert(plan.review.some(s => s.id === 'rental-readiness'));
  assert(!plan.selected.some(s => !s.actionable));
  assert.equal(triage([signal({ effortMinutes: null })], 30, now).selected.length, 0);
});
test('dedup uses scoped record/occurrence identity, never titles', () => {
  const a = signal(), b = signal({ id: 'another-message' });
  assert.equal(deduplicate([a, b]).length, 2);
  const otherOccurrence = { ...a, occurrenceAt: '2026-10-19T10:00:00Z' };
  assert.equal(deduplicate([a, otherOccurrence]).length, 2);
  assert.equal(deduplicate([a, { ...a, accountId: 'other' }]).length, 2);
  assert.equal(deduplicate([a, { ...a, source: 'manual' }]).length, 2);
});
test('latest source update wins, sources survive duplicates, cross-source merge needs explicit canonical identity', () => {
  const a = signal({ sourceUpdatedAt: '2026-10-12T10:30:00Z' }), b = { ...a, title: 'new', sourceUpdatedAt: '2026-10-13T10:30:00Z', sources: [{ label: 'second', url: 'https://example.org/' }] };
  const merged = deduplicate([b, a]); assert.equal(merged.length, 1); assert.equal(merged[0].title, 'new'); assert.equal(merged[0].sources.length, 2);
  const canonical = { ...a, canonicalSignalId: 'shared-claim' };
  assert.equal(deduplicate([canonical, { ...canonical, source: 'manual', id: 'report-two' }]).length, 1);
});
test('metadata keys are opaque and account/occurrence separated', async () => {
  const a = signal(); const key = await metadataKey(a); assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, await metadataKey({ ...a, accountId: 'other' })); assert.notEqual(key, await metadataKey({ ...a, occurrenceAt: '2026-10-19T10:00:00Z' }));
  assert.equal(key, await metadataKey({ ...a, summary: 'updated content' })); assert(!key.includes(a.id));
});
test('read is independent of completion; snoozes expire and decisions persist', () => {
  assert.equal(effectiveStatus({ read: true }, now), 'open');
  assert.equal(effectiveStatus({ status: 'snoozed', snoozeUntil: now - 1 }, now), 'open');
  assert.equal(effectiveStatus({ status: 'snoozed', snoozeUntil: now + 1 }, now), 'snoozed');
  for (const status of ['done', 'dismissed', 'accepted', 'waiting']) assert.equal(effectiveStatus({ status, read: false }, now), status);
});
test('freshness comes from observation; old and new remain distinct', () => {
  assert(freshness(demo.find(s => s.id === 'stale-source'), now).stale);
  assert(!freshness(demo.find(s => s.id === 'fishing-weather'), now).stale);
});
test('unwired adapter performs no read and reports exact missing path', async () => {
  const adapter = createAccountAdapter({ ...CONFIG, provider: 'gmail' });
  assert.equal((await adapter.read()).state, 'not-connected');
});
test('adapter failure uses a fixed message and does not expose provider error text', async () => {
  const adapter = createAccountAdapter({ ...CONFIG, provider: 'gmail', readVerifiedFeed: async () => { throw new Error('sensitive-provider-detail'); } });
  const result = await adapter.read(); assert.equal(result.state, 'unavailable'); assert(!JSON.stringify(result).includes('sensitive-provider-detail'));
});
test('account-attested adapter fails closed before accepting provider data', async () => {
  for (const verifiedAccount of [undefined, { workspaceId: 'other', accountId: CONFIG.accountId, provider: 'gmail' }, { workspaceId: CONFIG.workspaceId, accountId: 'other', provider: 'gmail' }]) {
    const a = createAccountAdapter({ ...CONFIG, provider: 'gmail', readVerifiedFeed: async () => ({ verifiedAccount, endToEndVerified: true, envelope: data({}, { source: 'gmail' }) }) });
    await assert.rejects(a.read(), /identity/);
  }
});
test('verified adapter contract is functional with synthetic host evidence, never inferred from credential status', async () => {
  let called;
  const a = createAccountAdapter({ ...CONFIG, provider: 'calendar', readVerifiedFeed: async input => {
    called = input; return { verifiedAccount: { workspaceId: CONFIG.workspaceId, accountId: CONFIG.accountId, provider: 'calendar' }, endToEndVerified: true, envelope: data({}, { source: 'calendar' }) };
  } });
  const result = await a.read(); assert.equal(result.state, 'verified'); assert.equal(called.limit, 200); assert.equal(result.signals[0].provenance, 'Verified provider read');
});
