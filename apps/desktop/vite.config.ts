import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  // 「关于」页版本号单一来源 = package.json（此前硬编码 v0.1.0 长期失真）
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173 },
  // v5.8.0：Whisper ASR worker 为 ES module（动态 import 分包）
  worker: { format: 'es' },
});
