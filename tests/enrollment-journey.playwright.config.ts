import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "enrollment-journey-browser.ts",
  workers: 1,
  timeout: 45000,
  outputDir: "../local-evidence/enrollment-journey-2026-10-07/playwright",
  use: {
    baseURL: "http://127.0.0.1:3139",
    headless: true,
    trace: "off",
    screenshot: "off",
  },
  projects: ["chromium", "webkit"].flatMap((browserName) =>
    [1440, 390, 320].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width, height: 844 },
      },
    })),
  ),
  webServer: {
    command: "tsx tests/enrollment-journey-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3139/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
