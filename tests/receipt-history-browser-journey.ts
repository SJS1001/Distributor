import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function draftFixture(page: Page) {
  await signIn(page);
  const csrf = (await (await page.request.get("/api/session")).json()).csrf;
  const command = async (name: string, data: unknown) => {
    const reply = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": csrf,
        "idempotency-key": randomUUID(),
      },
      data,
    });
    expect(reply.status()).toBe(200);
    return reply.json();
  };
  const suffix = randomUUID();
  const sku = `HISTORY-${suffix}`;
  const product = await command("product.create", {
    sku,
    name: "Synthetic receipt history equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 0,
  });
  const purchases = await (await page.request.get("/api/purchases")).json();
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const po = await command("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId: dashboard.warehouses[0].id,
    lines: [{ productId: product.id, quantity: 2, unitCost: 500 }],
  });
  const updated = await (await page.request.get("/api/purchases")).json();
  const deliveryRef = `HISTORY-DELIVERY-${suffix}`;
  const draft = await command("purchase.draft.save", {
    poId: po.id,
    lineId: updated.orders.find((row: any) => row.id === po.id).lines[0].id,
    deliveryRef,
    observedSku: sku,
    quantity: 2,
    serials: [],
    bin: "HISTORY",
    quarantine: false,
    draftId: null,
    revision: 0,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Purchasing");
  const row = page.getByRole("row").filter({ hasText: deliveryRef });
  await expect(row).toContainText("draft · v1");
  return {
    draft,
    row,
    path: `/api/purchases/drafts/${draft.id}/history`,
    before: await (await page.request.get("/api/purchases")).json(),
  };
}

for (const scenario of ["navigation", "late error", "sign-out"] as const) {
  test(`browser: receipt history discards ${scenario} response without reopening or changing native facts`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await draftFixture(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const pattern = `**${fixture.path}`;
    const settled = new Promise<void>((resolve) => {
      page.on("requestfinished", (request) => {
        if (request.url().endsWith(fixture.path)) resolve();
      });
      page.on("requestfailed", (request) => {
        if (request.url().endsWith(fixture.path)) resolve();
      });
    });
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      held = true;
      await pending;
      if (scenario === "late error")
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Synthetic late receipt history failure",
          }),
        });
      else await route.fulfill({ response });
    });
    try {
      await fixture.row
        .getByRole("button", { name: "View draft history", exact: true })
        .click();
      await expect.poll(() => held).toBe(true);
      if (scenario === "sign-out") {
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Sign in to your workspace",
            exact: true,
          }),
        ).toBeVisible();
      } else await nav(page, "Catalog");
      release();
      await settled;
      // Let the browser consume a delivered body and commit its UI updates.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      if (scenario === "sign-out") await signIn(page);
      await expect(
        page.getByRole("dialog", {
          name: "Receipt draft history",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByRole("status").filter({ hasText: "Saved." }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
      expect(await (await page.request.get("/api/purchases")).json()).toEqual(
        fixture.before,
      );
      expect(errors).toEqual([]);
    } finally {
      release();
      await page.unroute(pattern);
    }
  });
}

test("browser: receipt history reports an active failure, retries and closes without saving or refreshing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await draftFixture(page);
  let reads = 0;
  let refreshes = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/dashboard")) refreshes++;
  });
  await page.route(`**${fixture.path}`, async (route) => {
    reads++;
    if (reads === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic active history failure" }),
      });
    else await route.continue();
  });
  const view = fixture.row.getByRole("button", {
    name: "View draft history",
    exact: true,
  });
  await view.click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic active history failure",
  );
  await expect(view).toBeEnabled();
  await view.click();
  const dialog = page.getByRole("dialog", {
    name: "Receipt draft history",
    exact: true,
  });
  await expect(dialog).toContainText("v1 · draft");
  await expect(dialog).toContainText("HISTORY-");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toHaveCount(0);
  expect(refreshes).toBe(0);
  expect(reads).toBe(2);
  expect(await (await page.request.get("/api/purchases")).json()).toEqual(
    fixture.before,
  );
  expect(errors).toEqual([]);
});

test("browser: receipt history closes at cancel without changing native facts", async ({
  page,
}) => {
  const fixture = await draftFixture(page);
  await fixture.row
    .getByRole("button", { name: "View draft history", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Receipt draft history",
    exact: true,
  });
  await expect(dialog).toContainText("v1 · draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  expect(await (await page.request.get("/api/purchases")).json()).toEqual(
    fixture.before,
  );
});
