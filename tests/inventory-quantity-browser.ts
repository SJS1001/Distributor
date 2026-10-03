import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  quantityFixture,
  quantityRecord,
  decided,
} from "./inventory-quantity-fixture.ts";
import {
  canonical,
  type QuantityCorrection,
  type QuantityCorrectionInput,
} from "../src/web/inventory-quantity-contract.ts";
const url = "/tests/inventory-quantity-harness.html";
const fixed = (p: Page) =>
  p.getByRole("region", { name: "Exact quantity review", exact: true });
async function mock(context: BrowserContext) {
  const review = await quantityFixture();
  const state = {
    actor: "creator",
    role: "finance",
    records: [] as QuantityCorrection[],
    calls: [] as { name: string; key: string | undefined; body: any }[],
    malformed: false,
    lost: false,
    refreshFails: false,
    deny: false,
    readFails: false,
    decisionReadFails: false,
    delay: false,
    historyReads: [] as string[],
    sourceReads: [] as string[],
    externalDecision: false,
  };
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname;
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return send({
        actor: {
          id: state.actor,
          orgId: "org",
          accountId: null,
          role: state.role,
          sites: ["warehouse"],
          name: "Synthetic",
        },
        passwordChangeRequired: state.deny,
        mfaEnrollmentRequired: false,
      });
    if (path === "/api/stock/history") {
      state.sourceReads.push(u.search);
      const { org_id, unit_id, ...source } = review.review.source,
        { org_id: org, ...unit } = review.review.unit;
      return send({
        unit,
        items: [source],
        next: u.searchParams.has("after") ? null : "source-page-2",
      });
    }
    if (path.endsWith("/quantity-review"))
      return send({ ...review.review, reviewHash: review.reviewHash });
    if (path.endsWith("/quantity-corrections")) {
      state.historyReads.push(u.search);
      if (state.readFails)
        return send({ message: "Synthetic history failure" }, 503);
      return send({
        items: state.records,
        next:
          state.records.length && !u.searchParams.has("after")
            ? "correction-page-2"
            : null,
      });
    }
    if (path.startsWith("/api/stock/quantity-corrections/")) {
      if (state.decisionReadFails)
        return send({ message: "Synthetic record failure" }, 503);
      const v = state.records.find(
        (x) => x.id === decodeURIComponent(path.split("/").at(-1)!),
      );
      return v ? send(v) : send({ message: "Not found" }, 404);
    }
    if (path === "/api/stock-refresh")
      return state.refreshFails
        ? send({ message: "Synthetic refresh failure" }, 503)
        : send({});
    if (path.startsWith("/api/commands/")) {
      const body = req.postDataJSON(),
        key = req.headers()["idempotency-key"],
        name = path.split(".").at(-1)!;
      state.calls.push({ name, key, body });
      // Prove persist-before-send through the actual page storage, not a helper-only check.
      const p = context.pages().find((p) => !p.isClosed())!;
      const retained = await p.evaluate(() =>
        JSON.parse(
          localStorage.getItem(
            "distributor-quantity:org:" +
              (localStorage.getItem("test-actor") ?? "creator"),
          ) ?? "null",
        ),
      );
      expect(retained?.key).toBe(key);
      expect(canonical(retained?.payload)).toBe(canonical(body));
      let v: QuantityCorrection;
      if (name === "prepare") {
        v =
          state.records.find((x) => x.reference === body.reference) ??
          quantityRecord(review, body as QuantityCorrectionInput);
        state.records = [v];
        if (state.externalDecision) {
          v = decided(v);
          state.records = [v];
        }
      } else {
        v = decided(state.records[0]!, body.decision, state.actor, body.reason);
        state.records = [v];
      }
      if (state.delay) await new Promise((r) => setTimeout(r, 400));
      if (state.lost) {
        state.lost = false;
        return route.abort("failed");
      }
      return send(state.malformed ? { bad: true } : v);
    }
    return send({ message: "Unexpected mock request" }, 500);
  });
  return state;
}
async function prepare(p: Page) {
  await p.getByRole("button", { name: /^Source opening/ }).click();
  await p.getByLabel("Quantity reference", { exact: true }).fill("correction");
  await p.getByLabel("Target quantity", { exact: true }).fill("3");
  await p.getByLabel("Posting date", { exact: true }).fill("2026-10-03");
  await p
    .getByLabel("Quantity reason", { exact: true })
    .fill("Synthetic misrecorded quantity");
  await p
    .getByLabel("Physical evidence", { exact: true })
    .fill("Synthetic physical evidence");
  await p
    .getByLabel("Accountant evidence", { exact: true })
    .fill("Synthetic classification");
  await p
    .getByRole("button", { name: "Review quantity correction", exact: true })
    .click();
  await expect(fixed(p)).toBeVisible();
  await expect(fixed(p).getByRole("heading")).toBeFocused();
  expect(await fixed(p).locator("input,select,textarea").count()).toBe(0);
}
const confirm = (p: Page) =>
  p
    .getByRole("button", { name: "Confirm exact quantity", exact: true })
    .click();
