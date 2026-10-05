import { test, expect, type Page } from "@playwright/test";
import { reviewDuringInventoryLoad } from "./transfer-review-loading.ts";
import { navigateWorkspace } from "./workspace-navigation.ts";

const origin = "http://127.0.0.1:3162";
const pattern = "**/api/commands/transfer.dispatch";
const d = (page: Page) =>
  page.getByRole("dialog", { name: "Dispatch transfer", exact: true });
const recovery = (page: Page) =>
  page.getByRole("region", { name: "Transfer dispatch recovery", exact: true });
const nav = (page: Page, name: string) =>
  navigateWorkspace(page, name, name === "Inventory" ? "Stock" : undefined);
async function login(page: Page, email = "dispatch@example.test") {
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
async function facts(page: Page) {
  const dashboard = await page.request.get(`${origin}/api/dashboard`);
  const transfers = await page.request.get(`${origin}/api/transfers`);
  expect(dashboard.status()).toBe(200);
  expect(transfers.status()).toBe(200);
  return {
    stock: (await dashboard.json()).stock as any[],
    transfers: (await transfers.json()) as any[],
  };
}
async function enter(page: Page, sku: string, quantity = 2) {
  const row = page
    .getByRole("row")
    .filter({ hasText: sku })
    .filter({ hasText: "· stock" });
  const actions = row.locator("details.stock-actions");
  if ((await actions.getAttribute("open")) === null)
    await actions.locator("summary").click();
  await row.getByRole("button", { name: "Transfer", exact: true }).click();
  await d(page)
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await d(page).getByLabel("Units", { exact: true }).fill(String(quantity));
  await d(page)
    .getByLabel("Reason / evidence", { exact: true })
    .fill(`Synthetic original dispatch ${sku}`);
}
const send = (page: Page) =>
  d(page).getByRole("button", { name: "Continue", exact: true }).click();
const retry = (page: Page) =>
  d(page)
    .getByRole("button", { name: "Retry exact transfer dispatch", exact: true })
    .click();
async function evidence(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-transfer-dispatch:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
async function review(page: Page) {
  await recovery(page)
    .getByRole("button", {
      name: "Review retained transfer dispatch",
      exact: true,
    })
    .click();
  await expect(d(page).getByRole("spinbutton")).toHaveCount(0);
  await expect(d(page).getByRole("combobox")).toHaveCount(0);
  await expect(d(page).getByRole("textbox")).toHaveCount(0);
}
async function native(
  page: Page,
  session: any,
  name: string,
  key: string,
  data: unknown,
) {
  const response = await page.request.post(`${origin}/api/commands/${name}`, {
    headers: { origin, "x-csrf-token": session.csrf, "idempotency-key": key },
    data,
  });
  expect(response.status()).toBe(200);
  return await response.json();
}

test("browser: transfer dispatch retains the original portion across reload and accounts after source stock changes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const before = await facts(page);
  const attempts: { key: string; body: any }[] = [];
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
  await enter(page, "DISPATCH-1");
  await send(page);
  await expect(d(page).getByRole("alert")).toBeVisible();
  const original = (await evidence(page))!;
  const a = JSON.parse(original.raw);
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await nav(page, "Overview");
  await reviewDuringInventoryLoad(page, d(page), () => review(page), "Stock");
  await expect(d(page)).toContainText("Synthetic original dispatch DISPATCH-1");
  await expect(d(page)).toContainText("Ottawa");
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "dispatch-other@example.test");
  await expect(recovery(page).getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page);
  const otherContext = await context.browser()!.newContext();
  try {
    const other = await otherContext.newPage();
    const session = await login(other, "dispatch-other@example.test");
    const source = (await facts(other)).stock.find(
      (u) => u.id === a.payload.unitId,
    );
    await native(
      other,
      session,
      "transfer.dispatch",
      "synthetic-other-dispatch-1",
      {
        ...a.payload,
        quantity: 1,
        revision: source.revision,
        reason: "Synthetic later source dispatch",
      },
    );
  } finally {
    await otherContext.close();
  }
  const committed = await facts(page);
  await review(page);
  await retry(page);
  await expect(d(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await facts(page)).toEqual(committed);
  expect(await evidence(page)).toBeNull();
  const originalTransfer = committed.transfers.find((t) => t.id === receipt.id);
  expect(originalTransfer.lines).toHaveLength(1);
  expect(originalTransfer.lines[0]).toMatchObject({
    quantity: 2,
    unit_cost: 1234,
    remainingQuantity: 2,
  });
  const productId = before.stock.find(
    (u) => u.id === a.payload.unitId,
  )!.product_id;
  const units = committed.stock.filter((u) => u.product_id === productId);
  expect(units.reduce((sum, u) => sum + u.quantity, 0)).toBe(6);
  expect(units.reduce((sum, u) => sum + u.quantity * u.cost, 0)).toBe(7404);
  expect(units.find((u) => u.id === a.payload.unitId)).toMatchObject({
    quantity: 3,
    revision: a.payload.revision + 2,
  });
  expect(errors).toEqual([]);
});

test("browser: transfer dispatch cancellation conserves stock and serial recovery keeps the whole original unit", async ({
  page,
}) => {
  await login(page);
  const before = await facts(page);
  const source = before.stock.find((u) => u.serial === "S1")!;
  const opener = page
    .getByRole("row")
    .filter({ hasText: "S1 · stock" })
    .getByRole("button", { name: "Transfer", exact: true });
  await enter(page, "S1 · stock", 1);
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(opener).toBeFocused();
  expect(await facts(page)).toEqual(before);
  const attempts: { key: string; body: unknown }[] = [];
  await page.route(pattern, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await enter(page, "S1 · stock", 1);
  await send(page);
  await expect(d(page).getByRole("alert")).toBeVisible();
  await page.reload();
  await nav(page, "Inventory");
  await review(page);
  await expect(d(page)).toContainText("S1");
  await retry(page);
  await expect(d(page)).toHaveCount(0);
  expect(attempts[1]).toEqual(attempts[0]);
  const after = await facts(page);
  expect(after.stock.find((u) => u.id === source.id)).toEqual({
    ...source,
    state: "transit",
    available: 0,
    revision: source.revision + 1,
  });
  expect(
    after.transfers.filter((t) => t.lines.some((l: any) => l.serial === "S1")),
  ).toHaveLength(1);
});

test("browser: transfer dispatch refuses stale source review and requires refreshed stock before another submission", async ({
  page,
}) => {
  const session = await login(page);
  await enter(page, "DISPATCH-2");
  const before = await facts(page);
  // Locate the selected record through its original review after transport persistence.
  const products = await (
    await page.request.get(`${origin}/api/catalog/products/page?q=DISPATCH-2`)
  ).json();
  const stock = before.stock.find(
    (u) =>
      u.product_id ===
      products.items.find((p: any) => p.sku === "DISPATCH-2").id,
  )!;
  await native(
    page,
    session,
    "stock.inspect",
    "synthetic-stale-dispatch-inspection",
    {
      unitId: stock.id,
      revision: stock.revision,
      condition: "quarantine",
      reason: "Synthetic changed source inspection",
    },
  );
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/transfer.dispatch")) sent++;
  });
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("STATE");
  const changed = await facts(page);
  expect(changed.transfers).toEqual(before.transfers);
  expect(await evidence(page)).toBeNull();
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("refresh Inventory");
  expect(sent).toBe(1);
  await d(page).getByRole("button", { name: "Cancel", exact: true }).click();
  const latest = changed.stock.find((u) => u.id === stock.id)!;
  await native(
    page,
    session,
    "stock.inspect",
    "synthetic-restore-dispatch-inspection",
    {
      unitId: stock.id,
      revision: latest.revision,
      condition: "usable",
      reason: "Synthetic new inspection",
    },
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await enter(page, "DISPATCH-2");
  await send(page);
  await expect(d(page)).toHaveCount(0);
  expect(sent).toBe(2);
  expect((await facts(page)).transfers).toHaveLength(
    before.transfers.length + 1,
  );
});

test("browser: transfer dispatch blocks damaged storage, write failure and missing tab coordination before transport", async ({
  page,
}) => {
  const session = await login(page);
  const before = await facts(page);
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/transfer.dispatch")) sent++;
  });
  const key = `distributor-transfer-dispatch:${session.actor.orgId}:${session.actor.id}`;
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), key);
  await page.reload();
  await nav(page, "Inventory");
  await enter(page, "DISPATCH-3");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("cannot be read");
  expect(sent).toBe(0);
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.reload();
  await nav(page, "Inventory");
  await enter(page, "DISPATCH-3");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-transfer-dispatch:"))
        throw Error("Synthetic dispatch storage write failure");
      return original.call(this, key, value);
    };
  });
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "Synthetic dispatch storage write failure",
  );
  expect(sent).toBe(0);
  await page.reload();
  await nav(page, "Inventory");
  await enter(page, "DISPATCH-3");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("Web Locks");
  expect(sent).toBe(0);
  expect(await facts(page)).toEqual(before);
});

