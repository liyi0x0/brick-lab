// 检查生产构建能否离线打开（Service Worker 缓存）
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle' }); // 让 SW 接管并缓存全部资源
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
const ok = await page.evaluate(() => !!document.querySelector('canvas') && document.title);
console.log(ok ? `PASS  离线打开成功：${ok}` : 'FAIL  离线打开失败', errors.length ? errors : '');
await browser.close();
