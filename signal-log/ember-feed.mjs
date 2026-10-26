// Live Gmail, Calendar and Quo readers for Signal Log.
//
// Transport is the one Ember already trusts: the signed-in browser posts to the
// same-origin /api/messages gateway (Cloudflare Access → Pages Function →
// EMBER_API service binding → Worker → the server-owned read-only MCP toolset).
// Nothing here carries a token, picks a provider URL or widens a tool policy;
// the Worker decides which account each connector serves. A provider counts as
// read only when the reply carries a successful mcp_tool_result for it — the
// same standard the OPS dashboard uses — so a connector-free fallback answer
// can never pose as live data.
//
// Pure helpers (prompt, projection, verification) are exported for node tests;
// registration happens only in a browser.
import { CONFIG, validateEnvelope, safeUrl } from './core.mjs';
import { registerAccountReader, PROVIDERS } from './adapters.mjs';

export const FEED = Object.freeze({
  endpoint: '/api/messages',
  // Haiku at low effort: turning two bounded tool reads into JSON is mechanical
  // work, and the thinking budget must not eat the output budget.
  model: 'claude-haiku-5-5', effort: 'low', maxTokens: 6000, timeoutMs: 75000,
  maxResponseBytes: 512 * 1024,
  productionHosts: ['ember.baxstarfishing.com'],
  gmail: { hours: 168, max: 25 },
  calendar: { pastHours: 48, aheadDays: 14, max: 40 },
  // Quo: missed calls and voicemails from both inboxes. Quo has no stable per-call
  // deep link, so the source link is the inbox itself.
  quo: { hours: 48, max: 20, inboxes: 'Fishing 218-325-6857 and Pontoon 218-325-9846', link: 'https://app.quo.com/' },
  links: { gmail: 'Open in Gmail', calendar: 'Open in Google Calendar', quo: 'Open Quo' },
  names: { gmail: 'Gmail', calendar: 'Calendar', quo: 'Quo' },
});

const CATEGORY_GUIDE = [
  'fishing = Baxstar Fishing guided trips, guide bookings, FareHarbor fishing items, bait/boat/launch logistics',
  'rentals = pontoon and boat rentals, ice houses / Ice Castle, rental customers, slips, turnovers',
  'golf = Lakes Golf Sim, simulator bays, leagues, AI classes held at the sim',
  'consulting = AI consulting clients, prospects, proposals, workflow audits, AI FOR WORK / AI FOR REAL classes',
  'software = Ember, GitHub, Cloudflare, Zapier, Wix, Google Cloud, domains, billing for tools, build and deploy notices',
].join('\n');

