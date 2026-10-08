import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "system-polish-customer-browser.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../local-evidence/system-polish-customer",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
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
  },
});
