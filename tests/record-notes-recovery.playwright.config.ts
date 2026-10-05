import { defineConfig } from "@playwright/test";
import notes from "./record-notes.playwright.config.ts";
export default defineConfig({
  ...notes,
  testMatch: "record-notes-recovery-browser-journey.ts",
  outputDir: "../test-results/record-notes-recovery",
});
