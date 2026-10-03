import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "inventory-quantity-browser.ts",
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:3311",
    headless: true,
    launchOptions: process.env.DISTRIBUTOR_QUANTITY_CHROMIUM
      ? {
          executablePath: process.env.DISTRIBUTOR_QUANTITY_CHROMIUM,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3311 --strictPort",
    url: "http://127.0.0.1:3311/tests/inventory-quantity-harness.html",
    reuseExistingServer: false,
  },
  outputDir: "/tmp/distributor-quantity-browser",
});
