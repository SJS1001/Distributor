import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type {
  QuantityCorrection,
  QuantityCorrectionInput,
} from "../src/server/inventory-quantity-corrections.ts";
import type { Unit } from "../src/server/inventory.ts";
import type { CostMovement } from "../src/server/inventory-costs.ts";
import {
  canonical,
  hash,
  validateReviewResponse,
  validateRecord,
  validatePage,
} from "../src/web/inventory-quantity-contract.ts";
import {
  inventoryQuantityNativeBrowsers,
  type QuantityNativeCase,
} from "./inventory-quantity-native-browser-fixture.ts";
const ca = "http://127.0.0.1:3331";
const panel = (p: Page) =>
  p.getByRole("region", { name: "Stock quantity correction", exact: true });
const reviewPanel = (p: Page) =>
  p.getByRole("region", { name: "Exact quantity review", exact: true });
type Facts = {
  orgId: string;
  region: string;
  currency: string;
  warehouseId: string;
  accountId: string;
  preparerId: string;
  reviewerId: string;
  unitId: string;
  productId: string;
  sourceId: string;
  unit: Unit;
  original: QuantityCorrection["review"]["source"];
  source: QuantityCorrection["review"]["source"];
  sourcePreserved: boolean;
  movements: QuantityCorrection["review"]["source"][];
  records: QuantityCorrection[];
  carryingValue: number;
  costs: {
    closingValue: number;
    throughSequence: number;
    movements: CostMovement[];
  };
};
async function facts(
  p: Page,
  name: QuantityNativeCase,
  origin = ca,
): Promise<Facts> {
  const r = await p.request.get(`${origin}/__quantity-native/facts/${name}`);
  expect(r.ok()).toBe(true);
  return r.json();
}
async function signIn(p: Page, origin = ca, email = "admin@example.test") {
  await p.goto(origin + "/#sign-in");
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(p, "Inventory", "Stock");
}
async function open(p: Page, name: QuantityNativeCase) {
  const row = p
    .getByRole("row")
    .filter({ has: p.getByText(`Q-NATIVE-${name}`, { exact: true }) });
  await openStockActions(row);
  await row
    .getByRole("button", { name: "Quantity correction", exact: true })
    .click();
  await expect(
    panel(p).getByRole("button", { name: /^Source receipt/ }),
  ).toBeEnabled();
}
async function prepare(
  p: Page,
  name: QuantityNativeCase,
  target = 4,
  reference = `NATIVE-UI-${name}`,
) {
  await open(p, name);
  await panel(p)
    .getByRole("button", { name: /^Source receipt/ })
    .click();
  await panel(p)
    .getByLabel("Quantity reference", { exact: true })
    .fill(reference);
  await panel(p)
    .getByLabel("Target quantity", { exact: true })
    .fill(String(target));
  await panel(p).getByLabel("Posting date", { exact: true }).fill("2026-10-01");
  await panel(p)
    .getByLabel("Quantity reason", { exact: true })
    .fill("Synthetic original receipt quantity error");
  await panel(p)
    .getByLabel("Physical evidence", { exact: true })
    .fill("Synthetic independently recounted receipt");
  await panel(p)
    .getByLabel("Accountant evidence", { exact: true })
    .fill("Synthetic open-period error classification");
  await panel(p)
    .getByRole("button", { name: "Review quantity correction", exact: true })
    .click();
  await expect(reviewPanel(p)).toBeVisible();
  await expect(reviewPanel(p).getByRole("heading")).toBeFocused();
  expect(await reviewPanel(p).locator("input,select,textarea").count()).toBe(0);
}
async function confirm(p: Page) {
  await expect(reviewPanel(p)).toBeVisible();
  await reviewPanel(p)
    .getByRole("button", { name: "Confirm exact quantity", exact: true })
    .click();
}
async function saved(p: Page, state: string, reference = "") {
  const status = p
    .getByRole("status")
    .filter({ hasText: "Saved quantity correction" });
  if (reference) await expect(status).toContainText(reference);
  await expect(status).toContainText(state);
}
async function reviewDecision(
  p: Page,
  decision: "approve" | "reject" = "approve",
) {
  await panel(p)
    .getByLabel("Quantity decision", { exact: true })
    .selectOption(decision);
  await panel(p)
    .getByLabel("Decision reason", { exact: true })
    .fill("Synthetic independent quantity classification");
  await panel(p)
    .getByRole("button", { name: "Review quantity decision", exact: true })
    .click();
  await expect(reviewPanel(p)).toBeVisible();
}
async function second(
  context: BrowserContext,
  origin = ca,
  email = "quantity-native@example.test",
) {
  const c = await context.browser()!.newContext();
  const p = await c.newPage();
  try {
    await signIn(p, origin, email);
    return { context: c, page: p };
  } catch (e) {
    await c.close();
    throw e;
  }
}
async function command(
  p: Page,
  name: string,
  body: unknown,
  origin = ca,
  key = randomUUID(),
) {
  const session = await (await p.request.get(`${origin}/api/session`)).json();
  const r = await p.request.post(`${origin}/api/commands/${name}`, {
    headers: { origin, "x-csrf-token": session.csrf, "idempotency-key": key },
    data: body,
  });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function nativePreparation(
  p: Page,
  f: Facts,
  reference: string,
  origin = ca,
) {
  const r = await p.request.get(
    `${origin}/api/stock/${f.unitId}/quantity-review?sourceMovementId=${f.sourceId}`,
  );
  expect(r.ok()).toBe(true);
  const wire = await r.json();
  expect(wire).not.toHaveProperty("review");
  expect(wire.unit.id).toBe(f.unitId);
  const body: QuantityCorrectionInput = {
    unitId: f.unitId,
    sourceMovementId: f.sourceId,
    reviewHash: wire.reviewHash,
    reference,
    targetQuantity: 4,
    postingDate: "2026-10-01",
    reason: "Synthetic original receipt quantity error",
    physicalEvidence: "Synthetic independently recounted receipt",
    accountantEvidence: "Synthetic open-period error classification",
  };
  return command(
    p,
    "inventory.quantity.prepare",
    body,
    origin,
  ) as Promise<QuantityCorrection>;
}
function preserved(before: Facts, after: Facts) {
  expect(after.source).toEqual(before.original);
  expect(after.original).toEqual(before.original);
  expect(after.sourcePreserved).toBe(true);
  expect(after.unit.cost).toBe(before.unit.cost);
  expect(after.movements.filter((m) => m.id === before.sourceId)).toEqual([
    before.original,
  ]);
}
function effect(
  after: Facts,
  record: QuantityCorrection,
  quantity: number,
  valueDelta: number,
) {
  expect(record.state).toBe("reviewed");
  expect(record.decision?.by).not.toBe(record.createdBy);
  expect(record.movement?.type).toBe("quantity.correction");
  expect(record.movement?.quantity).toBe(quantity);
  expect(record.valueDelta).toBe(valueDelta);
  const movements = after.movements.filter(
    (m) => m.type === "quantity.correction" && m.reference === record.id,
  );
  expect(movements).toEqual([record.movement]);
  const cost = after.costs.movements.find((m) => m.id === record.movement!.id)!;
  expect(cost.valueDelta).toBe(valueDelta);
  expect(cost.accountingDate).toBe("2026-10-01");
  expect(cost.quantityCorrectionId).toBe(record.id);
  expect(cost.unitCost).toBe(1000);
  expect(after.movements.filter((m) => m.type === "count")).toEqual([]);
}
test.describe("Native quantity correction integration", () => {
  const cleanup: (() => void)[] = [];
  let servers: Awaited<ReturnType<typeof inventoryQuantityNativeBrowsers>> = [];
  // These substantial native fixtures belong to these journeys. Keeping them
  // out of the shared readiness path avoids delaying every browser startup.
  test.beforeAll(async () => {
    servers = await inventoryQuantityNativeBrowsers((fn) => cleanup.push(fn));
  });
  test.afterAll(async () => {
    try {
      for (const server of servers) await server.close();
    } finally {
      cleanup.forEach((fn) => fn());
    }
  });
  for (const [region, currency, origin] of [
    ["CA", "CAD", ca],
    ["US", "USD", "http://127.0.0.1:3332"],
    ["CA", "USD", "http://127.0.0.1:3333"],
  ] as const)
    test(`native quantity browser: ${region}-${currency} actual preparation, separate approval and dated stock/carrying effect`, async ({
      page,
      context,
    }) => {
      await signIn(page, origin);
      const before = await facts(page, "approval", origin);
      const scope = {
        orgId: before.orgId,
        unitId: before.unitId,
        region,
        currency,
        sites: [before.warehouseId],
      };
      const wire = await (
        await page.request.get(
          `${origin}/api/stock/${before.unitId}/quantity-review?sourceMovementId=${before.sourceId}`,
        )
      ).json();
      const normalized = await validateReviewResponse(wire, scope);
      expect(await hash(normalized.review)).toBe(wire.reviewHash);
      await prepare(page, "approval", 4, `NATIVE-UI-${region}-${currency}`);
      await expect(reviewPanel(page)).toContainText(`${region} · ${currency}`);
      expect(await facts(page, "approval", origin)).toEqual(before);
      await confirm(page);
      await expect
        .poll(
          async () => (await facts(page, "approval", origin)).records.length,
        )
        .toBe(1);
      const prepared = await facts(page, "approval", origin);
      preserved(before, prepared);
      expect(prepared.unit).toEqual(before.unit);
      expect(prepared.movements).toEqual(before.movements);
      expect(prepared.costs).toEqual(before.costs);
      expect(prepared.records).toHaveLength(1);
      expect(prepared.records[0]!.movement).toBeNull();
      expect(prepared.records[0]!.valueDelta).toBeNull();
      await saved(page, "ready");
      await open(page, "approval");
      await expect(
        panel(page).getByRole("button", {
          name: "Review quantity decision",
          exact: true,
        }),
      ).toBeDisabled();
      const reviewer = await second(context, origin);
      try {
        await open(reviewer.page, "approval");
        await reviewDecision(reviewer.page);
        await confirm(reviewer.page);
        await expect
          .poll(
            async () =>
              (await facts(reviewer.page, "approval", origin)).records[0]
                ?.state,
          )
          .toBe("reviewed");
        const after = await facts(reviewer.page, "approval", origin);
        preserved(before, after);
        const record = after.records[0]!;
        await validateRecord(record, scope);
        effect(after, record, -2, -2000);
        expect(after.unit.quantity).toBe(4);
        expect(after.costs.closingValue).toBe(before.costs.closingValue - 2000);
        expect(after.carryingValue).toBe(4000);
        expect(record.review.source).toEqual(before.original);
        expect(record.input.postingDate).toBe("2026-10-01");
        await saved(reviewer.page, "reviewed");
        await expect(
          reviewer.page
            .getByRole("row")
            .filter({
              has: reviewer.page.getByText("Q-NATIVE-approval", {
                exact: true,
              }),
            })
            .locator(".stock-quantities > span"),
        ).toHaveText(["4Book", "0Reserved", "4Available"]);
        const history = await (
          await reviewer.page.request.get(
            `${origin}/api/stock/history?unitId=${before.unitId}`,
          )
        ).json();
        expect(
          history.items.find((m: any) => m.id === before.sourceId)?.quantity,
        ).toBe(6);
        expect(
          history.items.find((m: any) => m.type === "quantity.correction")
            ?.quantity,
        ).toBe(-2);
      } finally {
        await reviewer.context.close();
      }
    });

  test("native quantity browser: independent rejection preserves actual stock, source and accounting", async ({
    page,
    context,
  }) => {
    await signIn(page);
    const before = await facts(page, "rejection");
    await prepare(page, "rejection");
    await confirm(page);
    await saved(page, "ready");
    const reviewer = await second(context);
    try {
      await open(reviewer.page, "rejection");
      await reviewDecision(reviewer.page, "reject");
      await confirm(reviewer.page);
      await saved(reviewer.page, "rejected");
      const after = await facts(reviewer.page, "rejection");
      preserved(before, after);
      expect(after.unit).toEqual(before.unit);
      expect(after.movements).toEqual(before.movements);
      expect(after.costs).toEqual(before.costs);
      expect(after.records).toHaveLength(1);
      expect(after.records[0]!.decision?.by).toBe(after.reviewerId);
      expect(after.records[0]!.movement).toBeNull();
      expect(after.records[0]!.valueDelta).toBeNull();
    } finally {
      await reviewer.context.close();
    }
  });
  test("native quantity browser: completed lost preparation replays exact body/key and fresh decided record", async ({
    page,
    context,
  }) => {
    await signIn(page);
    const before = await facts(page, "lost-prepare"),
      attempts: { body: string | null; key: string }[] = [];
    let drop = true;
    await page.route(
      "**/api/commands/inventory.quantity.prepare",
      async (route) => {
        attempts.push({
          body: route.request().postData(),
          key: route.request().headers()["idempotency-key"]!,
        });
        const r = await route.fetch();
        expect(r.ok(), await r.text()).toBe(true);
        if (drop) {
          drop = false;
          await route.abort("failed");
        } else await route.fulfill({ response: r });
      },
    );
    await prepare(page, "lost-prepare");
    await confirm(page);
    await expect(panel(page).getByRole("alert")).toBeVisible();
    const ready = await facts(page, "lost-prepare");
    expect(ready.unit).toEqual(before.unit);
    expect(ready.records).toHaveLength(1);
    const reviewer = await second(context);
    try {
      await open(reviewer.page, "lost-prepare");
      await reviewDecision(reviewer.page);
      await confirm(reviewer.page);
      await saved(reviewer.page, "reviewed");
    } finally {
      await reviewer.context.close();
    }
    await page.reload();
    await navigateWorkspace(page, "Inventory", "Stock");
    await page
      .getByRole("button", {
        name: "Recover exact quantity attempt",
        exact: true,
      })
      .click();
    await confirm(page);
    await expect(
      page.getByRole("region", { name: "Saved quantity result" }),
    ).toContainText("reviewed");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const after = await facts(page, "lost-prepare");
    preserved(before, after);
    expect(after.records).toHaveLength(1);
    effect(after, after.records[0]!, -2, -2000);
    expect(
      after.movements.filter((m) => m.type === "quantity.correction"),
    ).toHaveLength(1);
  });
  test("native quantity browser: completed lost decision resolves by native read without duplicate POST/effect", async ({
    page,
    context,
  }) => {
    await signIn(page);
    const before = await facts(page, "lost-decision");
    const p = await nativePreparation(page, before, "NATIVE-LOST-DECISION");
    const reviewer = await second(context);
    try {
      const decisions: { body: string | null; key: string }[] = [],
        reads: string[] = [];
      reviewer.page.on("request", (r) => {
        if (
          r.method() === "GET" &&
          r.url().includes(`/api/stock/quantity-corrections/${p.id}`)
        )
          reads.push(r.url());
      });
      await reviewer.page.route(
        "**/api/commands/inventory.quantity.decide",
        async (route) => {
          decisions.push({
            body: route.request().postData(),
            key: route.request().headers()["idempotency-key"]!,
          });
          const actual = await route.fetch();
          expect(actual.ok(), await actual.text()).toBe(true);
          await route.abort("failed");
        },
      );
      await open(reviewer.page, "lost-decision");
      await reviewDecision(reviewer.page);
      await confirm(reviewer.page);
      await expect(panel(reviewer.page).getByRole("alert")).toBeVisible();
      const terminal = await facts(reviewer.page, "lost-decision");
      effect(terminal, terminal.records[0]!, -2, -2000);
      const readsBefore = reads.length;
      await reviewer.page.reload();
      await navigateWorkspace(reviewer.page, "Inventory", "Stock");
      await reviewer.page
        .getByRole("button", {
          name: "Recover exact quantity attempt",
          exact: true,
        })
        .click();
      await confirm(reviewer.page);
      await expect(
        reviewer.page.getByRole("region", { name: "Saved quantity result" }),
      ).toContainText("reviewed");
      expect(decisions).toHaveLength(1);
      expect(reads.length).toBeGreaterThan(readsBefore);
      const after = await facts(reviewer.page, "lost-decision");
      preserved(before, after);
      expect(after).toEqual(terminal);
    } finally {
      await reviewer.context.close();
    }
  });
  test("native quantity browser: actual reservation stales fixed preparation and retains exact evidence", async ({
    page,
    context,
  }) => {
    await signIn(page);
    const before = await facts(page, "stale");
    await prepare(page, "stale", 4, "NATIVE-RESERVATION-STALE");
    const other = await second(context, ca, "admin@example.test");
    try {
      const cart = await command(other.page, "cart.save", {
        accountId: before.accountId,
        warehouseId: before.warehouseId,
        revision: 0,
        lines: [{ productId: before.productId, quantity: 5 }],
      });
      const quote = await command(other.page, "cart.quote", {
        cartId: cart.id,
        revision: cart.revision,
      });
      await command(other.page, "order.accept", {
        quoteId: quote.id,
        allowBackorder: false,
      });
    } finally {
      await other.context.close();
    }
    await confirm(page);
    await expect(panel(page).getByRole("alert")).toContainText(
      "QUANTITY_STALE",
    );
    const after = await facts(page, "stale");
    preserved(before, after);
    expect(after.unit).toEqual(before.unit);
    expect(after.records).toEqual([]);
    expect(after.movements).toEqual(before.movements);
    const retained = await page.evaluate(
      () =>
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("distributor-quantity:"),
        )?.[1],
    );
    expect(retained).toBeTruthy();
    const a = JSON.parse(retained!);
    expect(a.payload.reference).toBe("NATIVE-RESERVATION-STALE");
    expect(a.payload.targetQuantity).toBe(4);
    expect(a.snapshot.review.reserved).toBe(0);
    const current = await (
      await page.request.get(
        `${ca}/api/stock/${before.unitId}/quantity-review?sourceMovementId=${before.sourceId}`,
      )
    ).json();
    expect(current.reserved).toBe(5);
    expect(current.reviewHash).not.toBe(a.payload.reviewHash);
  });
  test("native quantity browser: current site grant revocation refuses reviewed transport and retains evidence", async ({
    page,
    context,
  }) => {
    await signIn(page, ca, "quantity-preparer@example.test");
    const before = await facts(page, "authorization");
    await prepare(page, "authorization", 4, "NATIVE-AUTHORITY-REFUSED");
    let sends = 0;
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        r.url().includes("inventory.quantity.prepare")
      )
        sends++;
    });
    const admin = await second(context, ca, "admin@example.test");
    try {
      const users = await (
        await admin.page.request.get(`${ca}/api/users`)
      ).json();
      const user = users.find((u: any) => u.id === before.preparerId);
      await command(admin.page, "user.update", {
        userId: user.id,
        revision: user.revision,
        email: user.email,
        name: user.name,
        role: "finance",
        sites: [],
        active: true,
        currentPassword: "long-test-only-password",
        reason: "Synthetic current site withdrawal",
      });
    } finally {
      await admin.context.close();
    }
    await confirm(page);
    await expect(panel(page).getByRole("alert")).toBeVisible();
    expect(sends).toBe(0);
    const after = await facts(page, "authorization");
    preserved(before, after);
    expect(after.records).toEqual([]);
    expect(after.unit).toEqual(before.unit);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((k) =>
          k.startsWith("distributor-quantity:"),
        ),
      ),
    ).toBe(true);
  });
  test("native quantity browser: valued removal to zero and subsequent correction preserve source and rounding", async ({
    page,
    context,
  }) => {
    await signIn(page);
    const before = await facts(page, "zero");
    expect(before.carryingValue).toBe(4001);
    await prepare(page, "zero", 0, "NATIVE-ZERO-REMOVE");
    await confirm(page);
    await saved(page, "ready");
    const reviewer = await second(context);
    try {
      await open(reviewer.page, "zero");
      await reviewDecision(reviewer.page);
      await confirm(reviewer.page);
      await saved(reviewer.page, "reviewed");
      const empty = await facts(reviewer.page, "zero");
      preserved(before, empty);
      expect(empty.unit.quantity).toBe(0);
      expect(empty.carryingValue).toBe(0);
      effect(empty, empty.records[0]!, -6, -4001);
      await open(page, "zero");
      await panel(page)
        .getByRole("button", { name: "Refresh quantity evidence", exact: true })
        .click();
      await panel(page)
        .getByRole("button", { name: "Close quantity correction", exact: true })
        .click();
      await prepare(page, "zero", 3, "NATIVE-ZERO-INCREASE");
      await expect(reviewPanel(page)).toContainText("Reviewed quantity 0");
      await confirm(page);
      await saved(page, "ready");
      await open(reviewer.page, "zero");
      await panel(reviewer.page)
        .getByRole("button", { name: "Refresh quantity evidence", exact: true })
        .click();
      await panel(reviewer.page)
        .getByRole("button", {
          name: "NATIVE-ZERO-INCREASE · ready",
          exact: true,
        })
        .click();
      await reviewDecision(reviewer.page);
      await confirm(reviewer.page);
      await saved(reviewer.page, "reviewed", "NATIVE-ZERO-INCREASE");
      const after = await facts(reviewer.page, "zero");
      preserved(before, after);
      expect(after.unit.quantity).toBe(3);
      expect(after.carryingValue).toBe(2000);
      expect(after.records).toHaveLength(2);
      effect(after, after.records[1]!, 3, 2000);
    } finally {
      await reviewer.context.close();
    }
  });
  test("native quantity browser: actual 21-record history is paged without stock/accounting effects", async ({
    page,
  }) => {
    await signIn(page);
    const before = await facts(page, "paging");
    expect(before.records).toHaveLength(21);
    await open(page, "paging");
    const history = panel(page).getByRole("region", {
      name: "Quantity correction history",
      exact: true,
    });
    await expect(
      history.getByRole("button", { name: /^NATIVE-HISTORY-\d+ · rejected$/ }),
    ).toHaveCount(20);
    await expect(
      history.getByRole("button", {
        name: "NATIVE-HISTORY-20 · rejected",
        exact: true,
      }),
    ).toHaveCount(0);
    const first = await (
      await page.request.get(
        `${ca}/api/stock/${before.unitId}/quantity-corrections`,
      )
    ).json();
    expect(first.items).toHaveLength(20);
    expect(first.next).toBe(first.items[19].id);
    await validatePage(first, {
      orgId: before.orgId,
      unitId: before.unitId,
      region: before.region,
      currency: before.currency,
      sites: [before.warehouseId],
    });
    await history
      .getByRole("button", { name: "Older quantity corrections", exact: true })
      .click();
    await expect(
      history.getByRole("button", { name: /^NATIVE-HISTORY-\d+ · rejected$/ }),
    ).toHaveCount(1);
    await expect(
      history.getByRole("button", {
        name: "NATIVE-HISTORY-20 · rejected",
        exact: true,
      }),
    ).toBeVisible();
    await history
      .getByRole("button", { name: "Newer quantity corrections", exact: true })
      .click();
    await expect(
      history.getByRole("button", { name: /^NATIVE-HISTORY-\d+ · rejected$/ }),
    ).toHaveCount(20);
    expect(await facts(page, "paging")).toEqual(before);
  });
  test("native quantity browser: blocked actual stock refresh preserves saved native result", async ({
    page,
  }) => {
    await signIn(page);
    const before = await facts(page, "refresh");
    await prepare(page, "refresh", 4, "NATIVE-REFRESH-FAIL");
    await page.route("**/api/dashboard", (route) => route.abort("failed"));
    await confirm(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
    ).toContainText("Stock refresh failed");
    const after = await facts(page, "refresh");
    preserved(before, after);
    expect(after.records).toHaveLength(1);
    expect(after.records[0]!.state).toBe("ready");
    expect(after.unit).toEqual(before.unit);
    expect(after.movements).toEqual(before.movements);
    await page.unroute("**/api/dashboard");
  });
});
