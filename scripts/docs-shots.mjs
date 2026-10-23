// 生成 README 用的截图（需要先 npm run dev）
// 用法：node scripts/docs-shots.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function shoot(file, { width, height, dpr = 1, scheme = 'light', template, setup }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr, locale: 'zh-CN', colorScheme: scheme });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(async (template) => {
    const { TEMPLATES } = await import('/src/core/templates.ts');
    const tpl = TEMPLATES.find((t) => t.id === template);
    window.__store.getState().openDialog(null);
    if (tpl) {
      window.__actions.openProject({
        name: tpl.name.zh,
        baseplateSize: tpl.baseplateSize,
        baseplateColor: tpl.baseplateColor,
        bricks: tpl.build(),
      });
    }
  }, template);
  await page.waitForTimeout(700);
  if (setup) await setup(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `docs/images/${file}`, type: 'jpeg', quality: 86 });
  await page.close();
  console.log('wrote', file);
}

// 主图：小屋 + 鼠标悬停时的放置预览
await shoot('hero.jpg', {
  width: 1600,
  height: 1000,
  dpr: 1.25,
  template: 'cottage',
  setup: async (page) => {
    await page.evaluate(() => window.__store.getState().setColor(14));
    const p = await page.evaluate(() => window.__project(-9, 0, 4));
    await page.mouse.move(p.x, p.y);
  },
});
// 深色主题 + 选中状态
await shoot('dark.jpg', {
  width: 1280,
  height: 800,
  scheme: 'dark',
  template: 'castle',
  setup: async (page) => {
    await page.evaluate(() => {
      const ids = window.__model.list().filter((b) => b.y >= 21).map((b) => b.id);
      window.__store.getState().setTool('select');
      window.__store.getState().setSelection(ids);
    });
  },
});
// 搭建回放
await shoot('playback.jpg', {
  width: 1280,
  height: 800,
  template: 'rocket',
  setup: async (page) => {
    await page.evaluate(() => window.__store.getState().setUI({ playback: true }));
    await page.waitForTimeout(900);
    // 跳到约四分之三处，再单步前进一格以展示落下动画与高亮
    await page.keyboard.press('End');
    for (let i = 0; i < 28; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(160);
  },
});
// 手机
await shoot('mobile.jpg', { width: 390, height: 844, dpr: 2, template: 'pyramid' });
await browser.close();
