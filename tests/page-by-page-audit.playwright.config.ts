import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "page-by-page-audit-browser.ts",
  workers: 1,
  timeout: 240000,
  outputDir: "../test-results/page-by-page-audit",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: {
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
  },
});
