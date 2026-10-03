import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { stockFactsDashboard } from "./stock-browser-facts.ts";
import type { CountKind } from "../src/web/count-review.tsx";
const origin = "http://127.0.0.1:3165";
async function login(page: Page) {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function inventory(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Count queue", exact: true })
      .getByRole("status"),
  ).toContainText("counts on this page");
}
async function fixture(page: Page, kind: CountKind) {
  await login(page);
  const csrf = (await (await page.request.get("/api/session")).json()).csrf;
  const command = async (name: string, data: unknown) => {
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": randomUUID(),
      },
      data,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const policy = await (
    await page.request.get("/api/count-review-policy")
  ).json();
  if (kind === "approve" && policy.mode !== "administrator")
    await command("count.policy", {
      mode: "administrator",
      revision: policy.revision,
      reason: "Synthetic self-review recovery fixture",
    });
  const suffix = randomUUID(),
    sku = `COUNT-${suffix}`;
  const product = await command("product.create", {
    sku,
    name: "Synthetic count recovery equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 0,
  });
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await command("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId: dashboard.warehouses[0].id,
    lines: [{ productId: product.id, quantity: 6, unitCost: 500 }],
  });
  const updated = await (
    await page.request.get(`/api/purchases/orders/${po.id}`)
  ).json();
  await command("purchase.receive", {
    poId: po.id,
    lineId: updated.lines[0].id,
    deliveryRef: `COUNT-DEL-${suffix}`,
    quantity: 6,
    serials: [],
    bin: "COUNT",
    quarantine: false,
  });
  const fresh = await stockFactsDashboard(page);
  const unit = fresh.stock.find((u: any) => u.product_id === product.id);
  const count = await command("count.start", {
    unitId: unit.id,
    revision: unit.revision,
    countRef: `COUNT-REF-${suffix}`,
  });
  if (kind === "approve")
    await command("count.submit", {
      countId: count.id,
      quantity: 8,
      reason: "Synthetic physical observation",
    });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await inventory(page);
  const row = page
    .getByRole("region", { name: "Count queue", exact: true })
    .getByRole("row")
    .filter({ hasText: `COUNT-REF-${suffix}` });
  await expect(row).toBeVisible();
  const actor = (await (await page.request.get("/api/session")).json()).actor;
  return {
    count,
    unit,
    row,
    command,
    storageKey: `distributor-count-${kind}:${actor.orgId}:${actor.id}`,
  };
}
const title = (kind: CountKind) =>
  kind === "observation"
    ? "Record count observation"
    : kind === "approve"
      ? "Approve stock correction"
      : "Reject stock count";