const scope = provider => ({ workspaceId: CONFIG.workspaceId, accountId: CONFIG.accountId, provider });
const reason = message => Object.assign(new Error(message), { reason: message });
const chars = value => [...value];
export const fit = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const points = chars(text);
  return points.length <= max ? text : points.slice(0, max - 1).join('') + '…';
};
const iso = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const number = (value, min, max, fallback) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function buildPrompt(provider, now = new Date()) {
  const ms = now.getTime();
  const rules = provider === 'quo'
    ? `Use ONLY the Quo tools. Read missed calls and voicemails from BOTH inboxes (${FEED.quo.inboxes}) created after ${new Date(ms - FEED.quo.hours * 3600000).toISOString()} — pass createdAfter with that exact timestamp. Include the voicemail transcript in "signal" when one exists; a missed call with no voicemail is information unless the number has called more than once. At most ${FEED.quo.max} records. "id" is the call or conversation id exactly as the tool returned it; "link" is ${FEED.quo.link}; "sourceUpdatedAt" is the call time as ISO 8601. Never invent a caller name; use the number when that is all the tool gives.`
    : provider === 'gmail'
    ? `Use ONLY the Gmail tool. Read messages received after ${new Date(ms - FEED.gmail.hours * 3600000).toISOString()} (the last ${FEED.gmail.hours / 24} days) that are unread, starred or in the inbox and relevant to Brady's businesses. Include relevant weekly reports and meaningful positive business news even when no action is needed. Skip unrelated newsletters, receipts and automated notices. Never manufacture an action or urgency for good news. At most ${FEED.gmail.max} messages. "id" is the Gmail message id exactly as the tool returned it; "link" is https://mail.google.com/mail/u/0/#all/<that id>; "sourceUpdatedAt" is the message date as ISO 8601.`
    : `Use ONLY the Calendar tool. Read events starting between ${new Date(ms - FEED.calendar.pastHours * 3600000).toISOString()} and ${new Date(ms + FEED.calendar.aheadDays * 86400000).toISOString()} — pass these exact timestamps to the tool. At most ${FEED.calendar.max} events. "id" is the event id (append "/" + original start for a recurring instance); "link" is the event's htmlLink; "occurrenceAt" is the event start as ISO 8601 with timezone; "dueAt" is the same start when it is in the future, otherwise null. An event that is only a reminder of past work is information, not a task.`;
  return `You are Ember's Signal Log reader for Brady Baxter (Detroit Lakes, MN; Baxstar Fishing, pontoon and ice-house rentals, Lakes Golf Sim, AI consulting, his own software). Current time: ${now.toISOString()}.

${rules}

Turn each record into one signal. Never invent facts: "signal" states only what the source says; "why" and "next" are your interpretation and the smallest concrete next step; "prompt" is an optional short AI prompt Brady could paste. Leave unknown dates null; do not infer a deadline from unread status.

Business categories (choose one or more):
${CATEGORY_GUIDE}

kind: "attention" = needs Brady to act or carries risk; "good" = positive news worth noticing; "information" = FYI only.
priority: "safety" (safety or service-stopping), "disruption" (a booking, payment, site or tool is broken or at risk), "waiting" (someone is waiting on Brady), "opportunity" (money or growth), "routine" (everything else).
impact 1-5 (5 = revenue, customer or safety critical). effortMinutes = minutes for the next step, or null when no action. confidence 0-1 = how sure you are of the classification. actionable = true only when Brady should do something. blocked = true only when he cannot act yet.

Character limits: title ≤ 80, summary ≤ 180, signal ≤ 280, why ≤ 180, next ≤ 140, prompt ≤ 100.

Respond with ONLY valid JSON — no markdown, no commentary:
{"signals":[{"id":"","link":"","title":"","summary":"","signal":"","why":"","next":"","prompt":"","categories":["fishing"],"kind":"attention","priority":"routine","impact":3,"effortMinutes":10,"confidence":0.7,"actionable":true,"blocked":false,"dueAt":null,"sourceUpdatedAt":null,"occurrenceAt":null}]}
If the tool returns nothing in range, respond with {"signals":[]}.`;
}

// Mirrors succeededConnectors() in src/baxstar-ember.jsx: a server is verified
// only by a successful tool result paired to its own tool call.
export function succeededConnectors(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const calls = new Map();
  for (const block of blocks) {
    if (block?.type === 'mcp_tool_use' && typeof block.id === 'string' && typeof block.server_name === 'string') calls.set(block.id, block.server_name);
  }
  const ok = new Set();
  for (const block of blocks) {
    if (block?.type !== 'mcp_tool_result' || block.is_error !== false) continue;
    const server = calls.get(block.tool_use_id);
    if (server) ok.add(server);
  }
  return ok;
}

export function extractJSON(data) {
  const text = (Array.isArray(data?.content) ? data.content : []).filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
  const clean = text.replace(/```json|```/g, '');
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw reason('The reader returned no JSON.');
  return JSON.parse(clean.slice(start, end + 1));
}

