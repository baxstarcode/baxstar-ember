#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROXY = "https://ember-claude-proxy.brady-9d1.workers.dev";

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

function quietWav() {
  const samples = 8000; // one second gives the UI enough time to observe playback
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + samples * 2, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24); out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(samples * 2, 40);
  return out;
}

const server = http.createServer((req, res) => {
  const raw = new URL(req.url || "/", "http://127.0.0.1").pathname;
  const requested = raw === "/" ? "/index.html" : raw;
  const full = path.resolve(ROOT, "." + requested);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const appUrl = `http://127.0.0.1:${address.port}/`;
let browser;

async function waitUntil(check, message, timeout = 5000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function mockBrain(page, counts) {
  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/tts") {
      counts.tts++;
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: quietWav(),
      });
      return;
    }
    counts.brain++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ content: [{ type: "text", text: "Voice should speak automatically." }], stop_reason: "end_turn" }),
    });
  });
}

async function pageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

try {
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

  // Desktop: the natural picker is present, an obsolete provider choice recovers
  // to Automatic, and a normal typed RUN speaks without needing the test button.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = await pageErrors(page);
    const counts = { brain: 0, tts: 0 };
    await mockBrain(page, counts);
    await page.addInitScript(() => {
      // Model iOS's rule: an element may play after a network wait only if that
      // same element was first played inside a gesture. This catches the exact
      // "HEAR IT works, typed answers stay silent" regression without needing
      // physical speakers in CI.
      window.__emberTestGesture = false;
      window.__emberTestPlays = 0;
      window.__emberTestBlocked = 0;
      addEventListener("pointerdown", () => {
        window.__emberTestGesture = true;
        setTimeout(() => { window.__emberTestGesture = false; }, 0);
      }, true);
      HTMLMediaElement.prototype.play = function () {
        if (window.__emberTestGesture) this.__emberTestBlessed = true;
        if (!this.__emberTestBlessed) {
          window.__emberTestBlocked++;
          return Promise.reject(new DOMException("gesture required", "NotAllowedError"));
        }
        window.__emberTestPlays++;
        queueMicrotask(() => this.dispatchEvent(new Event("playing")));
        setTimeout(() => this.dispatchEvent(new Event("ended")), this.src.startsWith("data:") ? 1 : 25);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {};
      localStorage.setItem("ember-prefs", JSON.stringify({ v: 4, voiceOn: true, voiceChoice: "ember:LegacyNeural" }));
    });
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });

    const picker = page.getByLabel("Choose Ember's voice");
    await assert.doesNotReject(() => picker.waitFor({ state: "visible" }));
    assert.equal(await picker.inputValue(), "", "obsolete natural voice should recover to Automatic");
    assert.equal(await picker.locator("option").count(), 6, "Automatic plus five natural voices should be listed");

    const command = page.locator("input.cmd-input").first();
    await command.fill("Tell me the voice is working");
    await page.getByRole("button", { name: "RUN", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Voice should speak automatically."));
    await waitUntil(() => counts.tts === 1, "typed RUN never requested automatic speech");
    assert.equal(counts.brain, 1, "typed RUN should make one brain request");
    assert.equal(counts.tts, 1, "typed RUN should automatically synthesize the reply");
    const media = await page.evaluate(() => ({ plays: window.__emberTestPlays, blocked: window.__emberTestBlocked }));
    assert.ok(media.plays >= 2, "typed RUN should reuse the gesture-blessed neural audio element");
    assert.equal(media.blocked, 0, "automatic neural playback must not hit the iOS gesture block");
    assert.deepEqual(errors, [], `desktop page errors: ${errors.join(" | ")}`);
    await context.close();
  }

  // Mobile: picker remains inside the viewport and HEAR IT turns a saved mute
  // into persistent voice mode while exercising the same neural route.
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    const errors = await pageErrors(page);
    const counts = { brain: 0, tts: 0 };
    await mockBrain(page, counts);
    await page.addInitScript(() => {
      window.__emberTestGesture = false;
      window.__emberTestPlays = 0;
      window.__emberTestBlocked = 0;
      addEventListener("pointerdown", () => {
        window.__emberTestGesture = true;
        setTimeout(() => { window.__emberTestGesture = false; }, 0);
      }, true);
      HTMLMediaElement.prototype.play = function () {
        if (window.__emberTestGesture) this.__emberTestBlessed = true;
        if (!this.__emberTestBlessed) {
          window.__emberTestBlocked++;
          return Promise.reject(new DOMException("gesture required", "NotAllowedError"));
        }
        window.__emberTestPlays++;
        queueMicrotask(() => this.dispatchEvent(new Event("playing")));
        setTimeout(() => this.dispatchEvent(new Event("ended")), this.src.startsWith("data:") ? 1 : 25);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {};
      localStorage.setItem("ember-prefs", JSON.stringify({ v: 4, voiceOn: false, voiceChoice: "" }));
    });
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });

    const picker = page.getByLabel("Choose Ember's voice");
    await picker.waitFor({ state: "visible" });
    const box = await picker.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "mobile voice picker should fit the viewport");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile page must not overflow horizontally");

    const voiceToggle = page.getByRole("button", { name: "TAP FOR VOICE MODE", exact: true }).first();
    assert.equal(await voiceToggle.getAttribute("aria-pressed"), "false", "saved mute should load as off");
    await page.getByRole("button", { name: "HEAR IT", exact: true }).click();
    await waitUntil(() => counts.tts === 1, "HEAR IT never requested the natural voice");
    assert.equal(counts.tts, 1, "HEAR IT should exercise the natural neural route");
    assert.equal(await page.getByRole("button", { name: "VOICE ON", exact: true }).first().getAttribute("aria-pressed"), "true", "HEAR IT should keep voice mode on");
    const media = await page.evaluate(() => ({ plays: window.__emberTestPlays, blocked: window.__emberTestBlocked }));
    assert.ok(media.plays >= 2, "HEAR IT should reuse the gesture-blessed neural audio element");
    assert.equal(media.blocked, 0, "mobile neural playback must not hit the gesture block");
    assert.deepEqual(errors, [], `mobile page errors: ${errors.join(" | ")}`);
    await context.close();
  }

  console.log("voice finish-line: 2/2 desktop + mobile scenarios passed");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
