/// <reference types="vitest/config" />
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** 构建完成后给 Service Worker 写入版本号，确保每次部署都会刷新离线缓存 */
function swVersion(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      const id = Date.now().toString(36);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('__BUILD_ID__', id));
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), tailwindcss(), swVersion()],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      ...(single
        ? {
            // 单文件版：所有代码打成一个模块，随后由 scripts/build-single.mjs 内联进 HTML
            outDir: 'dist-single',
            cssCodeSplit: false,
            modulePreload: false,
            assetsInlineLimit: 100_000_000,
            copyPublicDir: false,
          }
        : {
            rollupOptions: {
              output: {
                // three.js 单独成块，便于浏览器长期缓存
                manualChunks(id: string) {
                  if (id.includes('node_modules/three/') || id.includes('node_modules/n8ao/')) return 'three';
                  if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
                },
              },
            },
          }),
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      // 大型示例作品的体素雕刻较慢
      testTimeout: 30_000,
    },
  };
});
