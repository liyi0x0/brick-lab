// 开发辅助：用无头 Chrome 打开应用并截图，便于检查渲染效果
// 用法：node scripts/shot.mjs <url> <out.png> [宽x高] [脚本文件]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [url = 'http://localhost:5173/', out = 'screenshots/shot.png', size = '1440x900', scriptFile] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, locale: process.env.LOCALE || 'zh-CN', colorScheme: process.env.SCHEME || 'light' });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
if (scriptFile) {
  const code = fs.readFileSync(scriptFile, 'utf8');
  await page.evaluate(code);
  await page.waitForTimeout(900);
}
fs.mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
