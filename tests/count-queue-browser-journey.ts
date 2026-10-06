import { test, expect, type Page } from "@playwright/test";
import { countQueueStates } from "../src/shared/count-queue.ts";
import { navigateWorkspace, withRowActions } from "./workspace-navigation.ts";
const origin = "http://127.0.0.1:3164",
  pattern = "**/api/counts/page?*";
function queue(page: Page) {
  return page.getByRole("region", { name: "Count queue", exact: true });
}
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Inventory" ? "Cycle counts" : undefined,
  );
}
async function login(
  page: Page,
  email = "count-queue@example.test",
  count = 20,
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
    `${count} counts on this page · Page 1`,
  );
}

test("browser: phone count pages replace twenty rows, retry exact cursors and retain an off-page original-cost correction once", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [],
    reads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/counts")) reads.push(new URL(r.url()).pathname);
  });
  await login(page);
  const before = await (await page.request.get(origin + "/api/counts")).json();
  expect(before).toHaveLength(45);
  const q = queue(page),
    urls: string[] = [];
  await expect(q.locator("tbody tr")).toHaveCount(20);
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic count page failure" },
      });
    else await route.continue();
  });
  await q.getByRole("button", { name: "Older counts", exact: true }).click();
  await expect(q.getByRole("alert")).toHaveText("Synthetic count page failure");
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await expect(
    q.getByRole("button", {
      name: "Record observation",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await expect(
    q.getByRole("button", { name: "Retry count queue", exact: true }),
  ).toBeFocused();
  await q
    .getByRole("button", { name: "Retry count queue", exact: true })
    .press("Enter");
  await expect(q.getByRole("status")).toHaveText(
    "20 counts on this page · Page 2",
  );
  expect(urls[1]).toBe(urls[0]);
  await expect(
    q.getByRole("heading", { name: "Cycle counts", exact: true }),
  ).toBeFocused();
  await expect(q.getByText("SYNTHETIC-COUNT-44", { exact: true })).toHaveCount(
    0,
  );
  await q
    .getByRole("button", { name: "Older counts", exact: true })
    .press("Enter");
  await expect(q.getByRole("status")).toHaveText(
    "5 counts on this page · Page 3",
  );
  await expect(q.locator("tbody tr")).toHaveCount(5);
  await expect(
    q.getByRole("button", { name: "Older counts", exact: true }),
  ).toHaveCount(0);
  await q.getByRole("button", { name: "Newer counts", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 2");
  await expect(
    q.getByText("SYNTHETIC-COUNT-24", { exact: true }),
  ).toBeVisible();
  await q.getByRole("button", { name: "Newer counts", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 1");
  await q.getByRole("button", { name: "Older counts", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 2");
  await q.getByRole("button", { name: "Older counts", exact: true }).click();
  await expect(q.getByRole("status")).toContainText("Page 3");
  await page.unroute(pattern);
  const row = q.getByRole("row").filter({ hasText: "SYNTHETIC-COUNT-04" });
  await (
    await withRowActions(row)
  )
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  const observation = page.getByRole("dialog", {
    name: "Record count observation",
    exact: true,
  });
  await observation
    .getByLabel("Physical units observed", { exact: true })
    .fill("8");
  await observation
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic eight physically counted units");
  await observation
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(observation).toHaveCount(0);
  await expect(q.getByRole("status")).toHaveText(
    "20 counts on this page · Page 1",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const reviewer = await context.newPage();
    reviewer.on("pageerror", (e) => errors.push(e.message));
    await login(reviewer, "admin@example.test");
    const reviewQueue = queue(reviewer);
    await reviewQueue
      .getByLabel("Count state", { exact: true })
      .selectOption("submitted");
    await expect(reviewQueue.getByRole("status")).toHaveText(
      "2 counts on this page · Page 1",
    );
    await (
      await withRowActions(
        reviewQueue.getByRole("row").filter({ hasText: "SYNTHETIC-COUNT-04" }),
      )
    )
      .getByRole("button", { name: "Approve count", exact: true })
      .click();
    const approval = reviewer.getByRole("dialog", {
      name: "Approve stock correction",
      exact: true,
    });
    await expect(approval).toContainText("2 units");
    await expect(approval).toContainText("original unit cost");
    await approval
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic independent off-page physical review");
    const attempts: { key: string; body: string }[] = [];
    let result: any;
    await reviewer.route("**/api/commands/count.decide", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (attempts.length === 1) {
        result = await response.json();
        await route.abort("failed");
      } else {
        expect(await response.json()).toEqual(result);
        await route.fulfill({ response });
      }
    });
    await approval
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(approval.getByRole("alert")).toBeVisible();
    await approval
      .getByRole("button", { name: "Retry exact count operation", exact: true })
      .click();
    await expect(approval).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(result.adjustment).toMatchObject({
      quantity: 8,
      delta: 2,
      unitCost: 1000,
      valueDelta: 2000,
    });
    expect(result.reviewPolicy).toMatchObject({
      mode: "independent",
      revision: 2,
    });
    await reviewQueue
      .getByLabel("Count state", { exact: true })
      .selectOption("approved");
    await expect(
      reviewQueue.getByRole("row").filter({ hasText: "SYNTHETIC-COUNT-04" }),
    ).toContainText("Reviewed under independent policy version 2");
    const after = await (await page.request.get(origin + "/api/counts")).json();
    expect(
      after.filter((c: any) => c.count_ref !== "SYNTHETIC-COUNT-04"),
    ).toEqual(before.filter((c: any) => c.count_ref !== "SYNTHETIC-COUNT-04"));
    const dashboard = await (
      await page.request.get(origin + "/api/dashboard")
    ).json();
    const target = after.find((c: any) => c.count_ref === "SYNTHETIC-COUNT-04");
    expect(
      dashboard.stock.find((u: any) => u.id === target.unit_id).quantity,
    ).toBe(8);
    const history = await (
      await page.request.get(
        origin +
          "/api/stock/history?unitId=" +
          encodeURIComponent(target.unit_id),
      )
    ).json();
    expect(
      history.items.filter(
        (m: any) => m.type === "count" && m.reference === target.id,
      ),
    ).toHaveLength(1);
    expect(
      await reviewer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(reads.every((path) => path === "/api/counts/page")).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: support count filters retry exactly, show no mutation controls and keep empty warehouse scope empty", async ({
  page,
}) => {
  await login(page, "count-support@example.test");
  const q = queue(page),
    urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic count filter failure" },
      });
    else await route.continue();
  });
  await q.getByLabel("Count state", { exact: true }).selectOption("approved");
  await expect(q.getByRole("alert")).toHaveText(
    "Synthetic count filter failure",
  );
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await q
    .getByRole("button", { name: "Retry count queue", exact: true })
    .click();
  await expect(q.getByRole("status")).toContainText("Page 1");
  expect(urls[1]).toBe(urls[0]);
  await page.unroute(pattern);
  for (const state of countQueueStates) {
    const expected = await (
      await page.request.get(origin + "/api/counts/page?state=" + state)
    ).json();
    await q.getByLabel("Count state", { exact: true }).selectOption(state);
    await expect(q.getByRole("status")).toHaveText(
      `${expected.items.length} ${expected.items.length === 1 ? "count" : "counts"} on this page · Page 1`,
    );
    expect(
      await q.locator("tbody tr td:first-child strong").allTextContents(),
    ).toEqual(expected.items.map((c: any) => c.count_ref));
    await expect(
      q.getByRole("button", {
        name: /Record observation|Approve count|Reject count/,
      }),
    ).toHaveCount(0);
  }
  await q.getByRole("button", { name: "Refresh counts", exact: true }).click();
  await expect(q.getByLabel("Count state", { exact: true })).toHaveValue(
    "rejected",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(q.getByLabel("Count state", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "count-empty@example.test", 0);
  await expect(q.locator("tbody tr")).toHaveCount(0);
  await expect(
    q.getByText("No counts match this state in your current warehouse scope.", {
      exact: true,
    }),
  ).toBeVisible();
  await q.getByLabel("Count state", { exact: true }).selectOption("submitted");
  await expect(q.getByRole("status")).toHaveText(
    "0 counts on this page · Page 1",
  );
  await expect(
    q.getByRole("button", {
      name: /Older counts|Newer counts|Record observation|Approve count|Reject count/,
    }),
  ).toHaveCount(0);
});

test("browser: count queue fences superseded filters, navigation, refresh and signed-out reads", async ({
  page,
}) => {
  await login(page);
  const q = queue(page);
  for (const action of ["filter", "navigate", "refresh", "sign-out"]) {
    await q
      .getByRole("button", { name: "Refresh counts", exact: true })
      .click();
    await expect(q.getByRole("status")).toContainText("Page 1");
    let release!: () => void, started!: () => void, complete!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      called = new Promise<void>((r) => (started = r)),
      done = new Promise<void>((r) => (complete = r));
    await page.route(pattern, async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (query.has("after") || query.get("state") === "approved") {
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response }).catch(() => {});
        complete();
      } else await route.continue();
    });
    try {
      if (action === "filter")
        await q
          .getByLabel("Count state", { exact: true })
          .selectOption("approved");
      else
        await q
          .getByRole("button", { name: "Older counts", exact: true })
          .click();
      await called;
      if (action === "filter") {
        await q
          .getByLabel("Count state", { exact: true })
          .selectOption("draft");
        await expect(q.getByRole("status")).toHaveText(
          "20 counts on this page · Page 1",
        );
      } else if (action === "navigate") await nav(page, "Overview");
      else
        await page
          .getByRole("button", {
            name: action === "refresh" ? "Refresh" : "Sign out",
            exact: true,
          })
          .click();
      release();
      await done;
      await page.unroute(pattern);
      if (action === "navigate") await nav(page, "Inventory");
      else if (action === "sign-out") await login(page);
      await expect(q.getByRole("status")).toHaveText(
        "20 counts on this page · Page 1",
      );
      await expect(q.getByLabel("Count state", { exact: true })).toHaveValue(
        action === "filter" ? "draft" : "",
      );
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});
