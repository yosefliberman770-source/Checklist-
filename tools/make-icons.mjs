// Renders icons/icon.svg to the PNG sizes phones need. Run: node tools/make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const full = svg.replace('rx="112"', 'rx="0"'); // iOS and maskable icons get rounded by the OS
const maskable = full.replace('<circle', '<g transform="translate(51 51) scale(.8)"><circle').replace('</svg>', '</g></svg>');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
for (const [name, size, src] of [['icon-192.png', 192, svg], ['icon-512.png', 512, svg], ['apple-touch-icon.png', 180, full], ['icon-maskable-512.png', 512, maskable]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').screenshot({ path: new URL(`../icons/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('icons written');
