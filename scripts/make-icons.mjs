// Renders PWA icons and favicons from public/icons/icon.svg using the bundled Chromium.
// Usage: node scripts/make-icons.mjs   (requires `npm i -D playwright` locally)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const maskable = svg
  .replace('<rect width="512" height="512" fill="#05070B"/>', '<rect width="512" height="512" fill="#05070B"/><g transform="translate(256 256) scale(0.78) translate(-256 -256)">')
  .replace('</svg>', '</g></svg>');

const targets = [
  ['public/icons/icon-48.png', 48, svg],
  ['public/icons/icon-96.png', 96, svg],
  ['public/icons/icon-192.png', 192, svg],
  ['public/icons/icon-512.png', 512, svg],
  ['public/icons/icon-maskable-512.png', 512, maskable],
  ['public/icons/apple-touch-icon.png', 180, maskable],
  ['public/favicon/favicon-32.png', 32, svg],
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [out, size, src] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#05070B">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../${out}`, import.meta.url), await page.screenshot({ type: 'png', omitBackground: false }));
  console.log('wrote', out);
}
await browser.close();
