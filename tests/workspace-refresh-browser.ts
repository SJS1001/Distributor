import { test, expect } from "@playwright/test";
test("request refresh preserves filter and draft and requires explicit latest revision review", async ({
  page,
}) => {
  let revision = 1,
    fail = false,
    reads = 0;
  const record = () => ({
    id: "synthetic-request",
    accountId: "account",
    warehouseId: "warehouse",
    quoteId: "quote",
    revision,
    status: "awaiting_approval",
    lines: [
      {
        productId: "product",
        description: "Synthetic product",
        quantity: revision,
        unitPrice: 100,
        unitTax: 0,
      },
    ],
    total: revision * 100,
    currency: "CAD",
    allowBackorder: false,
    expiresAt: Date.now() + 600000,
    reviewReason: "",
    message: "",
    orderId: null,
    createdAt: "2026-10-07T10:00:00Z",
    updatedAt: "2026-10-07T10:00:00Z",
    expectedHash: `hash-${revision}`,
    history: [],
  });
  await page.route(/\/api\/order-requests(?:\/|\?|$)/, async (route) => {
    reads++;
    await route.fulfill(
      fail
        ? { status: 503, json: { message: "Temporary read failure" } }
        : {
            json: route.request().url().includes("synthetic-request")
              ? record()
              : { items: [record()], next: null },
          },
    );
  });
  let payload: any;
  await page.route("**/api/commands/order.review.decide", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: {} });
  });
  await page.goto("/tests/workspace-refresh-harness.html");
  const filter = page.getByLabel("Request status", { exact: true });
  await filter.selectOption("awaiting_approval");
  const before = reads;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(filter).toHaveValue("awaiting_approval");
  await expect(
    page.getByRole("button", { name: "Refresh requests", exact: true }),
  ).toHaveCount(0);
  fail = true;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary read failure");
  await expect(
    page.getByRole("button", {
      name: "View request synthetic-request",
      exact: true,
    }),
  ).toBeVisible();
  fail = false;
  const failedReads = reads;
  await page
    .getByRole("button", { name: "Retry requests", exact: true })
    .click();
  await expect.poll(() => reads).toBeGreaterThan(failedReads);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "View request synthetic-request",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh request", exact: true }),
  ).toHaveCount(0);
  const message = page.getByLabel("Message to customer (Required)");
  await message.fill("Reviewed original request");
  await page.getByLabel("Private staff note (Optional)").fill("Retain my note");
  revision = 2;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect(
    page.getByText(/This request changed after your decision review/),
  ).toBeVisible();
  await expect(message).toHaveValue("Reviewed original request");
  await expect(
    page.getByRole("button", { name: "Record decision" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use latest request for decision" })
    .click();
  await expect(
    page.getByRole("button", { name: "Record decision" }),
  ).toBeEnabled();
  fail = true;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary read failure");
  await expect(message).toHaveValue("Reviewed original request");
  fail = false;
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect.poll(() => payload?.revision).toBe(2);
  expect(payload.expectedHash).toBe("hash-2");
  expect(payload.staffNote).toBe("Retain my note");
});
test("incoming picker and selected read refresh without dropping draft or rebasing reviewed mutation", async ({
  page,
}) => {
  let revision = 1,
    pickerReads = 0,
    supplyReads = 0;
  await page.route("**/api/orders/page?state=open", async (route) => {
    pickerReads++;
    await route.fulfill({
      json: {
        items: [
          {
            id: "synthetic-order",
            account_id: "buyer",
            warehouse_id: "warehouse",
            lines: [{ description: "Synthetic product" }],
          },
        ],
        next: null,
      },
    });
  });
  await page.route(
    "**/api/orders/synthetic-order/incoming-supply",
    async (route) => {
      supplyReads++;
      await route.fulfill({
        json: {
          orderId: "synthetic-order",
          revision,
          state: "open",
          lines: [
            {
              lineId: "line",
              productId: "product",
              description: "Synthetic product",
              outstanding: 6,
              allocated: 0,
              incoming: 0,
              held: 0,
              uncovered: 6,
            },
          ],
          commitments: [],
          candidates: [
            {
              poId: "purchase",
              purchaseLineId: "purchase-line",
              productId: "product",
              description: "Synthetic product",
              supplierName: "Supplier",
              remainingQuantity: 6,
              availableQuantity: 6,
            },
          ],
        },
      });
    },
  );
  let payload: any;
  await page.route("**/api/commands/order.incoming.commit", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: {} });
  });
  await page.goto("/tests/workspace-refresh-harness.html?mode=incoming");
  await page
    .getByLabel("Open orders", { exact: true })
    .getByRole("button")
    .click();
  await page.getByLabel("Order product", { exact: true }).selectOption("line");
  await page
    .getByLabel("Incoming purchase line", { exact: true })
    .selectOption("purchase-line");
  await page.getByLabel("Units to assign", { exact: true }).fill("2");
  const reason = page.getByLabel("Assignment reason", { exact: true });
  await reason.fill("Preserved delivery priority");
  await expect(
    page.getByRole("button", { name: "Refresh incoming stock", exact: true }),
  ).toHaveCount(0);
  const beforePicker = pickerReads,
    beforeSupply = supplyReads;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect.poll(() => pickerReads).toBeGreaterThan(beforePicker);
  await expect.poll(() => supplyReads).toBeGreaterThan(beforeSupply);
  await expect(reason).toHaveValue("Preserved delivery priority");
  await page
    .getByRole("button", { name: "Review assignment", exact: true })
    .click();
  revision = 2;
  const reviewedRead = supplyReads;
  await page.getByRole("button", { name: "Global refresh fixture" }).click();
  await expect.poll(() => supplyReads).toBeGreaterThan(reviewedRead);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect.poll(() => payload?.revision).toBe(1);
  expect(payload.quantity).toBe(2);
  expect(payload.reason).toBe("Preserved delivery priority");
});

