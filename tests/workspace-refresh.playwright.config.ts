import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-refresh-browser.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../local-evidence/workspace-refresh-2026-10-07",
  use: { baseURL: "http://127.0.0.1:3224", headless: true },
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command: "npx vite --host 127.0.0.1 --port 3224 --strictPort",
    url: "http://127.0.0.1:3224/tests/workspace-refresh-harness.html",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
