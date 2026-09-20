import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/static/react/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'static/react',
    emptyOutDir: true,
  },
});
