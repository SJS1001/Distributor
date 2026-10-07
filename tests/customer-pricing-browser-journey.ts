import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
import { customerPricingOrigin } from "./customer-pricing-browser-fixture.ts";
async function login(page: Page, buyer = false) {
  await page.goto(buyer ? "/#customer-sign-in" : "/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "pricing-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    buyer ? "Shop" : "Overview",
  );
}
async function pricing(page: Page, editable = true) {
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  if (editable)
    await expect(page.getByLabel("Price calculation")).toBeEnabled();
}
// Every config that runs this journey starts its server at this origin. The
// describe scope keeps the override out of files that import this journey.
test.describe(() => {
  test.use({ baseURL: customerPricingOrigin });
  test("MSRP multiplier, selected customer tabs, exact recovery, history and buyer net-only disclosure", async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await pricing(page);
    await expect(
      page.getByRole("button", { name: "Add customer", exact: true }),
    ).toBeHidden();
    await page.getByLabel("Price calculation").selectOption("multiplier");
    await page.getByLabel("MSRP multiplier", { exact: true }).fill("0.75");
    await page
      .getByLabel("Prices shown to this customer")
      .selectOption("detailed");
    await expect(
      page.getByText("75% of MSRP · 25% discount", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("MSRP CA$100.00", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("25% off · Save CA$25.00", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Reason for pricing change")
      .fill("Agreed synthetic 25 percent discount");
    let payload: string | undefined, key: string | undefined;
    await page.route("**/api/commands/catalog.pricing.set", async (route) => {
      payload = route.request().postData()!;
      key = route.request().headers()["idempotency-key"];
      await route.fetch();
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Save customer pricing", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saved pricing change" }),
    ).toBeVisible();
    await page.unroute("**/api/commands/catalog.pricing.set");
    await page.reload();
    await pricing(page, false);
    await expect(
      page.getByLabel("MSRP multiplier", { exact: true }),
    ).toBeDisabled();
    await page.route("**/api/commands/catalog.pricing.set", async (route) => {
      expect(route.request().postData()).toBe(payload);
      expect(route.request().headers()["idempotency-key"]).toBe(key);
      await route.continue();
    });
    await page
      .getByRole("button", { name: "Retry saved pricing change" })
      .click();
    await expect(
      page.getByLabel("MSRP multiplier", { exact: true }),
    ).toBeEnabled();
    await page
      .locator("summary")
      .filter({ hasText: "Pricing change history" })
      .click();
    await page
      .getByRole("button", { name: "Refresh latest pricing history" })
      .click();
    await expect(
      page.getByText("Reason: Agreed synthetic 25 percent discount", {
        exact: true,
      }),
    ).toBeVisible();
    await navigateWorkspace(page, "Returns");
    await expect(
      page.getByRole("tab", { name: "Claims and returns", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("tab", { name: "Return & warranty policies", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Return and warranty policies",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request return", exact: true }),
    ).toBeHidden();
    await navigateWorkspace(page, "Imports");
    await page
      .getByRole("tab", { name: "Unpaid documents", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Unpaid document review",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Opening stock review", exact: true }),
    ).toBeHidden();
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Unpaid documents", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await pricing(page);
    const buyer = await browser.newPage();
    await login(buyer, true);
    await buyer.goto("/#page=Overview");
    await expect(buyer.locator("#workspace-title")).toHaveText("Reports");
    await buyer.goto("/#page=Shop");
    await expect(buyer.locator("#workspace-title")).toHaveText("Shop");
    await expect(
      buyer.getByText("MSRP CA$125.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      buyer.getByText("25% off · Save CA$31.25", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      buyer.getByText("CA$93.75", { exact: true }).first(),
    ).toBeVisible();
    await page.unroute("**/api/commands/catalog.pricing.set");
    await page
      .getByLabel("Prices shown to this customer")
      .selectOption("net_only");
    await page
      .getByLabel("Reason for pricing change")
      .fill("Agreed net-only display");
    await page
      .getByRole("button", { name: "Save customer pricing", exact: true })
      .click();
    await expect(page.getByLabel("Reason for pricing change")).toHaveValue("");
    await buyer.reload();
    await expect(
      buyer.getByText("CA$93.75", { exact: true }).first(),
    ).toBeVisible();
    await expect(buyer.locator(".customer-msrp")).toHaveCount(0);
    await expect(buyer.locator(".customer-savings")).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/distributor-customer-pricing-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await navigateWorkspace(page, "Catalog");
    await page
      .getByRole("button", { name: "Manage EQ-1", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Catalog product management" })
      .getByRole("tab", { name: "Pricing", exact: true })
      .click();
    await expect(page.getByLabel("MSRP (CAD, dollars)")).toHaveValue("125.00");
    await page.getByLabel("MSRP (CAD, dollars)").fill("");
    await page
      .getByLabel("Reason for MSRP change")
      .fill("Synthetic missing MSRP verification");
    await page
      .getByRole("button", { name: "Save product MSRP", exact: true })
      .click();
    await expect(page.getByLabel("Reason for MSRP change")).toHaveValue("");
    await buyer.reload();
    await expect(
      buyer.getByRole("button", {
        name: "View Synthetic equipment",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(buyer.getByText("CA$93.75", { exact: true })).toHaveCount(0);
    await page
      .locator("#catalog-pricing-panel summary")
      .filter({ hasText: "Pricing change history" })
      .click();
    await page
      .locator("#catalog-pricing-panel")
      .getByRole("button", { name: "Refresh latest pricing history" })
      .click();
    await expect(
      page.getByText("Reason: Synthetic missing MSRP verification", {
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await buyer.close();
  });
});
