import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "shipping-terms-browser-journey.ts",
  workers: 1,
  outputDir: "../test-results/shipping-terms",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3220",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/shipping-terms-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3220/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
