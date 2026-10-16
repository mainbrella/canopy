import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // Staging cannot inherit a local Google client or point at the production API.
  define: mode === "staging" ? {
    "import.meta.env.VITE_AUTH_BASE_URL": JSON.stringify("https://api-stg.mainbrella.com"),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(""),
  } : {},
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    // Google's localhost popup flow needs the origin even on HTTP development pages.
    headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
    proxy: { "/auth": { target: "http://127.0.0.1:8789" } },
  },
}));
