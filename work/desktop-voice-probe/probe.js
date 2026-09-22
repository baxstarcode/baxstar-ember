// Isolated probe: same API gateway and JSON request shape as the Ember app.
// No keys, connector configuration, production imports, or persistent storage.
const MESSAGE_ENDPOINT = window.EMBER_MESSAGE_ENDPOINT || window.EMBER_API_PROXY || "/api/messages";
const TTS_ENDPOINT = window.EMBER_TTS_ENDPOINT || "/api/tts";
const MODEL = "claude-sonnet-4-6";
const VOICE = "en-US-JennyNeural";
// Extra patience after the browser finalizes a phrase, not a native VAD setting.
const END_OF_SPEECH_GRACE_MS = 750;
const $ = (id) => document.getElementById(id);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const transportReady = window.isSecureContext && Boolean(window.fetch && window.AbortController);
const playbackReady = Boolean(window.URL?.createObjectURL && audioSupported());
let mobileOptIn = false;
let recognition = null;
let micPhase = "off";
let request = null;
let audioUrl = "";
let answer = "";
let replyComplete = false;
let generation = 0;
let micTimer = null;
let endSpeechTimer = null;
let endSpeechSequence = 0;
const audio = $("audio");
const sessionStarted = new Date().toISOString();
const sessionClock = performance.now();
const events = [];
const turns = [];
let turn = null;
let nextTurn = 0;
let releaseTimer = null;

function audioSupported() { return typeof HTMLMediaElement !== "undefined"; }
function ready() { return transportReady && (!mobile || mobileOptIn); }
function speechReady() { return ready() && Boolean(Recognition); }
function elapsed() { return Math.round(performance.now() - sessionClock); }

function clearEndSpeechGrace(reason = "") {
  endSpeechSequence += 1;
  if (endSpeechTimer === null) return;
  clearTimeout(endSpeechTimer);
  endSpeechTimer = null;
  if (reason) mark("end-of-speech-grace-cancelled", reason);
}

function scheduleEndSpeechGrace(rec) {
  clearEndSpeechGrace();
  if (recognition !== rec || micPhase !== "listening") return;
  const sequence = endSpeechSequence;
  mark("end-of-speech-grace-started", `${END_OF_SPEECH_GRACE_MS}ms`);
  endSpeechTimer = setTimeout(() => {
    if (sequence !== endSpeechSequence || recognition !== rec || micPhase !== "listening") return;
    endSpeechTimer = null;
    mark("end-of-speech-grace-elapsed", `${END_OF_SPEECH_GRACE_MS}ms`);
    finishTalking();
  }, END_OF_SPEECH_GRACE_MS);
}

function mark(name, detail = "") {
  const entry = { atMs: elapsed(), turn: turn?.number || null, event: name };
  if (detail) entry.detail = detail;
  events.push(entry);
  if (events.length > 300) events.shift();
  if (turn) turn.marks[name] = entry.atMs - turn.startedMs;
}

function beginTurn(source) {
  turn = { number: ++nextTurn, source, startedMs: elapsed(), marks: {}, observation: "unrecorded" };
  turns.push(turn);
  if (turns.length > 30) turns.shift();
  $("turn-number").textContent = `Turn ${turn.number} · physical result not recorded`;
  $("result").value = "";
  $("heard").checked = $("released").checked = false;
  mark("turn-start");
}

function report() {
  return {
    experiment: "Ember explicit-turn voice reliability lab", version: 2,
    status: "PROVISIONAL: browser events are not physical-device proof",
    startedAt: sessionStarted,
    environment: { userAgent: navigator.userAgent, secureContext: window.isSecureContext,
      recognitionAPI: Boolean(Recognition), playbackAPI: playbackReady, mobileDetected: mobile,
      mobileOptIn, endOfSpeechGraceMs: END_OF_SPEECH_GRACE_MS, deviceNotes: $("device-notes").value.trim().slice(0, 500) },
    privacy: "No transcript, reply text, audio, credentials, or business data included. Review your device notes before sharing.",
    turns, events,
  };
}

