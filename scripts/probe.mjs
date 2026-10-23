// 开发辅助：在页面中执行脚本并打印返回值（JSON）
// 用法：node scripts/probe.mjs <url> <script.js> [宽x高]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url = 'http://localhost:5173/', scriptFile, size = '1280x800'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, locale: process.env.LOCALE || 'zh-CN', colorScheme: process.env.SCHEME || 'light' });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const result = await page.evaluate(fs.readFileSync(scriptFile, 'utf8'));
console.log(JSON.stringify(result, null, 1));
await browser.close();
