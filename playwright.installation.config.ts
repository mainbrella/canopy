import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/browser",testMatch:"installation.spec.ts",fullyParallel:false,workers:1,
  use:{baseURL:"http://127.0.0.1:5175",browserName:"chromium",launchOptions:process.env.CANOPY_CHROMIUM_PATH?{executablePath:process.env.CANOPY_CHROMIUM_PATH}:{}},
  webServer:[{
    command:"npm run build:client --workspace @canopy/voice && node scripts/test-voice-installation.mjs",
    url:"http://127.0.0.1:8793/products/voice",reuseExistingServer:false,timeout:60000,gracefulShutdown:{signal:"SIGTERM",timeout:5000},
  },{
    command:"npm run dev --workspace @canopy/console",url:"http://127.0.0.1:5175",reuseExistingServer:false,timeout:60000,
    env:{VITE_AUTH_BASE_URL:"http://127.0.0.1:8793",VITE_GOOGLE_CLIENT_ID:""},gracefulShutdown:{signal:"SIGTERM",timeout:5000},
  }],
});
