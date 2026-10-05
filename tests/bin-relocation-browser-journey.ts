import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3144";
async function signIn(page: Page, email: string) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await reply).json()).csrf as string;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Inventory", "Stock");
  return csrf;
}
const dialog = (page: Page) =>
  page.getByRole("dialog", {
    name: "Move stock within warehouse",
    exact: true,
  });
async function fill(
  page: Page,
  source: string,
  destination: string,
  serial?: string,
) {
  const d = dialog(page);
  await d.getByLabel("Confirm current bin", { exact: true }).fill(source);
  await d
    .getByLabel("Destination bin in this warehouse", { exact: true })
    .fill(destination);
  if (serial)
    await d.getByLabel("Scan stock serial", { exact: true }).fill(serial);
  await d
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic physically checked bin move");
}
async function stock(page: Page) {
  const response = await page.request.get(`${origin}/api/dashboard`);
  expect(response.status()).toBe(200);
  return (await response.json()).stock as Record<string, any>[];
}
test("browser: phone bin relocation refuses wrong serial then recovers an identical lost reply once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "warehouse@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S1")!;
  const row = page.getByRole("row").filter({ hasText: "S1 · stock" });
  const opener = row.getByRole("button", { name: "Move to bin", exact: true });
  await openStockActions(row);
  await opener.click();
  await fill(page, "A-1", "RACK-PHONE", "S2");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("SERIAL");
  expect((await stock(page)).find((u) => u.id === before.id)).toEqual(before);
  await dialog(page)
    .getByLabel("Scan stock serial", { exact: true })
    .fill("S1");
  const attempts: { key: string; payload: unknown }[] = [];
  let result: any;
  await page.route("**/api/commands/stock.relocate", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const native = await route.fetch();
    expect(native.status()).toBe(200);
    const body = await native.json();
    if (attempts.length === 1) {
      result = body;
      await route.abort("failed");
    } else {
      expect(body).toEqual(result);
      await route.fulfill({ response: native });
    }
  });
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Retry exact bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.key).toBeTruthy();
  const after = (await stock(page)).find((u) => u.id === before.id)!;
  expect(after).toEqual({
    ...before,
    bin: "RACK-PHONE",
    revision: before.revision + 1,
  });
  await expect(row.getByRole("cell").nth(1)).toHaveText(
    "TorontoBin RACK-PHONE",
  );
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("browser: bin review rejects changed stock, cancellation conserves facts and quarantine lots move intact", async ({
  page,
}) => {
  const csrf = await signIn(page, "admin@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S2")!;
  const row = page.getByRole("row").filter({ hasText: "S2 · stock" });
  await openStockActions(row);
  await row.getByRole("button", { name: "Move to bin", exact: true }).click();
  await fill(page, "A-1", "STALE-BIN", "S2");
  const response = await page.request.post(
    `${origin}/api/commands/stock.inspect`,
    {
      headers: {
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": "bin-stale-inspection",
      },
      data: {
        unitId: before.id,
        revision: before.revision,
        condition: "quarantine",
        reason: "Synthetic concurrent inspection",
      },
    },
  );
  expect(response.status()).toBe(200);
  const changed = (await stock(page)).find((u) => u.id === before.id);
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("REVISION");
  expect((await stock(page)).find((u) => u.id === before.id)).toEqual(changed);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const lot = (await stock(page)).find((u) => u.serial === null)!;
  const bulkRow = page.getByRole("row").filter({ hasText: "BIN-MOVE-BULK" });
  const move = bulkRow.getByRole("button", {
    name: "Move to bin",
    exact: true,
  });
  await openStockActions(bulkRow);
  await move.click();
  await expect(dialog(page)).toContainText("Move all 6 units");
  await expect(
    dialog(page).getByLabel("Scan stock serial", { exact: true }),
  ).toHaveCount(0);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(move).toBeFocused();
  expect((await stock(page)).find((u) => u.id === lot.id)).toEqual(lot);
  await openStockActions(bulkRow);
  await move.click();
  await fill(page, "RECEIVING", "QUARANTINE-PHONE");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await stock(page)).find((u) => u.id === lot.id)).toEqual({
    ...lot,
    bin: "QUARANTINE-PHONE",
    revision: lot.revision + 1,
  });
  await expect(bulkRow).toContainText("quarantine");
  await expect(bulkRow.locator(".stock-quantities > span")).toHaveText([
    "6Book",
    "0Reserved",
    "0Available",
  ]);
});

