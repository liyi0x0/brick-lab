// 打包单文件演示版（用于发布为 Claude Artifact）：
// 构建 artifact 模式，把 JS / CSS 内联，输出不含 <html>/<head>/<body> 的页面片段
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --mode artifact', { stdio: 'inherit' });
const dir = 'dist-artifact';
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dir, href.replace(/^\.\//, '')), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => read(m[1])).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => read(m[1]));
if (scripts.length !== 1) throw new Error(`期望 1 个脚本，实际 ${scripts.length} 个`);
const js = scripts[0].replace(/<\/script/gi, '<\\/script');

const page = `<title>积木工坊</title>
<meta name="description" content="在浏览器里自由搭建 3D 积木作品：57 种零件、54 种颜色、示例作品与搭建回放。" />
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
const out = path.join(dir, 'brick-lab.html');
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
