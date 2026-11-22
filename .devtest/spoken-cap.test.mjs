// Spoken turn cap (2026-11-14): runs the real spokenStop/spokenPart/MORE_Q from
// src/baxstar-ember.jsx on the replies that broke earlier versions (adversarial
// review, 2026-11-14). Brady: "DO NOT have her dumbass voice talk forever to tell me
// 12 hours worth of information".
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const src = fs.readFileSync(new URL("../src/baxstar-ember.jsx", import.meta.url), "utf8");
const from = src.indexOf("  const TURN_SENTENCES"), to = src.indexOf("  function endStream()");
assert.ok(from > 0 && to > from, "cap block found in source");
const { spokenStop, spokenPart, MORE_Q } = new Function(src.slice(from, to) + "; return { spokenStop, spokenPart, MORE_Q };")();
const times = (t) => (t.match(/\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b\.?|\bnoon\b|\bmidnight\b/gi) || []).length;

test("an hour-by-hour list stops at its 3rd hour, however it is written", () => {
  const hourly = "Hourly: 10 AM 32° SSE 13 mph 0%; 11 AM 35° SSE 14 mph 0%; 12 PM 38° SSE 13 mph 0%; 1 PM 40° SSE 10 mph 0%; 2 PM 41° SSE 10 mph 0%; 3 PM 39° SSE 10 mph 0%; 4 PM 38° SSE 9 mph 0%; 5 PM 35° SE 9 mph 0%.";
  for (const text of [
    hourly,
    "Here's the wind by the hour: 3 PM SSE 7 mph, 4 PM SSE 8 mph, 5 PM SSE 8 mph, 6 PM S 9 mph, 7 PM S 9 mph and 8 PM SW 4 mph.",
    "3 PM: 41. 4 PM: 42. 5 PM: 40. 6 PM: 38. 7 PM: 36. 8 PM: 34.",
    "Calm at noon, 9 mph at 1 p.m., 10 mph at 2 p.m., then 12 mph at 3 p.m. and 14 at midnight.",
  ]) {
    const p = spokenPart(text);
    assert.equal(times(p.text), 3, text);
    assert.equal(p.capped, true, text);
    assert.ok(p.rest.length > 0 && times(p.rest) >= 1, text);
  }
  assert.equal(spokenPart(hourly).text, "Hourly: 10 AM 32° SSE 13 mph 0%; 11 AM 35° SSE 14 mph 0%; 12 PM 38° SSE 13 mph 0%…");
});

test("a time range counts once, so an ordinary schedule is not cut mid-item", () => {
  for (const text of [
    "Tomorrow you have a charter 6 AM to noon and a pontoon rental 1 PM to 5 PM. That's it.",
    "Three things tomorrow: a charter from 6 AM to noon, a pontoon rental from 1 PM until 5 PM, and a call with Sarah at 7 PM.",
    "The dock is booked 9-11 AM, then 1 PM to 3 PM, and again from 5 PM through 7 PM.",
  ]) assert.deepEqual(spokenPart(text), { text, capped: false, rest: "" });
});

test("dash-, 'and'- and space-separated hour lists keep exactly 3 hours", () => {
  for (const [text, spoken] of [
    ["Wind today: 9 AM 7 mph — 10 AM 8 mph — 11 AM 9 mph — noon 12 mph — 1 PM 13 mph.", "Wind today: 9 AM 7 mph — 10 AM 8 mph — 11 AM 9 mph…"],
    ["Today, wind is 7 mph at 9 AM, rising to 8 at 10 AM and 9 at 11 AM and 12 by noon.", "Today, wind is 7 mph at 9 AM, rising to 8 at 10 AM and 9 at 11 AM…"],
    ["3pm 41 4pm 42 5pm 40 6pm 38", "3pm 41 4pm 42 5pm 40…"],
  ]) {
    const p = spokenPart(text);
    assert.equal(p.text, spoken, text);
    assert.equal(times(p.text), 3, text);
  }
});

