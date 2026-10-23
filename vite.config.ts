/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    define: { __ARTIFACT__: JSON.stringify(artifact) },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      ...(artifact
        ? {
            // 单文件演示版：所有代码打成一个模块，随后内联进 HTML
            outDir: 'dist-artifact',
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
    },
  };
});
