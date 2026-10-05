import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "incoming-supply-browser-journey.ts",
  globalSetup: "./incoming-supply-browser-setup.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3191",
    headless: true,
    trace: "retain-on-failure",
  },
});
