// 生成 PWA 图标（把 SVG 标志渲染成 PNG）
import { chromium } from 'playwright';

const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e9f2"/></linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a6b"/><stop offset="1" stop-color="#f04a3a"/></linearGradient>
  </defs>
  <rect width="32" height="32" rx="${pad ? 0 : 7}" fill="url(#bg)"/>
  <g transform="translate(16 16.6) scale(${pad ? 0.62 : 0.78}) translate(-16 -17)">
    <path d="M4 11.5 16 18 16 29.5 4 23z" fill="#c8281a"/>
    <path d="M16 18 28 11.5 28 23 16 29.5z" fill="#a51d12"/>
    <path d="M16 5 28 11.5 16 18 4 11.5z" fill="url(#top)"/>
    ${[[16, 6.4], [10.2, 9.7], [21.8, 9.7], [16, 13]]
      .map(([x, y]) => `<path d="M${x - 3.1} ${y} v-2 a3.1 1.7 0 0 1 6.2 0 v2 a3.1 1.7 0 0 1 -6.2 0z" fill="#d33424"/><ellipse cx="${x}" cy="${y - 2}" rx="3.1" ry="1.7" fill="#ff9a8c"/>`)
      .join('')}
  </g>
</svg>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, pad)}</body></html>`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
