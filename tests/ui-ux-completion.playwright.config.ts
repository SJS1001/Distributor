import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "ui-ux-completion-browser.ts",
  workers: 1,
  timeout: 45000,
  outputDir: "../local-evidence/ui-ux-completion-2026-10-07/artifacts",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "local-evidence/ui-ux-completion-2026-10-07/results.json" },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3237",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-emulation", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "tsx tests/ui-ux-completion-browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3237/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
