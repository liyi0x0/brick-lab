// 端到端：自动保存与恢复、分享链接、LDraw 导出 → 重新导入、截图导出
// 用法：node scripts/e2e-io.mjs [url] [输出目录]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'screenshots/e2e-io';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];
const errors = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__store.getState().openDialog(null);
    window.__actions.newProject();
  });
  // 1. 搭一个小作品
  await page.evaluate(() => {
    const B = (part, color, x, y, z, rot = 0) => ({ part, color, x, y, z, rot });
    window.__store.getState().updateProject({ name: '测试小屋' });
    window.__model.addBricks([
      B('brick-2x4', 4, 0, 0, 0), B('brick-2x4', 1, 0, 3, 0, 1), B('slope45-2x2', 14, 4, 0, 0, 2),
      B('corner-brick-2x2', 2, -3, 0, -3, 3), B('arch-1x4', 71, -4, 0, 4), B('plate-1x2', 15, 0, 6, 1),
    ]);
  });
  const n0 = await page.evaluate(() => window.__model.count);
  // 2. 自动保存 → 刷新后恢复
  await page.waitForTimeout(1600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const restored = await page.evaluate(() => ({ n: window.__model.count, name: window.__store.getState().project.name, dialog: window.__store.getState().ui.dialog }));
  check('刷新后恢复作品', restored.n === n0 && restored.name === '测试小屋', JSON.stringify(restored));

  // 3. 分享链接在全新的浏览器上下文中打开
  const link = await page.evaluate(() => window.__actions.makeShareLink());
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  const p2 = await ctx2.newPage();
  await p2.goto(link, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(900);
  const shared = await p2.evaluate(() => ({ n: window.__model.count, name: window.__store.getState().project.name, hash: location.hash }));
  check('分享链接打开', shared.n === n0 && shared.name === '测试小屋' && shared.hash === '', JSON.stringify({ ...shared, linkLength: link.length }));
  await p2.screenshot({ path: `${out}/shared.png` });
  await ctx2.close();

  // 4. 通过导出对话框下载 LDraw
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('LDraw 模型').click()]);
  const ldrPath = path.join(out, dl.suggestedFilename());
  await dl.saveAs(ldrPath);
  const ldr = fs.readFileSync(ldrPath, 'utf8');
  check('导出 LDraw', ldr.startsWith('0 测试小屋') && (ldr.match(/^1 /gm) ?? []).length === n0, dl.suggestedFilename());
  await page.keyboard.press('Escape');

  // 5. 清空后通过「打开文件」重新导入 LDraw
  await page.evaluate(() => window.__model.clearAll());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(ldrPath);
  await page.waitForTimeout(800);
  const reimported = await page.evaluate(() => window.__model.list().map((b) => `${b.part}|${b.color}|${b.rot}`).sort());
  check('重新导入 LDraw', reimported.length === n0, JSON.stringify(reimported));

  // 6. 截图导出
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(300);
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByText('高清截图').click()]);
  const pngPath = path.join(out, png.suggestedFilename());
  await png.saveAs(pngPath);
  const size = fs.statSync(pngPath).size;
  check('导出截图', size > 50_000, `${png.suggestedFilename()} ${Math.round(size / 1024)} KB`);
  await page.keyboard.press('Escape');

  // 7. 作品库
  await page.evaluate(() => window.__store.getState().openDialog('library'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/library.png` });
  const cards = await page.locator('img[src^="data:image/jpeg"]').count();
  check('作品库显示缩略图', cards >= 1, `cards=${cards}`);
} catch (e) {
  results.push(`ERROR ${e.message.split('\n')[0]}`);
}
console.log(results.join('\n'));
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
await browser.close();