async function open(p: Page) {
  await p.goto(url);
  await expect(
    p.getByRole("button", { name: /^Source opening/ }),
  ).toBeEnabled();
}
async function finance(p: Page, s: Awaited<ReturnType<typeof mock>>) {
  s.actor = "finance";
  await p.evaluate(() => localStorage.setItem("test-actor", "finance"));
  await p.getByRole("button", { name: "Switch finance principal" }).click();
  await expect(
    p.getByRole("button", { name: "Review quantity decision" }),
  ).toBeEnabled();
}
async function decision(p: Page, kind = "approve") {
  await p.getByLabel("Quantity decision", { exact: true }).selectOption(kind);
  await p
    .getByLabel("Decision reason", { exact: true })
    .fill("Independent evidence");
  await p
    .getByRole("button", { name: "Review quantity decision", exact: true })
    .click();
  await expect(fixed(p)).toBeVisible();
}

test("mock browser: fixed preparation and independent approval append exact effect; no generic count", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  await expect(fixed(page)).toContainText("Original unit cost 100");
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("ready");
  await expect(
    page.getByRole("button", { name: "Review quantity decision" }),
  ).toBeDisabled();
  await finance(page, s);
  await decision(page);
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("reviewed");
  expect(s.calls.map((x) => x.name)).toEqual(["prepare", "decide"]);
  expect(s.records[0]?.movement?.type).toBe("quantity.correction");
  expect(s.records[0]?.movement?.quantity).toBe(-2);
  expect(s.records[0]?.review.source.quantity).toBe(5);
});
test("mock browser: separate rejection has no stock/accounting effect", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  s.records = [quantityRecord(await quantityFixture())];
  s.actor = "finance";
  await page.goto(url);
  await page.evaluate(() => localStorage.setItem("test-actor", "finance"));
  await page.getByRole("button", { name: "Switch finance principal" }).click();
  await decision(page, "reject");
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("rejected");
  expect(s.records[0]?.movement).toBeNull();
  expect(s.records[0]?.valueDelta).toBeNull();
});
test("mock browser: lost preparation survives reload and missing stock row; exact key/body replay retains current decided record", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  s.lost = true;
  await open(page);
  await prepare(page);
  await confirm(page);
  await expect(page.getByRole("alert")).toBeVisible();
  const first = s.calls[0]!;
  await page.reload();
  await page.getByRole("button", { name: "Remove selected row" }).click();
  await page
    .getByRole("button", { name: "Recover exact quantity attempt" })
    .click();
  s.externalDecision = true;
  await confirm(page);
  await expect(
    page.getByRole("region", { name: "Saved quantity result" }),
  ).toContainText("reviewed");
  expect(s.calls[1]).toEqual(first);
});
test("mock browser: malformed success retained; abandoned confirmation cannot clear original", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  s.malformed = true;
  await open(page);
  await prepare(page);
  await confirm(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("distributor-quantity:org:creator"),
    ),
  ).not.toBeNull();
  s.malformed = false;
  s.delay = true;
  await confirm(page);
  await page.getByRole("button", { name: "Close quantity correction" }).click();
  await expect(
    page.getByRole("button", { name: "Recover exact quantity attempt" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover exact quantity attempt" })
    .click();
  await confirm(page);
  await expect(
    page.getByRole("region", { name: "Saved quantity result" }),
  ).toContainText("ready");
  expect(new Set(s.calls.map((x) => x.key)).size).toBe(1);
});
test("mock browser: storage failure, damaged recovery and missing Web Locks fence transport", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("Synthetic storage failure");
    };
  });
  await confirm(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(s.calls.length).toBe(0);
  await page.reload();
  await prepare(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("Web Locks");
  expect(s.calls.length).toBe(0);
  await page.reload();
  await page.evaluate(() =>
    localStorage.setItem("distributor-quantity:org:creator", "{}"),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("recovery evidence");
  expect(s.calls.length).toBe(0);
});
test("mock browser: current finance/security authority denial retains attempt without sending", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  s.deny = true;
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText(
    "Current organization finance authority",
  );
  expect(s.calls.length).toBe(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("distributor-quantity:org:creator"),
    ),
  ).not.toBeNull();
});
test("mock browser: decision recovery reads first and resolves actual outcome without another POST", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  s.records = [quantityRecord(await quantityFixture())];
  await open(page);
  await finance(page, s);
  await decision(page);
  s.lost = true;
  await confirm(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(s.calls.length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Switch finance principal" }).click();
  await page
    .getByRole("button", { name: "Recover exact quantity attempt" })
    .click();
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("reviewed");
  expect(s.calls.length).toBe(1);
});
test("mock browser: decision read refusal or competing terminal decision never sends replacement", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  s.records = [quantityRecord(await quantityFixture())];
  await open(page);
  await finance(page, s);
  await decision(page);
  s.decisionReadFails = true;
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("record failure");
  expect(s.calls.length).toBe(0);
  s.decisionReadFails = false;
  s.records = [decided(s.records[0]!, "reject", "other-finance")];
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("recovery evidence");
  expect(s.calls.length).toBe(0);
});
test("mock browser: paging is bounded; refresh failure retains useful saved result", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await page.getByRole("button", { name: "Older source movements" }).click();
  await expect(
    page.getByRole("button", { name: "Newer source movements" }),
  ).toBeEnabled();
  expect(s.sourceReads.at(-1)).toContain("after=source-page-2");
  await prepare(page);
  s.refreshFails = true;
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("Stock refresh failed");
  s.refreshFails = false;
  await page.getByRole("button", { name: "Refresh quantity evidence" }).click();
  await page
    .getByRole("button", { name: "Older quantity corrections" })
    .click();
  await expect(
    page.getByRole("button", { name: "Newer quantity corrections" }),
  ).toBeEnabled();
  expect(s.historyReads.at(-1)).toContain("after=correction-page-2");
});
test("mock browser: competing tab storage change invalidates fixed review; unit/org switch cannot reuse it", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  const second = await context.newPage();
  await second.goto(url);
  await second.evaluate(() =>
    localStorage.setItem("distributor-quantity:org:creator", "{}"),
  );
  await expect(fixed(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("recovery evidence");
  expect(s.calls.length).toBe(0);
  await second.evaluate(() =>
    localStorage.removeItem("distributor-quantity:org:creator"),
  );
  await page.reload();
  await prepare(page);
  await page.getByRole("button", { name: "Switch unit" }).click();
  await expect(fixed(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Switch organization" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Current organization finance authority",
  );
  expect(s.calls.length).toBe(0);
});

test("mock browser: cleanup failure retains committed receipt and exact recovery", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("distributor-quantity:"))
        throw Error("Synthetic cleanup failure");
      return original.call(this, key);
    };
  });
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("cleanup failure");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("ready");
  expect(s.calls.length).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: "Recover exact quantity attempt" })
    .click();
  await confirm(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved quantity correction" }),
  ).toContainText("ready");
  expect(s.calls[1]).toEqual(s.calls[0]);
});
test("mock browser: same-profile lock contention fences submission", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await open(page);
  await prepare(page);
  const other = await context.newPage();
  await other.goto(url);
  await other.evaluate(() => {
    (window as any).quantityLock = navigator.locks.request(
      "distributor-quantity:org:creator",
      () =>
        new Promise<void>((resolve) => {
          (window as any).releaseQuantityLock = resolve;
        }),
    );
  });
  await expect
    .poll(() =>
      other.evaluate(
        async () => (await navigator.locks.query()).held?.length ?? 0,
      ),
    )
    .toBe(1);
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("Another tab");
  expect(s.calls.length).toBe(0);
  await other.evaluate(() => (window as any).releaseQuantityLock());
  await other.close();
});

test("mock browser: forged policy hash refuses source review and preparation", async ({
  page,
  context,
}) => {
  const s = await mock(context);
  await context.route("**/api/stock/bulk/quantity-review?*", async (route) => {
    const v = await quantityFixture();
    v.review.policy.policyHash = "f".repeat(64);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...v.review, reviewHash: v.reviewHash }),
    });
  });
  await open(page);
  await page.getByRole("button", { name: /^Source opening/ }).click();
  await expect(page.getByRole("alert")).toContainText("recovery evidence");
  await expect(
    page.getByRole("button", {
      name: "Review quantity correction",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(s.calls.length).toBe(0);
});
test("mock browser: phone fixed review preserves readable evidence without page overflow", async ({
  page,
  context,
}) => {
  await mock(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await prepare(page);
  await expect(fixed(page)).toContainText("Source source");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
