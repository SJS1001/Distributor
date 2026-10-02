import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3145";
async function signIn(page: Page) {
  await page.goto(origin);
  await page
    .getByLabel("Email", { exact: true })
    .fill("warehouse@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Stock movement history", exact: true });
const openBulk = (page: Page) =>
  page
    .getByRole("row")
    .filter({ hasText: "HISTORY-BULK" })
    .getByRole("button", { name: "Movement history", exact: true });
test("browser: phone bulk history bounds original-cost pages, retries the same failed cursor and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  const before = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  await openBulk(page).click();
  await expect(
    panel(page).getByRole("heading", {
      name: "Stock movement history",
      exact: true,
    }),
  ).toBeFocused();
  await expect(panel(page)).toContainText("Bulk lot");
  await expect(panel(page)).toContainText("Toronto / HISTORY-25");
  await expect(panel(page).getByRole("listitem")).toHaveCount(20);
  await expect(panel(page).getByRole("listitem").first()).toContainText(
    "Synthetic putaway 25",
  );
  await expect(panel(page)).toContainText("$1.25");
  const attempts: string[] = [];
  await page.route("**/api/stock/history?**", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("after"))
      return route.continue();
    attempts.push(route.request().url());
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic history unavailable" }),
      });
    await route.continue();
  });
  await panel(page)
    .getByRole("button", { name: "Older movements", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic history unavailable",
  );
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
  await expect(panel(page)).not.toContainText("Toronto / HISTORY-25");
  await panel(page)
    .getByRole("button", { name: "Retry movement history", exact: true })
    .click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(6);
  await expect(panel(page).getByRole("listitem").last()).toContainText(
    "receipt",
  );
  await expect(panel(page).getByRole("listitem").last()).toContainText(
    "6 units",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel(page)
    .getByRole("button", { name: "Newer movements", exact: true })
    .click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(20);
  await panel(page)
    .getByRole("button", { name: "Close stock history", exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await expect(openBulk(page)).toBeFocused();
  const after = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(after.stock).toEqual(before.stock);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("browser: exact serial history clears abandoned reads during navigation and sign-out", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Find serial", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Serial history",
    exact: true,
  });
  await dialog.getByLabel("Scan or enter serial", { exact: true }).fill("S1");
  await dialog
    .getByRole("button", { name: "Find movement history", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page)).toContainText("Serial S1");
  await expect(panel(page).getByRole("listitem")).toHaveCount(1);
  await panel(page)
    .getByRole("button", { name: "Close stock history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Find serial", exact: true }),
  ).toBeFocused();
  for (const action of ["close", "navigate", "signout"] as const) {
    let started!: () => void, release!: () => void;
    const reading = new Promise<void>((r) => (started = r)),
      held = new Promise<void>((r) => (release = r));
    await page.route("**/api/stock/history?**", async (route) => {
      const native = await route.fetch();
      started();
      await held;
      await route.fulfill({ response: native }).catch(() => {});
    });
    await openBulk(page).click();
    await reading;
    if (action === "close")
      await panel(page)
        .getByRole("button", { name: "Close stock history", exact: true })
        .click();
    else if (action === "navigate")
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Overview", exact: true })
        .click();
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(panel(page)).toHaveCount(0);
    if (action === "navigate")
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Inventory", exact: true })
        .click();
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
