import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "cost-correction-browser-journey.ts",
    "invoice-queue-browser-journey.ts",
    "pdf-browser-journey.ts",
  ],
  globalSetup: "./billing-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
