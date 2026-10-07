import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.js";

async function holdDashboardRefresh(page: Page) {
  let release!: () => void;
  let observed!: () => void;
  const blocked = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard", async (route) => {
    observed();
    await gate;
    await route.abort("aborted").catch(() => {});
  });
  return {
    blocked,
    finish: async () => {
      release();
      await page.unroute("**/api/dashboard");
    },
  };
}
async function login(page: Page, role = "admin") {
  await page.goto("/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(
      role === "admin"
        ? "admin@example.test"
        : `receiving-${role}@example.test`,
    );
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const loginReply = page.waitForResponse((r) =>
    r.url().endsWith("/api/login"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const session = await (await loginReply).json();
  await expect(page.locator("#workspace-title")).toBeVisible();
  return session.csrf as string;
}
test("phone delivery journey saves no stock, rejects incomplete serials, recovers a lost confirmation and opens exact received custody", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/#page=Inventory&section=inventory-stock");
  await page
    .getByRole("button", { name: "Receive equipment", exact: true })
    .click();
  await expect(page.locator("#workspace-title")).toHaveText("Purchasing");
  const sku = `RECEIVE-${browserName}`;
  const row = page.getByRole("row").filter({ hasText: sku });
  await expect(row).toContainText("0/2 received");
  await row
    .getByRole("button", { name: "Receive delivery", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Supplier delivery reference", { exact: true })
    .fill(`DELIVERY-${browserName}`);
  await dialog
    .getByLabel("Observed SKU on delivery", { exact: true })
    .fill(sku);
  await dialog.getByLabel("Units", { exact: true }).fill("2");
  await dialog
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill(`${sku}-1`);
  await dialog.getByLabel("Receiving bin", { exact: true }).fill("DOCK-1");
  const savedReply = page.waitForResponse((r) =>
    r.url().endsWith("/api/commands/purchase.draft.save"),
  );
  const saveRefresh = await holdDashboardRefresh(page);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  const draft = await (await savedReply).json();
  const saved = page.getByRole("region", { name: "Saved delivery next step" });
  await expect(saved).toContainText("Stock is unchanged");
  await saveRefresh.blocked;
  await navigateWorkspace(page, "Inventory", "Stock");
  await navigateWorkspace(page, "Purchasing", "Receipt drafts");
  const draftRow = page
    .getByRole("row")
    .filter({ hasText: draft.delivery_ref });
  await expect(draftRow).toContainText(`draft · v${draft.revision}`);
  await saveRefresh.finish();
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = purchases.orders.find((p: any) => p.id === draft.po_id);
  const productId = po.lines.find(
    (l: any) => l.id === draft.line_id,
  ).product_id;
  const stockBefore = await (
    await page.request.get(`/api/stock/page?productId=${productId}`)
  ).json();
  expect(stockBefore.items).toHaveLength(0);
  await saved
    .getByRole("button", { name: "Review and receive saved delivery" })
    .click();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    /serial/i,
  );
  await page.keyboard.press("Escape");
  await saved
    .getByRole("button", { name: "Continue scanning saved delivery" })
    .click();
  await page
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill(`${sku}-1\n${sku}-2`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(saved).toContainText("2 serials scanned");
  // Saved continuation survives leaving and returning to Purchasing.
  await page.goto("/#page=Inventory&section=inventory-stock");
  await page
    .getByRole("button", { name: "Receive equipment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue receipt drafts", exact: true })
    .click();
  await saved
    .getByRole("button", { name: "Review and receive saved delivery" })
    .click();
  const keys: string[] = [];
  let receipt: any;
  const confirmRefresh = await holdDashboardRefresh(page);
  await page.route("**/api/commands/purchase.draft.confirm", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    const reply = await route.fetch();
    receipt = await reply.json();
    if (keys.length === 1) await route.abort("failed");
    else await route.fulfill({ response: reply });
  });
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.locator("#workspace-title")).toHaveText("Inventory");
  await confirmRefresh.blocked;
  await navigateWorkspace(page, "Purchasing", "Receipt drafts");
  await expect(draftRow).toContainText(`received · v${receipt.draftRevision}`);
  await expect(
    draftRow.getByRole("button", { name: "Review and receive", exact: true }),
  ).toHaveCount(0);
  await confirmRefresh.finish();
  await navigateWorkspace(page, "Inventory", "Stock");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(keys[0]).toBe(keys[1]);
  const evidence = page.getByRole("region", {
    name: "Received delivery stock evidence",
  });
  await expect(evidence).toContainText(receipt.id);
  await expect(evidence).toContainText("Quarantined");
  const stockAfter = await (
    await page.request.get(`/api/stock/page?productId=${productId}`)
  ).json();
  expect(stockAfter.items.map((unit: any) => unit.id).sort()).toEqual(
    [...receipt.unitIds].sort(),
  );
  for (const unitId of receipt.unitIds) {
    const history = await (
      await page.request.get(`/api/stock/history?unitId=${unitId}`)
    ).json();
    expect(history.unit).toMatchObject({
      product_id: productId,
      warehouse_id: draft.warehouse_id,
      bin: "DOCK-1",
      quantity: 1,
      condition: "quarantine",
      state: "stock",
      cost: 6000,
    });
    expect([`${sku}-1`, `${sku}-2`]).toContain(history.unit.serial);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "receipt",
          reference: receipt.id,
          quantity: 1,
        }),
      ]),
    );
  }
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence
    .getByRole("button", {
      name: `Review received stock ${sku}-1`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stock movement history" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/receiving-journey-${browserName}-phone.png`,
    fullPage: false,
  });
});
test("commercial staff have purchasing guidance but cannot confirm warehouse receipt commands", async ({
  page,
}) => {
  const csrf = await login(page, "commercial");
  await page.goto("/#page=Inventory&section=inventory-stock");
  await page
    .getByRole("button", { name: "Receive equipment", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Receive equipment", exact: true }),
  ).toContainText("a warehouse user assigned");
  await expect(
    page.getByRole("button", { name: "Receive delivery", exact: true }),
  ).toHaveCount(0);
  const reply = await page.request.post(
    "/api/commands/purchase.draft.confirm",
    {
      headers: {
        origin: "http://127.0.0.1:3229",
        "x-csrf-token": csrf,
        "idempotency-key": "commercial-receive-denied",
      },
      data: { draftId: "not-permitted", revision: 1 },
    },
  );
  expect(reply.status()).toBe(403);
  expect((await reply.json()).code).toBe("FORBIDDEN");
});

test("created purchase order keeps its exact receiving continuation after refresh failure", async ({
  page,
  browserName,
}) => {
  await login(page);
  await page.goto("/#page=Purchasing&section=purchasing-queue");
  await page
    .getByRole("button", {
      name: "Create purchase order for delivery",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Synthetic supplier" });
  await dialog
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await dialog
    .getByLabel("Purchase product search", { exact: true })
    .fill(`RECEIVE-${browserName}`);
  await dialog
    .getByRole("button", { name: "Search purchase products", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: `Add RECEIVE-${browserName}`, exact: true })
    .click();
  await dialog
    .getByLabel(`Unit cost in cents for RECEIVE-${browserName}`, {
      exact: true,
    })
    .fill("6000");
  await dialog
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Synthetic refresh failure" },
    }),
  );
  const createdReply = page.waitForResponse((r) =>
    r.url().endsWith("/api/commands/purchase.create"),
  );
  await dialog
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  const created = await (await createdReply).json();
  const journey = page.getByRole("region", {
    name: "Receive equipment",
    exact: true,
  });
  await expect(journey).toContainText(created.id);
  const orderReply = page.waitForResponse((r) =>
    r.url().endsWith(`/api/purchases/orders/${created.id}`),
  );
  await journey
    .getByRole("button", { name: "Receive this purchase order", exact: true })
    .click();
  expect((await (await orderReply).json()).id).toBe(created.id);
  await expect(
    page.getByRole("dialog", { name: "Start receipt draft", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    journey.getByRole("button", {
      name: "Receive this purchase order",
      exact: true,
    }),
  ).toBeFocused();
});
