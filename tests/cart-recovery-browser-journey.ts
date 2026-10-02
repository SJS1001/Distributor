import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3139";
const quantityLabel = "EQ-1 · Synthetic equipment";
const saveRoute = "**/api/commands/cart.save";
const quoteRoute = "**/api/commands/cart.quote";
async function login(page: Page, name: string) {
  await page.goto(origin);
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
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
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
  await proceed(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dashboard = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(dashboard.orders).toHaveLength(1);
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
  await order(page, 22600, 2);
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
    page.getByRole("heading", { name: "Overview", exact: true }),
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
  await page.getByLabel(quantityLabel, { exact: true }).fill("100001");
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
