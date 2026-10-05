import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/customer-catalog-discovery",
  testMatch: "customer-catalog-discovery-browser-journey.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3216",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "STOREFRONT_DISCOVERY=1 tsx tests/storefront-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3216/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
