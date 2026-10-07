import { test, expect, type Page } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, buyer: boolean) {
  await page.goto(buyer ? "/#customer-sign-in" : "/#admin-sign-in");
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
  // This fixture has one equipment item; accessories stay in the catalog.
  await expect(
    page.getByRole("button", { name: "Next featured product" }),
  ).toBeDisabled();
  await page.getByLabel("Search products").fill("EQ-1");
  await page.getByLabel("Search products").press("Enter");
  await expect(page.getByLabel("Search products")).toBeFocused();
  // Product cards add a chosen quantity without leaving the catalog.
  await page
    .getByLabel("Quantity of Synthetic equipment", { exact: true })
    .fill("2");
  await page
    .getByRole("button", {
      name: "Add Synthetic equipment to cart",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Added 2 × Synthetic equipment to your cart."),
  ).toBeVisible();
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
  // The product page shows that product only, with Add to cart in place of
  // the old prepare button; the warehouse is chosen in the cart.
  await expect(
    page.getByRole("region", { name: "Product catalog" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Prepare order with this product" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(
    page.getByText("Added 1 × Synthetic equipment to your cart."),
  ).toBeVisible();
  await page.getByRole("button", { name: "View cart (3 items)" }).click();
  await expect(
    page.getByLabel("Quantity of Synthetic equipment in cart"),
  ).toHaveValue("3");
  await page
    .getByRole("combobox", { name: "Ship from warehouse", exact: true })
    .selectOption({ label: "Toronto" });
  await page.screenshot({
    path: "/tmp/distributor-shop-cart-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review order quantities", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit order quantities" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("EQ-1 · Synthetic equipment", { exact: true }),
  ).toHaveValue("3");
  // Only the cart's products are listed, without catalog browsing.
  await expect(
    page.getByRole("dialog").getByRole("region", { name: "Catalog page" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review and accept order" }),
  ).toBeVisible();
  // Saving the warehouse cart releases the Shop cart lines.
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("distributor-shop-cart:"),
      ),
    ),
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept order", exact: true })
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
    .getByRole("button", { name: "Resubmit for review", exact: true })
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
      .getByRole("button", { name: "Resubmit for review", exact: true })
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

test("staff suggest add-ons that buyers add from the product page and cart; dialogs close from the corner or outside", async ({
  page,
  browser,
}) => {
  await login(page, false);
  await navigateWorkspace(page, "Catalog");
  await page.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await page.getByRole("tab", { name: "Add-ons", exact: true }).click();
  await page.getByLabel("Find a product to add").fill("PART-2");
  await page
    .getByRole("button", { name: "Search products", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Add Synthetic replacement part as an add-on",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Reason for add-on change")
    .fill("Replacement part is installed with this unit");
  await page
    .getByRole("button", { name: "Save suggested add-ons", exact: true })
    .click();
  await expect(
    page.getByText("Suggested add-ons saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Chosen add-ons" }),
  ).toContainText("PART-2");
  // A click outside the product management dialog closes it.
  await page.mouse.click(4, 4);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const buyer = await context.newPage();
    const errors: string[] = [];
    buyer.on("pageerror", (e) => errors.push(e.message));
    await login(buyer, true);
    await buyer
      .getByRole("button", { name: "View Synthetic equipment", exact: true })
      .click();
    const suggested = buyer.getByRole("region", { name: "Suggested add-ons" });
    await expect(suggested).toContainText("Synthetic replacement part");
    await buyer.screenshot({
      path: "/tmp/distributor-product-addons.png",
      fullPage: true,
    });
    await suggested
      .getByRole("button", {
        name: "Add add-on Synthetic replacement part to cart",
        exact: true,
      })
      .click();
    await expect(
      buyer.getByText("Added 1 × Synthetic replacement part to your cart."),
    ).toBeVisible();
    await buyer
      .getByRole("button", { name: "Add to cart", exact: true })
      .click();
    await buyer.getByRole("button", { name: "View cart (2 items)" }).click();
    const cartAddons = buyer.getByRole("region", {
      name: "Add-ons for products in your cart",
    });
    // An add-on already in the cart is not suggested again.
    await expect(
      buyer.getByLabel("Quantity of Synthetic replacement part in cart"),
    ).toHaveValue("1");
    await expect(cartAddons).toHaveCount(0);
    await buyer
      .getByRole("button", {
        name: "Remove Synthetic replacement part from cart",
        exact: true,
      })
      .click();
    await expect(cartAddons).toContainText("Synthetic replacement part");
    await buyer
      .getByRole("combobox", { name: "Ship from warehouse", exact: true })
      .selectOption({ label: "Toronto" });
    const review = buyer.getByRole("button", {
      name: "Review order quantities",
      exact: true,
    });
    await review.click();
    await expect(
      buyer.getByRole("heading", { name: "Edit order quantities" }),
    ).toBeVisible();
    await buyer
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await review.click();
    await expect(
      buyer.getByRole("heading", { name: "Edit order quantities" }),
    ).toBeVisible();
    await buyer.mouse.click(4, 4);
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("staff uploads and publishes permitted resources, edits rules and buyer sees only published resources", async ({
  page,
  browser,
}) => {
  await login(page, false);
  const csrf = (await (await page.request.get("/api/session")).json()).csrf;
  const created = await page.request.post("/api/commands/product.create", {
    headers: {
      origin: "http://127.0.0.1:3216",
      "x-csrf-token": csrf,
      "idempotency-key": "storefront-photo-priority-fixture",
    },
    data: {
      sku: "AA-NO-PHOTO",
      name: "Synthetic unphotographed equipment",
      serialized: true,
      unitPrice: 9900,
      taxBasisPoints: 1300,
    },
  });
  expect(created.ok()).toBe(true);
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
  await page
    .getByRole("button", { name: "Close product management", exact: true })
    .click();
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page
    .getByLabel("Catalog access", { exact: true })
    .selectOption("selected");
  await page.getByLabel("EQ-1 — Synthetic equipment", { exact: true }).check();
  await page
    .getByLabel("AA-NO-PHOTO — Synthetic unphotographed equipment", {
      exact: true,
    })
    .check();
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
    const featured = buyer.getByRole("region", { name: "Featured products" });
    await expect(
      featured.getByRole("heading", {
        name: "Synthetic equipment",
        exact: true,
      }),
    ).toBeVisible();
    const photo = featured.getByRole("img", {
      name: "Synthetic equipment test graphic",
    });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveJSProperty("naturalWidth", 40);
    // A photographed eligible equipment item outranks the earlier unpictured SKU.
    await expect(
      buyer.getByRole("button", {
        name: "View Synthetic unphotographed equipment",
        exact: true,
      }),
    ).toBeVisible();
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
    await expect(
      buyer.getByRole("heading", { name: "Synthetic equipment", exact: true }),
    ).toBeVisible();
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
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
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
      .getByRole("button", { name: "Add to cart", exact: true })
      .click();
    await buyer.getByRole("button", { name: "View cart (1 item)" }).click();
    await buyer
      .getByRole("combobox", { name: "Ship from warehouse", exact: true })
      .selectOption({ label: "Toronto" });
    await buyer
      .getByRole("button", { name: "Review order quantities", exact: true })
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
      .getByRole("button", { name: "Accept order", exact: true })
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
    await expect(
      buyer
        .locator(".sf-detail-summary")
        .getByText("Out of stock", { exact: true }),
    ).toBeVisible();
    await buyer
      .getByRole("navigation", { name: "Product breadcrumb", exact: true })
      .getByRole("button", { name: "Shop", exact: true })
      .click();
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
