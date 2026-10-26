// Generated-build dashboard smoke test.
// Exercises the current same-origin API contract at desktop and phone widths.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, ".devtest", "ui-shots");
fs.mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const bundled = path.join(path.dirname(path.dirname(process.execPath)), "node_modules", "playwright", "index.mjs");
    if (!fs.existsSync(bundled)) throw error;
    return import(pathToFileURL(bundled).href);
  }
}

function startStaticServer() {
  const rootPrefix = `${path.resolve(ROOT)}${path.sep}`;
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://ember.test").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(ROOT, relative);
    if ((!file.startsWith(rootPrefix) && file !== path.resolve(ROOT, "index.html")) ||
        !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".webp": "image/webp",
    }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const { chromium } = await loadPlaywright();
const server = await startStaticServer();
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
async function offlineContext(options) {
  const context = await browser.newContext(options);
  // Exercise the documented system-font fallback without depending on Google
  // Fonts access. Keep all application console/network assertions enabled.
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  return context;
}
const failures = [];
let assertions = 0;

const check = (label, condition, extra = "") => {
  assertions += 1;
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}${extra ? ` :: ${extra}` : ""}`);
  if (!condition) failures.push(label);
};

const ALL_CONNECTED = { quo: "connected", gmail: "connected", calendar: "connected", gdrive: "connected" };

async function routeStatus(page, connectors) {
  await page.route(`${ORIGIN}/api/connectors/status`, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ connectors }),
  }));
}

function verifiedSyncContent(text, servers = ["quo", "gmail", "calendar"]) {
  const content = [];
  for (const [server, tool] of [["quo", "fetch-missed-calls"], ["gmail", "search_threads"], ["calendar", "list_events"]].filter(([s]) => servers.includes(s))) {
    const id = `mcp_${server}`;
    content.push({ type: "mcp_tool_use", id, name: tool, server_name: server, input: {} });
    content.push({ type: "mcp_tool_result", tool_use_id: id, is_error: false, content: [] });
  }
  content.push({ type: "text", text });
  return content;
}

try {
  for (const [name, viewport] of [["DESKTOP", { width: 1440, height: 900 }], ["PHONE", { width: 393, height: 852 }]]) {
    const requests = [];
    let syncEvidence = true;
    const context = await offlineContext({
      viewport,
      deviceScaleFactor: name === "PHONE" ? 3 : 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const noise = /fonts\.googleapis|fonts\.gstatic|ERR_CERT_AUTHORITY_INVALID|favicon/i;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !noise.test(message.text())) errors.push(`console: ${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      if (!noise.test(request.url())) errors.push(`net: ${request.url().slice(0, 100)}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !noise.test(response.url())) errors.push(`http ${response.status()}: ${response.url().slice(0, 100)}`);
    });

    await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });
    await routeStatus(page, ALL_CONNECTED);
    await page.route(`${ORIGIN}/api/messages`, async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "POST required" }) });
        return;
      }
      const body = JSON.parse(request.postData() || "{}");
      requests.push(body);
      const isSync = /ONLY valid JSON/.test(request.postData() || "");
      const text = isSync
        ? JSON.stringify({
            voicemails: [{ from: "(218) 555-0000", line: "Fishing", time: "1:00 PM", note: "live sync landed", vm: "" }],
            emails: [{ from: "LiveSyncProof", time: "1:01 PM", subject: "real data", id: "18f2a9c7b3d4e5f6" }, { from: "HostileId", time: "1:02 PM", subject: "no link", id: "../evil#\"><img" }],
            events: [{ time: "3:00 PM", title: "LiveSyncEvent", detail: "", link: "https://www.google.com/calendar/event?eid=abc123" }, { time: "8:00 AM", title: "LongDetailEvent", detail: "Verify https://baxstaroutdoors.com loads over https, then check the Wix plan renewal and the Google Business profile before noon.", link: "javascript:alert(1)" }, { time: "9:00 AM", title: "OffHostEvent", detail: "", link: "https://evil.example/calendar/event" }],
          })
        : "Two bookings today, Brady.";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ content: isSync && syncEvidence ? verifiedSyncContent(text) : [{ type: "text", text }] }),
      });
    });

    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
    await page.waitForSelector(".core-chamber", { timeout: 15000 });
    await page.waitForFunction(() => /live sync landed/i.test(document.body.innerText), null, { timeout: 10000 });

    console.log(`\n===== ${name} =====`);
    check(`${name} no page/console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));

    const body = (await page.locator("body").innerText()).toUpperCase();
    const banned = ["TAP TO TALK", "VOICE MODE", "VOICE ON", "HER VOICE", "HEAR IT", "TAP TO HEAR", "EMBER, AWAKE", "MIC ARMED", "MIC RELEASED", "LISTENING", "SPEAKING"];
    const found = banned.filter((text) => body.includes(text));
    check(`${name} no legacy wake/armed voice controls`, found.length === 0, found.join(","));
    check(`${name} voice requires the explicit mouth entry`, await page.getByRole('button', { name: 'Talk to Ember', exact: true }).count() === 1 && await page.locator('.voice-console').count() === 0);

    // The brass skull arch was removed 2026-09-22; the reactor is the crown now.
    check(`${name} no skull ornament`, await page.locator(".skull-arch").count() === 0);
    check(`${name} core chamber present`, await page.locator(".core-host").count() > 0);
    const reactor = await page.locator(".reactor-stage").first().boundingBox();
    check(`${name} reactor stays prominent and fits the screen`, !!reactor && reactor.height >= (name === "PHONE" ? 250 : 240) && reactor.height <= 361,
      reactor ? `${Math.round(reactor.height)}px` : "missing");
    check(`${name} core instrument present`, await page.locator(".reactor-stage, .scope-bezel").count() > 0);
    check(`${name} panels filled from live sync`, body.includes("LIVE SYNC LANDED") && body.includes("LIVESYNCPROOF"));
    // A sentence-length calendar detail must wrap under the title, never squeeze
    // the title to one word per line or push the panel sideways (Brady, 2026-10-23).
    const longRow = await page.locator(".ember-row").filter({ hasText: "LongDetailEvent" }).first();
    const rowGeom = await longRow.evaluate((row) => {
      const title = row.querySelector(".row-title"), note = row.querySelector(".row-note");
      const panel = row.closest(".panel");
      return { rowW: row.getBoundingClientRect().width, titleW: title.getBoundingClientRect().width, titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
        noteText: note?.textContent || "", noteWraps: note ? note.getBoundingClientRect().height > parseFloat(getComputedStyle(note).lineHeight) * 1.5 : false,
        // Every .panel carries a structural 8px of scrollWidth from its border-image; measure the row itself.
        overflow: row.scrollWidth - row.clientWidth, panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0 };
    });
    check(`${name} long calendar detail wraps under the title instead of squeezing it`,
      rowGeom.titleW >= rowGeom.rowW * 0.5 && rowGeom.titleLines <= 2 && rowGeom.noteText.startsWith("Verify https") && rowGeom.overflow <= 1,
      JSON.stringify(rowGeom));
    const syncRequest = requests.find((request) => /ONLY valid JSON/.test(JSON.stringify(request.messages)));
    check(`${name} sync requests connector names only`,
      JSON.stringify(syncRequest?.mcp_servers) === JSON.stringify([{ name: "quo" }, { name: "gmail" }, { name: "calendar" }]));
    syncEvidence = false;
    await page.locator(".sync-control").click();
    await page.waitForFunction(() => /did not verify successful results/i.test(document.body.innerText), null, { timeout: 10000 });
    const afterUnverified = (await page.locator("body").innerText()).toUpperCase();
    check(`${name} valid-looking JSON without tool results cannot replace live panels`,
      afterUnverified.includes("LIVE SYNC LANDED") && afterUnverified.includes("LIVESYNCPROOF"));
    check(`${name} revenue panel present`, body.includes("TODAY'S REVENUE"));

    const openGmail = page.locator(".ember-row").filter({ hasText: "LiveSyncProof" }).getByRole("link", { name: /Open in Gmail/ });
    check(`${name} inbox row opens the message in Gmail from the returned id`,
      (await openGmail.count()) === 1 && (await openGmail.getAttribute("href")) === "https://mail.google.com/mail/u/0/#all/18f2a9c7b3d4e5f6" &&
      (await openGmail.getAttribute("target")) === "_blank" && /noopener/.test(await openGmail.getAttribute("rel") || ""));
    check(`${name} a hostile message id renders no link`, (await page.locator(".ember-row").filter({ hasText: "HostileId" }).locator("a").count()) === 0);
    const openCal = page.locator(".ember-row").filter({ hasText: "LiveSyncEvent" }).getByRole("link", { name: /Open in Calendar/ });
    check(`${name} schedule row opens the event in Google Calendar`,
      (await openCal.count()) === 1 && (await openCal.getAttribute("href")) === "https://www.google.com/calendar/event?eid=abc123");
    check(`${name} javascript: and off-host calendar links render no link`,
      (await page.locator(".ember-row").filter({ hasText: "LongDetailEvent" }).locator("a").count()) === 0 &&
      (await page.locator(".ember-row").filter({ hasText: "OffHostEvent" }).locator("a").count()) === 0);
    check(`${name} sync asks for the Gmail id and Calendar htmlLink`, /the Gmail message id exactly as the tool returned it/.test(JSON.stringify(syncRequest?.messages)) && /the event htmlLink exactly as the tool returned it/.test(JSON.stringify(syncRequest?.messages)));

    const links = await page.locator(".tool-link").count();
    check(`${name} tools rail rendered`, body.includes("YOUR TOOLS") && links === 12, `${links} links`);
    const firstLink = page.locator(".tool-link").first();
    check(`${name} tool links open in a new tab`,
      (await firstLink.getAttribute("target")) === "_blank" && /noopener/.test(await firstLink.getAttribute("rel") || ""));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name} no sideways scroll`, overflow <= 1, `overflow ${overflow}px`);

    const composer = page.getByRole("textbox", { name: "Ask Ember" });
    await composer.fill("how does today look");
    await composer.press("Enter");
    await page.getByText("Two bookings today, Brady.", { exact: true }).waitFor({ timeout: 10000 });
    check(`${name} typed ask answers`, await page.getByText("Two bookings today, Brady.", { exact: true }).count() > 0);

    const chatRequest = requests.find((request) => !/ONLY valid JSON/.test(JSON.stringify(request.messages)));
    check(`${name} chat uses same-origin messages POST`, !!chatRequest);
    check(`${name} no voice-mode text in the prompt`, !!chatRequest && !/spoken aloud|Spoken output/i.test(JSON.stringify(chatRequest.messages)));

    // The push-plates and the Inbox link run the existing prompts — no copies.
    for (const [locate, label, want] of [
      [() => page.locator(".prompt-plate.left"), "WHAT'D I MISS plate", /What did I miss\? Check missed calls/],
      [() => page.locator(".prompt-plate.right"), "BRIEF MY DAY plate", /Brief me on tomorrow/],
      [() => page.getByRole("button", { name: "Triage Inbox ›" }), "Triage Inbox link (with the live inbox it shows)", /Triage my unread Gmail[\s\S]*LiveSyncProof/],
    ]) {
      const before = requests.length;
      await locate().click();
      await page.waitForFunction((n) => !document.querySelector('[data-status="streaming"]') && true, before, { timeout: 10000 });
      await page.waitForTimeout(300);
      const sent = requests.slice(before).find((r) => !/ONLY valid JSON/.test(JSON.stringify(r.messages)));
      check(`${name} ${label} runs its existing prompt`, !!sent && want.test(JSON.stringify(sent.messages)));
    }
    const dock = page.locator(".console-dock");
    check(`${name} dock reads OPS · Caption Studio · Knowledge Graph · Google Drive · FareHarbor · Projects`,
      (await dock.locator(".dock-label").allInnerTexts()).map((t) => t.replace(/\u00AD/g, "").trim().toUpperCase()).join("|") ===
      "OPS|CAPTION STUDIO|KNOWLEDGE GRAPH|GOOGLE DRIVE|FAREHARBOR|PROJECTS");
    check(`${name} Google Drive tile opens Drive in a new tab`,
      (await dock.getByRole("link", { name: /Google Drive/ }).getAttribute("href")) === "https://drive.google.com/" &&
      (await dock.getByRole("link", { name: /Google Drive/ }).getAttribute("target")) === "_blank");
    check(`${name} FareHarbor tile opens the Baxstar dashboard`,
      (await dock.getByRole("link", { name: /FareHarbor/ }).getAttribute("href")) === "https://fareharbor.com/baxstarfishing/dashboard/");
    check(`${name} Caption Studio gear still turns`, await page.evaluate(() =>
      document.getAnimations().some((a) => a.animationName === "dockGearSpin" && a.playState === "running")));
    check(`${name} FareHarbor wheel and furnace animate`, await page.evaluate(() => {
      const names = document.getAnimations().map((a) => a.animationName);
      return names.includes("dockWheelCycle") && names.includes("dockFurnaceSwell") && names.includes("dockFurnaceFlicker");
    }));

    await page.screenshot({
      path: path.join(SHOTS, `dashboard-${name.toLowerCase()}.png`),
      fullPage: true,
    });
    await context.close();
  }

  {
    const context = await offlineContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });
    await routeStatus(page, ALL_CONNECTED);
    await page.route(/baxstar-knowledge-network\.pages\.dev/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>foundry</p>" }));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
    console.log("\n===== GRAPH OVERLAY =====");
    await page.locator(".console-dock").getByRole("button", { name: "Knowledge Graph", exact: true }).click();
    await page.getByRole("dialog", { name: "Knowledge Graph" }).waitFor();
    check("overlay makes the dashboard inert", await page.evaluate(() => document.querySelector(".ember-shell").hasAttribute("inert")));
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    check("Tab stays inside the dialog", await page.evaluate(() => !!document.activeElement?.closest(".kg-overlay") || document.activeElement?.tagName === "IFRAME" || document.activeElement === document.body));
    await page.mouse.click(8, 8);
    check("clicking the backdrop closes it", await page.getByRole("dialog", { name: "Knowledge Graph" }).count() === 0);
    check("closing restores the dashboard", await page.evaluate(() => !document.querySelector(".ember-shell").hasAttribute("inert")));
    await context.close();
  }

  {
    const context = await offlineContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });
    await routeStatus(page, ALL_CONNECTED);
    await page.goto(`${ORIGIN}/index.html?ask=${encodeURIComponent("Signal: confirm the Fair Hills blurb")}`, { waitUntil: "load" });
    console.log("\n===== SIGNAL LOG OVERLAY =====");
    const composer = page.getByRole("textbox", { name: "Ask Ember" });
    check("?ask= prefills the composer unsent and leaves the address clean",
      (await composer.inputValue()) === "Signal: confirm the Fair Hills blurb" && !page.url().includes("ask="));
    await page.locator(".tools-rail").getByRole("button", { name: /Signal Log/ }).click();
    const dialog = page.getByRole("dialog", { name: "Signal Log" });
    await dialog.waitFor();
    const frame = page.frameLocator(".sl-frame");
    await frame.locator(".signal-card").first().waitFor({ timeout: 10000 });
    check("overlay frames the same-origin Signal Log page",
      (await page.locator(".sl-frame").getAttribute("src")) === "signal-log/index.html" && (await frame.locator(".signal-card").count()) > 0);
    check("framed page hides its duplicate top bar", await frame.locator(".topbar").evaluate((n) => getComputedStyle(n).display === "none"));
    check("overlay makes the dashboard inert", await page.evaluate(() => document.querySelector(".ember-shell").hasAttribute("inert")));
    check("full-page link opens in a new tab",
      (await dialog.getByRole("link", { name: /Open full page/ }).getAttribute("target")) === "_blank" &&
      (await dialog.getByRole("link", { name: /Open full page/ }).getAttribute("href")) === "signal-log/");
    const first = frame.locator(".signal-card").first();
    const title = await first.locator("h3").textContent();
    await first.getByRole("button", { name: /Ask Ember about/ }).click();
    await dialog.waitFor({ state: "detached" });
    const handed = await composer.inputValue();
    check("Ask Ember closes the overlay and hands the card to the composer, unsent",
      handed.startsWith("About this signal from my Signal Log") && handed.includes(title) &&
      (await page.evaluate(() => !document.querySelector(".ember-shell").hasAttribute("inert"))) &&
      (await page.locator('[data-status="streaming"]').count()) === 0);
    await page.locator(".tools-rail").getByRole("button", { name: /Signal Log/ }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close Signal Log" }).click();
    check("the close button closes it", (await dialog.count()) === 0);
    await context.close();
  }

  // Small windows may scroll to preserve the large skull. Controls must remain
  // inside the panel and reachable above the dock; plates must never overlap it.
  for (const [w, h] of [[1024, 700], [1100, 640], [1280, 720], [1440, 900]]) {
    const name = `${w}x${h}`;
    const context = await offlineContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });
    await routeStatus(page, ALL_CONNECTED);
    await page.route(`${ORIGIN}/api/messages`, (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ content: [{ type: "text", text: "noted" }] }) }));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
    await page.waitForSelector(".core-chamber");
    const geo = () => page.evaluate(() => {
      const r = (q) => document.querySelector(q)?.getBoundingClientRect();
      const core = r(".core-chamber"), controls = r(".chat-controls"), tools = r(".tools-rail"), dock = r(".console-dock");
      const L = r(".prompt-plate.left"), R = r(".prompt-plate.right"), face = r(".reactor-stage") || r(".scope-bezel");
      const clear = p => p.right <= face.left + 1 || p.left >= face.right - 1 || p.top >= face.bottom - 1 || p.bottom <= face.top + 1;
      return { faceHeight: face.height, controlsIn: controls.bottom <= core.bottom - 8,
        controlsReachable: controls.top >= 0 && controls.bottom <= dock.top,
        toolsReachable: tools.top >= 0 && tools.bottom <= dock.top,
        platesWhole: L.left >= core.left + 10 && R.right <= core.right - 10,
        platesClear: clear(L) && clear(R) };
    });
    console.log(`\n===== ${name} =====`);
    for (const mode of ["ENIGMA", "SCOPE"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.waitForTimeout(150);
      const g = await geo();
      await page.locator('.chat-controls').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const controls = await geo();
      await page.locator('.tools-rail').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const tools = await geo();
      check(`${name} ${mode}: controls and tools reachable above the dock`, controls.controlsIn && controls.controlsReachable && tools.toolsReachable, JSON.stringify({ controls, tools }));
      check(`${name} ${mode}: push-plates whole and clear of the instrument`, g.platesWhole && g.platesClear, JSON.stringify(g));
    }
    await page.getByRole("button", { name: "ENIGMA", exact: true }).click();
    const beforeTyping = await geo();
    await page.getByRole("textbox", { name: "Ask Ember" }).fill(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
    await page.locator('.chat-controls').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const typed = await geo();
    check(`${name} typing 30 lines keeps the skull stable and Model/Effort reachable`, typed.controlsIn && typed.controlsReachable && Math.abs(typed.faceHeight - beforeTyping.faceHeight) < 1, JSON.stringify(typed));
    await context.close();
  }

  // One dead connector must not blank the others (live 2026-10-15: Quo offline,
  // Gmail/Calendar/Drive connected, every panel stuck on the demo preview).
  {
    const name = "QUO OFFLINE";
    const context = await offlineContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });
    await routeStatus(page, { ...ALL_CONNECTED, quo: "offline" });
    await page.route(`${ORIGIN}/api/messages`, async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      requests.push(body);
      const isSync = /ONLY valid JSON/.test(route.request().postData() || "");
      if (isSync) {
        const text = JSON.stringify({
          emails: [{ from: "PartialInboxProof", time: "1:01 PM", subject: "gmail still live" }],
          events: [{ time: "3:00 PM", title: "PartialEventProof", detail: "" }],
        });
        await route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ content: verifiedSyncContent(text, ["gmail", "calendar"]) }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json",
          headers: { "x-ember-connectors": "degraded" },
          body: JSON.stringify({ content: [{ type: "text", text: "Inbox triaged." }] }) });
      }
    });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(() => /PartialInboxProof/.test(document.body.innerText), null, { timeout: 10000 });
    console.log(`\n===== ${name} =====`);
    const syncRequest = requests.find((request) => /ONLY valid JSON/.test(JSON.stringify(request.messages)));
    check(`${name} sync asks only for connectors that can authorize`,
      JSON.stringify(syncRequest?.mcp_servers) === JSON.stringify([{ name: "gmail" }, { name: "calendar" }]),
      JSON.stringify(syncRequest?.mcp_servers));
    check(`${name} sync prompt never asks for Quo`, !/Quo inboxes/.test(JSON.stringify(syncRequest?.messages)));
    const body = await page.locator("body").innerText();
    check(`${name} Gmail and Calendar panels filled live`, /PartialInboxProof/.test(body) && /PartialEventProof/.test(body));
    check(`${name} calls panel keeps the demo preview`, /\(701\) 555-0142/.test(body));
    check(`${name} no red sync error`, !/did not verify|no feeds were replaced/i.test(body));
    const note = await page.locator(".ops-data-note").innerText();
    check(`${name} truth line names Quo offline`, /Calls and voicemail: demo preview \(Quo offline\)/.test(note), note);
    check(`${name} header Quo light offline`, (await page.locator('[data-connector="quo"]').getAttribute("data-state")) === "offline");
    check(`${name} header Gmail light live`, (await page.locator('[data-connector="gmail"]').getAttribute("data-state")) === "live");
    check(`${name} header reads PARTIAL`, /PARTIAL ·/.test(await page.locator(".hdr-clock").innerText()));
    const composer = page.getByRole("textbox", { name: "Ask Ember" });
    await composer.fill("triage my inbox");
    await composer.press("Enter");
    await page.getByText("Inbox triaged.", { exact: true }).waitFor({ timeout: 10000 });
    const chatNote = await page.locator(".chat-connectors").innerText();
    check(`${name} chat warning names Quo, not a blanket claim`,
      /Quo is offline — calls and voicemail not checked/.test(chatNote) && !/Live business data was not checked/.test(chatNote), chatNote);
    check(`${name} no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // Truth must follow the feeds that actually landed, even on a first partial
  // response and on later failed refreshes. No external request leaves the test.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await offlineContext({ viewport: { width, height }, deviceScaleFactor: 3, serviceWorkers: "block" });
    const page = await context.newPage();
    let outcome = "failed";
    let allOffline = false;
    let issues = {};
    await page.route(`${ORIGIN}/api/connectors/status`, (route) => route.fulfill({ json: {
      connectors: Object.fromEntries(Object.keys(ALL_CONNECTED).map((key) => [key, allOffline ? "offline" : "connected"])),
      issues,
    } }));
    await page.route(`${ORIGIN}/api/messages`, (route) => {
      if (outcome === "failed") return route.fulfill({ status: 503, json: { error: "Fixture upstream unavailable" } });
      const data = { emails: [{ from: "PartialTruthInbox", time: "Now", subject: "Verified email" }], voicemails: [], events: [] };
      return route.fulfill({ json: { content: verifiedSyncContent(JSON.stringify(data), outcome === "partial" ? ["gmail"] : ["quo", "gmail", "calendar"]) } });
    });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
    const sync = async () => {
      await page.locator(".sync-control").click();
      await page.waitForFunction(() => !document.querySelector(".sync-control").disabled);
    };
    const name = `${width} PARTIAL TRUTH`;
    await sync();
    check(`${name} initial total failure stays demo`, /no live data was loaded/.test(await page.locator(".ops-error").innerText()));
    outcome = "partial";
    await sync();
    check(`${name} verified email renders`, await page.getByText("PartialTruthInbox", { exact: true }).count() === 1);
    const partialError = await page.locator(".ops-error").innerText();
    check(`${name} first partial error acknowledges the update`, /Updated email\./.test(partialError) && !/no live data was loaded/.test(partialError), partialError);
    check(`${name} partial success is PARTIAL in the header`, /PARTIAL ·/.test(await page.locator(".hdr-clock").innerText()));
    outcome = "failed";
    await sync();
    check(`${name} later failure preserves email and names it as retained`,
      await page.getByText("PartialTruthInbox", { exact: true }).count() === 1 && /Keeping the last synced email\./.test(await page.locator(".ops-error").innerText()));
    check(`${name} failed refresh labels previously live email stale`, /Email: last sync kept/.test(await page.locator(".ops-data-note").innerText()));
    check(`${name} failed refresh removes the green live lamp`, await page.locator('[data-connector="gmail"]').getAttribute("data-state") === "stale" && /STALE ·/.test(await page.locator(".hdr-clock").innerText()));
    outcome = "complete";
    await sync();
    check(`${name} full recovery clears the sync error`, await page.locator(".ops-error").count() === 0);
    allOffline = true;
    await sync();
    check(`${name} all-offline keeps prior live data without claiming demo`, !/no live data was loaded|Demo preview remains/.test(await page.locator(".ops-error").innerText()));
    check(`${name} offline connectors cannot leave the header LIVE`, /STALE ·/.test(await page.locator(".hdr-clock").innerText()));
    issues = { quo: "reconnect_required", gmail: "setup_required", calendar: "temporarily_unavailable" };
    await sync();
    const recoveryNote = await page.locator(".ops-data-note").innerText();
    check(`${name} distinguishes sign-in, setup, and retry guidance`,
      /Quo needs a new sign-in/.test(recoveryNote) && /Gmail setup incomplete/.test(recoveryNote) && /Calendar temporarily unavailable — try Sync again/.test(recoveryNote));
    check(`${name} recovery guidance preserves the verified email`, await page.getByText("PartialTruthInbox", { exact: true }).count() === 1);
    await page.screenshot({ path: path.join(ROOT, ".devtest/ui-shots", `recovery-${width}.png`), fullPage: true });
    issues = { quo: "fixture-private-provider-detail", gmail: "__proto__" };
    await sync();
    check(`${name} ignores unrecognized reason text`, !/fixture-private|__proto__/.test(await page.locator(".ops-data-note").innerText()));
    allOffline = false;
    issues = { quo: "reconnect_required" };
    await sync();
    check(`${name} full recovery clears outdated recovery guidance`, await page.locator(".ops-error").count() === 0 && !/needs a new sign-in/.test(await page.locator("body").innerText()));
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n${assertions - failures.length}/${assertions} passed`);
if (failures.length) console.log(`DASHBOARD FAIL: ${failures.join(" | ")}`);
else console.log("DASHBOARD PASS");
process.exit(failures.length ? 1 : 0);