test("browser: transfer dispatch preserves an exact committed attempt after malformed reply and cleanup failure", async ({
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
      await route.fulfill({ status: 200, json: { id: "unconfirmed" } });
    else await route.fulfill({ response });
  });
  await enter(page, "DISPATCH-4");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "reply could not be confirmed",
  );
  const original = await evidence(page);
  const committed = await facts(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("distributor-transfer-dispatch:"))
        throw Error("Synthetic dispatch cleanup failure");
      return original.call(this, key);
    };
  });
  await retry(page);
  await expect(d(page).getByRole("alert")).toContainText(
    "Synthetic dispatch cleanup failure",
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
  expect(await facts(page)).toEqual(committed);
  expect(await evidence(page)).toBeNull();
});

test("browser: transfer dispatch tabs serialize writes and cannot silently replace an open original review", async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  await other.goto(origin);
  await nav(other, "Inventory");
  await enter(page, "DISPATCH-5");
  await enter(other, "DISPATCH-6");
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
    if (r.url().endsWith("/api/commands/transfer.dispatch")) sent++;
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
  await page.evaluate(({ key, raw }) => {
    const a = JSON.parse(raw);
    a.payload.reason = "CHANGED-IN-OTHER-TAB";
    localStorage.setItem(key, JSON.stringify(a));
  }, original);
  await expect(d(other)).toContainText(
    "Synthetic original dispatch DISPATCH-5",
  );
  await expect(d(other)).not.toContainText("CHANGED-IN-OTHER-TAB");
  const before = await facts(other);
  await retry(other);
  await expect(d(other).getByRole("alert")).toContainText("evidence changed");
  expect(sent).toBe(0);
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    original,
  );
  await retry(other);
  await expect(d(other)).toHaveCount(0);
  expect(sent).toBe(1);
  expect(await facts(other)).toEqual(before);
  await other.close();
});

