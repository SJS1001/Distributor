import { test, expect } from "@playwright/test";
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
  await expect(panel).toContainText("Sales agreement discrepancies: 2");
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
    .getByRole("button", { name: "Run reconciliation", exact: true })
    .click();
  await expect(
    panel
      .locator("dt")
      .filter({ hasText: /^Document balance$/ })
      .locator("+ dd"),
  ).toHaveText("CAD 63.00");
  await expect(panel).not.toContainText("PRIVATE-PAYMENT");
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
  await expect(panel).toContainText("Sales agreement discrepancies: 2");
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(
    (
      await page.request.get(`${origin}/api/operations/reconciliation`)
    ).status(),
  ).toBe(401);
  expect(errors).toEqual([]);
});
