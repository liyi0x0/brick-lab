// 回归测试：代码审查中发现并修复的问题，逐条用真实输入复现，确认不再出现
// 用法：node scripts/e2e-regressions.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
const errors = [];

async function open(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', ...opts });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__store.getState().openDialog(null);
    window.__actions.newProject();
  });
  return { context, page };
}
const B = (part, color, x, y, z, rot = 0) => ({ part, color, x, y, z, rot });

try {
  // 1. 确认框：聚焦「取消」时回车 = 取消；焦点不离开对话框；对话框打开时快捷键不生效
  {
    const { context, page } = await open();
    await page.evaluate((b) => window.__model.addBricks(b), [B('brick-2x4', 4, 0, 0, 0), B('brick-2x4', 1, 6, 0, 0)]);
    await page.evaluate(() => window.__store.getState().setSelection([1]));
    await page.locator('button[aria-label="更多"]').click();
    await page.locator('[role=menuitem]').first().click(); // 新建作品 → 确认框
    await page.waitForTimeout(250);
    // 初始焦点在「确定」；连续 Tab 应在两个按钮之间循环，不会跑出对话框
    let inside = true;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      inside &&= await page.evaluate(() => !!document.activeElement?.closest('[role=alertdialog]'));
    }
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    // 5 次 Tab 后焦点停在「取消」
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ count: window.__model.count, open: document.querySelectorAll('[role=alertdialog]').length }));
    check('确认框：焦点留在框内、快捷键不穿透、聚焦取消时回车即取消', inside && focused === '取消' && r.count === 2 && r.open === 0, JSON.stringify({ inside, focused, ...r }));
    await context.close();
  }

  // 2. 打开分享链接后刷新：分享的作品被保存并恢复，原作品仍在库中
  {
    const { context, page } = await open();
    await page.evaluate((b) => {
      window.__store.getState().updateProject({ name: 'MyWork' });
      window.__model.addBricks(b);
    }, [B('brick-2x4', 4, 0, 0, 0), B('brick-2x4', 4, 0, 3, 0)]);
    await page.waitForTimeout(1500);
    const link = await page.evaluate(async (b) => {
      const { encodeShare } = await import('/src/core/serialize.ts');
      return `${location.origin}${location.pathname}#m=${await encodeShare({ name: 'Friend', baseplateSize: 32, baseplateColor: 2, bricks: b })}`;
    }, [B('brick-1x1', 1, 1, 0, 1), B('brick-1x1', 1, 2, 0, 1), B('brick-1x1', 1, 3, 0, 1)]);
    await page.goto('about:blank');
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(async () => {
      const { listProjects } = await import('/src/state/persistence.ts');
      return { name: window.__store.getState().project.name, count: window.__model.count, library: (await listProjects()).map((e) => `${e.name}:${e.count}`).sort() };
    });
    check(
      '分享链接打开后刷新不丢失（且只保存一份）',
      r.name === 'Friend' && r.count === 3 && r.library.join('|') === 'Friend:3|MyWork:2',
      JSON.stringify(r),
    );

    // 6. 已打开的页面里粘贴新的分享链接（只有 hash 变化）
    const link2 = await page.evaluate(async (b) => {
      const { encodeShare } = await import('/src/core/serialize.ts');
      return `#m=${await encodeShare({ name: 'Second', baseplateSize: 32, baseplateColor: 2, bricks: b })}`;
    }, [B('plate-2x2', 14, 0, 0, 0)]);
    await page.evaluate((h) => {
      location.hash = h;
    }, link2);
    await page.waitForTimeout(900);
    const r2 = await page.evaluate(() => ({ name: window.__store.getState().project.name, count: window.__model.count, hash: location.hash }));
    check('当前页面中粘贴分享链接也能打开', r2.name === 'Second' && r2.count === 1 && r2.hash === '', JSON.stringify(r2));
    await context.close();
  }

  // 3. 选择工具下在积木上双指缩放：应缩放而不是旋转
  {
    const { context, page } = await open({ hasTouch: true, viewport: { width: 1024, height: 768 } });
    await page.evaluate((b) => window.__model.addBricks(b), [B('plate-8x8', 4, -4, 0, -4)]);
    await page.evaluate(() => {
      window.__engine.setView('home', false);
      window.__store.getState().setTool('select');
    });
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
    const cam = () =>
      page.evaluate(() => {
        const e = window.__engine;
        const off = e.camera.position.clone().sub(e.controls.target);
        return { dist: off.length(), az: Math.atan2(off.x, off.z) };
      });
    const p = await page.evaluate(() => window.__project(0, 0.4, 0));
    const a = [p.x - 30, p.y];
    const b = [p.x + 30, p.y];
    const before = await cam();
    await touch('touchStart', [a]);
    await page.waitForTimeout(50);
    await touch('touchStart', [a, b]);
    await page.waitForTimeout(50);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', [
        [a[0] - i * 8, a[1] - i * 4],
        [b[0] + i * 8, b[1] + i * 4],
      ]);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    const after = await cam();
    const rot = Math.abs(((after.az - before.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (180 / Math.PI);
    check('选择模式双指缩放', after.dist < before.dist * 0.9 && rot < 5, `dist ${before.dist.toFixed(1)} → ${after.dist.toFixed(1)}, 旋转 ${rot.toFixed(1)}°`);
    await context.close();
  }

  // 4. 作品库上方的重命名框：Esc 只关闭输入框
  {
    const { context, page } = await open();
    await page.evaluate((b) => window.__model.addBricks(b), [B('brick-2x2', 4, 0, 0, 0)]);
    await page.waitForTimeout(1300);
    await page.evaluate(() => window.__store.getState().openDialog('library'));
    await page.waitForTimeout(700);
    await page.locator('button[aria-label="重命名作品"]').first().click({ force: true });
    await page.waitForTimeout(200);
    const promptOpen = await page.locator('#confirm-input').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ dialog: window.__store.getState().ui.dialog, prompt: document.querySelectorAll('[role=alertdialog]').length }));
    check('Esc 只关闭最上层的输入框', promptOpen === 1 && r.dialog === 'library' && r.prompt === 0, JSON.stringify({ promptOpen, ...r }));
    await context.close();
  }

  // 5. 拖动积木途中按键：不应改动模型，松手后只产生一次移动
  {
    const { context, page } = await open();
    await page.evaluate((b) => window.__model.addBricks(b), [B('brick-2x4', 4, 0, 0, 0)]);
    await page.evaluate(() => window.__store.getState().setTool('select'));
    await page.waitForTimeout(400);
    const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__project(x, y, z), [x, y, z]);
    const p = await at(2, 1.2, 1);
    const q = await at(8, 0, 6);
    const undo0 = await page.evaluate(() => window.__model.canUndo);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 5 });
    await page.mouse.move(q.x, q.y, { steps: 5 });
    await page.keyboard.press('r');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await page.mouse.up();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ bricks: window.__model.list().map((b) => ({ x: b.x, z: b.z, rot: b.rot })) }));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => window.__model.list().map((b) => ({ x: b.x, z: b.z, rot: b.rot })));
    check(
      '拖动途中按键不覆盖结果',
      undo0 === true && r.bricks.length === 1 && r.bricks[0].rot === 0 && (r.bricks[0].x !== 0 || r.bricks[0].z !== 0) && back[0].x === 0 && back[0].z === 0,
      JSON.stringify({ after: r.bricks, undone: back }),
    );

    // 按下鼠标后删除积木再拖动：不应报错
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.keyboard.press('Delete');
    await page.mouse.move(q.x, q.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const r2 = await page.evaluate(() => ({
      count: window.__model.count,
      staleSelection: window.__store.getState().selection.filter((id) => !window.__model.get(id)).length,
    }));
    check('按住积木时按 Delete 不会出错', r2.count === 1 && r2.staleSelection === 0 && errors.length === 0, JSON.stringify(r2));
    await context.close();
  }
} catch (e) {
  results.push(`ERROR ${e.message.split('\n')[0]}`);
}
console.log(results.join('\n'));
console.log(errors.length ? `\nPAGE ERRORS:\n${[...new Set(errors)].join('\n')}` : '\nno page errors');
await browser.close();
