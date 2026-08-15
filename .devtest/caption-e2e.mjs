/**
 * Caption Studio browser test — run with: node .devtest/caption-e2e.mjs
 *
 * Drives the REAL generated index.html in headless Chromium. Everything the page would
 * reach out to is intercepted: the Claude proxy returns canned vision/caption responses,
 * and the Drive outbox records the payload it was handed. So no API key, no Anthropic
 * spend, no Drive write, no deploy — but the canvas resize, the React state, the CORS-
 * simple fetch shape and the published payload are all the genuine article.
 *
 * The parts worth testing here are precisely the ones a unit test can't reach: the
 * <=1440 publish render only exists inside a browser canvas, and the "did the right bytes
 * and the right caption leave the page" question is the one that costs a bad post.
 *
 * Needs a browser, which is why playwright is NOT in devDependencies — `npm install` stays
 * light for the everyday build. Install it just for this run:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run test:caption
 *
 * Run `npm run build` first: this drives index.html, not the source.
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

/* The generated index.html sets EMBER_API_PROXY in its own config block, which runs after
   any addInitScript — so the stub has to intercept the URL the page is actually built
   with, read straight out of the file rather than assumed. */
const PROXY = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
  .match(/EMBER_API_PROXY *= *"([^"]+)"/) || [])[1];
if (!PROXY) throw new Error("no EMBER_API_PROXY in index.html — run `npm run build` first");
const OUTBOX = "https://script.google.com/macros/s/TEST/exec";

/* --- serve the built app on a real origin (file:// breaks canvas + storage) --- */
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("no");
    return;
  }
  const ext = path.extname(file);
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml",
    ".json": "application/json", ".webmanifest": "application/manifest+json" }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* --- canned model output ------------------------------------------------- */

const VISION = {
  species: "Smallmouth Bass",
  confidence: "high",
  vexusBoat: true,
  vexusLogo: false,
  mercury: true,
  powerPole: false,
  striker: false,
  eternalLithium: false,
  sunglasses: true,
  summit: false,
  notes: "Golden hour, clean release shot.",
};

// Six hashtags on purpose — with the locked tag that is seven, and the cap must trim it
// back to five with two reported as dropped.
const CAPTION = `Morning bite was on before the coffee cooled.

Big smallie, clean release, back before the wind came up.

#smallmouthbass #smallmouthbassfishing #detroitlakes #minnesotafishing #walleye #guidedfishing`;

const reply = (text) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 10, output_tokens: 10 },
});

// Sandboxed CI environments (Claude Code on the web included) pre-install a
// Chromium at a fixed path instead of Playwright's per-version cache. Use it
// when it exists so the test runs without a 100MB browser download.
const PREINSTALLED = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(
  (await import("fs")).existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const proxyCalls = [];
let published = null;
let publishRequestHeaders = null;
let preflights = 0;

await page.route(`${PROXY}**`, async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  proxyCalls.push(body);
  const asText = JSON.stringify(body);
  // The vision scan asks for JSON; the caption call asks for prose.
  const isScan = /ONLY valid JSON/.test(asText);
  await route.fulfill({
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    contentType: "application/json",
    body: JSON.stringify(reply(isScan ? JSON.stringify(VISION) : CAPTION)),
  });
});

await page.route(`${OUTBOX}**`, async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") { preflights++; }
  publishRequestHeaders = await req.allHeaders();
  published = JSON.parse(req.postData() || "{}");
  await route.fulfill({
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    contentType: "application/json",
    body: JSON.stringify({ ok: true, slideCount: (published.images || []).length }),
  });
});

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

/* Point the app at the stub proxy and pre-seed the outbox URL before any script runs. */
await page.addInitScript((outbox) => {
  window.localStorage.setItem("ember-outbox-url", JSON.stringify(outbox));
}, OUTBOX);

await page.goto(`${ORIGIN}/index.html?tool=captions`, { waitUntil: "load" });
await page.waitForSelector(".upzone", { timeout: 15000 });

check("deep-link ?tool=captions opens Caption Studio", await page.locator(".upzone").isVisible());

/* --- upload two photos of different sizes -------------------------------- */

// 2000x1500 and 900x1200 — the first is over both render ceilings, the second under the
// publish ceiling but over nothing else, so the scaling math gets exercised both ways.
const makeJpeg = (w, h, hue) => page.evaluate(async ([w, h, hue]) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = `hsl(${hue},70%,50%)`;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff";
  g.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
  const buf = new Uint8Array(await blob.arrayBuffer());
  return Array.from(buf);
}, [w, h, hue]);

const a = await makeJpeg(2000, 1500, 20);
const b = await makeJpeg(900, 1200, 200);

