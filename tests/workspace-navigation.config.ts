import { defineConfig } from "@playwright/test";

// This journey owns its synthetic server; it needs no shared browser fixture fleet.
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-navigation-browser.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
