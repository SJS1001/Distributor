import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3128";
async function signIn(page: Page, email: string) {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
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
test("browser: independent count review on a phone retains lost-response policy and decision receipts", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "admin@example.test");
  const stock = page.getByRole("row").filter({ hasText: "COUNT-DUTIES-UI" });
  await stock.getByRole("button", { name: "Start count", exact: true }).click();
  let dialog = page.getByRole("dialog", {
    name: "Start stock count",
    exact: true,
  });
  await dialog
    .getByLabel("Count reference (unique)", { exact: true })
    .fill("PHONE-INDEPENDENT-COUNT");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const count = page
    .getByRole("row")
    .filter({ hasText: "PHONE-INDEPENDENT-COUNT" });
  await count
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Record count observation",
    exact: true,
  });
  await dialog.getByLabel("Physical units observed", { exact: true }).fill("4");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic phone observation: four physical units");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(count).toContainText("-2 units");
  await expect(
    count.getByRole("button", { name: "Approve count", exact: true }),
  ).toBeVisible();
  const requests: { key: string; payload: unknown }[] = [];
  let receipt: unknown;
  await page.route("**/api/commands/count.policy", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (requests.length === 1) {
      receipt = await response.json();
      await route.abort("failed");
    } else {
      expect(await response.json()).toEqual(receipt);
      await route.fulfill({ response });
    }
  });
  await page
    .getByRole("button", { name: "Configure count review", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Configure count review policy",
    exact: true,
  });
  await expect(dialog).toContainText(
    "other than the count starter and observer",
  );
  await dialog
    .getByLabel("Approval duties", { exact: true })
    .selectOption("independent");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic independent count review policy");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(
    count.getByRole("button", { name: "Approve count", exact: true }),
  ).toHaveCount(0);
  await expect(count).toContainText("A different administrator must review");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const reviewer = await context.newPage();
    reviewer.on("pageerror", (e) => errors.push(e.message));
    await signIn(reviewer, "count-reviewer@example.test");
    const review = reviewer
      .getByRole("row")
      .filter({ hasText: "PHONE-INDEPENDENT-COUNT" });
    await review
      .getByRole("button", { name: "Approve count", exact: true })
      .click();
    const approval = reviewer.getByRole("dialog", {
      name: "Approve stock correction",
      exact: true,
    });
    await expect(approval).toContainText("-2 units");
    await approval
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic independent physical evidence review");
    const attempts: { key: string; payload: any }[] = [];
    let decision: any;
    await reviewer.route("**/api/commands/count.decide", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        payload: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (attempts.length === 1) {
        decision = await response.json();
        await route.abort("failed");
      } else {
        expect(await response.json()).toEqual(decision);
        await route.fulfill({ response });
      }
    });
    await approval
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(approval.getByRole("alert")).toBeVisible();
    await approval
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(approval).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]!.payload.policyRevision).toBe(2);
    expect(decision.adjustment).toMatchObject({
      quantity: 4,
      delta: -2,
      valueDelta: -250,
    });
    expect(decision.reviewPolicy).toMatchObject({
      mode: "independent",
      revision: 2,
    });
    await expect(review).toContainText(
      "Reviewed under independent policy version 2",
    );
    const dashboard = await (
      await reviewer.request.get(`${origin}/api/dashboard`)
    ).json();
    const product = dashboard.products.find(
      (p: any) => p.sku === "COUNT-DUTIES-UI",
    );
    expect(
      dashboard.stock.find((u: any) => u.product_id === product.id).quantity,
    ).toBe(4);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(count).toContainText(
      "Reviewed under independent policy version 2",
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
