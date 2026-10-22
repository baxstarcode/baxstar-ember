import { validateEnvelope, CONFIG } from './core.mjs';

// The host owns authentication and identity. This module never opens consent,
// reads tokens, calls a model, or treats a browser-selected account as authorization.
export function createAccountAdapter({ workspaceId, accountId, provider, readVerifiedFeed }) {
  if (!['gmail', 'calendar'].includes(provider)) throw new Error('Unsupported provider.');
  return Object.freeze({
    workspaceId, accountId, provider, configured: typeof readVerifiedFeed === 'function',
    async read() {
      if (typeof readVerifiedFeed !== 'function') return { state: 'not-connected', signals: [], reason: 'An authenticated, account-attested Ember feed is not wired to this page.' };
      // Callback must return bounded summaries, not raw mail or arbitrary prompts.
      let result;
      try { result = await readVerifiedFeed({ workspaceId, accountId, provider, limit: CONFIG.maxSignals }); }
      catch (error) { return { state: 'unavailable', signals: [], reason: typeof error?.reason === 'string' ? error.reason : 'Provider read unavailable. Existing records were retained; try Refresh sources again.' }; }
      if (result?.verifiedAccount?.workspaceId !== workspaceId || result?.verifiedAccount?.accountId !== accountId || result?.verifiedAccount?.provider !== provider || result?.endToEndVerified !== true) {
        throw new Error('Provider/account identity and end-to-end read verification are required.');
      }
      const signals = validateEnvelope(result.envelope, { workspaceId, accountId });
      if (result.envelope.source !== provider) throw new Error('Provider mismatch.');
      return { state: 'verified', signals: signals.map(s => ({ ...s, verifiedRead: true, sourceReadStale: false, provenance: 'Verified provider read' })) };
    },
  });
}

const readers = new Map();
const readerKey = ({ workspaceId, accountId, provider }) => JSON.stringify([workspaceId, accountId, provider]);
export function registerAccountReader(options) {
  if (!['gmail', 'calendar'].includes(options.provider) || typeof options.readVerifiedFeed !== 'function') throw new Error('Register an approved provider with a reader function.');
  const key = readerKey(options); readers.set(key, options.readVerifiedFeed);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ember-signal-readers-changed'));
  return () => { readers.delete(key); };
}
export function getAccountAdapters(scope = CONFIG) {
  return ['gmail', 'calendar'].map(provider => createAccountAdapter({ ...scope, provider, readVerifiedFeed: readers.get(readerKey({ ...scope, provider })) }));
}
