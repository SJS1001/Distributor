import { test, expect } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

test("public site: mobile application, approval boundary and sign-in navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        country: "CA",
        currency: "CAD",
        approvalRequired: true,
      },
    }),
  );
  let submission: any;
  await page.route("**/api/enrollment/applications", (route) => {
    submission = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { received: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Built for the work ahead." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page
    .getByRole("link", { name: "Apply for a trade account" })
    .first()
    .click();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#apply$/);
  await expect(page.locator("#public-content")).toBeFocused();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Synthetic Ontario Trades");
  await page.getByLabel("Contact name").fill("Synthetic Buyer");
  await page.getByLabel("Business email").fill("public-ui@example.test");
  await page.getByLabel("Phone", { exact: true }).fill("416-555-0100");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByRole("heading", { name: "Application received." }),
  ).toBeVisible();
  expect(submission).toMatchObject({
    businessName: "Synthetic Ontario Trades",
    email: "public-ui@example.test",
    province: "ON",
    acknowledgment: true,
  });
  await expect(
    page.getByText("Purchasing access is not yet approved.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Sign in", exact: false })
    .first()
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Apply for a trade account" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("public site: activation clears fragment and keeps token/password out of browser storage", async ({
  page,
}) => {
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  let activation: any;
  await page.route("**/api/enrollment/activate", (route) => {
    activation = route.request().postDataJSON();
    return route.fulfill({ json: { activated: true } });
  });
  await page.goto("/#activate=synthetic-private-token");
  await expect(page).toHaveURL(/#activate$/);
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-password-for-ui");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-long-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Passwords must match.");
  expect(activation).toBeUndefined();
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-password-for-ui");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is activated." }),
  ).toBeVisible();
  expect(activation).toEqual({
    token: "synthetic-private-token",
    password: "synthetic-password-for-ui",
  });
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("synthetic-private-token");
  expect(storage).not.toContain("synthetic-password-for-ui");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Invitation required" }),
  ).toBeVisible();
});

test("public site: replacement activation link replaces the in-memory token while mounted", async ({
  page,
}) => {
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  let activation: any;
  await page.route("**/api/enrollment/activate", (route) => {
    activation = route.request().postDataJSON();
    return route.fulfill({ json: { activated: true } });
  });
  await page.goto("/#activate=synthetic-old-invitation");
  await expect(page).toHaveURL(/#activate$/);
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-old-invitation-password");
  // A fragment navigation keeps the document mounted, as when opening a reissue.
  await page.evaluate(() => {
    location.hash = "#activate=synthetic-new-invitation";
  });
  await expect(page).toHaveURL(/#activate$/);
  await expect(
    page.getByLabel("New password (14–256 characters)", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-new-invitation-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-new-invitation-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is activated." }),
  ).toBeVisible();
  expect(activation).toEqual({
    token: "synthetic-new-invitation",
    password: "synthetic-new-invitation-password",
  });
});

test("public site: admin reviews explicit terms and manually hands off invitation", async ({
  page,
}) => {
  const application = {
    id: "public-ui-application",
    businessName: "Synthetic Ontario Trades",
    contactName: "Buyer",
    email: "buyer@example.test",
    phone: "4165550100",
    province: "ON",
    businessNumber: "",
    notes: "Synthetic UI review only",
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewReason: null,
    tier: null,
    creditLimit: null,
    accountId: null,
    invitationExpiresAt: null,
    invitationActive: false,
  };
  await page.route("**/api/enrollment/applications", (route) =>
    route.fulfill({ json: { items: [application], next: null } }),
  );
  let decision: any;
  await page.route(
    "**/api/enrollment/applications/public-ui-application/decision",
    (route) => {
      decision = route.request().postDataJSON();
      application.status = "approved";
      return route.fulfill({
        json: {
          id: application.id,
          status: "approved",
          activationToken: "synthetic-admin-token",
          expiresAt: "2026-12-01T00:00:00.000Z",
        },
      });
    },
  );
  await page.goto("/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Administration");
  await page
    .getByRole("tab", { name: "Trade applications", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Approve Synthetic Ontario Trades",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Reviewed pricing tier").fill("standard");
  await modal.getByLabel("Reviewed credit limit (CAD)").fill("500.25");
  await modal.getByLabel("Review reason").fill("Synthetic approved UI review");
  await modal
    .getByLabel("Your current password")
    .fill("long-test-only-password");
  await modal
    .getByRole("button", { name: "Approve and create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Private invitation for Synthetic Ontario Trades",
    }),
  ).toBeVisible();
  expect(decision).toMatchObject({
    decision: "approve",
    tier: "standard",
    creditLimit: 50025,
    currentPassword: "long-test-only-password",
  });
  await expect(page.getByLabel("Activation link")).toHaveValue(
    /\/#activate=synthetic-admin-token$/,
  );
  await expect(
    page.getByText("No email has been sent.", { exact: false }).first(),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("synthetic-admin-token");
  expect(storage).not.toContain("long-test-only-password");
  await page.getByRole("button", { name: "Dismiss private link" }).click();
  await expect(page.getByLabel("Activation link")).toHaveCount(0);
});

test("public site: actual isolated submission, administrator approval, activation and buyer login", async ({
  page,
  browser,
}) => {
  const password = "synthetic-approved-buyer-password";
  const email = "native-enrollment-ui@example.test";
  await page.goto("/#apply");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Synthetic Native Ontario Trades");
  await page.getByLabel("Contact name").fill("Native Synthetic Buyer");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Phone", { exact: true }).fill("416-555-0101");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByRole("heading", { name: "Application received." }),
  ).toBeVisible();
  // A submitted applicant has no workspace or session yet.
  const before = await page.request.get("/api/session");
  expect(before.status()).toBe(401);
  const adminContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3125",
  });
  try {
    const admin = await adminContext.newPage();
    await admin.goto("/#sign-in");
    await admin.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await admin
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      admin.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await navigateWorkspace(admin, "Administration", "Trade applications");
    await admin
      .getByRole("button", {
        name: "Approve Synthetic Native Ontario Trades",
        exact: true,
      })
      .click();
    const modal = admin.getByRole("dialog");
    await modal.getByLabel("Reviewed pricing tier").fill("standard");
    await modal.getByLabel("Reviewed credit limit (CAD)").fill("0");
    await modal
      .getByLabel("Review reason")
      .fill("Isolated synthetic browser evidence only");
    await modal
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await modal
      .getByRole("button", {
        name: "Approve and create invitation",
        exact: true,
      })
      .click();
    const link = await admin.getByLabel("Activation link").inputValue();
    expect(link).toContain("/#activate=");
    await page.goto(link);
    await expect(page).toHaveURL(/#activate$/);
    await page
      .getByLabel("New password (14–256 characters)", { exact: true })
      .fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your account is activated." }),
    ).toBeVisible();
    const activatedSession = await page.request.get("/api/session");
    expect(activatedSession.status()).toBe(401);
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const session = await (await loginResponse).json();
    expect(session.actor.role).toBe("buyer");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Overview · dstrbtr");
    expect(
      (await page.request.get("/api/enrollment/applications")).status(),
    ).toBe(403);
    // The issued token cannot activate a second password.
    expect(
      (
        await page.request.post("/api/enrollment/activate", {
          data: {
            token: link.split("#activate=")[1],
            password: "synthetic-second-activation-password",
          },
          headers: { origin: "http://127.0.0.1:3125" },
        })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
    await admin.getByRole("button", { name: "Refresh applications" }).click();
    await expect(
      admin.getByRole("cell", { name: "Buyer activated", exact: true }),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
