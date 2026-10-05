import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "public-site-browser-journey.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3125",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx tests/public-site-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3125/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
