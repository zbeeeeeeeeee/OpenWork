import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const appInfo = JSON.parse(readFileSync(resolve(__dirname, '../../app-info.json'), 'utf-8'));

const configPath = resolve(__dirname, '../../app-config.json');
const appConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
const serverPort = appConfig.serverPort || 20385;

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'), // @/ → src/ 路径别名
      // agent dist 为 CJS，Vite ESM 命名导出 interop 不可靠；展示清洗是纯函数，直接走 TS 源码
      '@openwork/agent/sanitize': resolve(__dirname, '../agent/src/sanitize.ts'),
    },
  },
  define: {
    __APP_INFO__: JSON.stringify(appInfo),
    __SERVER_PORT__: serverPort,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
  base: './', // 相对路径基准（适配 Electron 的 file:// 协议）
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: (id: string) => id.includes('@modelcontextprotocol/sdk'),
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'], // 预构建 monaco-editor 以加速冷启动
    exclude: ['async-validator', '@openwork/agent'],
  },
  worker: {
    format: 'es', // Web Worker 使用 ES 模块格式
  },
});
