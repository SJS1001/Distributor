import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3161";
const pattern = "**/api/commands/transfer.receive";
const d = (page: Page) =>
  page.getByRole("dialog", { name: "Receive transfer", exact: true });
const recovery = (page: Page) =>
  page.getByRole("region", { name: "Transfer arrival recovery", exact: true });
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
async function login(page: Page, email = "arrival@example.test") {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const session = await (await response).json();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  return session;
}
async function snapshot(page: Page) {
  const response = await page.request.get(`${origin}/api/transfers`);
  expect(response.status()).toBe(200);
  return (await response.json()) as any[];
}
const row = (page: Page, sku: string) =>
  page
    .getByRole("region", { name: "Transfer queue", exact: true })
    .getByRole("row")
    .filter({ hasText: sku });
async function enter(
  page: Page,
  sku: string,
  ref: string,
  quantity = 2,
  serial = "",
) {
  await row(page, sku)
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await d(page)
    .getByLabel("Units arriving", { exact: true })
    .fill(String(quantity));
  await d(page)
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill(serial);
  await d(page)
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill(ref);
  await d(page)
    .getByLabel("Destination bin", { exact: true })
    .fill("Q-RECOVERY");
  await d(page)
    .getByLabel("Condition", { exact: true })
    .selectOption("quarantine");
  await d(page)
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic original arrival inspection");
}
const send = (page: Page) =>
  d(page).getByRole("button", { name: "Continue", exact: true }).click();
const retry = (page: Page) =>
  d(page)
    .getByRole("button", { name: "Retry exact transfer arrival", exact: true })
    .click();
async function evidence(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-transfer-arrival:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
async function review(page: Page) {
  await recovery(page)
    .getByRole("button", {
      name: "Review retained transfer arrival",
      exact: true,
    })
    .click();
  await expect(d(page).getByRole("spinbutton")).toHaveCount(0);
  await expect(d(page).getByRole("textbox")).toHaveCount(0);
}

test("browser: transfer arrival survives reload, navigation and account changes and recovers the original portion after another receiver", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const attempts: { key: string; body: unknown }[] = [];
  let receipt: any;
  await page.route(pattern, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) {
      receipt = await response.json();
      await route.abort("failed");
    } else {
      expect(await response.json()).toEqual(receipt);
      await route.fulfill({ response });
    }
  });
  await enter(page, "ARRIVAL-1", "ARRIVAL-RECOVER-1");
  await send(page);
  await expect(d(page).getByRole("alert")).toBeVisible();
  const original = (await evidence(page))!;
  const a = JSON.parse(original.raw);
  expect(a.payload.quantity).toBe(2);
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await nav(page, "Overview");
  await page.reload();
  await nav(page, "Inventory");
  await review(page);
  await expect(d(page)).toContainText("ARRIVAL-RECOVER-1");
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "arrival-other@example.test");
  await expect(recovery(page).getByRole("status")).toHaveCount(0);
  await expect(d(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page);
  const otherContext = await context.browser()!.newContext();
  try {
    const other = await otherContext.newPage();
    const session = await login(other, "arrival-other@example.test");
    const response = await other.request.post(
      `${origin}/api/commands/transfer.receive`,
      {
        headers: {
          origin,
          "x-csrf-token": session.csrf,
          "idempotency-key": "synthetic-other-arrival",
        },
        data: {
          ...a.payload,
          quantity: 1,
          receiptRef: "ARRIVAL-OTHER-1",
          bin: "D-OTHER",
          condition: "damaged",
        },
      },
    );
    expect(response.status()).toBe(200);
  } finally {
    await otherContext.close();
  }
  const beforeRetry = await snapshot(page);
  await review(page);
  await expect(d(page)).toContainText("Q-RECOVERY");
  await retry(page);
  await expect(d(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await snapshot(page)).toEqual(beforeRetry);
  expect(await evidence(page)).toBeNull();
  const line = beforeRetry.find((t) => t.id === a.payload.transferId).lines[0];
  expect(line).toMatchObject({
    quantity: 6,
    unit_cost: 1234,
    receivedQuantity: 3,
    remainingQuantity: 3,
  });
  expect(line.receipts).toHaveLength(2);
  const stocks = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).stock;
  const arrived = stocks.filter((u: any) => u.product_id === line.product_id);
  expect(arrived.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(3);
  expect(
    arrived.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(3702);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: transfer arrival refuses wrong serial and cancels without stock effects", async ({
  page,
}) => {
  await login(page);
  const before = await snapshot(page);
  await enter(page, "S1", "ARRIVAL-SERIAL-1", 1, "S2");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("SERIAL");
  expect(await snapshot(page)).toEqual(before);
  expect(await evidence(page)).toBeNull();
  await d(page)
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill("S1");
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    row(page, "S1").getByRole("button", {
      name: "Receive transfer",
      exact: true,
    }),
  ).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  await enter(page, "S1", "ARRIVAL-SERIAL-1", 1, "S1");
  await send(page);
  await expect(d(page)).toHaveCount(0);
  const t = (await snapshot(page)).find((t) =>
    t.lines.some((l: any) => l.serial === "S1"),
  );
  expect(t.lines[0]).toMatchObject({
    quantity: 1,
    receivedQuantity: 1,
    remainingQuantity: 0,
  });
  expect(t.lines[0].receipts).toHaveLength(1);
});

