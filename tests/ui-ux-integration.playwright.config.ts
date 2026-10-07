import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "ui-ux-integration-browser.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../local-evidence/ui-ux-fixes-2026-10-07/integration-browser",
  use: {
    baseURL: "http://127.0.0.1:3217",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/ui-ux-integration-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3217/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