test("browser: phone partial bulk putaway leaves four units and recovers the same two-unit move after reload and sign-out following a lost response", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "warehouse@example.test");
  const lot = (await stock(page)).find((u) => u.serial === null)!;
  expect(lot.quantity).toBe(6);
  await openStockActions(
    page.getByRole("row").filter({ hasText: "BIN-MOVE-BULK" }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "BIN-MOVE-BULK" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  await expect(
    dialog(page).getByLabel("Units to move", { exact: true }),
  ).toHaveValue("6");
  await fill(page, lot.bin, "PARTIAL-PHONE");
  await dialog(page).getByLabel("Units to move", { exact: true }).fill("2");
  const attempts: { key: string; payload: unknown }[] = [];
  let result: any;
  await page.route("**/api/commands/stock.relocate", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    if (attempts.length === 1) {
      result = body;
      await route.abort("failed");
    } else {
      expect(body).toEqual(result);
      await route.fulfill({ response });
    }
  });
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await expect(
    dialog(page).getByLabel("Units to move", { exact: true }),
  ).toHaveCount(0);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.reload();
  await navigateWorkspace(page, "Inventory", "Stock");
  await expect(
    page.getByRole("button", { name: "Review retained bin move", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "admin@example.test");
  await expect(
    page.getByRole("button", { name: "Review retained bin move", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "warehouse@example.test");
  await page
    .getByRole("button", { name: "Review retained bin move", exact: true })
    .click();
  await expect(dialog(page)).toContainText("PARTIAL-PHONE");
  await expect(dialog(page)).toContainText(
    "Synthetic physically checked bin move",
  );
  await dialog(page)
    .getByRole("button", { name: "Retry exact bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((attempts[0]!.payload as any).quantity).toBe(2);
  const lots = (await stock(page)).filter(
    (u) => u.product_id === lot.product_id,
  );
  expect(lots).toHaveLength(2);
  expect(lots.find((u) => u.id === lot.id)).toEqual({
    ...lot,
    quantity: 4,
    available: 0,
    revision: lot.revision + 1,
  });
  const moved = lots.find((u) => u.id !== lot.id)!;
  expect([
    moved.quantity,
    moved.cost,
    moved.condition,
    moved.bin,
    moved.available,
    moved.warehouse_id,
  ]).toEqual([2, 125, "quarantine", "PARTIAL-PHONE", 0, lot.warehouse_id]);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "PARTIAL-PHONE" })
      .locator(".stock-quantities > span"),
  ).toHaveText(["2Book", "0Reserved", "0Available"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("browser: bin move locks competing tabs and recovers one retained command from another tab", async ({
  page,
  context,
}) => {
  await signIn(page, "warehouse@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S1")!;
  const other = await context.newPage();
  await other.goto(origin);
  await navigateWorkspace(other, "Inventory", "Stock");
  await openStockActions(
    other.getByRole("row").filter({ hasText: "S2 · stock" }),
  );
  await other
    .getByRole("row")
    .filter({ hasText: "S2 · stock" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  const second = (await stock(page)).find((u) => u.serial === "S2")!;
  await fill(other, second.bin, "OTHER-TAB-REFUSED", "S2");
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let original: { key: string; payload: unknown }, result: unknown;
  await page.route("**/api/commands/stock.relocate", async (route) => {
    original = {
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    };
    reached();
    await gate;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    result = await response.json();
    await route.abort("failed");
  });
  await openStockActions(
    page.getByRole("row").filter({ hasText: "S1 · stock" }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "S1 · stock" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  await fill(page, before.bin, "CROSS-TAB-BIN", "S1");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await started;
  let calls = 0;
  await other.route("**/api/commands/stock.relocate", async (route) => {
    calls++;
    expect({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    }).toEqual(original);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(result);
    await route.fulfill({ response });
  });
  try {
    await expect(dialog(other)).toContainText("CROSS-TAB-BIN");
    await expect(
      dialog(other).getByLabel("Destination bin in this warehouse", {
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog(other)
      .getByRole("button", { name: "Retry exact bin move", exact: true })
      .click();
    await expect(dialog(other).getByRole("alert")).toContainText(
      "Another tab is submitting",
    );
    expect(calls).toBe(0);
  } finally {
    release();
  }
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await dialog(other)
    .getByRole("button", { name: "Retry exact bin move", exact: true })
    .click();
  await expect(dialog(other)).toHaveCount(0);
  expect(calls).toBe(1);
  const after = await stock(other);
  expect(after.find((u) => u.id === before.id)).toEqual({
    ...before,
    bin: "CROSS-TAB-BIN",
    revision: before.revision + 1,
  });
  expect(after.find((u) => u.id === second.id)).toEqual(second);
  await other.close();
});

test("browser: malformed bin recovery and storage failures block transport and preserve stock", async ({
  page,
}) => {
  await signIn(page, "warehouse@example.test");
  const before = await stock(page),
    unit = before.find((u) => u.serial === "S1")!;
  const key = await page.evaluate(async () => {
    const session = await (await fetch("/api/session")).json();
    return `distributor-bin-move:${session.actor.orgId}:${session.actor.id}`;
  });
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/stock.relocate")) calls++;
  });
  await page.evaluate((key) => localStorage.setItem(key, "{damaged"), key);
  await page.reload();
  await navigateWorkspace(page, "Inventory", "Stock");
  await expect(
    page
      .getByRole("region", { name: "Bin move recovery", exact: true })
      .getByRole("alert"),
  ).toContainText("Reconcile the previous attempt");
  await openStockActions(
    page.getByRole("row").filter({ hasText: "S1 · stock" }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "S1 · stock" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  await fill(page, unit.bin, "DAMAGED-STORAGE-BLOCKED", "S1");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Reconcile the previous attempt",
  );
  expect(calls).toBe(0);
  expect(await stock(page)).toEqual(before);
  // Test-only repair after proving no transport; real operators must reconcile.
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.reload();
  await navigateWorkspace(page, "Inventory", "Stock");
  await openStockActions(
    page.getByRole("row").filter({ hasText: "S1 · stock" }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "S1 · stock" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  await fill(page, unit.bin, "WRITE-STORAGE-BLOCKED", "S1");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-bin-move:"))
        throw Error("Synthetic storage write refused");
      original.call(this, key, value);
    };
  });
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Synthetic storage write refused",
  );
  expect(calls).toBe(0);
  expect(await stock(page)).toEqual(before);
});

test("browser: malformed committed bin reply retains original details across navigation and exact recovery", async ({
  page,
}) => {
  await signIn(page, "warehouse@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S2")!;
  let result: any;
  const attempts: { key: string; payload: unknown }[] = [];
  await page.route("**/api/commands/stock.relocate", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    if (attempts.length === 1) {
      result = body;
      await route.fulfill({
        response,
        json: { ...body, bin: "UNREVIEWED-REPLY-BIN" },
      });
    } else {
      expect(body).toEqual(result);
      await route.fulfill({ response });
    }
  });
  await openStockActions(
    page.getByRole("row").filter({ hasText: "S2 · stock" }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "S2 · stock" })
    .getByRole("button", { name: "Move to bin", exact: true })
    .click();
  await fill(page, before.bin, "CONFIRMED-REPLY-BIN", "S2");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "reply could not be confirmed",
  );
  await expect(dialog(page)).toContainText("CONFIRMED-REPLY-BIN");
  await expect(dialog(page)).not.toContainText("UNREVIEWED-REPLY-BIN");
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await navigateWorkspace(page, "Overview");
  await expect(dialog(page)).toHaveCount(0);
  await navigateWorkspace(page, "Inventory", "Stock");
  await page
    .getByRole("button", { name: "Review retained bin move", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Retry exact bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((await stock(page)).find((u) => u.id === before.id)).toEqual({
    ...before,
    bin: "CONFIRMED-REPLY-BIN",
    revision: before.revision + 1,
  });
});
