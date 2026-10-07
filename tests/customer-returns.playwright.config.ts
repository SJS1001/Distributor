import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "customer-returns-browser.ts",
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  timeout: 60000,
  outputDir: "../test-results/customer-returns",
  use: { baseURL: "http://127.0.0.1:3230", headless: true },
  webServer: {
    command: "tsx tests/customer-returns-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3230/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
