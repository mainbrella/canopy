import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/message-board-api': {
        target: 'https://api.mainbrella.com',
        changeOrigin: true,
        headers: { origin: 'https://mainbrella.com' },
        rewrite: path => path.replace(/^\/message-board-api/, ''),
      },
    },
  },
});
