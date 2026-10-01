import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
test("browser: reviewed stock QR downloads retain one receipt after a lost response and leave stock unchanged", async ({
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
  const u = before.stock.find(
    (s: any) => s.state === "stock" && s.quantity > 0 && s.serial,
  );
  expect(u).toBeTruthy();
  const history = await (await page.request.get("/api/stock/labels")).json();
  let lost = false;
  const keys: string[] = [];
  await page.route(`**/api/stock/${u.id}/label`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await nav(page, "Inventory");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator("small", { hasText: `${u.serial} · stock` }) });
  await row
    .getByRole("button", { name: "Prepare QR label", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Prepare stock QR label",
    exact: true,
  });
  await expect(dialog).toContainText(u.serial);
  await dialog
    .getByLabel("Copies (including deliberate duplicates)", { exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Prepare and download", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Prepare and download", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`Stock_${u.id}.pdf`);
  const bytes = await readFile((await download.path())!);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  expect(pdf.numPages).toBe(2);
  await task.destroy();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const receipts = await (await page.request.get("/api/stock/labels")).json();
  expect(receipts.length).toBe(history.length + 1);
  expect(receipts[0].unit_id).toBe(u.id);
  expect(receipts[0].copies).toBe(2);
  expect(receipts[0].state).toBe("prepared");
  expect(receipts[0].content_hash).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const after = await (await page.request.get("/api/dashboard")).json();
  expect(after.stock).toEqual(before.stock);
  expect(errors).toEqual([]);
});
async function installScanHarness(page: Page) {
  // Real local MediaStream lifetime, synthetic decoding/permission outcomes; no physical camera claim.
  await page.addInitScript(() => {
    const harness: any = {
      queue: [],
      requests: 0,
      stops: 0,
      mode: "allow",
      resolve: null,
    };
    (window as any).__scanHarness = harness;
    class SyntheticDetector {
      static async getSupportedFormats() {
        return ["code_128", "qr_code"];
      }
      async detect() {
        return (harness.queue.shift() ?? []).map((rawValue: string) => ({
          rawValue,
        }));
      }
    }
    harness.detector = SyntheticDetector;
    (window as any).BarcodeDetector = SyntheticDetector;
    const capture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.fillRect(0, 0, 100, 100);
      const stream = canvas.captureStream(10);
      const timer = setInterval(() => context.fillRect(0, 0, 100, 100), 50);
      const track = stream.getTracks()[0]!,
        original = track.stop.bind(track);
      track.stop = () => {
        harness.stops++;
        clearInterval(timer);
        original();
      };
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        harness.requests++;
        if (harness.mode === "deny")
          throw new DOMException("Synthetic denial", "NotAllowedError");
        if (harness.mode === "pending")
          return new Promise((resolve) => {
            harness.resolve = () => resolve(capture());
          });
        return capture();
      },
    });
  });
}
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

