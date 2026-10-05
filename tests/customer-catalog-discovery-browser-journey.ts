import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/#customer-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("shop-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
}
test("whole-catalog categories, scoped product routes and saved cart entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Let the initial dashboard appear before its supplemental security read completes.
  // Completing that read must not erase a category chosen in the usable Shop.
  let releaseSecurity!: () => void;
  const securityReady = new Promise<void>((resolve) => {
    releaseSecurity = resolve;
  });
  await page.route("**/api/security", async (route) => {
    await securityReady;
    await route.continue();
  });
  await login(page);
  // Equipment sorts beyond the unfiltered first page of bulk products.
  await expect(
    page.getByRole("button", { name: "View Synthetic equipment", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Category", { exact: true }).selectOption("serialized");
  const productButton = page.getByRole("button", {
    name: "View Synthetic equipment",
    exact: true,
  });
  await expect(productButton).toBeVisible();
  const securityResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/security"),
  );
  releaseSecurity();
  await securityResponse;
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "serialized",
  );
  await productButton.click();
  await expect(page).toHaveURL(/#page=Shop&product=/);
  const productUrl = page.url();
  const breadcrumb = page.getByRole("navigation", {
    name: "Product breadcrumb",
  });
  await expect(breadcrumb).toContainText("Synthetic equipment");
  await expect(
    page.getByRole("heading", { name: "Synthetic equipment", exact: true }),
  ).toBeFocused();
  await page.goBack();
  await expect(productButton).toBeFocused();
  await page.goForward();
  await expect(breadcrumb).toBeVisible();
  await page.reload();
  await expect(breadcrumb).toBeVisible();
  await expect(page.getByText("CA$81.99", { exact: true })).toBeVisible();
  await breadcrumb.getByRole("button", { name: "Shop", exact: true }).click();
  await expect(page).toHaveURL(/#page=Shop$/);
  await page.getByLabel("Category", { exact: true }).selectOption("bulk");
  await expect(
    page.getByRole("button", { name: "Load more products", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more products", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^View Synthetic bulk item / }),
  ).toHaveCount(21);
  await expect(
    page.getByRole("button", { name: "View Synthetic equipment", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume a saved cart", exact: true })
    .click();
  await expect(page).toHaveURL(/#page=Orders&section=orders-queue$/);
  await expect(
    page.getByRole("heading", { name: "Saved carts", exact: true }),
  ).toBeVisible();
  // A valid-shaped but inaccessible selection does not invent a product or price.
  await page.goto(
    productUrl.replace(/product=[^&]+/, "product=missing-product"),
  );
  await expect(page.getByRole("alert")).toContainText(
    "unavailable in your current approved catalog",
  );
  await expect(
    page.getByRole("button", { name: "Prepare order with this product" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Return to Shop", exact: true })
    .click();
  await expect(page.getByLabel("Search products")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
