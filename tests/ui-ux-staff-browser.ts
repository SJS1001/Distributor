import { test, expect } from "@playwright/test";
const open = (mode: string) => `/tests/ui-ux-staff-harness.html?mode=${mode}`;
test("collapsed identifiers preserve dialog field focus, keyboard dismissal and focus containment", async ({
  page,
}) => {
  await page.goto(open("modal"));
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#outcome")).toHaveText('"closed"');
  await page.goto(open("report"));
  const dialog = page.getByRole("dialog");
  const summary = dialog.locator("summary");
  await expect(summary).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
});
test("quote expiry becomes explicit while request detail remains open", async ({
  page,
}) => {
  const request = {
    id: "synthetic-request",
    accountId: "synthetic-account",
    warehouseId: "warehouse",
    quoteId: "quote",
    revision: 1,
    status: "awaiting_approval",
    lines: [
      {
        productId: "product",
        description: "Synthetic product",
        quantity: 1,
        unitPrice: 100,
        unitTax: 0,
      },
    ],
    total: 100,
    currency: "CAD",
    allowBackorder: false,
    expiresAt: Date.now() + 1600,
    reviewReason: "",
    message: "",
    orderId: null,
    createdAt: "2026-10-07T10:00:00Z",
    updatedAt: "2026-10-07T10:00:00Z",
    expectedHash: "hash",
    history: [],
  };
  await page.route(/\/api\/order-requests(?:\/|\?|$)/, (route) =>
    route.fulfill({
      json: route.request().url().includes("/synthetic-request")
        ? request
        : { items: [request], next: null },
    }),
  );
  await page.goto(open("requests"));
  await page
    .getByRole("button", {
      name: "View request synthetic-request",
      exact: true,
    })
    .click();
  await expect(page.getByText("Expired", { exact: true })).toBeVisible();
  await expect(page.getByText(/buyer must review current/)).toBeVisible();
});
test("buyer account follows role enablement, requirement and submitted applicability", async ({
  page,
}) => {
  await page.goto(open("modal"));
  const account = page.getByLabel("Buyer account", { exact: true });
  await expect(account).toBeDisabled();
  await page.getByLabel("Role", { exact: true }).selectOption("buyer");
  await expect(account).toBeEnabled();
  await expect(account).toHaveAttribute("required", "");
  await account.selectOption("account-test");
  await page.getByLabel("Role", { exact: true }).selectOption("staff");
  await expect(account).toBeDisabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#outcome")).toHaveText(
    '{"role":"staff","account":""}',
  );
});
test("report footer has one Close and notes open directly", async ({
  page,
}) => {
  await page.goto(open("report"));
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("#outcome")).toHaveText('"closed"');
  await page.route("**/api/notes/**", (route) =>
    route.fulfill({ json: { items: [], next: null, canVerify: false } }),
  );
  await page.goto(open("notes"));
  await expect(
    page.getByRole("heading", { name: "Staff notes" }),
  ).toBeVisible();
  await expect(page.getByText("No staff notes yet.")).toBeVisible();
  await expect(page.locator(".record-notes > summary")).toHaveCount(0);
});
test("covered demand omits assignment but preserves supply context", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        orderId: "synthetic-order",
        revision: 1,
        state: "open",
        lines: [
          {
            lineId: "line",
            productId: "product",
            description: "Synthetic covered product",
            outstanding: 2,
            allocated: 2,
            incoming: 0,
            held: 0,
            uncovered: 0,
          },
        ],
        commitments: [],
        candidates: [],
      },
    }),
  );
  await page.goto(open("incoming"));
  await expect(
    page.getByText(
      "All order demand is covered. No incoming assignment is needed.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Assign incoming stock" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Synthetic covered product", { exact: true }),
  ).toBeVisible();
});
test("needs-review view retains history and explicitly page-scoped count", async ({
  page,
}) => {
  await page.route("**/api/enrollment/applications*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "pending",
            businessName: "Synthetic pending",
            status: "pending",
            createdAt: "2026-10-07T10:00:00Z",
            province: "ON",
          },
          {
            id: "activated",
            businessName: "Synthetic activated",
            status: "activated",
            createdAt: "2026-10-06T10:00:00Z",
            province: "ON",
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto(open("enrollment"));
  await expect(
    page.getByText("Synthetic pending", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic activated", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("1 need review on this page · 2 applications on this page"),
  ).toBeVisible();
  await page.getByLabel("Application view").selectOption("all");
  await expect(
    page.getByText("Synthetic activated", { exact: true }),
  ).toBeVisible();
});
test("audit exact identifiers remain accessible without invented identities", async ({
  page,
}) => {
  const actor = "12345678-1234-1234-1234-123456789abc";
  await page.route("**/api/audit/page", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "entry",
            actor_id: actor,
            reference: actor,
            action: "stock.received",
            created_at: "2026-10-07T10:00:00Z",
          },
        ],
        next: null,
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(open("audit"));
  const region = page.getByRole("region", { name: "Audit records" });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.locator("summary").first().click();
  await expect(region.getByText(actor, { exact: true }).first()).toBeVisible();
  await expect(
    region.getByText("stock · received", { exact: true }),
  ).toBeVisible();
});

test("audit shows the current authorized actor name and retains the recorded identifier", async ({
  page,
}) => {
  const actor = "87654321-1234-1234-1234-123456789abc";
  await page.route("**/api/audit/page", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "named-entry",
            actor_id: actor,
            currentActorName: "Synthetic warehouse lead",
            reference: "synthetic-reference",
            action: "stock.received",
            created_at: "2026-10-07T10:00:00Z",
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto(open("audit"));
  const region = page.getByRole("region", { name: "Audit records" });
  await expect(region.getByText("Current actor name:")).toBeVisible();
  await expect(
    region.getByText("Synthetic warehouse lead", { exact: true }),
  ).toBeVisible();
  await region.locator("summary").first().click();
  await expect(region.getByText(actor, { exact: true })).toBeVisible();
});
