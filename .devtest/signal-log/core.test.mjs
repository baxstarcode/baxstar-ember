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

// ---- live feed projection (signal-log/ember-feed.mjs) ----
const feed = await import('../../signal-log/ember-feed.mjs');
const feedNow = new Date('2026-10-21T18:00:00Z');
const reply = (provider, signals, { ok = true, text = JSON.stringify({ signals }) } = {}) => ({
  type: 'message', model: 'claude-haiku-5-5',
  content: [
    { type: 'mcp_tool_use', id: 'call-1', server_name: provider, name: 'search' },
    { type: 'mcp_tool_result', tool_use_id: 'call-1', is_error: !ok, content: [] },
    { type: 'text', text: '```json\n' + text + '\n```' },
  ],
});
test('feed prompt is bounded, provider-specific and demands JSON only', () => {
  const gmail = feed.buildPrompt('gmail', feedNow), calendar = feed.buildPrompt('calendar', feedNow);
  assert.match(gmail, /ONLY the Gmail tool/); assert.match(gmail, /2026-10-14T18:00:00.000Z/); assert.match(gmail, /At most 25 messages/);
  assert.match(calendar, /ONLY the Calendar tool/); assert.match(calendar, /2026-10-19T18:00:00.000Z/); assert.match(calendar, /2026-11-04T18:00:00.000Z/); assert.match(calendar, /At most 40 events/);
  const quo = feed.buildPrompt('quo', feedNow);
  assert.match(quo, /ONLY the Quo tools/); assert.match(quo, /createdAfter with that exact timestamp/); assert.match(quo, /2026-10-19T18:00:00.000Z/); assert.match(quo, /At most 20 records/); assert.match(quo, /218-325-6857/); assert.match(quo, /218-325-9846/);
  for (const p of [gmail, calendar, quo]) { assert.match(p, /ONLY valid JSON/); assert.match(p, /Never invent facts/); }
});
test('quo projection links to the inbox, keeps voicemail text in the signal and validates as a quo envelope', () => {
  const { signals, dropped } = feed.projectSignals('quo', { signals: [
    { id: 'call-77', title: 'Voicemail · (701) 555-0142 · Pontoon', summary: 'Asks what is open the weekend of the 18th.', signal: 'Voicemail: "Looking at a 3-day pontoon rental for the weekend of the 18th — what is still open?"', why: 'Rental revenue.', next: 'Call back with availability.', categories: ['rentals'], kind: 'attention', priority: 'waiting', impact: 3, effortMinutes: 5, confidence: 0.8, actionable: true, sourceUpdatedAt: '2026-10-21T01:41:00Z', link: 'javascript:alert(1)' },
    { id: 'call-78', title: 'Missed call · (218) 555-0977 · Fishing', summary: 'No voicemail.', kind: 'information', actionable: false, categories: ['fishing'] },
  ] }, feedNow);
  assert.equal(dropped, 0); assert.equal(signals.length, 2);
  assert.deepEqual(signals[0].sources, [{ label: 'Open Quo', url: 'https://app.quo.com/' }]); assert.match(signals[0].details.signal, /3-day pontoon rental/);
  assert.equal(signals[1].actionable, false); assert.equal(signals[1].sources[0].url, 'https://app.quo.com/');
  assert.doesNotThrow(() => validateEnvelope({ version: 1, workspaceId: 'baxstar', accountId: 'baxstar-fishing', source: 'quo', signals }));
  assert.throws(() => validateEnvelope({ version: 1, workspaceId: 'baxstar', accountId: 'baxstar-fishing', source: 'sms', signals }), /unsupported/);
});
test('a provider is verified only by its own successful tool result', () => {
  assert(feed.succeededConnectors(reply('gmail', [])).has('gmail'));
  assert(!feed.succeededConnectors(reply('gmail', [], { ok: false })).has('gmail'));
  assert(!feed.succeededConnectors({ content: [{ type: 'mcp_tool_result', tool_use_id: 'orphan', is_error: false }, { type: 'text', text: '{}' }] }).has('gmail'));
  assert.deepEqual(feed.extractJSON(reply('gmail', [{ id: 'x' }])), { signals: [{ id: 'x' }] });
  assert.throws(() => feed.extractJSON({ content: [{ type: 'text', text: 'no json here' }] }), /no JSON/);
});
test('projection coerces model output into the v1 contract and drops only the bad record', () => {
  const { signals, dropped } = feed.projectSignals('gmail', { signals: [
    { id: 'msg-1', link: 'https://mail.google.com/mail/u/0/#all/msg-1', title: 'T'.repeat(120), summary: 'S'.repeat(400), signal: 'Customer asks about a 3-day pontoon rental.', why: 'Revenue.', next: 'Reply with availability.', prompt: 'Draft a reply', categories: ['rentals', 'bogus'], kind: 'attention', priority: 'waiting', impact: '9', effortMinutes: 7.4, confidence: 1.7, actionable: true, dueAt: '2026-10-24T15:00:00Z', sourceUpdatedAt: '2026-10-21T09:00:00-05:00' },
    { id: 'msg-2', title: 'Newsletter', summary: 'FYI', categories: [], kind: 'nonsense', priority: 'weird', impact: null, confidence: 'high', actionable: false, link: 'javascript:alert(1)' },
    { title: 'no id' },
    'garbage',
  ] }, feedNow);
  assert.equal(dropped, 2); assert.equal(signals.length, 2);
  const [a, b] = signals;
  assert.equal(a.title.length, 90); assert.equal([...a.summary].length, 200); assert(a.summary.endsWith('…'));
  assert.deepEqual(a.categories, ['rentals']); assert.equal(a.impact, 5); assert.equal(a.effortMinutes, 7); assert.equal(a.confidence, 1);
  assert.equal(a.dueKind, 'hard'); assert.equal(a.dueAt, '2026-10-24T15:00:00.000Z'); assert.equal(a.sourceUpdatedAt, '2026-10-21T14:00:00.000Z'); assert.equal(a.observedAt, feedNow.toISOString());
  assert.deepEqual(a.sources, [{ label: 'Open in Gmail', url: 'https://mail.google.com/mail/u/0/#all/msg-1' }]);
  assert.equal(b.kind, 'information'); assert.equal(b.priority, 'routine'); assert.equal(b.impact, 2); assert.equal(b.confidence, 0.6); assert.equal(b.actionable, false); assert.equal(b.effortMinutes, null); assert.equal(b.dueKind, 'none');
  assert.deepEqual(b.categories, ['fishing']); assert.equal(b.sources[0].url, 'https://mail.google.com/mail/u/0/#all/msg-2');
  assert.doesNotThrow(() => validateEnvelope({ version: 1, workspaceId: 'baxstar', accountId: 'baxstar-fishing', source: 'gmail', signals }));
});
test('calendar projection keeps occurrence identity and never turns a past start into a deadline', () => {
  const { signals } = feed.projectSignals('calendar', { signals: [
    { id: 'evt-1/2026-10-23T13:00:00Z', occurrenceAt: '2026-10-23T08:00:00-05:00', dueAt: '2026-10-23T08:00:00-05:00', title: 'Guided trip', summary: 'Party of 4', kind: 'attention', actionable: true, categories: ['fishing'], link: 'https://www.google.com/calendar/event?eid=abc' },
    { id: 'evt-0', occurrenceAt: '2026-10-21T08:00:00-05:00', dueAt: '2026-10-21T08:00:00-05:00', title: 'Past turnover', summary: 'Done yesterday', kind: 'information', actionable: false, categories: ['rentals'] },
  ] }, feedNow);
  assert.equal(signals[0].occurrenceAt, '2026-10-23T13:00:00.000Z'); assert.equal(signals[0].dueKind, 'hard'); assert.equal(signals[0].sources[0].url, 'https://www.google.com/calendar/event?eid=abc');
  assert.equal(signals[1].dueAt, null); assert.equal(signals[1].dueKind, 'none'); assert.equal(signals[1].sources[0].url, 'https://calendar.google.com/calendar/u/0/r/day/2026/10/21');
});
test('readFeed refuses non-production hosts, Access login pages, errors and unverified replies; accepts a verified one', async () => {
  await assert.rejects(feed.readFeed('gmail', { fetchImpl: async () => { throw new Error('must not fetch'); } }), /only on ember.baxstarfishing.com/);
  globalThis.window = { __emberSignalFeedAnyHost: true }; globalThis.location = { hostname: '127.0.0.1' };
  const respond = (body, { status = 200, headers = {} } = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  await assert.rejects(feed.readFeed('gmail', { fetchImpl: respond('<html>login</html>', { headers: { 'content-type': 'text/html' } }) }), /Sign in to Ember/);
  await assert.rejects(feed.readFeed('gmail', { fetchImpl: respond({ error: { message: 'Model not allowed.' } }, { status: 400 }) }), /Model not allowed/);
  await assert.rejects(feed.readFeed('gmail', { fetchImpl: respond(reply('gmail', [], { ok: false })) }), /no successful tool result/);
  await assert.rejects(feed.readFeed('gmail', { fetchImpl: respond(reply('gmail', []), { headers: { 'x-ember-connectors': 'degraded' } }) }), /no successful tool result/);
  await assert.rejects(feed.readFeed('calendar', { fetchImpl: respond(reply('gmail', [])) }), /no successful tool result/);
  await assert.rejects(feed.readFeed('quo', { fetchImpl: respond(reply('gmail', [])) }), /Quo returned no successful tool result/);
  let sent;
  const result = await feed.readFeed('gmail', { now: feedNow, fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify(reply('gmail', [{ id: 'm1', title: 'Hi', summary: 'Hello', kind: 'information', categories: ['software'] }, { nope: true }])), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  assert.equal(sent.url, '/api/messages'); assert.equal(sent.body.model, 'claude-haiku-5-5'); assert.deepEqual(sent.body.mcp_servers, [{ name: 'gmail' }]); assert.deepEqual(sent.body.output_config, { effort: 'low' }); assert.equal(sent.body.max_tokens, 6000);
  assert.equal(result.endToEndVerified, true); assert.deepEqual(result.verifiedAccount, { workspaceId: 'baxstar', accountId: 'baxstar-fishing', provider: 'gmail' });
  assert.equal(result.envelope.source, 'gmail'); assert.equal(result.envelope.signals.length, 1); assert.equal(result.dropped, 1);
  delete globalThis.window; delete globalThis.location;
});
