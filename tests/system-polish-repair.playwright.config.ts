import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "system-polish-repair-browser.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../local-evidence/system-polish-repair",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: { headless: true, trace: "retain-on-failure" },
});
