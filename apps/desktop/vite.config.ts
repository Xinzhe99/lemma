import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // v5.8.0：Whisper ASR worker 为 ES module（动态 import 分包）
  worker: { format: 'es' },
});
