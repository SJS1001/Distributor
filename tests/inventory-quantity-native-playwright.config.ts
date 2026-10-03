import { defineConfig } from "@playwright/test";

// The test group owns its isolated native SQLite/HTTP fixture lifecycle.
export default defineConfig({
  testDir: ".",
  testMatch: "inventory-quantity-native-browser.ts",
  workers: 1,
  timeout: 60000,
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
});
