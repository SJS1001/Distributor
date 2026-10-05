import { defineConfig } from "@playwright/test";
import base from "../playwright.config.ts";

// Shared journeys use the original synthetic fixture fleet. Allow its full
// startup without changing individual workflow timeouts or using CI runners.
export default defineConfig({
  ...base,
  testDir: ".",
  webServer: {
    command: "tsx tests/browser-server.ts",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:3117/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
