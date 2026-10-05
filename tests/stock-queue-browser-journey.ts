import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
const origin = "http://127.0.0.1:3137",
  pattern = "**/api/stock/page?*";
async function nav(page: Page, name: string) {
  await navigateWorkspace(
    page,
    name,
    name === "Inventory" ? "Stock" : undefined,
  );
}
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
function stock(page: Page) {
  return page.getByRole("table").filter({
    has: page.getByRole("columnheader", {
      name: "Product / serial",
      exact: true,
    }),
  });
}
test("browser: phone stock queue preserves full totals, failed continuation and off-page native inspection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(
    page
      .locator(".overview-metrics .metric-card")
      .filter({ has: page.getByText("Available units", { exact: true }) })
      .locator("strong"),
  ).toHaveText("32");
  await nav(page, "Inventory");
  const queue = page.getByRole("region", { name: "Stock queue", exact: true });
  await expect(queue.getByRole("status")).toHaveText("20 stock records loaded");
  await expect(
    stock(page).getByText("QUEUE-000-stock-084 · stock", { exact: true }),
  ).toHaveCount(0);
  const urls: string[] = [];
  await page.route(pattern, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic stock continuation failure" },
      });
    else await route.continue();
  });
  await queue
    .getByRole("button", { name: "Load more stock", exact: true })
    .click();
  await expect(queue.getByRole("alert")).toHaveText(
    "Synthetic stock continuation failure",
  );
  await expect(queue.getByRole("status")).toHaveText("20 stock records loaded");
  await expect(
    queue.getByRole("button", { name: "Retry stock queue", exact: true }),
  ).toBeFocused();
  await queue
    .getByRole("button", { name: "Retry stock queue", exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText("40 stock records loaded");
  expect(urls[1]).toBe(urls[0]);
  await page.unroute(pattern);
  await queue
    .getByLabel("Search stock serial or bin", { exact: true })
    .fill("QUEUE-000-stock-084");
  await expect(queue.getByRole("status")).toHaveText("0 stock records loaded");
  await queue
    .getByLabel("Search stock serial or bin", { exact: true })
    .press("Enter");
  await expect(queue.getByRole("status")).toHaveText(
    "1 stock records loaded · All results shown",
  );
  const row = stock(page)
    .getByRole("row")
    .filter({
      has: page.getByText("QUEUE-000-stock-084 · stock", { exact: true }),
    });
  await row.locator("details.stock-actions > summary").click();
  await row.getByRole("button", { name: "Inspect", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Condition", { exact: true })
    .selectOption("quarantine");
  await page
    .getByRole("dialog")
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic off-page reviewed inspection");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/commands/stock.inspect",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(queue.getByRole("status")).toHaveText("20 stock records loaded");
  await queue
    .getByLabel("Stock condition or state", { exact: true })
    .selectOption("quarantine");
  await expect(queue.getByRole("status")).toHaveText("20 stock records loaded");
  while (
    await queue
      .getByRole("button", { name: "Load more stock", exact: true })
      .count()
  ) {
    await queue
      .getByRole("button", { name: "Load more stock", exact: true })
      .click();
    await expect(queue.getByRole("status")).not.toContainText("Loading");
  }
  await expect(queue.getByRole("status")).toHaveText(
    "32 stock records loaded · All results shown",
  );
  await expect(row.getByText("quarantine", { exact: true })).toBeVisible();
  await expect(
    queue.getByRole("heading", { name: "Stock queue", exact: true }),
  ).toBeFocused();
  await nav(page, "Overview");
  await expect(
    page
      .locator(".overview-metrics .metric-card")
      .filter({ has: page.getByText("Available units", { exact: true }) })
      .locator("strong"),
  ).toHaveText("31");
  expect(errors).toEqual([]);
});
test("browser: stock queue discards superseded searches and abandoned navigation refresh and sign-out responses", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Inventory");
  const queue = page.getByRole("region", { name: "Stock queue", exact: true });
  let release!: () => void, called!: () => void, done!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (called = r)),
    finished = new Promise<void>((r) => (done = r));
  await page.route(pattern, async (route) => {
    if (new URL(route.request().url()).searchParams.get("view") === "damaged") {
      const response = await route.fetch();
      called();
      await held;
      await route.fulfill({ response }).catch(() => {});
      done();
    } else await route.continue();
  });
  await queue
    .getByLabel("Stock condition or state", { exact: true })
    .selectOption("damaged");
  await started;
  await queue
    .getByLabel("Search stock serial or bin", { exact: true })
    .fill("087");
  await queue
    .getByLabel("Stock condition or state", { exact: true })
    .selectOption("available");
  await expect(queue.getByRole("status")).toHaveText(
    "1 stock records loaded · All results shown",
  );
  release();
  await finished;
  await expect(stock(page)).toContainText("QUEUE-000-stock-087");
  await expect(
    queue.getByLabel("Stock condition or state", { exact: true }),
  ).toHaveValue("available");
  await page.unroute(pattern);
  for (const action of ["navigate", "refresh", "sign-out"]) {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(queue.getByRole("status")).toHaveText(
      "20 stock records loaded",
    );
    let finish!: () => void, received!: () => void, completed!: () => void;
    const wait = new Promise<void>((r) => (finish = r)),
      request = new Promise<void>((r) => (received = r)),
      completion = new Promise<void>((r) => (completed = r));
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      received();
      await wait;
      await route.fulfill({ response }).catch(() => {});
      completed();
    });
    await queue
      .getByRole("button", { name: "Load more stock", exact: true })
      .click();
    await request;
    if (action === "navigate") await nav(page, "Overview");
    else
      await page
        .getByRole("button", {
          name: action === "refresh" ? "Refresh" : "Sign out",
          exact: true,
        })
        .click();
    finish();
    await completion;
    await page.unroute(pattern);
    if (action === "sign-out") await login(page);
    if (action !== "refresh") await nav(page, "Inventory");
    await expect(queue.getByRole("status")).toHaveText(
      "20 stock records loaded",
    );
  }
});
test("browser: replacement search discards superseded and closed navigation refresh and sign-out responses", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Returns");
  const candidates = "**/replacement-candidates?*";
  const dialog = page.getByRole("dialog"),
    select = dialog.getByLabel("Replacement serial", { exact: true });
  const open = async () => {
    await page
      .getByRole("button", { name: "Approve replacement", exact: true })
      .click();
    await expect(select.locator("option")).toHaveCount(21);
  };
  await open();
  let release!: () => void, called!: () => void, done!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (called = r)),
    finished = new Promise<void>((r) => (done = r));
  await page.route(candidates, async (route) => {
    if (new URL(route.request().url()).searchParams.get("query") === "081") {
      const response = await route.fetch();
      called();
      await held;
      await route.fulfill({ response }).catch(() => {});
      done();
    } else await route.continue();
  });
  const search = dialog.getByLabel("Search replacement serial or bin", {
    exact: true,
  });
  await search.fill("081");
  await search.press("Enter");
  await started;
  await search.fill("087");
  await search.press("Enter");
  await expect(select.locator("option")).toHaveCount(2);
  release();
  await finished;
  await expect(select.locator("option").last()).toContainText(
    "QUEUE-000-stock-087",
  );
  await page.unroute(candidates);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const action of ["close", "navigate", "refresh", "sign-out"]) {
    await open();
    let finish!: () => void, received!: () => void, completed!: () => void;
    const wait = new Promise<void>((r) => (finish = r)),
      request = new Promise<void>((r) => (received = r)),
      completion = new Promise<void>((r) => (completed = r));
    await page.route(candidates, async (route) => {
      const response = await route.fetch();
      received();
      await wait;
      await route.fulfill({ response }).catch(() => {});
      completed();
    });
    await dialog
      .getByRole("button", { name: "Next replacement serials", exact: true })
      .click();
    await request;
    if (action === "close")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    // Global handlers are keyboard-activated here; the modal correctly blocks
    // pointer clicks on the background controls.
    else if (action === "navigate")
      await page
        .getByRole("navigation", { name: "Workspace", exact: true })
        .getByRole("button", { name: "Workspace", exact: true })
        .press("Enter");
    else
      await page
        .getByRole("button", {
          name: action === "refresh" ? "Refresh" : "Sign out",
          exact: true,
        })
        .press("Enter");
    await expect(dialog).toHaveCount(0);
    finish();
    await completion;
    await page.unroute(candidates);
    await expect(dialog).toHaveCount(0);
    if (action === "sign-out") await login(page);
    if (action === "navigate" || action === "sign-out")
      await nav(page, "Returns");
  }
  const current = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  expect(current.claims[0].replacements).toEqual([]);
});
test("browser: replacement search pages retries and reserves an off-page serial without loading stock headers", async ({
  page,
}) => {
  await login(page);
  const dashboard = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  expect(
    dashboard.stock.some((u: any) => u.serial === "QUEUE-000-stock-087"),
  ).toBe(false);
  await nav(page, "Returns");
  await page
    .getByRole("button", { name: "Approve replacement", exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    select = dialog.getByLabel("Replacement serial", { exact: true });
  await expect(select.locator("option")).toHaveCount(21);
  const urls: string[] = [];
  const candidates = "**/replacement-candidates?*";
  await page.route(candidates, async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1)
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic replacement page failure" },
      });
    else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Next replacement serials", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Synthetic replacement page failure",
  );
  await dialog
    .getByRole("button", { name: "Retry replacement search", exact: true })
    .click();
  await expect(
    dialog.getByRole("status", { name: "Replacement serial search status" }),
  ).toContainText(
    `${dashboard.stockSummary.available - 20} replacement serials`,
  );
  expect(urls[1]).toBe(urls[0]);
  await expect(select).toBeFocused();
  await page.unroute(candidates);
  await dialog
    .getByLabel("Search replacement serial or bin", { exact: true })
    .fill("QUEUE-000-stock-087");
  await dialog
    .getByRole("button", { name: "Search replacements", exact: true })
    .click();
  await expect(select.locator("option")).toHaveCount(2);
  await select.selectOption("000-stock-087");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic reviewed off-page warranty replacement");
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
      "/api/commands/warranty.replacement.reserve",
  );
  await dialog
    .getByRole("button", { name: "Reserve replacement", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const current = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  expect(
    current.stock.some((u: any) => u.serial === "QUEUE-000-stock-087"),
  ).toBe(false);
  const reserved = current.claims[0].replacements.find(
    (r: any) => r.state === "reserved",
  );
  expect(reserved.newUnitId).toBe("000-stock-087");
  const old = await (
    await page.request.get(origin + "/api/stock/page?query=S1")
  ).json();
  expect(old.items[0].condition).toBe("quarantine");
});
