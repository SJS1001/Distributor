import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3138";
const pattern = "**/api/catalog/customer-products?*";
async function login(page: Page, name: string) {
  await page.goto(origin);
  await page
    .getByLabel("Email", { exact: true })
    .fill(
      name === "admin" ? "admin@example.test" : `pricing-${name}@example.test`,
    );
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await response).json()).csrf;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  return csrf as string;
}
async function prepare(page: Page, customer?: string) {
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  if (customer)
    await page
      .getByLabel("Customer", { exact: true })
      .selectOption({ label: customer });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit order quantities", exact: true }),
  ).toBeVisible();
}

test("browser: customer prices follow account selection, fresh quotes and saved carts on phone", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const adminContext = await browser.newContext(),
    partnerContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage(),
      csrf = await login(admin, "admin");
    const partner = await partnerContext.newPage();
    await login(partner, "partner");
    await login(page, "buyer");
    const dashboard = await (
      await page.request.get(`${origin}/api/dashboard`)
    ).json();
    expect(dashboard.products[0].unit_price).toBe(8199);
    const other = await (
      await partner.request.get(`${origin}/api/dashboard`)
    ).json();
    expect(other.products[0].unit_price).toBe(4200);
    expect(
      (
        await page.request.get(
          `${origin}/api/catalog/customer-products?accountId=${other.accounts[0].id}`,
        )
      ).status(),
    ).toBe(403);
    await prepare(page);
    await expect(page.getByRole("dialog")).toContainText(
      "Customer price CA$81.99 + CA$10.66 tax per unit (CAD).",
    );
    await page
      .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
      .fill("1");
    // Change native prices after the editing read; quoting must fetch the new price.
    const change = await admin.request.post(
      `${origin}/api/commands/product.price`,
      {
        headers: {
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": "browser-pricing-drift",
        },
        data: {
          productId: dashboard.products[0].id,
          tier: "standard",
          unitPrice: 9100,
        },
      },
    );
    expect(change.status()).toBe(200);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Review and accept order",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Total: CA$102.83");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await prepare(page);
    await expect(
      page.getByLabel("EQ-1 · Synthetic equipment", { exact: true }),
    ).toHaveValue("1");
    await expect(page.getByRole("dialog")).toContainText(
      "Customer price CA$91.00 + CA$11.83 tax per unit (CAD).",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const accepted = (
      await (await page.request.get(`${origin}/api/dashboard`)).json()
    ).orders;
    expect(accepted).toHaveLength(1);
    expect(accepted[0].total).toBe(10283);
    expect(accepted[0].lines[0].unit_price).toBe(9100);
    await prepare(admin, "Other pricing customer");
    await expect(admin.getByRole("dialog")).toContainText(
      "Customer price CA$42.00 + CA$5.46 tax per unit (CAD).",
    );
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await prepare(admin, "Synthetic buyer");
    await expect(admin.getByRole("dialog")).toContainText(
      "Customer price CA$91.00 + CA$11.83 tax per unit (CAD).",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await partnerContext.close();
  }
});

test("browser: customer price failures retry the same selection and abandoned reads cannot reopen order entry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "commercial");
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic customer pricing unavailable" },
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Other pricing customer" });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic customer pricing unavailable",
  );
  await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
    new URL(urls[0]!).searchParams.get("accountId")!,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Customer price CA$42.00 + CA$5.46 tax per unit (CAD).",
  );
  expect(urls[1]).toBe(urls[0]);
  await page.unroute(pattern);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    observed = new Promise<void>((resolve) => {
      started = resolve;
    });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await observed;
  // Dispatch the navigation control while the modal read is pending.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  release();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Prepare order", exact: true }),
  ).toBeEnabled();
  await page.unroute(pattern);
  await prepare(page, "Other pricing customer");
  await expect(page.getByRole("dialog")).toContainText(
    "Customer price CA$42.00",
  );
  expect(errors).toEqual([]);
});
