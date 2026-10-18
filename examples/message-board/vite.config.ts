import { defineConfig } from 'vite';
import { localDemoConfig } from './src/config';

export default defineConfig(({ mode }) => ({
  base: './',
  esbuild: { jsx: 'automatic' },
  server: {
    proxy: {
      '/message-board-api': {
        target: mode === 'local-api' ? localDemoConfig.apiOrigin : 'https://api.mainbrella.com',
        changeOrigin: true,
        headers: { origin: mode === 'local-api' ? 'http://localhost:5173' : 'https://mainbrella.com' },
        rewrite: path => path.replace(/^\/message-board-api/, ''),
      },
    },
  },
}));
