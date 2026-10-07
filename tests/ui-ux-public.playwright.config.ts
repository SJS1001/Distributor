import { defineConfig } from "@playwright/test";
import publicConfig from "./public-site.playwright.config.ts";
export default defineConfig({
  ...publicConfig,
  testMatch: "ui-ux-public-browser.ts",
});
