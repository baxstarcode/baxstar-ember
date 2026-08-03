/**
 * Sleep-phrase tests — run with: node .devtest/sleepphrase.test.mjs
 *
 * The regex is extracted from src so it can't drift from what ships.
 *
 * Two ways this can be wrong and both are bad: too narrow and Brady has no spoken off
 * switch (the bug this fixes — "go to sleep" was answered conversationally and the mic
 * restarted seconds later); too broad and an ordinary sentence silently kills the mic
 * mid-conversation, which is worse because it looks like a crash. Hence the false-positive
 * block below, drawn from things actually said on a boat.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "src", "baxstar-ember.jsx");

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

const src = fs.readFileSync(SRC, "utf8");
const m = src.match(/const SLEEP_RE = (\/.*\/i);/);
if (!m) throw new Error("SLEEP_RE not found in source");
// eslint-disable-next-line no-new-func
const SLEEP_RE = new Function(`return ${m[1]}`)();

// --- must stop the mic ----------------------------------------------------

for (const phrase of [
  "go to sleep", "Go to sleep.", "GO TO SLEEP",
  "ember go to sleep", "Ember, go to sleep.", "ok ember go to sleep",
  "okay ember, please go to sleep",
  "goodbye", "good bye", "bye",
  "stop listening", "Stop listening.", "stop talking", "stop",
  "quiet", "be quiet", "shut up", "mute", "sleep",
  "that's all", "thats all", "that is all",
  "nevermind", "never mind",
  "we're done", "I'm done", "im done",
  "thanks that's all",
]) {
  check(`stops on: "${phrase}"`, SLEEP_RE.test(phrase));
}

// --- must NOT stop the mic — ordinary things said on a boat ---------------

for (const phrase of [
  "should we stop at the landing",
  "stop by the bait shop on the way",
  "what time do we stop fishing",
  "tell the guys to be quiet the fish are spooky",
  "did that group say goodbye yet",
  "the motor is making a quiet clicking noise",
  "sleep in tomorrow or fish early",
  "how many hours of sleep did the crew get",
  "that's all the walleye we kept",
  "that's all I remember about the booking",
  "never mind the weather what about the wind",
  "draft a reply saying we're done for the season",
  "mute the notifications on the pontoon line",
  "bye the way what's on the calendar",
  "stop the boat",
  "I'm done with the morning trip write it up",
  "what did I miss",
  "brief my day",
]) {
  check(`keeps listening through: "${phrase}"`, !SLEEP_RE.test(phrase));
}

// --- shape ----------------------------------------------------------------

check("anchored — a sleep phrase buried mid-sentence does not trigger",
  !SLEEP_RE.test("I told him to go to sleep early last night"));
check("trailing punctuation tolerated", SLEEP_RE.test("go to sleep!"));
check("surrounding whitespace tolerated", SLEEP_RE.test("   goodbye   "));
check("empty string is not a sleep command", !SLEEP_RE.test(""));

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
