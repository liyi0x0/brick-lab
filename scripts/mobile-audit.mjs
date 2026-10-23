// 手机端巡检：用设备模拟逐个打开主要界面截图，并拼成一张总览图
// 用法：node scripts/mobile-audit.mjs [url] [输出目录] [设备名，默认 iPhone 14 Pro]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = path.resolve(process.argv[3] ?? 'screenshots/mobile');
const deviceName = process.argv[4] ?? 'iPhone 14 Pro';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];
const shots = [];

async function run(device, tag, steps) {
  const ctx = await browser.newContext({ ...devices[device], locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const snap = async (name) => {
    await page.waitForTimeout(450);
    const f = path.join(out, `${tag}-${name}.png`);
    await page.screenshot({ path: f });
    shots.push([`${tag}-${name}`, f]);
  };
  await steps(page, snap);
  await ctx.close();
}

const st = (page, fn, arg) => page.evaluate(fn, arg);

await run(deviceName, 'p', async (page, snap) => {
  await snap('01-welcome');
  await st(page, () => window.__store.getState().openDialog(null));
  await snap('02-main');
  await st(page, () => window.__store.getState().setUI({ mobileSheet: 'parts' }));
  await snap('03-parts');
  await st(page, () => window.__store.getState().setUI({ mobileSheet: 'colors' }));
  await snap('04-colors');
  await st(page, () => window.__store.getState().setUI({ mobileSheet: null }));
  await st(page, () => {
    const s = window.__store.getState();
    s.setTool('select');
    s.setSelection(window.__model.list().slice(20, 26).map((b) => b.id));
  });
  await snap('05-selection');
  await st(page, () => {
    window.__store.getState().setSelection([]);
    window.__actions.selectAll();
    window.__actions.copySelection();
    window.__store.getState().setSelection([]);
    window.__actions.paste();
  });
  await snap('06-paste');
  await st(page, () => window.__actions.escape());
  await page.locator('button[aria-label="更多"]').tap();
  await snap('07-menu');
  await page.mouse.click(5, 400);
  await st(page, () => window.__store.getState().setUI({ playback: true }));
  await page.waitForTimeout(1200);
  await snap('08-playback');
  await st(page, () => window.__store.getState().setUI({ playback: false }));
  for (const d of ['settings', 'export', 'help', 'library']) {
    await st(page, (dd) => window.__store.getState().openDialog(dd), d);
    await page.waitForTimeout(400);
    await snap(`09-${d}`);
    await st(page, () => window.__store.getState().openDialog(null));
  }
  // —— 触屏功能检查 ——
  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const at = (x, y, z) => st(page, (a) => window.__project(a[0], a[1], a[2]), [x, y, z]);
  await st(page, () => {
    window.__actions.newProject();
    const B = (x, z) => ({ part: 'brick-2x2', color: 4, x, y: 0, z, rot: 0 });
    window.__model.addBricks([B(-6, 0), B(0, 0), B(6, 0)]);
    window.__model.addBricks([{ part: 'plate-2x2', color: 1, x: 0, y: 3, z: 0, rot: 0 }]);
    window.__store.getState().setTool('select');
  });
  await page.waitForTimeout(500);
  const pA = await at(-5, 0.6, 2.001);
  const pB = await at(7, 0.6, 2.001);
  await page.touchscreen.tap(pA.x, pA.y);
  await page.waitForTimeout(450);
  await page.touchscreen.tap(pB.x, pB.y);
  await page.waitForTimeout(300);
  let sel = await st(page, () => window.__store.getState().selection.length);
  check('触屏多选：轻点两块积木都被选中', sel === 2, `selected=${sel}`);
  const empty = await at(0, 0, 12);
  await page.touchscreen.tap(empty.x, empty.y);
  await page.waitForTimeout(300);
  sel = await st(page, () => window.__store.getState().selection.length);
  check('触屏：轻点空白处取消选择', sel === 0, `selected=${sel}`);
  const pM = await at(1, 0.6, 2.001);
  await page.touchscreen.tap(pM.x, pM.y);
  await page.waitForTimeout(120);
  await page.touchscreen.tap(pM.x, pM.y);
  await page.waitForTimeout(300);
  sel = await st(page, () => window.__store.getState().selection.length);
  check('触屏双击：选中相连的一组', sel === 2, `selected=${sel}`);
  await st(page, () => {
    window.__store.getState().setSelection([]);
    window.__store.getState().setTool('build');
  });
  await page.waitForTimeout(300);
  const before = await st(page, () => window.__model.count);
  await touch('touchStart', [[pA.x, pA.y]]);
  await page.waitForTimeout(700);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const after = await st(page, () => window.__model.count);
  check('长按拆除积木', after === before - 1, `${before} → ${after}`);
  await page.locator('button[aria-label="更多"]').tap();
  await page.getByRole('menuitem', { name: '零件清单' }).tap();
  await page.waitForTimeout(400);
  const bom = await page.locator('.bom-panel').count();
  check('菜单打开零件清单', bom === 1);
  await snap('09-bom');
  await st(page, () => window.__store.getState().setUI({ bomOpen: false }));
  console.log(results.join('\n'));

  // 轻点放置：搭建工具下点在底板空处
  await st(page, () => window.__actions.newProject());
  await page.waitForTimeout(300);
  const p = await st(page, () => window.__project(0, 0, 0));
  await page.tap('canvas', { position: { x: p.x, y: p.y } });
  await page.waitForTimeout(500);
  const n = await st(page, () => window.__model.count);
  console.log(`tap-to-place: ${n === 1 ? 'PASS' : 'FAIL'} (bricks=${n})`);
  await snap('10-placed');
});

await run(`${deviceName} landscape`, 'l', async (page, snap) => {
  await st(page, () => window.__store.getState().openDialog(null));
  await snap('01-main');
  await st(page, () => window.__store.getState().setUI({ mobileSheet: 'parts' }));
  await snap('02-parts');
});

// 拼成总览图
const html = `<html><body style="margin:0;padding:12px;background:#ddd;font:12px sans-serif">
<div style="display:flex;flex-wrap:wrap;gap:10px">${shots
  .map(([n, f]) => `<figure style="margin:0"><img src="file://${f}" style="height:420px;border:1px solid #999"><figcaption>${n}</figcaption></figure>`)
  .join('')}</div></body></html>`;
const sheet = path.join(out, 'sheet.html');
fs.writeFileSync(sheet, html);
const p = await browser.newPage({ viewport: { width: 1800, height: 900 } });
await p.goto(`file://${sheet}`);
await p.waitForTimeout(500);
await p.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
