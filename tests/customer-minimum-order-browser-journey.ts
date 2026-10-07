import { test, expect, type Page } from "@playwright/test";
import { navigateBuyerWorkspace } from "./commerce-browser-navigation.ts";
async function login(page: Page, buyer = false) {
  await page.goto(buyer ? "/#customer-sign-in" : "/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "minimum-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toBeVisible();
}
test("individual minimums recover exact save, isolate customers and guide buyer draft/quote/submission", async ({
  page,
  browser,
}) => {
  await login(page);
  const data = await (await page.request.get("/api/dashboard")).json();
  const account = data.accounts.find((a: any) => a.name === "Synthetic buyer"),
    other = data.accounts.find((a: any) => a.name === "Other customer");
  await page.goto(`/#page=Customers&customer=${account.id}&customerTab=terms`);
  // Use the real customer tab if a deep link lands on Overview.
  const terms = page.getByRole("tab", { name: "Terms", exact: true });
  if (await terms.isVisible()) await terms.click();
  const controls = page.getByRole("region", {
    name: "Minimum order",
    exact: true,
  });
  await controls
    .getByLabel("Minimum merchandise subtotal (CAD)")
    .fill("250.001");
  await expect(controls.getByRole("alert")).toContainText(
    "at most two decimal",
  );
  await controls
    .getByLabel("Minimum merchandise subtotal (CAD)")
    .fill("250.00");
  await controls.getByLabel("Minimum equipment units").fill("2.5");
  await expect(controls.getByRole("alert")).toContainText("whole number");
  await controls.getByLabel("Minimum equipment units").fill("2");
  await controls
    .getByLabel("Reason for minimum order change")
    .fill("Synthetic customer agreement");
  const attempts: { key: string; body: string | null }[] = [];
  let lose = true;
  await page.route(
    "**/api/commands/account.minimum-order.save",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData(),
      });
      if (lose) {
        lose = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await controls
    .getByRole("button", { name: "Save minimum order", exact: true })
    .click();
  await expect(
    controls.getByRole("button", { name: "Retry saved minimum order change" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Retry saved minimum order change" })
    .click();
  await expect(
    page.getByText("Minimum order saved.", { exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  const untouched = await (
    await page.request.get(`/api/accounts/${other.id}/minimum-order`)
  ).json();
  expect(untouched.minimumSubtotal).toBe(0);
  expect(untouched.minimumEquipmentQuantity).toBe(0);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const buyer = await context.newPage();
  await login(buyer, true);
  const priorOrders = (await (await buyer.request.get("/api/dashboard")).json())
    .orders.length;
  const refused = await buyer.request.get(
    `/api/accounts/${other.id}/minimum-order`,
  );
  expect(refused.status()).toBe(403);
  await navigateBuyerWorkspace(buyer, "Account");
  const read = buyer.getByRole("region", {
    name: "Minimum order",
    exact: true,
  });
  await expect(read).toContainText("250.00");
  await expect(read).toContainText("2");
  await expect(
    read.getByRole("button", { name: "Save minimum order" }),
  ).toHaveCount(0);
  await navigateBuyerWorkspace(buyer, "Overview");
  await buyer
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await buyer
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await buyer
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("1");
  await buyer
    .getByLabel("ACC-1 · Synthetic accessory", { exact: true })
    .fill("10");
  const progress = buyer.getByRole("region", {
    name: "Order minimum progress",
  });
  await buyer
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("2.0");
  await expect(progress).toContainText("Equipment units: 2");
  await buyer
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("1");
  await expect(progress).toContainText("Equipment units: 1");
  await expect(progress).toContainText(
    "Still needed: CA$0.00 in merchandise and 1 equipment units.",
  );
  await buyer
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    buyer.getByRole("heading", {
      name: "Review and accept order",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    buyer.getByRole("region", { name: "Order minimum progress" }),
  ).toContainText("Equipment units: 1");
  await buyer
    .getByRole("button", { name: "Accept order", exact: true })
    .click();
  await expect(buyer.getByRole("dialog").getByRole("alert")).toContainText(
    "equipment",
  );
  // Draft/quote remain available, while current server policy prevents submission.
  expect(
    (await (await buyer.request.get("/api/dashboard")).json()).orders,
  ).toHaveLength(priorOrders);
  // A changed policy is loaded without discarding the saved draft or quote.
  await controls
    .getByLabel("Minimum merchandise subtotal (CAD)")
    .fill("400.00");
  await controls.getByLabel("Minimum equipment units").fill("3");
  await controls
    .getByLabel("Reason for minimum order change")
    .fill("Synthetic updated terms");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/commands/account.minimum-order.save") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    ),
    controls
      .getByRole("button", { name: "Save minimum order", exact: true })
      .click(),
  ]);
  await expect(controls.getByLabel("Minimum equipment units")).toBeEnabled();
  await expect(
    controls.getByLabel("Minimum merchandise subtotal (CAD)"),
  ).toHaveValue("400.00");
  await buyer.getByRole("button", { name: "Refresh order minimums" }).click();
  await expect(
    buyer.getByRole("region", { name: "Order minimum progress" }),
  ).toContainText(
    "Still needed: CA$100.00 in merchandise and 2 equipment units.",
  );
  await buyer
    .getByRole("button", { name: "Accept order", exact: true })
    .click();
  await expect(buyer.getByRole("dialog").getByRole("alert")).toContainText(
    "100.00",
  );
  await controls.getByLabel("Minimum merchandise subtotal (CAD)").fill("0");
  await controls.getByLabel("Minimum equipment units").fill("0");
  await controls
    .getByLabel("Reason for minimum order change")
    .fill("Synthetic removal of both minimums");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/commands/account.minimum-order.save") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    ),
    controls
      .getByRole("button", { name: "Save minimum order", exact: true })
      .click(),
  ]);
  await expect(controls.getByLabel("Minimum equipment units")).toBeEnabled();
  await expect(controls.getByLabel("Minimum equipment units")).toHaveValue("0");
  await buyer.getByRole("button", { name: "Refresh order minimums" }).click();
  await expect(
    buyer.getByRole("region", { name: "Order minimum progress" }),
  ).toContainText("Order minimums met.");
  await buyer.getByLabel("Accept any unavailable units as backorders").check();
  await buyer
    .getByRole("button", { name: "Accept order", exact: true })
    .click();
  await expect(
    buyer.getByRole("heading", {
      name: "Review and accept order",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (await (await buyer.request.get("/api/dashboard")).json()).orders,
  ).toHaveLength(priorOrders + 1);
  await context.close();
});
