// 端到端冒烟测试：用真实的鼠标 / 键盘操作走一遍主要功能，并在关键步骤截图
// 用法：node scripts/e2e.mjs [url] [输出目录]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'screenshots/e2e';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
// 关闭首次打开时的欢迎对话框
await page.evaluate(() => window.__store.getState().openDialog(null));

let step = 0;
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const count = () => page.evaluate(() => window.__model.count);
const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__project(x, y, z), [x, y, z]);
const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

try {
// 1. 悬停显示预览，点击放置
let p = await at(0, 0, 0);
await page.mouse.move(p.x, p.y);
await shot('hover-ghost');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
check('点击放置积木', (await count()) === 1);

// 2. 旋转后在另一处放置
await page.keyboard.press('r');
p = await at(6, 0, 4);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
const second = await page.evaluate(() => window.__model.list()[1]);
check('R 旋转后放置', second?.rot === 1, JSON.stringify(second));

// 3. 叠在第一块上面
const first = await page.evaluate(() => window.__model.list()[0]);
p = await at(first.x + 2, 1.2, first.z + 1);
await page.keyboard.press('r');
await page.keyboard.press('r');
await page.keyboard.press('r');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
const third = await page.evaluate(() => window.__model.list()[2]);
check('叠放在积木顶部', third?.y === 3, JSON.stringify(third));
await shot('stacked');

// 4. 选择工具点选
await page.keyboard.press('v');
p = await at(first.x + 1, 0.6, first.z + 2.001);
await page.mouse.click(p.x, p.y);
let sel = await page.evaluate(() => window.__store.getState().selection);
check('选择积木', sel.length === 1, JSON.stringify(sel));
if (!sel.length) {
  const dbg = await page.evaluate(([x, y]) => {
    const h = window.__engine.pick(x, y);
    return { hit: h, tool: window.__store.getState().tool, list: window.__model.list() };
  }, [p.x, p.y]);
  console.log('DEBUG', JSON.stringify(dbg));
}
await shot('selected');

// 5. 拖动移动所选积木
const before = await page.evaluate((id) => ({ ...window.__model.get(id) }), sel[0]);
const from = await at(before.x + 1, 0.6, before.z + 2.001);
const to = await at(before.x - 6, 0, before.z - 6);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
await shot('dragging');
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate((id) => ({ ...window.__model.get(id) }), sel[0]);
check('拖动移动', after.x !== before.x || after.z !== before.z, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

// 6. 创建副本并放置
await page.keyboard.press('Control+d');
const pasting = await page.evaluate(() => window.__store.getState().pasting);
check('Ctrl+D 进入粘贴模式', pasting);
p = await at(-8, 0, 6);
await page.mouse.move(p.x, p.y);
await shot('paste-ghost');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
check('放置副本', (await count()) === 4);
await page.keyboard.press('Escape');

// 7. 上色
await page.keyboard.press('p');
await page.evaluate(() => window.__store.getState().setColor(1));
const target = await page.evaluate(() => window.__model.list()[0]);
p = await at(target.x + 0.5, 0.6, target.z + (target.rot % 2 ? 4 : 2) + 0.001);
await page.mouse.move(p.x, p.y);
await shot('paint-preview');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
const painted = await page.evaluate((id) => window.__model.get(id).color, target.id);
check('上色', painted === 1, `color=${painted}`);

// 8. 拆除 + 撤销
await page.keyboard.press('e');
await page.mouse.move(p.x, p.y);
await shot('erase-hover');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
check('拆除', (await count()) === 3);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('撤销', (await count()) === 4);

// 9. 框选
await page.keyboard.press('v');
await page.keyboard.down('Shift');
await page.mouse.move(150 + 330, 120);
await page.mouse.down();
await page.mouse.move(1300, 800, { steps: 8 });
await page.mouse.up();
await page.keyboard.up('Shift');
sel = await page.evaluate(() => window.__store.getState().selection);
check('Shift 框选', sel.length === 4, `selected=${sel.length}`);
await shot('marquee');

// 10. 选中后旋转 4 次回到原位
const snap = await page.evaluate(() => JSON.stringify(window.__model.list()));
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('r');
  await page.waitForTimeout(80);
}
const snap2 = await page.evaluate(() => JSON.stringify(window.__model.list()));
check('选区旋转 4 次复原', snap === snap2);

// 11. 对话框
await page.keyboard.press('Escape');
await page.keyboard.press('Control+e');
await shot('export-dialog');
await page.keyboard.press('Escape');
await page.keyboard.press('?');
await shot('help-dialog');
await page.keyboard.press('Escape');

// 12. 深色主题 + 回放
await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
await shot('dark');
await page.evaluate(() => window.__store.getState().setUI({ playback: true }));
await page.waitForTimeout(1800);
await shot('playback');

} catch (e) {
  results.push(`ERROR ${e.message.split('\n')[0]}`);
}
console.log(results.join('\n'));
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
await browser.close();
