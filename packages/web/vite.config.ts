import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 默认约定 :5177；PORT 环境变量优先（预览工具占用冲突时自动分配新端口）
    port: Number(process.env.PORT ?? 5177),
    proxy: {
      '/api': 'http://localhost:4177',
    },
  },
});
