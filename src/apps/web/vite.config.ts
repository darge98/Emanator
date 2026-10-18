import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      // Keep the browser's Host, so the Harness sees a same-origin request and accepts writes.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
