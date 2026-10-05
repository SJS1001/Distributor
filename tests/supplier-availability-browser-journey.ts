import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
const origin = "http://127.0.0.1:3157";
async function purchasing(page: Page, section = "Receipts & returns") {
  await navigateWorkspace(page, "Purchasing", section);
  await expect(
    page.getByRole("heading", { name: "Purchasing", exact: true }),
  ).toBeVisible();
}
async function login(page: Page, email = "admin@example.test") {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/login"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf: string = (await (await response).json()).csrf;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await purchasing(page);
  return csrf;
}
async function directory(page: Page, name: string) {
  await page
    .getByLabel("Supplier directory search", { exact: true })
    .fill(name);
  await page
    .getByRole("button", { name: "Search supplier directory", exact: true })
    .click();
}
async function supplier(page: Page, name: string) {
  const response = await page.request.get(
    `${origin}/api/purchases/suppliers/page?q=${encodeURIComponent(name)}`,
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.items).toHaveLength(1);
  return result.items[0];
}
async function command(page: Page, csrf: string, name: string, input: unknown) {
  const response = await page.request.post(`${origin}/api/commands/${name}`, {
    headers: {
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    },
    data: input,
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function suspend(page: Page, csrf: string, name: string) {
  const row = await supplier(page, name);
  return command(page, csrf, "supplier.availability", {
    supplierId: row.id,
    revision: row.revision,
    active: false,
    reason: "Synthetic concurrent purchasing suspension",
  });
}
async function openPurchase(page: Page, name: string) {
  await purchasing(page, "Purchase orders");
  await page
    .getByRole("button", { name: "Purchase order", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Purchase supplier search", exact: true })
    .fill(name);
  await page
    .getByRole("button", { name: "Search purchase suppliers", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Supplier", { exact: true })
      .locator("option")
      .filter({ hasText: name }),
  ).toHaveCount(1);
  await page
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: name });
  await page.getByRole("button", { name: "Add EQ-1", exact: true }).click();
  await page.getByLabel("Units for EQ-1", { exact: true }).fill("2");
  await page
    .getByLabel("Unit cost in cents for EQ-1", { exact: true })
    .fill("1234");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Purchase total: CAD 24.68",
  );
}

test("browser: supplier availability on phone pages suppliers, retains an exact lost reply across reload, and explicitly resumes purchasing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await directory(page, "Directory supplier");
  const rows = page.getByRole("region", {
    name: "Supplier directory",
    exact: true,
  });
  await expect(rows).toContainText("20 suppliers loaded");
  await page
    .getByRole("button", { name: "Next supplier directory page", exact: true })
    .click();
  await expect(rows).toContainText("40 suppliers loaded");
  await page
    .getByRole("button", { name: "Next supplier directory page", exact: true })
    .click();
  await expect(rows).toContainText("43 suppliers loaded");
  await directory(page, "Recovery supplier");
  await page
    .getByRole("button", {
      name: "Suspend purchasing from Recovery supplier",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("reviewed revision 0");
  await page
    .getByLabel("Supplier change reason / evidence", { exact: true })
    .fill("Phone reviewed suspension with retained evidence");
  const attempts: { key: string; body: string }[] = [];
  await page.route("**/api/commands/supplier.availability", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1)
      await route.fulfill({
        status: 500,
        json: { message: "Synthetic supplier reply lost" },
      });
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Suspend supplier purchasing", exact: true })
    .click();
  await expect(dialog).toContainText("Synthetic supplier reply lost");
  await expect(
    page.getByLabel("Supplier change reason / evidence", { exact: true }),
  ).toBeDisabled();
  expect((await supplier(page, "Recovery supplier")).revision).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await purchasing(page);
  await page
    .getByRole("button", {
      name: "Review retained supplier change",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText(
    "Phone reviewed suspension with retained evidence",
  );
  await page
    .getByRole("button", { name: "Retry exact supplier change", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute("**/api/commands/supplier.availability");
  await directory(page, "Recovery supplier");
  await page
    .getByRole("button", {
      name: "Purchasing history Recovery supplier",
      exact: true,
    })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await expect(dialog).toContainText(
    "Phone reviewed suspension with retained evidence",
  );
  await page
    .getByRole("button", { name: "Close supplier history", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Resume purchasing from Recovery supplier",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("reviewed revision 1");
  await page
    .getByLabel("Supplier change reason / evidence", { exact: true })
    .fill("Phone reviewed resumed supplier qualification");
  await page
    .getByRole("button", { name: "Resume supplier purchasing", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await supplier(page, "Recovery supplier")).revision).toBe(2);
  expect((await supplier(page, "Recovery supplier")).active).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: supplier availability stale revisions require refreshed review and history retries the same bounded cursor with warehouse read access", async ({
  page,
  browser,
}) => {
  const csrf = await login(page);
  await directory(page, "Revision supplier");
  await page
    .getByRole("button", {
      name: "Suspend purchasing from Revision supplier",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("reviewed revision 0");
  await page
    .getByLabel("Supplier change reason / evidence", { exact: true })
    .fill("Stale staff suspension evidence retained");
  await suspend(page, csrf, "Revision supplier");
  await page
    .getByRole("button", { name: "Suspend supplier purchasing", exact: true })
    .click();
  await expect(dialog).toContainText("REVISION");
  await expect(
    page.getByLabel("Supplier change reason / evidence", { exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Suspend supplier purchasing", exact: true })
    .click();
  await expect(dialog).toContainText("Refresh the supplier review");
  const refreshes: string[] = [];
  await page.route(
    "**/api/purchases/suppliers/*/availability",
    async (route) => {
      refreshes.push(route.request().url());
      if (refreshes.length === 1)
        await route.fulfill({
          status: 503,
          json: { message: "Synthetic supplier refresh unavailable" },
        });
      else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Refresh supplier review", exact: true })
    .click();
  await expect(dialog).toContainText("Synthetic supplier refresh unavailable");
  await expect(dialog).toContainText("reviewed revision 0");
  await page
    .getByRole("button", { name: "Suspend supplier purchasing", exact: true })
    .click();
  await expect(dialog).toContainText("Refresh the supplier review");
  await page
    .getByRole("button", { name: "Retry supplier history", exact: true })
    .click();
  await expect(dialog).toContainText("reviewed revision 1");
  expect(refreshes).toHaveLength(2);
  expect(refreshes[1]).toBe(refreshes[0]);
  await expect(
    page.getByLabel("Supplier change reason / evidence", { exact: true }),
  ).toHaveValue("Stale staff suspension evidence retained");
  await page
    .getByLabel("Supplier change reason / evidence", { exact: true })
    .fill("Re-reviewed current suspension; resume supplier");
  await page
    .getByRole("button", { name: "Resume supplier purchasing", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await supplier(page, "Revision supplier")).revision).toBe(2);
  const context = await browser.newContext();
  const warehouse = await context.newPage();
  try {
    await login(warehouse, "supplier-warehouse@example.test");
    await directory(warehouse, "History supplier");
    await expect(
      warehouse.getByRole("button", { name: /^Resume purchasing from/ }),
    ).toHaveCount(0);
    await warehouse
      .getByRole("button", {
        name: "Purchasing history History supplier",
        exact: true,
      })
      .click();
    const history = warehouse.getByRole("dialog");
    await expect(history.locator("tbody tr")).toHaveCount(20);
    const cursors: string[] = [];
    await warehouse.route(
      "**/api/purchases/suppliers/*/availability?after=*",
      async (route) => {
        cursors.push(route.request().url());
        if (cursors.length === 1)
          await route.fulfill({
            status: 503,
            json: { message: "Synthetic supplier history unavailable" },
          });
        else await route.continue();
      },
    );
    await warehouse
      .getByRole("button", { name: "Load older supplier changes", exact: true })
      .click();
    await expect(history).toContainText(
      "Synthetic supplier history unavailable",
    );
    await expect(history.locator("tbody tr")).toHaveCount(20);
    await warehouse
      .getByRole("button", { name: "Retry supplier history", exact: true })
      .click();
    await expect(history.locator("tbody tr")).toHaveCount(40);
    expect(cursors[1]).toBe(cursors[0]);
    await warehouse
      .getByRole("button", { name: "Load older supplier changes", exact: true })
      .click();
    await expect(history.locator("tbody tr")).toHaveCount(43);
    await expect(history).toContainText("Synthetic availability review 1");
    await warehouse
      .getByRole("button", { name: "Refresh supplier review", exact: true })
      .click();
    await expect(history.locator("tbody tr")).toHaveCount(20);
    await warehouse
      .getByRole("button", { name: "Close supplier history", exact: true })
      .click();
  } finally {
    await context.close();
  }
});

test("browser: supplier availability purchase refusal after reviewed suspension releases only the refused attempt and preserves entered costs", async ({
  page,
}) => {
  const csrf = await login(page);
  await openPurchase(page, "Purchase refusal supplier");
  const attempts: { key: string; body: string }[] = [];
  await page.route("**/api/commands/purchase.create", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    if (attempts.length === 1)
      await route.fulfill({
        status: 500,
        json: { message: "Synthetic purchase transport unavailable" },
      });
    else await route.continue();
  });
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic purchase transport unavailable",
  );
  await suspend(page, csrf, "Purchase refusal supplier");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await purchasing(page, "Purchase orders");
  await page
    .getByRole("button", { name: "Purchase order", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await page
    .getByRole("button", {
      name: "Retry exact purchase",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("SUPPLIER_INACTIVE");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute("**/api/commands/purchase.create");
  await expect(
    page.getByRole("button", { name: "Retry exact purchase", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit purchase lines", exact: true })
    .click();
  await expect(page.getByLabel("Units for EQ-1", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    page.getByLabel("Unit cost in cents for EQ-1", { exact: true }),
  ).toHaveValue("1234");
  await expect(dialog).toContainText("Suspended for new purchasing");
  await page
    .getByRole("textbox", { name: "Purchase supplier search", exact: true })
    .fill("Synthetic supplier");
  await page
    .getByRole("button", { name: "Search purchase suppliers", exact: true })
    .click();
  await page
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Synthetic supplier" });
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await expect(dialog).toContainText("Purchase total: CAD 24.68");
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("browser: supplier availability keeps an already committed purchase exact retry valid after suspension and reload", async ({
  page,
}) => {
  const csrf = await login(page);
  await openPurchase(page, "Committed purchase supplier");
  const attempts: { key: string; body: string }[] = [];
  let purchaseId = "";
  await page.route("**/api/commands/purchase.create", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const result = await response.json();
    if (attempts.length === 1) {
      purchaseId = result.id;
      await suspend(page, csrf, "Committed purchase supplier");
      await route.fulfill({
        status: 500,
        json: { message: "Synthetic committed purchase reply lost" },
      });
    } else {
      expect(result.id).toBe(purchaseId);
      await route.fulfill({ response });
    }
  });
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic committed purchase reply lost",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await purchasing(page, "Purchase orders");
  await page
    .getByRole("button", { name: "Purchase order", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry exact purchase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  const response = await page.request.get(`${origin}/api/purchases`);
  const orders = (await response.json()).orders.filter(
    (row: { id: string }) => row.id === purchaseId,
  );
  expect(orders).toHaveLength(1);
  expect(orders[0].lines[0].unit_cost).toBe(1234);
});
