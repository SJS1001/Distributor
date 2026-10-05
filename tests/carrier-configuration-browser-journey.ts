import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:3122";

test("browser: phone carrier settings review retains exact retries, blocks drift and preserves uncertain identity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
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
      stock: d.stock,
      orders: d.orders,
      shipments: d.shipments,
      invoices: d.invoices,
    };
  };
  const before = await native();
  const shipment = before.shipments.find((s: any) =>
    s.address.startsWith("Synthetic configuration destination"),
  );
  expect(shipment).toBeTruthy();
  const path = origin + `/api/shipments/${shipment.id}/carrier`;
  await navigateWorkspace(page, "Orders", "Shipments");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: shipment.id.slice(0, 8),
        exact: true,
      }),
    })
    .getByRole("button", { name: "Review carrier booking", exact: true })
    .click();
  const pane = page.getByRole("region", {
    name: "Carrier booking review",
    exact: true,
  });
  await pane
    .getByRole("combobox", { name: "Carrier provider", exact: true })
    .selectOption("usps");
  await expect(pane).toContainText("USPS EPS account ending 5678");
  await expect(pane).toContainText("Mailing date: 2026-10-01");
  await pane
    .getByRole("combobox", { name: "Service", exact: true })
    .selectOption("Reviewed ground");
  await expect(pane).toContainText("USPS_GROUND_ADVANTAGE · NONSTANDARD");
  for (const [legend, name, street] of [
    ["Reviewed warehouse origin", "Synthetic origin", "10 Test Road"],
    ["Reviewed destination", "Synthetic recipient", "20 Test Road"],
  ]) {
    const group = pane.getByRole("group", { name: legend, exact: true });
    for (const [field, value] of [
      ["Name", name],
      ["Address line 1", street],
      ["City", "Buffalo"],
      ["Province / state", "NY"],
      ["Postal / ZIP code", "14201"],
      ["Phone", "7165550100"],
    ])
      await group.getByLabel(field!, { exact: true }).fill(value!);
    await group
      .getByRole("combobox", { name: "Country", exact: true })
      .selectOption("US");
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
    .fill("Synthetic review of actual addresses and carrier settings");
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
  // Required settings review blocks preparation before the command is sent.
  await prepare.click();
  expect(attempts).toHaveLength(0);
  await pane
    .getByRole("checkbox", {
      name: "I reviewed this carrier account",
      exact: false,
    })
    .check();
  await prepare.click();
  await expect(pane.getByRole("alert")).toContainText("Failed to fetch");
  await prepare.click();
  await expect(
    pane.getByRole("heading", { name: "Current booking", exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.payload.configurationHash).toMatch(/^[a-f0-9]{64}$/);
  expect(attempts[0]!.payload.configuration).toBeUndefined();
  await page.unroute("**/api/commands/carrier.prepare");
  const reviewed = (await (await page.request.get(path)).json()).booking;
  expect(reviewed.configuration.hash).toBe(
    attempts[0]!.payload.configurationHash,
  );
  expect(await native()).toEqual(before);
  const send = pane.getByRole("button", {
    name: "Send reviewed carrier booking",
    exact: true,
  });
  await expect(send).toBeVisible();
  // Simulate a new server review response in the UI. Actual restart and pre-I/O
  // enforcement against changed clients is exercised by the backend suite.
  await page.route(path, async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.configurations = body.configurations.map((profile: any) => ({
      ...profile,
      hash: "0".repeat(64),
      details: ["Mailing date: 2026-10-02"],
    }));
    await route.fulfill({ response, json: body });
  });
  await pane
    .getByRole("button", { name: "Refresh carrier review", exact: true })
    .click();
  await expect(pane.getByRole("alert")).toContainText(
    "Current carrier settings differ",
  );
  await expect(pane).toContainText("Mailing date: 2026-10-01");
  await expect(send).toHaveCount(0);
  await expect(
    pane.getByLabel("Cancellation reason", { exact: true }),
  ).toBeVisible();
  await page.unroute(path);
  await pane
    .getByRole("button", { name: "Refresh carrier review", exact: true })
    .click();
  await expect(send).toBeVisible();
  await send.click();
  await expect(pane.getByRole("alert")).toContainText(
    "Synthetic lost USPS label response",
  );
  await pane
    .getByRole("button", { name: "Retry current carrier review", exact: true })
    .click();
  await expect(pane).toContainText("Reviewed ground · unknown");
  await expect(send).toHaveCount(0);
  await expect(
    pane.getByLabel("Cancellation reason", { exact: true }),
  ).toHaveCount(0);
  await expect(
    pane.getByRole("button", { name: "Prepare reviewed booking", exact: true }),
  ).toHaveCount(0);
  const uncertain = (await (await page.request.get(path)).json()).booking;
  expect(uncertain.id).toBe(reviewed.id);
  expect(uncertain.reviewHash).toBe(reviewed.reviewHash);
  expect(uncertain.configuration).toEqual(reviewed.configuration);
  expect(uncertain.state).toBe("unknown");
  expect(await native()).toEqual(before);
  expect(errors).toEqual([]);
});
