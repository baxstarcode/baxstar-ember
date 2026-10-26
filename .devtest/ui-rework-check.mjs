/**
 * UI rework verification — run with: node .devtest/ui-rework-check.mjs
 * Drives the generated index.html at phone (390×844) and desktop (1440×900),
 * asserting the 2026-08-01 layout rework and saving screenshots for review, then
 * checks the touch-desktop prompt plates and fit at the five desktop sizes.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, ".devtest", "ui-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const bundled = path.join(path.dirname(path.dirname(process.execPath)), "node_modules", "playwright", "index.mjs");
    if (!fs.existsSync(bundled)) throw error;
    return import(pathToFileURL(bundled).href);
  }
}

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

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

// Plates must never overlap the reactor. 44px is the touch floor: phones, and any
// coarse pointer at desktop width. The no-scroll desktop cockpit (2026-10-26) uses
// 32px plates for a mouse, as #46 scoped the chat-controls 44px minimum to touch.
const plateGeometry = (page, mobile) => page.evaluate((mobile) => {
  const r = document.querySelector(".reactor-stage").getBoundingClientRect();
  const [l, rt] = [...document.querySelectorAll(".prompt-plate")].map((p) => p.getBoundingClientRect());
  const coarse = matchMedia("(pointer:coarse)").matches;
  const floor = mobile || coarse ? 44 : 32;
  const clear = !!l && !!rt && ((l.right <= r.left && rt.left >= r.right) || (l.top >= r.bottom && rt.top >= r.bottom && l.right <= rt.left));
  return { ok: clear && [l, rt].every((p) => p.width >= 44 && p.height >= floor), clear, coarse, floor,
    sizes: [l, rt].map((p) => p && [Math.round(p.width), Math.round(p.height)]),
    // Engraved serials are decoration. Assert the actual command label and
    // accessibility separation without folding aria-hidden art into the name.
    labels: [...document.querySelectorAll(".prompt-plate .plate-label")].map((p) => p.innerText.replace(/\s+/g, " ").trim()),
    decorativeSerials: [...document.querySelectorAll(".prompt-plate .plate-index")].every((p) => p.getAttribute("aria-hidden") === "true") };
}, mobile);

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForSelector(".core-chamber", { timeout: 15000 });
  await page.waitForTimeout(1200); // reveal animations

  const mobile = viewport.width < 1021;

  // Dock: fixed, 6 cropped instrument images, visible, labels centered. The images
  // preserve their intrinsic aspect ratio and are translated behind overflow-hidden
  // crop windows; no object-fit stretch declaration is allowed on a matching rule.
  const dock = await page.evaluate(() => {
    const d = document.querySelector(".console-dock");
    if (!d) return null;
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    const btns = [...d.querySelectorAll(".dock-control")];
    const explicitObjectFit = (img) => {
      if (img.style.objectFit) return img.style.objectFit;
      const scan = (rules) => {
        for (const rule of [...(rules || [])]) {
          if (rule.cssRules) {
            const nested = scan(rule.cssRules);
            if (nested) return nested;
          }
          if (!rule.selectorText || !rule.style?.getPropertyValue("object-fit")) continue;
          try {
            if (rule.selectorText.split(",").some((selector) => img.matches(selector.trim()))) {
              return rule.style.getPropertyValue("object-fit").trim();
            }
          } catch { /* Ignore unsupported selectors in unrelated rules. */ }
        }
        return "";
      };
      for (const sheet of [...document.styleSheets]) {
        try {
          const value = scan(sheet.cssRules);
          if (value) return value;
        } catch { /* Cross-origin stylesheets are irrelevant to the dock. */ }
      }
      return "";
    };
    const labels = btns.map((b) => {
      const l = b.querySelector(".dock-label");
      const br = b.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      // label horizontal center vs button center, in px
      return Math.abs((lr.left + lr.width / 2) - (br.left + br.width / 2));
    });
    const art = btns.map((button) => {
      const crop = button.querySelector(".dock-art");
      const img = crop?.querySelector(":scope > img");
      if (!crop || !img) return { valid: false };
      const cropStyle = getComputedStyle(crop);
      const imgStyle = getComputedStyle(img);
      const cropRect = crop.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const naturalRatio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
      const renderedRatio = imgRect.height ? imgRect.width / imgRect.height : 0;
      const fit = explicitObjectFit(img);
      return {
        valid: cropStyle.overflow === "hidden" && imgStyle.position === "absolute" &&
          imgRect.width > cropRect.width * 2 && naturalRatio > 0 &&
          Math.abs(renderedRatio - naturalRatio) < 0.02 && !/^(fill|stretch)$/i.test(fit),
        fit: fit || "none declared",
        naturalRatio,
        renderedRatio,
      };
    });
    return { position: cs.position, bottomGap: innerHeight - r.bottom, buttons: btns.length,
      maxLabelOffset: Math.max(...labels), artCount: art.filter((item) => item.valid).length,
      art };
  });
  check(`${label}: dock is position:fixed at the bottom`, dock && dock.position === "fixed" && dock.bottomGap < 1, JSON.stringify(dock));
  check(`${label}: dock has 6 cropped art images with no object-fit stretching`,
    dock && dock.buttons === 6 && dock.artCount === 6, JSON.stringify(dock?.art));
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

  // PR #46 replaced the skull ornament with the 250px reactor crown.
  const crown = await page.evaluate(() => {
    const el = document.querySelector(".core-chamber .reactor-stage");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { skulls: document.querySelectorAll(".skull-arch").length,
      display: cs.display, visibility: cs.visibility, w: r.width, h: r.height };
  });
  check(`${label}: reactor crown replaces the skull arch`, crown && crown.skulls === 0 &&
    crown.display !== "none" && crown.visibility !== "hidden" &&
    // Sized by the viewport since 2026-10-15 (bigger on tall screens), always round.
    crown.w >= (mobile ? 160 : 240) && crown.w <= 360 && Math.abs(crown.w - crown.h) <= 2, JSON.stringify(crown));
  const plates = await plateGeometry(page, mobile);
  check(`${label}: prompt plates stay clear of the large reactor, beside it or below on phones`,
    plates.ok && plates.decorativeSerials && plates.labels[0] === "WHAT'D I MISS" && plates.labels[1] === "BRIEF MY DAY", JSON.stringify(plates));

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

  // Projects dashboard — dock button lands on it, categories render, bars match pct
  await page.locator('.dock-control:has-text("Projects")').click();
  await page.waitForTimeout(1000); // bar width transition
  const proj = await page.evaluate(() => {
    const cats = [...document.querySelectorAll(".proj-cat")].map((c) => c.textContent.trim());
    const bars = [...document.querySelectorAll(".proj-bar")].map((b) => {
      const fill = b.querySelector(".proj-fill");
      const pct = Number(fill.dataset.pct);
      const w = (fill.getBoundingClientRect().width / b.getBoundingClientRect().width) * 100;
      return Math.abs(w - pct) < 3;
    });
    return { cats, bars: bars.length, allMatch: bars.every(Boolean),
      zapier: /ZAPIER TASKS/.test(document.body.innerText) };
  });
  check(`${label}: dock Projects button lands on the dashboard`,
    proj.cats.includes("Revenue Generating") && proj.cats.includes("Supporting"), JSON.stringify(proj.cats));
  check(`${label}: 9 horizontal bars, each fill width matches its pct`, proj.bars === 9 && proj.allMatch, JSON.stringify(proj));
  check(`${label}: Zapier task usage strip present`, proj.zapier);
  const projOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: projects view has no horizontal overflow`, projOverflow <= 0, `${projOverflow}px`);
  await page.screenshot({ path: path.join(SHOTS, `projects-${label}.png`), fullPage: mobile });

  check(`${label}: no uncaught page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await run("mobile-390", { width: 390, height: 844 });
