import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-layout-browser.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../test-results/workspace-layout",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { headless: true, trace: "retain-on-failure" },
});
