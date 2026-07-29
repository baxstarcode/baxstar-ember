#!/usr/bin/env node
/**
 * EMBER — deploy build
 *
 * Generates index.html from src/baxstar-ember.jsx. Nothing else should ever write
 * index.html by hand: that is exactly how the deploy build drifted a full redesign
 * behind the canonical source once already.
 *
 *   npm install     (once)
 *   npm run build
 *
 * What it does:
 *   1. Rewrites the module boundary so the source runs as an inline Babel script.
 *   2. Compiles ONLY the Tailwind utilities the source actually uses, inline.
 *      No runtime CDN for CSS, so no flash of unstyled content.
 *   3. Emits index.html with the deploy config hook for the API proxy.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(ROOT, "src", "baxstar-ember.jsx");
const OUT = path.join(ROOT, "index.html");

const REACT_UMD = "https://unpkg.com/react@18/umd/react.production.min.js";
const REACT_DOM_UMD = "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js";
const BABEL_UMD = "https://unpkg.com/@babel/standalone/babel.min.js";

/* ---------- 1. source → inline-script body ---------- */

const raw = fs.readFileSync(SRC, "utf8");

const IMPORT_LINE = 'import { useState, useEffect, useRef } from "react";';
if (!raw.includes(IMPORT_LINE)) {
  console.error(`build: expected import line not found in ${SRC}\n  looked for: ${IMPORT_LINE}`);
  process.exit(1);
}
if (!raw.includes("export default function BaxstarEmber()")) {
  console.error("build: expected `export default function BaxstarEmber()` in source");
  process.exit(1);
}
// An inline <script> is terminated by this sequence no matter where it appears.
if (raw.includes("</script")) {
  console.error("build: source contains a literal </script — it cannot be inlined safely");
  process.exit(1);
}

const body = raw
  .replace(IMPORT_LINE, "const { useState, useEffect, useRef } = React;")
  .replace("export default function BaxstarEmber()", "function BaxstarEmber()");

const mount = `
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<BaxstarEmber />);
`;

const scriptBody = body + mount;

/* ---------- 2. compile the Tailwind utilities the source uses ---------- */

function compileTailwind(contentForScan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ember-tw-"));
  const scan = path.join(tmp, "scan.jsx");
  const cfg = path.join(tmp, "tailwind.config.cjs");
  const input = path.join(tmp, "in.css");
  const output = path.join(tmp, "out.css");

  fs.writeFileSync(scan, contentForScan);
  fs.writeFileSync(
    cfg,
    `module.exports = {
  content: [${JSON.stringify(scan)}],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
`
  );
  fs.writeFileSync(input, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");

  try {
    execFileSync(
      "npx",
      ["--no-install", "tailwindcss", "-c", cfg, "-i", input, "-o", output, "--minify"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (e) {
    console.error(
      "build: could not run tailwindcss.\n" +
        "  Run `npm install` in this repo first (it installs tailwindcss as a devDependency).\n" +
        (e.stderr ? "  " + String(e.stderr).trim().split("\n").slice(-3).join("\n  ") : "")
    );
    process.exit(1);
  }

  const css = fs.readFileSync(output, "utf8").trim();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (css.length < 2000) {
    console.error(`build: compiled CSS looks too small (${css.length} bytes) — aborting`);
    process.exit(1);
  }
  return css;
}

const tailwindCss = compileTailwind(scriptBody);

/* ---------- 3. assemble ---------- */

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Baxstar Ember</title>
<!-- GENERATED FILE — do not edit by hand.
     Source: src/baxstar-ember.jsx · Rebuild: npm run build -->
<!-- Tailwind utilities used by Ember, compiled ahead of time (no runtime CDN, no FOUC). -->
<style id="ember-tailwind-compiled">${tailwindCss}</style>
<style>html,body,#root{margin:0;height:100%;background:#000;}</style>
<script>
/* EMBER DEPLOY CONFIG
   Hosting Ember at a real URL? Uncomment the line below and point it at your proxy
   (proxy/cloudflare-worker.js — see docs/DEPLOY.md). The proxy holds the Anthropic key.
   Left commented out, Ember calls the Anthropic API direct, which only works inside
   a Claude artifact. Never put an API key in this file — it ships to every visitor. */
// window.EMBER_API_PROXY = "https://ember-claude-proxy.YOUR-SUBDOMAIN.workers.dev";

/* Where the steampunk asset pack lives, if you host it somewhere else. */
// window.EMBER_ASSET_ROOT = "assets/ember";
</script>
<script crossorigin src="${REACT_UMD}"></script>
<script crossorigin src="${REACT_DOM_UMD}"></script>
<script src="${BABEL_UMD}"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react">
${scriptBody}</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(1) + "KB";
console.log("build: wrote index.html");
console.log(`  app script     ${kb(scriptBody.length)}`);
console.log(`  tailwind css   ${kb(tailwindCss.length)}`);
console.log(`  total          ${kb(html.length)}`);
