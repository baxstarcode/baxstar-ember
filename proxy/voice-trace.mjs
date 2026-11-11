// VOICE TRACE (2026-11-11). The dashboard posts one record per spoken turn so a
// real iPhone or Mac answers "did the mic come back, and how fast did Jenny
// start?" in Workers Logs without Brady running a test. Only allowlisted event
// names, small integers and short enum strings survive; anything else (words,
// audio, URLs, free text) is dropped before the single log line is written.
export const VOICE_TRACE_BYTES = 4096;
const MARKS = new Set([
  "start-called", "onstart", "audiostart", "soundstart", "speechstart", "first-result", "first-final",
  "last-result", "finish", "error", "end", "send", "reply-headers", "tool-result", "first-text", "first-clip-request",
  "first-clip-ready", "first-sound", "reply-complete", "reply-ended",
]);
const ENUMS = {
  ua: /^(ios-safari|ios-chrome|ios-firefox|ios-edge|mac-chrome|mac-safari|chrome|edge|other)$/,
  engine: /^(webkit|other)$/,
  trigger: /^(tap|auto|retry|deaf-retry|interrupt)$/,
  outcome: /^(spoke|not-spoken|stopped|interrupted|replaced|unfinished|no-words|no-words-retry|no-audio|no-audio-retry|speech-failed|reply-failed)$/,
  out: /^(web|element)$/,
  session: /^(auto|playback|transient|transient-solo|ambient|play-and-record)\/(active|inactive|interrupted|undefined)$/,
  error: /^[a-z-]{1,24}$/,
};
const LIVE = /^(calendar|email|calls and texts|files|messages)$/;
const GUARD = /^(ok|retried|refused|caveat)$/;
const ms = (v) => Number.isInteger(v) && v >= 0 && v <= 600000 ? v : undefined;
const signedMs = (v) => Number.isInteger(v) && Math.abs(v) <= 600000 ? v : undefined;

export function sanitizeVoiceTrace(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.v !== 1) return null;
  const out = { v: 1 };
  for (const [key, re] of Object.entries(ENUMS)) {
    if (typeof body[key] === "string" && re.test(body[key])) out[key] = body[key];
  }
  if (!out.ua || !out.outcome) return null;
  if (Number.isInteger(body.n) && body.n > 0 && body.n < 10000) out.n = body.n;
  const since = ms(body.sinceReplyEndMs); if (since !== undefined) out.sinceReplyEndMs = since;
  const gap = signedMs(body.lastWordsToSoundMs); if (gap !== undefined) out.lastWordsToSoundMs = gap;
  const marks = {};
  if (body.marks && typeof body.marks === "object" && !Array.isArray(body.marks)) {
    for (const [name, value] of Object.entries(body.marks)) if (MARKS.has(name) && ms(value) !== undefined) marks[name] = value;
  }
  out.marks = marks;
  const r = body.reply;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const reply = {};
    if (typeof r.live === "string" && LIVE.test(r.live)) reply.live = r.live;
    if (typeof r.guard === "string" && GUARD.test(r.guard)) reply.guard = r.guard;
    if (Number.isInteger(r.tools) && r.tools >= 0 && r.tools < 100) reply.tools = r.tools;
    if (r.tool === true) reply.tool = true;
    if (Object.keys(reply).length) out.reply = reply;
  }
  return out;
}

export function handleVoiceTrace(body, cors, log = console.log) {
  const record = sanitizeVoiceTrace(body);
  if (record) log(JSON.stringify({ event: "voice-trace", ...record }));
  return new Response(null, { status: record ? 204 : 400, headers: { ...cors, "Cache-Control": "no-store" } });
}
