import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace, withRowActions } from "./workspace-navigation.ts";
import { transferQueueStates } from "../src/shared/transfer-queue.ts";
const origin = "http://127.0.0.1:3160",
  pattern = "**/api/transfers/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Inventory" ? "Transfers" : undefined,
  );
}
async function login(
  page: Page,
  email = "transfer-queue@example.test",
  initialCount = 20,
) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  await expect(queue(page).getByRole("status")).toHaveText(
    `${initialCount} transfers on this page · Page 1`,
  );
}
function queue(page: Page) {
  return page.getByRole("region", { name: "Transfer queue", exact: true });
}
async function next(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
}

test("browser: phone transfer pages replace twenty rows, retry the exact cursor and receive original off-page stock once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [],
    reads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/transfers"))
      reads.push(new URL(r.url()).pathname);
  });
  await login(page);
  const all = await (await page.request.get(origin + "/api/transfers")).json();
  expect(all).toHaveLength(45);
  const first = await (
    await page.request.get(origin + "/api/transfers/page")
  ).json();
  const second = await (
    await page.request.get(
      origin + "/api/transfers/page?after=" + encodeURIComponent(first.next),
    )
  ).json();
  const third = await (
    await page.request.get(
      origin + "/api/transfers/page?after=" + encodeURIComponent(second.next),
    )
  ).json();
  const q = queue(page);
  await expect(q.locator("tbody tr")).toHaveCount(20);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic transfer page failure" },
      });
    else await route.continue();
  });
  await q.getByRole("button", { name: "Older transfers", exact: true }).click();
  await expect(q.getByRole("alert")).toHaveText(
    "Synthetic transfer page failure",
  );
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await expect(
    q.getByRole("button", {
      name: "Receive transfer",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await expect(
    q.getByRole("button", { name: "Retry transfer queue", exact: true }),
  ).toBeFocused();
  await q
    .getByRole("button", { name: "Retry transfer queue", exact: true })
    .press("Enter");
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 2",
  );
  expect(urls[1]).toBe(urls[0]);
  await expect(
    q.getByRole("heading", { name: "Transfers", exact: true }),
  ).toBeFocused();
  await expect(q.getByTitle(first.items[0].id, { exact: true })).toHaveCount(0);
  await q
    .getByRole("button", { name: "Older transfers", exact: true })
    .press("Enter");
  await expect(q.getByRole("status")).toHaveText(
    "5 transfers on this page · Page 3",
  );
  await expect(q.locator("tbody tr")).toHaveCount(5);
  await expect(
    q.getByRole("button", { name: "Older transfers", exact: true }),
  ).toHaveCount(0);
  await q.getByRole("button", { name: "Newer transfers", exact: true }).click();
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 2",
  );
  await expect(q.getByTitle(second.items[0].id, { exact: true })).toBeVisible();
  await q.getByRole("button", { name: "Newer transfers", exact: true }).click();
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 1",
  );
  await q.getByRole("button", { name: "Older transfers", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 2");
  await q.getByRole("button", { name: "Older transfers", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 3");
  await page.unroute(pattern);
  // The oldest pending transfer is beyond two pages in the actual database.
  const target = third.items.find((t: any) => t.state === "partially-received");
  expect(target.lines[0].remainingQuantity).toBe(2);
  const row = q
    .getByRole("row")
    .filter({ has: page.getByTitle(target.id, { exact: true }) });
  await (
    await withRowActions(row)
  )
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await page.getByLabel("Units arriving", { exact: true }).fill("1");
  await page
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill("SYNTHETIC-OFF-PAGE-ARRIVAL");
  await page.getByLabel("Destination bin", { exact: true }).fill("QUEUE-Q");
  await page
    .getByLabel("Condition", { exact: true })
    .selectOption("quarantine");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic off-page inspection");
  const keys: string[] = [],
    bodies: string[] = [];
  await page.route("**/api/commands/transfer.receive", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    bodies.push(route.request().postData()!);
    if (keys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retry exact transfer arrival", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 1",
  );
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(bodies[1]).toBe(bodies[0]);
  const after = await (
    await page.request.get(origin + "/api/transfers")
  ).json();
  const updated = after.find((t: any) => t.id === target.id);
  expect(updated.lines[0].receivedQuantity).toBe(2);
  expect(updated.lines[0].remainingQuantity).toBe(1);
  expect(target.lines[0].unit_cost).toBe(1000);
  expect(updated.lines[0].unit_cost).toBe(1000);
  expect(
    updated.lines[0].receipts.filter(
      (r: any) => r.receipt_ref === "SYNTHETIC-OFF-PAGE-ARRIVAL",
    ),
  ).toHaveLength(1);
  expect(after.filter((t: any) => t.id !== target.id)).toEqual(
    all.filter((t: any) => t.id !== target.id),
  );
  await q
    .getByLabel("Transfer state", { exact: true })
    .selectOption("partially-received");
  await expect(q.getByTitle(target.id, { exact: true })).toBeVisible();
  await expect(row).toContainText(
    "SYNTHETIC-OFF-PAGE-ARRIVAL · 1 quarantine · QUEUE-Q",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(reads.every((path) => path === "/api/transfers/page")).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: transfer support filters all live custody states and retries failed filters without stale change controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "transfer-support@example.test");
  const q = queue(page);
  let failed = false;
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("state") === "received"
    ) {
      urls.push(route.request().url());
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: { message: "Synthetic transfer filter failure" },
        });
        return;
      }
    }
    await route.continue();
  });
  await q
    .getByLabel("Transfer state", { exact: true })
    .selectOption("received");
  await expect(q.getByRole("alert")).toHaveText(
    "Synthetic transfer filter failure",
  );
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await q
    .getByRole("button", { name: "Retry transfer queue", exact: true })
    .click();
  await expect(q.getByRole("status")).toHaveText(
    "2 transfers on this page · Page 1",
  );
  expect(urls[1]).toBe(urls[0]);
  await page.unroute(pattern);
  for (const state of transferQueueStates) {
    const expected = await (
      await page.request.get(origin + "/api/transfers/page?state=" + state)
    ).json();
    await q.getByLabel("Transfer state", { exact: true }).selectOption(state);
    await expect(q.getByRole("status")).toHaveText(
      `${expected.items.length} ${expected.items.length === 1 ? "transfer" : "transfers"} on this page · Page 1`,
    );
    await expect(q.locator("tbody tr")).toHaveCount(expected.items.length);
    expect(
      await q
        .locator("tbody tr td:first-child span")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("title"))),
    ).toEqual(expected.items.map((t: any) => t.id));
    await expect(
      q.getByRole("button", {
        name: "Receive transfer",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await expect(
      q.getByRole("button", {
        name: "Approve transit loss",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await expect(
      q.getByRole("button", {
        name: "Recover lost stock",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
  }
  await q
    .getByRole("button", { name: "Refresh transfers", exact: true })
    .click();
  await expect(q.getByLabel("Transfer state", { exact: true })).toHaveValue(
    "reconciled-with-loss",
  );
  await expect(q.getByRole("status")).toHaveText(
    "1 transfer on this page · Page 1",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(q.getByLabel("Transfer state", { exact: true })).toHaveValue("");
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 1",
  );
});

test("browser: transfer queue abandons stale filters, navigation, application refresh and signed-out pages", async ({
  page,
}) => {
  await login(page);
  const q = queue(page);
  let release!: () => void, started!: () => void, complete!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    called = new Promise<void>((r) => (started = r)),
    done = new Promise<void>((r) => (complete = r));
  await page.route(pattern, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("state") === "received"
    ) {
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response }).catch(() => {});
      complete();
    } else await route.continue();
  });
  await q
    .getByLabel("Transfer state", { exact: true })
    .selectOption("received");
  await called;
  await q.getByLabel("Transfer state", { exact: true }).selectOption("transit");
  await expect(q.getByRole("status")).toHaveText(
    "20 transfers on this page · Page 1",
  );
  release();
  await done;
  await page.unroute(pattern);
  await expect(q.getByLabel("Transfer state", { exact: true })).toHaveValue(
    "transit",
  );
  await expect(
    q.getByRole("cell", { name: "received", exact: true }),
  ).toHaveCount(0);
  for (const action of ["navigate", "refresh", "sign-out"]) {
    await q
      .getByRole("button", { name: "Refresh transfers", exact: true })
      .click();
    await expect(q.getByRole("status")).toContainText("Page 1");
    let finish!: () => void, observed!: () => void, completed!: () => void;
    const wait = new Promise<void>((r) => (finish = r)),
      responseRead = new Promise<void>((r) => (observed = r)),
      finished = new Promise<void>((r) => (completed = r));
    await page.route(pattern, async (route) => {
      if (new URL(route.request().url()).searchParams.has("after")) {
        const response = await route.fetch();
        observed();
        await wait;
        await route.fulfill({ response }).catch(() => {});
        completed();
      } else await route.continue();
    });
    await q
      .getByRole("button", { name: "Older transfers", exact: true })
      .click();
    await responseRead;
    if (action === "navigate") await nav(page, "Overview");
    else
      await page
        .getByRole("button", {
          name: action === "refresh" ? "Refresh" : "Sign out",
          exact: true,
        })
        .click();
    finish();
    await finished;
    await page.unroute(pattern);
    if (action === "navigate") await nav(page, "Inventory");
    else if (action === "sign-out") await login(page);
    await expect(q.getByRole("status")).toHaveText(
      "20 transfers on this page · Page 1",
    );
    await expect(q.getByLabel("Transfer state", { exact: true })).toHaveValue(
      "",
    );
  }
});

test("browser: restricted transfer support sees only its destination and an empty state has no stale rows or actions", async ({
  page,
}) => {
  await login(page, "transfer-restricted@example.test", 3);
  const q = queue(page);
  await expect(q.locator("tbody tr")).toHaveCount(3);
  const all = await (await page.request.get(origin + "/api/transfers")).json();
  expect(all).toHaveLength(3);
  for (const transfer of all) {
    await expect(q.getByTitle(transfer.id, { exact: true })).toBeVisible();
  }
  await q
    .getByLabel("Transfer state", { exact: true })
    .selectOption("received");
  await expect(q.getByRole("status")).toHaveText(
    "0 transfers on this page · Page 1",
  );
  await expect(
    q.getByText(
      "No transfers match this state in your current warehouse scope.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await expect(
    q.getByRole("button", {
      name: /Receive transfer|Approve transfer loss|Recover found transfer stock|Older transfers|Newer transfers/,
    }),
  ).toHaveCount(0);
  await q
    .getByRole("button", { name: "Refresh transfers", exact: true })
    .click();
  await expect(q.getByRole("status")).toHaveText(
    "0 transfers on this page · Page 1",
  );
  await expect(q.getByLabel("Transfer state", { exact: true })).toHaveValue(
    "received",
  );
  await q.getByLabel("Transfer state", { exact: true }).selectOption("");
  await expect(q.getByRole("status")).toHaveText(
    "3 transfers on this page · Page 1",
  );
  await expect(q.locator("tbody tr")).toHaveCount(3);
});
