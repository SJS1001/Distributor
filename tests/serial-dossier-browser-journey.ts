import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3146";
const dossier = (page: Page) =>
  page.getByRole("region", { name: "Serial dossier", exact: true });
const section = (page: Page, name: string) =>
  dossier(page).getByRole("region", { name, exact: true });
const history = (page: Page) =>
  page.getByRole("region", { name: "Stock movement history", exact: true });
async function signIn(page: Page) {
  await page.goto(origin + "/#sign-in");
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
  await navigateWorkspace(page, "Inventory", "Stock");
}
async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Find serial", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Serial history",
    exact: true,
  });
  await dialog.getByLabel("Scan or enter serial", { exact: true }).fill("S1");
  await dialog
    .getByRole("button", { name: "Find movement history", exact: true })
    .click();
  await expect(history(page)).toContainText("Serial S1");
}
test("browser: serial dossier preserves independent history pages and exact failed retries on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  const before = await (
    await page.request.get(`${origin}/api/serials/dossier?serial=S1`)
  ).json();
  await openHistory(page);
  await history(page)
    .getByRole("button", { name: "Review serial dossier", exact: true })
    .click();
  await expect(
    dossier(page).getByRole("heading", { name: "Serial dossier", exact: true }),
  ).toBeFocused();
  await expect(section(page, "Original receipt")).toContainText("DEL-1");
  await expect(dossier(page)).toContainText("Toronto / DOSSIER");
  await expect(
    section(page, "Sales and invoices").getByRole("listitem"),
  ).toHaveCount(20);
  await expect(
    section(page, "Sales and invoices").getByRole("listitem").first(),
  ).toContainText("Whole invoice total CA$113.00 CAD");
  await expect(
    section(page, "Claims and replacements").getByRole("listitem"),
  ).toHaveCount(20);
  await expect(
    section(page, "Claims and replacements").getByRole("listitem").first(),
  ).toContainText("Synthetic dossier return 22");
  await expect(
    section(page, "Stock movements").getByRole("listitem"),
  ).toHaveCount(20);
  const attempts: string[] = [];
  await page.route("**/api/serials/dossier?**", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("claimAfter"))
      return route.continue();
    attempts.push(route.request().url());
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic dossier unavailable" }),
      });
    await route.continue();
  });
  await dossier(page)
    .getByRole("button", { name: "Older claims", exact: true })
    .click();
  await expect(dossier(page).getByRole("alert")).toContainText(
    "Synthetic dossier unavailable",
  );
  await expect(dossier(page).getByRole("listitem")).toHaveCount(0);
  await expect(dossier(page)).not.toContainText("DEL-1");
  await dossier(page)
    .getByRole("button", { name: "Retry serial dossier", exact: true })
    .click();
  await expect(
    section(page, "Claims and replacements").getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    section(page, "Claims and replacements").getByRole("listitem").first(),
  ).toContainText("Synthetic dossier return 2");
  await expect(
    section(page, "Sales and invoices").getByRole("listitem"),
  ).toHaveCount(20);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await dossier(page)
    .getByRole("button", { name: "Older sales", exact: true })
    .click();
  await expect(
    section(page, "Sales and invoices").getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    section(page, "Claims and replacements").getByRole("listitem"),
  ).toHaveCount(2);
  await dossier(page)
    .getByRole("button", { name: "Older movements", exact: true })
    .click();
  await expect(
    section(page, "Stock movements").getByRole("listitem").first(),
  ).not.toContainText(before.movements.items[0].id);
  await expect(
    section(page, "Sales and invoices").getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    section(page, "Claims and replacements").getByRole("listitem"),
  ).toHaveCount(2);
  const lastRead = new URL(attempts.at(-1)!);
  expect(lastRead.searchParams.has("shipmentAfter")).toBe(true);
  expect(lastRead.searchParams.has("movementAfter")).toBe(true);
  for (const expectedSales of [2, 20, 20]) {
    await dossier(page)
      .getByRole("button", { name: "Previous dossier page", exact: true })
      .click();
    await expect(
      section(page, "Sales and invoices").getByRole("listitem"),
    ).toHaveCount(expectedSales);
  }
  await expect(
    section(page, "Claims and replacements").getByRole("listitem"),
  ).toHaveCount(20);
  await expect(
    section(page, "Stock movements").getByRole("listitem").first(),
  ).toContainText(before.movements.items[0].id);
  await dossier(page)
    .getByRole("button", { name: "Refresh serial dossier", exact: true })
    .click();
  await expect(section(page, "Original receipt")).toContainText("DEL-1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dossier(page)
    .getByRole("button", { name: "Back to movements", exact: true })
    .click();
  await expect(
    history(page).getByRole("heading", {
      name: "Stock movement history",
      exact: true,
    }),
  ).toBeFocused();
  await history(page)
    .getByRole("button", { name: "Close stock history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Find serial", exact: true }),
  ).toBeFocused();
  const after = await (
    await page.request.get(`${origin}/api/serials/dossier?serial=S1`)
  ).json();
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});
test("browser: serial dossier discards abandoned reads on back, close, navigation and sign-out", async ({
  page,
}) => {
  await signIn(page);
  for (const action of ["back", "close", "navigate", "signout"] as const) {
    await openHistory(page);
    let started!: () => void, release!: () => void;
    const reading = new Promise<void>((r) => (started = r)),
      held = new Promise<void>((r) => (release = r));
    await page.route("**/api/serials/dossier?**", async (route) => {
      const native = await route.fetch();
      started();
      await held;
      await route.fulfill({ response: native }).catch(() => {});
    });
    await history(page)
      .getByRole("button", { name: "Review serial dossier", exact: true })
      .click();
    await reading;
    if (action === "back")
      await dossier(page)
        .getByRole("button", { name: "Back to movements", exact: true })
        .click();
    else if (action === "close")
      await dossier(page)
        .getByRole("button", { name: "Close serial dossier", exact: true })
        .click();
    else if (action === "navigate") await navigateWorkspace(page, "Overview");
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(dossier(page)).toHaveCount(0);
    if (action === "back") {
      await expect(history(page)).toContainText("Serial S1");
      await history(page)
        .getByRole("button", { name: "Close stock history", exact: true })
        .click();
    }
    if (action === "navigate")
      await navigateWorkspace(page, "Inventory", "Stock");
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("browser: serial dossier keeps the latest refresh when a superseded read arrives late", async ({
  page,
}) => {
  await signIn(page);
  await openHistory(page);
  let started!: () => void, release!: () => void;
  const reading = new Promise<void>((r) => (started = r)),
    held = new Promise<void>((r) => (release = r));
  let reads = 0;
  await page.route("**/api/serials/dossier?**", async (route) => {
    if (++reads !== 1) return route.continue();
    const native = await route.fetch();
    const body = await native.json();
    body.receipt.deliveryReference = "Synthetic superseded receipt";
    started();
    await held;
    await route.fulfill({ response: native, json: body }).catch(() => {});
  });
  await history(page)
    .getByRole("button", { name: "Review serial dossier", exact: true })
    .click();
  await reading;
  await dossier(page)
    .getByRole("button", { name: "Refresh serial dossier", exact: true })
    .click();
  await expect(section(page, "Original receipt")).toContainText("DEL-1");
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(section(page, "Original receipt")).toContainText("DEL-1");
  await expect(dossier(page)).not.toContainText("Synthetic superseded receipt");
  await expect(dossier(page).getByRole("alert")).toHaveCount(0);
});
