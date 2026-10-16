import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { siteChromePlugin } from './scripts/site-chrome-plugin.ts';

export default defineConfig({
  base: '/',
  // Import just the builder's CSS and images; do not copy the public site.
  publicDir: false,
  plugins: [siteChromePlugin({ bundleAssets: true })],
  build: {
    outDir: 'dist-builder',
    emptyOutDir: true,
    assetsDir: 'build/assets',
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    manifest: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./build/index.html', import.meta.url)),
    },
  },
});
