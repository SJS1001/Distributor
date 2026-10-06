import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
const origin = "http://127.0.0.1:3135",
  pattern = "**/api/purchases/orders/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Purchasing" ? "Purchase orders" : undefined,
  );
}
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("purchasing@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Purchasing");
}
test("browser: phone purchase queue preserves scoped pages on failure, retries exact cursors, filters and reaches oldest order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const queue = page.getByRole("region", {
    name: "Purchase order queue",
    exact: true,
  });
  await expect(queue.getByRole("status")).toHaveText(
    "20 purchase orders loaded",
  );
  await expect(
    page.getByTitle("purchase-queue-044", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTitle("purchase-queue-000", { exact: true }),
  ).toHaveCount(0);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic purchase queue failure" },
      });
    else await route.continue();
  });
  await queue
    .getByRole("button", { name: "Load more purchase orders", exact: true })
    .click();
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic purchase queue failure",
  );
  await expect(queue.getByRole("status")).toHaveText(
    "20 purchase orders loaded",
  );
  await expect(
    queue.getByRole("button", {
      name: "Retry purchase order queue",
      exact: true,
    }),
  ).toBeFocused();
  await queue
    .getByRole("button", { name: "Retry purchase order queue", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText(
    "40 purchase orders loaded",
  );
  expect(urls[1]).toBe(urls[0]);
  await queue
    .getByRole("button", { name: "Load more purchase orders", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText(
    "46 purchase orders loaded · All results shown",
  );
  await expect(
    queue.getByRole("heading", {
      name: "Purchase order queue",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByTitle("purchase-queue-000", { exact: true }),
  ).toBeVisible();
  await page.unroute(pattern);
  // Start receiving from a loaded older header, using its exact line.
  const oldestOpen = page
    .getByRole("row")
    .filter({ has: page.getByTitle("purchase-queue-001", { exact: true }) });
  await oldestOpen
    .getByRole("button", { name: "Start receipt draft", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Purchase line", { exact: true })).toHaveValue(
    "purchase-queue-001-line",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  let failed = false;
  await page.route(pattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic purchase filter failure" },
      });
    } else await route.continue();
  });
  await queue
    .getByLabel("Purchase order state", { exact: true })
    .selectOption("received");
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic purchase filter failure",
  );
  await expect(queue.getByRole("status")).toHaveText(
    "0 purchase orders loaded",
  );
  await expect(
    page.getByTitle("purchase-queue-044", { exact: true }),
  ).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Retry purchase order queue", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText(
    "16 purchase orders loaded · All results shown",
  );
  await expect(
    page.getByTitle("purchase-queue-042", { exact: true }),
  ).toBeVisible();
  await page.unroute(pattern);
  await queue
    .getByLabel("Purchase order state", { exact: true })
    .selectOption("open");
  await expect(queue.getByRole("status")).toHaveText(
    "20 purchase orders loaded",
  );
  await expect(
    page.getByTitle("purchase-queue-042", { exact: true }),
  ).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Load more purchase orders", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText(
    "30 purchase orders loaded · All results shown",
  );
  await expect(page.getByTitle("other-site-079", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(queue.getByRole("status")).toHaveText(
    "20 purchase orders loaded",
  );
  await expect(
    queue.getByLabel("Purchase order state", { exact: true }),
  ).toHaveValue("");
  expect(errors).toEqual([]);
});
test("browser: purchase queue ignores superseded filters, abandoned navigation, refresh and signed-out continuations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const queue = page.getByRole("region", {
    name: "Purchase order queue",
    exact: true,
  });
  let release!: () => void, handled!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (handled = r));
  await page.route(pattern, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("state") === "received"
    ) {
      const response = await route.fetch();
      handled();
      await held;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await queue
    .getByLabel("Purchase order state", { exact: true })
    .selectOption("received");
  await started;
  await queue
    .getByLabel("Purchase order state", { exact: true })
    .selectOption("open");
  await expect(queue.getByRole("status")).toHaveText(
    "20 purchase orders loaded",
  );
  release();
  await expect(
    queue.getByLabel("Purchase order state", { exact: true }),
  ).toHaveValue("open");
  await expect(
    page.getByTitle("purchase-queue-042", { exact: true }),
  ).toHaveCount(0);
  await page.unroute(pattern);
  for (const action of ["navigate", "refresh", "sign-out"]) {
    if (action !== "navigate") {
      await nav(page, "Purchasing");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(queue.getByRole("status")).toHaveText(
        "20 purchase orders loaded",
      );
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
      .getByRole("button", { name: "Load more purchase orders", exact: true })
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
      await nav(page, "Purchasing");
      await expect(queue.getByRole("status")).toHaveText(
        "20 purchase orders loaded",
      );
    } else if (action === "refresh")
      await expect(queue.getByRole("status")).toHaveText(
        "20 purchase orders loaded",
      );
    else {
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await login(page);
      await expect(queue.getByRole("status")).toHaveText(
        "20 purchase orders loaded",
      );
    }
  }
});

test("browser: purchasing resumes and confirms an off-page saved receipt draft without paging the order into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // Saved receipt drafts also name their order; only the order queue pages.
  const records = page.getByRole("region", {
    name: "Purchase order records",
    exact: true,
  });
  await expect(
    records.getByTitle("purchase-queue-044", { exact: true }),
  ).toBeVisible();
  await expect(
    records.getByTitle("purchase-queue-001", { exact: true }),
  ).toHaveCount(0);
  await navigateWorkspace(page, "Purchasing", "Receipt drafts");
  const draft = page
    .getByRole("table")
    .filter({
      has: page.getByRole("columnheader", {
        name: "Warehouse / SKU",
        exact: true,
      }),
    })
    .getByRole("row")
    .filter({ has: page.getByText("OFF-PAGE-DRAFT", { exact: true }) });
  await openStockActions(draft);
  await draft
    .getByRole("button", { name: "Resume scans", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByLabel("Serials, one per line (blank for bulk)", { exact: true }),
  ).toHaveValue("OFF-PAGE-SERIAL");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(draft).toContainText("draft · v2");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/commands/purchase.draft.confirm",
  );
  await draft
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(draft).toContainText("received · v3");
  const detail = await page.request.get(
    origin + "/api/purchases/orders/purchase-queue-001",
  );
  expect(detail.status()).toBe(200);
  expect((await detail.json()).lines[0].received).toBe(1);
  await navigateWorkspace(page, "Purchasing", "Purchase orders");
  await expect(
    records.getByTitle("purchase-queue-044", { exact: true }),
  ).toBeVisible();
  await expect(
    records.getByTitle("purchase-queue-001", { exact: true }),
  ).toHaveCount(0);
});
