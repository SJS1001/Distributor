import { createCanvas } from "@napi-rs/canvas";
import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, email: string) {
  await page.goto("/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toBeVisible();
}
async function createProduct(page: Page, sku: string) {
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("SKU", { exact: true }).fill(sku);
  await dialog
    .getByLabel("Product name", { exact: true })
    .fill(`Product ${sku}`);
  await dialog.getByLabel("Unit price in cents", { exact: true }).fill("2500");
  await dialog
    .getByLabel("Tax rate in basis points", { exact: true })
    .fill("1300");
  const reply = page.waitForResponse((response) =>
    response.url().endsWith("/api/commands/product.create"),
  );
  await dialog
    .getByRole("button", { name: "Create product & add images", exact: true })
    .click();
  return (await (await reply).json()).id as string;
}

test("staff Shop catalog entry creates exact product and opens Images on phone despite dashboard refresh failure", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin@example.test");
  await page.goto("/#products");
  await page.getByRole("link", { name: "Manage catalog", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Catalog");
  const addProduct = page.getByRole("button", {
    name: "Add product",
    exact: true,
  });
  await addProduct.click();
  await expect(
    page.getByRole("dialog", { name: "Add product", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addProduct).toBeFocused();
  let creates = 0;
  const reviewedIds: string[] = [];
  await page.route("**/api/commands/product.create", async (route) => {
    creates++;
    await route.continue();
  });
  await page.route("**/api/catalog/products/*/review", async (route) => {
    reviewedIds.push(route.request().url().split("/").at(-2)!);
    await route.continue();
  });
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Synthetic refresh failure" },
    }),
  );
  const id = await createProduct(page, `FLOW-ADMIN-${browserName}`);
  const dialog = page.getByRole("dialog", {
    name: `Manage FLOW-ADMIN-${browserName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "Images", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("button", { name: "Add image", exact: true }),
  ).toBeVisible();
  expect(reviewedIds).toContain(id);
  expect(creates).toBe(1);
  await dialog
    .getByRole("button", { name: "Close product management", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add product", exact: true }),
  ).toBeFocused();
  await page.unroute("**/api/dashboard");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const product = page.getByRole("button", {
    name: `Images & documents for Product FLOW-ADMIN-${browserName} (FLOW-ADMIN-${browserName})`,
    exact: true,
  });
  await expect(product).toBeVisible();
  await product.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "Images", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(product).toBeFocused();
  expect(creates).toBe(1);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("commercial product creation offers readable resources with exact failed-read retry and no administrator upload controls", async ({
  page,
  browserName,
}) => {
  await login(page, "catalog-commercial@example.test");
  await navigateWorkspace(page, "Catalog");
  let reads = 0;
  await page.route("**/api/catalog/products/*/review", async (route) => {
    if (++reads === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic product read failure" },
      });
    else await route.continue();
  });
  await createProduct(page, `FLOW-COMMERCIAL-${browserName}`);
  await expect(
    page.getByRole("button", { name: "Retry opening product", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry opening product", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Manage FLOW-COMMERCIAL-${browserName}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("tab", { name: "Images", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("button", { name: "Add image", exact: true }),
  ).toHaveCount(0);
});

test("buyer has no catalog-management entry from workspace or public Shop", async ({
  page,
}) => {
  await login(page, "catalog-buyer@example.test");
  await expect(
    page.getByRole("button", { name: "Catalog", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#products");
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation", exact: true })
      .getByRole("link", { name: "My workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage catalog", exact: true }),
  ).toHaveCount(0);
});

test("explicit library image draft stays private until published and buyer loads its linked bytes", async ({
  page,
  browser,
  browserName,
}) => {
  const png = createCanvas(4, 4).toBuffer("image/png");
  await page.route("https://cdn.shopify.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin@example.test");
  await navigateWorkspace(page, "Catalog");
  await createProduct(page, `FLOW-LIBRARY-${browserName}`);
  const dialog = page.getByRole("dialog", {
    name: `Manage FLOW-LIBRARY-${browserName}`,
    exact: true,
  });
  await dialog.getByRole("button", { name: "Add image", exact: true }).click();
  await dialog
    .getByLabel("Image source", { exact: true })
    .selectOption("library");
  const selector = dialog.getByRole("combobox", {
    name: "GREE library product",
    exact: true,
  });
  await expect(selector).toBeVisible();
  // Explicit fixture selection does not assert an actual equipment match.
  const firstFamily = await selector
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await selector.selectOption(firstFamily!);
  await dialog.getByRole("button", { name: /^Use image 1 for / }).click();
  await selector.selectOption(
    (await selector.locator("option").nth(2).getAttribute("value")) as string,
  );
  await expect(
    dialog.getByLabel("HTTPS image URL", { exact: true }),
  ).toHaveValue("");
  await selector.selectOption(firstFamily!);
  await dialog.getByRole("button", { name: /^Use image 1 for / }).click();
  await dialog.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    path: "test-results/catalog-management-library-phone.png",
    fullPage: false,
  });
  const imageUrl = await dialog
    .getByLabel("HTTPS image URL", { exact: true })
    .inputValue();
  expect(imageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
  await dialog
    .getByRole("button", { name: "Save draft resource", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "Draft resource added. Review metadata and permission before publishing.",
      { exact: true },
    ),
  ).toBeVisible();
  const buyerContext = await browser.newContext();
  try {
    const buyer = await buyerContext.newPage();
    await buyer.route("https://cdn.shopify.com/**", (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    );
    await login(buyer, "catalog-buyer@example.test");
    await buyer
      .getByRole("button", { name: "Search products", exact: true })
      .click();
    await buyer
      .getByRole("searchbox", { name: "Search products" })
      .fill(`FLOW-LIBRARY-${browserName}`);
    await buyer
      .getByRole("searchbox", { name: "Search products" })
      .press("Enter");
    await expect(
      buyer.getByRole("button", {
        name: `View Product FLOW-LIBRARY-${browserName}`,
        exact: true,
      }),
    ).toBeVisible();
    const buyerCard = buyer.locator("article.sf-card").filter({
      has: buyer.getByRole("button", {
        name: `View Product FLOW-LIBRARY-${browserName}`,
        exact: true,
      }),
    });
    await expect(buyerCard.locator(`img[src="${imageUrl}"]`)).toHaveCount(0);
    const editor = dialog.locator("article.resource-editor");
    await editor
      .getByLabel(
        "I confirm ownership or permission to distribute this resource",
        { exact: true },
      )
      .check();
    await editor
      .getByLabel("Permission basis", { exact: true })
      .fill(
        "Synthetic browser image substitution; fixture-only publication permission",
      );
    await editor
      .getByRole("button", { name: "Publish to eligible buyers", exact: true })
      .click();
    await expect(editor).toContainText("published");
    await buyer.reload();
    await buyer
      .getByRole("button", { name: "Search products", exact: true })
      .click();
    await buyer
      .getByRole("searchbox", { name: "Search products" })
      .fill(`FLOW-LIBRARY-${browserName}`);
    await buyer
      .getByRole("searchbox", { name: "Search products" })
      .press("Enter");
    const image = buyerCard.locator(`img[src="${imageUrl}"]`);
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(4);
  } finally {
    await buyerContext.close();
  }
});