function sourceLink(provider, raw, occurrenceAt) {
  const given = safeUrl(raw.link) || safeUrl(raw.url) || safeUrl(raw.htmlLink);
  if (given) {
    const url = new URL(given);
    if (provider === 'gmail' && url.hostname === 'mail.google.com' && !url.port) return given;
    if (provider === 'calendar' && !url.port && (url.hostname === 'calendar.google.com' || (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/')))) return given;
  }
  if (provider === 'gmail') return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(raw.id))}`;
  if (provider === 'quo') return FEED.quo.link;
  const day = occurrenceAt ? occurrenceAt.slice(0, 10).split('-') : null;
  return day ? `https://calendar.google.com/calendar/u/0/r/day/${day[0]}/${Number(day[1])}/${Number(day[2])}` : 'https://calendar.google.com/calendar/u/0/r';
}

// Model output → strict v1 contract. Each record is validated on its own so one
// malformed card never discards a whole read; the count of drops is reported.
export function projectSignals(provider, parsed, now = new Date()) {
  if (!PROVIDERS.includes(provider)) throw reason('Unsupported provider.');
  if (!parsed || !Array.isArray(parsed.signals)) throw reason('The reader returned an invalid signals list. Existing records were retained.');
  const observedAt = now.toISOString();
  const list = parsed.signals;
  const limit = Math.min(FEED[provider].max, CONFIG.maxSignals);
  const signals = [], seen = new Set();
  let dropped = 0;
  for (const raw of list.slice(0, limit)) {
    try {
      if (!raw || typeof raw !== 'object') throw new Error('not an object');
      const id = fit(String(raw.id ?? ''), 100);
      if (!id || seen.has(id)) throw new Error('missing or duplicate id');
      const occurrenceAt = provider === 'calendar' ? iso(raw.occurrenceAt) || iso(raw.start) : null;
      let dueAt = iso(raw.dueAt);
      if (dueAt && Date.parse(dueAt) <= now.getTime()) dueAt = null;
      let sourceUpdatedAt = iso(raw.sourceUpdatedAt) || iso(raw.date);
      if (sourceUpdatedAt && Date.parse(sourceUpdatedAt) > now.getTime()) sourceUpdatedAt = observedAt;
      const categories = (Array.isArray(raw.categories) ? raw.categories : [raw.category]).filter(c => Object.hasOwn(CONFIG.categories, c));
      const kind = Object.hasOwn(CONFIG.kinds, raw.kind) ? raw.kind : 'information';
      const priority = ['safety', 'disruption', 'waiting', 'opportunity', 'routine'].includes(raw.priority) ? raw.priority : 'routine';
      const effort = number(raw.effortMinutes, 1, 480, null);
      const actionable = raw.actionable === true || (raw.actionable !== false && kind === 'attention');
      const details = {
        signal: fit(raw.signal ?? raw.details?.signal ?? raw.summary, 280) || fit(raw.summary, 280),
        why: fit(raw.why ?? raw.details?.why, 180) || 'No interpretation supplied.',
        next: fit(raw.next ?? raw.details?.next, 140) || (actionable ? 'Open the source and decide the next step.' : 'Nothing to do; noted for awareness.'),
        prompt: fit(raw.prompt ?? raw.details?.prompt, 100),
      };
      const candidate = {
        id, occurrenceAt, sourceUpdatedAt, observedAt,
        title: fit(raw.title, 90) || fit(details.signal, 90),
        summary: fit(raw.summary, 200) || fit(details.signal, 200),
        details, categories: categories.length ? categories : ['fishing'],
        kind, priority, impact: Math.round(number(raw.impact, 1, 5, 2)),
        effortMinutes: actionable ? (effort === null ? null : Math.round(effort)) : null,
        confidence: Math.round(number(raw.confidence, 0, 1, 0.6) * 100) / 100,
        actionable, blocked: raw.blocked === true,
        dueKind: dueAt ? 'hard' : actionable ? 'unknown' : 'none', dueAt,
        sources: [{ label: FEED.links[provider], url: sourceLink(provider, raw, occurrenceAt) }],
      };
      validateEnvelope({ version: 1, workspaceId: CONFIG.workspaceId, accountId: CONFIG.accountId, source: provider, signals: [candidate] });
      seen.add(id); signals.push(candidate);
    } catch { dropped += 1; }
  }
  if (list.length && !signals.length) throw reason('The reader returned no usable records. Existing records were retained.');
  return { signals, dropped, truncated: Math.max(0, list.length - limit) };
}

export function feedAllowed(loc = globalThis.location, win = globalThis.window) {
  return !!loc && (FEED.productionHosts.includes(loc.hostname) || win?.__emberSignalFeedAnyHost === true);
}

async function readBoundedJSON(res, signal) {
  const reader = res.body?.getReader();
  if (!reader) throw reason('Ember returned an unreadable reply.');
  const chunks = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > FEED.maxResponseBytes) {
        void reader.cancel().catch(() => {});
        throw reason('Ember returned more data than this feed accepts. Existing records were retained.');
      }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw reason('Ember returned an unreadable reply.'); }
}