test("browser: abandoned transfer dispatch does not repopulate another page and reload recovers the committed original", async ({
  page,
}) => {
  await login(page);
  await enter(page, "DISPATCH-7");
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
  try {
    await send(page);
    await arrived;
    const original = await evidence(page);
    const before = await facts(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    release();
    await nav(page, "Inventory");
    await expect(d(page)).toHaveCount(0);
    expect(await evidence(page)).toEqual(original);
    await review(page);
    await retry(page);
    await expect(d(page)).toHaveCount(0);
    expect(await facts(page)).toEqual(before);
  } finally {
    release();
  }
});

test("browser: retained transfer dispatch rechecks current source grants before a cached dispatch", async ({
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
  await enter(page, "DISPATCH-8");
  await send(page);
  await expect(d(page).getByRole("alert")).toBeVisible();
  const retained = await evidence(page);
  const before = await facts(page);
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
            reason: "Synthetic current dispatch authority review",
          },
        },
      );
      expect(response.status()).toBe(200);
      return await response.json();
    };
    await update(user.revision, [], "synthetic-remove-dispatch-grant");
    await login(page);
    await review(page);
    await retry(page);
    await expect(d(page).getByRole("alert")).toContainText("FORBIDDEN");
    expect(await evidence(page)).toEqual(retained);
    expect(original).toHaveLength(2);
    expect(original[1]).toEqual(original[0]);
    expect(await facts(admin)).toEqual(before);
    const currentUsers = await (
      await admin.request.get(`${origin}/api/users`)
    ).json();
    await update(
      currentUsers.find((u: any) => u.id === user.id).revision,
      user.sites,
      "synthetic-restore-dispatch-grant",
    );
    await login(page);
    await review(page);
    await retry(page);
    await expect(d(page)).toHaveCount(0);
    expect(original).toHaveLength(3);
    expect(original[2]).toEqual(original[0]);
    expect(await facts(page)).toEqual(before);
    expect(await evidence(page)).toBeNull();
  } finally {
    await adminContext.close();
  }
});

test("browser: transfer dispatch invalid review never poisons retained evidence and permits correction", async ({
  page,
}) => {
  await login(page);
  await enter(page, "DISPATCH-6");
  const before = await facts(page);
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/transfer.dispatch")) sent++;
  });
  await d(page).getByLabel("Reason / evidence", { exact: true }).fill("   ");
  await send(page);
  await expect(d(page).getByRole("alert")).toContainText("Nothing was sent");
  expect(sent).toBe(0);
  expect(await evidence(page)).toBeNull();
  expect(await facts(page)).toEqual(before);
  await d(page)
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic corrected dispatch reason");
  await send(page);
  await expect(d(page)).toHaveCount(0);
  expect(sent).toBe(1);
  expect((await facts(page)).transfers).toHaveLength(
    before.transfers.length + 1,
  );
});
