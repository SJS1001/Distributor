import { test, expect, type Page } from "@playwright/test";
import { expectSessionsEndedAtSignIn } from "./browser-spec-a-support.ts";

const ended = "Your session has ended. Sign in again.";

async function signIn(page: Page, email: string, home: string) {
  await page.goto("/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: home, exact: true }),
  ).toBeVisible();
}

// The server no longer accepts the cookie, as after expiry or revocation.
// The next ordinary read must leave the workspace without a full reload.
test("a session the server refuses returns staff and buyers to sign-in", async ({
  browser,
}) => {
  for (const [email, home, entrance] of [
    ["admin@example.test", "Overview", "Administration sign in."],
    ["history-buyer@example.test", "Shop", "Customer sign in."],
  ] as const) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await signIn(page, email, home);
      // Let the landing page finish its reads, so the next read is ours.
      await page.waitForLoadState("networkidle");
      await context.clearCookies();
      // Navigate inside the open workspace, as a menu link does; a full
      // reload would only show the signed-out site, which proves nothing.
      const destination = `#page=${home === "Shop" ? "Orders" : "Customers"}`;
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, destination);
      await expectSessionsEndedAtSignIn(page, ended);
      await expect(
        page.getByRole("heading", { name: entrance, exact: true }),
      ).toBeVisible();
      // One notice only; the refused read does not add its own error.
      await expect(page.getByRole("alert")).toHaveCount(0);
      // A wrong password there is a login error; it never adds a second
      // session-ended notice (the existing one stays until sign-in).
      await page
        .getByLabel("Email", { exact: true })
        .fill("unknown-session-user@example.test");
      await page
        .getByLabel("Password", { exact: true })
        .fill("not-the-test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText(/Invalid credentials\./)).toBeVisible();
      await expect(page.getByText(ended, { exact: true })).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
