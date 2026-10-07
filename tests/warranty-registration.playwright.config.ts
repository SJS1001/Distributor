import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "warranty-registration-browser.ts",
  workers: 1,
  timeout: 90000,
  outputDir: "../test-results/warranty-registration",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { headless: true, trace: "retain-on-failure" },
});
