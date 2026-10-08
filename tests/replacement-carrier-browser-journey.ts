import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { replacementLabel } from "./replacement-carrier-fixture.ts";
const origin = "http://127.0.0.1:3133";

test("browser: phone replacement carrier preparation, private label and exact dispatch preserve original billing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const native = async () => {
    const d = await (await page.request.get(origin + "/api/dashboard")).json();
    return {
      orders: d.orders,
      shipments: d.shipments,
      invoices: d.invoices,
      stock: d.stock,
    };
  };
  const before = await native();
  await navigateWorkspace(page, "Returns", "Replacements");
  const history = page.getByRole("region", {
    name: "Replacement history",
    exact: true,
  });
  const row = history.getByRole("row").filter({ hasText: "S1 → S2" });
  await row
    .getByRole("button", {
      name: "Review replacement carrier booking",
      exact: true,
    })
    .click();
  const pane = page.getByRole("region", {
    name: "Carrier booking review",
    exact: true,
  });
  const address = "Synthetic recipient\n2 Test Street\nToronto ON M5V 1A1, CA";
  await pane
    .getByLabel("Reviewed replacement delivery address", { exact: true })
    .fill(address);
  await pane
    .getByRole("combobox", { name: "Carrier provider", exact: true })
    .selectOption("ups");
  await pane.getByLabel("Service", { exact: true }).fill("Synthetic ground");
  for (const [legend, name, street] of [
    ["Reviewed warehouse origin", "Synthetic origin", "1 Test Street"],
    ["Reviewed destination", "Synthetic recipient", "2 Test Street"],
  ]) {
    const group = pane.getByRole("group", { name: legend!, exact: true });
    for (const [field, value] of [
      ["Name", name],
      ["Address line 1", street],
      ["City", "Toronto"],
      ["Province / state", "ON"],
      ["Postal / ZIP code", "M5V 1A1"],
      ["Phone", "4165550100"],
    ])
      await group.getByLabel(field!, { exact: true }).fill(value!);
    await group
      .getByRole("combobox", { name: "Country", exact: true })
      .selectOption("CA");
  }
  for (const field of [
    "Weight (grams)",
    "Length (mm)",
    "Width (mm)",
    "Height (mm)",
  ])
    await pane.getByLabel(field, { exact: true }).fill("100");
  await pane
    .getByLabel("Address review acknowledgment / evidence", { exact: true })
    .fill("Synthetic reviewed delivery, custody and parcel");
  await pane
    .getByRole("checkbox", {
      name: "I reviewed the entered structured destination",
      exact: false,
    })
    .check();
  const attempts: { key: string; payload: any }[] = [];
  await page.route("**/api/commands/carrier.prepare", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  const prepare = pane.getByRole("button", {
    name: "Prepare reviewed booking",
    exact: true,
  });
  await prepare.click();
  await expect(pane.getByRole("alert")).toContainText(
    /Failed to fetch|Load failed/,
  );
  await prepare.click();
  await expect(
    pane.getByRole("heading", { name: "Current booking", exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.payload.replacementId).toBe(
    attempts[0]!.payload.shipmentId,
  );
  expect(attempts[0]!.payload.reviewedDestination).toBe(address);
  await page.unroute("**/api/commands/carrier.prepare");
  expect(await native()).toEqual(before);
  await pane
    .getByRole("button", { name: "Send reviewed carrier booking", exact: true })
    .click();
  await expect(
    pane.getByRole("link", { name: "Download carrier label", exact: true }),
  ).toBeVisible();
  await expect(pane).toContainText("SYN-REPLACEMENT-TRACKING");
  await expect(pane).toContainText("Dispatch recipient: Synthetic recipient");
  const downloaded = page.waitForEvent("download");
  await pane
    .getByRole("link", { name: "Download carrier label", exact: true })
    .click();
  const download = await downloaded;
  expect(await readFile((await download.path())!)).toEqual(replacementLabel);
  await pane
    .getByRole("button", { name: "Load carrier booking history", exact: true })
    .click();
  await expect(pane).toContainText("Loaded: 1");
  expect(await native()).toEqual(before);
  await pane
    .getByRole("button", { name: "Close carrier booking review", exact: true })
    .click();
  await expect(
    row.getByRole("button", {
      name: "Review replacement carrier booking",
      exact: true,
    }),
  ).toBeFocused();
  await row
    .getByRole("button", { name: "Dispatch replacement", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const [field, value] of [
    ["Scan replacement serial", "S2"],
    ["Delivery recipient", "Synthetic recipient"],
    ["Delivery address", address],
    ["Carrier name", "ups"],
    ["Carrier tracking reference", "WRONG-TRACKING"],
    ["Carrier handover evidence", "Synthetic physical handover"],
  ])
    await dialog.getByLabel(field!, { exact: true }).fill(value!);
  await dialog
    .getByRole("button", { name: "Record dispatch", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "exact booked carrier/tracking",
  );
  expect(await native()).toEqual(before);
  await dialog
    .getByLabel("Carrier tracking reference", { exact: true })
    .fill("SYN-REPLACEMENT-TRACKING");
  await dialog
    .getByRole("button", { name: "Record dispatch", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("handed_over");
  const after = await native();
  expect({
    orders: after.orders,
    shipments: after.shipments,
    invoices: after.invoices,
  }).toEqual({
    orders: before.orders,
    shipments: before.shipments,
    invoices: before.invoices,
  });
  await row
    .getByRole("button", {
      name: "Review replacement carrier booking",
      exact: true,
    })
    .click();
  await expect(
    pane.getByRole("link", { name: "Download carrier label", exact: true }),
  ).toBeVisible();
  await expect(
    pane.getByRole("button", { name: "Prepare reviewed booking", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