export async function readFeed(provider, { fetchImpl = globalThis.fetch, now = new Date(), timeoutMs = FEED.timeoutMs } = {}) {
  if (!PROVIDERS.includes(provider)) throw reason('Unsupported provider.');
  if (!feedAllowed()) throw reason('Live Gmail, Calendar and Quo reads run only on ember.baxstarfishing.com. Preview and local pages keep the demo and manual import.');
  const body = {
    model: FEED.model, max_tokens: FEED.maxTokens, output_config: { effort: FEED.effort },
    mcp_servers: [{ name: provider }],
    messages: [{ role: 'user', content: buildPrompt(provider, now) }],
  };
  const control = new AbortController();
  // Bound the whole read, including a stalled response body. Race the operation
  // as well as aborting it so even a transport that ignores abort cannot hang UI.
  const duration = number(timeoutMs, 1, FEED.timeoutMs, FEED.timeoutMs);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(reason(`The ${provider} read timed out. Existing records were retained; refresh when ready.`));
      control.abort();
    }, duration);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const res = await fetchImpl(FEED.endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: control.signal });
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!type.includes('application/json')) {
        throw reason(res.redirected || type.includes('text/html')
          ? 'Sign in to Ember (Cloudflare Access) in this tab, then refresh sources.'
          : `Ember's gateway answered HTTP ${res.status} without JSON.`);
      }
      const data = await readBoundedJSON(res, control.signal);
      if (!res.ok || data?.error || data?.type === 'error') {
        // Upstream error strings can contain source text or operational details.
        // Show fixed recovery guidance rather than reflecting them into the page.
        throw reason(res.status === 429 ? 'Ember is rate limited. Wait before refreshing; no automatic retry was sent.'
          : [401, 403].includes(res.status) ? 'Sign in to Ember, then refresh sources. If this continues, check the connection with its owner.'
          : `Ember request failed (HTTP ${res.status}). Existing records were retained.`);
      }
      if (res.headers.get('x-ember-connectors') === 'degraded' || !succeededConnectors(data).has(provider)) {
        throw reason(`${FEED.names[provider]} returned no successful tool result — the connector is offline or needs a new sign-in. Check the OPS lights.`);
      }
      let parsed;
      try { parsed = extractJSON(data); }
      catch { throw reason('The reader returned unreadable signal JSON. Existing records were retained.'); }
      const { signals, dropped, truncated } = projectSignals(provider, parsed, now);
      return {
        verifiedAccount: scope(provider),
        endToEndVerified: true,
        dropped, truncated,
        envelope: { version: 1, workspaceId: CONFIG.workspaceId, accountId: CONFIG.accountId, source: provider, signals },
      };
    })()]);
  } catch (error) {
    if (typeof error?.reason === 'string') throw error;
    throw reason("Can't read Ember's same-origin gateway. Existing records were retained.");
  } finally { clearTimeout(timer); }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  for (const provider of PROVIDERS) registerAccountReader({ ...scope(provider), readVerifiedFeed: () => readFeed(provider) });
}
