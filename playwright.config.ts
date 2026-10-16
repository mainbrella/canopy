import { defineConfig } from "@playwright/test";

export const localStack = {
  command: "node scripts/dev.mjs",
  url: "http://127.0.0.1:5175/auth/me",
  reuseExistingServer: false,
  timeout: 60_000,
  gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5000 },
};

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["account.spec.ts", "console.spec.ts"],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5175",
    browserName: "chromium",
    launchOptions: process.env.CANOPY_CHROMIUM_PATH ? { executablePath: process.env.CANOPY_CHROMIUM_PATH } : {},
  },
  webServer: {
    ...localStack,
    env: { VITE_GOOGLE_CLIENT_ID: "" },
  },
});
