import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3141";
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const reply = page.waitForResponse((r) => r.url().endsWith("/api/login"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await reply).json()).csrf;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Catalog");
  await expect(
    page.getByRole("button", { name: "Retire LIFE-00", exact: true }),
  ).toBeVisible();
  return csrf;
}
async function search(page: Page, q: string, state = "active") {
  await page.getByLabel("Catalog search", { exact: true }).fill(q);
  await page
    .getByRole("combobox", { name: "Product status", exact: true })
    .selectOption(state);
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
}
test("browser: staff catalog preserves search during paging and reviews retirement/reactivation on phone with exact lost-response recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await search(page, "LIFE");
  await expect(
    page.getByRole("region", { name: "Staff catalog" }),
  ).toContainText("20 products loaded");
  await page
    .getByRole("button", { name: "Next staff catalog page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retire LIFE-39", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Staff catalog" }),
  ).toContainText("20 products loaded");
  await expect(
    page.getByRole("button", { name: "Retire LIFE-00", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Previous catalog page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retire LIFE-00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retire LIFE-39", exact: true }),
  ).toHaveCount(0);
  await search(page, "LIFE-42");
  await page
    .getByRole("button", { name: "Retire LIFE-42", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Lifecycle fixture 42");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Phone reviewed synthetic retirement");
  const attempts: { key: string; body: string }[] = [];
  await page.route("**/api/commands/product.retire", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1)
      await route.fulfill({
        status: 500,
        json: { message: "Synthetic lost response" },
      });
    else await route.fulfill({ response });
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retire product", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Synthetic lost response",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retire product", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await search(page, "LIFE-42", "retired");
  await page
    .getByRole("button", { name: "Lifecycle history LIFE-42", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Phone reviewed synthetic retirement",
  );
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reactivate LIFE-42", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic reactivation");
  await page
    .getByRole("button", { name: "Reactivate product", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await search(page, "LIFE-42");
  await expect(
    page.getByRole("button", { name: "Retire LIFE-42", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("browser: product lifecycle history appends older records without closing the dialog", async ({
  page,
}) => {
  await login(page);
  await search(page, "EQ-1", "retired");
  await page
    .getByRole("button", { name: "Lifecycle history EQ-1", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(20);
  await expect(page.getByRole("dialog")).not.toContainText(
    "Historical lifecycle 0",
  );
  await page
    .getByRole("button", { name: "Load older lifecycle changes", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(25);
  await expect(page.getByRole("dialog")).toContainText(
    "Historical lifecycle 0",
  );
  await page
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("browser: retirement refuses an obsolete review and navigation cancels abandoned review reads", async ({
  page,
}) => {
  const csrf = await login(page);
  await search(page, "LIFE-41");
  const products = await (
    await page.request.get(`${origin}/api/catalog/products/page?q=LIFE-41`)
  ).json();
  const id = products.items[0].id;
  await page
    .getByRole("button", { name: "Retire LIFE-41", exact: true })
    .click();
  const review = await (
    await page.request.get(`${origin}/api/catalog/products/${id}/review`)
  ).json();
  const headers = {
    "x-csrf-token": csrf,
    origin,
    "idempotency-key": "independent-retirement",
  };
  expect(
    (
      await page.request.post(`${origin}/api/commands/product.retire`, {
        headers,
        data: {
          productId: id,
          expectedHash: review.expectedHash,
          reason: "Other synthetic operator",
        },
      })
    ).status(),
  ).toBe(200);
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Obsolete review");
  await page
    .getByRole("button", { name: "Retire product", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("REVIEW_CHANGED");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await search(page, "LIFE-40");
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let reached!: () => void;
  const reachedPromise = new Promise<void>((r) => {
    reached = r;
  });
  await page.route("**/api/catalog/products/*/review", async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByRole("button", { name: "Retire LIFE-40", exact: true })
    .click();
  await reachedPromise;
  await navigateWorkspace(page, "Inventory", "Stock");
  release();
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
