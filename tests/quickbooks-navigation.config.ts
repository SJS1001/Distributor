import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "quickbooks-browser-journey.ts",
    "organization-quickbooks-browser-journey.ts",
    "organization-revocation-browser-journey.ts",
  ],
  globalSetup: "./quickbooks-navigation-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
