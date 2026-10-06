import { withRowActions } from "./workspace-navigation.ts";
import {
  expectBuyerLanding,
  navigateBuyerWorkspace,
} from "./commerce-browser-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3134",
  pattern = "**/api/orders/page?*";
async function nav(page: Page, name: string) {
  await navigateBuyerWorkspace(
    page,
    name,
    name === "Orders" ? "Orders" : undefined,
  );
}
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("queue-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectBuyerLanding(page);
  await nav(page, "Overview");
  await expect(
    page
      .locator(".overview-metrics .metric-card")
      .filter({ has: page.getByText("Open orders", { exact: true }) })
      .locator("strong"),
  ).toHaveText("30");
  await nav(page, "Orders");
}
test("browser: phone order queue preserves scoped pages on failure, retries exact cursors, filters and reaches oldest order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const queue = page.getByRole("region", { name: "Order queue", exact: true });
  await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
  await expect(page.getByTitle("queue-044", { exact: true })).toBeVisible();
  await expect(page.getByTitle("queue-000", { exact: true })).toHaveCount(0);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic queue failure" },
      });
    else await route.continue();
  });
  await queue
    .getByRole("button", { name: "Load more orders", exact: true })
    .click();
  await expect(queue.getByRole("alert")).toHaveText("Synthetic queue failure");
  await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
  await expect(
    queue.getByRole("button", { name: "Retry order queue", exact: true }),
  ).toBeFocused();
  await queue
    .getByRole("button", { name: "Retry order queue", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText("40 orders loaded");
  expect(urls[1]).toBe(urls[0]);
  await queue
    .getByRole("button", { name: "Load more orders", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText(
    "45 orders loaded · All results shown",
  );
  await expect(
    queue.getByRole("heading", { name: "Order queue", exact: true }),
  ).toBeFocused();
  await expect(page.getByTitle("queue-000", { exact: true })).toBeVisible();
  await page.unroute(pattern);
  // Opening a row loaded on the third page must use that exact order, not
  // the dashboard's original twenty-row projection.
  const oldest = page.getByRole("row").filter({
    has: page.getByTitle("queue-000", { exact: true }),
  });
  const history = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/orders/queue-000/amendments",
  );
  await (
    await withRowActions(oldest)
  )
    .getByRole("button", { name: "View amendment history", exact: true })
    .click();
  expect((await history).status()).toBe(200);
  await expect(
    page.getByText("No order amendments recorded.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close amendment history", exact: true })
    .click();
  await expect(
    oldest.getByRole("button", { name: "View amendment history", exact: true }),
  ).toBeFocused();
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
  await queue.getByLabel("Order state", { exact: true }).selectOption("closed");
  await expect(queue.getByRole("alert")).toHaveText("Synthetic filter failure");
  await expect(queue.getByRole("status")).toHaveText("0 orders loaded");
  await expect(page.getByTitle("queue-044", { exact: true })).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Retry order queue", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText(
    "15 orders loaded · All results shown",
  );
  await expect(page.getByTitle("queue-042", { exact: true })).toBeVisible();
  await page.unroute(pattern);
  await queue.getByLabel("Order state", { exact: true }).selectOption("open");
  await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
  await expect(page.getByTitle("queue-042", { exact: true })).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Load more orders", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText(
    "30 orders loaded · All results shown",
  );
  await expect(
    page.getByText("Unrelated customer", { exact: true }),
  ).toHaveCount(0);
  // Filters are addressable workspace state, so Refresh reloads the first
  // page of the same filtered queue rather than resetting it.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
  await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
    "open",
  );
  await nav(page, "Overview");
  await expect(
    page
      .locator(".overview-metrics .metric-card")
      .filter({ has: page.getByText("Open orders", { exact: true }) })
      .locator("strong"),
  ).toHaveText("30");
  expect(errors).toEqual([]);
});
test("browser: order queue ignores superseded filters, abandoned navigation, refresh and signed-out continuations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const queue = page.getByRole("region", { name: "Order queue", exact: true });
  let release!: () => void, handled!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (handled = r));
  await page.route(pattern, async (route) => {
    if (new URL(route.request().url()).searchParams.get("state") === "closed") {
      const response = await route.fetch();
      handled();
      await held;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await queue.getByLabel("Order state", { exact: true }).selectOption("closed");
  await started;
  await queue.getByLabel("Order state", { exact: true }).selectOption("open");
  await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
  release();
  await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
    "open",
  );
  await expect(page.getByTitle("queue-042", { exact: true })).toHaveCount(0);
  await page.unroute(pattern);
  for (const action of ["navigate", "refresh", "sign-out"]) {
    if (action !== "navigate") {
      await nav(page, "Orders");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
    }
    let finish!: () => void, called!: () => void, done!: () => void;
    const wait = new Promise<void>((r) => (finish = r)),
      received = new Promise<void>((r) => (called = r)),
      completed = new Promise<void>((r) => (done = r));
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      called();
      await wait;
      try {
        await route.fulfill({ response });
      } catch {
      } finally {
        done();
      }
    });
    await queue
      .getByRole("button", { name: "Load more orders", exact: true })
      .click();
    await received;
    if (action === "navigate") await nav(page, "Overview");
    else if (action === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    finish();
    await completed;
    await page.unroute(pattern);
    if (action === "navigate") {
      await nav(page, "Orders");
      await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
    } else if (action === "refresh")
      await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
    else {
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await login(page);
      await expect(queue.getByRole("status")).toHaveText("20 orders loaded");
    }
  }
});
