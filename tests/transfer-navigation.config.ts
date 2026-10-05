import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "transfer-queue-browser-journey.ts",
    "transfer-arrival-browser-journey.ts",
    "transfer-dispatch-browser-journey.ts",
    "transfer-loss-browser-journey.ts",
  ],
  globalSetup: "./transfer-browser-setup.ts",
  workers: 1,
  timeout: 30000,
  use: { headless: true, trace: "retain-on-failure" },
});
