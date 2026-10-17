import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
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
