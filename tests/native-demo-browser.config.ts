import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "native-demo-browser-journey.ts",
  workers: 1,
  timeout: 60000,
  use: { headless: true, trace: "retain-on-failure" },
});