await run("desktop-1440", { width: 1440, height: 900 });

// Touch at desktop width (tablet landscape): the plates get their 44px floor back,
// and OPS must still fit the viewport without page scrolling.
for (const [width, height] of [[1024, 700], [1100, 640], [1280, 720], [1440, 900], [1920, 1080]]) {
  const label = `touch-desktop-${width}x${height}`;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForSelector(".core-chamber", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const plates = await plateGeometry(page, false);
  check(`${label}: 44px prompt plates stay clear of the reactor`, plates.coarse && plates.floor === 44 && plates.ok, JSON.stringify(plates));
  const fit = await page.evaluate(() => {
    const wrap = document.querySelector(".core-wrap").getBoundingClientRect();
    const reactor = document.querySelector(".reactor-stage").getBoundingClientRect();
    const seg = document.querySelector(".core-wrap > .mt-2").getBoundingClientRect();
    return { scroll: document.documentElement.scrollHeight - innerHeight,
      inWrap: reactor.top >= wrap.top - 0.5 && seg.bottom <= wrap.bottom + 0.5 };
  });
  check(`${label}: OPS fits without page scrolling, skull column inside its frame`, fit.scroll <= 1 && fit.inWrap, JSON.stringify(fit));
  await ctx.close();
}

await browser.close();
server.close();

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed · shots in .devtest/ui-shots/`);
process.exit(failed ? 1 : 0);
