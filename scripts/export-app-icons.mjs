// Deterministic raster exports of Ember's existing SVG; no new artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const svg = await fs.readFile(path.join(root, 'assets/ember/icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium' });
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, `assets/ember/icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