await page.setInputFiles('input[type="file"]', [
  { name: "catch-1.jpg", mimeType: "image/jpeg", buffer: Buffer.from(a) },
  { name: "catch-2.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b) },
]);

// Wait for the slide strip to appear FIRST. Waiting only for "SCANNING" to vanish is a
// race — before the scan starts the word isn't on the page either, so the check passed
// instantly and the assertions below read an empty UI.
await page.waitForFunction(() => /2\/6 slides/.test(document.body.innerText), null, { timeout: 20000 });
await page.waitForFunction(() => !document.body.innerText.includes("SCANNING"), null, { timeout: 20000 });

check("two files load as a 2-slide carousel", /2\/6 slides/.test(await page.locator("body").innerText()));
check("vision scan was ONE call for the whole set",
  proxyCalls.length === 1 && proxyCalls[0].messages[0].content.filter((c) => c.type === "image").length === 2,
  `calls=${proxyCalls.length}`);

const bodyText = () => page.locator("body").innerText();
// waitForFunction, not an instant read — the SCANNING overlay clears a tick before
// React commits the species text, and reading immediately was flaky.
const speciesShown = await page.waitForFunction(
  () => /smallmouth bass/i.test(document.body.innerText), null, { timeout: 5000 }
).then(() => true, () => false);
check("species came back from the scan", speciesShown);

/* --- sponsor chips ------------------------------------------------------- */

const chipOn = (label) => page.locator(`.toggle-chip.on:has-text("${label}")`).count();

check("detected sponsors are pre-armed", (await chipOn("Vexus boat")) === 1 && (await chipOn("Mercury")) === 1);
check("undetected sponsors stay off", (await chipOn("Striker")) === 0 && (await chipOn("Power-Pole")) === 0);
check("all ten sponsor chips render", (await page.locator(".toggle-chip").count()) === 10,
  String(await page.locator(".toggle-chip").count()));

/* --- caption ------------------------------------------------------------- */

await page.locator('button:has-text("Generate Caption")').click();
try {
  await page.waitForSelector("textarea", { timeout: 20000 });
} catch (e) {
  console.error("--- caption never rendered; page said: ---");
  console.error(await bodyText());
  console.error("--- proxy calls:", proxyCalls.length, "page errors:", consoleErrors.join(" | "));
  throw e;
}

check("caption call sent both slides", proxyCalls.length === 2 &&
  proxyCalls[1].messages[0].content.filter((c) => c.type === "image").length === 2);

const tagPill = await page.locator('text=/\\d\\/5 TAGS/').first().innerText();
check("hashtag cap enforced and the trim is reported", /5\/5 TAGS · 2 TRIMMED/.test(tagPill), tagPill);

/* --- copy ---------------------------------------------------------------- */

await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
await page.locator('button:has-text("Copy Caption")').click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
const clipTags = (clip.match(/#[\w]+/g) || []);
check("copied text carries exactly 5 hashtags", clipTags.length === 5, clipTags.join(" "));
check("copied text ends with the locked tag block and the handles",
  clip.includes("#getyourbassingear") && clip.includes("@therealvexusboats") && clip.includes("@mercurymarine"), clip);
check("the trimmed hashtags really are gone", !clip.includes("#walleye") && !clip.includes("#guidedfishing"), clip);

/* --- publish ------------------------------------------------------------- */

// v2 destinations: IG FEED is on by default; add IG STORY so the 9:16 render
// path runs for real inside the browser canvas.
await page.locator('button.surface-chip:has-text("IG STORY")').click();

/* --- feed-aspect gate ----------------------------------------------------
   Slide 2 (900x1200, h/w 1.333) is taller than Instagram's 4:5 feed ceiling. With a
   feed surface on, the FIRST Publish press must warn and send nothing — Meta would
   otherwise crop or reject the photo hours later with nobody watching the Zap. */
await page.locator('button:has-text("Publish to Drive Outbox")').click();
await page.waitForFunction(() => /taller than Instagram/.test(document.body.innerText), null, { timeout: 10000 });
check("tall slide trips the feed-aspect gate before anything is sent", !published);
check("the gate names the offending slide", /Slide 2 is/.test(await page.locator("body").innerText()));

// FIT 4:5 crops the feed render (the story render keeps the full frame) and the
// flag disappears with the reason for it.
await page.locator('button[aria-label="Fit slide 2 to 4:5"]').click();
await page.waitForFunction(() => !document.querySelector('button[aria-label="Fit slide 2 to 4:5"]'), null, { timeout: 10000 });

await page.locator('button:has-text("Publish to Drive Outbox")').click();
// Wait for the CAPTURE, not for page text — "outbox" appears in the button
// label itself, so the old innerText wait resolved instantly and only won the
// race because publish used to be synchronous-fast. Story rendering isn't.
{
  const t0 = Date.now();
  while (!published && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
}

check("publish reached the outbox", !!published);
check("publish sent BOTH slides", (published.images || []).length === 2, String((published.images || []).length));
check("publish is a CORS-simple text/plain POST (no preflight)",
  /text\/plain/.test(publishRequestHeaders["content-type"] || "") && preflights === 0,
  `${publishRequestHeaders["content-type"]} preflights=${preflights}`);
check("auto-post caption excludes @handles", !/@/.test(published.caption || ""), published.caption);
check("captionWithHandles keeps them", /@therealvexusboats/.test(published.captionWithHandles || ""));
check("published caption is capped at 5 hashtags",
  (published.caption.match(/#[\w]+/g) || []).length === 5,
  (published.caption.match(/#[\w]+/g) || []).join(" "));
check("sponsors travel as the tag list, canonical Vexus handle",
  (published.sponsors || []).includes("@therealvexusboats") && !(published.sponsors || []).includes("@vexusboats"),
  JSON.stringify(published.sponsors));
// The invariant is "a name, never an ID" — not one specific lake, which changes with
// the season. A numeric value here is what Meta hard-rejects.
check("lake is a plain name, not an ID",
  typeof published.lake === "string" && published.lake.length > 0 && !/^\d+$/.test(published.lake),
  String(published.lake));
check("postAt is an ISO instant a Delay-Until step can consume",
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(published.postAt || "") &&
  new Date(published.postAt) > new Date(), String(published.postAt));
check("imageBase64 still carries slide one for older deploys",
  published.imageBase64 === published.images[0]);

/* v2 destination contract — the Zap branches on these. */
check("payloadVersion is 2", published.payloadVersion === 2);
check("two slides declare a carousel", published.format === "carousel", String(published.format));
check("surfaces carry the tapped set, feed + story",
  Array.isArray(published.surfaces) && published.surfaces.includes("ig_feed") && published.surfaces.includes("ig_story"),
  JSON.stringify(published.surfaces));
check("video-only surfaces cannot leak into the payload",
  !(published.surfaces || []).some((x) => x === "ig_reel" || x === "tiktok"));
check("story renders exist, one per slide", (published.storyImages || []).length === (published.images || []).length,
  String((published.storyImages || []).length));
check("story render is a decodable 1080x1920 JPEG", await (async () => {
  const dim = await page.evaluate(async (b64) => {
    const i = new Image();
    await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = "data:image/jpeg;base64," + b64; });
    return [i.width, i.height];
  }, published.storyImages[0]);
  return dim[0] === 1080 && dim[1] === 1920;
})());

/* The renders: vision small, publish large, and both actually decodable JPEGs. */
const dims = await page.evaluate(async (imgs) => {
  const read = (b64) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res([i.width, i.height]);
    i.onerror = () => res(null);
    i.src = "data:image/jpeg;base64," + b64;
  });
  return { publish: await Promise.all(imgs.map(read)) };
}, published.images);

check("slide 1 publish render is capped at 1440 on its long edge",
  Math.max(...dims.publish[0]) === 1440, JSON.stringify(dims.publish[0]));
check("a photo already under the ceiling is not upscaled (width survives the 4:5 fit)",
  dims.publish[1][0] === 900, JSON.stringify(dims.publish[1]));
check("the fitted slide publishes at exactly 4:5",
  dims.publish[1][1] === 1125, JSON.stringify(dims.publish[1]));
/* Not asserted here: that slide 2's STORY render used the full tall frame rather
   than the 4:5 crop. The story treatment blurs and letterboxes, so the two sources
   produce near-identical pixels at 1080x1920 and any sampling check would be
   flakier than the one-line source guarantee it verifies (storyB64 is captured
   before the crop and renderStoryFromB64 prefers it). Stated so nobody mistakes
   the omission for coverage. */

const visionDims = await page.evaluate(async (b64) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res([i.width, i.height]);
  i.onerror = () => res(null);
  i.src = "data:image/jpeg;base64," + b64;
}), proxyCalls[0].messages[0].content[0].source.data);
check("the render sent to the model is the smaller 1280 one",
  Math.max(...visionDims) === 1280, JSON.stringify(visionDims));
check("publish bytes are larger than vision bytes (higher quality render)",
  published.images[0].length > proxyCalls[0].messages[0].content[0].source.data.length);

/* --- draft recovery survives a reload ------------------------------------ */

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
const afterReload = await bodyText();
check("a published post clears the draft", !/Recovered your last unfinished caption/.test(afterReload));

check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.join(" | "));

await browser.close();
server.close();

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
