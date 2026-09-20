// Streaming, effort, plain-JSON fallback, and auto-sync regression harness.
// Runs the generated app against exact same-origin API routes on an ephemeral server.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function verifiedSyncContent(text) {
  const content = [];
  for (const [server, tool] of [["quo", "fetch-missed-calls"], ["gmail", "search_threads"], ["calendar", "list_events"]]) {
    const id = `mcp_${server}`;
    content.push({ type: "mcp_tool_use", id, name: tool, server_name: server, input: {} });
    content.push({ type: "mcp_tool_result", tool_use_id: id, is_error: false, content: [] });
  }
  content.push({ type: "text", text });
  return content;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const bundled = path.join(path.dirname(path.dirname(process.execPath)), "node_modules", "playwright", "index.mjs");
    if (!fs.existsSync(bundled)) throw error;
    return import(pathToFileURL(bundled).href);
  }
}

function startStaticServer(requests) {
  const rootPrefix = `${path.resolve(ROOT)}${path.sep}`;
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://ember.test").pathname);
    if (pathname === "/api/messages") {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST required" }));
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const isSync = /ONLY valid JSON/.test(raw);
      requests.push({
        method: req.method,
        pathname,
        model: body.model,
        stream: body.stream === true,
        effort: body.output_config?.effort,
        sync: isSync,
      });
      if (isSync) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        const text = JSON.stringify({
          voicemails: [{ from: "(218) 555-TEST", line: "Fishing", time: "1:00 PM", note: "live sync landed", vm: "" }],
          emails: [{ from: "LiveSyncProof", time: "1:01 PM", subject: "real data" }],
          events: [{ time: "3:00 PM", title: "LiveSyncEvent", detail: "" }],
        });
        res.end(JSON.stringify({ content: verifiedSyncContent(text) }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      const frames = [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        ...["Two ", "bookings ", "today, ", "Brady."].map((text) =>
          `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`),
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];
      for (const frame of frames) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        res.write(frame);
      }
      res.end();
      return;
    }
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
const requests = [];
const server = await startStaticServer(requests);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
const pageErrors = [];
const checks = [];
const check = (name, condition, detail = "") => checks.push([name, !!condition, detail]);

page.on("pageerror", (error) => pageErrors.push(error.message));
await page.addInitScript(() => { window.__EMBER_AUTOSYNC_TEST = true; });

try {
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  await page.waitForSelector('.chat-controls button[aria-pressed="true"]', { timeout: 15000 });

  await page.locator(".chat-controls button", { hasText: /^Low$/ }).click();
  const composer = page.getByRole("textbox", { name: "Ask Ember" });
  await composer.fill("how does today look");
  await composer.press("Enter");

  const partial = await page.waitForFunction(() => {
    const bubble = document.querySelector('[data-role="assistant"]');
    const text = bubble?.textContent || "";
    return text.includes("Two ") && !text.includes("Two bookings today, Brady.");
  }, null, { timeout: 5000 }).then(() => true, () => false);
  await page.getByText("Two bookings today, Brady.", { exact: true }).waitFor({ timeout: 10000 });

  await page.waitForFunction(() => /live sync landed/i.test(document.body.innerText), null, { timeout: 10000 });
  const syncRequest = requests.find((request) => request.sync);
  const chatRequest = requests.find((request) => !request.sync);
  const liveVoicemail = await page.getByText(/live sync landed/i).count();
  const liveMail = await page.getByText(/LiveSyncProof/).count();

  check("chat request uses exact same-origin POST route",
    chatRequest?.method === "POST" && chatRequest?.pathname === "/api/messages");
  check("chat request carries stream:true", chatRequest?.stream === true);
  check("chat request carries effort low", chatRequest?.effort === "low");
  check("partial text is visible mid-stream", partial);
  check("full text lands", await page.getByText("Two bookings today, Brady.", { exact: true }).count() > 0);
  check("auto-sync fires without a button press", !!syncRequest);
  check("auto-sync uses the fast model", /haiku/.test(syncRequest?.model || ""));
  check("plain-JSON sync replaces demo panels", liveVoicemail > 0 && liveMail > 0);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

let failed = 0;
for (const [name, passed, detail] of checks) {
  if (!passed) failed += 1;
  console.log(`${passed ? "PASS" : "FAIL"} — ${name}${!passed && detail ? ` :: ${detail}` : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
console.log(failed ? "STREAMING-EFFORT FAIL" : "STREAMING-EFFORT PASS");
process.exit(failed ? 1 : 0);
