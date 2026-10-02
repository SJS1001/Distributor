import { test, expect, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:3144";
async function signIn(page: Page, email: string) {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await reply).json()).csrf as string;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
  return csrf;
}
const dialog = (page: Page) =>
  page.getByRole("dialog", {
    name: "Move stock within warehouse",
    exact: true,
  });
async function fill(
  page: Page,
  source: string,
  destination: string,
  serial?: string,
) {
  const d = dialog(page);
  await d.getByLabel("Confirm current bin", { exact: true }).fill(source);
  await d
    .getByLabel("Destination bin in this warehouse", { exact: true })
    .fill(destination);
  if (serial)
    await d.getByLabel("Scan stock serial", { exact: true }).fill(serial);
  await d
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic physically checked bin move");
}
async function stock(page: Page) {
  const response = await page.request.get(`${origin}/api/dashboard`);
  expect(response.status()).toBe(200);
  return (await response.json()).stock as Record<string, any>[];
}
test("browser: phone bin relocation refuses wrong serial then recovers an identical lost reply once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "warehouse@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S1")!;
  const row = page.getByRole("row").filter({ hasText: "S1 · stock" });
  const opener = row.getByRole("button", { name: "Move to bin", exact: true });
  await opener.click();
  await fill(page, "A-1", "RACK-PHONE", "S2");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("SERIAL");
  expect((await stock(page)).find((u) => u.id === before.id)).toEqual(before);
  await dialog(page)
    .getByLabel("Scan stock serial", { exact: true })
    .fill("S1");
  const attempts: { key: string; payload: unknown }[] = [];
  let result: any;
  await page.route("**/api/commands/stock.relocate", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const native = await route.fetch();
    expect(native.status()).toBe(200);
    const body = await native.json();
    if (attempts.length === 1) {
      result = body;
      await route.abort("failed");
    } else {
      expect(body).toEqual(result);
      await route.fulfill({ response: native });
    }
  });
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.key).toBeTruthy();
  const after = (await stock(page)).find((u) => u.id === before.id)!;
  expect(after).toEqual({
    ...before,
    bin: "RACK-PHONE",
    revision: before.revision + 1,
  });
  await expect(row).toContainText("Toronto / RACK-PHONE");
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("browser: bin review rejects changed stock, cancellation conserves facts and quarantine lots move intact", async ({
  page,
}) => {
  const csrf = await signIn(page, "admin@example.test");
  const before = (await stock(page)).find((u) => u.serial === "S2")!;
  const row = page.getByRole("row").filter({ hasText: "S2 · stock" });
  await row.getByRole("button", { name: "Move to bin", exact: true }).click();
  await fill(page, "A-1", "STALE-BIN", "S2");
  const response = await page.request.post(
    `${origin}/api/commands/stock.inspect`,
    {
      headers: {
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": "bin-stale-inspection",
      },
      data: {
        unitId: before.id,
        revision: before.revision,
        condition: "quarantine",
        reason: "Synthetic concurrent inspection",
      },
    },
  );
  expect(response.status()).toBe(200);
  const changed = (await stock(page)).find((u) => u.id === before.id);
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("REVISION");
  expect((await stock(page)).find((u) => u.id === before.id)).toEqual(changed);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const lot = (await stock(page)).find((u) => u.serial === null)!;
  const bulkRow = page.getByRole("row").filter({ hasText: "BIN-MOVE-BULK" });
  const move = bulkRow.getByRole("button", {
    name: "Move to bin",
    exact: true,
  });
  await move.click();
  await expect(dialog(page)).toContainText("Move all 6 units");
  await expect(
    dialog(page).getByLabel("Scan stock serial", { exact: true }),
  ).toHaveCount(0);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(move).toBeFocused();
  expect((await stock(page)).find((u) => u.id === lot.id)).toEqual(lot);
  await move.click();
  await fill(page, "RECEIVING", "QUARANTINE-PHONE");
  await dialog(page)
    .getByRole("button", { name: "Confirm bin move", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await stock(page)).find((u) => u.id === lot.id)).toEqual({
    ...lot,
    bin: "QUARANTINE-PHONE",
    revision: lot.revision + 1,
  });
  await expect(bulkRow).toContainText("quarantine");
  await expect(bulkRow).toContainText("6 / 0 / 0");
});
