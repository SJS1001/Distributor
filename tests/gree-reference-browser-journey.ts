import { test, expect } from "@playwright/test";
import catalog from "../src/web/gree-catalog-data.json" with { type: "json" };
import { navigateWorkspace } from "./workspace-navigation.ts";
const family = catalog.products.find((p) => p.models.length > 1)!;
const model = family.models[1]!;
async function credentials(page: any, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("exact reference survives application and login, explicit admin mapping enables authoritative purchasing", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#product=${family.id}`);
  await page.getByLabel("Model configuration").selectOption(model.id);
  await page
    .getByRole("link", { name: "Apply for a trade account →", exact: true })
    .click();
  await expect(
    page.getByText(`Requested equipment: ${family.title} · ${model.title}.`, {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Synthetic reference applicant");
  await page.getByLabel("Contact name", { exact: true }).fill("Fixture Person");
  await page
    .getByLabel("Business email", { exact: true })
    .fill("gree-inquiry@example.test");
  await page.getByLabel("Phone", { exact: true }).fill("4165550101");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
  const submitted = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/enrollment/applications") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Submit application" }).click();
  expect((await submitted).postDataJSON().requestedReference).toEqual({
    familyId: family.id,
    modelId: model.id,
  });
  await expect(
    page.getByRole("heading", { name: "Application received." }),
  ).toBeVisible();
  const admin = await browser.newPage();
  await admin.goto("/#admin-sign-in");
  await credentials(admin, "admin@example.test");
  await navigateWorkspace(admin, "Catalog");
  await admin.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await admin
    .getByRole("tab", { name: "Reference mapping", exact: true })
    .click();
  await admin.getByLabel("Manufacturer product family").selectOption(family.id);
  await admin.getByLabel("Exact manufacturer model").selectOption(model.id);
  await admin
    .getByLabel("Reason for reference mapping")
    .fill(
      "Synthetic test mapping explicitly reviewed; not a real equipment equivalence",
    );
  let reviewedPayload: string | null = null,
    reviewedKey: string | undefined;
  await admin.route("**/api/commands/catalog.reference.set", async (route) => {
    reviewedPayload = route.request().postData();
    reviewedKey = route.request().headers()["idempotency-key"];
    await route.fetch();
    await route.abort("failed");
  });
  await admin
    .getByRole("button", { name: "Save reviewed reference mapping" })
    .click();
  await expect(
    admin.getByRole("button", { name: "Retry saved reference mapping" }),
  ).toBeVisible();
  await admin.unroute("**/api/commands/catalog.reference.set");
  await admin.reload();
  await admin.getByRole("button", { name: "Manage EQ-1", exact: true }).click();
  await admin
    .getByRole("tab", { name: "Reference mapping", exact: true })
    .click();
  await expect(admin.getByLabel("Manufacturer product family")).toBeDisabled();
  await admin.route("**/api/commands/catalog.reference.set", async (route) => {
    expect(route.request().postData()).toBe(reviewedPayload);
    expect(route.request().headers()["idempotency-key"]).toBe(reviewedKey);
    await route.continue();
  });
  await admin
    .getByRole("button", { name: "Retry saved reference mapping" })
    .click();
  await expect(
    admin.getByText("Reference mapping saved.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/#product=${family.id}&referenceModel=${model.id}`);
  await page
    .getByRole("link", {
      name: "Sign in for pricing & availability ↗",
      exact: true,
    })
    .click();
  await page.reload();
  await expect(
    page.getByText(`Requested equipment: ${family.title} · ${model.title}.`, {
      exact: false,
    }),
  ).toBeVisible();
  await credentials(page, "pricing-buyer@example.test");
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  const matches = page
    .getByRole("heading", { name: "Requested manufacturer equipment" })
    .locator("..");
  await expect(
    matches.getByRole("heading", { name: "EQ-1 · Synthetic equipment" }),
  ).toBeVisible();
  await matches
    .getByRole("button", { name: "View Synthetic equipment", exact: true })
    .click();
  await expect(
    matches.getByRole("button", { name: /Prepare order/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    matches.getByRole("heading", { name: "EQ-1 · Synthetic equipment" }),
  ).toBeVisible();
  await page.goto(
    `/#page=Shop&referenceFamily=${family.id}&referenceModel=${family.models[0]!.id}`,
  );
  await expect(
    page.getByText(
      "No reviewed purchasing match is currently available to your account.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await admin.close();
});
