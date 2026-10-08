import {
  navigateCustomerWorkspace,
  navigateWorkspace,
} from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3130";
const pattern = "**/api/warranty/claims/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(page, name, name === "Orders" ? "Orders" : undefined);
}
async function login(page: Page, email = "admin@example.test", buyer = false) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Staff land on Overview; buyers land on Shop.
  await expect(
    page.getByRole("heading", {
      name: buyer ? "Shop" : "Overview",
      exact: true,
    }),
  ).toBeVisible();
  if (buyer) await buyerNav(page, "Returns");
  else await nav(page, "Returns");
}
// Buyers reach Returns directly from the customer header; the shared helper
// follows the visible desktop navigation or collapsed phone menu.
async function buyerNav(page: Page, name: "Reports" | "Returns") {
  await navigateCustomerWorkspace(
    page,
    name === "Reports" ? "Overview" : "Returns",
  );
}
test("browser: phone claim queue retains pages on failure, retries the same cursor, filters states and reaches the oldest claim", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const queue = page.getByRole("region", { name: "Claim queue", exact: true });
  await expect(queue.getByRole("status")).toHaveText("20 claims loaded");
  await expect(page.getByText("queue issue 44", { exact: true })).toBeVisible();
  await expect(page.getByText("queue issue 00", { exact: true })).toHaveCount(
    0,
  );
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic queue read failure" },
      });
    else await route.continue();
  });
  await queue
    .getByRole("button", { name: "Load more claims", exact: true })
    .click();
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic queue read failure",
  );
  await expect(queue.getByRole("status")).toHaveText("20 claims loaded");
  await expect(
    queue.getByRole("button", { name: "Retry claim queue", exact: true }),
  ).toBeFocused();
  await queue
    .getByRole("button", { name: "Retry claim queue", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText("40 claims loaded");
  expect(urls[1]).toBe(urls[0]);
  await queue
    .getByRole("button", { name: "Load more claims", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText("45 claims loaded");
  await expect(
    queue.getByRole("heading", { name: "Claim queue", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("queue issue 00", { exact: true })).toBeVisible();
  await expect(
    queue.getByRole("button", { name: "All claims loaded", exact: true }),
  ).toBeDisabled();
  await page.unroute(pattern);
  let failed = false;
  await page.route(pattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic filter failure" },
      });
    } else await route.continue();
  });
  await queue
    .getByLabel("Claim state", { exact: true })
    .selectOption("rejected");
  await expect(queue.getByRole("alert")).toHaveText("Synthetic filter failure");
  await expect(queue.getByRole("status")).toHaveText("0 claims loaded");
  await expect(page.getByText("queue issue 44", { exact: true })).toHaveCount(
    0,
  );
  await queue
    .getByRole("button", { name: "Retry claim queue", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText("15 claims loaded");
  await expect(page.getByText("queue issue 42", { exact: true })).toBeVisible();
  await queue
    .getByLabel("Claim state", { exact: true })
    .selectOption("submitted");
  await expect(queue.getByRole("status")).toHaveText("20 claims loaded");
  await expect(page.getByText("queue issue 42", { exact: true })).toHaveCount(
    0,
  );
  await queue
    .getByRole("button", { name: "Load more claims", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText("30 claims loaded");
  await queue.getByLabel("Claim state", { exact: true }).selectOption("repair");
  await expect(queue.getByRole("status")).toHaveText("0 claims loaded");
  await expect(
    queue.getByRole("button", { name: "All claims loaded", exact: true }),
  ).toBeDisabled();
  await page.unroute(pattern);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("browser: claim queue cancels reads on filter change, refresh, navigation and sign-out; buyer sees only current account claims", async ({
  page,
}) => {
  await login(page, "queue-buyer@example.test", true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const queue = page.getByRole("region", { name: "Claim queue", exact: true });
  await expect(queue.getByRole("status")).toHaveText("20 claims loaded");
  await expect(
    page.getByRole("region", {
      name: "Manufacturer case history",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const exit of ["filter", "refresh", "navigation", "signout"] as const) {
    let release!: () => void, handled!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      done = new Promise<void>((r) => {
        handled = r;
      });
    let first = true;
    await page.route(pattern, async (route) => {
      if (!first) {
        await route.continue();
        return;
      }
      first = false;
      await held;
      handled();
    });
    const started = page.waitForRequest((r) =>
      r.url().includes("/api/warranty/claims/page"),
    );
    await queue
      .getByRole("button", { name: "Load more claims", exact: true })
      .click();
    const pending = await started,
      cancelled = page.waitForEvent("requestfailed", (r) => r === pending);
    if (exit === "filter")
      await queue
        .getByLabel("Claim state", { exact: true })
        .selectOption("rejected");
    else if (exit === "refresh")
      await page
        .getByRole("button", { name: "Refresh", exact: true })
        .press("Enter");
    else if (exit === "navigation") await buyerNav(page, "Reports");
    else
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .press("Enter");
    await cancelled;
    release();
    await done;
    await page.unroute(pattern);
    if (exit === "filter") {
      await expect(queue.getByRole("status")).toHaveText("15 claims loaded");
      await queue.getByLabel("Claim state", { exact: true }).selectOption("");
    } else if (exit === "refresh")
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
    else if (exit === "navigation") await buyerNav(page, "Returns");
    else {
      // Signing out of a workspace page now returns to the public site.
      await expect(
        page.getByRole("navigation", {
          name: "Public navigation",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
      ).toHaveCount(0);
    }
    if (exit !== "signout")
      await expect(queue.getByRole("status")).toHaveText("20 claims loaded");
  }
  expect(errors).toEqual([]);
});
