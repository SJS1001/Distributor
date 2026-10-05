import { test, expect } from "@playwright/test";
import { createHttp } from "../src/server/http.ts";
import { replacementCarrierFixture } from "./replacement-carrier-fixture.ts";
import { navigateWorkspace } from "./workspace-navigation.ts";

test("browser: secondary pages load on demand and recover a failed download with explicit reload", async ({
  page,
}) => {
  const cleanup: (() => void)[] = [];
  const f = replacementCarrierFixture({ after: (fn) => cleanup.push(fn) });
  const origin = "http://127.0.0.1:3197";
  const http = await createHttp(f.app, { origin });
  const chunks: string[] = [];
  page.on("request", (request) => {
    if (
      /\/assets\/(operations-health|audit-history|event-reporting|reconciliation)-.*\.js/.test(
        request.url(),
      )
    )
      chunks.push(request.url());
  });
  try {
    await http.listen({ host: "127.0.0.1", port: 3197 });
    await page.goto(origin + "/#sign-in");
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    expect(chunks).toEqual([]);
    let downloads = 0;
    await page.route("**/assets/operations-health-*.js", async (route) => {
      downloads++;
      if (downloads === 1) await route.abort("failed");
      else await route.continue();
    });
    await navigateWorkspace(page, "Operations health");
    await expect(page.getByRole("alert")).toHaveText(
      "Unable to load operations health. Reload the workspace to try again.",
    );
    await expect(
      page.getByRole("navigation", { name: "Workspace", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Reload workspace",
        exact: true,
      })
      .click();
    await expect(page.locator("#workspace-title")).toHaveText(
      "Operations health",
    );
    await expect(
      page.getByRole("region", { name: "Operations health", exact: true }),
    ).toBeVisible();
    expect(downloads).toBe(2);
    for (const [destination, region] of [
      ["Audit history", "Audit history"],
      ["Event reporting", "Event reporting"],
      ["Reconciliation", "Stock and billing reconciliation"],
    ]) {
      await navigateWorkspace(page, destination!);
      await expect(
        page.getByRole("region", { name: region!, exact: true }),
      ).toBeVisible();
    }
    expect(new Set(chunks.map((url) => new URL(url).pathname)).size).toBe(4);
    await navigateWorkspace(page, "Overview");
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});

test("browser: replacement warehouse shortcut selects the visible Shipments sub-tab", async ({
  page,
}) => {
  const cleanup: (() => void)[] = [];
  const f = replacementCarrierFixture({ after: (fn) => cleanup.push(fn) });
  const origin = "http://127.0.0.1:3197";
  const http = await createHttp(f.app, { origin });
  try {
    // Prepare only a local intent. No carrier runtime or external IO is enabled.
    f.app.carriers.prepare(f.actor, "navigation-canada-post", {
      ...f.input,
      provider: "canada-post",
      service: "DOM.EP",
    });
    await http.listen({ host: "127.0.0.1", port: 3197 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/#sign-in");
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("button", { name: "Stock & fulfillment", exact: true })
      .click();
    await page
      .getByRole("navigation", {
        name: "Stock & fulfillment pages",
        exact: true,
      })
      .getByRole("button", { name: "Returns", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Replacement history", exact: true })
      .getByRole("button", {
        name: "Review replacement carrier booking",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "Open Canada Post warehouse groups",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("tab", { name: "Shipments", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const groups = page.getByRole("region", {
      name: "Canada Post warehouse groups",
      exact: true,
    });
    await expect(groups).toBeVisible();
    await expect(
      groups.getByRole("heading", {
        name: "Canada Post warehouse groups",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      groups.getByLabel("Canada Post warehouse", { exact: true }),
    ).toHaveValue(f.w1);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await expect(groups).toBeHidden();
    await page.getByRole("tab", { name: "Shipments", exact: true }).click();
    await expect(groups).toBeVisible();
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});

// Recovery must work before supplemental queues finish, and after a failed read.
test("browser: Inventory sub-tabs retain recovery through pending and failed queue loads", async ({
  page,
}) => {
  const { transferArrivalBrowser } =
    await import("./transfer-arrival-browser-fixture.ts");
  const { navigateWorkspace } = await import("./workspace-navigation.ts");
  const cleanup: (() => void)[] = [];
  const http = await transferArrivalBrowser((fn) => cleanup.push(fn));
  const origin = "http://127.0.0.1:3161";
  let release = () => {};
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/#sign-in");
    await page
      .getByLabel("Email", { exact: true })
      .fill("arrival@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await navigateWorkspace(page, "Inventory", "Transfers");
    const queue = page.getByRole("region", {
      name: "Transfer queue",
      exact: true,
    });
    await queue
      .getByRole("row")
      .filter({ hasText: "ARRIVAL-1" })
      .getByRole("button", { name: "Receive transfer", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Receive transfer",
      exact: true,
    });
    await dialog.getByLabel("Units arriving", { exact: true }).fill("2");
    await dialog
      .getByLabel("Arrival reference (unique per portion)", { exact: true })
      .fill("SUBTAB-RECOVERY-1");
    await dialog
      .getByLabel("Destination bin", { exact: true })
      .fill("RECOVERY-BIN");
    await dialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic navigation regression");
    const command = "**/api/commands/transfer.receive";
    await page.route(command, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.unroute(command);
    const snapshot = await (
      await page.request.get(`${origin}/api/transfers`)
    ).json();
    // A corrupt saved count must expose its recovery warning even before the
    // queue loads. No count command is issued by this synthetic storage case.
    await page.evaluate(() => {
      const arrivalKey = Object.keys(localStorage).find((key) =>
        key.startsWith("distributor-transfer-arrival:"),
      )!;
      localStorage.setItem(
        arrivalKey.replace(
          "distributor-transfer-arrival:",
          "distributor-count-observation:",
        ),
        "{corrupt",
      );
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pattern = "**/api/transfers/page";
    let intercepted = false;
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      intercepted = true;
      await pending;
      await route.fulfill({ response });
    });
    await page.reload();
    await navigateWorkspace(page, "Inventory", "Cycle counts");
    await expect.poll(() => intercepted).toBe(true);
    await expect(
      page
        .getByRole("region", {
          name: "Count observation recovery",
          exact: true,
        })
        .getByRole("alert"),
    ).toBeVisible();
    await navigateWorkspace(page, "Inventory", "Transfers");
    await expect(queue).toHaveCount(0);
    const review = page.getByRole("button", {
      name: "Review retained transfer arrival",
      exact: true,
    });
    await review.click();
    await expect(dialog).toContainText("SUBTAB-RECOVERY-1");
    const original = await dialog.elementHandle();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    release();
    await expect(queue).toBeVisible();
    expect(await original!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    await expect(cancel).toBeFocused();
    await page.unroute(pattern);
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Synthetic unavailable transfer queue" },
      }),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Synthetic unavailable transfer queue",
    );
    await navigateWorkspace(page, "Inventory", "Transfers");
    await expect(queue).toHaveCount(0);
    await review.click();
    await expect(dialog).toContainText("SUBTAB-RECOVERY-1");
    await expect(dialog).toContainText("RECOVERY-BIN");
    await page.unroute(pattern);
    await dialog
      .getByRole("button", {
        name: "Retry exact transfer arrival",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await (await page.request.get(`${origin}/api/transfers`)).json(),
    ).toEqual(snapshot);
    await expect(review).toHaveCount(0);
  } finally {
    release();
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});

test("browser: addressable orders preserve filters, list place and history with current detail authority", async ({
  page,
}) => {
  const { orderQueueBrowser } =
    await import("./order-queue-browser-fixture.ts");
  const cleanup: (() => void)[] = [];
  const http = await orderQueueBrowser((fn) => cleanup.push(fn));
  const origin = "http://127.0.0.1:3134";
  try {
    await page.goto(origin + "/#sign-in");
    await page
      .getByLabel("Email", { exact: true })
      .fill("queue-buyer@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    await page.goto(origin + "/#page=Orders&section=orders-queue&orders=open");
    await expect(page.locator("#workspace-title")).toHaveText("Orders");
    const queue = page.getByRole("region", {
      name: "Order queue",
      exact: true,
    });
    await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
      "open",
    );
    await expect(
      queue.getByRole("status").filter({ hasText: /orders loaded/ }),
    ).toHaveText("20 orders loaded");
    await queue
      .getByRole("button", { name: "Load more orders", exact: true })
      .click();
    await expect(
      queue.getByRole("status").filter({ hasText: /orders loaded/ }),
    ).toHaveText("30 orders loaded · All results shown");
    await queue.getByText("Saved filters", { exact: true }).click();
    await queue
      .getByRole("button", { name: "Save current filter", exact: true })
      .click();
    // View contract: record currency differs from the organization default.
    await page.route("**/api/orders/queue-001", async (route) => {
      const response = await route.fetch();
      const order = await response.json();
      await route.fulfill({ response, json: { ...order, currency: "USD" } });
    });
    const opener = page.getByRole("button", {
      name: "Open order queue-001",
      exact: true,
    });
    await opener.click();
    const detail = page.getByRole("region", {
      name: "Focused order detail",
      exact: true,
    });
    await expect(detail).toContainText("Status: open");
    await expect(detail).toContainText("USD 113.00");
    await expect(
      detail.getByRole("region", {
        name: "Recorded order timeline",
        exact: true,
      }),
    ).toContainText("Order recorded");
    await page.goBack();
    await expect(detail).toHaveCount(0);
    await expect(
      queue.getByRole("status").filter({ hasText: /orders loaded/ }),
    ).toHaveText("30 orders loaded · All results shown");
    await expect(opener).toBeFocused();
    await page.goForward();
    await expect(detail).toBeVisible();
    await page.reload();
    await expect(detail).toContainText("Status: open");
    await detail
      .getByRole("button", { name: "Return to order queue", exact: true })
      .click();
    await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
      "open",
    );
    await queue
      .getByRole("button", { name: "Clear order state filter", exact: true })
      .click();
    await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
      "",
    );
    await page.goBack();
    await expect(queue.getByLabel("Order state", { exact: true })).toHaveValue(
      "open",
    );
    await page.goto(
      origin + "/#page=Orders&section=orders-queue&order=unrelated-079",
    );
    await expect(
      page
        .getByRole("region", { name: "Focused order detail", exact: true })
        .getByRole("alert"),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Focused order detail", exact: true }),
    ).not.toContainText("Unrelated customer");
    await page.goto(origin + "/#page=Inventory&section=inventory-counts");
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "destination is unavailable" }),
    ).toBeVisible();
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});

test("browser: stock intent clears hidden search and stock filters follow history and reload", async ({
  page,
}) => {
  const { transferArrivalBrowser } =
    await import("./transfer-arrival-browser-fixture.ts");
  const cleanup: (() => void)[] = [];
  const http = await transferArrivalBrowser((fn) => cleanup.push(fn));
  const origin = "http://127.0.0.1:3161";
  try {
    await page.goto(origin + "/#sign-in");
    await page
      .getByLabel("Email", { exact: true })
      .fill("arrival@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await navigateWorkspace(page, "Inventory", "Stock");
    const queue = page.getByRole("region", {
      name: "Stock queue",
      exact: true,
    });
    const view = queue.getByLabel("Stock condition or state", { exact: true });
    const warehouse = queue.getByLabel("Stock warehouse", { exact: true });
    const query = queue.getByLabel("Search stock serial or bin", {
      exact: true,
    });
    await query.fill("hidden-mismatch");
    await navigateWorkspace(page, "Overview");
    await page.getByRole("button", { name: /Available units/ }).click();
    await expect(view).toHaveValue("available");
    await expect(query).toHaveValue("");
    await expect(
      queue.getByLabel("Stock product", { exact: true }),
    ).toHaveValue("");
    await view.selectOption("");
    await expect(page).not.toHaveURL(/stock=available/);
    await page.goBack();
    await expect(view).toHaveValue("available");
    await page.goForward();
    await expect(view).toHaveValue("");
    await page.reload();
    await expect(view).toHaveValue("");
    // Traversal from an explicit exception to the original broad list also clears it.
    await view.selectOption("damaged");
    await expect(page).toHaveURL(/stock=damaged/);
    await page.goBack();
    await expect(view).toHaveValue("");
    await page.goForward();
    await expect(view).toHaveValue("damaged");
    const id = await warehouse.locator("option").nth(1).getAttribute("value");
    await warehouse.selectOption(id!);
    await expect(page).toHaveURL(/warehouse=/);
    await page.reload();
    await expect(warehouse).toHaveValue(id!);
    await warehouse.selectOption("");
    await expect(page).not.toHaveURL(/warehouse=/);
    await query.fill("retained-local-search");
    await page.getByRole("tab", { name: "Transfers", exact: true }).click();
    await page.getByRole("tab", { name: "Stock", exact: true }).click();
    await expect(query).toHaveValue("retained-local-search");
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});
