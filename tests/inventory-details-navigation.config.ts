import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "serial-dossier-browser-journey.ts",
    "bin-relocation-browser-journey.ts",
    "count-policy-browser-journey.ts",
    "count-recovery-browser-journey.ts",
    "inventory-valuation-browser.ts",
    "inventory-quantity-native-browser.ts",
  ],
  globalSetup: "./inventory-details-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
