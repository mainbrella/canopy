import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    // Google's localhost popup flow needs the origin even on HTTP development pages.
    headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
    proxy: { "/auth": { target: "http://127.0.0.1:8789" } },
  },
});
