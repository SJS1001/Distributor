import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "stock-journal-browser-journey.ts",
    "stock-journal-preparation-browser.ts",
    "stock-journal-permissions-browser.ts",
    "stock-journal-cancellation-browser.ts",
    "stock-journal-reconciliation-browser.ts",
    "stock-journal-original-cancellation-browser.ts",
    "stock-journal-original-retry-browser.ts",
    "stock-journal-retry-follow-up-browser.ts",
    "cost-correction-successor-browser.ts",
  ],
  globalSetup: "./journal-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
