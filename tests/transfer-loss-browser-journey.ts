import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { reviewDuringInventoryLoad } from "./transfer-review-loading.ts";
import { navigateWorkspace } from "./workspace-navigation.ts";

const origin = "http://127.0.0.1:3163";
type Kind = "loss" | "recovery";
const operation = (kind: Kind) =>
  kind === "loss" ? "transfer loss approval" : "found transfer stock recovery";
const command = (kind: Kind) =>
  kind === "loss" ? "transfer.loss" : "transfer.recover";
const pattern = (kind: Kind) => `**/api/commands/${command(kind)}`;
const d = (page: Page, kind: Kind) =>
  page.getByRole("dialog", {
    name: kind === "loss" ? "Approve transit loss" : "Recover lost stock",
    exact: true,
  });
const recovery = (page: Page, kind: Kind) =>
  page.getByRole("region", {
    name:
      kind === "loss"
        ? "Transfer loss approval recovery"
        : "Found transfer stock recovery",
    exact: true,
  });
const nav = (page: Page, name: string) =>
  navigateWorkspace(page, name, name === "Inventory" ? "Transfers" : undefined);
async function login(page: Page, email = "loss@example.test") {
  await page.goto(origin + "/#sign-in");
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
  const r = await page.request.get(`${origin}/api/transfers`);
  expect(r.status()).toBe(200);
  return (await r.json()) as any[];
}
async function post(
  page: Page,
  name: string,
  key: string,
  data: any,
  expected = 200,
) {
  const csrf = await page.evaluate(
    async () => (await (await fetch("/api/session")).json()).csrf,
  );
  const r = await page.request.post(`${origin}/api/commands/${name}`, {
    headers: { origin, "x-csrf-token": csrf, "idempotency-key": key },
    data,
  });
  expect(r.status()).toBe(expected);
  return await r.json();
}
async function transfer(page: Page, sku: string) {
  const catalog = await (
    await page.request.get(`${origin}/api/catalog/products/page?q=${sku}`)
  ).json();
  const product = catalog.items.find(
    (p: any) => p.sku === sku || (sku === "S1" && p.serialized),
  );
  const transfers = await snapshot(page);
  const t =
    sku === "S1"
      ? transfers.find((t) => t.lines.some((l: any) => l.serial === "S1"))
      : transfers.find((t) =>
          t.lines.some((l: any) => l.product_id === product.id),
        );
  return { t, line: t.lines[0] };
}
async function refresh(page: Page) {
  await page
    .getByRole("button", { name: "Refresh", exact: true })
    .first()
    .click();
}
async function prepare(page: Page, sku: string) {
  const { t, line } = await transfer(page, sku);
  const ref = `SYNTHETIC-FOUND-${sku}`;
  if (!line.losses.some((l: any) => l.loss_ref === ref)) {
    await post(page, "transfer.loss", `prepare-${sku}`, {
      transferId: t.id,
      lineId: line.line_id,
      revision: line.transitRevision,
      quantity: 3,
      serial: null,
      lossRef: ref,
      reason: "Synthetic found stock evidence",
    });
    await refresh(page);
  }
}
const row = (page: Page, sku: string) =>
  page
    .getByRole("region", { name: "Transfer queue", exact: true })
    .getByRole("row")
    .filter({
      has: page.locator("strong", {
        hasText: new RegExp(sku === "S1" ? " · S1$" : `^${sku} ·`),
      }),
    });
async function enter(
  page: Page,
  kind: Kind,
  sku: string,
  ref: string,
  quantity = 2,
  serial = "",
) {
  if (kind === "recovery" && sku !== "S1") await prepare(page, sku);
  const target =
    kind === "recovery" && sku !== "S1"
      ? row(page, sku)
          .locator("div")
          .filter({
            has: page.locator("small", { hasText: `SYNTHETIC-FOUND-${sku} ·` }),
          })
          .filter({
            has: page.getByRole("button", {
              name: "Recover lost stock",
              exact: true,
            }),
          })
          .last()
      : row(page, sku);
  await target
    .getByRole("button", {
      name: kind === "loss" ? "Approve transit loss" : "Recover lost stock",
      exact: true,
    })
    .click();
  const dialog = d(page, kind);
  await dialog
    .getByLabel(
      kind === "loss" ? "Missing units to write off" : "Units found",
      { exact: true },
    )
    .fill(String(quantity));
  await dialog
    .getByLabel(
      kind === "loss"
        ? "Confirm missing serial (leave blank for bulk)"
        : "Scan recovered serial (leave blank for bulk)",
      { exact: true },
    )
    .fill(serial);
  await dialog
    .getByLabel(
      kind === "loss"
        ? "Loss evidence reference (unique per portion)"
        : "Recovery reference (unique per portion)",
      { exact: true },
    )
    .fill(ref);
  if (kind === "recovery") {
    await dialog.getByLabel("Destination bin", { exact: true }).fill("Q-FOUND");
    await dialog
      .getByLabel("Condition", { exact: true })
      .selectOption("quarantine");
  }
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic original loss and found stock review");
}
const send = (page: Page, kind: Kind) =>
  d(page, kind).getByRole("button", { name: "Continue", exact: true }).click();
