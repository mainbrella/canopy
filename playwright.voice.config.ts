import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "voice.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8792",
    browserName: "chromium",
    launchOptions: process.env.CANOPY_CHROMIUM_PATH ? { executablePath: process.env.CANOPY_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "npm run build:client --workspace @canopy/voice && node products/voice/scripts/test.mjs --browser",
    url: "http://127.0.0.1:8792/__ready",
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
