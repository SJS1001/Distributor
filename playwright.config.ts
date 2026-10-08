import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "browser.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3117",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/browser-server.ts",
    url: "http://127.0.0.1:3117/api/health",
    reuseExistingServer: false,
    // Seeded native fixture fleet can exceed 30 seconds on a shared workstation.
    timeout: 120000,
  },
});
