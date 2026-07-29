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
 * The output is a SINGLE SELF-CONTAINED FILE. It makes no network requests to load
 * itself — React, the compiled app, and the Tailwind utilities are all inlined:
 *
 *   1. The JSX is compiled ahead of time with esbuild. The browser never sees JSX and
 *      never loads Babel, which previously meant downloading ~2.9MB and compiling
 *      ~200KB on every single page load.
 *   2. React and ReactDOM are inlined from node_modules rather than fetched from a CDN.
 *   3. Only the Tailwind utilities the source actually uses are compiled in.
 *
 * That matters beyond speed: the old build simply did not render at all when unpkg was
 * unreachable. Now the only network Ember needs is the one to its own API proxy.
 *
 * The Google Fonts @import inside the app's stylesheet is the one remaining external
 * request. It degrades to a system serif rather than breaking the page.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { transformSync } from "esbuild";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(ROOT, "src", "baxstar-ember.jsx");
const OUT = path.join(ROOT, "index.html");

const REACT_UMD = path.join(ROOT, "node_modules/react/umd/react.production.min.js");
const REACT_DOM_UMD = path.join(ROOT, "node_modules/react-dom/umd/react-dom.production.min.js");

const die = (msg) => { console.error("build: " + msg); process.exit(1); };

/* ---------- 1. source → plain JS ---------- */

const raw = fs.readFileSync(SRC, "utf8");

const IMPORT_LINE = 'import { useState, useEffect, useRef } from "react";';
if (!raw.includes(IMPORT_LINE)) die(`expected import line not found in ${SRC}\n  looked for: ${IMPORT_LINE}`);
if (!raw.includes("export default function BaxstarEmber()")) die("expected `export default function BaxstarEmber()` in source");

const jsx = raw
  .replace(IMPORT_LINE, "const { useState, useEffect, useRef } = React;")
  .replace("export default function BaxstarEmber()", "function BaxstarEmber()")
  + `\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(BaxstarEmber));\n`;

let compiled;
try {
  compiled = transformSync(jsx, {
    loader: "jsx",
    format: "iife",
    target: "es2019",
    // React/ReactDOM are globals from the inlined UMD builds, not imports.
    jsx: "transform",
    legalComments: "none",
  }).code;
} catch (e) {
  die("esbuild could not compile the source.\n  " + (e.message || String(e)));
}

// An inline <script> is terminated by this sequence wherever it appears, including
// inside a string literal. Escape it rather than refusing to build.
const inlineSafe = (s) => s.replace(/<\/script/gi, "<\\/script");

/* ---------- 2. vendored React ---------- */

for (const p of [REACT_UMD, REACT_DOM_UMD]) {
  if (!fs.existsSync(p)) die(`${path.relative(ROOT, p)} is missing — run \`npm install\` first.`);
}
const reactJs = fs.readFileSync(REACT_UMD, "utf8");
const reactDomJs = fs.readFileSync(REACT_DOM_UMD, "utf8");

/* ---------- 3. the Tailwind utilities the source uses ---------- */

function compileTailwind(contentForScan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ember-tw-"));
  const scan = path.join(tmp, "scan.jsx");
  const cfg = path.join(tmp, "tailwind.config.cjs");
  const input = path.join(tmp, "in.css");
  const output = path.join(tmp, "out.css");

  fs.writeFileSync(scan, contentForScan);
  fs.writeFileSync(cfg, `module.exports = {
  content: [${JSON.stringify(scan)}],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
`);
  fs.writeFileSync(input, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");

  try {
    execFileSync("npx", ["--no-install", "tailwindcss", "-c", cfg, "-i", input, "-o", output, "--minify"],
      { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    die("could not run tailwindcss.\n  Run `npm install` in this repo first.\n" +
      (e.stderr ? "  " + String(e.stderr).trim().split("\n").slice(-3).join("\n  ") : ""));
  }

  const css = fs.readFileSync(output, "utf8").trim();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (css.length < 2000) die(`compiled CSS looks too small (${css.length} bytes) — aborting`);
  return css;
}

// Scan the ORIGINAL JSX: esbuild's output still carries the class strings, but the
// source is what a human reads, and scanning it keeps the mapping obvious.
const tailwindCss = compileTailwind(raw);

/* ---------- 4. assemble ---------- */

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Baxstar Ember</title>
<!-- GENERATED FILE — do not edit by hand.
     Source: src/baxstar-ember.jsx · Rebuild: npm run build
     Self-contained: React and the compiled app are inlined, so this file loads with
     no CDN. The only network Ember needs is its API proxy. -->
<style id="ember-tailwind-compiled">${tailwindCss}</style>
<style>html,body,#root{margin:0;height:100%;background:#000;}</style>
<script>
/* EMBER DEPLOY CONFIG
   Points Ember at the key-holding proxy. The proxy enforces an origin allowlist
   server-side, so this URL is useless from anywhere but ALLOWED_ORIGINS.
   Change ALLOWED_ORIGINS on the Worker before hosting at a new domain, or every
   request from it will 403. See docs/DEPLOY.md. Never put an API key in this file. */
window.EMBER_API_PROXY = "https://ember-claude-proxy.brady-9d1.workers.dev";

/* Where the steampunk asset pack lives, if you host it somewhere else. */
// window.EMBER_ASSET_ROOT = "assets/ember";
</script>
<script>${inlineSafe(reactJs)}</script>
<script>${inlineSafe(reactDomJs)}</script>
</head>
<body>
<div id="root"></div>
<script>${inlineSafe(compiled)}</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(1) + "KB";
console.log("build: wrote index.html — self-contained, no CDN");
console.log(`  react + react-dom  ${kb(reactJs.length + reactDomJs.length)}  (inlined, was fetched from unpkg)`);
console.log(`  compiled app       ${kb(compiled.length)}  (was ${kb(raw.length)} of JSX compiled in-browser)`);
console.log(`  tailwind css       ${kb(tailwindCss.length)}`);
console.log(`  total              ${kb(html.length)}`);
