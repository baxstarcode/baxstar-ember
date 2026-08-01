/**
 * UI rework verification — run with: node .devtest/ui-rework-check.mjs
 * Drives the generated index.html at phone (390×844) and desktop (1440×900),
 * asserting the 2026-08-01 layout rework and saving screenshots for review.
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, ".devtest", "ui-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  const type = { ".html": "text/html", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png",
    ".webmanifest": "application/manifest+json", ".js": "text/javascript" }[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForSelector(".core-chamber", { timeout: 15000 });
  await page.waitForTimeout(1200); // reveal animations

  const mobile = viewport.width < 1021;

  // Dock: fixed, 6 buttons, visible, labels centered
  const dock = await page.evaluate(() => {
    const d = document.querySelector(".console-dock");
    if (!d) return null;
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    const btns = [...d.querySelectorAll(".dock-control")];
    const labels = btns.map((b) => {
      const l = b.querySelector(".dock-label");
      const br = b.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      // label horizontal center vs button center, in px
      return Math.abs((lr.left + lr.width / 2) - (br.left + br.width / 2));
    });
    return { position: cs.position, bottomGap: innerHeight - r.bottom, buttons: btns.length,
      maxLabelOffset: Math.max(...labels), hasImg: !!d.querySelector("img") };
  });
  check(`${label}: dock is position:fixed at the bottom`, dock && dock.position === "fixed" && dock.bottomGap < 1, JSON.stringify(dock));
  check(`${label}: dock has 6 buttons, no stretched raster`, dock && dock.buttons === 6 && !dock.hasImg);
  check(`${label}: dock labels centered (worst offset < 2px)`, dock && dock.maxLabelOffset < 2, String(dock?.maxLabelOffset));

  // Dock stays pinned after scroll
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  const pinned = await page.evaluate(() => {
    const r = document.querySelector(".console-dock").getBoundingClientRect();
    return innerHeight - r.bottom < 1 && r.top > 0;
  });
  check(`${label}: dock stays pinned after scrolling to page bottom`, pinned);
  await page.evaluate(() => window.scrollTo(0, 0));

  // No horizontal overflow
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: no horizontal page overflow`, overflowX <= 0, `${overflowX}px`);

  // Skull arch visible
  const skull = await page.evaluate(() => {
    const el = document.querySelector(".skull-arch");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { display: cs.display, w: el.getBoundingClientRect().width };
  });
  check(`${label}: skull arch is rendered`, skull && skull.display !== "none" && skull.w > 200, JSON.stringify(skull));

  if (mobile) {
    // Chamber is the first OPS element
    const order = await page.evaluate(() => {
      const core = document.querySelector(".ops-core").getBoundingClientRect().top;
      const sides = [...document.querySelectorAll(".ops-side")].map((el) => el.getBoundingClientRect().top);
      return sides.every((t) => core < t);
    });
    check(`${label}: reactor chamber renders above the panels`, order);
    const dots = await page.evaluate(() => getComputedStyle(document.querySelector(".conn-dots")).display);
    check(`${label}: static connector dots hidden`, dots === "none", dots);
  }

  // Model/effort pickers on home, inside the viewport width
  const codex = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".core-chamber .codex")];
    return { count: boxes.length, worstRight: Math.max(...boxes.map((b) => b.getBoundingClientRect().right)) };
  });
  check(`${label}: model + effort pickers on home`, codex.count === 2, String(codex.count));
  check(`${label}: pickers never leave the screen to the right`, codex.worstRight <= viewport.width, `${codex.worstRight} vs ${viewport.width}`);

  await page.screenshot({ path: path.join(SHOTS, `ops-${label}.png`), fullPage: mobile });

  // Dock's Caption Studio button lands on the captions tool
  await page.locator('.dock-control:has-text("Caption Studio")').click();
  await page.waitForTimeout(600);
  const onCaptions = await page.evaluate(() => !!document.querySelector(".upzone"));
  check(`${label}: dock button lands directly on Caption Studio`, onCaptions);

  // Tools strip is one row (offsetTop ignores the active tile's -2px lift transform)
  const strip = await page.evaluate(() => {
    const g = document.querySelector(".tool-grid");
    const tiles = [...g.querySelectorAll(".tool-tile")];
    const tops = new Set(tiles.map((t) => t.offsetTop));
    return { rows: tops.size, tiles: tiles.length, hasChat: tiles.some((t) => /Claude Chat/.test(t.textContent)) };
  });
  check(`${label}: tools are one horizontal row`, strip.rows === 1 && strip.tiles === 7, JSON.stringify(strip));
  check(`${label}: chat tile removed from studio`, !strip.hasChat);

  await page.screenshot({ path: path.join(SHOTS, `captions-${label}.png`), fullPage: mobile });

  check(`${label}: no uncaught page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await run("mobile-390", { width: 390, height: 844 });
await run("desktop-1440", { width: 1440, height: 900 });

await browser.close();
server.close();

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed · shots in .devtest/ui-shots/`);
process.exit(failed ? 1 : 0);
