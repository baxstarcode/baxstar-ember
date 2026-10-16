import { createVoiceHandler } from "../../server/iphone-voice.mjs";

// Exact route takes precedence over the existing [[path]] gateway. It stays
// disabled until its separate Cloudflare Access Service Auth gate is configured.
export const onRequest = createVoiceHandler();
