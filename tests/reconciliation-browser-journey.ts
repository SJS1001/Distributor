import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:3132";
test("browser: phone reconciliation shows native discrepancies, refreshes money, clears failed results and discards abandoned reads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const login = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await login).json()).csrf;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav
    .getByRole("button", { name: "Reconciliation", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Stock and billing reconciliation",
    exact: true,
  });
  await expect(panel).toContainText("Stock discrepancies: 2");
  await expect(panel).toContainText("Billing discrepancies: 0");
  await expect(panel).toContainText("Sales agreement discrepancies: 4");
  await expect(panel).toContainText("SALE ORDER RESERVED");
  await expect(panel).toContainText("SALE PACK OVERCOMMITTED");
  await expect(panel).toContainText("SALE INVOICE PRICE");
  await expect(panel).toContainText("SALE INVOICE TAX");
  await expect(panel).toContainText("PRODUCT QUANTITY");
  await expect(panel).toContainText("PRODUCT VALUE");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Regional native invoice line net$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 90.00");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Regional native invoice line tax$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 23.00");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Shipped quantity$/ })
      .locator("+ dd"),
  ).toHaveText("1");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Stock deduction quantity$/ })
      .locator("+ dd"),
  ).toHaveText("1");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Document balance$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 113.00");
  const savedReports = panel.getByRole("region", {
    name: "Saved reconciliation reports",
  });
  await expect(savedReports).toContainText("No saved reports.");
  const attempts: string[] = [];
  let dropped = false;
  let originalReceipt: any;
  await page.route(
    "**/api/commands/operations.reconciliation.prepare",
    async (route) => {
      attempts.push(route.request().headers()["idempotency-key"]!);
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        originalReceipt = await response.json();
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  await panel
    .getByRole("button", { name: "Save reviewed report", exact: true })
    .click();
  await expect(
    panel.getByRole("alert").filter({ hasText: /fetch|Failed/i }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Save reviewed report", exact: true })
    .click();
  await expect(savedReports.locator("li")).toHaveCount(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  await page.unroute("**/api/commands/operations.reconciliation.prepare");
  const downloaded = page.waitForEvent("download");
  await savedReports
    .getByRole("button", {
      name: `Download report ${originalReceipt.id}`,
      exact: true,
    })
    .click();
  const originalDownload = await downloaded;
  expect(originalDownload.suggestedFilename()).toBe(originalReceipt.filename);
  const retainedBytes = await readFile((await originalDownload.path())!);
  expect(createHash("sha256").update(retainedBytes).digest("hex")).toBe(
    originalReceipt.contentHash,
  );
  const retained = JSON.parse(retainedBytes.toString());
  expect(retained.report.billing.balance).toBe("11300");
  expect(retained.report.sales.issues.count).toBe(4);
  expect(retained.report.sales.issues.items.map((i: any) => i.code)).toEqual(
    expect.arrayContaining(["SALE_ORDER_RESERVED", "SALE_PACK_OVERCOMMITTED"]),
  );
  expect(retained.limits.productGateAcceptance).toBe(false);
  expect(retainedBytes.toString()).not.toContain("PRIVATE-PAYMENT");
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount++;
  });
  await page.route(
    "**/api/operations/reconciliation/*/document",
    async (route) => {
      const response = await route.fetch();
      const bytes = await response.body();
      bytes[0] = 32;
      await route.fulfill({ response, body: bytes });
    },
  );
  await savedReports
    .getByRole("button", {
      name: `Download report ${originalReceipt.id}`,
      exact: true,
    })
    .click();
  await expect(
    panel
      .getByRole("alert")
      .filter({ hasText: "Report integrity check failed" }),
  ).toBeVisible();
  expect(downloadCount).toBe(0);
  await page.unroute("**/api/operations/reconciliation/*/document");
  const dashboard = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  const invoiceId = dashboard.invoices[0].id;
  const payment = await page.request.post(
    `${origin}/api/commands/billing.payment.manual`,
    {
      headers: {
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": "reconciliation-payment",
      },
      data: {
        invoiceId,
        amount: 5000,
        reference: "PRIVATE-PAYMENT",
        reason: "Synthetic receipt",
      },
    },
  );
  expect(payment.status()).toBe(200);
  await panel
    .getByRole("button", { name: "Save reviewed report", exact: true })
    .click();
  await expect(
    panel.getByRole("alert").filter({ hasText: "STALE_RECONCILIATION" }),
  ).toBeVisible();
  await expect(savedReports.locator("li")).toHaveCount(1);
  await panel
    .getByRole("button", { name: "Run reconciliation", exact: true })
    .click();
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Document balance$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 63.00");
  await expect(panel).not.toContainText("PRIVATE-PAYMENT");
  await panel
    .getByRole("button", { name: "Save reviewed report", exact: true })
    .click();
  await expect(savedReports.locator("li")).toHaveCount(2);
  const oldDownload = page.waitForEvent("download");
  await savedReports
    .getByRole("button", {
      name: `Download report ${originalReceipt.id}`,
      exact: true,
    })
    .click();
  expect(await readFile((await (await oldDownload).path())!)).toEqual(
    retainedBytes,
  );

  let fail = true;
  await page.route("**/api/operations/reconciliation", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        json: { message: "Synthetic reconciliation unavailable" },
      });
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Run reconciliation", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Synthetic reconciliation unavailable",
  );
  await expect(
    panel.getByRole("heading", { name: "Stock controls", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Run reconciliation", exact: true })
    .click();
  await expect(panel).toContainText("Billing discrepancies: 0");
  await expect(panel).toContainText("Sales agreement discrepancies: 4");
  await expect(panel).toContainText("SALE INVOICE PRICE");
  await expect(panel).toContainText("SALE INVOICE TAX");
  await page.unroute("**/api/operations/reconciliation");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/operations/reconciliation", async (route) => {
    const response = await route.fetch();
    entered();
    await waiting;
    await route.fulfill({ response }).catch(() => {});
  });
  await panel
    .getByRole("button", { name: "Run reconciliation", exact: true })
    .click();
  await started;
  await nav.getByRole("button", { name: "Overview", exact: true }).click();
  release();
  await expect(panel).toHaveCount(0);
  await page.unroute("**/api/operations/reconciliation");
  await nav
    .getByRole("button", { name: "Reconciliation", exact: true })
    .click();
  await expect(panel).toContainText("Stock discrepancies: 2");
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Document balance$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 63.00");
  await expect(savedReports.locator("li")).toHaveCount(2);
  let historyFail = true;
  await page.route(
    "**/api/operations/reconciliation/history",
    async (route) => {
      if (historyFail) {
        historyFail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          json: { message: "Synthetic history unavailable" },
        });
      } else await route.continue();
    },
  );
  await savedReports
    .getByRole("button", { name: "Refresh saved reports", exact: true })
    .click();
  await expect(savedReports.getByRole("alert")).toHaveText(
    "Synthetic history unavailable",
  );
  await savedReports
    .getByRole("button", { name: "Refresh saved reports", exact: true })
    .click();
  await expect(savedReports.getByRole("alert")).toHaveCount(0);
  await expect(savedReports.locator("li")).toHaveCount(2);
  await page.unroute("**/api/operations/reconciliation/history");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  let downloadEntered!: () => void, downloadRelease!: () => void;
  const downloadStarted = new Promise<void>((r) => {
    downloadEntered = r;
  });
  const downloadWaiting = new Promise<void>((r) => {
    downloadRelease = r;
  });
  await page.route(
    "**/api/operations/reconciliation/*/document",
    async (route) => {
      const response = await route.fetch();
      downloadEntered();
      await downloadWaiting;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  const beforeAbandon = downloadCount;
  await savedReports
    .getByRole("button", {
      name: `Download report ${originalReceipt.id}`,
      exact: true,
    })
    .click();
  await downloadStarted;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  downloadRelease();
  await page.unroute("**/api/operations/reconciliation/*/document");
  expect(downloadCount).toBe(beforeAbandon);
  await expect(panel).toHaveCount(0);
  expect(
    (
      await page.request.get(`${origin}/api/operations/reconciliation`)
    ).status(),
  ).toBe(401);
  for (const path of [
    "/api/operations/reconciliation/history",
    `/api/operations/reconciliation/${originalReceipt.id}/document`,
  ])
    expect((await page.request.get(`${origin}${path}`)).status()).toBe(401);
  expect(errors).toEqual([]);
});
