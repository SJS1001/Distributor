import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "cart-recovery-browser-journey.ts",
    "claim-queue-browser-journey.ts",
    "coverage-policy-browser-journey.ts",
    "customer-pricing-browser-journey.ts",
    "operations-health-browser-journey.ts",
    "order-queue-browser-journey.ts",
    "reconciliation-browser-journey.ts",
    "retired-receiving-browser-journey.ts",
  ],
  globalSetup: "./remaining-navigation-setup.ts",
  workers: 1,
  timeout: 60000,
  use: { headless: true, trace: "retain-on-failure" },
});
