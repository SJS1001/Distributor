import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function login(page: Page, email = "admin@example.test") {
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    email.startsWith("notes-buyer") ? "Shop" : "Overview",
  );
}
async function notes(page: Page) {
  await navigateWorkspace(page, "Customers");
  await page
    .locator("summary")
    .filter({ hasText: /^Staff notes$/ })
    .first()
    .click();
  await expect(page.getByLabel("New staff note").first()).toBeEnabled();
}
test("private append-only notes recover exact attempts and show independent authenticated verification", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await notes(page);
  const text =
    "Synthetic private customer observation\nCorrection is a new note.";
  await page.getByLabel("New staff note").fill(text);
  let body: string | null = null,
    key: string | undefined,
    done!: () => void;
  const committed = new Promise<void>((resolve) => {
    done = resolve;
  });
  await page.route("**/api/commands/notes.add", async (route) => {
    body = route.request().postData();
    key = route.request().headers()["idempotency-key"];
    await route.fetch();
    await route.abort();
    done();
  });
  await page
    .getByRole("button", { name: "Add staff note", exact: true })
    .click();
  await committed;
  await page.unroute("**/api/commands/notes.add");
  await page.reload();
  await page
    .locator("summary")
    .filter({ hasText: /^Staff notes$/ })
    .first()
    .click();
  await expect(page.getByLabel("New staff note")).toBeDisabled();
  await page.route("**/api/commands/notes.add", async (route) => {
    expect(route.request().postData()).toBe(body);
    expect(route.request().headers()["idempotency-key"]).toBe(key);
    await route.continue();
  });
  await page.getByRole("button", { name: "Retry saved note attempt" }).click();
  await expect(
    page.getByText("Staff note added.", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/commands/notes.add");
  await expect(page.locator(".record-note-list li")).toHaveCount(1);
  await expect(page.getByText("Unverified", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify this note" }),
  ).toHaveCount(0);
  await expect(page.locator(".record-note-list time")).toHaveAttribute(
    "datetime",
    /\d{4}-\d{2}-\d{2}T/,
  );
  const verifier = await browser.newPage();
  await login(verifier, "verifier@example.test");
  await notes(verifier);
  await verifier.getByRole("button", { name: "Verify this note" }).click();
  await expect(
    verifier.getByText(/Verified by Independent approver/),
  ).toBeVisible();
  await expect(verifier.locator(".record-note-list time")).toHaveCount(2);
  await page.reload();
  await page
    .locator("summary")
    .filter({ hasText: /^Staff notes$/ })
    .first()
    .click();
  await expect(
    page.getByText(/Verified by Independent approver/),
  ).toBeVisible();
  await page
    .getByLabel("New staff note")
    .fill("Synthetic correction preserving the original observation.");
  await page
    .getByRole("button", { name: "Add staff note", exact: true })
    .click();
  await expect(page.locator(".record-note-list li")).toHaveCount(2);
  await expect(
    page
      .locator(".record-note-body")
      .filter({ hasText: "Synthetic private customer observation" }),
  ).toHaveCount(1);
  await navigateWorkspace(page, "Catalog");
  await page.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await page.getByRole("tab", { name: "Staff notes", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^Staff notes$/ })
    .last()
    .click();
  await expect(page.getByLabel("New staff note").last()).toBeEnabled();
  await page
    .getByLabel("New staff note")
    .last()
    .fill("Synthetic product staff context.");
  await page
    .getByRole("button", { name: "Add staff note", exact: true })
    .last()
    .click();
  await expect(
    page
      .locator(".record-note-list .record-note-body")
      .filter({ hasText: /^Synthetic product staff context\.$/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Product breadcrumbs" })
    .getByRole("button", { name: "Catalog", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Manage EQ-1", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const [workspace, tab, text] of [
    ["Orders", "Orders", "Synthetic order context."],
    ["Orders", "Shipments", "Synthetic shipment context."],
    ["Billing", "Invoices", "Synthetic invoice context."],
  ] as const) {
    await navigateWorkspace(page, workspace);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    // Each queue is bounded and its notes are fetched only when expanded.
    const visibleNotes = page
      .locator(".record-notes")
      .filter({ visible: true })
      .first();
    await visibleNotes.locator("summary").click();
    await expect(visibleNotes.getByLabel("New staff note")).toBeEnabled();
    await visibleNotes.getByLabel("New staff note").fill(text);
    await visibleNotes
      .getByRole("button", { name: "Add staff note", exact: true })
      .click();
    await expect(
      visibleNotes.locator(".record-note-list .record-note-body"),
    ).toHaveText(text);
  }
  const buyer = await browser.newPage();
  await login(buyer, "notes-buyer@example.test");
  await buyer
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await expect(
    buyer.locator("summary").filter({ hasText: /^Staff notes$/ }),
  ).toHaveCount(0);
  await expect(
    buyer.getByText("Synthetic private customer observation", { exact: false }),
  ).toHaveCount(0);
  const target = JSON.parse(body!).recordId;
  expect(
    await buyer.evaluate(
      async (id) => (await fetch(`/api/notes/customer/${id}`)).status,
      target,
    ),
  ).toBe(403);
  expect(errors).toEqual([]);
  await buyer.close();
  await verifier.close();
});
