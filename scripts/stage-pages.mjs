#!/usr/bin/env node
/**
 * Assemble the exact static payload uploaded to Cloudflare Pages.
 *
 * Run `npm run build:pages`; build.mjs owns index.html, then this script copies
 * only public runtime files into the gitignored dist/ directory. Keeping source,
 * tests, repository metadata, and local settings out of the upload makes the
 * production boundary reviewable.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const DIST = path.join(ROOT, "dist");

const files = [
  "index.html",
  "signal-log/index.html",
  "signal-log/style.css",
  "signal-log/app.mjs",
  "signal-log/core.mjs",
  "signal-log/storage.mjs",
  "signal-log/adapters.mjs",
  "signal-log/ember-feed.mjs",
  "signal-log/demo.json",
  "signal-log/example.json",
  "assets/ember/design-tokens.css",
  "manifest.webmanifest",
  "sw.js",
  "_routes.json",
  "work/desktop-voice-probe/index.html",
  "work/desktop-voice-probe/probe.js",
  "work/desktop-voice-probe/style.css",
  "assets/ember/icon.svg",
  "assets/ember/raster/command-console@2x.webp",
  "assets/ember/raster/glass-tank@2x.png",
  "assets/ember/raster/reactor-bezel@2x.webp",
  "assets/ember/raster/skull-arch@2x.png",
  "assets/ember/svg/controls/action-lever-active.svg",
  "assets/ember/svg/controls/action-lever-idle.svg",
  "assets/ember/svg/controls/action-lever-ready.svg",
  "assets/ember/svg/controls/codex-lock-shell.svg",
  "assets/ember/svg/controls/gauge-face.svg",
  "assets/ember/svg/controls/gauge-needle.svg",
  "assets/ember/svg/controls/mic-orb-shell.svg",
  "assets/ember/svg/frames/panel-frame.svg",
  "assets/ember/svg/frames/quick-action-frame.svg",
  "assets/ember/svg/frames/tool-module-frame.svg",
  "assets/ember/svg/ornaments/corner-gear.svg",
  "assets/ember/svg/ornaments/pipe-junction.svg",
  "assets/ember/textures/iron-tile.svg",
];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const name of files) {
  const source = path.join(ROOT, name);
  if (!fs.existsSync(source)) throw new Error(`Missing deploy file: ${name}`);
  const target = path.join(DIST, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const count = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .reduce((sum, entry) => sum + (entry.isDirectory() ? count(path.join(directory, entry.name)) : 1), 0);

console.log(`stage-pages: wrote ${count(DIST)} public files to dist/`);
