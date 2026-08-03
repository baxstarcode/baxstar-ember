/**
 * Posting-time tests — run with: node .devtest/posttime.test.mjs
 *
 * The time helpers are extracted from src/baxstar-ember.jsx and evaluated here, so these
 * assertions run against the real source rather than a copy that can drift.
 *
 * This exists because nextPostAt() is the one piece of this feature that can be silently,
 * expensively wrong: it decides WHEN a post goes live. An off-by-one-hour DST bug or a
 * wrong-day rollover doesn't throw — it just posts at the wrong time, and nobody notices
 * until the post is already public.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "src", "baxstar-ember.jsx");

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

/* Pull the four helpers out of the source by name and evaluate them together. */
const src = fs.readFileSync(SRC, "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in source`);
  // walk braces from the first { after the signature
  let i = src.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
};

const { centralOffsetMinutes, fmtPostTime, toPostTime, nextPostAt } = new Function(`
  const POST_TZ = "America/Chicago";
  ${grab("centralOffsetMinutes")}
  ${grab("fmtPostTime")}
  ${grab("toPostTime")}
  ${grab("nextPostAt")}
  return { centralOffsetMinutes, fmtPostTime, toPostTime, nextPostAt };
`)();

/* What Central wall-clock time does this instant land on? */
const centralClock = (iso) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

// --- offset: DST is derived, not hardcoded --------------------------------

check("summer is CDT (UTC-5)", centralOffsetMinutes(new Date("2026-08-03T18:00:00Z")) === -300);
check("winter is CST (UTC-6)", centralOffsetMinutes(new Date("2026-01-15T18:00:00Z")) === -360);

// --- label formatting -----------------------------------------------------

check('16:00 reads "4 PM CT"', fmtPostTime("16:00") === "4 PM CT", fmtPostTime("16:00"));
check('19:00 reads "7 PM CT"', fmtPostTime("19:00") === "7 PM CT", fmtPostTime("19:00"));
check('06:30 reads "6:30 AM CT"', fmtPostTime("06:30") === "6:30 AM CT", fmtPostTime("06:30"));
check('00:00 reads "12 AM CT"', fmtPostTime("00:00") === "12 AM CT", fmtPostTime("00:00"));
check('12:00 reads "12 PM CT"', fmtPostTime("12:00") === "12 PM CT", fmtPostTime("12:00"));

// --- legacy values still land somewhere valid ------------------------------

check('legacy "4 PM CT" migrates to 16:00', toPostTime("4 PM CT") === "16:00", toPostTime("4 PM CT"));
check('legacy "7 PM CT" migrates to 19:00', toPostTime("7 PM CT") === "19:00", toPostTime("7 PM CT"));
check('legacy "6:30 AM CT" keeps its minutes', toPostTime("6:30 AM CT") === "06:30", toPostTime("6:30 AM CT"));
check("a modern HH:MM passes through", toPostTime("21:15") === "21:15");
check("garbage falls back to 16:00 rather than throwing", toPostTime("¯\\_(ツ)_/¯") === "16:00");
check("empty falls back to 16:00", toPostTime("") === "16:00");

// --- the load-bearing one: next occurrence in Central ----------------------

{
  // 10:00 Central, well before 4 PM → same day
  const now = new Date("2026-08-03T15:00:00Z");
  const at = nextPostAt("16:00", now);
  check("before the time, posts today at 4 PM Central",
    centralClock(at) === "08/03/2026, 16:00", centralClock(at));
  check("today's slot is in the future", new Date(at) > now);
}

{
  // 18:00 Central, after 4 PM → tomorrow. This is the case a naive
  // "parse 4 PM CT" Zap would get wrong every evening.
  const now = new Date("2026-08-03T23:00:00Z");
  const at = nextPostAt("16:00", now);
  check("after the time, rolls to tomorrow",
    centralClock(at) === "08/04/2026, 16:00", centralClock(at));
}

{
  // Exactly at the time → next day, never "now" (a Delay-Until in the past fires instantly)
  const at = nextPostAt("16:00", new Date("2026-08-03T21:00:00.000Z"));
  check("exactly at the time rolls forward, never fires immediately",
    centralClock(at) === "08/04/2026, 16:00", centralClock(at));
}

{
  // Winter: same wall clock, different UTC instant (CST not CDT)
  const at = nextPostAt("16:00", new Date("2026-01-15T15:00:00Z"));
  check("winter still lands on 4 PM Central",
    centralClock(at) === "01/15/2026, 16:00", centralClock(at));
  check("winter 4 PM Central is 22:00Z, not 21:00Z",
    at === "2026-01-15T22:00:00.000Z", at);
}

{
  // Spring-forward day: 2 AM jumps to 3 AM Central on 2026-03-08
  const at = nextPostAt("16:00", new Date("2026-03-08T09:00:00Z"));
  check("spring-forward day still lands on 4 PM Central",
    centralClock(at) === "03/08/2026, 16:00", centralClock(at));
}

{
  // Fall-back day: 2 AM repeats on 2026-11-01
  const at = nextPostAt("16:00", new Date("2026-11-01T09:00:00Z"));
  check("fall-back day still lands on 4 PM Central",
    centralClock(at) === "11/01/2026, 16:00", centralClock(at));
}

{
  // Month/year rollover
  const at = nextPostAt("16:00", new Date("2026-12-31T23:00:00Z"));
  check("rolls across a year boundary",
    centralClock(at) === "01/01/2027, 16:00", centralClock(at));
}

{
  const at = nextPostAt("06:30", new Date("2026-08-03T15:00:00Z"));
  check("a custom time works the same way",
    centralClock(at) === "08/04/2026, 06:30", centralClock(at));
}

check("output is a valid ISO instant", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(nextPostAt("16:00")));

// --- report ---------------------------------------------------------------

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
