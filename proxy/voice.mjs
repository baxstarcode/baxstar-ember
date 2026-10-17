// Official Workers AI speech adapters. No browser credentials, arbitrary models,
// provider URLs, connector calls, logging of audio/text, or automatic retries.
export const VOICE_AUDIO_BYTES = 2 * 1024 * 1024;
export const VOICE_TEXT_CHARS = 2000;
const MIME_TYPES = new Set(["audio/mp4", "audio/webm", "audio/ogg"]);
const reply = (body, status, cors) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function handleVoice(kind, body, env, cors, signal) {
  if (env.EMBER_VOICE_ENABLED !== "true" || typeof env.EMBER_VOICE_AI?.run !== "function") {
    return reply({ error: "Voice service is not enabled yet. Recording checks still work on this device." }, 503, cors);
  }
  let model, input;
  if (kind === "voice-transcribe") {
    const audio = body.audio;
    const mime = typeof body.mime === "string" ? body.mime.split(";")[0].trim().toLowerCase() : "";
    if (!MIME_TYPES.has(mime)) return reply({ error: "Unsupported recording format." }, 415, cors);
    if (typeof audio !== "string" || !audio.length || audio.length > 4 * Math.ceil(VOICE_AUDIO_BYTES / 3)
      || audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
      return reply({ error: "Recording is missing, invalid, or too large." }, 400, cors);
    }
    const bytes = audio.length / 4 * 3 - (audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0);
    if (bytes > VOICE_AUDIO_BYTES) return reply({ error: "Recording is too large." }, 413, cors);
    model = "@cf/openai/whisper-large-v3-turbo";
    input = { audio, task: "transcribe", language: "en", vad_filter: true, condition_on_previous_text: false };
  } else {
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > VOICE_TEXT_CHARS) {
      return reply({ error: "Speech text must contain 1–2000 characters." }, 400, cors);
    }
    model = "@cf/deepgram/aura-2-en";
    input = { text: body.text.trim(), speaker: "luna", encoding: "mp3" };
  }
  let timer, abort, reader, expired = false;
  try {
    if (signal?.aborted) return reply({ error: "Voice request cancelled." }, 499, cors);
    const deadline = new Promise((_, reject) => {
      abort = () => { expired = true; reader?.cancel().catch(() => {}); reject(new Error("cancelled")); };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { expired = true; reader?.cancel().catch(() => {}); reject(new Error("timeout")); }, 25000);
    });
    const work = (async () => {
      const result = await env.EMBER_VOICE_AI.run(model, input);
      // The binding does not promise upstream cancellation. Discard late output;
      // never retry an inference whose billing/completion is ambiguous.
      if (expired) { if (result instanceof ReadableStream) await result.cancel(); return null; }
      if (kind === "voice-transcribe") {
        const text = typeof result?.text === "string" ? result.text.trim() : "";
        if (!text) return reply({ error: "No speech was detected. Try a shorter, clear recording." }, 422, cors);
        if (text.length > VOICE_TEXT_CHARS) return reply({ error: "That recording produced too much text. Try a shorter question." }, 422, cors);
        return reply({ text }, 200, cors);
      }
      if (!(result instanceof ReadableStream)) throw new Error("output");
      reader = result.getReader();
      let size = 0; const chunks = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (expired) return null;
        if (done) break;
        size += value.byteLength;
        if (size > VOICE_AUDIO_BYTES) { await reader.cancel(); throw new Error("output"); }
        chunks.push(value);
      }
      if (!size) throw new Error("output");
      return new Response(new Blob(chunks, { type: "audio/mpeg" }), {
        headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    })();
    return await Promise.race([work, deadline]);
  } catch (error) {
    const cancelled = error?.message === "cancelled";
    const timeout = error?.message === "timeout";
    return reply({ error: cancelled ? "Voice request cancelled." : timeout
      ? "Voice service took too long. Nothing was retried automatically."
      : "Voice service could not complete this turn. Your text is still available." }, cancelled ? 499 : timeout ? 504 : 502, cors);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    // Do not await a stuck provider stream while returning a timeout.
    if (expired) reader?.cancel().catch(() => {});
  }
}