test("browser: transfer arrival storage corruption, write failure and missing locks block transport", async ({
  page,
}) => {
  const session = await login(page);
  const storageKey = `distributor-transfer-arrival:${session.actor.orgId}:${session.actor.id}`;
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/transfer.receive")) sent++;
  });
  const before = await snapshot(page);
  await page.evaluate(
    (key) => localStorage.setItem(key, "{corrupt"),
    storageKey,
  );
  await page.reload();
  await nav(page, "Inventory");
  await expect(recovery(page).getByRole("alert")).toContainText(
    "cannot be read",
  );
  await enter(page, "ARRIVAL-2", "ARRIVAL-STORAGE-2");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("cannot be read");
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload();
  await nav(page, "Inventory");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreArrivalStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-transfer-arrival:"))
        throw Error("Synthetic arrival write failure");
      return original.call(this, key, value);
    };
  });
  await enter(page, "ARRIVAL-2", "ARRIVAL-STORAGE-2");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "Synthetic arrival write failure",
  );
  await page.evaluate(() => (window as any).restoreArrivalStorage());
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    }),
  );
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("Web Locks");
  expect(sent).toBe(0);
  expect(await snapshot(page)).toEqual(before);
  expect(await evidence(page)).toBeNull();
});

test("browser: transfer arrival retains malformed success and failed cleanup until exact recovery", async ({
  page,
}) => {
  await login(page);
  const attempts: { key: string; body: unknown }[] = [];
  await page.route(pattern, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1)
      await route.fulfill({ status: 200, json: { quantity: 999 } });
    else await route.fulfill({ response });
  });
  await enter(page, "ARRIVAL-3", "ARRIVAL-MALFORMED-3");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "could not be confirmed",
  );
  const original = await evidence(page);
  const beforeRetry = await snapshot(page);
  await expect(d(page).getByRole("textbox")).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("distributor-transfer-arrival:"))
        throw Error("Synthetic arrival cleanup failure");
      return original.call(this, key);
    };
  });
  await retry(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "Synthetic arrival cleanup failure",
  );
  expect(await evidence(page)).toEqual(original);
  await page.reload();
  await nav(page, "Inventory");
  await review(page);
  await retry(page);
  await expect(d(page)).toHaveCount(0);
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every((a) => JSON.stringify(a) === JSON.stringify(attempts[0])),
  ).toBe(true);
  expect(await snapshot(page)).toEqual(beforeRetry);
  expect(await evidence(page)).toBeNull();
});

test("browser: transfer arrival tabs serialize submissions and preserve the reviewed original when evidence changes", async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  await other.goto(origin);
  await nav(other, "Inventory");
  await enter(page, "ARRIVAL-4", "ARRIVAL-TABS-4");
  await enter(other, "ARRIVAL-5", "ARRIVAL-TABS-5");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const arrived = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let sent = 0;
  other.on("request", (r) => {
    if (r.url().endsWith("/api/commands/transfer.receive")) sent++;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await hold;
    await route.abort("failed");
  });
  try {
    await send(page);
    await arrived;
    await send(other);
    await expect(d(other).getByRole("alert")).toContainText(
      "Another tab is submitting",
    );
    expect(sent).toBe(0);
  } finally {
    release();
  }
  await expect(d(page).getByRole("alert")).toBeVisible();
  const original = (await evidence(page))!;
  await d(other).getByRole("button", { name: "Cancel", exact: true }).click();
  await review(other);
  await expect(d(other)).toContainText("ARRIVAL-TABS-4");
  await page.evaluate(({ key, raw }) => {
    const a = JSON.parse(raw);
    a.payload.bin = "CHANGED-IN-OTHER-TAB";
    localStorage.setItem(key, JSON.stringify(a));
  }, original);
  await expect(d(other)).toContainText("Q-RECOVERY");
  await expect(d(other)).not.toContainText("CHANGED-IN-OTHER-TAB");
  const beforeRetry = await snapshot(other);
  await retry(other);
  await expect(d(other).getByRole("alert")).toContainText("evidence changed");
  expect(sent).toBe(0);
  expect(await snapshot(other)).toEqual(beforeRetry);
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    original,
  );
  await retry(other);
  await expect(d(other)).toHaveCount(0);
  expect(sent).toBe(1);
  expect(await snapshot(other)).toEqual(beforeRetry);
  expect(await evidence(other)).toBeNull();
  await other.close();
});

