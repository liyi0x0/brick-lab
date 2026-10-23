/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), tailwindcss()],
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