async function open(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
  kind: CountKind,
) {
  await f.row
    .getByRole("button", {
      name:
        kind === "observation"
          ? "Record observation"
          : kind === "approve"
            ? "Approve count"
            : "Reject count",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: title(kind), exact: true });
  if (kind === "observation")
    await dialog
      .getByLabel("Physical units observed", { exact: true })
      .fill("8");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill(`Synthetic ${kind} recovery evidence`);
  return dialog;
}
test.describe("retained count recovery", () => {
  test.use({ baseURL: origin });
  for (const kind of ["observation", "approve", "reject"] as const) {
    for (const boundary of ["reload", "navigation", "sign-out"] as const) {
      test(`browser: count ${kind} exact recovery survives ${boundary} without duplicate facts`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const f = await fixture(page, kind),
          attempts: { key: string; body: string }[] = [];
        let receipt: any;
        await page.route(
          `**/api/commands/${kind === "observation" ? "count.submit" : "count.decide"}`,
          async (route) => {
            attempts.push({
              key: route.request().headers()["idempotency-key"]!,
              body: route.request().postData()!,
            });
            const response = await route.fetch();
            expect(response.status(), await response.text()).toBe(200);
            if (attempts.length === 1) {
              receipt = await response.json();
              await route.abort("failed");
            } else {
              expect(await response.json()).toEqual(receipt);
              await route.fulfill({ response });
            }
          },
        );
        let dialog = await open(page, f, kind);
        await dialog
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        const before = await (await page.request.get("/api/counts")).json();
        const stockBefore = await (
          await page.request.get("/api/dashboard")
        ).json();
        let release: (() => void) | undefined;
        let settled: Promise<void> | undefined;
        if (boundary === "reload") {
          const hold = new Promise<void>((resolve) => {
            release = resolve;
          });
          settled = new Promise<void>((resolve) =>
            page.on("requestfinished", (request) => {
              if (new URL(request.url()).pathname === "/api/counts/page")
                resolve();
            }),
          );
          await page.route("**/api/counts/page", async (route) => {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            await hold;
            await route.fulfill({ response });
          });
          await page.reload();
          await expect(
            page.getByRole("heading", { name: "Overview", exact: true }),
          ).toBeVisible();
          await page
            .getByRole("navigation")
            .getByRole("button", { name: "Inventory", exact: true })
            .click();
        } else {
          await dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          if (boundary === "navigation") {
            await page
              .getByRole("navigation")
              .getByRole("button", { name: "Catalog", exact: true })
              .click();
          } else {
            await page
              .getByRole("button", { name: "Sign out", exact: true })
              .click();
            await expect(
              page.getByRole("heading", {
                name: "Sign in to your workspace",
                exact: true,
              }),
            ).toBeVisible();
            await login(page);
          }
          await inventory(page);
        }
        await page
          .getByRole("button", {
            name: `Review retained count ${kind}`,
            exact: true,
          })
          .click({ timeout: 5000 });
        dialog = page.getByRole("dialog", { name: title(kind), exact: true });
        await expect(
          dialog.getByLabel("Reason / evidence", { exact: true }),
        ).toHaveCount(0);
        await expect(dialog).toContainText(
          `Synthetic ${kind} recovery evidence`,
        );
        if (release && settled) {
          const original = await dialog.elementHandle();
          await dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .focus();
          release();
          await settled;
          await expect(
            page
              .getByRole("region", { name: "Count queue", exact: true })
              .getByRole("status"),
          ).toContainText("counts on this page");
          expect(await original!.evaluate((node) => node.isConnected)).toBe(
            true,
          );
          await expect(
            dialog.getByRole("button", { name: "Cancel", exact: true }),
          ).toBeFocused();
          await page.unroute("**/api/counts/page");
        }
        await dialog
          .getByRole("button", {
            name: "Retry exact count operation",
            exact: true,
          })
          .click();
        await expect(dialog).toHaveCount(0);
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(attempts[0]);
        expect(await (await page.request.get("/api/counts")).json()).toEqual(
          before,
        );
        const after = await (await page.request.get("/api/dashboard")).json();
        expect(after.stock).toEqual(stockBefore.stock);
        expect(
          await page.evaluate((k) => localStorage.getItem(k), f.storageKey),
        ).toBeNull();
        expect(errors).toEqual([]);
      });
    }
  }

  for (const fault of [
    "damaged storage",
    "write failure",
    "missing locks",
    "occupied lock",
  ] as const) {
    test(`browser: count observation blocks ${fault} before transport`, async ({
      page,
    }) => {
      const f = await fixture(page, "observation");
      const before = await (await page.request.get("/api/counts")).json();
      let sent = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/api/commands/count.submit")) sent++;
      });
      await page.evaluate(
        ({ fault, key }) => {
          if (fault === "damaged storage")
            localStorage.setItem(key, "damaged synthetic evidence");
          if (fault === "write failure") {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
              if (k === key) throw Error("Synthetic storage write failure");
              return original.call(this, k, v);
            };
          }
          if (fault === "missing locks")
            Object.defineProperty(navigator, "locks", {
              value: undefined,
              configurable: true,
            });
          if (fault === "occupied lock")
            (window as any).held = navigator.locks.request(
              key,
              async () =>
                new Promise<void>((resolve) => {
                  (window as any).releaseCountLock = resolve;
                }),
            );
        },
        { fault, key: f.storageKey },
      );
      if (fault === "occupied lock")
        await expect
          .poll(() =>
            page.evaluate(() => typeof (window as any).releaseCountLock),
          )
          .toBe("function");
      const dialog = await open(page, f, "observation");
      await dialog
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect(sent).toBe(0);
      expect(await (await page.request.get("/api/counts")).json()).toEqual(
        before,
      );
      if (fault === "occupied lock")
        await page.evaluate(() => (window as any).releaseCountLock());
    });
  }
  for (const kind of ["observation", "approve", "reject"] as const) {
    test(`browser: count ${kind} malformed committed reply retains fixed exact recovery`, async ({
      page,
    }) => {
      const f = await fixture(page, kind),
        attempts: { key: string; body: string }[] = [];
      await page.route(
        `**/api/commands/${kind === "observation" ? "count.submit" : "count.decide"}`,
        async (route) => {
          attempts.push({
            key: route.request().headers()["idempotency-key"]!,
            body: route.request().postData()!,
          });
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          if (attempts.length === 1) {
            const receipt = await response.json();
            if (kind === "observation") receipt.quantity++;
            else if (kind === "approve") receipt.adjustment.unitCost++;
            else receipt.state = "approved";
            await route.fulfill({ status: 200, json: receipt });
          } else await route.fulfill({ response });
        },
      );
      const dialog = await open(page, f, kind);
      await dialog
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "reply could not be confirmed",
      );
      const before = await (await page.request.get("/api/counts")).json();
      await expect(
        dialog.getByLabel("Reason / evidence", { exact: true }),
      ).toHaveCount(0);
      await dialog
        .getByRole("button", {
          name: "Retry exact count operation",
          exact: true,
        })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(await (await page.request.get("/api/counts")).json()).toEqual(
        before,
      );
    });
  }

  test("browser: count approval refuses changed policy and requires refreshed review before a new correction", async ({
    page,
  }) => {
    const f = await fixture(page, "approve");
    let dialog = await open(page, f, "approve");
    const policy = await (
      await page.request.get("/api/count-review-policy")
    ).json();
    await f.command("count.policy", {
      mode: "administrator",
      revision: policy.revision,
      reason: "Synthetic changed approval duties",
    });
    const before = await (await page.request.get("/api/counts")).json();
    let sends = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/commands/count.decide")) sends++;
    });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("policy changed");
    expect(
      await page.evaluate((k) => localStorage.getItem(k), f.storageKey),
    ).toBeNull();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("refresh Inventory");
    expect(sends).toBe(1);
    expect(await (await page.request.get("/api/counts")).json()).toEqual(
      before,
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    dialog = await open(page, f, "approve");
    await expect(dialog).toContainText(`version ${policy.revision + 1}`);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(sends).toBe(2);
    const after = await (await page.request.get("/api/counts")).json();
    expect(after.find((c: any) => c.id === f.count.id)).toMatchObject({
      state: "approved",
      result: { adjustment: { delta: 2, valueDelta: 1000 } },
    });
  });

  test("browser: count cleanup failure and changed retained evidence preserve the fixed review", async ({
    page,
  }) => {
    const f = await fixture(page, "observation");
    const attempts: { key: string; body: string }[] = [];
    await page.route("**/api/commands/count.submit", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ response });
    });
    await page.evaluate((key) => {
      const original = Storage.prototype.removeItem;
      (window as any).restoreCountRemove = () => {
        Storage.prototype.removeItem = original;
      };
      Storage.prototype.removeItem = function (k) {
        if (k === key) throw Error("Synthetic cleanup refusal");
        return original.call(this, k);
      };
    }, f.storageKey);
    const dialog = await open(page, f, "observation");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic cleanup refusal",
    );
    await expect(
      dialog.getByLabel("Reason / evidence", { exact: true }),
    ).toHaveCount(0);
    const before = await (await page.request.get("/api/counts")).json();
    const original = await page.evaluate(
      (key) => localStorage.getItem(key)!,
      f.storageKey,
    );
    await page.evaluate(
      ({ key, original }) => {
        const alternate = JSON.parse(original);
        alternate.payload.reason = "Synthetic competing tab evidence";
        localStorage.setItem(key, JSON.stringify(alternate));
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            newValue: JSON.stringify(alternate),
          }),
        );
      },
      { key: f.storageKey, original },
    );
    await expect(dialog).toContainText(
      "Synthetic observation recovery evidence",
    );
    await expect(dialog).not.toContainText("Synthetic competing tab evidence");
    await dialog
      .getByRole("button", { name: "Retry exact count operation", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "changed in another tab",
    );
    expect(attempts).toHaveLength(1);
    await page.evaluate(
      ({ key, original }) => {
        (window as any).restoreCountRemove();
        localStorage.setItem(key, original);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: original }),
        );
      },
      { key: f.storageKey, original },
    );
    await dialog
      .getByRole("button", { name: "Retry exact count operation", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(await (await page.request.get("/api/counts")).json()).toEqual(
      before,
    );
  });

  test("browser: count approval recovers its historical receipt after newer stock and policy changes", async ({
    page,
  }) => {
    const f = await fixture(page, "approve");
    const attempts: { key: string; body: string }[] = [];
    let original: any;
    await page.route("**/api/commands/count.decide", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
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
    let dialog = await open(page, f, "approve");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(original.adjustment).toMatchObject({
      previousQuantity: 6,
      quantity: 8,
      delta: 2,
      unitCost: 500,
      valueDelta: 1000,
    });
    await f.command("stock.count", {
      unitId: f.unit.id,
      revision: original.adjustment.revision,
      count: 7,
      reason: "Synthetic later physical stock correction",
    });
    const policy = await (
      await page.request.get("/api/count-review-policy")
    ).json();
    await f.command("count.policy", {
      mode: "independent",
      revision: policy.revision,
      reason: "Synthetic later review policy",
    });
    const before = await (await page.request.get("/api/dashboard")).json();
    const counts = await (await page.request.get("/api/counts")).json();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await inventory(page);
    await page
      .getByRole("button", {
        name: "Review retained count approve",
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: title("approve"),
      exact: true,
    });
    await expect(dialog).toContainText(
      `version ${original.reviewPolicy.revision}`,
    );
    await expect(dialog).toContainText("Synthetic approve recovery evidence");
    await dialog
      .getByRole("button", { name: "Retry exact count operation", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const after = await (await page.request.get("/api/dashboard")).json();
    expect(after.stock).toEqual(before.stock);
    expect(await (await page.request.get("/api/counts")).json()).toEqual(
      counts,
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), f.storageKey),
    ).toBeNull();
  });
});
