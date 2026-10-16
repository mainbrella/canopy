import { resolve } from "node:path";
import { defineConfig } from "vite";

const basePath = process.env.VOICE_BASE_PATH ?? "";
if (basePath !== "" && basePath !== "/installed/voice") throw new Error("Invalid Voice build mount.");
export default defineConfig({
  base: basePath ? `${basePath}/` : "/",
  build: {
    outDir: "dist/client",
    rollupOptions: { input: { app: resolve("index.html"), login: resolve("login.html"), handoff: resolve("handoff.html") } },
  },
});