test("browser: an abandoned transfer arrival finishes natively without repopulating another screen", async ({
  page,
}) => {
  await login(page);
  await enter(page, "ARRIVAL-6", "ARRIVAL-ABANDONED-6");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const arrived = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await hold;
    await route.fulfill({ response });
  });
  await send(page);
  await arrived;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  release();
  await nav(page, "Inventory");
  await expect(d(page)).toHaveCount(0);
  await review(page);
  await retry(page);
  await expect(d(page)).toHaveCount(0);
  const transfers = await snapshot(page);
  const found = transfers
    .flatMap((t) => t.lines)
    .find((l) =>
      l.receipts.some((r: any) => r.receipt_ref === "ARRIVAL-ABANDONED-6"),
    );
  expect(found.receipts).toHaveLength(1);
  expect(found.receivedQuantity).toBe(2);
});

test("browser: retained transfer arrival rechecks current destination grants before a cached receipt", async ({
  page,
  context,
}) => {
  const session = await login(page);
  const original: { key: string; body: any }[] = [];
  await page.route(pattern, async (route) => {
    original.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    if (original.length === 1) {
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await enter(page, "ARRIVAL-7", "ARRIVAL-AUTHORITY-7");
  await send(page);
  await expect(d(page).getByRole("alert")).toBeVisible();
  const retained = await evidence(page);
  const before = await snapshot(page);
  const adminContext = await context.browser()!.newContext();
  try {
    const admin = await adminContext.newPage();
    const owner = await login(admin, "admin@example.test");
    const users = await (await admin.request.get(`${origin}/api/users`)).json();
    const user = users.find((u: any) => u.id === session.actor.id);
    const update = async (revision: number, sites: string[], key: string) => {
      const response = await admin.request.post(
        `${origin}/api/commands/user.update`,
        {
          headers: {
            origin,
            "x-csrf-token": owner.csrf,
            "idempotency-key": key,
          },
          data: {
            userId: user.id,
            revision,
            email: user.email,
            name: user.name,
            role: "warehouse",
            sites,
            active: true,
            currentPassword: "long-test-only-password",
            reason: "Synthetic current arrival authority review",
          },
        },
      );
      expect(response.status()).toBe(200);
      return await response.json();
    };
    await update(user.revision, [], "synthetic-remove-arrival-grant");
    await login(page);
    await review(page);
    await retry(page);
    await expect(d(page).getByRole("alert")).toContainText("FORBIDDEN");
    expect(await evidence(page)).toEqual(retained);
    expect(original).toHaveLength(2);
    expect(original[1]).toEqual(original[0]);
    expect(await snapshot(admin)).toEqual(before);
    const currentUsers = await (
      await admin.request.get(`${origin}/api/users`)
    ).json();
    await update(
      currentUsers.find((u: any) => u.id === user.id).revision,
      user.sites,
      "synthetic-restore-arrival-grant",
    );
    await login(page);
    await review(page);
    await retry(page);
    await expect(d(page)).toHaveCount(0);
    expect(original).toHaveLength(3);
    expect(original[2]).toEqual(original[0]);
    expect(await snapshot(page)).toEqual(before);
    expect(await evidence(page)).toBeNull();
  } finally {
    await adminContext.close();
  }
});

test("browser: transfer arrival recognizes an original reference receipt despite a newer remaining quantity", async ({
  page,
}) => {
  const session = await login(page);
  const transfers = await snapshot(page);
  const products = await (
    await page.request.get(`${origin}/api/catalog/products/page?q=ARRIVAL-8`)
  ).json();
  const product = products.items.find((p: any) => p.sku === "ARRIVAL-8");
  const transfer = transfers.find((t: any) =>
    t.lines.some((line: any) => line.product_id === product.id),
  );
  const line = transfer.lines[0];
  const payload = {
    transferId: transfer.id,
    lineId: line.line_id,
    quantity: 2,
    serial: null,
    receiptRef: "ARRIVAL-ALREADY-8",
    bin: "Q-RECOVERY",
    condition: "quarantine",
    reason: "Synthetic original arrival inspection",
  };
  const response = await page.request.post(
    `${origin}/api/commands/transfer.receive`,
    {
      headers: {
        origin,
        "x-csrf-token": session.csrf,
        "idempotency-key": "synthetic-already-arrived",
      },
      data: payload,
    },
  );
  expect(response.status()).toBe(200);
  const original = await response.json();
  expect(original.remainingQuantity).toBe(4);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Refresh", exact: true })
    .first()
    .click();
  await enter(page, "ARRIVAL-8", payload.receiptRef);
  await send(page);
  await expect(d(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  expect(await evidence(page)).toBeNull();
});
