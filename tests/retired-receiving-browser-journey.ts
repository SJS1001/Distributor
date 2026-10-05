import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:3147";

test("browser: retired customer product receives saved and new delivery scans at original cost with lost-response recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("receiving@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const nav = (section: string) =>
    navigateWorkspace(page, "Purchasing", section);
  await nav("Purchase orders");
  const initial = await (
    await page.request.get(origin + "/api/purchases")
  ).json();
  const initialPo = initial.orders.find((p: any) =>
    p.lines.some((l: any) => l.unit_cost === 4321),
  );
  const initialRow = page
    .getByRole("row")
    .filter({ has: page.getByTitle(initialPo.id, { exact: true }) });
  await expect(initialRow).toContainText("RETIRED-DELIVERY");
  await expect(initialRow).toContainText(
    "Synthetic customer-retired equipment",
  );
  await expect(initialRow).toContainText("retired from customer ordering");
  const draft = (reference: string) =>
    page
      .getByRole("table")
      .filter({
        has: page.getByRole("columnheader", {
          name: "Warehouse / SKU",
          exact: true,
        }),
      })
      .getByRole("row")
      .filter({ has: page.getByText(reference, { exact: true }) });
  await nav("Receipt drafts");
  const first = draft("RETIRED-PART-1");
  await first
    .getByRole("button", { name: "Resume scans", exact: true })
    .click();
  await page
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill("RETIRED-B1");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first).toContainText("draft · v2");
  await page.reload();
  await nav("Receipt drafts");
  const attempts: { key: string; payload: unknown }[] = [];
  await page.route("**/api/commands/purchase.draft.confirm", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    if (attempts.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await first
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute("**/api/commands/purchase.draft.confirm");
  await expect(first).toContainText("received · v3");
  const purchases = await (
    await page.request.get(origin + "/api/purchases")
  ).json();
  const po = purchases.orders.find((p: any) =>
    p.lines.some((l: any) => l.unit_cost === 4321),
  );
  expect(po.lines[0].received).toBe(1);
  const poRow = page
    .getByRole("row")
    .filter({ has: page.getByTitle(po.id, { exact: true }) });
  await nav("Purchase orders");
  await poRow
    .getByRole("button", { name: "Start receipt draft", exact: true })
    .click();
  const lineChoice = page.getByLabel("Purchase line", { exact: true });
  await expect(lineChoice.locator("option:checked")).toContainText(
    "RETIRED-DELIVERY",
  );
  await expect(lineChoice.locator("option:checked")).toContainText(
    "Synthetic customer-retired equipment",
  );
  await expect(lineChoice.locator("option:checked")).toContainText(
    "retired from customer ordering",
  );
  await expect(lineChoice.locator("option:checked")).toContainText(
    "1 remaining",
  );
  await page
    .getByLabel("Supplier delivery reference", { exact: true })
    .fill("RETIRED-PART-2");
  await page
    .getByLabel("Observed SKU on delivery", { exact: true })
    .fill("WRONG");
  await page
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill("RETIRED-B2");
  await page.getByLabel("Receiving bin", { exact: true }).fill("RETIRED-R");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Observed SKU",
  );
  await page
    .getByLabel("Observed SKU on delivery", { exact: true })
    .fill("RETIRED-DELIVERY");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("Receipt drafts");
  const second = draft("RETIRED-PART-2");
  await second
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(second).toContainText("received · v2");
  const detail = await (
    await page.request.get(origin + "/api/purchases/orders/" + po.id)
  ).json();
  expect(detail.state).toBe("received");
  expect(detail.lines[0].received).toBe(2);
  for (const serial of ["RETIRED-B1", "RETIRED-B2"]) {
    const trace = await (
      await page.request.get(origin + "/api/serials/" + serial)
    ).json();
    expect(trace.unit.cost).toBe(4321);
    expect(trace.unit.quantity).toBe(1);
    expect(trace.unit.condition).toBe("quarantine");
    expect(
      trace.movements.filter((m: any) => m.type === "receipt"),
    ).toHaveLength(1);
  }
  const catalog = await (
    await page.request.get(
      origin + "/api/catalog/products/page?state=retired&q=RETIRED-DELIVERY",
    )
  ).json();
  expect(catalog.items).toHaveLength(1);
  expect(catalog.items[0].active).toBe(0);
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  expect(errors).toEqual([]);
});
