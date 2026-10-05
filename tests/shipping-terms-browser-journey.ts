import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, buyer = false) {
  await page.goto("/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "shipping-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    buyer ? "Shop" : "Overview",
  );
}
test("discarding a rejected shipping change clears its obsolete conflict", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Orders");
  await page
    .getByRole("button", { name: "Shipping terms", exact: true })
    .click();
  const editor = page.getByRole("region", { name: "Cart shipping terms" });
  await editor.getByLabel("Shipping treatment").selectOption("included");
  await editor
    .getByLabel("Shipping terms and tax review evidence")
    .fill("Synthetic stale revision review");
  await page.route("**/api/commands/cart.shipping.set", (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: "CONFLICT",
        message: "Cart changed; review current shipping terms.",
      },
    }),
  );
  await editor
    .getByRole("button", { name: "Save reviewed shipping terms" })
    .click();
  await expect(editor.getByRole("alert")).toContainText("Cart changed");
  await editor
    .getByRole("button", { name: "Discard rejected shipping change" })
    .click();
  await expect(editor.getByLabel("Shipping treatment")).toBeEnabled();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Retry saved shipping change" }),
  ).toHaveCount(0);
});
test("staff review survives lost response and reload; buyer sees exact extra shipping before acceptance", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await navigateWorkspace(page, "Orders");
  await page
    .getByRole("button", { name: "Shipping terms", exact: true })
    .click();
  await expect(page.getByLabel("Shipping treatment")).toBeEnabled();
  await page.getByLabel("Shipping treatment").selectOption("extra");
  await page.getByLabel("Shipping net amount (CAD)").fill("7.01");
  await page.getByLabel("Explicit shipping tax (CAD)").fill("0.37");
  await page
    .getByLabel("Shipping terms and tax review evidence")
    .fill("Reviewed agreed freight and explicit tax");
  let payload: string | undefined, key: string | undefined;
  await page.route("**/api/commands/cart.shipping.set", async (route) => {
    payload = route.request().postData()!;
    key = route.request().headers()["idempotency-key"];
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Save reviewed shipping terms" })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved shipping change" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#workspace-title")).toBeVisible();
  await navigateWorkspace(page, "Orders");
  await page
    .getByRole("button", { name: "Shipping terms", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved shipping change" }),
  ).toBeVisible();
  await expect(page.getByLabel("Shipping treatment")).toBeDisabled();
  await page.unroute("**/api/commands/cart.shipping.set");
  await page.route("**/api/commands/cart.shipping.set", async (route) => {
    expect(route.request().postData()).toBe(payload);
    expect(route.request().headers()["idempotency-key"]).toBe(key);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Retry saved shipping change" })
    .click();
  await expect(
    page.getByText("Shipping terms saved.", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext(),
    buyer = await context.newPage();
  await login(buyer, true);
  await buyer
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: "Orders", exact: true })
    .click();
  await expect(
    buyer.getByRole("button", { name: "Shipping terms", exact: true }),
  ).toHaveCount(0);
  await buyer.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(buyer.getByRole("dialog")).toContainText("Prepare an order");
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(buyer.getByRole("dialog")).toContainText(
    "Edit order quantities",
  );
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(buyer.getByRole("dialog")).toContainText("CAD 7.01");
  await expect(buyer.getByRole("dialog")).toContainText("CAD 0.37");
  await expect(buyer.getByRole("dialog")).toContainText("CA$233.38");
  await expect(buyer.getByRole("dialog")).toContainText("first shipment");
  await context.close();
  expect(errors).toEqual([]);
});
