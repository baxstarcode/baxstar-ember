// Pure Signal Log contract and ranking. Imported content is data, never code.
export const CONFIG = Object.freeze({
  title: 'Ember · Signal Log', timezone: 'America/Chicago',
  workspaceId: 'baxstar', accountId: 'baxstar-fishing',
  maxBytes: 262144, maxBackupBytes: 3145728, maxSignals: 200, summaryLimit: 200, detailLimit: 750,
  staleHours: 168, demoNow: '2026-10-18T15:00:00Z',
  categories: { fishing: 'Fishing', rentals: 'Rentals', golf: 'Golf simulators', consulting: 'AI consulting', software: 'Software creation' },
  kinds: { attention: 'Needs attention', good: 'Good news', information: 'Information' },
  tiers: ['Safety / service disruption', 'Material hard deadline', 'People waiting', 'High-value opportunity', 'Routine improvement', 'Good news / information'],
});
export const length = value => [...value].length;
export const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
const fail = message => { throw new Error(message); };
function plain(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || length(value) > max) fail(`${name}: expected text, at most ${max} characters.`);
  return value.trim();
}
function instant(value, name, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${name}: use an ISO timestamp with a timezone.`);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) fail(`${name}: invalid calendar date.`);
  return new Date(value).toISOString();
}
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function enumValue(value, values, name) { return values.includes(value) ? value : fail(`${name}: unsupported value.`); }
export function validateEnvelope(input, scope = CONFIG) {
  if (!input || input.version !== 1 || !Array.isArray(input.signals)) fail('Expected a version 1 Signal Log envelope with a signals array.');
  if (input.workspaceId !== scope.workspaceId || input.accountId !== scope.accountId) fail('Workspace/account mismatch. Import into the matching account only.');
  if (input.signals.length > CONFIG.maxSignals) fail(`Import at most ${CONFIG.maxSignals} signals at a time.`);
  const source = enumValue(input.source, ['manual', 'claude', 'gmail', 'calendar', 'demo'], 'source');
  return input.signals.map((raw, index) => {
    const at = `Signal ${index + 1}`;
    if (!raw || typeof raw !== 'object') fail(`${at}: expected an object.`);
    const details = Object.fromEntries(['signal', 'why', 'next', 'prompt'].map(k => [k, plain(raw.details?.[k], `${at} ${k}`, CONFIG.detailLimit, k === 'prompt')]));
    if (Object.values(details).reduce((sum, v) => sum + length(v), 0) > CONFIG.detailLimit) fail(`${at}: expanded sections together must be at most ${CONFIG.detailLimit} characters.`);
    if (!Array.isArray(raw.categories)) fail(`${at}: choose supported categories.`);
    const categories = [...new Set(raw.categories)];
    if (!categories.length || categories.some(c => !Object.hasOwn(CONFIG.categories, c))) fail(`${at}: choose supported categories.`);
    if (!Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 5) fail(`${at}: include 1–5 full-source links.`);
    const sources = raw.sources.map(s => ({ label: plain(s.label, `${at} source label`, 80), url: safeUrl(s.url) || fail(`${at}: source links must be credential-free HTTPS URLs.`) }));
    const dueAt = instant(raw.dueAt, `${at} dueAt`, true);
    const dueKind = enumValue(raw.dueKind ?? 'unknown', ['hard', 'unknown', 'none'], `${at} dueKind`);
    if (dueAt && dueKind !== 'hard' || dueKind === 'hard' && !dueAt) fail(`${at}: only a sourced hard deadline may have dueAt; use reviewAt for suggestions.`);
    const observedAt = instant(raw.observedAt, `${at} observedAt`);
    if (Date.parse(observedAt) > Date.now() + 300000 && source !== 'demo') fail(`${at}: observedAt cannot be in the future.`);
    const sourceUpdatedAt = instant(raw.sourceUpdatedAt, `${at} sourceUpdatedAt`, true);
    if (sourceUpdatedAt && Date.parse(sourceUpdatedAt) > Date.parse(observedAt) + 300000) fail(`${at}: sourceUpdatedAt cannot be later than its observation.`);
    const overdueConfirmedAt = instant(raw.overdueConfirmedAt, `${at} overdueConfirmedAt`, true);
    if (overdueConfirmedAt && (!dueAt || Date.parse(overdueConfirmedAt) < Date.parse(dueAt) || Date.parse(overdueConfirmedAt) > Date.parse(observedAt) + 300000)) fail(`${at}: overdue confirmation must follow the hard deadline and precede observation.`);
    const number = (v, name, min, max, nullable = false) => {
      if (nullable && (v === undefined || v === null)) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${at} ${name}: expected ${min}–${max}.`);
      return v;
    };
    return {
      id: plain(raw.id, `${at} id`, 100), workspaceId: scope.workspaceId, accountId: scope.accountId, source,
      canonicalSignalId: plain(raw.canonicalSignalId, `${at} canonicalSignalId`, 100, true),
      occurrenceAt: instant(raw.occurrenceAt, `${at} occurrenceAt`, true),
      sourceUpdatedAt, overdueConfirmedAt,
      supersedes: plain(raw.supersedes, `${at} supersedes`, 100, true), resolves: plain(raw.resolves, `${at} resolves`, 100, true),
      title: plain(raw.title, `${at} title`, 90), summary: plain(raw.summary, `${at} summary`, CONFIG.summaryLimit), details,
      categories, sources, observedAt, dueAt, dueKind, reviewAt: instant(raw.reviewAt, `${at} reviewAt`, true),
      kind: enumValue(raw.kind, Object.keys(CONFIG.kinds), `${at} kind`),
      priority: enumValue(raw.priority ?? 'routine', ['safety', 'disruption', 'waiting', 'opportunity', 'routine'], `${at} priority`),
      impact: number(raw.impact, 'impact', 1, 5), effortMinutes: number(raw.effortMinutes, 'effortMinutes', 1, 480, true),
      confidence: number(raw.confidence, 'confidence', 0, 1), blocked: raw.blocked === true,
      actionable: raw.actionable === true, demo: source === 'demo', provenance: source === 'demo' ? 'Demo fixture' : 'Imported · not independently verified',
    };
  });
}
export function parseImport(text, scope = CONFIG) {
  if (new TextEncoder().encode(text).length > CONFIG.maxBytes) fail('File exceeds 256 KiB. Import a bounded summary, never an email archive.');
  let input;
  try { input = JSON.parse(text); } catch { fail('Invalid JSON. Nothing was imported.'); }
  if (input.source === 'demo') fail('Demo is reserved for the bundled synthetic examples.');
  return validateEnvelope(input, scope);
}
const recordFields = ['id', 'canonicalSignalId', 'occurrenceAt', 'sourceUpdatedAt', 'overdueConfirmedAt', 'supersedes', 'resolves', 'title', 'summary', 'details', 'categories', 'sources', 'observedAt', 'dueAt', 'dueKind', 'reviewAt', 'kind', 'priority', 'impact', 'effortMinutes', 'confidence', 'blocked', 'actionable'];
const dispositionStates = ['open', 'waiting', 'done', 'snoozed', 'dismissed', 'accepted'];
export function createBackup(signals, dispositions, exportedAt = new Date().toISOString()) {
  if (signals.some(s => s.demo)) fail('Export My log only; demo records are not private source records.');
  const backup = { format: 'ember-signal-log-backup', version: 1, workspaceId: CONFIG.workspaceId, accountId: CONFIG.accountId, exportedAt,
    entries: signals.map(s => {
      const state = dispositions.get(s.key) || {};
      return { source: s.source, record: Object.fromEntries(recordFields.map(k => [k, s[k]])),
        disposition: { read: state.read === true, status: state.status || 'open', snoozeUntil: state.snoozeUntil || null, observedAt: state.observedAt || s.observedAt } };
    }) };
  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).length > CONFIG.maxBackupBytes) fail('Backup exceeds 3 MiB. Shorten source links or export a smaller log.');
  return text;
}
export function parseTransfer(text, scope = CONFIG) {
  if (new TextEncoder().encode(text).length > CONFIG.maxBackupBytes) fail('File exceeds the 3 MiB backup limit.');
  let input; try { input = JSON.parse(text); } catch { fail('Invalid JSON. Nothing was imported.'); }
  if (input?.format !== 'ember-signal-log-backup') return { type: 'report', signals: parseImport(text, scope) };
  if (input.version !== 1 || input.workspaceId !== scope.workspaceId || input.accountId !== scope.accountId) fail('Backup version or workspace/account mismatch.');
  if (!Array.isArray(input.entries) || input.entries.length > CONFIG.maxSignals) fail('Backup must contain at most 200 entries.');
  const states = new Map(), signals = input.entries.map(entry => {
    if (!entry || entry.source === 'demo') fail('A private backup cannot contain demo records.');
    const s = validateEnvelope({ version: 1, ...scope, source: entry.source, signals: [entry.record] }, scope)[0];
    const d = entry.disposition;
    if (!d || typeof d.read !== 'boolean' || !dispositionStates.includes(d.status)) fail('Invalid backup disposition. Nothing was restored.');
    if (d.snoozeUntil !== null && (typeof d.snoozeUntil !== 'number' || !Number.isSafeInteger(d.snoozeUntil) || d.snoozeUntil < 0 || d.snoozeUntil > 8640000000000000)) fail('Invalid backup snooze timestamp.');
    if (d.status === 'snoozed' && !d.snoozeUntil) fail('Snoozed backup entries need an expiry.');
    const observedAt = instant(d.observedAt, 'Disposition observation');
    if (states.has(identity(s))) fail('Backup contains duplicate identities. Resolve them before restoring decisions.');
    states.set(identity(s), { read: d.read, status: d.status, snoozeUntil: d.snoozeUntil, observedAt });
    return s;
  });
  return { type: 'backup', signals, states };
}
export const identity = s => JSON.stringify([s.workspaceId, s.accountId, s.canonicalSignalId ? 'canonical' : s.source, s.canonicalSignalId || s.id, s.occurrenceAt || '']);
export async function metadataKey(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity(s)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function deduplicate(signals) {
  const map = new Map();
  for (const s of signals) {
    const key = identity(s), prev = map.get(key);
    if (!prev) { map.set(key, s); continue; }
    const newer = Date.parse(s.sourceUpdatedAt || s.observedAt) >= Date.parse(prev.sourceUpdatedAt || prev.observedAt) ? s : prev;
    const sources = [...new Map([...newer.sources, ...(newer === s ? prev : s).sources].map(v => [v.url, v])).values()].slice(0, 5);
    map.set(key, { ...newer, sources });
  }
  return [...map.values()];
}
export function deadlineState(s, now) {
  const hours = s.dueAt ? (Date.parse(s.dueAt) - now) / 3600000 : null;
  if (hours === null) return { state: s.dueKind, points: 0, material: false, order: 'z' };
  if (hours < 0) {
    const age = s.overdueConfirmedAt ? now - Date.parse(s.overdueConfirmedAt) : Infinity;
    const confirmed = age >= 0 && age <= 24 * 3600000;
    return { state: confirmed ? 'overdue-confirmed' : 'overdue-review', points: confirmed ? 30 : 0, material: confirmed, order: confirmed ? s.dueAt : 'z' };
  }
  return { state: 'upcoming', points: hours <= 24 ? 30 : hours <= 72 ? 20 : hours <= 168 ? 10 : 0, material: hours <= 168, order: s.dueAt };
}
export function ranking(s, now) {
  const deadline = deadlineState(s, now);
  const tier = ['safety', 'disruption'].includes(s.priority) ? 0
    : s.actionable && s.impact >= 3 && deadline.material ? 1
    : s.priority === 'waiting' ? 2 : s.priority === 'opportunity' ? 3 : s.actionable ? 4 : 5;
  const components = {
    impact: Math.round(s.impact * 9),
    deadline: deadline.points,
    effort: s.actionable && !s.blocked && s.effortMinutes !== null ? Math.round(10 * (1 - Math.min(60, s.effortMinutes) / 60)) : 0,
    confidence: Math.round(s.confidence * 15),
  };
  return { tier, score: Object.values(components).reduce((a, b) => a + b, 0), components, deadline, label: CONFIG.tiers[tier],
    explanation: `Tier ${tier + 1}: ${CONFIG.tiers[tier]}. Impact ${components.impact}/45; deadline ${components.deadline}/30; effort ${components.effort}/10; confidence ${components.confidence}/15. Tiers sort first; score breaks ties.`,
  };
}
export function rankSignals(signals, now) {
  return [...signals].sort((a, b) => {
    const x = ranking(a, now), y = ranking(b, now);
    return x.tier - y.tier || y.score - x.score || x.deadline.order.localeCompare(y.deadline.order) || identity(a).localeCompare(identity(b));
  });
}
export function effectiveStatus(meta = {}, now) {
  return meta.status === 'snoozed' && Number(meta.snoozeUntil) <= now ? 'open' : meta.status || 'open';
}
export function triage(signals, budget, now) {
  let remaining = clamp(budget, 5, 240, 30); const selected = [], review = [], verification = [];
  for (const s of rankSignals(signals, now)) {
    if (!s.actionable) continue;
    if (deadlineState(s, now).state === 'overdue-review') { verification.push(s); continue; }
    if (!s.blocked && s.effortMinutes !== null && s.effortMinutes <= remaining) { selected.push(s); remaining -= s.effortMinutes; }
    else if (ranking(s, now).tier <= 1) review.push(s);
  }
  return { selected, review, verification, used: clamp(budget, 5, 240, 30) - remaining };
}
export function freshness(s, now) {
  const age = Math.max(0, Math.floor((now - Date.parse(s.observedAt)) / 3600000));
  return { stale: age >= CONFIG.staleHours, label: age >= CONFIG.staleHours ? `Stale · checked ${Math.floor(age / 24)}d ago` : age < 1 ? 'Checked <1h ago' : `Checked ${age}h ago` };
}
export function formatDate(iso) {
  return new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}
