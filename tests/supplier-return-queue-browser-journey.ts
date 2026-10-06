import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
const origin = "http://127.0.0.1:3143",
  pattern = "**/api/purchases/returns/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Purchasing" ? "Receipts & returns" : undefined,
  );
}
async function login(page: Page, role = "warehouse") {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`return-queue-${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Purchasing");
}
const queue = (page: Page) =>
  page.getByRole("region", { name: "Supplier return queue", exact: true });
async function search(page: Page, q: string) {
  await queue(page)
    .getByLabel("Search supplier returns", { exact: true })
    .fill(q);
  await queue(page)
    .getByRole("button", { name: "Search returns", exact: true })
    .click();
}
test("browser: phone supplier return pages preserve scope, retry exact cursor, search old returns and retain history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const region = queue(page);
  await expect(region.getByRole("status")).toHaveText(
    "20 supplier returns loaded",
  );
  await expect(page.getByText("QUEUE-000", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/OTHER-0/)).toHaveCount(0);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic supplier queue failure" },
      });
    else await route.continue();
  });
  await region
    .getByRole("button", { name: "Load more supplier returns", exact: true })
    .click();
  await expect(region.getByRole("status")).toHaveText(
    "20 supplier returns loaded",
  );
  await expect(region.getByRole("alert")).toHaveText(
    "Synthetic supplier queue failure",
  );
  await expect(
    region.getByRole("button", {
      name: "Retry supplier return queue",
      exact: true,
    }),
  ).toBeFocused();
  await region
    .getByRole("button", { name: "Retry supplier return queue", exact: true })
    .press("Enter");
  await expect(region.getByRole("status")).toHaveText(
    "40 supplier returns loaded",
  );
  expect(urls[0]).toBe(urls[1]);
  await region
    .getByRole("button", { name: "Load more supplier returns", exact: true })
    .click();
  await expect(region.getByRole("status")).toHaveText(
    "45 supplier returns loaded",
  );
  await expect(region.getByRole("heading")).toBeFocused();
  await page.unroute(pattern);
  await search(page, "%_");
  await expect(region.getByRole("status")).toHaveText(
    "1 supplier return loaded",
  );
  const row = page
    .getByRole("row")
    .filter({ has: page.getByText("QUEUE-000", { exact: true }) });
  await row
    .getByRole("button", { name: "Supplier history", exact: true })
    .click();
  const history = page.getByRole("region", {
    name: "Supplier follow-up history",
    exact: true,
  });
  await expect(history.getByRole("heading")).toBeFocused();
  await expect(
    history.getByText(
      "No supplier outcomes recorded. Follow-up remains open.",
      { exact: true },
    ),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Close supplier history", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Supplier history", exact: true }),
  ).toBeFocused();
  await expect(row.locator("details.stock-actions")).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Record supplier credit", exact: true }),
  ).toHaveCount(0);
  await search(page, "missing");
  await expect(region.getByRole("status")).toHaveText(
    "0 supplier returns loaded",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(region.getByRole("status")).toHaveText(
    "20 supplier returns loaded",
  );
  await expect(region.getByLabel("Search supplier returns")).toHaveValue("");
  expect(errors).toEqual([]);
});
test("browser: supplier return search discards superseded and abandoned responses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const action of ["search", "navigate", "refresh", "sign-out"]) {
    let release!: () => void, started!: () => void, completed!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      received = new Promise<void>((r) => (started = r)),
      done = new Promise<void>((r) => (completed = r));
    await page.route(pattern, async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "QUEUE-000")
        return route.continue();
      const response = await route.fetch();
      started();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
      } finally {
        completed();
      }
    });
    await search(page, "QUEUE-000");
    await received;
    if (action === "search") {
      await search(page, "QUEUE-044");
      await expect(queue(page).getByRole("status")).toHaveText(
        "1 supplier return loaded",
      );
    } else if (action === "navigate") await nav(page, "Overview");
    else
      await page
        .getByRole("button", {
          name: action === "refresh" ? "Refresh" : "Sign out",
          exact: true,
        })
        .click();
    release();
    await done;
    await page.unroute(pattern);
    if (action === "search") {
      await expect(page.getByText("QUEUE-000", { exact: true })).toHaveCount(0);
      await expect(page.getByText("QUEUE-044", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    } else if (action === "navigate") await nav(page, "Purchasing");
    else if (action === "sign-out") {
      // Let sign-out finish before opening sign-in; a still-signed-in
      // workspace otherwise normalizes #sign-in to Overview.
      await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
      ).toHaveCount(0);
      await login(page);
    }
    await expect(queue(page).getByRole("status")).toHaveText(
      "20 supplier returns loaded",
    );
    await expect(page.getByText("QUEUE-000", { exact: true })).toHaveCount(0);
  }
});
test("browser: finance searches an old return, records native credit and reopens retained outcome history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "finance");
  await search(page, "QUEUE-000");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByText("QUEUE-000", { exact: true }) });
  await openStockActions(row);
  await row
    .getByRole("button", { name: "Record supplier credit", exact: true })
    .click();
  await page
    .getByLabel("Supplier credit amount (cents)", { exact: true })
    .fill("300");
  await page
    .getByLabel("Supplier follow-up reference (unique)", { exact: true })
    .fill("QUEUE-CREDIT");
  await page
    .getByLabel("Supplier outcome / review evidence", { exact: true })
    .fill("Synthetic reviewed credit document");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await search(page, "QUEUE-000");
  await expect(row).toContainText("CA$3.00 supplier credit recorded");
  await row
    .getByRole("button", { name: "Supplier history", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Supplier follow-up history",
      exact: true,
    }),
  ).toContainText("QUEUE-CREDIT");
  const response = await page.request.get(
    `${origin}/api/purchases/returns/page?q=QUEUE-000`,
  );
  expect(response.status()).toBe(200);
  const r = (await response.json()).items[0];
  expect(r.followup.creditAmount).toBe(300);
  expect(r.followup.originalCost).toBe(250);
});