const retry = (page: Page, kind: Kind) =>
  d(page, kind)
    .getByRole("button", {
      name: `Retry exact ${operation(kind)}`,
      exact: true,
    })
    .click();
const cancel = (page: Page, kind: Kind) =>
  d(page, kind).getByRole("button", { name: "Cancel", exact: true }).click();
async function evidence(page: Page, kind: Kind) {
  return page.evaluate((kind) => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith(`distributor-transfer-${kind}:`),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  }, kind);
}
async function review(page: Page, kind: Kind) {
  await recovery(page, kind)
    .getByRole("button", {
      name: `Review retained ${operation(kind)}`,
      exact: true,
    })
    .click();
  await expect(d(page, kind).getByRole("spinbutton")).toHaveCount(0);
  await expect(d(page, kind).getByRole("textbox")).toHaveCount(0);
}
async function otherAdmin(context: BrowserContext) {
  const otherContext = await context.browser()!.newContext();
  const page = await otherContext.newPage();
  const session = await login(page, "loss-other@example.test");
  return { page, session, close: () => otherContext.close() };
}

for (const kind of ["loss", "recovery"] as const) {
  test(`browser: transfer ${kind} retains the exact attempt across reload and accounts after another stock operation`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page);
    const attempts: { key: string; body: any }[] = [];
    let receipt: any;
    await page.route(pattern(kind), async (route) => {
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
    await enter(page, kind, "LOSS-1", `EXACT-${kind}-1`, 1);
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toBeVisible();
    const original = (await evidence(page, kind))!;
    const a = JSON.parse(original.raw);
    await cancel(page, kind);
    await nav(page, "Overview");
    await reviewDuringInventoryLoad(page, d(page, kind), () =>
      review(page, kind),
    );
    await expect(d(page, kind)).toContainText(`EXACT-${kind}-1`);
    await cancel(page, kind);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login(page, "loss-other@example.test");
    await expect(recovery(page, kind).getByRole("status")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login(page);
    const other = await otherAdmin(context);
    try {
      const { line } = await transfer(other.page, "LOSS-1");
      await post(
        other.page,
        command(kind),
        `other-${kind}-1`,
        kind === "loss"
          ? {
              ...a.payload,
              revision: line.transitRevision,
              lossRef: "OTHER-LOSS-1",
            }
          : {
              ...a.payload,
              receiptRef: "OTHER-FOUND-1",
              bin: "D-OTHER",
              condition: "damaged",
            },
      );
    } finally {
      await other.close();
    }
    const beforeRetry = await snapshot(page);
    await review(page, kind);
    await retry(page, kind);
    await expect(d(page, kind)).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(await snapshot(page)).toEqual(beforeRetry);
    expect(await evidence(page, kind)).toBeNull();
    const line = beforeRetry.find((t) => t.id === a.selection.transferId)
      .lines[0];
    expect(line.quantity).toBe(6);
    expect(line.unit_cost).toBe(1234);
    if (kind === "loss") {
      expect(line.lossQuantity).toBe(2);
      expect(line.losses).toHaveLength(2);
      expect(line.remainingQuantity).toBe(4);
    } else {
      const loss = line.losses.find((l: any) => l.id === a.payload.lossId);
      expect(loss.recoveredQuantity).toBe(2);
      expect(loss.recoveries).toHaveLength(2);
      expect(loss.remainingLostQuantity).toBe(1);
      const stock = (
        await (await page.request.get(`${origin}/api/dashboard`)).json()
      ).stock.filter(
        (u: any) => u.product_id === line.product_id && u.state !== "transit",
      );
      expect(stock.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(
        2,
      );
      expect(
        stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
      ).toBe(2468);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`browser: transfer ${kind} blocks damaged storage, failed writes and missing locks before transport`, async ({
    page,
  }) => {
    const session = await login(page);
    if (kind === "recovery") await prepare(page, "LOSS-2");
    const key = `distributor-transfer-${kind}:${session.actor.orgId}:${session.actor.id}`;
    let sent = 0;
    page.on("request", (r) => {
      if (r.url().endsWith(`/api/commands/${command(kind)}`)) sent++;
    });
    const before = await snapshot(page);
    await page.evaluate((key) => localStorage.setItem(key, "{corrupt"), key);
    await page.reload();
    await nav(page, "Inventory");
    await expect(recovery(page, kind).getByRole("alert")).toContainText(
      "cannot be read",
    );
    await enter(page, kind, "LOSS-2", `STORAGE-${kind}-2`);
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toContainText(
      "cannot be read",
    );
    await cancel(page, kind);
    await page.evaluate((key) => localStorage.removeItem(key), key);
    await page.reload();
    await nav(page, "Inventory");
    await page.evaluate((kind) => {
      const original = Storage.prototype.setItem;
      (window as any).restoreLossStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith(`distributor-transfer-${kind}:`))
          throw Error("Synthetic retention failure");
        return original.call(this, key, value);
      };
    }, kind);
    await enter(page, kind, "LOSS-2", `STORAGE-${kind}-2`);
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toContainText(
      "Synthetic retention failure",
    );
    await page.evaluate(() => (window as any).restoreLossStorage());
    await page.evaluate(() =>
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      }),
    );
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toContainText("Web Locks");
    expect(sent).toBe(0);
    expect(await snapshot(page)).toEqual(before);
    expect(await evidence(page, kind)).toBeNull();
  });

  test(`browser: transfer ${kind} retains malformed success and failed cleanup for original receipt recovery`, async ({
    page,
  }) => {
    await login(page);
    const attempts: { key: string; body: unknown }[] = [];
    await page.route(pattern(kind), async (route) => {
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
    await enter(page, kind, "LOSS-3", `MALFORMED-${kind}-3`);
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toContainText(
      "could not be confirmed",
    );
    const original = await evidence(page, kind),
      before = await snapshot(page);
    await expect(d(page, kind).getByRole("textbox")).toHaveCount(0);
    await page.evaluate((kind) => {
      const original = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith(`distributor-transfer-${kind}:`))
          throw Error("Synthetic cleanup failure");
        return original.call(this, key);
      };
    }, kind);
    await retry(page, kind);
    await expect(d(page, kind).getByRole("alert")).toContainText(
      "Synthetic cleanup failure",
    );
    expect(await evidence(page, kind)).toEqual(original);
    await page.reload();
    await nav(page, "Inventory");
    await review(page, kind);
    await retry(page, kind);
    await expect(d(page, kind)).toHaveCount(0);
    expect(attempts).toHaveLength(3);
    expect(
      attempts.every((a) => JSON.stringify(a) === JSON.stringify(attempts[0])),
    ).toBe(true);
    expect(await snapshot(page)).toEqual(before);
    expect(await evidence(page, kind)).toBeNull();
  });

  test(`browser: transfer ${kind} serializes tabs and preserves the fixed review when retained evidence changes`, async ({
    page,
    context,
  }) => {
    await login(page);
    if (kind === "recovery") {
      await prepare(page, "LOSS-4");
      await prepare(page, "LOSS-5");
    }
    const other = await context.newPage();
    await other.goto(origin);
    await nav(other, "Inventory");
    await enter(page, kind, "LOSS-4", `TABS-${kind}-4`);
    await enter(other, kind, "LOSS-5", `TABS-${kind}-5`);
    let release!: () => void, committed!: () => void;
    const hold = new Promise<void>((r) => {
        release = r;
      }),
      arrived = new Promise<void>((r) => {
        committed = r;
      });
    let sent = 0;
    other.on("request", (r) => {
      if (r.url().endsWith(`/api/commands/${command(kind)}`)) sent++;
    });
    await page.route(pattern(kind), async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed();
      await hold;
      await route.abort("failed");
    });
    try {
      await send(page, kind);
      await arrived;
      await send(other, kind);
      await expect(d(other, kind).getByRole("alert")).toContainText(
        "Another tab is submitting",
      );
      expect(sent).toBe(0);
    } finally {
      release();
    }
    await expect(d(page, kind).getByRole("alert")).toBeVisible();
    const original = (await evidence(page, kind))!;
    await cancel(other, kind);
    await review(other, kind);
    await page.evaluate(({ key, raw }) => {
      const a = JSON.parse(raw);
      a.payload.reason = "CHANGED-IN-OTHER-TAB";
      localStorage.setItem(key, JSON.stringify(a));
    }, original);
    await expect(d(other, kind)).toContainText(
      "Synthetic original loss and found stock review",
    );
    await expect(d(other, kind)).not.toContainText("CHANGED-IN-OTHER-TAB");
    const before = await snapshot(other);
    await retry(other, kind);
    await expect(d(other, kind).getByRole("alert")).toContainText(
      "evidence changed",
    );
    expect(sent).toBe(0);
    expect(await snapshot(other)).toEqual(before);
    await page.evaluate(
      ({ key, raw }) => localStorage.setItem(key, raw),
      original,
    );
    await retry(other, kind);
    await expect(d(other, kind)).toHaveCount(0);
    expect(sent).toBe(1);
    expect(await snapshot(other)).toEqual(before);
    expect(await evidence(other, kind)).toBeNull();
    await other.close();
  });

  test(`browser: transfer ${kind} can finish after abandonment without repopulating the next screen`, async ({
    page,
  }) => {
    await login(page);
    await enter(page, kind, "LOSS-6", `ABANDONED-${kind}-6`);
    let release!: () => void, committed!: () => void;
    const hold = new Promise<void>((r) => {
        release = r;
      }),
      arrived = new Promise<void>((r) => {
        committed = r;
      });
    await page.route(pattern(kind), async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      committed();
      await hold;
      await route.fulfill({ response });
    });
    await send(page, kind);
    await arrived;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    release();
    await nav(page, "Inventory");
    await expect(d(page, kind)).toHaveCount(0);
    await review(page, kind);
    const before = await snapshot(page);
    await retry(page, kind);
    await expect(d(page, kind)).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
    const { line } = await transfer(page, "LOSS-6");
    if (kind === "loss")
      expect(
        line.losses.filter((l: any) => l.loss_ref === `ABANDONED-${kind}-6`),
      ).toHaveLength(1);
    else
      expect(
        line.losses
          .flatMap((l: any) => l.recoveries)
          .filter((r: any) => r.receipt_ref === `ABANDONED-${kind}-6`),
      ).toHaveLength(1);
  });

  test(`browser: transfer ${kind} cached receipts require current administrator authority and preserve recovery after revocation`, async ({
    page,
    context,
  }) => {
    const session = await login(page);
    await page.route(pattern(kind), async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await enter(page, kind, "LOSS-7", `AUTHORITY-${kind}-7`);
    await send(page, kind);
    await expect(d(page, kind).getByRole("alert")).toBeVisible();
    const original = (await evidence(page, kind))!,
      a = JSON.parse(original.raw),
      before = await snapshot(page);
    const other = await otherAdmin(context);
    try {
      const users = await (
        await other.page.request.get(`${origin}/api/users`)
      ).json();
      const u = users.find((u: any) => u.id === session.actor.id);
      const update = async (role: string, key: string) => {
        const current = (
          await (await other.page.request.get(`${origin}/api/users`)).json()
        ).find((user: any) => user.id === u.id);
        return await post(other.page, "user.update", key, {
          userId: u.id,
          revision: current.revision,
          email: u.email,
          name: u.name,
          role,
          sites: u.sites,
          active: true,
          currentPassword: "long-test-only-password",
          reason: "Synthetic current administrator authority review",
        });
      };
      await update("warehouse", `revoke-${kind}`);
      await page.unroute(pattern(kind));
      await login(page);
      await expect(recovery(page, kind)).toHaveCount(0);
      await expect(
        row(page, "LOSS-7").getByRole("button", {
          name: kind === "loss" ? "Approve transit loss" : "Recover lost stock",
          exact: true,
        }),
      ).toHaveCount(0);
      const refused = await post(page, command(kind), a.key, a.payload, 403);
      expect(refused.code).toBe("FORBIDDEN");
      expect(await evidence(page, kind)).toEqual(original);
      expect(await snapshot(other.page)).toEqual(before);
      await update("admin", `restore-${kind}`);
      await login(page);
      await review(page, kind);
      await retry(page, kind);
      await expect(d(page, kind)).toHaveCount(0);
      expect(await snapshot(page)).toEqual(before);
      expect(await evidence(page, kind)).toBeNull();
    } finally {
      await other.close();
    }
  });
}

