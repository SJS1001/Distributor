import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "customer-record-browser-journey.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3261",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/customer-record-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3261/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
