import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3140",
  pattern = "**/api/catalog/customer-products/page?*";
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("pricing-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function prepare(page: Page) {
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
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

test("browser: paged catalog preserves saved off-page quantities, literal search and one reviewed order on phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const dashboard = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(dashboard.products).toHaveLength(20);
  await prepare(page);
  const last = page.getByLabel("PAGE-44 · Paged product 44", { exact: true });
  await expect(last).toHaveValue("3");
  await expect(page.getByRole("dialog")).toContainText(
    "Customer price CA$7.77 + CA$1.01 tax per unit (CAD).",
  );
  await page.getByLabel("PAGE-00 · Paged product 0", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Next catalog page", exact: true })
    .click();
  await expect(
    page.getByLabel("PAGE-19 · Paged product 19", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("PAGE-00 · Paged product 0", { exact: true }),
  ).toHaveValue("2");
  await expect(last).toHaveValue("3");
  await page
    .getByLabel("PAGE-20 · Paged product 20", { exact: true })
    .fill("1");
  await page.getByLabel("Search catalog", { exact: true }).fill("%_");
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await expect(
    page.getByLabel("PAGE-42 · Literal %_ widget", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "1 products on this page",
  );
  await expect(
    page.getByLabel("PAGE-20 · Paged product 20", { exact: true }),
  ).toHaveValue("1");
  await expect(last).toHaveValue("3");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Review removal of unavailable saved items before continuing.",
  );
  await page
    .getByLabel("Remove unavailable items from this saved cart", {
      exact: true,
    })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  // Native amounts: 2×(2000+260) + 1×(2020+263) + 3×(777+101).
  await expect(page.getByRole("dialog")).toContainText("Total: CA$94.37");
  await page
    .getByLabel("Accept any unavailable units as backorders", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(after.orders).toHaveLength(1);
  expect(after.orders[0].total).toBe(9437);
  expect(
    after.orders[0].lines.map((l: any) => [l.description, l.quantity]).sort(),
  ).toEqual([
    ["Paged product 0", 2],
    ["Paged product 20", 1],
    ["Paged product 44", 3],
  ]);
  await navigateWorkspace(page, "Orders", "Orders");
  await expect(
    page.getByRole("button", {
      name: "Amend quantity: Paged product 44",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Amend quantity: Paged product 20",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await prepare(page);
  await expect(last).toHaveValue("3");
  await expect(
    page.getByLabel("PAGE-20 · Paged product 20", { exact: true }),
  ).toHaveValue("1");
  await expect(
    page.getByLabel("Remove unavailable items from this saved cart", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: catalog search failures preserve the basket and retry the exact page; abandoned reads stay closed", async ({
  page,
}) => {
  await login(page);
  await prepare(page);
  await page.getByLabel("PAGE-01 · Paged product 1", { exact: true }).fill("4");
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic paged catalog unavailable" },
      });
    else await route.continue();
  });
  await page.getByLabel("Search catalog", { exact: true }).fill("absent");
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic paged catalog unavailable",
  );
  await expect(
    page.getByLabel("PAGE-01 · Paged product 1", { exact: true }),
  ).toHaveValue("4");
  await page
    .getByRole("button", { name: "Retry catalog page", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("No matching products.");
  expect(urls[1]).toBe(urls[0]);
  await expect(
    page.getByLabel("PAGE-01 · Paged product 1", { exact: true }),
  ).toHaveValue("4");
  await page.unroute(pattern);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    observed = new Promise<void>((r) => (started = r));
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Clear catalog search", exact: true })
    .click();
  await observed;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.unroute(pattern);
  await prepare(page);
  await expect(
    page.getByLabel("PAGE-01 · Paged product 1", { exact: true }),
  ).toHaveValue("0");
});

test("browser: saved cart pages preserve failed continuation and resume the selected off-page customer and warehouse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await navigateWorkspace(page, "Orders", "Orders");
  const section = page.getByRole("region", {
    name: "Saved carts",
    exact: true,
  });
  await expect(section.getByRole("row")).toHaveCount(21);
  await expect(section).toContainText("Queue 43");
  const urls: string[] = [];
  await page.route("**/api/carts/page?*", async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic cart page unavailable" },
      });
    else await route.continue();
  });
  await section
    .getByRole("button", { name: "Next saved cart page", exact: true })
    .click();
  await expect(section).toContainText("Synthetic cart page unavailable");
  await expect(section).toContainText("Queue 43");
  await section
    .getByRole("button", { name: "Retry saved cart page", exact: true })
    .click();
  await expect(section).toContainText("Queue 23");
  expect(urls[1]).toBe(urls[0]);
  await section
    .getByRole("button", { name: "Next saved cart page", exact: true })
    .click();
  await expect(section.getByRole("row")).toHaveCount(6);
  await expect(section).toContainText("Toronto");
  const row = section.getByRole("row").filter({ hasText: "Queue 00" });
  await row.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByLabel("Warehouse", { exact: true }).locator("option:checked"),
  ).toHaveText("Queue 00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit order quantities", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("EQ-1 · Synthetic equipment", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await section
    .getByLabel("Saved cart warehouse", { exact: true })
    .selectOption({ label: "Queue 00" });
  await section
    .getByRole("button", { name: "Search saved carts", exact: true })
    .click();
  await expect(section.getByRole("row")).toHaveCount(2);
  await expect(
    section.getByRole("button", { name: "Next saved cart page", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("browser: removing selected off-page products keeps focus and cancel preserves the saved cart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const original = await (await page.request.get(`${origin}/api/carts`)).json();
  let mutations = 0;
  await page.route("**/api/commands/cart.*", async (route) => {
    mutations++;
    await route.continue();
  });
  await prepare(page);
  await page.getByLabel("PAGE-00 · Paged product 0", { exact: true }).fill("2");
  await page
    .getByLabel("Search catalog", { exact: true })
    .fill("no-synthetic-match");
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("No matching products.");
  const beforeBasket = JSON.parse(
    await page.getByRole("dialog").locator('input[name="basket"]').inputValue(),
  ) as { productId: string; quantity: number }[];
  const removedLines = beforeBasket.filter((line) => line.quantity === 3);
  expect(removedLines).toHaveLength(1);
  const remove = page.getByRole("button", {
    name: "Remove PAGE-44 · Paged product 44 from cart",
    exact: true,
  });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(0);
  await expect(
    page.getByLabel("PAGE-44 · Paged product 44", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Search catalog", { exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel("PAGE-00 · Paged product 0", { exact: true }),
  ).toHaveValue("2");
  expect(
    JSON.parse(
      await page
        .getByRole("dialog")
        .locator('input[name="basket"]')
        .inputValue(),
    ),
  ).toEqual(
    beforeBasket.filter(
      (line) => line.productId !== removedLines[0]!.productId,
    ),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(mutations).toBe(0);
  expect(await (await page.request.get(`${origin}/api/carts`)).json()).toEqual(
    original,
  );
  await prepare(page);
  await expect(
    page.getByLabel("PAGE-44 · Paged product 44", { exact: true }),
  ).toHaveValue("3");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
