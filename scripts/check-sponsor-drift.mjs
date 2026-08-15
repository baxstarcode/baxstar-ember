#!/usr/bin/env node
/**
 * Sponsor drift check — the machine that replaced a CLAUDE.md rule.
 *
 * The sponsor handles live in two apps: this repo's src/baxstar-ember.jsx and
 * the standalone baxstarcode/caption-studio (app/index.html). Two front doors
 * is deliberate; the cost used to be a hand rule — "when either side changes,
 * check the other" — and the one time nobody did, Ember tagged @vexusboats
 * when Brady's sponsor is @therealvexusboats: a different, real account,
 * notified on every sponsored post.
 *
 * Both apps store handles the same way, in `handles: [...]` arrays. This
 * compares the two sets exactly and fails loudly on any difference.
 *
 *   node scripts/check-sponsor-drift.mjs                 # fetches the standalone from GitHub
 *   node scripts/check-sponsor-drift.mjs --local <path>  # compares against a local file
 */
import fs from "node:fs";

const STANDALONE_RAW =
  "https://raw.githubusercontent.com/baxstarcode/caption-studio/main/app/index.html";
const EMBER_SRC = new URL("../src/baxstar-ember.jsx", import.meta.url);

function extractHandles(source, label) {
  // Only handles inside `handles: [...]` arrays count — @mentions in prose,
  // comments, or sample captions must not pollute the set.
  const sets = [...source.matchAll(/handles\s*:\s*\[([^\]]*)\]/g)];
  const out = new Set();
  for (const m of sets) {
    for (const h of m[1].matchAll(/@[a-z0-9_.]+/gi)) out.add(h[0].toLowerCase());
  }
  if (!out.size) {
    console.error(`FAIL: found no handles at all in ${label} — the extractor or the file changed shape.`);
    process.exit(1);
  }
  return out;
}

const localIdx = process.argv.indexOf("--local");
let standaloneSrc;
if (localIdx !== -1) {
  standaloneSrc = fs.readFileSync(process.argv[localIdx + 1], "utf8");
} else {
  const res = await fetch(STANDALONE_RAW);
  if (!res.ok) {
    console.error(`FAIL: could not fetch the standalone app (${res.status}). Not proof of drift — rerun, or use --local.`);
    process.exit(2);
  }
  standaloneSrc = await res.text();
}

const ember = extractHandles(fs.readFileSync(EMBER_SRC, "utf8"), "src/baxstar-ember.jsx");
const standalone = extractHandles(standaloneSrc, "caption-studio app/index.html");

const onlyEmber = [...ember].filter((h) => !standalone.has(h)).sort();
const onlyStandalone = [...standalone].filter((h) => !ember.has(h)).sort();

if (onlyEmber.length || onlyStandalone.length) {
  console.error("SPONSOR DRIFT — the two apps disagree about who gets tagged:");
  if (onlyEmber.length) console.error("  only in Ember:      " + onlyEmber.join(" "));
  if (onlyStandalone.length) console.error("  only in standalone: " + onlyStandalone.join(" "));
  console.error("Fix the side that is wrong, in its own repo. Canonical example: @therealvexusboats, never @vexusboats.");
  process.exit(1);
}

console.log(`sponsors in sync — ${ember.size} handles identical in both apps`);
