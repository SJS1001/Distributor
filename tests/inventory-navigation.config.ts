import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "stock-history-browser-journey.ts",
    "stock-queue-browser-journey.ts",
    "count-queue-browser-journey.ts",
  ],
  globalSetup: "./inventory-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