test("minimum order global refresh retains draft, reviewed revision and exact recovery", async ({
  page,
}) => {
  let revision = 1,
    fail = false;
  await page.route("**/api/accounts/account/minimum-order", async (route) => {
    await route.fulfill(
      fail
        ? { status: 503, json: { message: "Temporary minimum read failure" } }
        : {
            json: {
              accountId: "account",
              currency: "CAD",
              minimumSubtotal: revision * 10000,
              minimumEquipmentQuantity: revision,
              revision,
              updatedAt: null,
              updatedBy: null,
              canManage: true,
            },
          },
    );
  });
  const attempts: { key: string | undefined; payload: any }[] = [];
  await page.route(
    "**/api/commands/account.minimum-order.save",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        payload: route.request().postDataJSON(),
      });
      await route.fulfill(
        attempts.length === 1
          ? { status: 503, json: { message: "Uncertain minimum save" } }
          : { json: {} },
      );
    },
  );
  await page.goto("/tests/workspace-refresh-harness.html?mode=minimum");
  const amount = page.getByLabel("Minimum merchandise subtotal (CAD)");
  const units = page.getByLabel("Minimum equipment units", { exact: true });
  const reason = page.getByLabel("Reason for minimum order change");
  const refresh = page.getByRole("button", { name: "Global refresh fixture" });
  const save = page.getByRole("button", {
    name: "Save minimum order",
    exact: true,
  });
  await expect(amount).toHaveValue("100.00");
  await expect(
    page.getByRole("button", { name: "Refresh minimum order requirements" }),
  ).toHaveCount(0);
  await amount.fill("250.00");
  await units.fill("7");
  await reason.fill("Preserve reviewed customer requirements");
  revision = 2;
  await refresh.click();
  await expect(page.getByRole("status")).toContainText(
    "Minimum order requirements changed",
  );
  await expect(amount).toHaveValue("250.00");
  await expect(units).toHaveValue("7");
  await expect(reason).toHaveValue("Preserve reviewed customer requirements");
  await expect(save).toBeDisabled();
  fail = true;
  await refresh.click();
  await expect(page.getByRole("alert")).toContainText(
    "Temporary minimum read failure",
  );
  await expect(amount).toHaveValue("250.00");
  fail = false;
  await page
    .getByRole("button", { name: "Retry minimum order requirements" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Use latest requirements for this draft" })
    .click();
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Uncertain minimum save");
  expect(attempts[0]?.payload).toEqual({
    accountId: "account",
    expectedRevision: 2,
    minimumSubtotal: 25000,
    minimumEquipmentQuantity: 7,
    reason: "Preserve reviewed customer requirements",
  });
  revision = 3;
  await refresh.click();
  await expect(
    page.getByRole("button", { name: "Retry saved minimum order change" }),
  ).toBeVisible();
  await expect(amount).toHaveValue("250.00");
  await page
    .getByRole("button", { name: "Retry saved minimum order change" })
    .click();
  await expect(
    page.getByText("Minimum order saved.", { exact: true }),
  ).toBeVisible();
  expect(attempts[1]).toEqual(attempts[0]);
});
