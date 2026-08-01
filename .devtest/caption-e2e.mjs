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

const browser = await chromium.launch();
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

await page.waitForFunction(() => !document.body.innerText.includes("SCANNING"), null, { timeout: 20000 });

check("two files load as a 2-slide carousel", /2\/6 slides/.test(await page.locator("body").innerText()));
check("vision scan was ONE call for the whole set",
  proxyCalls.length === 1 && proxyCalls[0].messages[0].content.filter((c) => c.type === "image").length === 2,
  `calls=${proxyCalls.length}`);

const bodyText = () => page.locator("body").innerText();
check("species came back from the scan", /SMALLMOUTH BASS/i.test(await bodyText()));

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

await page.locator('button:has-text("Publish to Drive Outbox")').click();
await page.waitForFunction(() => /Sent|outbox/i.test(document.body.innerText), null, { timeout: 15000 });

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
check("lake is a plain name, not an ID", published.lake === "Detroit Lake", String(published.lake));
check("imageBase64 still carries slide one for older deploys",
  published.imageBase64 === published.images[0]);

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
check("a photo already under the ceiling is not upscaled",
  dims.publish[1][0] === 900 && dims.publish[1][1] === 1200, JSON.stringify(dims.publish[1]));

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
