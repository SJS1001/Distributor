import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "purchase-entry-browser-journey.ts",
    "purchase-queue-browser-journey.ts",
    "receipt-history-browser-journey.ts",
    "supplier-availability-browser-journey.ts",
    "supplier-return-queue-browser-journey.ts",
  ],
  globalSetup: "./purchasing-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3117",
    headless: true,
    trace: "retain-on-failure",
  },
});
