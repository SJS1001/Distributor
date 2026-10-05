import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, buyer = false) {
  await page.goto(buyer ? "/#customer-sign-in" : "/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "report-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toBeVisible();
}
test("workspace report visibility and order survive reload, remain user scoped, and work on phone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const reports = page.getByRole("region", { name: "Workspace reports" });
  await expect(
    reports.getByRole("heading", { name: "Sales & receivables", exact: true }),
  ).toBeVisible();
  await reports.getByText("Customize reports", { exact: true }).click();
  await reports
    .getByRole("checkbox", { name: "Sales & receivables", exact: true })
    .uncheck();
  await expect(
    reports.getByRole("heading", { name: "Sales & receivables", exact: true }),
  ).toHaveCount(0);
  await reports
    .getByRole("button", { name: "Move Stock condition up", exact: true })
    .click();
  await page.reload();
  await expect(
    reports.getByRole("heading", { name: "Sales & receivables", exact: true }),
  ).toHaveCount(0);
  await reports.getByText("Customize reports", { exact: true }).click();
  await expect(
    reports.getByRole("checkbox", { name: "Sales & receivables", exact: true }),
  ).not.toBeChecked();
  await expect(reports.locator(".report-preference").nth(2)).toContainText(
    "Stock condition",
  );
  await reports
    .getByRole("checkbox", { name: "Order activity", exact: true })
    .uncheck();
  await reports
    .getByRole("checkbox", { name: "Stock condition", exact: true })
    .uncheck();
  await reports
    .getByRole("checkbox", { name: "Sales, credits & payments", exact: true })
    .uncheck();
  await expect(
    reports.getByText("All report cards are hidden.", { exact: false }),
  ).toBeVisible();
  // Same browser storage, different authenticated user: no admin preferences leak.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/logout") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  ]);
  await login(page, true);
  await page.goto("/#page=Overview");
  await expect(
    reports.getByRole("heading", {
      name: "Your purchases & balances",
      exact: true,
    }),
  ).toBeVisible();
  await reports.getByText("Customize reports", { exact: true }).click();
  await expect(
    reports.getByRole("checkbox", { name: "Stock condition", exact: true }),
  ).toHaveCount(0);
  await expect(
    reports.getByRole("checkbox", { name: "Order activity", exact: true }),
  ).toBeChecked();
  await reports
    .getByRole("checkbox", { name: "Purchases & balances", exact: true })
    .uncheck();
  await page.reload();
  await expect(
    reports.getByRole("heading", {
      name: "Your purchases & balances",
      exact: true,
    }),
  ).toHaveCount(0);
  await reports.getByText("Customize reports", { exact: true }).click();
  await reports
    .getByRole("button", { name: "Restore default reports", exact: true })
    .click();
  await expect(
    reports.getByRole("heading", {
      name: "Your purchases & balances",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("financial charts retain actual figures, provide transaction tabs and respect date filters", async ({
  page,
}) => {
  await login(page);
  const report = page.getByRole("region", {
    name: "Sales and adjustment report",
  });
  await report.getByLabel("Report from").fill("2026-09-01");
  await report.getByLabel("Report through").fill("2026-10-05");
  await report.getByRole("button", { name: "Apply report period" }).click();
  await expect(report.locator(".financial-metrics")).toContainText(
    "CAD 3,000.00",
  );
  await expect(report.locator(".financial-metrics")).toContainText(
    "45 invoices",
  );
  await expect(
    report.getByRole("img", { name: /Daily invoices/ }),
  ).toBeVisible();
  await report.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(
    report.getByRole("columnheader", { name: "Unit price", exact: true }),
  ).toBeVisible();
  await expect(
    report.getByRole("cell", { name: "CAD 100.00", exact: true }).first(),
  ).toBeVisible();
  await report.getByRole("tab", { name: "Daily figures", exact: true }).click();
  await expect(
    report.getByRole("cell", { name: "CAD 4,500.00", exact: true }),
  ).toBeVisible();
  await report.getByRole("tab", { name: "Summary", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await report.screenshot({
    path: "local-evidence/workflow-reports-phone.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await report.screenshot({
    path: "local-evidence/workflow-reports-desktop.png",
  });
  await report.getByLabel("Report from").fill("2026-10-01");
  await report.getByLabel("Report through").fill("2026-10-05");
  await report.getByRole("button", { name: "Apply report period" }).click();
  await expect(
    report.getByText(
      "No recorded sales, credits or payment activity in this period.",
    ),
  ).toBeVisible();
});
