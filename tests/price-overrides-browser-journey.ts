import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, email = "admin@example.test") {
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    email.startsWith("override-buyer") ? "Shop" : "Overview",
  );
}
async function offers(page: Page) {
  await navigateWorkspace(page, "Orders");
  await page
    .getByRole("button", { name: "Selling price", exact: true })
    .click();
  await expect(page.getByLabel("Offered net unit price (CAD)")).toBeEnabled();
}
test("reviewed cost, limits, recoverable offers, independent exception approval and buyer final quote", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await navigateWorkspace(page, "Catalog");
  await page.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page.getByLabel("Reviewed unit cost (CAD)").fill("60.00");
  await page
    .getByLabel("Reason for unit cost change")
    .fill("Reviewed synthetic wholesale baseline");
  await page
    .getByRole("button", { name: "Save reviewed unit cost", exact: true })
    .click();
  await expect(
    page.getByText("Unit cost change saved.", { exact: true }),
  ).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Reviewed price authority history" })
    .click();
  await expect(
    page.getByText("Reason: Reviewed synthetic wholesale baseline", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close product management", exact: true })
    .click();
  await navigateWorkspace(page, "Customers");
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Price override approval rules" })
    .click();
  await page.getByLabel("Allow staff offers within reviewed limits").check();
  await page.getByLabel("Maximum discount (%)").fill("10");
  await page.getByLabel("Minimum margin (%)").fill("20");
  await page
    .getByLabel("Reason for price approval rules")
    .fill("Reviewed ten percent discount and twenty percent margin");
  await page
    .getByRole("button", { name: "Save price approval rules", exact: true })
    .click();
  await expect(
    page.getByText("Price approval rules saved.", { exact: true }),
  ).toBeVisible();
  await offers(page);
  await page.getByLabel("Offered net unit price (CAD)").fill("90");
  await page
    .getByLabel("Reason for selling price action")
    .fill("Within reviewed limits");
  await page
    .getByRole("button", { name: "Review offered selling price", exact: true })
    .click();
  await expect(
    page.getByText("Offered price: CA$90.00 · active", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Offered net unit price (CAD)").fill("50");
  await page
    .getByLabel("Reason for selling price action")
    .fill("Synthetic exceptional commercial offer");
  let payload: string | undefined, key: string | undefined;
  let committedResolve: () => void;
  const committed = new Promise<void>((resolve) => {
    committedResolve = resolve;
  });
  await page.route("**/api/commands/cart.price-override.set", async (route) => {
    payload = route.request().postData()!;
    key = route.request().headers()["idempotency-key"];
    await route.fetch();
    await route.abort("failed");
    committedResolve();
  });
  await page
    .getByRole("button", { name: "Review offered selling price", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved price override" }),
  ).toBeVisible();
  await committed;
  await page.unroute("**/api/commands/cart.price-override.set");
  await page.reload();
  await navigateWorkspace(page, "Orders");
  await page
    .getByRole("button", { name: "Selling price", exact: true })
    .click();
  await expect(page.getByLabel("Offered net unit price (CAD)")).toBeDisabled();
  await page.route("**/api/commands/cart.price-override.set", async (route) => {
    expect(route.request().postData()).toBe(payload);
    expect(route.request().headers()["idempotency-key"]).toBe(key);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Retry saved price override" })
    .click();
  await expect(
    page.getByText("Offered price: CA$50.00 · pending", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve price exception", exact: true }),
  ).toHaveCount(0);
  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await login(approver, "approver@example.test");
  await offers(approver);
  await approver
    .getByLabel("Reason for selling price action")
    .fill("Independent approval of synthetic exception");
  await approver
    .getByRole("button", { name: "Approve price exception", exact: true })
    .click();
  await expect(
    approver.getByText("Offered price: CA$50.00 · approved", { exact: true }),
  ).toBeVisible();
  await approver
    .locator("summary")
    .filter({ hasText: "Saved cart price history" })
    .click();
  await expect(
    approver.getByText(/^Reason: Independent approval of synthetic exception/),
  ).toBeVisible();
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await login(buyer, "override-buyer@example.test");
  await buyer
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: "Orders", exact: true })
    .click();
  await expect(
    buyer.getByRole("button", { name: "Selling price", exact: true }),
  ).toHaveCount(0);
  await buyer.getByRole("button", { name: "Resume", exact: true }).click();
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(buyer.getByRole("dialog")).toContainText("CA$50.00");
  await expect(buyer.getByRole("dialog")).toContainText("CA$113.00");
  await expect(buyer.getByRole("dialog")).toContainText(
    "reviewed one-off selling price",
  );
  await expect(buyer.locator("body")).not.toContainText("wholesale");
  await expect(buyer.locator("body")).not.toContainText("margin");
  await expect(buyer.locator("body")).not.toContainText(
    "Synthetic exceptional commercial offer",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await approver
    .getByRole("button", { name: "Close selling price review", exact: true })
    .click();
  await approver
    .getByRole("button", { name: "Selling price", exact: true })
    .click();
  await expect(
    approver.getByLabel("Offered net unit price (CAD)"),
  ).toBeEnabled();
  await approver
    .getByLabel("Reason for selling price action")
    .fill("Explicitly return to ordinary account price");
  await approver
    .getByRole("button", {
      name: "Clear offer and use account price",
      exact: true,
    })
    .click();
  await expect(approver.getByLabel("Offered net unit price (CAD)")).toHaveValue(
    "100.00",
  );
  await expect(
    approver.getByRole("button", {
      name: "Clear offer and use account price",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await approverContext.close();
  await buyerContext.close();
});
