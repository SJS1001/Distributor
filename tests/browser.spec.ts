import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
test("browser: reviewed customer/catalog imports retain rejects, explicit matches and strict defaults and recover a lost approval response once", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/dashboard")).json(),
    eq = before.products.find((p: any) => p.sku === "EQ-1");
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "BROWSER-C-1",
      targetId: null,
      name: "Browser imported customer A",
      tier: "standard",
      creditLimit: 100000,
      held: false,
    },
    {
      sourceId: "BROWSER-C-2",
      targetId: null,
      name: "Browser imported customer B",
      tier: "trade",
      creditLimit: 200000,
      held: true,
    },
  ];
  const dryRun = async (
    batchRef: string,
    kind: string,
    value: number,
    sourceRows: unknown[],
  ) => {
    await page
      .getByRole("button", { name: "Dry run customer/catalog", exact: true })
      .click();
    await page.getByLabel("Import type", { exact: true }).selectOption(kind);
    await page
      .getByLabel("Batch reference (new for each correction)", { exact: true })
      .fill(batchRef);
    await page
      .getByLabel("Source dataset reference (keep for corrected batches)", {
        exact: true,
      })
      .fill("BROWSER-MASTERS-CUTOFF");
    await page
      .getByLabel("Original source SHA-256", { exact: true })
      .fill("b".repeat(64));
    await page
      .getByLabel("Source cutoff (UTC)", { exact: true })
      .fill("2026-09-01T00:00:00.000Z");
    await page
      .getByLabel("Independent source record count", { exact: true })
      .fill("2");
    await page
      .getByLabel("Independent control amount (CAD cents)", { exact: true })
      .fill(String(value));
    await page
      .getByLabel("Source rights, mapping and cutoff evidence", { exact: true })
      .fill(
        "Synthetic browser source, mapping, rights and independent totals reviewed",
      );
    await page
      .getByLabel("Master rows (JSON)", { exact: true })
      .fill(JSON.stringify(sourceRows));
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-MASTERS-BLOCKED", "customer", 300001, rows);
  const blocked = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independently supplied",
  );
  await expect(
    blocked.getByRole("button", { name: "Approve master batch", exact: true }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Correct independent control amount in a new batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-MASTERS-CUSTOMERS", "customer", 300000, rows);
  const customers = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-CUSTOMERS",
    exact: true,
  });
  await expect(customers).toContainText("2 create / 0 match. 0 review issues");
  await expect(customers).toContainText('"held":true');
  expect(
    (await (await page.request.get("/api/dashboard")).json()).accounts,
  ).toHaveLength(before.accounts.length);
  let lost = false;
  await page.route("**/api/commands/import.masters.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await customers
    .getByRole("button", { name: "Approve master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Reviewed synthetic customers, holds and credit control totals");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(customers).toContainText("applied");
  const catalogRows = [
    {
      sourceId: "BROWSER-P-MATCH",
      targetId: eq.id,
      sku: eq.sku,
      name: eq.name,
      serialized: true,
      unitPrice: eq.unit_price,
      taxBasisPoints: eq.tax_bp,
    },
    {
      sourceId: "BROWSER-P-CREATE",
      targetId: null,
      sku: "BROWSER-MASTER-B",
      name: "Browser imported bulk product",
      serialized: false,
      unitPrice: 2000,
      taxBasisPoints: 0,
    },
  ];
  await dryRun("BROWSER-MASTERS-CATALOG", "catalog", 12000, catalogRows);
  const catalog = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-CATALOG",
    exact: true,
  });
  await expect(catalog).toContainText("1 create / 1 match. 0 review issues");
  await expect(catalog).toContainText('"taxBasisPoints":1300');
  await catalog
    .getByRole("button", { name: "Approve master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Reviewed exact product target and new SKU");
  await next(page);
  await expect(catalog).toContainText("applied");
  const after = await (await page.request.get("/api/dashboard")).json(),
    imported = after.accounts.filter((c: any) =>
      c.name.startsWith("Browser imported"),
    );
  expect(imported).toHaveLength(2);
  expect(imported.reduce((s: number, c: any) => s + c.credit_limit, 0)).toBe(
    300000,
  );
  expect(imported.filter((c: any) => c.held)).toHaveLength(1);
  for (const c of imported)
    expect([
      c.residency_mode,
      c.provider_exceptions,
      c.residency_version,
    ]).toEqual(["strict", "[]", 1]);
  expect(after.products).toHaveLength(before.products.length + 1);
  expect(after.products.find((p: any) => p.id === eq.id)).toEqual(eq);
  expect(after.stock).toEqual(before.stock);
  expect(after.invoices).toEqual(before.invoices);
  await page.reload();
  await nav(page, "Imports");
  await expect(customers).toContainText("applied");
  await expect(catalog).toContainText("applied");
  const batches = await (await page.request.get("/api/imports/masters")).json();
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-MASTERS-CUSTOMERS").result
      .mappings,
  ).toHaveLength(2);
  expect(
    batches
      .find((b: any) => b.batchRef === "BROWSER-MASTERS-CATALOG")
      .result.mappings.map((m: any) => m.action),
  ).toEqual(["match", "create"]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/imports/masters")).status()).toBe(403);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: opening dry runs reconcile independent totals and apply serial/bulk custody once after a lost approval response", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "S-A",
      sku: "OPEN-S",
      warehouse: "Toronto",
      bin: "A-1",
      serial: "OPEN-S1",
      quantity: 1,
      unitCost: 6000,
      condition: "usable",
    },
    {
      sourceId: "S-B",
      sku: "OPEN-S",
      warehouse: "Toronto",
      bin: "A-1",
      serial: "OPEN-S2",
      quantity: 1,
      unitCost: 6000,
      condition: "usable",
    },
    {
      sourceId: "B-A",
      sku: "OPEN-B",
      warehouse: "Toronto",
      bin: "B-1",
      serial: null,
      quantity: 3,
      unitCost: 1000,
      condition: "usable",
    },
    {
      sourceId: "B-B",
      sku: "OPEN-B",
      warehouse: "Ottawa",
      bin: "Q-1",
      serial: null,
      quantity: 1,
      unitCost: 1000,
      condition: "quarantine",
    },
  ];
  const dryRun = async (batchRef: string, value: number) => {
    await page
      .getByRole("button", { name: "Dry run opening stock", exact: true })
      .click();
    await page
      .getByLabel("Batch reference (new for each correction)", { exact: true })
      .fill(batchRef);
    await page
      .getByLabel("Source dataset reference (keep for corrected batches)", {
        exact: true,
      })
      .fill("BROWSER-SYNTHETIC-CUTOFF");
    await page
      .getByLabel("Original source SHA-256", { exact: true })
      .fill("a".repeat(64));
    await page
      .getByLabel("Source cutoff (UTC)", { exact: true })
      .fill("2026-09-01T00:00:00.000Z");
    await page
      .getByLabel("Independent source quantity", { exact: true })
      .fill("6");
    await page
      .getByLabel("Independent source cost (CAD cents)", { exact: true })
      .fill(String(value));
    await page
      .getByLabel("Source rights, mapping and cutoff evidence", { exact: true })
      .fill(
        "Synthetic browser fixture only; independent source totals and cutoff reviewed",
      );
    await page
      .getByLabel("Opening rows (JSON)", { exact: true })
      .fill(JSON.stringify(rows));
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-OPEN-BLOCKED", 16001);
  const blocked = page.getByRole("region", {
    name: "Opening batch BROWSER-OPEN-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independently supplied",
  );
  await expect(
    blocked.getByRole("button", { name: "Approve opening stock", exact: true }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject opening batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Independent source value corrected in a new immutable batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-OPEN-READY", 16000);
  const ready = page.getByRole("region", {
    name: "Opening batch BROWSER-OPEN-READY",
    exact: true,
  });
  await expect(ready).toContainText("0 review issues");
  const stock = async () => {
    const dashboard = await (await page.request.get("/api/dashboard")).json();
    const ids = dashboard.products
      .filter((p: any) => p.sku.startsWith("OPEN-"))
      .map((p: any) => p.id);
    return dashboard.stock.filter((u: any) => ids.includes(u.product_id));
  };
  expect(await stock()).toHaveLength(0);
  let lost = false;
  await page.route("**/api/commands/import.opening.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await ready
    .getByRole("button", { name: "Approve opening stock", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill(
      "Synthetic quantity, original costs, rights and frozen cutoff reviewed",
    );
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ready).toContainText("applied");
  const units = await stock();
  expect(units).toHaveLength(4);
  expect(units.reduce((s: number, u: any) => s + u.quantity, 0)).toBe(6);
  expect(units.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    16000,
  );
  expect(units.reduce((s: number, u: any) => s + u.available, 0)).toBe(5);
  await page.reload();
  await nav(page, "Imports");
  await expect(ready).toContainText("applied");
  const batches = await (await page.request.get("/api/imports/opening")).json();
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-OPEN-READY").result
      .mappings,
  ).toHaveLength(4);
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-OPEN-BLOCKED").state,
  ).toBe("rejected");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/imports/opening")).status()).toBe(403);
  expect(errors).toEqual([]);
});
async function next(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
test("browser: partial transfer retries preserve transit stock and separate damaged/quarantined arrivals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  const lot = page
    .getByRole("row")
    .filter({ hasText: "TR-1" })
    .filter({
      has: page.getByRole("button", { name: "Transfer", exact: true }),
    });
  await lot.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page.getByLabel("Units", { exact: true }).fill("4");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic browser relocation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const transfer = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "TR-1" });
  await expect(transfer).toContainText(
    "4 dispatched · 0 received · 4 in transit",
  );
  let lost = false;
  await page.route("**/api/commands/transfer.receive", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  for (const [quantity, condition, reference, remaining] of [
    [2, "usable", "BROWSER-TRANSFER-USABLE", 2],
    [1, "damaged", "BROWSER-TRANSFER-DAMAGE", 1],
    [1, "quarantine", "BROWSER-TRANSFER-QUARANTINE", 0],
  ] as const) {
    await transfer
      .getByRole("button", { name: "Receive transfer", exact: true })
      .click();
    await expect(
      page.getByLabel("Units arriving", { exact: true }),
    ).toHaveAttribute("max", String(quantity === 2 ? 4 : remaining + 1));
    await page
      .getByLabel("Units arriving", { exact: true })
      .fill(String(quantity));
    await page
      .getByLabel("Arrival reference (unique per portion)", { exact: true })
      .fill(reference);
    await page
      .getByLabel("Destination bin", { exact: true })
      .fill(condition === "usable" ? "B-1" : "Q-1");
    await page.getByLabel("Condition", { exact: true }).selectOption(condition);
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic arrival inspection");
    await next(page);
    if (quantity === 2) {
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await next(page);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(transfer).toContainText(
      `4 dispatched · ${4 - remaining} received · ${remaining} in transit`,
    );
    await expect(transfer).toContainText(
      `${reference} · ${quantity} ${condition}`,
    );
  }
  await expect(
    transfer.getByRole("cell", { name: "received", exact: true }),
  ).toBeVisible();
  await expect(
    transfer.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const product = dashboard.products.find((p: any) => p.sku === "TR-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(6);
  expect(
    stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(6000);
  expect(stock.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(4);
  const transfers = await (await page.request.get("/api/transfers")).json();
  expect(
    transfers.find((tr: any) => tr.lines[0].product_id === product.id).lines[0]
      .receipts,
  ).toHaveLength(3);
  expect(errors).toEqual([]);
});
test("browser: two site-limited operators dispatch and scan a serial without destination stock access at the source", async ({
  page,
}) => {
  const login = async (email: string) => {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await page.goto("/");
  await login("source@example.test");
  await nav(page, "Inventory");
  const serial = page.getByRole("row").filter({ hasText: "S3" });
  await serial.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic separate-site dispatch");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const transfer = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "S3" });
  await expect(transfer).toContainText(
    "1 dispatched · 0 received · 1 in transit",
  );
  await expect(
    transfer.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  const sourceDashboard = await (
    await page.request.get("/api/dashboard")
  ).json();
  expect(
    sourceDashboard.stock.every(
      (u: any) => u.warehouse_id === sourceDashboard.warehouses[0].id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("destination@example.test");
  await nav(page, "Inventory");
  await transfer
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await page
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill("S2");
  await page
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill("BROWSER-SERIAL-ARRIVAL");
  await page.getByLabel("Destination bin", { exact: true }).fill("B-2");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic scanned arrival");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "SERIAL",
  );
  await page
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill("S3");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transfer).toContainText(
    "1 dispatched · 1 received · 0 in transit",
  );
  const destination = await (await page.request.get("/api/dashboard")).json();
  expect(
    destination.stock.find((u: any) => u.serial === "S3").warehouse_id,
  ).toBe(destination.warehouses[0].id);
});
test("browser: multi-line cart, lost acceptance response, serial/bulk fulfillment, residency choice, paid return and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Orders");
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Synthetic buyer" });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await page
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("1");
  await page
    .getByLabel("SUP-1 · Synthetic supplies", { exact: true })
    .fill("2");
  await next(page);
  await expect(page.getByRole("dialog")).toContainText("$169.50");
  let intercepted = false;
  await page.route("**/api/commands/order.accept", async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dashboard = await page.request.get("/api/dashboard");
  expect((await dashboard.json()).orders).toHaveLength(1);
  for (const label of ["EQ-1", "SUP-1"]) {
    await page
      .getByRole("button", { name: "Pick / pack", exact: true })
      .click();
    const allocation = page.getByLabel("Allocation", { exact: true });
    await expect(allocation).toBeVisible();
    const value = await allocation
      .locator("option")
      .evaluateAll(
        (options, label) =>
          options
            .find((o) => o.textContent?.startsWith(String(label)))
            ?.getAttribute("value"),
        label,
      );
    await allocation.selectOption(value!);
    if (label === "EQ-1")
      await page
        .getByLabel("Scan serial (leave blank for bulk)", { exact: true })
        .fill("S1");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Synthetic collection counter");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Confirm collection", exact: true })
    .click();
  await page
    .getByLabel("Handover evidence", { exact: true })
    .fill("Browser synthetic handover");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Download invoice PDF",
          exact: true,
        }),
      })
      .getByRole("cell", { name: "CA$169.50", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Request Stripe checkout", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("RESIDENCY_BLOCKED");
  await nav(page, "Customers");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Synthetic buyer", exact: true }),
    })
    .getByRole("button", { name: "Residency choice", exact: true })
    .click();
  await page
    .getByLabel("Application storage region", { exact: true })
    .selectOption("US");
  await page
    .getByLabel("Acknowledgment of reviewed processor terms", { exact: true })
    .fill("Synthetic reviewed terms");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "REGIONAL_MIGRATION_REQUIRED",
  );
  await page
    .getByLabel("Application storage region", { exact: true })
    .selectOption("CA");
  await page
    .getByLabel("Processor policy", { exact: true })
    .selectOption("provider-exceptions");
  await page
    .getByLabel("Allow Stripe processing outside the storage region", {
      exact: true,
    })
    .check();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  await page
    .getByRole("button", { name: "Request Stripe checkout", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("PROVIDER_DISABLED");
  await expect(
    page.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page
    .getByLabel("Bank / payment reference", { exact: true })
    .fill("BANK-BROWSER-1");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic bank confirmation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Returns");
  await page
    .getByRole("button", { name: "Submit claim / return", exact: true })
    .click();
  await page
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic return");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Browser fixture");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Approve return authorization", { exact: true })
    .check();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic approval");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Receive return", exact: true })
    .click();
  await page.getByLabel("Quarantine bin", { exact: true }).fill("Q-1");
  await page.getByLabel("Scan returned serial", { exact: true }).fill("S1");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page
    .getByLabel("Inspection findings", { exact: true })
    .fill("Sealed and undamaged");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Disposition", exact: true }).click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Restock approved");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Issue return credit", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Return credit approved");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Download invoice PDF",
          exact: true,
        }),
      })
      .getByRole("cell", { name: "-CA$113.00", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Customers");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Synthetic buyer", exact: true }),
    })
    .getByRole("button", { name: "Residency choice", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "local-evidence/browser-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("browser: split packing retries once, void releases holds, and each handover invoices only its quantity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const snapshot = async () =>
    (await page.request.get("/api/dashboard")).json();
  const before = await snapshot();
  const bulk = before.products.find((p: any) => p.sku === "SUP-1");
  const initialStock = before.stock.find(
    (u: any) => u.product_id === bulk.id,
  ).quantity;
  await nav(page, "Orders");
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Synthetic buyer" });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await page
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("0");
  await page
    .getByLabel("SUP-1 · Synthetic supplies", { exact: true })
    .fill("3");
  await next(page);
  await expect(page.getByRole("dialog")).toContainText("$84.75");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const order = (await snapshot()).orders.find((o: any) => o.state === "open");
  await page.getByRole("button", { name: "Pick / pack", exact: true }).click();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  const units = page.getByLabel(/SUP-1.*units to pack/);
  await expect(units).toHaveValue("3");
  await units.fill("1");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection one");
  let lost = false;
  await page.route("**/api/commands/fulfillment.pack", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const first = await snapshot();
  expect(
    first.shipments.filter((s: any) => s.order_id === order.id),
  ).toHaveLength(1);
  expect(
    first.invoices.filter((i: any) => i.order_id === order.id),
  ).toHaveLength(0);
  expect(first.stock.find((u: any) => u.product_id === bulk.id).quantity).toBe(
    initialStock,
  );

  await page
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(units).toHaveValue("2");
  await expect(units).toHaveAttribute("max", "2");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection two");
  await units.fill("0");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Select at least one unit",
  );
  await units.fill("2");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "No picked units are available",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = (destination: string) =>
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: destination, exact: true }),
    });
  await row("Split collection two")
    .getByRole("button", { name: "Void packing", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic changed packing");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(units).toHaveValue("2");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection replacement");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const destination of [
    "Split collection one",
    "Split collection replacement",
  ]) {
    await row(destination)
      .getByRole("button", { name: "Confirm collection", exact: true })
      .click();
    await page
      .getByLabel("Handover evidence", { exact: true })
      .fill("Synthetic split handover");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (destination === "Split collection one") {
      const partial = await snapshot();
      const current = partial.orders.find((o: any) => o.id === order.id);
      expect(current.state).toBe("open");
      expect(current.lines[0].shipped).toBe(1);
      expect(current.lines[0].allocated).toBe(2);
      expect(
        partial.invoices.find((i: any) => i.order_id === order.id).total,
      ).toBe(2825);
    }
  }
  const final = await snapshot();
  const completed = final.orders.find((o: any) => o.id === order.id);
  expect(completed.state).toBe("closed");
  expect(completed.lines[0].shipped).toBe(3);
  expect(completed.lines[0].allocated).toBe(0);
  const invoices = final.invoices.filter((i: any) => i.order_id === order.id);
  expect(invoices).toHaveLength(2);
  expect(invoices.reduce((sum: number, i: any) => sum + i.total, 0)).toBe(8475);
  expect(final.stock.find((u: any) => u.product_id === bulk.id).quantity).toBe(
    initialStock - 3,
  );
  expect(
    final.shipments.filter(
      (s: any) => s.order_id === order.id && s.state === "void",
    ),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("browser: administrator reconciles missing transfer stock and recovers found portions without erasing the loss or duplicating lost-response approvals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  const lot = page
    .getByRole("row")
    .filter({ hasText: "LOSS-1" })
    .filter({
      has: page.getByRole("button", { name: "Transfer", exact: true }),
    });
  await lot.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page.getByLabel("Units", { exact: true }).fill("3");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic reconciliation relocation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tr = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "LOSS-1" });
  await expect(tr).toContainText("3 dispatched · 0 received · 3 in transit");
  let discarded = false;
  await page.route("**/api/commands/transfer.loss", async (route) => {
    if (!discarded) {
      discarded = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await tr
    .getByRole("button", { name: "Approve transit loss", exact: true })
    .click();
  await page
    .getByLabel("Missing units to write off", { exact: true })
    .fill("2");
  await page
    .getByLabel("Loss evidence reference (unique per portion)", { exact: true })
    .fill("BROWSER-LOSS-1");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Investigation and receiving count confirm two missing cartons");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tr).toContainText(
    "3 dispatched · 0 received · 1 in transit · 2 unrecovered loss",
  );
  await expect(tr).toContainText(
    "BROWSER-LOSS-1 · 2 loss approved · 2 unrecovered",
  );
  await tr
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await expect(page.getByLabel("Units arriving", { exact: true })).toHaveValue(
    "1",
  );
  await page
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill("BROWSER-UNLOST-ARRIVAL");
  await page.getByLabel("Destination bin", { exact: true }).fill("B-1");
  await page.getByLabel("Condition", { exact: true }).selectOption("usable");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("One unlost carton arrived");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    tr.getByRole("cell", { name: "reconciled-with-loss", exact: true }),
  ).toBeVisible();
  await expect(
    tr.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  for (const [condition, ref, remaining] of [
    ["quarantine", "BROWSER-FOUND-1", 1],
    ["damaged", "BROWSER-FOUND-2", 0],
  ] as const) {
    await tr
      .getByRole("button", { name: "Recover lost stock", exact: true })
      .click();
    await expect(page.getByLabel("Condition", { exact: true })).toHaveValue(
      "quarantine",
    );
    await page.getByLabel("Units found", { exact: true }).fill("1");
    await page
      .getByLabel("Recovery reference (unique per portion)", { exact: true })
      .fill(ref);
    await page.getByLabel("Destination bin", { exact: true }).fill("Q-1");
    await page.getByLabel("Condition", { exact: true }).selectOption(condition);
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Carrier located missing carton; condition recorded");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tr).toContainText(
      `BROWSER-LOSS-1 · 2 loss approved · ${remaining} unrecovered`,
    );
    await expect(tr).toContainText(`${ref} · 1 recovered ${condition}`);
  }
  await expect(
    tr.getByRole("cell", { name: "received", exact: true }),
  ).toBeVisible();
  await expect(
    tr.getByRole("button", { name: "Recover lost stock", exact: true }),
  ).toHaveCount(0);
  const transfers = await (await page.request.get("/api/transfers")).json();
  const transfer = transfers.find((r: any) =>
    r.lines[0].losses.some((l: any) => l.loss_ref === "BROWSER-LOSS-1"),
  );
  const line = transfer.lines[0];
  expect(line.losses).toHaveLength(1);
  expect(line.losses[0].recoveries).toHaveLength(2);
  expect(line.receipts).toHaveLength(1);
  expect(
    line.receivedQuantity + line.remainingQuantity + line.lostQuantity,
  ).toBe(3);
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const positions = dashboard.stock.filter(
    (u: any) => u.product_id === line.product_id,
  );
  expect(positions.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(
    4,
  );
  expect(
    positions.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(4000);
  expect(positions.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(
    2,
  );
  expect(errors).toEqual([]);
});

test("browser: warehouse count observation survives reload, administrator retry applies once, and stale stock requires rejection/recount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (admin: boolean) => {
    await page
      .getByLabel("Email", { exact: true })
      .fill(admin ? "admin@example.test" : "source@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(admin ? "long-test-only-password" : "long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(page, "Inventory");
  };
  await page.goto("/");
  await login(false);
  const lot = page
    .getByRole("row")
    .filter({ hasText: "COUNT-1" })
    .filter({
      has: page.getByRole("button", { name: "Start count", exact: true }),
    });
  await lot.getByRole("button", { name: "Start count", exact: true }).click();
  await page
    .getByLabel("Count reference (unique)", { exact: true })
    .fill("BROWSER-COUNT");
  await next(page);
  const count = page.getByRole("row").filter({ hasText: "BROWSER-COUNT" });
  await count
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  await page.getByLabel("Physical units observed", { exact: true }).fill("5");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("One carton absent from the counted bin");
  await next(page);
  await expect(count).toContainText("submitted");
  await expect(
    count.getByRole("button", { name: "Approve count", exact: true }),
  ).toHaveCount(0);
  await expect(lot).toContainText("6 / 0 / 6");
  await page.reload();
  await nav(page, "Inventory");
  await expect(count).toContainText("6 expected · 5 observed");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(true);
  let lost = false;
  await page.route("**/api/commands/count.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await count
    .getByRole("button", { name: "Approve count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Supervisor verified the count evidence");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(count).toContainText("approved");
  await expect(lot).toContainText("5 / 0 / 5");
  await lot.getByRole("button", { name: "Start count", exact: true }).click();
  await page
    .getByLabel("Count reference (unique)", { exact: true })
    .fill("BROWSER-STALE");
  await next(page);
  const stale = page.getByRole("row").filter({ hasText: "BROWSER-STALE" });
  await stale
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  await page.getByLabel("Physical units observed", { exact: true }).fill("4");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Observation before later inspection");
  await next(page);
  await lot.getByRole("button", { name: "Inspect", exact: true }).click();
  await page
    .getByLabel("Condition", { exact: true })
    .selectOption("quarantine");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Inspection changed stock after count cutoff");
  await next(page);
  await stale
    .getByRole("button", { name: "Approve count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Try stale approval");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Stock changed after the count cutoff",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await stale
    .getByRole("button", { name: "Reject count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Recount required after inspection");
  await next(page);
  await expect(stale).toContainText("rejected");
  await expect(lot).toContainText("5 / 0 / 0");
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const product = dashboard.products.find((p: any) => p.sku === "COUNT-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(5);
  expect(
    stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(5000);
  expect(stock.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(0);
  const counts = await (await page.request.get("/api/counts")).json();
  expect(
    counts.find((c: any) => c.count_ref === "BROWSER-COUNT").result.adjustment
      .valueDelta,
  ).toBe(-1000);
  expect(
    counts.find((c: any) => c.count_ref === "BROWSER-STALE").result.adjustment,
  ).toBe(null);
  expect(errors).toEqual([]);
});

test("browser: supplier handover retries one physical removal, preserves purchase totals and pending credit, and warehouse users see evidence without approval", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (admin: boolean) => {
    await page
      .getByLabel("Email", { exact: true })
      .fill(admin ? "admin@example.test" : "source@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(admin ? "long-test-only-password" : "long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(page, "Purchasing");
  };
  await page.goto("/");
  await login(true);
  const receipt = page
    .getByRole("row")
    .filter({ hasText: "SUPPLIER-RETURN-STOCK" });
  await expect(receipt).toContainText("6 purchased · 0 returned");
  await receipt
    .getByRole("button", { name: "Return to supplier", exact: true })
    .click();
  await page.getByLabel("Units handed over", { exact: true }).fill("2");
  await page
    .getByLabel("Supplier return reference (unique)", { exact: true })
    .fill("BROWSER-SUPRET");
  await page
    .getByLabel("Supplier handover evidence", { exact: true })
    .fill("Synthetic courier handover receipt");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Supplier accepted two defective cartons");
  let discarded = false;
  await page.route("**/api/commands/purchase.return", async (route) => {
    if (!discarded) {
      discarded = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(receipt).toContainText("6 purchased · 2 returned");
  await expect(receipt).toContainText("4 unreserved");
  const history = page.getByRole("row").filter({ hasText: "BROWSER-SUPRET" });
  await expect(history).toContainText("2 units");
  await expect(history).toContainText("Supplier credit pending");
  await expect(history).toContainText("Synthetic courier handover receipt");
  await page.reload();
  await nav(page, "Purchasing");
  await expect(history).toHaveCount(1);
  await expect(receipt).toContainText("6 purchased · 2 returned");
  const purchases = await (await page.request.get("/api/purchases")).json();
  const original = purchases.receipts.find(
    (r: any) => r.delivery_ref === "SUPPLIER-RETURN-STOCK",
  );
  const po = purchases.orders.find((r: any) => r.id === original.po_id);
  expect(po.state).toBe("received");
  expect(po.lines[0].received).toBe(6);
  const returned = purchases.returns.filter(
    (r: any) => r.return_ref === "BROWSER-SUPRET",
  );
  expect(returned).toHaveLength(1);
  expect(returned[0].quantity * returned[0].unit_cost).toBe(2000);
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const product = dashboard.products.find((p: any) => p.sku === "SUPRET-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((s: number, u: any) => s + u.quantity, 0)).toBe(4);
  expect(stock.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    4000,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(false);
  await expect(history).toContainText("Supplier credit pending");
  await expect(
    receipt.getByRole("button", { name: "Return to supplier", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: unpaid documents reconcile historical amounts, retain blocked reviews and recover one approval before collecting new cash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/dashboard")).json(),
    buyer = before.accounts.find((a: any) => a.name === "Synthetic buyer"),
    product = before.products.find((p: any) => p.sku === "EQ-1"),
    effectsBefore = await (await page.request.get("/api/effects")).json();
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "BROWSER-DOC-1",
      accountId: buyer.id,
      number: "BROWSER-LEGACY-001",
      issuedAt: "2026-08-01T00:00:00.000Z",
      dueAt: "2026-08-31T00:00:00.000Z",
      net: 20000,
      tax: 2600,
      total: 22600,
      credited: 11300,
      paid: 4000,
      refunded: 1000,
      balance: 8300,
      lines: [
        {
          productId: product.id,
          description: "Original equipment description",
          quantity: 2,
          unitPrice: 10000,
          unitTax: 1300,
          creditedQuantity: 1,
        },
      ],
    },
  ];
  const dryRun = async (batchRef: string, balance: number) => {
    await page
      .getByRole("button", { name: "Dry run unpaid documents", exact: true })
      .click();
    for (const [label, value] of [
      ["Batch reference (new for each correction)", batchRef],
      [
        "Source dataset reference (keep for corrected batches)",
        "BROWSER-DOCUMENTS-CUTOFF",
      ],
      ["Original source SHA-256", "d".repeat(64)],
      ["Source cutoff (UTC)", "2026-09-01T00:00:00.000Z"],
      ["Independent document count", "1"],
      ["Independent original net (CAD cents)", "20000"],
      ["Independent original tax (CAD cents)", "2600"],
      ["Independent historical credits (CAD cents)", "11300"],
      ["Independent historical payments (CAD cents)", "4000"],
      ["Independent historical refunds (CAD cents)", "1000"],
      ["Independent outstanding balance (CAD cents)", String(balance)],
      [
        "Source rights, mapping and cutoff evidence",
        "Synthetic frozen original invoice and independent financial totals reviewed",
      ],
      ["Unpaid document rows (JSON)", JSON.stringify(rows)],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-DOCUMENTS-BLOCKED", 8301);
  const blocked = page.getByRole("region", {
    name: "Document batch BROWSER-DOCUMENTS-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independent source totals",
  );
  await expect(
    blocked.getByRole("button", {
      name: "Approve document batch",
      exact: true,
    }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject document batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Correct the independent balance in a new batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-DOCUMENTS-READY", 8300);
  const review = page.getByRole("region", {
    name: "Document batch BROWSER-DOCUMENTS-READY",
    exact: true,
  });
  await expect(review).toContainText(
    "1 documents. Eligible: 1 documents. 0 review issues",
  );
  await expect(review).toContainText('"creditedQuantity":1');
  expect(
    (await (await page.request.get("/api/dashboard")).json()).invoices,
  ).toHaveLength(before.invoices.length);
  let lost = false;
  await page.route("**/api/commands/import.documents.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await review
    .getByRole("button", { name: "Approve document batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill(
      "Reviewed original amounts and historical settlements against independent source",
    );
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(review).toContainText("applied");
  await expect(blocked).toContainText("rejected");
  await page.reload();
  await nav(page, "Imports");
  await expect(review).toContainText("applied");
  const batches = await (
      await page.request.get("/api/imports/documents")
    ).json(),
    applied = batches.find(
      (b: any) => b.batchRef === "BROWSER-DOCUMENTS-READY",
    );
  expect(applied.result.mappings).toHaveLength(1);
  expect(applied.result.value).toBe(8300);
  const after = await (await page.request.get("/api/dashboard")).json(),
    imported = after.invoices.find(
      (i: any) => i.number === "BROWSER-LEGACY-001",
    );
  expect(after.invoices).toHaveLength(before.invoices.length + 1);
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.shipments).toEqual(before.shipments);
  expect(await (await page.request.get("/api/effects")).json()).toEqual(
    effectsBefore,
  );
  expect(imported).toMatchObject({
    origin: "opening",
    total: 22600,
    credited: 11300,
    paid: 4000,
    refunded: 1000,
    balance: 8300,
    order_id: null,
    shipment_id: null,
  });
  expect(imported.lines[0]).toMatchObject({
    quantity: 2,
    historical_credited_quantity: 1,
    credited_quantity: 1,
    creditable_quantity: 1,
  });
  await nav(page, "Billing");
  const invoice = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-LEGACY-001" });
  await expect(invoice).toContainText("Historical opening document");
  await expect(invoice).toContainText("BROWSER-DOC-1");
  await expect(invoice).toContainText("$226.00");
  await expect(invoice).toContainText("$83.00");
  await invoice
    .getByRole("button", { name: "Credit units", exact: true })
    .click();
  await expect(page.getByLabel("Invoice line", { exact: true })).toContainText(
    "2 invoiced · 1 credited · 1 remaining",
  );
  await page.getByLabel("Units to credit", { exact: true }).fill("2");
  await page
    .getByLabel("Unique business reference", { exact: true })
    .fill("BROWSER-OVER-CREDIT");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Attempt exceeds the historical remaining units");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "remaining invoiced quantity",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await invoice
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page.getByLabel("Amount in cents", { exact: true }).fill("1000");
  await page
    .getByLabel("Bank / payment reference", { exact: true })
    .fill("BROWSER-POST-CUTOFF-CASH");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Verified new bank receipt after migration cutoff");
  await next(page);
  await expect(invoice).toContainText("$73.00");
  const updated = await (await page.request.get("/api/dashboard")).json(),
    paid = updated.invoices.find((i: any) => i.id === imported.id);
  expect(paid).toMatchObject({ paid: 5000, refunded: 1000, balance: 7300 });
  const csv = await (await page.request.get("/api/accounting.csv")).text();
  expect(csv).toContain('"origin","source_ref","source_id","cutoff_at"');
  expect(csv).toContain('"BROWSER-DOCUMENTS-CUTOFF","BROWSER-DOC-1"');
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/imports/documents")).status()).toBe(403);
  expect(errors).toEqual([]);
});

test("browser: billing profiles, immutable PDF retries, credit downloads and aging exports show prepared evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/dashboard")).json();
  const invoice = before.invoices.find(
    (i: any) => i.number === "BROWSER-LEGACY-001",
  );
  const downloadsBefore = await (
    await page.request.get("/api/billing/downloads")
  ).json();
  await nav(page, "Billing");
  const issuerName = (
    await (await page.request.get("/api/billing/profiles")).json()
  ).issuer.name;
  const profileRow = page
    .getByRole("row")
    .filter({ hasText: issuerName })
    .filter({
      has: page.getByRole("button", {
        name: "Edit billing details",
        exact: true,
      }),
    });
  await profileRow
    .getByRole("button", { name: "Edit billing details", exact: true })
    .click();
  await page
    .getByLabel("Billing name", { exact: true })
    .fill("Distributeur Québec navigateur");
  await page
    .getByLabel("Billing address", { exact: true })
    .fill("123 rue de Québec\nMontréal QC");
  await page
    .getByLabel("Tax registration", { exact: true })
    .fill("SYNTHETIC-TAX");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic browser billing identity review");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Distributeur Québec navigateur" }),
  ).toContainText("Montréal QC");
  const invoiceRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-LEGACY-001" })
    .filter({
      has: page.getByRole("button", {
        name: "Download invoice PDF",
        exact: true,
      }),
    });
  let lost = false;
  let preparedHash = "";
  let preparedReceipt = "";
  await page.route(
    `**/api/billing/documents/invoice/${invoice.id}/pdf`,
    async (route) => {
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        preparedHash = response.headers()["x-document-sha256"]!;
        preparedReceipt = response.headers()["x-download-receipt"]!;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await invoiceRow
    .getByRole("button", { name: "Download invoice PDF", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await invoiceRow
    .getByRole("button", { name: "Download invoice PDF", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Invoice_BROWSER-LEGACY-001.pdf");
  const bytes = await readFile((await download.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(preparedHash);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const parts = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const text = await (await pdf.getPage(n)).getTextContent();
    parts.push(text.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  await task.destroy();
  expect(parts.join(" ")).toContain("Distributeur Québec navigateur");
  expect(parts.join(" ")).toContain("CAD 226.00");
  expect(parts.join(" ")).toContain("not the original source PDF");
  expect(parts.join(" ")).toContain("original identities unavailable");
  await expect(
    page.getByRole("heading", {
      name: "Prepared document downloads",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "PDF download prepared. Receipt does not confirm delivery.",
      { exact: true },
    ),
  ).toBeVisible();
  const receipts = await (
    await page.request.get("/api/billing/downloads")
  ).json();
  expect(receipts).toHaveLength(downloadsBefore.length + 1);
  expect(receipts[0]).toMatchObject({
    id: preparedReceipt,
    state: "prepared",
    content_hash: preparedHash,
  });
  const creditPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download credit PDF", exact: true })
    .first()
    .click();
  const credit = await creditPromise;
  expect(credit.suggestedFilename()).toMatch(/^Credit_.*\.pdf$/);
  expect(
    (await readFile((await credit.path())!)).subarray(0, 5).toString(),
  ).toBe("%PDF-");
  const csvPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export aging CSV", exact: true })
    .click();
  const csv = await csvPromise;
  const csvText = await readFile((await csv.path())!, "utf8");
  expect(csvText).toContain('"days_31_60_cents"');
  expect(csvText).toContain('"pending_refunds_cents"');
  expect(errors).toEqual([]);
});

test("browser: provision/change password, retry one grant review, deactivate/reactivate, reset and revoke sessions", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = "browser-lifecycle@example.test",
    initial = "browser-initial-password",
    changed = "browser-changed-password",
    reset = "browser-reset-password",
    final = "browser-final-password";
  const signIn = async (
    p: Page,
    address: string,
    secret: string,
    heading = "Overview",
  ) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(address);
    await p.getByLabel("Password", { exact: true }).fill(secret);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  };
  const passwordChange = async (p: Page, current: string, value: string) => {
    await p.getByLabel("Current password", { exact: true }).fill(current);
    await p
      .getByLabel("New password (14–256 characters)", { exact: true })
      .fill(value);
    await p.getByLabel("Confirm new password", { exact: true }).fill(value);
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      p.getByRole("heading", {
        name: "Sign in to your workspace",
        exact: true,
      }),
    ).toBeVisible();
  };
  await signIn(page, "admin@example.test", "long-test-only-password");
  await nav(page, "Administration");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Browser lifecycle operator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Initial password (14+ characters)", { exact: true })
    .fill(initial);
  await page
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await page.getByLabel("Role", { exact: true }).selectOption("warehouse");
  await page
    .getByLabel("Permitted warehouses", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Password change required");
  const workerContext = await browser.newContext(),
    secondContext = await browser.newContext();
  try {
    const worker = await workerContext.newPage(),
      second = await secondContext.newPage();
    worker.on("pageerror", (error) => errors.push(error.message));
    await signIn(worker, email, initial, "Change initial password");
    expect((await worker.request.get("/api/dashboard")).status()).toBe(403);
    await passwordChange(worker, initial, changed);
    await signIn(worker, email, changed);
    await signIn(second, email, changed);
    expect((await worker.request.get("/api/users")).status()).toBe(403);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("v2");
    let discarded = false;
    const keys: string[] = [];
    await page.route("**/api/commands/user.update", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!discarded) {
        discarded = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await row
      .getByRole("button", {
        name: "Edit access: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Permitted warehouses", { exact: true })
      .selectOption({ label: "Ottawa" });
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic reassignment to Ottawa");
    await next(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Failed to fetch",
    );
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await page.unroute("**/api/commands/user.update");
    const users = await (await page.request.get("/api/users")).json(),
      u = users.find((u: any) => u.email === email);
    expect(u.revision).toBe(3);
    expect(u.sessions).toBe(0);
    await expect(row).toContainText("Ottawa");
    for (const p of [worker, second])
      expect((await p.request.get("/api/session")).status()).toBe(401);
    const reviews = await (await page.request.get("/api/audit")).json();
    expect(
      reviews.filter(
        (a: any) => a.action === "user.access.changed" && a.reference === u.id,
      ),
    ).toHaveLength(1);
    const status = async (active: boolean) => {
      await row
        .getByRole("button", {
          name: "Edit access: Browser lifecycle operator",
          exact: true,
        })
        .click();
      await page.getByLabel("Active user", { exact: true }).setChecked(active);
      await page
        .getByLabel("Your current password", { exact: true })
        .fill("long-test-only-password");
      await page
        .getByLabel("Reason / evidence", { exact: true })
        .fill(
          active
            ? "Synthetic reviewed reactivation"
            : "Synthetic access suspension",
        );
      await next(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await status(false);
    await expect(row).toContainText("Inactive");
    const denied = await worker.request.post("/api/login", {
      headers: { origin: "http://127.0.0.1:3117" },
      data: { email, password: changed },
    });
    expect(denied.status()).toBe(401);
    await status(true);
    await signIn(worker, email, changed);
    await row
      .getByRole("button", {
        name: "Reset password: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("New initial password (14+ characters)", { exact: true })
      .fill(reset);
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic help desk reset");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await worker.request.get("/api/session")).status()).toBe(401);
    await signIn(worker, email, reset, "Change initial password");
    await passwordChange(worker, reset, final);
    await signIn(worker, email, final);
    await signIn(second, email, final);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("v7");
    await row
      .getByRole("button", {
        name: "Revoke sessions: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic all-device revocation");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const p of [worker, second])
      expect((await p.request.get("/api/session")).status()).toBe(401);
    await signIn(worker, email, final);
    await nav(worker, "Security");
    await worker
      .getByRole("button", { name: "End all my sessions", exact: true })
      .click();
    await worker
      .getByRole("dialog")
      .getByRole("button", { name: "End sessions", exact: true })
      .click();
    await expect(
      worker.getByRole("heading", {
        name: "Sign in to your workspace",
        exact: true,
      }),
    ).toBeVisible();
    expect((await worker.request.get("/api/session")).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    await workerContext.close();
    await secondContext.close();
  }
});