test("four sentences at most; a 5th waits for 'keep going'", () => {
  const p = spokenPart("Mostly sunny today with a high of 41. Wind out of the south at 10. Tonight drops to 25. Sunday reaches 46. Monday hits 51.");
  assert.equal(p.text, "Mostly sunny today with a high of 41. Wind out of the south at 10. Tonight drops to 25. Sunday reaches 46.");
  assert.equal(p.rest, "Monday hits 51.");
  assert.equal(spokenPart("Today: 41. Tonight: 28. Sunday: 46. Sunday night: 33. Monday: 51.").rest, "Monday: 51.");
});

test("whitespace and block breaks after punctuation do not consume extra sentences", () => {
  for (const gap of ["\n", " \n", "  \n\n", "\t\n"]) {
    const p = spokenPart(`Yes. No.${gap}Maybe. Certainly. A fifth sentence stays on screen.`);
    assert.equal(p.text, `Yes. No.${gap}Maybe. Certainly.`);
    assert.equal(p.rest, "A fifth sentence stays on screen.");
  }
});

test("decorative-only lines leave all four spoken answer sentences available", () => {
  for (const text of ["🔥\nYes. No. Maybe. Certainly. Fifth.", "Yes.\n🔥\nNo. Maybe. Certainly. Fifth."]) {
    const p = spokenPart(text);
    assert.ok(p.text.endsWith("Certainly."));
    assert.equal(p.rest, "Fifth.");
  }
});

test("an alert in the 4th short sentence is still spoken", () => {
  const text = "Mostly cloudy with a high of 38. Northwest wind 20 to 30 mph, gusting to 45. Snow is likely after 3 PM. A Wind Advisory is in effect until 7 PM.";
  assert.deepEqual(spokenPart(text), { text, capped: false, rest: "" });
});

test("headings, initials, months, U.S., a.m./p.m. and list numbers are not sentence ends", () => {
  for (const text of [
    "Top three voicemails:\n- Sarah wants Sunday.\n- Mike wants a call back.\n- Tom asked about the pontoon.\nPlus 1 hang-up.",
    "Mike T. called about the pontoon. Sarah J. wants Saturday moved to Sunday because of the wind.",
    "Reply to the Tech Camp parent about Aug. 3 before you head out. Nothing else is due.",
    "Sunny, high 41. Light SSE wind. The U.S. Weather Service has a frost advisory tonight.",
    "Winds ease after 3 p.m. today. Calm by sunset. Low of 25 tonight.",
    "Top three: 1. Mike called about Saturday. 2. Sarah emailed about the pontoon. 3. A booking came in.",
    "Dr. Smith called at 9 a.m. about the charter. He wants Sunday.",
    "No. It stays dry all weekend.",
  ]) assert.equal(spokenPart(text).capped, false, text);
});

test("420 written characters is the ceiling, cut at a sentence end or a word", () => {
  const long = "Today: mostly sunny, high near 41 with south southeast wind 7 to 10 mph and no rain at all. " + "Tonight partly cloudy with a low around 25 and wind around 9 mph out of the south southeast. ".repeat(5);
  const p = spokenPart(long);
  assert.ok(p.text.length <= 420 && /[.]$/.test(p.text) && p.capped);
  const noStops = "word ".repeat(150).trim();
  const q = spokenPart(noStops);
  assert.ok(q.text.endsWith("…") && q.text.length <= 421 && q.capped);
});

test("while streaming, the stop point is fixed only once it is known", () => {
  assert.equal(spokenStop("One sentence here. Two sentence. Thr", false), null);
  assert.equal(spokenStop("One. Two. Three. Four.", false), null, "a sentence end at the very end of streaming text is not trusted");
  assert.deepEqual(spokenStop("One. Two. Three. Four.", true), { end: 22, cut: false });
  assert.equal(spokenStop("Wind at 1 PM 10, 2 PM 12, 3 PM 14, and", false), null);
  assert.deepEqual(spokenStop("Wind at 1 PM 10, 2 PM 12, 3 PM 14, 4 PM 9", false), { end: 33, cut: true });
});

test("only a bare 'keep going' style reply continues; a new question does not", () => {
  for (const q of ["Keep going", "keep going.", "Okay, go on", "the rest", "Tell me the rest of it", "more", "What else?"]) assert.ok(MORE_Q.test(q), q);
  for (const q of ["keep going with the weather", "Go on and tell me about Sunday", "What's the weather?", "Read me Sarah's email"]) assert.ok(!MORE_Q.test(q), q);
});
