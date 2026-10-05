import { test, expect, type Page } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, buyer: boolean) {
  // Choosing the other entrance must not change the account's authenticated role.
  await page.goto(buyer ? "/#admin-sign-in" : "/#customer-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "shop-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    buyer ? "Shop" : "Overview",
  );
}
async function buyerNavigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

test("buyer mobile storefront, native approval, withdrawal and fresh quote resubmission", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await expect(
    page.getByRole("region", { name: "Featured products" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next featured product" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/distributor-storefront-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next featured product" }).click();
  await page.getByLabel("Search products").fill("EQ-1");
  await page.getByLabel("Search products").press("Enter");
  await expect(page.getByLabel("Search products")).toBeFocused();
  await page
    .getByRole("button", { name: "View Synthetic equipment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic equipment", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("CA$81.99", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/tmp/distributor-product-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Specifications", exact: true }).click();
  await expect(
    page.getByText("Individually serialized", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(
    page.getByText("No documents have been published for this product."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare order with this product" })
    .click();
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit order quantities" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("EQ-1 · Synthetic equipment", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review and accept order" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByText("Awaiting distributor approval. No stock is reserved", {
      exact: false,
    }),
  ).toBeVisible();
  await buyerNavigate(page, "Orders");
  await page.getByRole("tab", { name: "Approval requests" }).click();
  await page.getByRole("button", { name: /^View request / }).click();
  await expect(
    page.getByRole("heading", {
      name: "Awaiting distributor approval",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Withdrawn", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review quantities and resubmit" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit order quantities" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page
    .getByLabel("Message to distributor")
    .fill("Please verify this model for our installation.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Awaiting distributor approval",
      exact: true,
    }),
  ).toBeVisible();
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await login(admin, false);
    await navigateWorkspace(admin, "Orders", "Approval requests");
    await admin.getByRole("button", { name: /^View request / }).click();
    await admin
      .getByLabel("Decision", { exact: true })
      .selectOption("request_information");
    await admin
      .getByLabel("Message to customer")
      .fill("Please confirm the installation.");
    await admin.getByRole("button", { name: "Record decision" }).click();
    await expect(
      admin.getByRole("heading", {
        name: "More information needed",
        exact: true,
      }),
    ).toBeVisible();
    await expect(admin.getByLabel("Decision", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Refresh request", exact: true })
      .click();
    await expect(
      page.getByText("Please confirm the installation.").first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review quantities and resubmit" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Edit order quantities" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await page
      .getByLabel("Message to distributor")
      .fill("Installation confirmed with a new quote.");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await admin
      .getByRole("button", { name: "Refresh request", exact: true })
      .click();
    await admin.getByLabel("Decision", { exact: true }).selectOption("approve");
    await admin
      .getByLabel("Message to customer")
      .fill("Model verified for synthetic fixture.");
    await admin
      .getByLabel("Private staff note")
      .fill("Internal fixture review only");
    await admin.getByRole("button", { name: "Record decision" }).click();
    await expect(
      admin.getByRole("heading", { name: "Accepted", exact: true }),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
  await page
    .getByRole("button", { name: "Refresh request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Accepted", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Internal fixture review only")).toHaveCount(0);
  await page.getByRole("button", { name: "View accepted order" }).click();
  await expect(
    page.getByRole("tab", { name: "Orders", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await buyerNavigate(page, "Invoices & payments");
  await expect(page.locator("#workspace-title")).toHaveText(
    "Invoices & payments",
  );
  await buyerNavigate(page, "Account");
  await expect(
    page.getByRole("heading", { name: "Your sign-in security" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("staff uploads and publishes permitted resources, edits rules and buyer sees only published resources", async ({
  page,
  browser,
}) => {
  await login(page, false);
  await navigateWorkspace(page, "Catalog");
  await page.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await page.getByRole("tab", { name: "Images", exact: true }).click();
  await page.getByText("Add image", { exact: true }).click();
  await page
    .getByLabel("Resource title", { exact: true })
    .filter({ visible: true })
    .fill("Synthetic image");
  await page
    .getByLabel("Alternative text", { exact: true })
    .fill("Synthetic equipment test graphic");
  const canvas = createCanvas(40, 30);
  canvas.getContext("2d").fillRect(5, 5, 30, 20);
  await page.getByLabel("Image file", { exact: false }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: canvas.toBuffer("image/png"),
  });
  await page
    .getByRole("button", { name: "Save draft resource" })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Draft resource added.", { exact: false }),
  ).toBeVisible();
  const card = page.locator(".resource-editor").filter({
    has: page.getByRole("heading", { name: "Synthetic image", exact: true }),
  });
  await card.getByRole("checkbox").check();
  await card
    .getByLabel("Permission basis")
    .fill("Original synthetic test graphic generated for this fixture.");
  await card
    .getByRole("button", { name: "Publish to eligible buyers" })
    .click();
  await expect(card.getByText(/published · Version/)).toBeVisible();
  await page.screenshot({
    path: "/tmp/distributor-catalog-resources-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await page.getByText("Add document", { exact: true }).click();
  await page
    .getByLabel("Resource title", { exact: true })
    .filter({ visible: true })
    .fill("Synthetic installation reference");
  await page
    .getByLabel("Resource source", { exact: true })
    .selectOption("link");
  await page
    .getByLabel("HTTPS document URL")
    .fill("https://example.test/synthetic-installation.pdf");
  await page
    .getByRole("button", { name: "Save draft resource" })
    .filter({ visible: true })
    .click();
  const document = page.locator(".resource-editor").filter({
    has: page.getByRole("heading", {
      name: "Synthetic installation reference",
      exact: true,
    }),
  });
  await document.getByRole("checkbox").check();
  await document
    .getByLabel("Permission basis")
    .fill("Synthetic reference URL, no vendor assets.");
  await document
    .getByRole("button", { name: "Publish to eligible buyers" })
    .click();
  await expect(document.getByText(/published · Version/)).toBeVisible();
  await page
    .getByRole("tab", { name: "Purchasing rules", exact: true })
    .click();
  await page
    .getByLabel("Require distributor approval for orders containing")
    .check();
  await page
    .getByLabel("Reason for product rule change")
    .fill("Synthetic model verification");
  await page
    .getByRole("button", { name: "Save product purchasing rule" })
    .click();
  await expect(page.getByText("Product purchasing rule saved.")).toBeVisible();
  await navigateWorkspace(page, "Customers");
  await page
    .getByLabel("Catalog access", { exact: true })
    .selectOption("selected");
  await page.getByLabel("EQ-1 — Synthetic equipment", { exact: true }).check();
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Approved synthetic equipment only");
  await page
    .getByRole("button", { name: "Save customer purchasing rules" })
    .click();
  await expect(
    page.getByText("Customer purchasing rules saved."),
  ).toBeVisible();
  const context = await browser.newContext();
  try {
    const buyer = await context.newPage();
    await login(buyer, true);
    await expect(
      buyer.getByRole("button", {
        name: "View Synthetic replacement part",
        exact: true,
      }),
    ).toHaveCount(0);
    await buyer
      .getByRole("button", { name: "View Synthetic equipment", exact: true })
      .click();
    await expect(
      buyer.getByRole("img", { name: "Synthetic equipment test graphic" }),
    ).toBeVisible();
    await buyer.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(
      buyer.getByRole("link", {
        name: "Synthetic installation reference (external website)",
      }),
    ).toHaveAttribute(
      "href",
      "https://example.test/synthetic-installation.pdf",
    );
    await navigateWorkspace(page, "Catalog");
    await page
      .getByRole("button", { name: "Manage EQ-1", exact: true })
      .click();
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await document
      .getByText("Retire resource", { exact: true })
      .first()
      .click();
    await document
      .getByLabel("Reason for retirement")
      .fill("Superseded synthetic reference");
    await document
      .getByRole("button", { name: "Retire resource", exact: true })
      .click();
    await expect(document.getByText(/retired · Version/)).toBeVisible();
    await buyer.reload();
    await buyer
      .getByRole("button", { name: "View Synthetic equipment", exact: true })
      .click();
    await buyer.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(
      buyer.getByRole("link", {
        name: "Synthetic installation reference (external website)",
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("revoked saved products require explicit removal before replacing a cart", async ({
  page,
  browser,
}) => {
  await login(page, false);
  await navigateWorkspace(page, "Customers");
  await page
    .getByLabel("Catalog access", { exact: true })
    .selectOption("selected");
  await page
    .getByLabel("EQ-1 — Synthetic equipment", { exact: true })
    .uncheck();
  await page
    .getByLabel("PART-2 — Synthetic replacement part", { exact: true })
    .check();
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Revoke the saved equipment for this recovery check");
  await page
    .getByRole("button", { name: "Save customer purchasing rules" })
    .click();
  await expect(
    page.getByText("Customer purchasing rules saved."),
  ).toBeVisible();
  const context = await browser.newContext();
  try {
    const buyer = await context.newPage();
    await login(buyer, true);
    await buyer
      .getByRole("button", {
        name: "View Synthetic replacement part",
        exact: true,
      })
      .click();
    await buyer
      .getByRole("button", { name: "Prepare order with this product" })
      .click();
    await buyer
      .getByLabel("Warehouse", { exact: true })
      .selectOption({ label: "Toronto" });
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      buyer.getByRole("region", { name: "Unavailable saved items" }),
    ).toBeVisible();
    await expect(
      buyer
        .getByRole("dialog")
        .getByText("Synthetic equipment", { exact: false }),
    ).toHaveCount(0);
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      buyer
        .getByRole("dialog")
        .getByText(
          "Review removal of unavailable saved items before continuing.",
        ),
    ).toBeVisible();
    await buyer
      .getByLabel("Remove unavailable items from this saved cart", {
        exact: true,
      })
      .check();
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      buyer.getByRole("heading", { name: "Review and accept order" }),
    ).toBeVisible();
    await buyer
      .getByLabel("Accept any unavailable units as backorders", { exact: true })
      .check();
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      buyer.getByText("Awaiting distributor approval. No stock is reserved", {
        exact: false,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("global product availability persists, hides customer access and restores badges", async ({
  page,
  browser,
}) => {
  await login(page, false);
  await navigateWorkspace(page, "Catalog");
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: "Manage PART-2", exact: true }),
  });
  const editor = row.locator(".availability-editor");
  await expect(
    editor.getByLabel("Temporarily hide from all customers"),
  ).toBeVisible();
  const productId = (await editor.getAttribute("aria-label"))!.replace(
    "Customer availability for ",
    "",
  );
  async function save(hidden: boolean, reason: string) {
    await editor
      .getByLabel("Temporarily hide from all customers")
      .setChecked(hidden);
    await editor.getByLabel("Show out-of-stock badge").check();
    await editor
      .getByLabel("Expected availability date (optional)")
      .fill("2026-11-01");
    await editor.getByLabel("Reason for availability change").fill(reason);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/commands/catalog.product-availability.set") &&
        r.request().method() === "POST",
    );
    await editor
      .getByRole("button", { name: "Save availability", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
    await expect(editor.getByRole("status")).toHaveText(
      "Availability saved for all customers.",
    );
    await expect(
      editor.getByLabel("Temporarily hide from all customers"),
    ).toBeEnabled();
  }
  await save(false, "Publish supplier availability advice for all customers");
  await page.reload();
  await expect(editor.getByLabel("Show out-of-stock badge")).toBeChecked();
  await expect(
    editor.getByLabel("Expected availability date (optional)"),
  ).toHaveValue("2026-11-01");
  await page.screenshot({
    path: "/tmp/distributor-availability-catalog-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/distributor-availability-catalog-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const buyer = await context.newPage();
    await login(buyer, true);
    const card = buyer.locator(".sf-card").filter({
      has: buyer.getByRole("heading", {
        name: "Synthetic replacement part",
        exact: true,
      }),
    });
    await expect(card.getByText("Out of stock", { exact: true })).toBeVisible();
    await expect(card.locator("time")).toHaveText("Nov 1, 2026");
    await card
      .getByRole("button", {
        name: "View Synthetic replacement part",
        exact: true,
      })
      .click();
    await expect(
      buyer
        .locator(".sf-detail-summary")
        .getByText("Out of stock", { exact: true }),
    ).toBeVisible();
    await buyer.screenshot({
      path: "/tmp/distributor-availability-customer-mobile.png",
      fullPage: true,
    });
    await save(true, "Temporarily hide this product from every customer");
    await page.reload();
    await expect(
      editor.getByLabel("Temporarily hide from all customers"),
    ).toBeChecked();
    await buyer.reload();
    await expect(
      buyer.getByRole("button", {
        name: "View Synthetic replacement part",
        exact: true,
      }),
    ).toHaveCount(0);
    const direct = await buyer.request.get(
      `/api/catalog/products/${encodeURIComponent(productId)}/resources`,
    );
    expect(direct.status()).toBeGreaterThanOrEqual(400);
    await save(
      false,
      "Restore customer product browsing with availability advice",
    );
    await buyer.reload();
    await expect(card.getByText("Out of stock", { exact: true })).toBeVisible();
    await expect(card.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-01",
    );
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  } finally {
    await context.close();
    // Leave the shared synthetic fixture visible and clear this test's advisory.
    await editor.getByLabel("Temporarily hide from all customers").uncheck();
    await editor.getByLabel("Show out-of-stock badge").uncheck();
    await editor.getByLabel("Expected availability date (optional)").fill("");
    await editor
      .getByLabel("Reason for availability change")
      .fill(
        "Restore synthetic availability fixture after browser verification",
      );
    await editor
      .getByRole("button", { name: "Save availability", exact: true })
      .click();
    await expect(editor.getByRole("status")).toHaveText(
      "Availability saved for all customers.",
    );
  }
});
