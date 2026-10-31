import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@winui': fileURLToPath(new URL('./src/components/winui', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // SSE（AI 流式）不能被代理层超时截断：长回答可能持续数分钟
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const url = String(req.url || '');
            // 流式请求不缓存 / 不设超时（兼容旧 action 名 send_stream）
            if (url.includes('action=stream') || url.includes('action=resume') || url.includes('send_stream')) {
              req.setTimeout(0);
              try { proxyReq.setTimeout(0); } catch (_) { /* ignore */ }
              // 关掉 Nagle，保证 token 立即下发
              try { req.socket?.setNoDelay?.(true); } catch (_) { /* ignore */ }
            }
          });
          // SSE 响应不要被压缩/缓冲
          proxy.on('proxyRes', (proxyRes, req) => {
            const url = String(req.url || '');
            if (url.includes('action=stream') || url.includes('action=resume') || url.includes('send_stream')) {
              try { proxyRes.headers['cache-control'] = 'no-cache, no-transform'; } catch (_) { /* ignore */ }
            }
          });
        }
      },
      '/site': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '/exports': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
