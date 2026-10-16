import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

let staging = false;

export default defineConfig({
  base: "/",
  publicDir: "public",
  server: { port: 5174, strictPort: true },
  plugins: [
    {
      name: 'staging-noindex',
      configResolved(config) { staging = config.mode === 'staging'; },
      generateBundle() {
        if (!staging) return;
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
        this.emitFile({ type: 'asset', fileName: '_headers', source: '/*\n  X-Robots-Tag: noindex, nofollow\n' });
      },
    },
    {
      name: "admin-route-pages",
      async writeBundle(options) {
        if (!options.dir) return;
        for (const route of ["users", "users/detail", "ledger", "acquisition", "email", "email-all", "email-custom"]) {
          const directory = join(options.dir, route);
          await mkdir(directory, { recursive: true });
          await copyFile(join(options.dir, "index.html"), join(directory, "index.html"));
        }
      },
    },
    {
      name: "page-redirects",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const match = request.url?.match(/^\/(privacy|terms|download)(\?.*)?$/);
          if (!match) {
            next();
            return;
          }
          response.writeHead(308, {
            Location: `/${match[1]}/${match[2] ?? ""}`,
          });
          response.end();
        });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        download: fileURLToPath(new URL("./download/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
        terms: fileURLToPath(new URL("./terms/index.html", import.meta.url)),
      },
    },
  },
});
