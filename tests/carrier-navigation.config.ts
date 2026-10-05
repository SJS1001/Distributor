import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "canada-post-browser-journey.ts",
    "dhl-warehouse-browser-journey.ts",
    "carrier-configuration-browser-journey.ts",
    "carrier-claim-browser-journey.ts",
    "replacement-carrier-browser-journey.ts",
    "shipment-coverage-browser-journey.ts",
  ],
  globalSetup: "./carrier-navigation-setup.ts",
  workers: 1,
  timeout: 60000,
  use: { headless: true, trace: "retain-on-failure" },
});
