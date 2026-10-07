import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "ui-ux-staff-browser.ts",
  workers: 1,
  timeout: 30000,
  outputDir: "../local-evidence/ui-ux-fixes-2026-10-07/staff-browser",
  use: { baseURL: "http://127.0.0.1:3217", headless: true },
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command: "npx vite --host 127.0.0.1 --port 3217 --strictPort",
    url: "http://127.0.0.1:3217/tests/ui-ux-staff-harness.html",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
