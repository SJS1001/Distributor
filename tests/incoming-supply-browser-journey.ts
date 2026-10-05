import { test, expect } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

test("incoming assignment survives a lost reply and reload without duplicate demand, then releases units", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await navigateWorkspace(page, "Purchasing", "Incoming allocations");
  await page
    .getByLabel("Open orders", { exact: true })
    .getByRole("button")
    .first()
    .click();
  const region = page.getByRole("region", {
    name: "Incoming stock for this order",
    exact: true,
  });
  await region
    .getByLabel("Order product", { exact: true })
    .selectOption({ index: 1 });
  await region
    .getByLabel("Incoming purchase line", { exact: true })
    .selectOption({ index: 1 });
  await region.getByLabel("Units to assign", { exact: true }).fill("2");
  await region
    .getByLabel("Assignment reason", { exact: true })
    .fill("Customer delivery priority");
  await region
    .getByRole("button", { name: "Review assignment", exact: true })
    .click();
  const keys: string[] = [];
  const payloads: string[] = [];
  await page.route("**/api/commands/order.incoming.commit", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    payloads.push(route.request().postData()!);
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    } else if (keys.length === 2) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "FORBIDDEN",
          message: "Authority temporarily unavailable",
        }),
      });
    } else await route.continue();
  });
  await region
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    region.getByRole("button", { name: "Retry exact saved attempt" }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByLabel("Open orders", { exact: true })
    .getByRole("button")
    .first()
    .click();
  await region
    .getByRole("button", { name: "Retry exact saved attempt" })
    .click();
  await expect(region.getByRole("alert")).toContainText(
    "Authority temporarily unavailable",
  );
  await page.reload();
  await page
    .getByLabel("Open orders", { exact: true })
    .getByRole("button")
    .first()
    .click();
  await region
    .getByRole("button", { name: "Retry exact saved attempt" })
    .click();
  await expect(
    region.getByText("Incoming-stock assignment updated.", { exact: false }),
  ).toBeVisible();
  expect(keys).toHaveLength(3);
  expect(keys[1]).toBe(keys[0]);
  expect(payloads[1]).toBe(payloads[0]);
  expect(keys[2]).toBe(keys[0]);
  expect(payloads[2]).toBe(payloads[0]);
  const history = region.getByRole("table", {
    name: "Incoming assignments and history",
  });
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.locator("tbody tr td").nth(1)).toHaveText("2");
  await region
    .getByLabel("Assignment", { exact: true })
    .selectOption({ index: 1 });
  await region.getByLabel("Units to release", { exact: true }).fill("1");
  await region
    .getByLabel("Change reason", { exact: true })
    .fill("Customer reduced priority demand");
  await region
    .getByRole("button", { name: "Review change", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(history.locator("tbody tr td").nth(1)).toHaveText("1");
  await expect(history.locator("tbody tr td").nth(4)).toHaveText("1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
