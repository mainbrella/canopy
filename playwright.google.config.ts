import { defineConfig } from "@playwright/test";
import base, { localStack } from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testMatch: "google.spec.ts",
  outputDir: "test-results/google",
  webServer: {
    ...localStack,
    env: { VITE_GOOGLE_CLIENT_ID: "canopy-browser-test.apps.googleusercontent.com" },
  },
});
