import { navigateWorkspace, withRowActions } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3136",
  pattern = "**/api/billing/invoices/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Billing" ? "Invoices" : undefined,
  );
}
function invoices(page: Page) {
  return page
    .getByRole("table")
    .filter({
      has: page.getByRole("columnheader", { name: "Invoice", exact: true }),
    })
    .filter({
      has: page.getByRole("columnheader", { name: "Customer", exact: true }),
    });
}
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("invoice-finance@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Billing");
}
test("browser: phone invoice queue retains full overview totals, failed pages, exact retries, live filters and older invoice actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await nav(page, "Overview");
  await expect(
    page
      .locator(".overview-metrics .metric-card")
      .filter({ has: page.getByText("Invoice balance", { exact: true }) }),
  ).toContainText("1,808.00");
  await nav(page, "Billing");
  const queue = page.getByRole("region", {
    name: "Invoice queue",
    exact: true,
  });
  await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
  await expect(
    invoices(page).getByText("SYNTHETIC-invoice-queue-044", { exact: true }),
  ).toBeVisible();
  await expect(
    invoices(page).getByText("SYNTHETIC-invoice-queue-000", { exact: true }),
  ).toHaveCount(0);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic invoice queue failure" },
      });
    else await route.continue();
  });
  await queue
    .getByRole("button", { name: "Load more invoices", exact: true })
    .click();
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic invoice queue failure",
  );
  await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
  await expect(
    queue.getByRole("button", { name: "Retry invoice queue", exact: true }),
  ).toBeFocused();
  await queue
    .getByRole("button", { name: "Retry invoice queue", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText("40 invoices loaded");
  expect(urls[1]).toBe(urls[0]);
  await queue
    .getByRole("button", { name: "Load more invoices", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText(
    "46 invoices loaded · All results shown",
  );
  await expect(
    queue.getByRole("heading", { name: "Invoice queue", exact: true }),
  ).toBeFocused();
  const oldest = invoices(page)
    .getByRole("row")
    .filter({
      has: page.getByText("SYNTHETIC-invoice-queue-000", {
        exact: true,
      }),
    });
  await (
    await withRowActions(oldest)
  )
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Amount in cents", { exact: true })).toHaveValue(
    "11300",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.unroute(pattern);
  let failed = false;
  await page.route(pattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic invoice filter failure" },
      });
    } else await route.continue();
  });
  await queue
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("credit");
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic invoice filter failure",
  );
  await expect(queue.getByRole("status")).toHaveText("0 invoices loaded");
  await expect(
    invoices(page).getByText("SYNTHETIC-invoice-queue-000", { exact: true }),
  ).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Retry invoice queue", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText(
    "15 invoices loaded · All results shown",
  );
  const credit = invoices(page)
    .getByRole("row")
    .filter({
      has: page.getByText("SYNTHETIC-invoice-queue-044", {
        exact: true,
      }),
    });
  await (
    await withRowActions(credit)
  )
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Original payment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Original payment", exact: true }),
  ).toContainText("invoice-queue-044-cash");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.unroute(pattern);
  await queue
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("unpaid");
  await expect(queue.getByRole("status")).toHaveText(
    "16 invoices loaded · All results shown",
  );
  await expect(
    invoices(page).getByText("SYNTHETIC-invoice-queue-044", { exact: true }),
  ).toHaveCount(0);
  await queue
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("settled");
  await expect(queue.getByRole("status")).toHaveText(
    "15 invoices loaded · All results shown",
  );
  // Filters are addressable workspace state, so Refresh reloads the first
  // page of the same filtered queue rather than resetting it.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(queue.getByRole("status")).toHaveText(
    "15 invoices loaded · All results shown",
  );
  await expect(
    queue.getByLabel("Invoice balance", { exact: true }),
  ).toHaveValue("settled");
  await queue
    .getByRole("button", { name: "Clear invoice balance filter", exact: true })
    .click();
  await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
  await expect(
    queue.getByLabel("Invoice balance", { exact: true }),
  ).toHaveValue("");
  expect(errors).toEqual([]);
});
test("browser: invoice queue ignores superseded filters, abandoned navigation, refresh and signed-out continuations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const queue = page.getByRole("region", {
    name: "Invoice queue",
    exact: true,
  });
  let release!: () => void, handled!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (handled = r));
  await page.route(pattern, async (route) => {
    if (new URL(route.request().url()).searchParams.get("state") === "credit") {
      const response = await route.fetch();
      handled();
      await held;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await queue
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("credit");
  await started;
  await queue
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("unpaid");
  await expect(queue.getByRole("status")).toHaveText(
    "16 invoices loaded · All results shown",
  );
  release();
  await expect(
    queue.getByLabel("Invoice balance", { exact: true }),
  ).toHaveValue("unpaid");
  await expect(
    invoices(page).getByText("SYNTHETIC-invoice-queue-044", { exact: true }),
  ).toHaveCount(0);
  await page.unroute(pattern);
  // Refresh keeps the addressable filter; clear it to return to all invoices.
  await queue
    .getByRole("button", { name: "Clear invoice balance filter", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
  for (const action of ["navigate", "refresh", "sign-out"]) {
    if (action !== "navigate") {
      await nav(page, "Billing");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
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
      .getByRole("button", { name: "Load more invoices", exact: true })
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
      await nav(page, "Billing");
      await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
    } else if (action === "refresh")
      await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
    else {
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await login(page);
      await expect(queue.getByRole("status")).toHaveText("20 invoices loaded");
    }
  }
});

test("browser: off-page original credit retains its customer identity for reviewed PDF publication without loading its invoice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const result = await page.request.get(origin + "/api/credits");
  expect(result.status()).toBe(200);
  const credit = (await result.json()).find(
    (c: any) => c.reference === "OFF-PAGE-CREDIT",
  );
  expect(credit.account_id).toBeTruthy();
  expect(credit.invoice_number).toMatch(/^INV-/);
  const invoiceTable = page
    .getByRole("table")
    .filter({
      has: page.getByRole("columnheader", { name: "Customer", exact: true }),
    })
    .filter({
      has: page.getByRole("columnheader", { name: "Invoice", exact: true }),
    });
  await expect(
    invoiceTable.getByText(credit.invoice_number, { exact: true }),
  ).toHaveCount(0);
  const row = page
    .getByRole("table")
    .filter({
      has: page.getByRole("columnheader", {
        name: "Original invoice",
        exact: true,
      }),
    })
    .getByRole("row")
    .filter({ has: page.getByText(credit.number, { exact: true }) });
  await expect(row).toContainText(credit.invoice_number);
  const download = page.waitForEvent("download");
  await row
    .getByRole("button", { name: "Review and publish credit", exact: true })
    .click();
  await download;
  await expect(page.getByRole("dialog")).toContainText("Synthetic buyer");
  await expect(page.getByRole("dialog")).toContainText(credit.number);
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic reviewed original customer PDF");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/commands/billing.portal.publish",
  );
  await page
    .getByRole("button", { name: "Publish to customer inbox", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    row.getByRole("button", { name: "Review and publish credit", exact: true }),
  ).toHaveCount(0);
  await expect(
    invoiceTable.getByText(credit.invoice_number, { exact: true }),
  ).toHaveCount(0);
});