function log(text) {
  const line = `${new Date().toLocaleTimeString()}  ${text}`;
  $("events").textContent = [line, ...$("events").textContent.split("\n")].slice(0, 35).join("\n");
}

function message(text, error = false) {
  $("message").textContent = text;
  $("message").dataset.error = String(error);
}

function controls() {
  const busy = Boolean(request) || micPhase !== "off";
  $("talk").disabled = !speechReady() || Boolean(request) || ["stopping", "releasing", "unconfirmed"].includes(micPhase);
  $("talk").textContent = micPhase === "starting" ? "Cancel mic start" : micPhase === "listening" ? "Finish talking" : "Talk";
  $("send").disabled = !ready() || busy || !$("transcript").value.trim();
  $("play").disabled = !ready() || !playbackReady || busy || !replyComplete;
  $("transcript").disabled = busy;
  $("stream-reply").disabled = busy;
  $("cancel").disabled = !busy && !audioUrl;
  $("confirm-release").hidden = micPhase !== "unconfirmed";
  $("record-result").disabled = !turn || busy;
}

function micState(phase, label) {
  micPhase = phase;
  $("mic-state").textContent = label;
  log(label);
  controls();
}

function clearAudio() {
  if (audioUrl) mark("audio-cleared");
  audio.onplaying = audio.onpause = audio.onended = audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audio.hidden = true;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = "";
  $("audio-state").textContent = "Audio off";
}

function releasedMic(rec, manual = false) {
  if (recognition !== rec) return;
  clearTimeout(micTimer);
  clearEndSpeechGrace();
  clearTimeout(releaseTimer);
  rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
  rec.onsoundstart = rec.onspeechstart = null;
  recognition = null;
  mark(manual ? "mic-release-user-confirmed" : "recognition-ended");
  micState("off", manual ? "Mic off — indicator confirmed by you" : "Mic off — recognition ended");
}

function closeMic() {
  clearEndSpeechGrace();
  clearTimeout(micTimer);
  const rec = recognition;
  if (!rec) { micState("off", "Mic off"); return; }
  if (["releasing", "unconfirmed"].includes(micPhase)) return;
  // Keep only the release event. A late transcript cannot enter a cancelled turn.
  rec.onstart = rec.onresult = rec.onerror = null;
  rec.onsoundstart = rec.onspeechstart = null;
  rec.onend = () => releasedMic(rec);
  mark("mic-abort-requested");
  micState("releasing", "Mic release requested…");
  releaseTimer = setTimeout(() => {
    if (recognition !== rec) return;
    mark("mic-release-unconfirmed");
    micState("unconfirmed", "Mic release unconfirmed — check the device indicator");
    message("The browser did not confirm microphone release. Check its mic indicator. Confirm below only when it is off, or close this tab. New voice and API turns stay blocked.", true);
  }, 3000);
  try { rec.abort(); } catch { /* The physical indicator gate still applies. */ }
}

function stopAll(reason = "Stopped. Click Talk to start a new turn.") {
  mark("stop-all", document.hidden ? "tab-hidden" : "explicit-or-page-exit");
  generation += 1;
  request?.abort();
  request = null;
  closeMic();
  clearAudio();
  $("interim").textContent = "—";
  if ($("request-state").textContent === "Waiting for response…" || $("request-state").textContent === "Receiving text…") {
    $("request-state").textContent = "Cancelled — partial text is not a complete answer";
    replyComplete = false;
  }
  message(reason);
  controls();
}

function finishTalking() {
  clearEndSpeechGrace();
  if (!recognition) return;
  if (micPhase === "starting") {
    closeMic();
    message("Microphone start cancelled. Nothing was sent.");
    return;
  }
  if (micPhase !== "listening") return;
  const rec = recognition;
  mark("mic-stop-requested");
  micState("stopping", "Mic stopping…");
  clearTimeout(micTimer);
  micTimer = setTimeout(() => {
    if (recognition !== rec) return;
    closeMic();
    message("Recognition did not finish within 3 seconds. Abort requested; check the browser’s mic indicator.", true);
  }, 3000);
  try { rec.stop(); } catch {
    closeMic();
    message("Recognition could not finish. Click Talk to retry.", true);
  }
}

