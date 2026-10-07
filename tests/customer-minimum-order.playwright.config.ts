import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "customer-minimum-order-browser-journey.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../test-results/customer-minimum-order",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  use: {
    baseURL: "http://127.0.0.1:3254",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/customer-minimum-order-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3254/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
