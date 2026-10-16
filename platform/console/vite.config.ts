import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "operator") {
    const url = new URL(process.env.CANOPY_ACCOUNTS_ORIGIN || "");
    if (url.protocol !== "https:" || url.origin !== process.env.CANOPY_ACCOUNTS_ORIGIN) throw new Error("Operator builds require an explicit HTTPS CANOPY_ACCOUNTS_ORIGIN.");
  }
  return ({
  // Staging cannot inherit a local Google client or point at the production API.
  define: mode === "staging" ? {
    "import.meta.env.VITE_AUTH_BASE_URL": JSON.stringify("https://api-stg.mainbrella.com"),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(""),
    "import.meta.env.VITE_PRODUCT_SELECTION": JSON.stringify("compute,builder,voice,cut"),
  } : mode === "operator" ? {
    "import.meta.env.VITE_AUTH_BASE_URL": JSON.stringify(process.env.CANOPY_ACCOUNTS_ORIGIN),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(""),
    "import.meta.env.VITE_PRODUCT_SELECTION": JSON.stringify(process.env.CANOPY_PRODUCTS || ""),
    "import.meta.env.VITE_INSTANCE_NAME": JSON.stringify(process.env.CANOPY_INSTANCE_NAME || "Canopy"),
  } : {},
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    // Google's localhost popup flow needs the origin even on HTTP development pages.
    headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
    proxy: { "/auth": { target: "http://127.0.0.1:8789" }, "/products": { target: "http://127.0.0.1:8789" } },
  },
  });
});