function startTalking() {
  if (recognition) { finishTalking(); return; }
  if (!speechReady() || request || micPhase !== "off") return;
  clearEndSpeechGrace();
  generation += 1;
  if (audioUrl) mark("playback-to-mic-handoff-requested");
  clearAudio();
  beginTurn("microphone");
  answer = "";
  replyComplete = false;
  $("reply").textContent = "Your response will appear here.";
  $("request-state").textContent = "Not sent";
  $("transcript").value = "";
  $("interim").textContent = "—";
  let rec;
  try { rec = new Recognition(); } catch {
    mark("recognition-constructor-failed");
    message("This browser could not create a speech recognition session.", true);
    controls();
    return;
  }
  recognition = rec;
  rec.lang = "en-US";
  // Keep this explicit session open across phrase finals. Never auto-restart.
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onstart = () => {
    if (recognition !== rec) return;
    clearTimeout(micTimer);
    mark("recognition-started");
    $("permission").textContent = "Microphone permission: recognition started.";
    micState("listening", "Listening");
    message("Speak naturally. After a final phrase, the lab waits an extra 0.75 seconds for you to continue. Finish talking ends immediately.");
    micTimer = setTimeout(finishTalking, 30000);
  };
  // Activity events can arrive before a new transcript. Do not cut off a speaker
  // merely because recognition has not produced their next words yet.
  rec.onsoundstart = rec.onspeechstart = () => {
    if (recognition === rec && micPhase === "listening") clearEndSpeechGrace("speech-activity");
  };
  rec.onresult = (event) => {
    if (recognition !== rec) return;
    clearEndSpeechGrace("recognition-result");
    let finalText = "";
    let interim = "";
    const results = Array.from(event.results);
    for (const result of results) {
      if (result.isFinal) finalText += `${result[0].transcript} `;
      else interim += `${result[0].transcript} `;
    }
    $("transcript").value = finalText.trim().slice(0, 1000);
    if (finalText && turn && !("first-final-transcript" in turn.marks)) mark("first-final-transcript");
    $("interim").textContent = interim.trim() || "—";
    // A result event may include an old final plus an unfinished new phrase.
    // Even an empty interim result is unfinished; never arm a cutoff for it.
    const changed = results.slice(Number.isInteger(event.resultIndex) ? event.resultIndex : 0);
    if (finalText.trim() && !results.some((result) => !result.isFinal) &&
        changed.some((result) => result.isFinal)) scheduleEndSpeechGrace(rec);
  };
  rec.onerror = (event) => {
    if (recognition !== rec) return;
    const reasons = {
      "not-allowed": ios ? "Microphone blocked. Check Safari’s website microphone permission and iPhone Settings for Safari and Siri, then retry. A reload may be required." : "Microphone blocked. Allow this site in the browser’s settings and allow the browser in your operating system’s microphone settings, then retry.",
      "service-not-allowed": "The browser’s speech service is unavailable or blocked. In Safari, check that Siri is enabled; also check browser or organization policy.",
      "audio-capture": "No working microphone is available. Check your device’s input and microphone settings.",
      "network": "The browser’s speech recognition service could not be reached. Check the network and retry.",
      "no-speech": "No speech was detected. Click Talk and try again.",
      "aborted": "Recognition was aborted. Click Talk to try again.",
    };
    if (event.error === "not-allowed") $("permission").textContent = "Microphone permission: blocked.";
    mark("recognition-error", event.error || "unknown");
    closeMic();
    message(reasons[event.error] || `Speech recognition failed (${event.error || "unknown error"}).`, true);
    log(`Recognition error: ${event.error || "unknown"}`);
  };
  rec.onend = () => {
    if (recognition !== rec) return;
    releasedMic(rec);
    $("interim").textContent = "—";
    message($("transcript").value.trim()
      ? "Review the final transcript, then click Send transcript."
      : "Recognition ended without a final transcript. Nothing was sent; click Talk to retry.");
  };
  micState("starting", "Requesting microphone…");
  mark("mic-start-requested");
  message("Allow microphone access if the browser asks. Listening begins only when it confirms it.");
  micTimer = setTimeout(() => {
    if (recognition !== rec) return;
    mark("mic-start-timeout");
    closeMic();
    message("The browser did not start recognition within 15 seconds. Check site and device permissions; wait for release before retrying.", true);
  }, 15000);
  try { rec.start(); } catch (error) {
    closeMic();
    message(`Microphone could not start (${error.name || "unknown error"}). Check permissions and retry.`, true);
  }
}