test("browser: transfer loss and found serial recovery refuse incorrect scans and conserve original serial identity", async ({
  page,
}) => {
  await login(page);
  const before = await snapshot(page);
  await enter(page, "loss", "S1", "SERIAL-LOSS", 1, "S2");
  await send(page, "loss");
  await expect(d(page, "loss").getByRole("alert")).toContainText("SERIAL");
  expect(await snapshot(page)).toEqual(before);
  expect(await evidence(page, "loss")).toBeNull();
  await cancel(page, "loss");
  await expect(
    row(page, "S1").getByRole("button", {
      name: "Approve transit loss",
      exact: true,
    }),
  ).toBeFocused();
  await enter(page, "loss", "S1", "SERIAL-LOSS", 1, "S1");
  await send(page, "loss");
  await expect(d(page, "loss")).toHaveCount(0);
  const lost = await snapshot(page);
  const { line: originalLine } = await transfer(page, "S1");
  expect(originalLine.lostQuantity).toBe(1);
  await enter(page, "recovery", "S1", "SERIAL-FOUND", 1, "S2");
  await send(page, "recovery");
  await expect(d(page, "recovery").getByRole("alert")).toContainText("SERIAL");
  expect(await snapshot(page)).toEqual(lost);
  expect(await evidence(page, "recovery")).toBeNull();
  await d(page, "recovery")
    .getByLabel("Scan recovered serial (leave blank for bulk)", { exact: true })
    .fill("S1");
  await page.route(pattern("recovery"), async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await send(page, "recovery");
  await expect(d(page, "recovery").getByRole("alert")).toBeVisible();
  const found = await snapshot(page);
  await page.unroute(pattern("recovery"));
  await retry(page, "recovery");
  await expect(d(page, "recovery")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(found);
  const { t, line } = await transfer(page, "S1");
  expect(line.losses[0].recoveries).toHaveLength(1);
  expect(line.lostQuantity).toBe(0);
  expect(line.receivedQuantity).toBe(1);
  expect(line.remainingQuantity).toBe(0);
  const stock = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).stock.find((u: any) => u.serial === "S1");
  expect(stock).toMatchObject({
    id: originalLine.unit_id,
    warehouse_id: t.destination_id,
    quantity: 1,
    cost: 6000,
    bin: "Q-FOUND",
    condition: "quarantine",
  });
});

test("browser: transfer loss refuses changed custody and requires a new current review", async ({
  page,
  context,
}) => {
  await login(page);
  await enter(page, "loss", "LOSS-8", "STALE-LOSS-8");
  const other = await otherAdmin(context);
  try {
    const { t, line } = await transfer(other.page, "LOSS-8");
    await post(other.page, "transfer.loss", "other-stale-loss", {
      transferId: t.id,
      lineId: line.line_id,
      revision: line.transitRevision,
      quantity: 1,
      serial: null,
      lossRef: "OTHER-STALE-LOSS",
      reason: "Synthetic custody change",
    });
  } finally {
    await other.close();
  }
  const before = await snapshot(page);
  await send(page, "loss");
  await expect(d(page, "loss").getByRole("alert")).toContainText("REVISION");
  expect(await evidence(page, "loss")).toBeNull();
  expect(await snapshot(page)).toEqual(before);
  await send(page, "loss");
  await expect(d(page, "loss").getByRole("alert")).toContainText(
    "review current transfer custody",
  );
  await cancel(page, "loss");
  await refresh(page);
  await enter(page, "loss", "LOSS-8", "CURRENT-LOSS-8", 1);
  await send(page, "loss");
  await expect(d(page, "loss")).toHaveCount(0);
  const { line } = await transfer(page, "LOSS-8");
  expect(line.lossQuantity).toBe(2);
  expect(line.remainingQuantity).toBe(4);
});

test("browser: found stock reference conflict preserves the exact submitted review without repeating stock", async ({
  page,
}) => {
  await login(page);
  await prepare(page, "LOSS-9");
  const { line } = await transfer(page, "LOSS-9");
  await post(page, "transfer.recover", "previous-found-9", {
    lossId: line.losses[0].id,
    quantity: 1,
    serial: null,
    receiptRef: "SAME-FOUND-9",
    bin: "PREVIOUS",
    condition: "damaged",
    reason: "Synthetic previous evidence",
  });
  await refresh(page);
  const before = await snapshot(page);
  await enter(page, "recovery", "LOSS-9", "SAME-FOUND-9", 1);
  await send(page, "recovery");
  await expect(d(page, "recovery").getByRole("alert")).toContainText(
    "RECEIPT_CONFLICT",
  );
  const original = await evidence(page, "recovery");
  expect(original).not.toBeNull();
  await expect(d(page, "recovery").getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await nav(page, "Inventory");
  await review(page, "recovery");
  await retry(page, "recovery");
  await expect(d(page, "recovery").getByRole("alert")).toContainText(
    "RECEIPT_CONFLICT",
  );
  expect(await evidence(page, "recovery")).toEqual(original);
  expect(await snapshot(page)).toEqual(before);
});
