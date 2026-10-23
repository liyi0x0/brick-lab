// 打包单文件版：把 JS / CSS 全部内联进一个 HTML，双击即可离线打开（也可直接发给朋友）
// 用法：npm run build:single  →  dist-single/积木工坊.html
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --mode single', { stdio: 'inherit' });
const dir = 'dist-single';
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dir, href.replace(/^\.\//, '')), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => read(m[1])).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => read(m[1]));
if (scripts.length !== 1) throw new Error(`期望 1 个脚本，实际 ${scripts.length} 个`);
const js = scripts[0].replace(/<\/script/gi, '<\\/script');

// 图标以 data URI 内联，保证单文件可用
const icon = 'data:image/svg+xml;base64,' + fs.readFileSync('public/favicon.svg').toString('base64');
const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
<meta name="description" content="在浏览器里自由搭建 3D 积木作品：57 种零件、54 种颜色、示例作品与搭建回放。" />
<link rel="icon" type="image/svg+xml" href="${icon}" />
<title>积木工坊</title>
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${js}
</script>
</body>
</html>
`;
const out = path.join(dir, '积木工坊.html');
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
