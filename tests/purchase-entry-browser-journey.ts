import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

const origin = "http://127.0.0.1:3142";
async function login(page: Page, existing = false) {
  await page.goto(origin + "/#sign-in");
  if (!existing) {
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Purchasing", "Purchase orders");
  await expect(
    page.getByRole("heading", { name: "Purchasing", exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Create purchase order", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function search(page: Page, sku: string) {
  await page.getByLabel("Purchase product search", { exact: true }).fill(sku);
  await page
    .getByRole("button", { name: "Search purchase products", exact: true })
    .click();
  await page.getByRole("button", { name: `Add ${sku}`, exact: true }).click();
}
async function edit(page: Page, sku: string, quantity: string, cost: string) {
  await page.getByLabel(`Units for ${sku}`, { exact: true }).fill(quantity);
  await page
    .getByLabel(`Unit cost in cents for ${sku}`, { exact: true })
    .fill(cost);
}
async function purchases(page: Page) {
  const response = await page.request.get(`${origin}/api/purchases`);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(Array.isArray(result.orders)).toBe(true);
  return result;
}

test("browser: multi-line purchase review retains off-page quantities, retries one lost reply after reload and receives original costs separately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await purchases(page);
  const bodies: unknown[] = [],
    keys: (string | undefined)[] = [];
  await page.route("**/api/commands/purchase.create", async (route) => {
    bodies.push(route.request().postDataJSON());
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (bodies.length === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic purchase reply lost" }),
      });
    else await route.fulfill({ response });
  });
  await open(page);
  const suppliers = page.getByRole("region", {
    name: "Purchase supplier search",
    exact: true,
  });
  await expect(suppliers.getByRole("status")).toHaveText(
    "20 suppliers on this page",
  );
  expect(before.suppliers).toHaveLength(20);
  expect(before.supplierNext).toBeTruthy();
  await suppliers
    .getByRole("button", { name: "Next purchase suppliers", exact: true })
    .click();
  await suppliers
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Z Supplier 35" });
  const selectedSupplier = await suppliers
    .getByLabel("Supplier", { exact: true })
    .inputValue();
  await suppliers
    .getByLabel("Purchase supplier search", { exact: true })
    .fill("%_");
  await suppliers
    .getByRole("button", { name: "Search purchase suppliers", exact: true })
    .click();
  await expect(suppliers.getByRole("status")).toHaveText(
    "1 supplier on this page",
  );
  await expect(suppliers.getByLabel("Supplier", { exact: true })).toHaveValue(
    selectedSupplier,
  );
  await expect(
    page.getByRole("status").filter({ hasText: "20 products on this page" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add BUY-00", exact: true }).click();
  await edit(page, "BUY-00", "3", "501");
  await page
    .getByRole("button", { name: "Next purchase products", exact: true })
    .click();
  await page.getByRole("button", { name: "Add BUY-21", exact: true }).click();
  await edit(page, "BUY-21", "2", "700");
  await expect(
    page.getByLabel("Units for BUY-00", { exact: true }),
  ).toHaveValue("3");
  await search(page, "BUY-42");
  await edit(page, "BUY-42", "1", "0");
  await page
    .getByRole("button", { name: "Remove BUY-42", exact: true })
    .click();
  await expect(
    page.getByLabel("Purchase product search", { exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Purchase total: CAD 29.03");
  await expect(dialog).toContainText("Supplier: Z Supplier 35");
  await page
    .getByRole("button", { name: "Edit purchase lines", exact: true })
    .click();
  await expect(suppliers.getByLabel("Supplier", { exact: true })).toHaveValue(
    selectedSupplier,
  );
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const reviewedLine = dialog.getByRole("row").filter({ hasText: "BUY-00" });
  await expect(reviewedLine.getByRole("cell")).toHaveText([
    "3 units",
    "CAD 5.01",
    "CAD 15.03",
  ]);
  expect(bodies).toHaveLength(0);
  expect((await purchases(page)).orders).toEqual(before.orders);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic purchase reply lost",
  );
  await expect(
    page.getByRole("button", { name: "Edit purchase lines", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Purchasing", exact: true }),
  ).toBeVisible();
  await open(page);
  await expect(dialog).toContainText("Purchase total: CAD 29.03");
  await page
    .getByRole("button", { name: "Retry exact purchase", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const after = await purchases(page);
  const added = after.orders.filter(
    (po: any) => !before.orders.some((old: any) => old.id === po.id),
  );
  expect(added).toHaveLength(1);
  const po = added[0];
  expect(po.supplier_id).toBe(selectedSupplier);
  expect(
    po.lines.map((line: any) => [line.quantity, line.unit_cost]).sort(),
  ).toEqual([
    [2, 700],
    [3, 501],
  ]);
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const receive = async (line: any, quantity: number, deliveryRef: string) =>
    page.request.post(`${origin}/api/commands/purchase.receive`, {
      headers: {
        "x-csrf-token": session.csrf,
        origin,
        "idempotency-key": `purchase-entry-${deliveryRef}`,
      },
      data: {
        poId: po.id,
        lineId: line.id,
        deliveryRef,
        quantity,
        serials: [],
        bin: "BUY-ENTRY",
        quarantine: false,
      },
    });
  const first = po.lines.find((line: any) => line.unit_cost === 501);
  const second = po.lines.find((line: any) => line.unit_cost === 700);
  expect((await receive(first, 1, "ENTRY-PARTIAL")).status()).toBe(200);
  let actual = (await purchases(page)).orders.find(
    (order: any) => order.id === po.id,
  );
  expect(actual.state).toBe("open");
  expect(actual.lines.find((line: any) => line.id === first.id).received).toBe(
    1,
  );
  expect(actual.lines.find((line: any) => line.id === second.id).received).toBe(
    0,
  );
  expect((await receive(first, 1, "ENTRY-PARTIAL")).status()).toBe(200);
  expect(
    (await receive(first, 3, "ENTRY-OVER")).status(),
  ).toBeGreaterThanOrEqual(400);
  expect((await receive(first, 2, "ENTRY-REST")).status()).toBe(200);
  expect((await receive(second, 2, "ENTRY-SECOND")).status()).toBe(200);
  actual = (await purchases(page)).orders.find(
    (order: any) => order.id === po.id,
  );
  expect(actual.state).toBe("received");
  expect(
    actual.lines.every((line: any) => line.received === line.quantity),
  ).toBe(true);
  const stock = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  const received = stock.stock.filter((unit: any) => unit.bin === "BUY-ENTRY");
  expect(received).toHaveLength(3);
  expect(
    received.map((unit: any) => [unit.quantity, unit.cost]).sort(),
  ).toEqual([
    [1, 501],
    [2, 501],
    [2, 700],
  ]);
  expect(
    received.reduce(
      (sum: number, unit: any) => sum + unit.quantity * unit.cost,
      0,
    ),
  ).toBe(2903);
});

test("browser: unsubmitted purchase edits preserve quantities and cancel without creating an order", async ({
  page,
}) => {
  await login(page);
  const before = await purchases(page);
  const requests: unknown[] = [];
  await page.route("**/api/commands/purchase.create", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.continue();
  });
  await open(page);
  await search(page, "BUY-12");
  await expect(
    page.getByLabel("Unit cost in cents for BUY-12", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create purchase order", exact: true }),
  ).toBeVisible();
  await edit(page, "BUY-12", "5", "42");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit purchase lines", exact: true })
    .click();
  await expect(
    page.getByLabel("Units for BUY-12", { exact: true }),
  ).toHaveValue("5");
  await expect(
    page.getByLabel("Unit cost in cents for BUY-12", { exact: true }),
  ).toHaveValue("42");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toHaveLength(0);
  expect((await purchases(page)).orders).toEqual(before.orders);
  await open(page);
  await expect(
    page.getByRole("heading", {
      name: "0 selected purchase lines",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Create purchase order", exact: true }),
  ).toBeFocused();
});

test("browser: another tab adopts retained purchase details without submitting its different review", async ({
  page,
  context,
}) => {
  await login(page);
  const before = await purchases(page);
  await open(page);
  await page
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Z Supplier 00" });
  await search(page, "BUY-30");
  await edit(page, "BUY-30", "1", "1");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const other = await context.newPage();
  await login(other, true);
  await open(other);
  // The dialog can open before the workspace's supplementary supplier read.
  // Select the intended fixture explicitly instead of relying on its default.
  await other
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Z Supplier 00" });
  await search(other, "BUY-31");
  await edit(other, "BUY-31", "1", "2");
  await other
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await other.route("**/api/commands/purchase.create", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"message":"Synthetic other tab lost reply"}',
    });
  });
  await other
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(other.getByRole("alert")).toContainText(
    "Synthetic other tab lost reply",
  );
  let requests = 0;
  await page.route("**/api/commands/purchase.create", async (route) => {
    requests++;
    await route.continue();
  });
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Another tab retained a purchase attempt",
  );
  await expect(page.getByRole("dialog")).toContainText("BUY-31");
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Retry exact purchase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await purchases(page);
  expect(
    after.orders.filter(
      (po: any) => !before.orders.some((old: any) => old.id === po.id),
    ),
  ).toHaveLength(1);
  expect(requests).toBe(1);
  await other.close();
});

test("browser: purchase uncertainty survives sign-out and damaged recovery evidence blocks replacement traffic", async ({
  page,
}) => {
  await login(page);
  const before = await purchases(page);
  await open(page);
  await search(page, "BUY-35");
  await edit(page, "BUY-35", "2", "310");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const attempts: { key: string; body: string }[] = [];
  await page.route("**/api/commands/purchase.create", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await login(page);
  await open(page);
  await expect(page.getByRole("dialog")).toContainText(
    "Purchase total: CAD 6.20",
  );
  await page
    .getByRole("button", { name: "Retry exact purchase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(
    (await purchases(page)).orders.filter(
      (po: any) => !before.orders.some((old: any) => old.id === po.id),
    ),
  ).toHaveLength(1);
  // Success removed the key, so derive its exact organization/account scope from the authenticated session.
  const sessionResponse = await page.request.get(`${origin}/api/session`);
  expect(sessionResponse.status()).toBe(200);
  const { actor } = await sessionResponse.json();
  await page.evaluate(
    ({ orgId, id }) =>
      localStorage.setItem(
        `distributor-purchase-attempt:${orgId}:${id}`,
        "invalid",
      ),
    actor,
  );
  await open(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Purchase recovery evidence cannot be read",
  );
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  expect(attempts).toHaveLength(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("browser: a native invalid purchase line refuses atomically and permits correcting the uncommitted review", async ({
  page,
}) => {
  await login(page);
  const before = await purchases(page);
  await open(page);
  await search(page, "BUY-39");
  await edit(page, "BUY-39", "1", "25");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const keys: string[] = [];
  await page.route("**/api/commands/purchase.create", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (keys.length === 1) {
      const payload = route.request().postDataJSON();
      payload.lines[0].productId = "synthetic-nonexistent-product";
      const response = await route.fetch({ postData: JSON.stringify(payload) });
      expect(response.status()).toBe(404);
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect((await purchases(page)).orders).toEqual(before.orders);
  await page
    .getByRole("button", { name: "Edit purchase lines", exact: true })
    .click();
  await edit(page, "BUY-39", "3", "25");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  const added = (await purchases(page)).orders.filter(
    (po: any) => !before.orders.some((old: any) => old.id === po.id),
  );
  expect(added).toHaveLength(1);
  expect(added[0].lines[0].quantity).toBe(3);
});

test("browser: supplier paging retries the failed cursor and ignores superseded and closed editor replies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await open(page);
  const panel = page.getByRole("region", {
    name: "Purchase supplier search",
    exact: true,
  });
  await expect(panel.getByRole("status")).toHaveText(
    "20 suppliers on this page",
  );
  const selected = await panel
    .getByLabel("Supplier", { exact: true })
    .inputValue();
  const requests: string[] = [];
  await page.route("**/api/purchases/suppliers/page?**", async (route) => {
    requests.push(route.request().url());
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"message":"Synthetic supplier page outage"}',
      });
    else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Next purchase suppliers", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic supplier page outage",
  );
  await expect(
    panel.getByLabel("Supplier", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await expect(panel.getByLabel("Supplier", { exact: true })).toHaveValue(
    selected,
  );
  await panel
    .getByRole("button", { name: "Retry purchase suppliers", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText(
    "20 suppliers on this page",
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  await panel
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: "Z Supplier 35" });
  const offPage = await panel
    .getByLabel("Supplier", { exact: true })
    .inputValue();
  await page.unrouteAll({ behavior: "wait" });
  for (const abandon of ["search", "close"] as const) {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/purchases/suppliers/page?**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q !== "held") {
        await route.continue();
        return;
      }
      const native = await route.fetch();
      entered();
      await held;
      await route
        .fulfill({
          response: native,
          json: {
            items: [{ id: "abandoned", name: "ABANDONED-SUPPLIER" }],
            next: null,
          },
        })
        .catch(() => {});
    });
    await panel
      .getByLabel("Purchase supplier search", { exact: true })
      .fill("held");
    await panel
      .getByRole("button", { name: "Search purchase suppliers", exact: true })
      .click();
    await started;
    if (abandon === "search") {
      await panel
        .getByLabel("Purchase supplier search", { exact: true })
        .fill("%_");
      await panel
        .getByRole("button", { name: "Search purchase suppliers", exact: true })
        .click();
      await expect(panel.getByRole("status")).toHaveText(
        "1 supplier on this page",
      );
      await expect(panel.getByLabel("Supplier", { exact: true })).toHaveValue(
        offPage,
      );
    } else {
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(
      page.getByText("ABANDONED-SUPPLIER", { exact: false }),
    ).toHaveCount(0);
  }
  await open(page);
  await expect(panel.getByRole("status")).toHaveText(
    "20 suppliers on this page",
  );
  expect(
    await panel
      .getByLabel("Supplier", { exact: true })
      .locator("option")
      .count(),
  ).toBeLessThanOrEqual(22);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: purchase validation links to fields and retains corrected draft through fixed review", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await open(page);
  await search(page, "BUY-00");
  await edit(page, "BUY-00", "0", "");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  const summary = page.getByRole("alert", { name: "Check these fields" });
  const units = page.getByLabel("Units for BUY-00", { exact: true });
  await expect(units).toBeFocused();
  await expect(units).toHaveAttribute("aria-invalid", "true");
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("link")).toHaveCount(2);
  await summary
    .getByRole("link")
    .filter({ hasText: "Units for BUY-00" })
    .click();
  await expect(units).toBeFocused();
  await units.fill("3");
  await expect(units).toBeFocused();
  await expect(summary.getByRole("link")).toHaveCount(1);
  await summary.getByRole("link").click();
  const cost = page.getByLabel("Unit cost in cents for BUY-00", {
    exact: true,
  });
  await expect(cost).toBeFocused();
  await cost.fill("501");
  await expect(summary).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Reviewed purchase lines" }),
  ).toContainText("3 units");
  await page
    .getByRole("button", { name: "Edit purchase lines", exact: true })
    .click();
  await expect(units).toHaveValue("3");
  await expect(cost).toHaveValue("501");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
