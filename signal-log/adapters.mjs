import { validateEnvelope, CONFIG } from './core.mjs';

// The host owns authentication and identity. This module never opens consent,
// reads tokens, calls a model, or treats a browser-selected account as authorization.
export function createAccountAdapter({ workspaceId, accountId, provider, readVerifiedFeed }) {
  if (!['gmail', 'calendar'].includes(provider)) throw new Error('Unsupported provider.');
  return Object.freeze({
    workspaceId, accountId, provider,
    async read() {
      if (typeof readVerifiedFeed !== 'function') return { state: 'not-connected', signals: [], reason: 'An authenticated, account-attested Ember feed is not wired to this page.' };
      // Callback must return bounded summaries, not raw mail or arbitrary prompts.
      let result;
      try { result = await readVerifiedFeed({ workspaceId, accountId, provider, limit: CONFIG.maxSignals }); }
      catch { return { state: 'unavailable', signals: [], reason: 'Provider read unavailable. Retain existing records and retry with the connector owner.' }; }
      if (result?.verifiedAccount?.workspaceId !== workspaceId || result?.verifiedAccount?.accountId !== accountId || result?.verifiedAccount?.provider !== provider || result?.endToEndVerified !== true) {
        throw new Error('Provider/account identity and end-to-end read verification are required.');
      }
      const signals = validateEnvelope(result.envelope, { workspaceId, accountId });
      if (result.envelope.source !== provider) throw new Error('Provider mismatch.');
      return { state: 'verified', signals: signals.map(s => ({ ...s, provenance: 'Verified provider read' })) };
    },
  });
}

export const adapters = ['gmail', 'calendar'].map(provider => createAccountAdapter({ ...CONFIG, provider }));
