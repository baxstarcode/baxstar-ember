import { CONFIG, clamp, parseImport, validateEnvelope, deduplicate, metadataKey, ranking, rankSignals, triage, effectiveStatus, freshness, formatDate } from './core.mjs';
import { openStore } from './storage.mjs';
import { adapters } from './adapters.mjs';

const $ = id => document.getElementById(id);
const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const button = (text, action, attrs = {}) => { const b = el('button', text, { type: 'button', ...attrs }); b.addEventListener('click', action); return b; };
const link = (text, href) => el('a', text, { href, target: '_blank', rel: 'noopener noreferrer' });
let demo = [], imported = [], mode = 'demo', focusMode = 'triage', categories = new Set(), extra = '', views = [], store;
const meta = new Map(), expanded = new Set(), pending = new Map();
let undoAction = null, lastDialogFocus;
const now = () => mode === 'demo' ? Date.parse(CONFIG.demoNow) : Date.now();
const current = () => mode === 'demo' ? demo : imported;
const states = { open: 'Open', waiting: 'Waiting', done: 'Done / resolved', snoozed: 'Snoozed', dismissed: 'Dismissed', accepted: 'Accepted risk' };
const defaultViews = [
  { name: 'All businesses', categories: [], focus: 'triage', status: 'open' },
  { name: 'Money & customer risk', categories: ['fishing', 'rentals', 'golf', 'consulting'], focus: 'attention', status: 'open', extra: 'risk' },
  { name: 'Build & consult', categories: ['consulting', 'software'], focus: 'triage', status: 'open' },
  { name: 'This week', categories: [], focus: 'triage', status: 'open', extra: 'week' },
  { name: 'Waiting on others', categories: [], focus: 'triage', status: 'waiting' },
  { name: 'Resolved / accepted', categories: [], focus: 'triage', status: 'closed' },
];
// No body, title, source URL or provider identifier enters persistent storage.
async function hydrate(items) {
  for (const s of items) {
    s.key = await metadataKey(s);
    if (pending.has(s.key)) continue;
    try { meta.set(s.key, await store?.get(s.key) || {}); } catch { storageError(); }
  }
}
function storageError(message = 'Device storage unavailable. Changes remain in this tab.') {
  $('storage-notice').replaceChildren(el('span', message + ' '), button('Retry save', async () => {
    try {
      store = await openStore();
      for (const [key, patch] of pending) { const result = await store.update(key, patch); meta.set(key, result.after); pending.delete(key); }
      $('storage-notice').replaceChildren(); notify('Device changes saved.'); render();
    } catch (error) { storageError(error.message); }
  }));
}
async function change(s, patch) {
  const before = meta.get(s.key) || {};
  patch = { ...patch, updatedAt: Date.now(), observedAt: s.observedAt };
  try {
    if (!store) throw new Error('Device storage unavailable. Changes remain in this tab.');
    const result = await store.update(s.key, patch);
    meta.set(s.key, result.after);
    undoAction = async () => {
      const prior = { read: false, status: 'open', snoozeUntil: null, ...result.before, updatedAt: Date.now() };
      const restored = await store.update(s.key, prior, result.after.revision); meta.set(s.key, restored.after);
    };
  } catch (error) {
    meta.set(s.key, { ...before, ...patch }); pending.set(s.key, { ...pending.get(s.key), ...patch });
    storageError(error.message); undoAction = null;
  }
  render(); notify(patch.status ? `${states[patch.status]}${mode === 'demo' ? ' · demo only' : ''}.` : patch.read ? 'Marked read.' : 'Marked unread.', !!undoAction);
}
function notify(message, undo = false) { $('toast').hidden = false; $('toast').querySelector('span').textContent = message; $('undo').hidden = !undo; }
$('dismiss-toast').onclick = () => { $('toast').hidden = true; };
$('undo').onclick = async () => { try { await undoAction?.(); undoAction = null; render(); notify('Previous state restored.'); } catch (e) { notify(e.message); await hydrate(current()); render(); } };
function openDialog(title) { lastDialogFocus = document.activeElement; $('dialog-title').textContent = title; $('dialog-body').replaceChildren(); if (!$('dialog').open) $('dialog').showModal(); return $('dialog-body'); }
$('close-dialog').onclick = () => $('dialog').close();
$('dialog').addEventListener('close', () => { if (lastDialogFocus?.isConnected) lastDialogFocus.focus(); });
$('dialog').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...$('dialog').querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(n => n.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

for (const [id, name] of Object.entries(CONFIG.categories)) {
  const label = el('label', null, { class: 'check' }), input = el('input', null, { type: 'checkbox', value: id });
  input.addEventListener('change', () => { input.checked ? categories.add(id) : categories.delete(id); render(); });
  label.append(input, el('span', name), el('span', '', { id: `count-${id}`, 'aria-hidden': 'true' })); $('categories').append(label);
}
function applyView(view) {
  categories = new Set(view.categories); focusMode = view.focus; extra = view.extra || '';
  // Closed combines done and accepted without inventing a state.
  $('status-filter').value = view.status === 'closed' ? 'all' : view.status;
  if (view.status === 'closed') extra = 'closed';
  $('stale-only').checked = !!view.stale; $('search').value = view.search || '';
  if (view.budget) $('budget').value = clamp(view.budget, 5, 240, 30);
  syncFilters(); render();
}
function syncFilters() { for (const input of $('categories').querySelectorAll('input')) input.checked = categories.has(input.value); }
function renderViews() {
  $('saved-views').replaceChildren();
  for (const view of [...defaultViews, ...views]) {
    const row = el('div', null, { class: 'saved-row' }); row.append(button(view.name, () => applyView(view)));
    if (view.id) row.append(button('×', async () => {
      try { await store.deleteView(view.id); views = views.filter(v => v.id !== view.id); renderViews(); notify('Saved combination removed.'); } catch (e) { notify(e.message); }
    }, { 'aria-label': `Delete saved combination ${view.name}` }));
    $('saved-views').append(row);
  }
}
$('save-view').onclick = () => {
  const body = openDialog('Save this combination');
  body.append(el('p', 'Save categories, focus, state, search, and your time budget. Signal content is never included.'));
  const label = el('label', 'Combination name', { class: 'field' }), input = el('input', null, { maxlength: 40, placeholder: 'e.g. Fishing + software mornings' }); label.append(input); body.append(label);
  const error = el('p', '', { class: 'error', role: 'alert' }); body.append(error);
  body.append(button('Save combination', async () => {
    const name = input.value.trim();
    if (!name) { error.textContent = 'Give this combination a name.'; return; }
    if (views.length >= 20) { error.textContent = 'Keep at most 20 saved combinations. Remove one first.'; return; }
    if ([...defaultViews, ...views].some(v => v.name.toLowerCase() === name.toLowerCase())) { error.textContent = 'That name exists. Choose a new name; existing filters will not be overwritten.'; return; }
    const view = { id: crypto.randomUUID(), scope: `${CONFIG.workspaceId}/${CONFIG.accountId}`, name, categories: [...categories], focus: focusMode, status: $('status-filter').value, stale: $('stale-only').checked, search: $('search').value, budget: clamp($('budget').value, 5, 240, 30), extra };
    try { if (!store) throw new Error('Storage unavailable; this combination has not been saved.'); await store.saveView(view); views.push(view); renderViews(); $('dialog').close(); notify('Combination saved on this device.'); } catch (e) { error.textContent = e.message; }
  })); input.focus();
};
function filtered() {
  const query = $('search').value.trim().toLowerCase(), state = $('status-filter').value;
  return current().filter(s => {
    const m = meta.get(s.key) || {}, status = effectiveStatus(m, now());
    if (state === 'unread' ? m.read : state === 'open' ? !['open', 'waiting'].includes(status) : state !== 'all' && state !== status) return false;
    if (categories.size && !s.categories.some(c => categories.has(c))) return false;
    if (focusMode === 'good' && s.kind !== 'good' || focusMode === 'attention' && s.kind !== 'attention') return false;
    if ($('stale-only').checked && !freshness(s, now()).stale) return false;
    if (extra === 'risk' && !['safety', 'disruption', 'waiting'].includes(s.priority) && s.impact < 4) return false;
    if (extra === 'closed' && !['done', 'accepted'].includes(status)) return false;
    if (extra === 'week' && ![s.dueAt, s.reviewAt].some(d => d && Date.parse(d) >= now() && Date.parse(d) <= now() + 7 * 86400000)) return false;
    return !query || [s.title, s.summary, ...Object.values(s.details)].join(' ').toLowerCase().includes(query);
  });
}
function card(s, index, selected) {
  const m = meta.get(s.key) || {}, status = effectiveStatus(m, now()), r = ranking(s, now()), fresh = freshness(s, now());
  const article = el('article', null, { class: `signal-card ${s.kind}${m.read ? ' is-read' : ''}`, 'aria-labelledby': `title-${s.key}`, 'data-id': s.id });
  const top = el('div', null, { class: 'card-top' });
  top.append(el('span', `${String(index + 1).padStart(2, '0')} /`, { class: 'rank' }), el('span', `${s.kind === 'good' ? '✧' : s.kind === 'attention' ? '!' : '○'} ${CONFIG.kinds[s.kind]}`, { class: `badge ${s.kind === 'good' ? 'good' : r.tier === 0 ? 'risk' : s.kind === 'information' ? 'neutral' : ''}` }), el('span', s.demo ? 'DEMO' : 'IMPORTED'), el('span', s.categories.map(c => CONFIG.categories[c]).join(' · '), { class: 'category-list' }));
  article.append(top);
  const main = el('div', null, { class: 'card-main' }), text = el('div'); text.append(el('h3', s.title, { id: `title-${s.key}` }), el('p', s.summary, { class: 'summary' })); main.append(text);
  const effort = el('aside', null, { class: 'effort', 'aria-label': s.actionable ? s.effortMinutes ? `${s.effortMinutes} minute next step` : 'Effort unknown' : 'No action needed' });
  effort.append(el('strong', !s.actionable ? '—' : s.effortMinutes === null ? '?' : Math.round(s.effortMinutes)), el('small', s.actionable ? 'MIN NEXT STEP' : 'JUST GOOD TO KNOW')); main.append(effort); article.append(main);
  const info = el('div', null, { class: 'card-meta' });
  info.append(el('span', s.dueAt ? `Hard deadline · ${formatDate(s.dueAt)}${Date.parse(s.dueAt) < now() ? ' · past; verify status' : ''}` : s.dueKind === 'none' ? 'No deadline' : 'Deadline unknown'), el('span', fresh.label, { class: fresh.stale ? 'stale' : '' }), el('span', `${Math.round(s.confidence * 100)}% source confidence`));
  if (selected.has(s.key)) info.append(el('span', '✓ Fits your time budget', { class: 'fit' }));
  if (s.blocked) info.append(el('span', 'Dependency blocked · review first'));
  if (status !== 'open') info.append(el('span', `${states[status]}${status === 'snoozed' ? ` until ${formatDate(m.snoozeUntil)}` : ''}`, { class: 'state-label' }));
  article.append(info);
  const bottom = el('div', null, { class: 'card-bottom' }), actions = el('div', null, { class: 'card-actions' });
  bottom.append(button(expanded.has(s.key) ? 'Close details ↑' : 'Open signal ↓', async () => { expanded.has(s.key) ? expanded.delete(s.key) : expanded.add(s.key); if (expanded.has(s.key) && !m.read) await change(s, { read: true }); else render(); }, { 'aria-expanded': expanded.has(s.key), 'aria-controls': `detail-${s.key}`, 'data-focus': `detail-${s.key}` }));
  actions.append(button(m.read ? 'Mark unread' : 'Mark read', () => change(s, { read: !m.read }), { class: 'read-button', 'data-focus': `read-${s.key}` }));
  if (status === 'open') actions.append(button('Resolve', () => change(s, { status: 'done', read: true, snoozeUntil: null }), { 'data-focus': `resolve-${s.key}` }));
  else actions.append(button('Reopen', () => change(s, { status: 'open', snoozeUntil: null }), { 'data-focus': `reopen-${s.key}` }));
  actions.append(button('More…', () => stateDialog(s), { 'aria-label': `More actions for ${s.title}`, 'data-focus': `more-${s.key}` })); bottom.append(actions); article.append(bottom);
  if (expanded.has(s.key)) {
    const detail = el('div', null, { class: 'detail', id: `detail-${s.key}` });
    for (const [key, label] of [['signal', 'Signal · source-reported fact'], ['why', 'Why it matters · interpretation'], ['next', 'What must be done · suggested next step']]) {
      const section = el('section', null, { class: 'detail-section' }); section.append(el('h4', label), el('p', s.details[key])); detail.append(section);
    }
    if (s.details.prompt) detail.append(button('Advice / AI prompt ↗', () => promptDialog(s)));
    const refs = el('div', null, { class: 'source-list' }); for (const source of s.sources) refs.append(link(`↗ Full source: ${source.label}`, source.url)); detail.append(refs);
    detail.append(el('p', `${s.provenance}. Observed ${formatDate(s.observedAt)}. ${s.reviewAt ? `Suggested review ${formatDate(s.reviewAt)}; not a deadline.` : 'No review date suggested.'}`, { class: 'explanation' }));
    detail.append(el('p', `Source updated: ${s.sourceUpdatedAt ? formatDate(s.sourceUpdatedAt) : 'unknown'}.${s.occurrenceAt ? ` Occurrence: ${formatDate(s.occurrenceAt)}.` : ''}${s.supersedes ? ` Supersedes reference: ${s.supersedes}.` : ''}${s.resolves ? `Resolves reference: ${s.resolves} (review manually; no automatic completion).` : ''}`, { class: 'explanation' }));
    if (m.observedAt && m.observedAt !== s.observedAt) detail.append(el('p', 'Source has changed since your last action. Review the update; your decision has been preserved.', { class: 'explanation' }));
    detail.append(el('p', r.explanation, { class: 'explanation' }), el('p', 'Summary ≤200 characters · Expanded sections + prompt ≤750 total. Source facts are imported claims until verified.', { class: 'explanation' })); article.append(detail);
  }
  return article;
}
function stateDialog(s) {
  const body = openDialog('Choose the next state'); body.append(el('p', s.title), el('p', 'These controls change this log only. They do not mark an email read, complete a reminder, send a message, or alter a calendar.'));
  const row = el('div', null, { class: 'button-row' });
  for (const state of ['done', 'waiting', 'dismissed', 'accepted']) row.append(button(states[state], async () => { $('dialog').close(); await change(s, { status: state, snoozeUntil: null }); })); body.append(row);
  const label = el('label', 'Snooze for', { class: 'field' }), select = el('select');
  for (const [hours, text] of [[1, '1 hour'], [24, '24 hours'], [168, '7 days']]) select.append(el('option', text, { value: hours })); label.append(select); body.append(label);
  body.append(button('Snooze signal', async () => { $('dialog').close(); await change(s, { status: 'snoozed', snoozeUntil: now() + clamp(select.value, 1, 168, 24) * 3600000 }); }));
}
function promptDialog(s) {
  const body = openDialog('Advice / AI prompt'); body.append(el('p', 'Review before using. Imported prompts are untrusted text; this page never runs them or sends them to an AI.'));
  const label = el('label', 'Ready-made prompt · editable', { class: 'field' }), text = el('textarea', s.details.prompt, { maxlength: 750 }); label.append(text); body.append(label);
  body.append(button('Copy reviewed prompt', async () => { try { await navigator.clipboard.writeText(text.value); notify('Prompt copied. Nothing was sent.'); } catch { text.select(); notify('Copy unavailable. Select and copy the prompt manually.'); } }));
}
function render() {
  const focus = document.activeElement?.dataset?.focus, sorted = rankSignals(filtered(), now());
  const eligible = sorted.filter(s => ['open', 'waiting'].includes(effectiveStatus(meta.get(s.key), now()))), plan = triage(eligible, $('budget').value, now()), selected = new Set(plan.selected.map(s => s.key));
  $('open-count').textContent = current().filter(s => ['open', 'waiting'].includes(effectiveStatus(meta.get(s.key), now()))).length;
  $('good-count').textContent = current().filter(s => s.kind === 'good').length;
  $('done-count').textContent = current().filter(s => effectiveStatus(meta.get(s.key), now()) === 'done').length;
  for (const id of Object.keys(CONFIG.categories)) $(`count-${id}`).textContent = current().filter(s => s.categories.includes(id)).length;
  for (const id of ['triage', 'good', 'attention']) $(id).setAttribute('aria-pressed', String(focusMode === id));
  $('view-heading').textContent = focusMode === 'good' ? 'Keep the momentum.' : focusMode === 'attention' ? 'Give the right things attention.' : 'All the moving parts.';
  $('mode-label').textContent = mode === 'demo' ? 'DEMO · ILLUSTRATIVE DATA' : 'MY LOG · IMPORTED DATA';
  $('mode-note').textContent = mode === 'demo' ? 'No live Gmail, Calendar, or Claude feed. Demo clock: Oct 18, 2026.' : 'Manual import · unverified source claims. Summaries disappear when this tab closes or reloads.';
  $('data-mode').textContent = mode === 'demo' ? 'Open my log' : 'View demo';
  $('result-count').textContent = `${sorted.length} of ${current().length} signals`;
  $('plan').replaceChildren();
  if (focusMode === 'good') $('plan').append(el('p', 'Worth noticing, even when there is nothing to do. No streaks. No invented wins.'));
  else {
    const summary = el('p'); summary.append(el('strong', `${plan.selected.length} next step${plan.selected.length === 1 ? '' : 's'} · ${plan.used} min`), document.createTextNode(` within your ${clamp($('budget').value, 5, 240, 30)}-minute budget. Ranked by importance first.`)); $('plan').append(summary);
    if (plan.review.length) $('plan').append(el('p', `${plan.review.length} high-priority signal${plan.review.length === 1 ? '' : 's'} need a capacity or dependency review. They remain visible below.`));
  }
  const hiddenCritical = current().filter(s => ranking(s, now()).tier <= 1 && ['open', 'waiting'].includes(effectiveStatus(meta.get(s.key), now())) && !sorted.includes(s));
  $('critical-note').hidden = hiddenCritical.length === 0;
  $('critical-note').textContent = `${hiddenCritical.length} high-priority open signal${hiddenCritical.length === 1 ? ' is' : 's are'} outside these filters. Reset filters to review.`;
  $('signals').replaceChildren(...sorted.map((s, index) => card(s, index, selected)));
  $('empty').hidden = sorted.length > 0;
  $('empty-title').textContent = mode === 'imported' && !imported.length ? 'Your log is ready for its first signal.' : 'A little breathing room.';
  $('empty-copy').textContent = mode === 'imported' && !imported.length ? 'Import a bounded JSON report from Claude or another source. Live feeds are not connected to this page yet.' : 'Nothing matches these filters. Try another combination.';
  if (focus) {
    const target = [...document.querySelectorAll('[data-focus]')].find(n => n.dataset.focus === focus);
    (target || $('signals')).focus({ preventScroll: true });
  }
}
for (const id of ['triage', 'good', 'attention']) $(id).onclick = () => { focusMode = id; render(); };
for (const id of ['status-filter', 'stale-only']) $(id).onchange = () => { extra = ''; render(); };
$('search').oninput = render;
$('budget').onchange = () => { $('budget').value = clamp($('budget').value, 5, 240, 30); render(); };
$('reset').onclick = () => applyView(defaultViews[0]);
$('data-mode').onclick = () => { mode = mode === 'demo' ? 'imported' : 'demo'; applyView(defaultViews[0]); };
$('toggle-filters').onclick = () => {
  const open = $('filter-panel').classList.toggle('filters-open');
  $('toggle-filters').setAttribute('aria-expanded', String(open));
  $('toggle-filters').textContent = open ? 'Close filters ↑' : 'Filters & saved views ↓';
};
$('import').onclick = () => {
  const body = openDialog('Import signals');
  body.append(el('p', 'Baxstar · Fishing account. Paste a Signal Log v1 JSON report or choose a file (maximum 256 KiB / 200 signals). Only selected summaries belong here; never paste a full inbox, credentials, or private attachments.'));
  body.append(link('Download the Claude/manual import example', 'https://github.com/baxstarcode/baxstar-ember/blob/codex/ember-signal-log/signal-log/example.json'));
  const label = el('label', 'Signal Log JSON', { class: 'field' }), input = el('textarea', '', { spellcheck: false, maxlength: CONFIG.maxBytes, placeholder: '{"version":1,"workspaceId":"baxstar","accountId":"baxstar-fishing",…}' }); label.append(input); body.append(label);
  const fileLabel = el('label', 'Choose JSON file', { class: 'field' }), file = el('input', null, { type: 'file', accept: '.json,application/json' }); fileLabel.append(file); body.append(fileLabel);
  const error = el('p', '', { class: 'error', role: 'alert' }); body.append(error);
  file.onchange = async () => { const f = file.files[0]; if (!f) return; if (f.size > CONFIG.maxBytes) { error.textContent = 'File exceeds 256 KiB. Nothing was loaded.'; return; } input.value = await f.text(); error.textContent = ''; };
  body.append(el('p', 'Imports are unverified source claims. Duplicate provider/account/record IDs update to the latest observation. Read and resolved states remain; text stays in memory only.', { class: 'constraint-note' }));
  body.append(button('Validate & import', async () => {
    try {
      const accepted = parseImport(input.value), merged = deduplicate([...imported, ...accepted]);
      if (merged.length > CONFIG.maxSignals) throw new Error('This tab already holds signals. Keep at most 200 total.');
      await hydrate(merged); imported = merged; mode = 'imported'; applyView(defaultViews[0]); $('dialog').close();
      notify(`${accepted.length} records accepted · ${merged.length} unique signals in this tab. Nothing sent or scheduled.`);
    } catch (e) { error.textContent = e.message; }
  }));
};
$('connections').onclick = async () => {
  const body = openDialog('Connection truth');
  body.append(el('p', 'Gmail and Calendar are not wired into this Signal Log. A successful read in ChatGPT, or a connected credential indicator in Ember, does not verify this page’s data path.'));
  for (const adapter of adapters) { const result = await adapter.read(); body.append(el('h3', `${adapter.provider === 'gmail' ? 'Gmail' : 'Calendar'} · ${result.state}`), el('p', result.reason)); }
  body.append(el('h3', 'Smallest remaining integration step'), el('p', 'The Ember connector owner must supply an authenticated, account-attested, bounded read through the existing same-origin service binding, then verify one Gmail record and one Calendar event end to end. No OAuth grants or refresh tokens are changed by this page.'), el('h3', 'Claude and weekly reminders'), el('p', 'Manual JSON import works now. There is no verified cross-platform reminder API. A reminder firing is not completion. Existing reminders and disabled sweeps are unchanged.'), el('h3', 'Future workspaces'), el('p', 'Adapters require workspace, account, and provider identity. A workspace selector alone never grants access. More accounts require their own authorized server mapping.'));
};
const references = [
  ['Importance before urgency', 'https://academic.oup.com/jcr/article-abstract/45/3/673/4847790?login=true', 'The mere urgency effect motivates separating importance and time pressure. Parent-supplied research; publisher text was inaccessible here. This scoring formula is a design inference, not a validated model.'],
  ['Concrete if–then next steps', 'https://doi.org/10.1080/10463283.2024.2334563', 'Parent-supplied implementation-intention meta-analysis. Publisher access was blocked here. Prompts suggest a specific cue and small action; they do not establish new obligations.'],
  ['Meaningful progress monitoring', 'https://pubmed.ncbi.nlm.nih.gov/26479070/', 'The meta-analysis supports monitoring progress. The resolved count records your explicit actions, not business success, money earned, or an invented streak.'],
  ['Familiar hierarchy', 'https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p02-familiar-design/', 'Familiar filters, labels, and native controls sit within Ember’s brass and iron framing.'],
  ['Text contrast', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html', 'Readable foreground/background pairs are checked locally.'],
  ['Meaning beyond color', 'https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html', 'Good news, attention, risk, and source health have text labels as well as symbols and color.'],
  ['Target size', 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html', 'Controls are at least 24 CSS pixels; primary buttons are at least 44 pixels.'],
  ['Recurring-revenue definitions', 'https://support.stripe.com/questions/understanding-monthly-recurring-revenue-%28mrr%29-and-annual-recurring-revenue-%28arr%29?locale=en-GB', 'Metric guardrail for future feeds: one-time consulting fees are not MRR. Require period, source, and denominator; invent no benchmarks.'],
  ['AI risk monitoring', 'https://airc.nist.gov/airmf-resources/airmf/5-sec-core/', 'Future software signals should retain evaluation evidence, incidents, and cost per successful outcome.'],
  ['Boating and thunderstorms', 'https://www.weather.gov/safety/safeboating-thunderstorms', 'Weather signals always require human review; this log never issues an automatic safe-to-go decision.'],
  ['Minnesota ice safety', 'https://www.dnr.state.mn.us/safety/ice/index.html', 'Conditions need local human assessment. A positive signal is not a safety clearance.'],
];
function method(showSources = false) {
  const body = openDialog(showSources ? 'Sources & method' : 'How ranking works');
  body.append(el('p', 'Design inference, not validated science: priority tier first, then a deterministic score. Unknown dates stay unknown. Source confidence is supplied by the report; it is not measured accuracy.'));
  const list = el('ol'); CONFIG.tiers.forEach(t => list.append(el('li', t))); body.append(list);
  body.append(el('p', 'Within a tier: impact up to 45 points, sourced deadline proximity up to 30, next-step effort up to 10, and confidence up to 15. A hard deadline enters tier 2 only at impact 3+ and within 7 days. Ties use due time, then stable identity.'), el('p', 'Time budget selects feasible next steps in that order. It never removes larger or blocked work; high-priority exceptions remain called out. Suggested review dates do not increase deadline urgency. Stale sources (7 days) and past deadlines require verification.'), el('p', 'Cards: summary ≤200 Unicode characters. All four expanded sections, including the optional AI prompt, share a 750-character limit. Full source links remain available. All timestamps display in America/Chicago.'));
  if (showSources) for (const [title, url, note] of references) { const section = el('section', null, { class: 'source-ref' }); section.append(link(title, url), el('p', note)); body.append(section); }
}
$('method').onclick = () => method(); $('sources').onclick = () => method(true);
window.addEventListener('focus', async () => { await hydrate(current()); render(); });
setInterval(() => { if (document.visibilityState === 'visible' && !$('dialog').open) render(); }, 60000);
try {
  try { store = await openStore(); views = (await store.views()).filter(v => v.scope === `${CONFIG.workspaceId}/${CONFIG.accountId}`); } catch (e) { storageError(e.message); }
  const response = await fetch('./demo.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Demo could not be loaded. My log is still available for import.');
  demo = deduplicate(validateEnvelope(await response.json())); await hydrate(demo);
} catch (e) { mode = 'imported'; notify(e.message); }
renderViews(); render();