test("browser: receipt scans save without stock, resume after reload, review camera values and retry one confirmed receipt", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installScanHarness(page);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Catalog");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("SKU", { exact: true }).fill("BROWSER-SCAN");
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Synthetic scanned equipment");
  await page.getByLabel("Unit price in cents", { exact: true }).fill("10000");
  await page
    .getByLabel("Tax rate in basis points", { exact: true })
    .fill("1300");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Purchasing");
  await page
    .getByRole("button", { name: "Purchase order", exact: true })
    .click();
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await page
    .getByLabel("Product", { exact: true })
    .selectOption({ label: "BROWSER-SCAN · Synthetic scanned equipment" });
  await page.getByLabel("Units", { exact: true }).fill("2");
  await page.getByLabel("Unit cost in cents", { exact: true }).fill("6000");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const poRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-SCAN · 0/2 received" });
  await poRow
    .getByRole("button", { name: "Start receipt draft", exact: true })
    .click();
  await page
    .getByLabel("Supplier delivery reference", { exact: true })
    .fill("BROWSER-SCAN-DELIVERY");
  await page
    .getByLabel("Observed SKU on delivery", { exact: true })
    .fill("WRONG-SKU");
  await page.getByLabel("Units", { exact: true }).fill("2");
  await page
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill("BROWSER-D1");
  await page.getByLabel("Receiving bin", { exact: true }).fill("SCAN-BIN");
  const saveDraft = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
  await saveDraft();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Observed SKU",
  );
  const skuScanner = page.getByRole("region", {
    name: "Scanner for Observed SKU on delivery",
    exact: true,
  });
  await page.evaluate(() =>
    (window as any).__scanHarness.queue.push(["BROWSER-SCAN"]),
  );
  await skuScanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(skuScanner).toContainText("Detected: BROWSER-SCAN");
  await expect(
    page.getByLabel("Observed SKU on delivery", { exact: true }),
  ).toHaveValue("WRONG-SKU");
  await skuScanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(
    page.getByLabel("Observed SKU on delivery", { exact: true }),
  ).toHaveValue("BROWSER-SCAN");
  expect(await page.evaluate(() => (window as any).__scanHarness.stops)).toBe(
    1,
  );
  const saveKeys: string[] = [];
  await page.route("**/api/commands/purchase.draft.save", async (route) => {
    saveKeys.push(route.request().headers()["idempotency-key"]!);
    if (saveKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await saveDraft();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await saveDraft();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saveKeys).toHaveLength(2);
  expect(saveKeys[0]).toBe(saveKeys[1]);
  await page.unroute("**/api/commands/purchase.draft.save");
  const draftRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-SCAN-DELIVERY" });
  await expect(draftRow).toContainText("draft · v1");
  await expect(poRow).toContainText("0/2 received");
  await page.reload();
  await nav(page, "Purchasing");
  await draftRow
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "exactly one unique serial",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await draftRow
    .getByRole("button", { name: "Resume scans", exact: true })
    .click();
  const serials = page.getByLabel("Serials, one per line (blank for bulk)", {
    exact: true,
  });
  await expect(serials).toHaveValue("BROWSER-D1");
  const scanner = page.getByRole("region", {
    name: "Scanner for Serials, one per line (blank for bulk)",
    exact: true,
  });
  const detect = async (values: string[]) => {
    await page.evaluate(
      (values) => (window as any).__scanHarness.queue.push(values),
      values,
    );
    await scanner
      .getByRole("button", { name: "Scan with camera", exact: true })
      .click();
  };
  await detect(["BROWSER-D1", "BROWSER-D2"]);
  await expect(scanner).toContainText("More than one label");
  await page.evaluate(() =>
    (window as any).__scanHarness.queue.push(["BROWSER-D1"]),
  );
  await expect(scanner).toContainText("Detected: BROWSER-D1");
  await scanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(scanner).toContainText("already in the list");
  await expect(serials).toHaveValue("BROWSER-D1");
  await detect(["BROWSER-D2"]);
  await expect(scanner).toContainText("Detected: BROWSER-D2");
  await scanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(serials).toHaveValue("BROWSER-D1\nBROWSER-D2");
  await saveDraft();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(draftRow).toContainText("draft · v2");
  const confirmKeys: string[] = [];
  await page.route("**/api/commands/purchase.draft.confirm", async (route) => {
    confirmKeys.push(route.request().headers()["idempotency-key"]!);
    if (confirmKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await draftRow
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "BROWSER-D1, BROWSER-D2",
  );
  const receive = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Receive stock", exact: true })
      .click();
  await receive();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await receive();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(confirmKeys).toHaveLength(2);
  expect(confirmKeys[0]).toBe(confirmKeys[1]);
  const savedRow = draftRow.filter({ hasText: "received · v3" });
  await expect(savedRow).toHaveCount(1);
  const purchases = await (await page.request.get("/api/purchases")).json();
  const draft = purchases.drafts.find(
    (d: any) => d.delivery_ref === "BROWSER-SCAN-DELIVERY",
  );
  expect(
    purchases.receipts.filter((r: any) => r.po_id === draft.po_id),
  ).toHaveLength(1);
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const stock = dashboard.stock.filter((u: any) =>
    ["BROWSER-D1", "BROWSER-D2"].includes(u.serial),
  );
  expect(stock).toHaveLength(2);
  expect(stock.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    12000,
  );
  expect(stock.every((u: any) => u.condition === "quarantine")).toBe(true);
  await savedRow
    .getByRole("button", { name: "View draft history", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("v1 · draft");
  await expect(page.getByRole("dialog")).toContainText("v3 · received");
  expect(errors).toEqual([]);
});

test("browser: camera fallback, Enter suffix and cancelled pending access preserve manual entry and release late streams", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installScanHarness(page);
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
  const open = () =>
    page.getByRole("button", { name: "Find serial", exact: true }).click();
  await open();
  const scanner = page.getByRole("region", {
    name: "Scanner for Scan or enter serial",
    exact: true,
  });
  await page.evaluate(() => {
    (window as any).BarcodeDetector = undefined;
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner).toContainText("unavailable in this browser");
  expect(
    await page.evaluate(() => (window as any).__scanHarness.requests),
  ).toBe(0);
  await page.getByLabel("Scan or enter serial", { exact: true }).fill("S1");
  await page.getByLabel("Scan or enter serial", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Serial history", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).BarcodeDetector = (window as any).__scanHarness.detector;
    (window as any).__scanHarness.mode = "deny";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner).toContainText("Camera access unavailable");
  await expect(
    page.getByLabel("Scan or enter serial", { exact: true }),
  ).toHaveValue("S1");
  await page.evaluate(() => {
    (window as any).__scanHarness.mode = "pending";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as any).__scanHarness.resolve)),
    )
    .toBe(true);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.evaluate(() => (window as any).__scanHarness.resolve());
  await expect
    .poll(() => page.evaluate(() => (window as any).__scanHarness.stops))
    .toBe(1);
  await open();
  await page.evaluate(() => {
    (window as any).__scanHarness.mode = "allow";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner.getByRole("status")).toContainText("Show one label");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__scanHarness.stops))
    .toBe(2);
  expect(errors).toEqual([]);
});

test("browser: customer inbox review, cancellation and lost responses preserve explicit personal receipt and withdrawal history", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const origin = "http://127.0.0.1:3117";
  const initial = "inbox-initial-password",
    password = "inbox-changed-password";
  const signIn = async (
    p: Page,
    email: string,
    secret: string,
    heading = "Overview",
  ) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(secret);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  };
  const cmd = async (name: string, data: unknown) => {
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin,
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const inbox = async (p = page) =>
    (await p.request.get("/api/billing/inbox")).json();
  await signIn(page, "admin@example.test", "long-test-only-password");
  const account = await cmd("account.create", {
    name: "Browser inbox customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const other = await cmd("account.create", {
    name: "Browser other inbox customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "INBOX-BROWSER",
    name: "Synthetic inbox equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const warehouseId = dashboard.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const orders = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: orders.orders.find((x: any) => x.id === po.id).lines[0].id,
    deliveryRef: "BROWSER-INBOX-DELIVERY",
    quantity: 2,
    serials: [],
    bin: "INBOX",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await (await page.request.get("/api/dashboard")).json();
  const pack = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((x: any) => x.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: pack.id,
    handoverEvidence: "Synthetic inbox handover",
  });
  for (const [suffix, accountId] of [
    ["buyer", account.id],
    ["colleague", account.id],
    ["other", other.id],
  ])
    await cmd("user.create", {
      email: `inbox-${suffix}@example.test`,
      name: `Inbox ${suffix}`,
      password: initial,
      role: "buyer",
      accountId,
      sites: [],
      currentPassword: "long-test-only-password",
    });
  const before = await (await page.request.get("/api/dashboard")).json();
  const invoice = before.invoices.find((i: any) => i.id === shipped.invoiceId);
  expect(invoice.total).toBe(22600);
  await page.reload();
  await nav(page, "Billing");
  const invoiceRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Download invoice PDF",
        exact: true,
      }),
    })
    .filter({ hasText: invoice.number });
  const review = async () => {
    const event = page.waitForEvent("download");
    await invoiceRow
      .getByRole("button", { name: "Review and publish invoice", exact: true })
      .click();
    const download = await event;
    const bytes = await readFile((await download.path())!);
    await expect(
      page.getByRole("dialog", { name: "Publish reviewed PDF", exact: true }),
    ).toBeVisible();
    return bytes;
  };
  const original = await review();
  const hash = createHash("sha256").update(original).digest("hex");
  await expect(page.getByRole("dialog")).toContainText(
    "buyer must separately confirm receipt",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (await inbox()).filter((p: any) => p.document_id === invoice.id),
  ).toHaveLength(0);
  expect(await review()).toEqual(original);
  const publishKeys: string[] = [];
  await page.route("**/api/commands/billing.portal.publish", async (route) => {
    publishKeys.push(route.request().headers()["idempotency-key"]!);
    if (publishKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("dialog")
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic finance review of original customer PDF");
  const publish = page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish to customer inbox", exact: true });
  await publish.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await publish.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(publishKeys).toHaveLength(2);
  expect(publishKeys[0]).toBe(publishKeys[1]);
  await page.unroute("**/api/commands/billing.portal.publish");
  const publications = (await inbox()).filter(
    (p: any) => p.document_id === invoice.id,
  );
  expect(publications).toHaveLength(1);
  const publication = publications[0];
  expect(publication.content_hash).toBe(hash);
  expect(publication.acknowledgments).toHaveLength(0);
  const contexts = [];
  try {
    const buyerContext = await browser.newContext();
    contexts.push(buyerContext);
    const buyer = await buyerContext.newPage();
    const loginBuyer = async (p: Page, suffix: string) => {
      await signIn(
        p,
        `inbox-${suffix}@example.test`,
        initial,
        "Change initial password",
      );
      await p.getByLabel("Current password", { exact: true }).fill(initial);
      await p
        .getByLabel("New password (14–256 characters)", { exact: true })
        .fill(password);
      await p
        .getByLabel("Confirm new password", { exact: true })
        .fill(password);
      await p
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(
        p.getByRole("heading", {
          name: "Sign in to your workspace",
          exact: true,
        }),
      ).toBeVisible();
      await signIn(p, `inbox-${suffix}@example.test`, password);
      await nav(p, "Billing");
    };
    await loginBuyer(buyer, "buyer");
    const otherContext = await browser.newContext();
    contexts.push(otherContext);
    const otherBuyer = await otherContext.newPage();
    await loginBuyer(otherBuyer, "other");
    expect(await inbox(otherBuyer)).toEqual([]);
    await expect(
      otherBuyer.getByRole("row").filter({ hasText: invoice.number }),
    ).toHaveCount(0);
    const buyerRow = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    const downloadKeys: string[] = [];
    await buyer.route(
      `**/api/billing/inbox/${publication.id}/pdf`,
      async (route) => {
        downloadKeys.push(route.request().headers()["idempotency-key"]!);
        if (downloadKeys.length === 1) {
          const response = await route.fetch(),
            headers = response.headers();
          delete headers["x-download-receipt"];
          await route.fulfill({ response, headers });
        } else if (downloadKeys.length === 2) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    const downloadButton = buyerRow.getByRole("button", {
      name: "Download and review receipt",
      exact: true,
    });
    await downloadButton.click();
    await expect(buyer.getByRole("alert")).toContainText(
      "Download receipt is missing",
    );
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await downloadButton.click();
    await expect(buyer.getByRole("alert")).toBeVisible();
    const event = buyer.waitForEvent("download");
    await downloadButton.click();
    const downloaded = await event;
    expect(await readFile((await downloaded.path())!)).toEqual(original);
    await expect(
      buyer.getByRole("dialog", {
        name: "Confirm document receipt",
        exact: true,
      }),
    ).toBeVisible();
    expect(downloadKeys).toHaveLength(3);
    expect(new Set(downloadKeys).size).toBe(1);
    let current = (await inbox())[0];
    expect(current.downloads).toHaveLength(1);
    expect(current.downloads[0].state).toBe("prepared");
    expect(current.acknowledgments).toHaveLength(0);
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await inbox())[0].acknowledgments).toHaveLength(0);
    const confirmDownload = buyer.waitForEvent("download");
    await downloadButton.click();
    await confirmDownload;
    const confirmDialog = buyer.getByRole("dialog", {
      name: "Confirm document receipt",
      exact: true,
    });
    await expect(confirmDialog).toContainText(
      "does not confirm payment or agreement",
    );
    const ackKeys: string[] = [];
    await buyer.route(
      "**/api/commands/billing.portal.acknowledge",
      async (route) => {
        ackKeys.push(route.request().headers()["idempotency-key"]!);
        if (ackKeys.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await confirmDialog
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(confirmDialog.getByRole("alert")).toBeVisible();
    await confirmDialog
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(confirmDialog).toHaveCount(0);
    expect(ackKeys).toHaveLength(2);
    expect(ackKeys[0]).toBe(ackKeys[1]);
    current = (await inbox())[0];
    expect(current.acknowledgments).toHaveLength(1);
    expect(current.acknowledgments[0].content_hash).toBe(hash);
    expect(current.acknowledgments[0].actor_name).toBe("Inbox buyer");
    const received = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download received PDF",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    const again = buyer.waitForEvent("download");
    await received
      .getByRole("button", { name: "Download received PDF", exact: true })
      .click();
    await again;
    await expect(
      received.getByRole("button", {
        name: "Download received PDF",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    expect((await inbox())[0].acknowledgments).toHaveLength(1);
    const colleagueContext = await browser.newContext();
    contexts.push(colleagueContext);
    const colleague = await colleagueContext.newPage();
    await loginBuyer(colleague, "colleague");
    const personal = (await inbox(colleague)).find(
      (p: any) => p.id === publication.id,
    );
    expect(personal.downloads).toHaveLength(0);
    expect(personal.acknowledgments).toHaveLength(0);
    await expect(
      colleague
        .getByRole("row")
        .filter({
          has: colleague.getByRole("button", {
            name: "Download and review receipt",
            exact: true,
          }),
        })
        .filter({ hasText: invoice.number }),
    ).toContainText("Awaiting buyer confirmation");
    await page.reload();
    await nav(page, "Billing");
    const staffRow = page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Withdraw publication",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    await expect(staffRow).toContainText("Inbox buyer");
    await staffRow
      .getByRole("button", { name: "Withdraw publication", exact: true })
      .click();
    const withdrawDialog = page.getByRole("dialog", {
      name: "Withdraw portal publication",
      exact: true,
    });
    await withdrawDialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic routing correction");
    const withdrawalKeys: string[] = [];
    await page.route(
      "**/api/commands/billing.portal.withdraw",
      async (route) => {
        withdrawalKeys.push(route.request().headers()["idempotency-key"]!);
        if (withdrawalKeys.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await withdrawDialog
      .getByRole("button", { name: "Withdraw from inbox", exact: true })
      .click();
    await expect(withdrawDialog.getByRole("alert")).toBeVisible();
    await withdrawDialog
      .getByRole("button", { name: "Withdraw from inbox", exact: true })
      .click();
    await expect(withdrawDialog).toHaveCount(0);
    expect(withdrawalKeys).toHaveLength(2);
    expect(withdrawalKeys[0]).toBe(withdrawalKeys[1]);
    // A stale open page must recheck withdrawal before delivering cached bytes.
    await received
      .getByRole("button", { name: "Download received PDF", exact: true })
      .click();
    await expect(buyer.getByRole("alert")).toContainText("DOCUMENT_WITHDRAWN");
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await buyer.reload();
    await nav(buyer, "Billing");
    await expect(
      buyer.getByRole("button", { name: "Download received PDF", exact: true }),
    ).toHaveCount(0);
    current = (await inbox())[0];
    expect(current.state).toBe("withdrawn");
    expect(current.acknowledgments).toHaveLength(1);
    const after = await (await page.request.get("/api/dashboard")).json();
    expect(after.invoices).toEqual(before.invoices);
    expect(after.stock).toEqual(before.stock);
    expect(after.orders).toEqual(before.orders);
    expect(after.shipments).toEqual(before.shipments);
    expect(await review()).toEqual(original);
    await page
      .getByRole("dialog")
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic reviewed republication");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish to customer inbox", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const history = (await inbox()).filter(
      (p: any) => p.document_id === invoice.id,
    );
    expect(history).toHaveLength(2);
    const replacement = history.find((p: any) => p.state === "available");
    expect(replacement.id).not.toBe(publication.id);
    expect(replacement.content_hash).toBe(hash);
    expect(replacement.acknowledgments).toHaveLength(0);
    expect(
      history.find((p: any) => p.id === publication.id).acknowledgments,
    ).toHaveLength(1);
    const credit = await cmd("billing.credit", {
      invoiceId: invoice.id,
      reference: "BROWSER-INBOX-CREDIT",
      reason: "Synthetic original-price return",
      lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
    });
    await page.reload();
    await nav(page, "Billing");
    const creditRow = page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Review and publish credit",
          exact: true,
        }),
      })
      .filter({ hasText: credit.number });
    const creditDownload = page.waitForEvent("download");
    await creditRow
      .getByRole("button", { name: "Review and publish credit", exact: true })
      .click();
    const creditBytes = await readFile((await (await creditDownload).path())!);
    const creditHash = createHash("sha256").update(creditBytes).digest("hex");
    await expect(
      page.getByRole("dialog", { name: "Publish reviewed PDF", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic credit PDF review");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish to customer inbox", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const creditPub = (await inbox()).find(
      (p: any) => p.document_id === credit.id,
    );
    expect(creditPub.kind).toBe("credit");
    expect(creditPub.content_hash).toBe(creditHash);
    await buyer.reload();
    await nav(buyer, "Billing");
    const buyerCredit = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: creditPub.number });
    const creditEvent = buyer.waitForEvent("download");
    await buyerCredit
      .getByRole("button", { name: "Download and review receipt", exact: true })
      .click();
    expect(await readFile((await (await creditEvent).path())!)).toEqual(
      creditBytes,
    );
    await buyer
      .getByRole("dialog", { name: "Confirm document receipt", exact: true })
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    expect(
      (await inbox()).find((p: any) => p.id === creditPub.id).acknowledgments[0]
        .content_hash,
    ).toBe(creditHash);
    const final = await (await page.request.get("/api/dashboard")).json();
    expect(final.invoices.find((i: any) => i.id === invoice.id).balance).toBe(
      11300,
    );
    expect(final.stock).toEqual(before.stock);
    expect(final.orders).toEqual(before.orders);
    expect(final.shipments).toEqual(before.shipments);
    // Exercise real continuation beyond the first 50 rows and request records.
    const buyerSession = await (await buyer.request.get("/api/session")).json();
    const buyerHeaders = { origin, "x-csrf-token": buyerSession.csrf };
    const requestIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const response = await buyer.request.post(
        `/api/billing/inbox/${replacement.id}/pdf`,
        {
          headers: { ...buyerHeaders, "idempotency-key": crypto.randomUUID() },
          data: {},
        },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      requestIds.push(response.headers()["x-download-receipt"]!);
    }
    const reviewedCredit = await page.request.post(
      `/api/billing/documents/credit/${credit.id}/pdf`,
      {
        headers: {
          origin,
          "x-csrf-token": (
            await (await page.request.get("/api/session")).json()
          ).csrf,
          "idempotency-key": crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(reviewedCredit.ok()).toBeTruthy();
    const creditReviewId = reviewedCredit.headers()["x-download-receipt"]!;
    let currentCredit = creditPub;
    const republishCredit = async () => {
      await cmd("billing.portal.withdraw", {
        publicationId: currentCredit.id,
        revision: 1,
        reason: "Synthetic history pagination",
      });
      currentCredit = await cmd("billing.portal.publish", {
        downloadId: creditReviewId,
        reason: "Synthetic reviewed credit republication",
      });
    };
    for (let i = 0; i < 55; i++) await republishCredit();
    await page.reload();
    await nav(page, "Billing");
    await expect(
      invoiceRow.getByRole("button", {
        name: "Review and publish invoice",
        exact: true,
      }),
    ).toHaveCount(0);
    const staffInbox = page.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await expect(
      staffInbox.getByRole("row").filter({ hasText: invoice.number }),
    ).toHaveCount(0);
    await buyer.reload();
    await nav(buyer, "Billing");
    const buyerInbox = buyer.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    const olderUrls: string[] = [];
    await buyer.route("**/api/billing/inbox/page?after=*", async (route) => {
      olderUrls.push(route.request().url());
      if (olderUrls.length === 1) await route.abort("failed");
      else await route.continue();
    });
    await republishCredit(); // Later insertion must not enter the existing continuation.
    await buyerInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("alert")).toBeVisible();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    await buyerInbox
      .getByRole("button", { name: "Retry older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "58 publications loaded",
    );
    expect(olderUrls).toHaveLength(2);
    expect(olderUrls[0]).toBe(olderUrls[1]);
    expect(await buyerInbox.getByRole("row").count()).toBe(59); // Header plus exactly 58 rows.
    const replacementRow = buyerInbox
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    await replacementRow
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    const historyPanel = buyer.getByRole("region", {
      name: "Document history",
      exact: true,
    });
    const requests = historyPanel.getByRole("region", {
      name: "Prepared PDF requests",
      exact: true,
    });
    await expect(requests.getByRole("status")).toHaveText("50 records loaded");
    const historyUrls: string[] = [];
    await buyer.route(
      `**/api/billing/inbox/${replacement.id}/history/downloads?after=*`,
      async (route) => {
        historyUrls.push(route.request().url());
        if (historyUrls.length === 1) await route.abort("failed");
        else await route.continue();
      },
    );
    await requests
      .getByRole("button", {
        name: "Load older PDF requests",
        exact: true,
      })
      .click();
    await expect(requests.getByRole("alert")).toBeVisible();
    await expect(requests.getByRole("status")).toHaveText("50 records loaded");
    await requests
      .getByRole("button", { name: "Retry PDF requests", exact: true })
      .click();
    await expect(requests.getByRole("status")).toHaveText("55 records loaded");
    expect(historyUrls).toHaveLength(2);
    expect(historyUrls[0]).toBe(historyUrls[1]);
    const requestText = await requests.getByRole("row").allTextContents();
    for (const id of requestIds)
      expect(requestText.filter((text) => text.includes(id))).toHaveLength(1);
    await expect(requests).toContainText("prepared only");
    await expect(
      historyPanel
        .getByRole("region", { name: "Receipt confirmations", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await historyPanel
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    await expect(
      replacementRow.getByRole("button", {
        name: "View document history",
        exact: true,
      }),
    ).toBeFocused();
    // Refresh discards continuation and history, then includes the newest insertion.
    await buyer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    await buyerInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "59 publications loaded",
    );
    const withdrawn = buyerInbox
      .getByRole("row")
      .filter({ hasText: invoice.number })
      .filter({ hasText: "withdrawn" });
    await withdrawn
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await expect(
      historyPanel.getByRole("region", {
        name: "Receipt confirmations",
        exact: true,
      }),
    ).toContainText("Inbox buyer");
    await expect(
      historyPanel.getByRole("region", {
        name: "Receipt confirmations",
        exact: true,
      }),
    ).toContainText("does not confirm payment or agreement");
    // A colleague sees no personal requests for this same publication.
    await colleague.reload();
    await nav(colleague, "Billing");
    const colleagueInbox = colleague.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await colleagueInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await colleagueInbox
      .getByRole("row")
      .filter({
        has: colleague.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number })
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await expect(
      colleague
        .getByRole("region", { name: "Prepared PDF requests", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await expect(
      colleague
        .getByRole("region", { name: "Receipt confirmations", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await colleague
      .getByRole("region", { name: "Document history", exact: true })
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    const delayedUrl = `**/api/billing/inbox/${replacement.id}/history/downloads`;
    let release!: () => void, started!: () => void, finished!: () => void;
    const pendingResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    const responseStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const responseFinished = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await colleague.route(delayedUrl, async (route) => {
      const response = await route.fetch();
      started();
      await pendingResponse;
      try {
        await route.fulfill({ response });
      } catch {
        /* Closing the history cancels this read. */
      }
      finished();
    });
    await colleagueInbox
      .getByRole("row")
      .filter({
        has: colleague.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number })
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await responseStarted;
    await colleague
      .getByRole("region", { name: "Document history", exact: true })
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    release();
    await responseFinished;
    await expect(
      colleague.getByRole("region", { name: "Document history", exact: true }),
    ).toHaveCount(0);
    await colleague.unroute(delayedUrl);
    const paginationFinal = await (
      await page.request.get("/api/dashboard")
    ).json();
    expect(paginationFinal).toEqual(final);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("browser: manual manufacturer history recovers lost responses, rejects stale decisions and preserves stock and money", async ({
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
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () =>
    (await page.request.get("/api/dashboard")).json();
  const account = await cmd("account.create", {
    name: "Manufacturer browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "MFG-BROWSER",
    name: "Manufacturer browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "MFG-DELIVERY",
    quantity: 1,
    serials: ["MFG-SERIAL"],
    bin: "MFG",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "MFG-SERIAL").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "mfg-issue",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  const before = await dashboard();
  const originalClaim = before.claims.find((c: any) => c.id === claim.id);
  const invariant = (value: any) => ({
    stock: value.stock,
    orders: value.orders,
    shipments: value.shipments,
    invoices: value.invoices,
  });
  const keys: string[] = [];
  let lost = false;
  await page.route(
    "**/api/commands/warranty.manufacturer.refer",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.reload();
  await nav(page, "Returns");
  const claimRow = page
    .getByRole("row")
    .filter({ hasText: claim.id.slice(0, 8) })
    .filter({
      has: page.getByRole("button", {
        name: "Record manufacturer referral",
        exact: true,
      }),
    });
  const refer = async (reference: string) => {
    await claimRow
      .getByRole("button", {
        name: "Record manufacturer referral",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Record manufacturer referral",
      exact: true,
    });
    await dialog
      .getByLabel("Manufacturer", { exact: true })
      .fill("Synthetic Maker");
    await dialog
      .getByLabel("Manufacturer case reference", { exact: true })
      .fill(reference);
    await dialog
      .getByLabel("Referral evidence reference", { exact: true })
      .fill("mfg-referral-" + reference);
    await dialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Requested externally");
    await dialog
      .getByRole("button", { name: "Record referral", exact: true })
      .click();
    return dialog;
  };
  const referralDialog = await refer("BROWSER-M-001");
  await expect(referralDialog.getByRole("alert")).toBeVisible();
  await referralDialog
    .getByRole("button", { name: "Record referral", exact: true })
    .click();
  await expect(referralDialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const section = page.getByRole("region", {
    name: "Manufacturer case history",
    exact: true,
  });
  const first = section.getByRole("row").filter({ hasText: "BROWSER-M-001" });
  await expect(first).toContainText("pending · revision 1");
  await first
    .getByRole("button", { name: "Record manufacturer response", exact: true })
    .click();
  const responseDialog = page.getByRole("dialog", {
    name: "Record manufacturer response",
    exact: true,
  });
  const pending = (await dashboard()).claims.find((c: any) => c.id === claim.id)
    .manufacturerCases[0];
  await cmd("warranty.manufacturer.decide", {
    caseId: pending.id,
    revision: 1,
    outcome: "accepted",
    evidence: "mfg-concurrent-response",
    reason: "Recorded by another staff session",
  });
  await responseDialog
    .getByLabel("Manufacturer outcome", { exact: true })
    .selectOption("denied");
  await responseDialog
    .getByLabel("Response evidence reference", { exact: true })
    .fill("mfg-stale-response");
  await responseDialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Stale attempt");
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog.getByRole("alert")).toContainText(
    "Manufacturer case changed",
  );
  await responseDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(first).toContainText("accepted · revision 2");
  await expect(first).not.toContainText("mfg-stale-response");
  const followup = await refer("BROWSER-M-002");
  await expect(followup).not.toBeVisible();
  const second = section.getByRole("row").filter({ hasText: "BROWSER-M-002" });
  const responseKeys: string[] = [];
  let lostResponse = false;
  await page.route(
    "**/api/commands/warranty.manufacturer.decide",
    async (route) => {
      responseKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostResponse) {
        lostResponse = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await second
    .getByRole("button", { name: "Record manufacturer response", exact: true })
    .click();
  await responseDialog
    .getByLabel("Manufacturer outcome", { exact: true })
    .selectOption("cancelled");
  await responseDialog
    .getByLabel("Response evidence reference", { exact: true })
    .fill("mfg-cancellation");
  await responseDialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic duplicate enquiry withdrawn externally");
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog.getByRole("alert")).toBeVisible();
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog).not.toBeVisible();
  expect(responseKeys).toHaveLength(2);
  expect(responseKeys[0]).toBe(responseKeys[1]);
  await page.reload();
  await nav(page, "Returns");
  await expect(first).toContainText("accepted · revision 2");
  await expect(second).toContainText("cancelled · revision 2");
  const after = await dashboard();
  const finalClaim = after.claims.find((c: any) => c.id === claim.id);
  expect(finalClaim.manufacturerCases).toHaveLength(2);
  expect(
    finalClaim.manufacturerCases.map((m: any) => m.history.length),
  ).toEqual([2, 2]);
  const { manufacturerCases: _beforeCases, ...original } = originalClaim;
  const { manufacturerCases: _afterCases, ...final } = finalClaim;
  expect(final).toEqual(original);
  expect(invariant(after)).toEqual(invariant(before));
  expect(after.invoices.find((i: any) => i.order_id === order.id).total).toBe(
    11300,
  );
  expect(errors).toEqual([]);
});

test("browser: replacement collection retries, cancellation, scan validation and successor claim retain serial history", async ({
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
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () =>
    (await page.request.get("/api/dashboard")).json();
  const account = await cmd("account.create", {
    name: "Replacement browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "REP-BROWSER",
    name: "Replacement browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 3, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "REP-DELIVERY",
    quantity: 3,
    serials: ["REP-OLD", "REP-NEW", "REP-SPARE"],
    bin: "REP",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "REP-OLD").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "mfg-issue",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  await cmd("warranty.receive", {
    claimId: claim.id,
    warehouseId,
    bin: "REP-Q",
    serial: "REP-OLD",
  });
  await cmd("warranty.inspect", {
    claimId: claim.id,
    findings: "Synthetic replacement inspection",
  });
  const before = await dashboard();
  const finances = (d: any) => ({
    orders: d.orders,
    shipments: d.shipments,
    invoices: d.invoices,
  });
  await page.reload();
  await nav(page, "Returns");
  const section = page.getByRole("region", {
    name: "Replacement history",
    exact: true,
  });
  const claimRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Approve replacement",
        exact: true,
      }),
    })
    .filter({ hasText: claim.id.slice(0, 8) });
  const reserve = async () => {
    await claimRow
      .getByRole("button", { name: "Approve replacement", exact: true })
      .click();
    await page.getByLabel("Replacement serial", { exact: true }).selectOption({
      label: `REP-NEW · ${before.warehouses.find((w: any) => w.id === warehouseId).name}`,
    });
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic replacement review");
    await page
      .getByRole("button", { name: "Reserve replacement", exact: true })
      .click();
  };
  await reserve();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let current = (await dashboard()).claims.find((c: any) => c.id === claim.id)
    .replacements[0];
  await section
    .getByRole("button", { name: "Hand over replacement", exact: true })
    .click();
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-NEW");
  await page
    .getByLabel("Collection recipient", { exact: true })
    .fill("Synthetic recipient");
  await page
    .getByLabel("Collection evidence reference", { exact: true })
    .fill("Synthetic stale dialog");
  await cmd("warranty.replacement.cancel", {
    replacementId: current.id,
    revision: 1,
    reason: "Synthetic concurrent cancellation",
  });
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Replacement changed",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(section).toContainText("cancelled · v2");
  const keys: Record<string, string[]> = {};
  const lost = new Set<string>();
  for (const name of [
    "warranty.replacement.reserve",
    "warranty.replacement.handover",
  ]) {
    keys[name] = [];
    await page.route(`**/api/commands/${name}`, async (route) => {
      keys[name]!.push(route.request().headers()["idempotency-key"]!);
      if (!lost.has(name)) {
        lost.add(name);
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
  }
  await reserve();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Reserve replacement", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const activeRow = section.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "Hand over replacement",
      exact: true,
    }),
  });
  await activeRow
    .getByRole("button", { name: "Hand over replacement", exact: true })
    .click();
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-SPARE");
  await page
    .getByLabel("Collection recipient", { exact: true })
    .fill("Synthetic recipient");
  await page
    .getByLabel("Collection evidence reference", { exact: true })
    .fill("Synthetic collection receipt");
  // Invalid scan is checked before installing lost-response interception for a successful handover.
  await page.unroute("**/api/commands/warranty.replacement.handover");
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Scanned replacement serial does not match",
  );
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-NEW");
  await page.route(
    "**/api/commands/warranty.replacement.handover",
    async (route) => {
      const name = "warranty.replacement.handover";
      keys[name]!.push(route.request().headers()["idempotency-key"]!);
      if (!lost.has(name)) {
        lost.add(name);
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const v of Object.values(keys)) {
    expect(v).toHaveLength(2);
    expect(v[0]).toBe(v[1]);
  }
  await page.reload();
  await nav(page, "Returns");
  await expect(section).toContainText("handed_over · v2");
  await expect(section).toContainText("Synthetic collection receipt");
  const after = await dashboard();
  expect(finances(after)).toEqual(finances(before));
  expect(after.stock.find((u: any) => u.serial === "REP-OLD").state).toBe(
    "scrapped",
  );
  expect(after.stock.find((u: any) => u.serial === "REP-NEW").state).toBe(
    "sold",
  );
  expect(after.stock.find((u: any) => u.serial === "REP-SPARE").available).toBe(
    1,
  );
  const native = page
    .getByRole("row")
    .filter({ hasText: claim.id.slice(0, 8) })
    .filter({ hasText: "Synthetic failure" });
  await expect(
    native.getByRole("button", { name: "Issue return credit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Submit claim / return", exact: true })
    .click();
  await page
    .getByLabel("Sold serial", { exact: true })
    .selectOption(after.soldUnits.find((u: any) => u.serial === "REP-NEW").id);
  await expect(
    page
      .getByLabel("Sold serial", { exact: true })
      .locator("option")
      .filter({ hasText: "REP-OLD" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Request type", { exact: true })
    .selectOption("warranty");
  await page
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic successor failure");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Synthetic successor evidence");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const final = await dashboard(),
    successor = final.claims.find(
      (c: any) => c.issue === "Synthetic successor failure",
    ),
    original = final.claims.find((c: any) => c.id === claim.id);
  expect(successor.invoice_id).toBe(original.invoice_id);
  expect(successor.coverage_end).toBe(original.coverage_end);
  expect(errors).toEqual([]);
});

test("browser: credited cash refund request and bank verification retry one reservation and one repayment", async ({
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
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const account = await cmd("account.create", {
    name: "Refund browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "REF-BROWSER",
    name: "Refund browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await (await page.request.get("/api/dashboard")).json(),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const received = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: received.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "REF-BROWSER-DEL",
    quantity: 1,
    serials: ["REF-BROWSER-UNIT"],
    bin: "REF",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await (await page.request.get("/api/dashboard")).json();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic refund fixture counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic refund fixture handover",
  });
  const invoiceId = shipped.invoiceId;
  await cmd("billing.payment.manual", {
    invoiceId,
    amount: 11300,
    reference: "REF-BROWSER-PAY",
    reason: "Synthetic payment evidence",
  });
  const paid = await (await page.request.get("/api/dashboard")).json(),
    invoice = paid.invoices.find((i: any) => i.id === invoiceId);
  await cmd("billing.credit", {
    invoiceId,
    reference: "REF-BROWSER-CR",
    reason: "Synthetic credit",
    lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
  });
  const before = await (await page.request.get("/api/dashboard")).json();
  await page.reload();
  await nav(page, "Billing");
  const row = page.getByRole("row").filter({ hasText: invoice.number });
  await row
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Request credited cash refund",
    exact: true,
  });
  await dialog
    .getByLabel("Unique refund reference", { exact: true })
    .fill("REF-BROWSER-REQUEST");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic credited cash request");
  let lost = false;
  const keys: string[] = [];
  await page.route("**/api/commands/billing.refund.request", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  let refunds = await (await page.request.get("/api/billing/refunds")).json();
  expect(refunds.filter((r: any) => r.invoice_id === invoiceId)).toHaveLength(
    1,
  );
  await row
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Request credited cash refund",
    exact: true,
  });
  await dialog
    .getByLabel("Unique refund reference", { exact: true })
    .fill("REF-BROWSER-OVER");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic excess check");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Refund exceeds");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const refundRow = page
    .getByRole("row")
    .filter({ hasText: "REF-BROWSER-REQUEST" });
  await refundRow
    .getByRole("button", { name: "Verify manual refund", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Verify bank refund",
    exact: true,
  });
  await dialog
    .getByLabel("Bank refund reference", { exact: true })
    .fill("REF-BROWSER-BANK");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic verified bank repayment");
  let bankLost = false;
  const bankKeys: string[] = [];
  await page.route("**/api/commands/billing.refund.manual", async (route) => {
    bankKeys.push(route.request().headers()["idempotency-key"]!);
    if (!bankLost) {
      bankLost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(bankKeys).toHaveLength(2);
  expect(bankKeys[0]).toBe(bankKeys[1]);
  await expect(refundRow).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(
    page.getByRole("row").filter({ hasText: "REF-BROWSER-REQUEST" }),
  ).toContainText("completed");
  refunds = await (await page.request.get("/api/billing/refunds")).json();
  expect(refunds.find((r: any) => r.invoice_id === invoiceId).state).toBe(
    "completed",
  );
  const after = await (await page.request.get("/api/dashboard")).json();
  const final = after.invoices.find((i: any) => i.id === invoiceId);
  expect(final.paid).toBe(11300);
  expect(final.credited).toBe(11300);
  expect(final.refunded).toBe(11300);
  expect(final.balance).toBe(0);
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.shipments).toEqual(before.shipments);
  expect(errors).toEqual([]);
});

test("browser: accounting invoice, cash and credit queues retry lost responses and reconcile uncertain sends without changing native facts", async ({
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
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const account = await cmd("account.create", {
    name: "Accounting browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "QBO-BROWSER",
    name: "Accounting browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await (await page.request.get("/api/dashboard")).json(),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const received = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: received.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "QBO-BROWSER-DEL",
    quantity: 1,
    serials: ["QBO-BROWSER-UNIT"],
    bin: "QBO",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const pick of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const picked = await (await page.request.get("/api/dashboard")).json();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic accounting counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic accounting handover",
  });
  const payment = await cmd("billing.payment.manual", {
    invoiceId: shipped.invoiceId,
    amount: 11300,
    reference: "QBO-BROWSER-CASH",
    reason: "Synthetic verified bank receipt",
  });
  const before = await (await page.request.get("/api/dashboard")).json(),
    invoice = before.invoices.find((i: any) => i.id === shipped.invoiceId);
  await page.reload();
  await nav(page, "Billing");
  const invoiceRow = page
    .getByRole("row")
    .filter({ has: page.locator("strong", { hasText: invoice.number }) });
  const cashRow = page.getByRole("row").filter({ hasText: "QBO-BROWSER-CASH" });
  await expect(cashRow).toContainText("Reconcile QuickBooks invoice first");
  await invoiceRow
    .getByRole("button", { name: "Queue QuickBooks invoice", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks invoice",
    exact: true,
  });
  await dialog
    .getByLabel("QuickBooks customer ID", { exact: true })
    .fill("customer-1");
  await dialog
    .getByLabel("QuickBooks item ID · Accounting browser equipment", {
      exact: true,
    })
    .fill("item-1");
  await dialog
    .getByLabel("QuickBooks tax code ID", { exact: true })
    .fill("tax-1");
  await dialog
    .getByLabel("QuickBooks tax rate ID", { exact: true })
    .fill("rate-1");
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("RESIDENCY_BLOCKED");
  await cmd("account.residency", {
    accountId: account.id,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic named QuickBooks exception",
  });
  const invoiceKeys: string[] = [];
  let lostInvoice = false;
  await page.route("**/api/commands/quickbooks.invoice", async (route) => {
    invoiceKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostInvoice) {
      lostInvoice = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(invoiceKeys).toHaveLength(2);
  expect(invoiceKeys[0]).toBe(invoiceKeys[1]);
  const effects = () => page.request.get("/api/effects").then((r) => r.json());
  let rows = await effects();
  const invoiceEffect = rows.find(
    (e: any) =>
      e.provider === "quickbooks" &&
      e.kind === "invoice" &&
      e.reference === invoice.id,
  );
  expect(rows.filter((e: any) => e.id === invoiceEffect.id)).toHaveLength(1);
  await expect(
    cashRow.getByRole("button", { name: "Queue QuickBooks payment" }),
  ).toHaveCount(0);
  const operation = (kind: string) =>
    page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: `quickbooks · ${kind}`,
        exact: true,
      }),
    });
  await operation("invoice")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("invoice")).toContainText("unknown");
  await expect(
    operation("invoice").getByRole("button", {
      name: "Send to provider",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("invoice")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("invoice")).toContainText("completed");
  await cashRow
    .getByRole("button", { name: "Queue QuickBooks payment", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks payment",
    exact: true,
  });
  await expect(dialog).toContainText("without charging the customer");
  await expect(dialog.getByLabel("Apply to invoice (cents)")).toHaveValue("0");
  await dialog.getByLabel("Apply to invoice (cents)").fill("11300");
  await dialog.getByLabel("QuickBooks deposit account ID").fill("bank-1");
  const paymentKeys: string[] = [];
  let lostPayment = false;
  await page.route("**/api/commands/quickbooks.payment", async (route) => {
    paymentKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostPayment) {
      lostPayment = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue payment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue payment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(paymentKeys).toHaveLength(2);
  expect(paymentKeys[0]).toBe(paymentKeys[1]);
  rows = await effects();
  expect(
    rows.filter((e: any) => e.kind === "payment" && e.reference === payment.id),
  ).toHaveLength(1);
  await operation("payment")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("payment")).toContainText("unknown");
  await operation("payment")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("payment")).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(cashRow).toContainText("completed");
  await expect(
    cashRow.getByRole("button", {
      name: "Queue QuickBooks payment",
      exact: true,
    }),
  ).toHaveCount(0);
  const after = await (await page.request.get("/api/dashboard")).json();
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.invoices).toEqual(before.invoices);
  const lines = invoice.lines;
  const credit = await cmd("billing.credit", {
    invoiceId: invoice.id,
    reference: "QBO-BROWSER-CREDIT",
    reason: "Synthetic accounting credit",
    lines: [{ lineId: lines[0].id, quantity: 1 }],
  });
  const creditedBefore = await (
    await page.request.get("/api/dashboard")
  ).json();
  const creditFacts = await (await page.request.get("/api/credits")).json();
  await page.reload();
  await nav(page, "Billing");
  const creditRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: credit.number, exact: true }),
  });
  await creditRow
    .getByRole("button", { name: "Queue QuickBooks credit", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks credit",
    exact: true,
  });
  await expect(dialog).toContainText("credit stays unapplied");
  const creditKeys: string[] = [];
  let lostCredit = false;
  await page.route("**/api/commands/quickbooks.credit", async (route) => {
    creditKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostCredit) {
      lostCredit = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue credit", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue credit", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(creditKeys).toHaveLength(2);
  expect(creditKeys[0]).toBe(creditKeys[1]);
  expect(
    (await effects()).filter(
      (e: any) => e.kind === "credit" && e.reference === credit.id,
    ),
  ).toHaveLength(1);
  await operation("credit")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("credit")).toContainText("unknown");
  await expect(
    operation("credit").getByRole("button", {
      name: "Send to provider",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("credit")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("credit")).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(creditRow).toContainText("completed");
  await expect(
    creditRow.getByRole("button", {
      name: "Queue QuickBooks credit",
      exact: true,
    }),
  ).toHaveCount(0);
  const creditedAfter = await (await page.request.get("/api/dashboard")).json();
  expect(creditedAfter.stock).toEqual(creditedBefore.stock);
  expect(creditedAfter.orders).toEqual(creditedBefore.orders);
  expect(creditedAfter.invoices).toEqual(creditedBefore.invoices);
  expect(await (await page.request.get("/api/credits")).json()).toEqual(
    creditFacts,
  );
  expect(errors).toEqual([]);
});
