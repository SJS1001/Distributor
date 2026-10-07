import { navigateWorkspace } from "./workspace-navigation.ts";
import {
  expectBuyerLanding,
  expectSignedOut,
  navigateBuyerWorkspace,
} from "./commerce-browser-navigation.ts";
import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3139";
const quantityLabel = "EQ-1 · Synthetic equipment";
const saveRoute = "**/api/commands/cart.save";
const quoteRoute = "**/api/commands/cart.quote";
async function login(page: Page, name: string) {
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(
      name === "admin" ? "admin@example.test" : `cart-${name}@example.test`,
    );
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/login"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await response).json()).csrf as string;
  if (name === "admin")
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  else {
    // Buyers land on Shop; their order preparation starts from Reports.
    await expectBuyerLanding(page);
    await navigateBuyerWorkspace(page, "Overview");
  }
  return csrf;
}
async function prepare(page: Page) {
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Edit order quantities", exact: true }),
  ).toBeVisible();
}
async function proceed(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
}
async function carts(page: Page) {
  const response = await page.request.get(`${origin}/api/carts`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function order(page: Page, total: number, quantity: number) {
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Accept order", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dashboard = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(dashboard.orders).toHaveLength(1);
  await expect(
    page.getByText(
      `Order ${dashboard.orders[0].id} accepted. View fulfillment progress in Orders.`,
      { exact: true },
    ),
  ).toBeVisible();
  expect(dashboard.orders[0].total).toBe(total);
  expect(dashboard.orders[0].lines[0].quantity).toBe(quantity);
  expect(dashboard.orders[0].lines[0].allocated).toBe(quantity);
  return dashboard.orders[0];
}
const unavailable = {
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({
    code: "SYNTHETIC_RESPONSE_LOSS",
    message: "Synthetic quote unavailable. Retry.",
  }),
};

test("browser: cart recovery retries a failed quote without saving the same cart again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "quote");
  const saves: unknown[] = [];
  await page.route(saveRoute, async (route) => {
    saves.push(route.request().postDataJSON());
    await route.continue();
  });
  let quotes = 0;
  await page.route(quoteRoute, async (route) => {
    if (++quotes === 1) await route.fulfill(unavailable);
    else await route.continue();
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(
    "2",
  );
  expect((await carts(page))[0].revision).toBe(1);
  await proceed(page);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Accept order", exact: true }),
  ).toBeEnabled();
  let refreshFailed = false;
  await page.route("**/api/dashboard", async (route) => {
    if (!refreshFailed) {
      refreshFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "SYNTHETIC_REFRESH_FAILURE",
          message: "Synthetic accepted-order refresh unavailable.",
        }),
      });
    } else await route.continue();
  });
  const accepted = await order(page, 22600, 2);
  await expect(page.getByRole("alert")).toContainText(
    `Order submission ${accepted.id} saved; refresh failed:`,
  );
  expect(refreshFailed).toBe(true);
  expect(saves).toHaveLength(1);
  expect(quotes).toBe(2);
  expect((await carts(page))[0].revision).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: cart recovery replays lost save and quote responses with their original keys", async ({
  page,
}) => {
  await login(page, "lost");
  const saves: { key: string | undefined; data: unknown }[] = [];
  const quotes: { key: string | undefined; data: unknown }[] = [];
  let originalQuote: string | undefined;
  await page.route(saveRoute, async (route) => {
    saves.push({
      key: route.request().headers()["idempotency-key"],
      data: route.request().postDataJSON(),
    });
    if (saves.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill(unavailable);
    } else await route.continue();
  });
  await page.route(quoteRoute, async (route) => {
    quotes.push({
      key: route.request().headers()["idempotency-key"],
      data: route.request().postDataJSON(),
    });
    if (quotes.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      originalQuote = (await response.json()).id;
      await route.fulfill(unavailable);
    } else {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect((await response.json()).id).toBe(originalQuote);
      await route.fulfill({ response });
    }
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  expect((await carts(page))[0].revision).toBe(1);
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  expect(quotes).toHaveLength(1);
  await proceed(page);
  const acceptRequest = page.waitForRequest((r) =>
    r.url().endsWith("/api/commands/order.accept"),
  );
  await order(page, 11300, 1);
  expect((await acceptRequest).postDataJSON().quoteId).toBe(originalQuote);
  expect(saves).toHaveLength(2);
  expect(saves[0]!.key).toBeTruthy();
  expect(saves[1]).toEqual(saves[0]);
  expect(quotes).toHaveLength(2);
  expect(quotes[0]!.key).toBeTruthy();
  expect(quotes[1]).toEqual(quotes[0]);
  expect((await carts(page))[0].revision).toBe(1);
});

test("browser: cart recovery resolves a lost save before submitting edited quantities", async ({
  page,
}) => {
  await login(page, "edited");
  const saves: { revision: number; lines: { quantity: number }[] }[] = [];
  const keys: (string | undefined)[] = [];
  await page.route(saveRoute, async (route) => {
    saves.push(route.request().postDataJSON());
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (saves.length === 1) await route.fulfill(unavailable);
    else await route.fulfill({ response });
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  await page.getByLabel(quantityLabel, { exact: true }).fill("3");
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  expect(saves.map((s) => [s.revision, s.lines[0]!.quantity])).toEqual([
    [0, 1],
    [0, 1],
    [1, 3],
  ]);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  expect((await carts(page))[0].revision).toBe(2);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await prepare(page);
  await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(
    "3",
  );
  await proceed(page);
  await order(page, 33900, 3);
});

test("browser: cart recovery refuses another session's revision until the buyer reopens the saved cart", async ({
  page,
  browser,
}) => {
  await login(page, "conflict");
  let quotes = 0;
  await page.route(quoteRoute, async (route) => {
    if (++quotes === 1) await route.fulfill(unavailable);
    else await route.continue();
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  const saved = (await carts(page))[0];
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage(),
      csrf = await login(admin, "admin");
    const update = await admin.request.post(
      `${origin}/api/commands/cart.save`,
      {
        headers: {
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": "cart-conflict-native-change",
        },
        data: {
          accountId: saved.account_id,
          warehouseId: saved.warehouse_id,
          revision: saved.revision,
          lines: [{ productId: saved.lines[0].productId, quantity: 1 }],
        },
      },
    );
    expect(update.status()).toBe(200);
    await proceed(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Cart changed; refresh before quoting.",
    );
    expect((await carts(page))[0].lines[0].quantity).toBe(1);
    await page.getByLabel(quantityLabel, { exact: true }).fill("3");
    await proceed(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Cart changed; refresh before saving.",
    );
    expect((await carts(page))[0].revision).toBe(2);
    expect((await carts(page))[0].lines[0].quantity).toBe(1);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await prepare(page);
    await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(
      "1",
    );
    await proceed(page);
    await order(page, 11300, 1);
  } finally {
    await adminContext.close();
  }
});

test("browser: cart recovery permits correcting a definitive quantity refusal", async ({
  page,
}) => {
  await login(page, "invalid");
  await prepare(page);
  const quantity = page.getByLabel(quantityLabel, { exact: true });
  await quantity.fill("100001");
  expect(
    await quantity.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(false);
  // The paged editor now blocks this at the browser boundary. Deliberately
  // bypass only that constraint to exercise the real native refusal/recovery.
  expect(await carts(page)).toEqual([]);
  await quantity.evaluate((input: HTMLInputElement) =>
    input.removeAttribute("max"),
  );
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "quantity must be an integer between 1 and 100000.",
  );
  expect(await carts(page)).toEqual([]);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await order(page, 11300, 1);
  expect((await carts(page))[0].revision).toBe(1);
});

test("browser: cart recovery retains the original save after network loss and a timeout response", async ({
  page,
}) => {
  await login(page, "timeout");
  const saves: { key: string | undefined; data: unknown }[] = [];
  await page.route(saveRoute, async (route) => {
    saves.push({
      key: route.request().headers()["idempotency-key"],
      data: route.request().postDataJSON(),
    });
    if (saves.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else if (saves.length === 2) {
      await route.fulfill({ ...unavailable, status: 408 });
    } else await route.continue();
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect((await carts(page))[0].revision).toBe(1);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  await proceed(page);
  await order(page, 22600, 2);
  expect(saves).toHaveLength(4);
  expect(saves[0]!.key).toBeTruthy();
  expect(saves[1]).toEqual(saves[0]);
  expect(saves[2]).toEqual(saves[0]);
  expect(saves[3]!.key).not.toBe(saves[0]!.key);
  expect(saves[3]!.data).toEqual({
    ...(saves[0]!.data as object),
    revision: 1,
    lines: [
      { productId: (saves[0]!.data as any).lines[0].productId, quantity: 2 },
    ],
  });
  expect((await carts(page))[0].revision).toBe(2);
});

test("browser: unavailable cart items require explicit removal before saving or quoting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "unavailable");
  const original = (await carts(page))[0];
  expect(original.lines).toHaveLength(2);
  let quotes = 0;
  await page.route(quoteRoute, async (route) => {
    quotes++;
    await route.continue();
  });
  const saves: { key: string | undefined; data: unknown }[] = [];
  await page.route(saveRoute, async (route) => {
    saves.push({
      key: route.request().headers()["idempotency-key"],
      data: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (saves.length === 1) await route.fulfill(unavailable);
    else await route.fulfill({ response });
  });
  await prepare(page);
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Review removal of unavailable saved items before continuing.",
  );
  expect(saves).toHaveLength(0);
  expect(quotes).toBe(0);
  expect((await carts(page))[0]).toEqual(original);
  await expect(page.getByRole("dialog")).toContainText(
    "2 saved units across 1 unavailable item",
  );
  const remove = page.getByRole("checkbox", {
    name: "Remove unavailable items from this saved cart",
    exact: true,
  });
  await expect(remove).not.toBeChecked();
  await remove.check();
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Total: CA$113.00");
  expect(saves).toHaveLength(2);
  expect(quotes).toBe(1);
  expect(saves[0]!.key).toBeTruthy();
  expect(saves[1]).toEqual(saves[0]);
  const saved = (await carts(page))[0];
  expect(saved.revision).toBe(2);
  expect(saved.lines).toEqual([original.lines[0]]);
  expect(
    (await (await page.request.get(`${origin}/api/dashboard`)).json()).orders,
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.reload();
  await prepare(page);
  await expect(
    page.getByRole("checkbox", {
      name: "Remove unavailable items from this saved cart",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("browser: staff cancel preserves unavailable cart quantities and reopening resets removal choice", async ({
  page,
}) => {
  await login(page, "admin");
  // Select the exact independent staff fixture customer, not an arbitrary cart.
  const accounts = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).accounts;
  const customer = accounts.find(
    (a: any) => a.name === "Cart recovery unavailable-staff",
  );
  const before = (await carts(page)).find(
    (c: any) => c.account_id === customer.id,
  );
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page.getByLabel("Customer", { exact: true }).selectOption(customer.id);
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await proceed(page);
  const remove = page.getByRole("checkbox", {
    name: "Remove unavailable items from this saved cart",
    exact: true,
  });
  await remove.check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (await carts(page)).find((c: any) => c.account_id === customer.id),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page.getByLabel("Customer", { exact: true }).selectOption(customer.id);
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await proceed(page);
  await expect(remove).not.toBeChecked();
  await remove.check();
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  const saved = (await carts(page)).find(
    (c: any) => c.account_id === customer.id,
  );
  expect(saved.revision).toBe(2);
  expect(saved.lines).toEqual([before.lines[0]]);
});

test("browser: explicitly removing the only unavailable item clears the cart without ordering", async ({
  page,
}) => {
  await login(page, "unavailable-empty");
  const before = (await carts(page))[0];
  await prepare(page);
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Review removal of unavailable saved items before continuing.",
  );
  expect((await carts(page))[0]).toEqual(before);
  await page
    .getByRole("checkbox", {
      name: "Remove unavailable items from this saved cart",
      exact: true,
    })
    .check();
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Cart is empty.",
  );
  expect((await carts(page))[0].lines).toEqual([]);
  expect((await carts(page))[0].revision).toBe(2);
  expect(
    (await (await page.request.get(`${origin}/api/dashboard`)).json()).orders,
  ).toEqual([]);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  expect((await carts(page))[0].revision).toBe(3);
});

test("browser: individual unavailable item reviews and active removals preserve cancellation and exact save recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "unavailable-review");
  const original = (await carts(page))[0];
  expect(original.lines).toHaveLength(4);
  const saves: { key: string | undefined; data: any }[] = [];
  let quotes = 0;
  await page.route(saveRoute, async (route) => {
    saves.push({
      key: route.request().headers()["idempotency-key"],
      data: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (saves.length === 1) await route.fulfill(unavailable);
    else await route.fulfill({ response });
  });
  await page.route(quoteRoute, async (route) => {
    quotes++;
    await route.continue();
  });
  await prepare(page);
  const section = page.getByRole("region", {
    name: "Unavailable saved items",
    exact: true,
  });
  await expect(section).toContainText(
    "5 saved units across 2 unavailable items",
  );
  const first = section.getByRole("checkbox", {
    name: "Remove RETIRED-unavailable-review · Retired synthetic unavailable-review (2 saved units)",
    exact: true,
  });
  const second = section.getByRole("checkbox", {
    name: "Remove RETIRED-SECOND · Second retired synthetic product (3 saved units)",
    exact: true,
  });
  const all = section.getByRole("checkbox", {
    name: "Remove unavailable items from this saved cart",
    exact: true,
  });
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await first.check();
  await expect(section).toContainText(
    "1 of 2 unavailable items selected for removal.",
  );
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Review removal of unavailable saved items before continuing.",
  );
  expect(saves).toEqual([]);
  expect(quotes).toBe(0);
  expect((await carts(page))[0]).toEqual(original);
  await page
    .getByRole("button", {
      name: "Remove REVIEW-ACTIVE · Available synthetic review product from cart",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("REVIEW-ACTIVE · Available synthetic review product", {
      exact: true,
    }),
  ).toHaveValue("0");
  await expect(
    page.getByLabel("Search catalog", { exact: true }),
  ).toBeFocused();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await carts(page))[0]).toEqual(original);
  await prepare(page);
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(
    page.getByLabel("REVIEW-ACTIVE · Available synthetic review product", {
      exact: true,
    }),
  ).toHaveValue("2");
  await all.check();
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
  await second.uncheck();
  await expect(all).not.toBeChecked();
  await proceed(page);
  expect(saves).toEqual([]);
  expect(quotes).toBe(0);
  await second.check();
  await expect(all).toBeChecked();
  await page
    .getByRole("button", {
      name: "Remove REVIEW-ACTIVE · Available synthetic review product from cart",
      exact: true,
    })
    .click();
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic quote unavailable",
  );
  const firstSave = (await carts(page))[0];
  expect(firstSave.revision).toBe(2);
  expect(firstSave.lines).toEqual([original.lines[0]]);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(
    page.getByRole("heading", { name: "Review and accept order", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Total: CA$226.00");
  expect(saves).toHaveLength(3);
  expect(saves[0]!.key).toBeTruthy();
  expect(saves[1]).toEqual(saves[0]);
  expect(saves[2]!.key).not.toBe(saves[0]!.key);
  expect(saves[2]!.data.revision).toBe(2);
  expect(saves[2]!.data.lines).toEqual([
    { productId: original.lines[0].productId, quantity: 2 },
  ]);
  expect(quotes).toBe(1);
  expect((await carts(page))[0].revision).toBe(3);
  expect(
    (await (await page.request.get(`${origin}/api/dashboard`)).json()).orders,
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await prepare(page);
  await expect(section).toHaveCount(0);
  await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(
    "2",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

async function ordersPage(page: Page, staff = false) {
  if (staff) await navigateWorkspace(page, "Orders", "Orders");
  else await navigateBuyerWorkspace(page, "Orders", "Orders");
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
}
async function recover(page: Page) {
  await page
    .getByRole("button", { name: "Review retained cart save", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Recover reviewed cart save",
      exact: true,
    }),
  ).toBeVisible();
}

test("browser: durable cart save survives reload and sign-in without overwriting a newer native cart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "durable");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const scope = `distributor-cart-save:${session.actor.orgId}:${session.actor.id}`;
  const attempts: { key: string; payload: any }[] = [];
  let original: any;
  let quotes = 0,
    accepts = 0;
  await page.route(quoteRoute, async (route) => {
    quotes++;
    await route.continue();
  });
  await page.route("**/api/commands/order.accept", async (route) => {
    accepts++;
    await route.continue();
  });
  await page.route(saveRoute, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) {
      original = await response.json();
      await route.abort("failed");
    } else {
      expect(await response.json()).toEqual(original);
      await route.fulfill({ response });
    }
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect((await carts(page))[0].revision).toBe(1);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), scope),
  ).toMatchObject({ key: attempts[0]!.key, payload: attempts[0]!.payload });
  await page.reload();
  await ordersPage(page);
  await recover(page);
  await expect(page.getByRole("dialog")).toContainText(
    "1 × EQ-1 · Synthetic equipment",
  );
  await expect(
    page.getByRole("dialog").locator("input,select,textarea"),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expectSignedOut(page);
  const csrf = await login(page, "admin");
  await ordersPage(page, true);
  await expect(
    page.getByRole("button", {
      name: "Review retained cart save",
      exact: true,
    }),
  ).toHaveCount(0);
  // Another authorized writer changes the cart after its original receipt.
  const next = await page.request.post(`${origin}/api/commands/cart.save`, {
    headers: {
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": "durable-newer-cart",
    },
    data: {
      ...attempts[0]!.payload,
      revision: 1,
      lines: [
        { productId: attempts[0]!.payload.lines[0].productId, quantity: 3 },
      ],
    },
  });
  expect(next.status()).toBe(200);
  expect(await next.json()).toEqual({ id: original.id, revision: 2 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await login(page, "durable");
  await ordersPage(page);
  await recover(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recover exact cart save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  const current = (await carts(page))[0];
  expect(current.id).toBe(original.id);
  expect(current.revision).toBe(2);
  expect(current.lines).toEqual([
    { productId: attempts[0]!.payload.lines[0].productId, quantity: 3 },
  ]);
  expect(quotes).toBe(0);
  expect(accepts).toBe(0);
  const dashboard = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(dashboard.orders).toEqual([]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), scope),
  ).toBeNull();
  await prepare(page);
  await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(
    "3",
  );
  expect(errors).toEqual([]);
});

test("browser: malformed and unwritable cart recovery storage refuse transport", async ({
  page,
}) => {
  await login(page, "storage");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const scope = `distributor-cart-save:${session.actor.orgId}:${session.actor.id}`;
  let saves = 0;
  await page.route(saveRoute, async (route) => {
    saves++;
    await route.continue();
  });
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), scope);
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "recovery evidence cannot be read",
  );
  expect(saves).toBe(0);
  expect(await carts(page)).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key)
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.call(this, k, value);
    };
  }, scope);
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Cart save was not sent",
  );
  expect(saves).toBe(0);
  expect(await carts(page)).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("3");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "requires browser coordination",
  );
  expect(saves).toBe(0);
  expect(await carts(page)).toEqual([]);
});

test("browser: competing cart tabs cannot replace or transport a retained save while its lock is held", async ({
  page,
  context,
}) => {
  await login(page, "tabs");
  const other = await context.newPage();
  await other.goto(origin);
  await expectBuyerLanding(other);
  await navigateBuyerWorkspace(other, "Overview");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attempts: { key: string; payload: unknown }[] = [];
  await page.route(saveRoute, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    await held;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  let otherWrites = 0;
  await other.route(saveRoute, async (route) => {
    otherWrites++;
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    await route.continue();
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect.poll(() => attempts.length).toBe(1);
  try {
    await prepare(other);
    await other.getByLabel(quantityLabel, { exact: true }).fill("3");
    await proceed(other);
    await expect(other.getByRole("dialog").getByRole("alert")).toContainText(
      "Another tab is saving",
    );
    expect(otherWrites).toBe(0);
    expect(await carts(other)).toEqual([]);
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await ordersPage(other);
    await recover(other);
    await expect(other.getByRole("dialog")).toContainText("1 × EQ-1");
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Recover exact cart save", exact: true })
      .click();
    await expect(other.getByRole("dialog").getByRole("alert")).toContainText(
      "Another tab is saving",
    );
    expect(otherWrites).toBe(0);
  } finally {
    release();
  }
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "Recover exact cart save", exact: true })
    .click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  expect(otherWrites).toBe(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((await carts(other))[0].revision).toBe(1);
  expect((await carts(other))[0].lines[0].quantity).toBe(1);
  const dashboard = await (
    await other.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(dashboard.orders).toEqual([]);
});

test("browser: malformed committed cart save replies retain the exact attempt for readonly recovery", async ({
  page,
}) => {
  await login(page, "malformed");
  const attempts: { key: string; payload: unknown }[] = [];
  await page.route(saveRoute, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1)
      await route.fulfill({
        json: { ...(await response.json()), revision: 999 },
      });
    else await route.fulfill({ response });
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "reply could not be verified",
  );
  expect((await carts(page))[0].revision).toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await ordersPage(page);
  await recover(page);
  await expect(page.getByRole("dialog")).toContainText("2 × EQ-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recover exact cart save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((await carts(page))[0].revision).toBe(1);
  expect((await carts(page))[0].lines[0].quantity).toBe(2);
});

test("browser: cart recovery keeps an open review fixed and refuses a changed retained key before transport", async ({
  page,
  context,
}) => {
  await login(page, "changed-review");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const scope = `distributor-cart-save:${session.actor.orgId}:${session.actor.id}`;
  let saves = 0;
  await page.route(saveRoute, async (route) => {
    saves++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("1");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await ordersPage(page);
  await recover(page);
  await expect(page.getByRole("dialog")).toContainText("1 × EQ-1");
  const other = await context.newPage();
  await other.goto(origin);
  // Simulate recovery evidence being replaced while the original review is open.
  // This fixture mutation grants no authority and must not trigger transport.
  await other.evaluate((key) => {
    const replacement = JSON.parse(localStorage.getItem(key)!);
    replacement.key = crypto.randomUUID();
    replacement.payload.lines[0].quantity = 5;
    localStorage.setItem(key, JSON.stringify(replacement));
  }, scope);
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key)!).payload.lines[0].quantity,
        scope,
      ),
    )
    .toBe(5);
  await expect(page.getByRole("dialog")).toContainText("1 × EQ-1");
  await expect(page.getByRole("dialog")).not.toContainText("5 × EQ-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recover exact cart save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Retained cart save changed",
  );
  expect(saves).toBe(1);
  expect((await carts(page))[0].revision).toBe(1);
  expect((await carts(page))[0].lines[0].quantity).toBe(1);
  await recover(page);
  await expect(page.getByRole("dialog")).toContainText("5 × EQ-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(saves).toBe(1);
});

test("browser: cart recovery storage cleanup failure preserves the original committed save for exact retry", async ({
  page,
}) => {
  await login(page, "cleanup");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const scope = `distributor-cart-save:${session.actor.orgId}:${session.actor.id}`;
  const attempts: { key: string; payload: unknown }[] = [];
  let quotes = 0;
  await page.route(saveRoute, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    await route.continue();
  });
  await page.route(quoteRoute, async (route) => {
    quotes++;
    await route.continue();
  });
  await page.evaluate((key) => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      if (k === key)
        throw new DOMException("Synthetic cleanup refusal", "SecurityError");
      return original.call(this, k);
    };
  }, scope);
  await prepare(page);
  await page.getByLabel(quantityLabel, { exact: true }).fill("2");
  await proceed(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Synthetic cleanup refusal",
  );
  expect((await carts(page))[0].revision).toBe(1);
  expect(quotes).toBe(0);
  await page.reload();
  await ordersPage(page);
  await recover(page);
  await expect(page.getByRole("dialog")).toContainText("2 × EQ-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recover exact cart save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((await carts(page))[0].revision).toBe(1);
  expect((await carts(page))[0].lines[0].quantity).toBe(2);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), scope),
  ).toBeNull();
  expect(quotes).toBe(0);
});
