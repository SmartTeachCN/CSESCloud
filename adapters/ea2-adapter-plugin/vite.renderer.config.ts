import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  return {
    define: {
      __DEV__: !isProd,
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    },
    plugins: [vue()],
    base: './',
    build: {
      emptyOutDir: false,
      outDir: 'dist/renderer',
      sourcemap: !isProd,
      minify: false,
      cssCodeSplit: false,
      target: 'esnext',
      lib: {
        entry: resolve(__dirname, 'src/renderer/main.mjs'),
        fileName: () => 'index.mjs',
        formats: ['es'],
      },
      rollupOptions: {
        external: [],
        output: {
          format: 'es',
          entryFileNames: 'index.mjs',
          inlineDynamicImports: true,
        },
      },
    },
  };
});