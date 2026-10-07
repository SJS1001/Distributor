import { test, expect } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

test("phone shop preserves local feedback, catalog recovery and cart review priority", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#customer-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("shop-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  await page
    .getByRole("button", { name: "Search products", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search products" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".sf-search")
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeLessThan(
    await page
      .locator(".sf-showcase")
      .evaluate((el) => el.getBoundingClientRect().top),
  );
  await page
    .getByRole("searchbox", { name: "Search products" })
    .fill("definitely-no-such-synthetic-product");
  await page.getByRole("searchbox", { name: "Search products" }).press("Enter");
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search products" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("searchbox", { name: "Search products" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "View Synthetic equipment", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Documents", exact: true }),
  ).toBeVisible();
  const referenceTop = await page
    .locator(".sf-information")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(referenceTop).toBeLessThan(
    await page
      .getByRole("region", { name: "Suggested add-ons" })
      .evaluate((el) => el.getBoundingClientRect().top),
  );
  const add = page.getByRole("button", { name: "Add to cart", exact: true });
  await expect(add).toHaveCSS("white-space", "nowrap");
  await add.click();
  const feedback = page.locator(".sf-purchase-panel .sf-local-feedback");
  await expect(feedback).toContainText(
    "1 × Synthetic equipment added to your cart.",
  );
  await feedback
    .getByRole("button", { name: "View cart", exact: true })
    .click();
  const review = page.getByRole("button", { name: "Review order quantities" });
  await expect(review).toBeDisabled();
  await expect(
    page.getByText("Choose a warehouse to review your order.", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".sf-cart-checkout")
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeLessThan(
    await page
      .getByRole("region", { name: "Add-ons for products in your cart" })
      .evaluate((el) => el.getBoundingClientRect().top),
  );
  await page
    .getByRole("combobox", { name: "Ship from warehouse", exact: true })
    .selectOption({ label: "Toronto" });
  await expect(review).toBeEnabled();
  await page
    .getByRole("button", { name: "Continue shopping", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Add add-on Synthetic replacement part to cart",
    })
    .click();
  await expect(page.locator(".sf-addons .sf-local-feedback")).toContainText(
    "Synthetic replacement part added to your cart.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("customer Reports computed theme retains readable content and report priority", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#customer-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("shop-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  await navigateWorkspace(page, "Overview");
  await expect(page.locator("#workspace-title")).toHaveText("Reports");
  await expect(page.locator(".overview .metric-hint").first()).toBeVisible();
  const ratios = await page
    .locator(
      ".overview .metric-hint, .overview .workflow-path small, .overview .attention-item > span, .overview .attention-item > strong, .overview .report-meter-label, .overview .report-meter-label strong",
    )
    .evaluateAll((elements) => {
      const rgb = (s: string) =>
        (s.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
      const luminance = (c: number[]) =>
        c
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      return elements
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          let parent: Element | null = el;
          let background = "rgb(255, 255, 255)";
          while (parent) {
            const candidate = getComputedStyle(parent).backgroundColor;
            if (
              candidate !== "rgba(0, 0, 0, 0)" &&
              candidate !== "transparent"
            ) {
              background = candidate;
              break;
            }
            parent = parent.parentElement;
          }
          const style = getComputedStyle(el),
            a = luminance(rgb(style.color)),
            b = luminance(rgb(background));
          return {
            text: el.textContent?.trim(),
            minimum:
              parseFloat(style.fontSize) >= 24 ||
              (parseFloat(style.fontSize) >= 18.66 &&
                parseInt(style.fontWeight) >= 700)
                ? 3
                : 4.5,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
    });
  await expect(page.locator(".report-meter.is-zero").first()).toBeVisible();
  expect(ratios.length).toBeGreaterThan(4);
  for (const row of ratios)
    expect(row.ratio, row.text).toBeGreaterThanOrEqual(row.minimum);
  expect(
    await page
      .locator(".report-grid")
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeLessThan(
    await page
      .locator(".recent-orders")
      .evaluate((el) => el.getBoundingClientRect().top),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await navigateWorkspace(page, "Billing", "Invoices");
  await page
    .locator(".record-title-link")
    .filter({ hasText: "INV" })
    .first()
    .click();
  await expect(page.locator(".record-figures > div").first()).toContainText(
    "Current balance",
  );
});
