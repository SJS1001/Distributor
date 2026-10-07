import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
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
async function open(page: Page) {
  await navigateWorkspace(page, "Customers");
  await expect(page.getByText("Staff notes", { exact: true })).toBeHidden();
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic buyer", exact: true }),
  ).toBeVisible();
}
test("dedicated record routes, six tabs, selected pricing, terms, notes and company contacts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await open(page);
  const initial = page.url();
  expect(initial).toContain("customer=");
  await expect(
    page
      .getByRole("tablist", { name: "Customer record sections" })
      .getByRole("tab"),
  ).toHaveCount(6);
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await expect(page.getByLabel("Price calculation")).toBeEnabled();
  await expect(page.getByLabel("Customer for pricing")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Pricing", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(
    page.getByRole("tab", { name: "Pricing", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Billing terms", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not recorded", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit customer billing terms" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Terms basis").selectOption("configured");
  await page.getByLabel("Calendar days", { exact: true }).fill("14");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic agreed billing terms");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save billing details", exact: true })
    .click();
  await expect(
    page.getByText("14 calendar days", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByLabel("Contact name", { exact: true }).fill("Morgan Buyer");
  await page
    .getByLabel("Job title", { exact: true })
    .fill("Purchasing manager");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("morgan@example.test");
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(page.getByText("Contact saved.", { exact: true })).toBeVisible();
  await page.reload();
  // The Overview summary card also names the primary contact.
  await expect(
    page
      .getByRole("tabpanel", { name: "Contacts" })
      .getByText("Morgan Buyer", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByText("Staff notes", { exact: true }).click();
  await expect(page.getByText(/Private to authorized staff/)).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByText("No retained orders for this customer."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Invoices", exact: true }).click();
  await expect(
    page.getByText("No retained invoices for this customer."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(
    page.getByText("No retained payments for this customer."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page
    .getByRole("heading", { name: "Synthetic buyer", exact: true })
    .focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: "/tmp/distributor-customer-record-desktop-top-1723.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Workspace breadcrumb" })
    .getByRole("link", { name: "Customers", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Synthetic buyer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Other synthetic company", exact: true })
    .click();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(page.getByText("No contacts recorded.")).toBeVisible();
  await expect(page.getByText("Morgan Buyer", { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
test("phone tabs scroll without page overflow and unknown customer fails closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await open(page);
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Contacts", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page
      .getByRole("navigation", { name: "Workspace breadcrumb" })
      .locator("[aria-current=page]"),
  ).toHaveText("Contacts");
  await page.getByRole("tab", { name: "Contacts", exact: true }).focus();
  await expect(
    page.getByRole("tab", { name: "Contacts", exact: true }),
  ).toBeFocused();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  console.log(
    "PHONE CAPTURE",
    await page.evaluate(() => ({
      active: document.activeElement?.textContent,
      scrollY: window.scrollY,
      breadcrumb: document.querySelector(".workspace-breadcrumbs")?.textContent,
      skipTransform: getComputedStyle(document.querySelector(".skip-link")!)
        .transform,
    })),
  );
  await page.screenshot({
    path: "/tmp/distributor-customer-record-phone-top-1723.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "/tmp/distributor-customer-record-phone-viewport-1723.png",
    fullPage: false,
  });
  await page.goto("/#page=Customers&customer=missing&customerTab=notes");
  await expect(
    page.getByRole("heading", { name: "Customer unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Staff notes", { exact: true })).toBeHidden();
});
test("buyer Account stays separate and staff customer URLs are denied", async ({
  page,
}) => {
  await login(page, true);
  await page.goto("/#page=Account");
  await expect(page.locator("#workspace-title")).toHaveText("Account");
  await expect(
    page.getByText("Residency choice", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Staff notes", { exact: true })).toBeHidden();
  await page.goto("/#page=Customers&customer=missing&customerTab=contacts");
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  await expect(
    page.getByRole("heading", { name: "Company contacts" }),
  ).toBeHidden();
});

test("uncertain contact save preserves exact retry after auth loss and company switch", async ({
  page,
}) => {
  await login(page);
  await open(page);
  const recordUrl = page.url();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  const name = `Recovery contact ${crypto.randomUUID()}`;
  await page.getByLabel("Contact name", { exact: true }).fill(name);
  const endpoint = "**/api/commands/account.contact.save";
  let payload = "",
    key = "";
  await page.route(endpoint, async (route) => {
    payload = route.request().postData()!;
    key = route.request().headers()["idempotency-key"]!;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort();
  });
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  const retry = page.getByRole("button", {
    name: "Retry saved contact change",
  });
  await expect(retry).toBeEnabled();
  await page.unroute(endpoint);
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Session expired" }),
    }),
  );
  await retry.click();
  await expect(retry).toBeEnabled();
  await page.unroute(endpoint);
  await page.reload();
  await expect(retry).toBeEnabled();
  await page
    .getByRole("navigation", { name: "Workspace breadcrumb" })
    .getByRole("link", { name: "Customers", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Other synthetic company", exact: true })
    .click();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(retry).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeHidden();
  await page.goto(
    recordUrl.replace("customerTab=overview", "customerTab=contacts"),
  );
  await expect(retry).toBeEnabled();
  await page.route(endpoint, async (route) => {
    expect(route.request().postData()).toBe(payload);
    expect(route.request().headers()["idempotency-key"]).toBe(key);
    await route.continue();
  });
  await retry.click();
  await expect(page.getByText("Contact saved.", { exact: true })).toBeVisible();
  await expect(
    page.locator(".customer-contact-list li").filter({ hasText: name }),
  ).toHaveCount(1);
  await page.goto("/#page=Customers&section=customer-purchasing");
  await expect(
    page.getByRole("link", { name: "Synthetic buyer", exact: true }),
  ).toBeVisible();
});

test("customer purchasing checkboxes align beside labels on desktop and phone", async ({
  page,
}) => {
  await login(page);
  await open(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page
    .getByLabel("Catalog access", { exact: true })
    .selectOption("selected");
  const panel = page.locator(".customer-purchasing-rules");
  await expect(
    panel.locator(".policy-products .purchasing-check").first(),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await panel
      .locator(".purchasing-check")
      .first()
      .evaluate((label) => {
        const check = label.querySelector("input")!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const labelRect = label.getBoundingClientRect(),
          checkRect = check.getBoundingClientRect();
        return {
          display: getComputedStyle(label).display,
          columns: getComputedStyle(label).gridTemplateColumns,
          checkWidth: checkRect.width,
          left: checkRect.left - labelRect.left,
          height: labelRect.height,
        };
      });
    expect(layout.display).toBe("grid");
    expect(layout.columns.startsWith("24px ")).toBe(true);
    expect(layout.checkWidth).toBe(24);
    expect(layout.left).toBeLessThan(12);
    expect(layout.height).toBeLessThan(width === 390 ? 100 : 50);
    expect(
      await panel
        .locator(".policy-products")
        .evaluate((el) => getComputedStyle(el).maxHeight),
    ).toBe("256px");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: `/tmp/distributor-customer-purchasing-${width}-aligned.png`,
    });
  }
});
