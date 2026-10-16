import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5175",
    browserName: "chromium",
    launchOptions: process.env.CANOPY_CHROMIUM_PATH ? { executablePath: process.env.CANOPY_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "node scripts/dev.mjs",
    url: "http://127.0.0.1:5175/auth/me",
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