async function readReply(response, onText) {
  if (!(response.headers.get("content-type") || "").includes("text/event-stream")) {
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "The AI returned an error.");
    const text = (data.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    if (!text) throw new Error("The AI returned no text.");
    if (data.stop_reason === "max_tokens") throw new Error("The response reached its token limit. Try a shorter question.");
    onText(text);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let complete = false;
  function event(frame) {
    const lines = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
    if (!lines.length) return;
    const data = JSON.parse(lines.join("\n"));
    if (data.type === "error") throw new Error(data.error?.message || "The AI stream failed.");
    if (data.type === "message_delta" && data.delta?.stop_reason === "max_tokens") throw new Error("Response token limit reached; text is incomplete.");
    if (data.type === "content_block_start" && data.content_block?.type === "text") {
      if (text) text += "\n";
      text += data.content_block.text || "";
    }
    if (data.type === "content_block_delta" && data.delta?.type === "text_delta") text += data.delta.text;
    if (data.type === "message_stop") complete = true;
    if (text) onText(text);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize only complete line endings; a CR/LF pair may cross a chunk boundary.
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop();
      for (const frame of frames) event(frame.replace(/\r\n/g, "\n"));
      if (done) break;
    }
    if (pending.trim()) event(pending.replace(/\r\n/g, "\n"));
    if (!complete) throw new Error("The stream ended early. Displayed text is incomplete.");
    if (!text.trim()) throw new Error("The AI stream returned no text.");
    return text.trim();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function sendTranscript() {
  const transcript = $("transcript").value.trim().slice(0, 1000);
  if (!ready() || micPhase !== "off" || recognition || request || !transcript) return;
  if (!turn || "text-sent" in turn.marks) beginTurn("typed-or-resubmitted");
  const stream = $("stream-reply").checked;
  mark("text-sent", stream ? "streaming" : "non-streaming");
  turn.stream = stream;
  clearAudio();
  answer = "";
  replyComplete = false;
  $("reply").textContent = "";
  const token = ++generation;
  const controller = new AbortController();
  request = controller;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
  $("request-state").textContent = "Waiting for response…";
  message("Sending the reviewed text to Ember’s proxy. Mic is off.");
  controls();
  const started = performance.now();
  try {
    const response = await fetch(MESSAGE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300, stream,
        // The production gateway intentionally strips client-supplied `system`.
        // Keep the probe's bounded reply contract inside the user message that
        // the Worker explicitly permits, followed by the reviewed transcript.
        messages: [{ role: "user", content:
          "This is an isolated voice feasibility test. Answer the reviewed transcript in one short plain sentence under 60 words. You have no business tools or access to live business data. Do not claim to have taken any external action.\n\nReviewed transcript:\n" + transcript }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Proxy HTTP ${response.status}. Check the deployed proxy and allowed origin (${location.origin}).`);
    const result = await readReply(response, (text) => {
      if (token !== generation) return;
      if (turn && !("first-response-text" in turn.marks)) mark("first-response-text");
      $("reply").textContent = text;
      $("request-state").textContent = "Receiving text…";
    });
    if (token !== generation) return;
    answer = result;
    replyComplete = true;
    mark("text-complete");
    $("request-state").textContent = `Complete · ${((performance.now() - started) / 1000).toFixed(1)}s`;
    message("Text response received. Click Play response to test neural audio, or Talk for another turn.");
    log("Proxy returned a complete text response.");
  } catch (error) {
    if (token !== generation) return;
    mark("text-failed", timedOut ? "timeout" : "request-or-stream-error");
    $("request-state").textContent = "Request failed";
    message(timedOut ? "Proxy timed out after 45 seconds. Any displayed text is incomplete."
      : error instanceof TypeError ? "Cannot reach the proxy. Use the authenticated production test page and check your connection. The local static server has no API gateway."
      : error.message, true);
    log("Proxy request failed.");
  } finally {
    clearTimeout(timer);
    if (token === generation) { request = null; controls(); }
  }
}

async function playResponse() {
  if (!ready() || !playbackReady || micPhase !== "off" || recognition || request || !replyComplete) return;
  mark("tts-requested");
  clearAudio();
  const token = ++generation;
  const controller = new AbortController();
  request = controller;
  const timer = setTimeout(() => controller.abort(), 15000);
  let playbackTimer;
  $("audio-state").textContent = "Generating neural audio…";
  message("Requesting neural audio. Mic stays off.");
  controls();
  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: answer.slice(0, 1000), voice: VOICE }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Neural TTS HTTP ${response.status}. Text response is still available.`);
    if (!(response.headers.get("content-type") || "").includes("audio/")) throw new Error("TTS returned a non-audio response.");
    const blob = await response.blob();
    if (blob.size < 200) throw new Error("TTS returned empty or too-small audio.");
    if (token !== generation) return;
    clearTimeout(timer);
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    audio.hidden = false;
    mark("audio-ready");
    audio.onplaying = () => {
      if (token !== generation) return;
      $("audio-state").textContent = "Playing — confirm you can hear it";
      message("The browser reports playback. Confirm the voice is audible through your actual speaker.");
      mark("audio-playing");
      log("Audio element fired playing (audibility not verified).");
    };
    audio.onended = () => {
      if (token !== generation) return;
      $("audio-state").textContent = "Playback ended — mic stays off";
      mark("audio-ended");
      log("Audio element fired ended.");
    };
    audio.onpause = () => {
      if (token === generation && !audio.ended) {
        mark("audio-paused");
        $("audio-state").textContent = "Audio paused — mic stays off";
      }
    };
    audio.onerror = () => {
      if (token !== generation) return;
      $("audio-state").textContent = "Audio playback error";
      mark("audio-error");
      message("The browser could not decode or play the neural audio. Text is still available.", true);
    };
    $("audio-state").textContent = "Audio ready";
    // A separate Play click and visible native controls make autoplay failure reviewable.
    try {
      await Promise.race([
        audio.play(),
        new Promise((_, reject) => { playbackTimer = setTimeout(() => reject(new Error("Playback did not start")), 5000); }),
      ]);
    } catch {
      if (token !== generation) return;
      audio.pause();
      mark("audio-playback-blocked");
      $("audio-state").textContent = "Playback blocked — use audio player Play";
      message("The browser did not start playback. Tap Play on the audio player below; a fresh tap may be required after the audio download.", true);
    }
  } catch (error) {
    if (token !== generation) return;
    mark("tts-failed", error.name === "AbortError" ? "timeout" : "request-or-audio-error");
    $("audio-state").textContent = "Audio unavailable";
    message(error.name === "AbortError" ? "TTS timed out after 15 seconds. Text is still available."
      : error instanceof TypeError ? "Cannot reach the TTS endpoint. Check network and proxy CORS."
      : error.message, true);
    log("TTS request failed.");
  } finally {
    clearTimeout(timer);
    clearTimeout(playbackTimer);
    if (token === generation) { request = null; controls(); }
  }
}

$("talk").addEventListener("click", startTalking);
$("cancel").addEventListener("click", () => stopAll());
$("send").addEventListener("click", sendTranscript);
$("play").addEventListener("click", playResponse);
$("transcript").addEventListener("input", controls);
$("confirm-release").addEventListener("click", () => {
  if (micPhase !== "unconfirmed" || !recognition) return;
  releasedMic(recognition, true);
  message("Mic indicator recorded as off. This required manual recovery; record the turn as Limited or Failed before retrying.");
});
$("mobile-opt-in").addEventListener("change", () => {
  mobileOptIn = $("mobile-opt-in").checked;
  if (!mobileOptIn) stopAll("Phone experiment disabled. Nothing restarts automatically.");
  mark(mobileOptIn ? "mobile-experiment-enabled" : "mobile-experiment-disabled");
  updateCapability();
  controls();
});
$("record-result").addEventListener("click", () => {
  if (!turn || request || micPhase !== "off") return;
  const result = $("result").value;
  if (!result) { message("Choose Pass, Limited, or Failed for this physical turn.", true); return; }
  const heard = $("heard").checked;
  const released = $("released").checked;
  const incomplete = ["recognition-started", "first-final-transcript", "recognition-ended", "text-complete", "audio-ended"].some((name) => !(name in turn.marks));
  const recovered = ["mic-release-unconfirmed", "recognition-error", "audio-playback-blocked", "audio-error", "text-failed", "tts-failed", "stop-all"].some((name) => name in turn.marks);
  if (result === "pass" && (!heard || !released || turn.source !== "microphone" || incomplete || recovered)) {
    message("A full pass needs a microphone turn, complete text, ended audio, and your confirmation of mic release and audibility. Use Limited for a partial test or any recovery.", true);
    return;
  }
  turn.observation = { result, micIndicatorOff: released, replyAudible: heard };
  mark("physical-result-recorded", result);
  $("turn-number").textContent = `Turn ${turn.number} · ${result} recorded by you`;
  message("Observation recorded in this page only. Prepare and copy the report before closing or reloading.");
});
$("prepare-report").addEventListener("click", () => {
  $("report").value = JSON.stringify(report(), null, 2);
  $("report-panel").hidden = false;
  message("Report prepared without transcript or reply text. Review your device notes, then copy it into the Ember task.");
});
$("copy-report").addEventListener("click", async () => {
  $("report").value = JSON.stringify(report(), null, 2);
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText($("report").value);
    message("Report copied. Paste it into the Ember task.");
  } catch {
    $("report").focus();
    $("report").select();
    message("Automatic copy is unavailable. The report is selected; use your device’s Copy command.");
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAll("Paused because the tab was hidden. Click Talk when you return.");
});
window.addEventListener("pagehide", () => stopAll("Page closed."));

function updateCapability() {
  $("capability").textContent = !window.isSecureContext ? "Microphone requires a secure context. Use the HTTPS production page; localhost is only for desktop diagnostics."
    : !transportReady ? "Required request APIs are unavailable in this browser. This probe cannot send text or generate audio."
    : mobile && !mobileOptIn ? "Phone/tablet experiment is off. Opt in below to test this device; detecting an API does not prove reliability."
    : !Recognition ? "Speech recognition API is unavailable in this browser. Typed text and optional neural playback can be tested, but microphone voice is unsupported here."
    : mobile ? "Experimental phone recognition API detected. Use Safari on iPhone for the first test, keep this tab visible, and record interruptions and recovery. Reliability is PROVISIONAL."
    : "Speech recognition API detected. Target: desktop Chrome on your Mac; availability does not prove it works.";
  if (!playbackReady) $("capability").textContent += " Required audio playback APIs are unavailable.";
}
$("mobile-experiment").hidden = !mobile;
updateCapability();
$("connection").textContent = `Messages: ${MESSAGE_ENDPOINT} · Voice: ${TTS_ENDPOINT} · Model: ${MODEL} · Origin: ${location.origin}`;
// The Permissions API only reads existing state; it never prompts or captures audio.
try {
  navigator.permissions?.query({ name: "microphone" }).then((permission) => {
    const update = () => { $("permission").textContent = `Microphone permission: ${permission.state} (browser-reported; device permission may also be required).`; };
    update();
    permission.onchange = update;
  }).catch(() => {});
} catch {}
controls();
mark("probe-loaded");
log("Probe loaded. No microphone or network request started.");
