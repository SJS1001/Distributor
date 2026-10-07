import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
async function application(page: Page, business: string, email: string) {
  await page.goto("/#apply");
  await page.getByLabel("Business name", { exact: true }).fill(business);
  await page.getByLabel("Contact name").fill("Synthetic buyer");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Phone", { exact: true }).fill("4165550123");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
}
test("availability failure has an in-place retry", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/enrollment/config", (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({
          status: 503,
          json: { message: "Synthetic availability interruption" },
        })
      : route.fulfill({ json: { enabled: true } });
  });
  await page.goto("/#apply");
  await expect(
    page.getByText(/Applications are temporarily unavailable/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry application availability" })
    .click({ timeout: 2000 });
  await expect(page.getByLabel("Business name", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
  await fits(page);
});
test("application and activation errors retain entries and receive focus", async ({
  page,
}) => {
  await page.route("**/api/enrollment/applications", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Synthetic submission interruption" },
    }),
  );
  await application(
    page,
    "Synthetic retry trades",
    "synthetic-retry@example.test",
  );
  await page.getByRole("button", { name: "Submit application" }).click();
  const error = page
    .getByRole("alert")
    .filter({ hasText: "Synthetic submission interruption" });
  await expect(error).toBeVisible();
  await expect.soft(error).toBeFocused();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Synthetic retry trades",
  );
  await fits(page);
  await page.goto("/#activate=synthetic-unavailable-invitation");
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-new-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-other-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect.soft(page.getByRole("alert")).toBeFocused();
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-new-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/invitation/i);
  await expect.soft(page.getByRole("alert")).toBeFocused();
  await fits(page);
});
test("native application review manual invitation activation and buyer boundaries", async ({
  page,
  browser,
}, info) => {
  const name = `Synthetic journey ${info.project.name}`;
  const email = `journey-${info.project.name}@example.test`;
  const password = "synthetic-activated-buyer-password";
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await application(page, name, email);
  await fits(page);
  await page.getByRole("button", { name: "Submit application" }).click();
  const receipt = page.getByRole("status").filter({
    has: page.getByRole("heading", { name: "Application received." }),
  });
  await expect(receipt).toBeVisible();
  await expect.soft(receipt).toBeFocused();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await fits(page);
  const adminContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3139",
    viewport: info.project.use.viewport,
  });
  try {
    const admin = await adminContext.newPage();
    admin.on("pageerror", (error) => errors.push(error));
    await admin.goto("/#admin-sign-in");
    await admin.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await admin
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await navigateWorkspace(admin, "Administration", "Trade applications");
    const opener = admin.getByRole("button", {
      name: `Approve ${name}`,
      exact: true,
    });
    await opener.click();
    await admin.getByRole("dialog").press("Escape");
    await expect.soft(opener).toBeFocused();
    await opener.click();
    const modal = admin.getByRole("dialog");
    await modal.getByLabel("Reviewed pricing tier").fill("standard");
    await modal.getByLabel("Reviewed credit limit (CAD)").fill("0");
    await modal.getByLabel("Review reason").fill("Synthetic journey evidence");
    await modal
      .getByLabel("Your current password")
      .fill("incorrect-synthetic-password");
    await modal
      .getByRole("button", {
        name: "Approve and create invitation",
        exact: true,
      })
      .click();
    await expect(modal.getByRole("alert")).toBeVisible();
    await expect(modal.getByLabel("Review reason")).toHaveValue(
      "Synthetic journey evidence",
    );
    await modal
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await modal
      .getByRole("button", {
        name: "Approve and create invitation",
        exact: true,
      })
      .click();
    const link = admin.getByLabel("Activation link");
    await expect(link).toBeVisible();
    await expect.soft(link).toBeFocused();
    let url = await link.inputValue();
    await admin.getByLabel("Application view").selectOption("all");
    const row = admin.getByRole("row").filter({ hasText: name });
    const replace = row.getByRole("button", {
      name: "Replace invitation",
      exact: true,
    });
    await replace.click();
    await admin.getByRole("dialog").press("Escape");
    await expect.soft(replace).toBeFocused();
    await expect.soft(link).toHaveValue(url);
    await fits(admin);
    await admin.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error("Synthetic clipboard unavailable");
          },
        },
      });
    });
    await admin
      .getByRole("button", { name: "Copy private link", exact: true })
      .click();
    await expect(
      admin.getByText(
        "Clipboard unavailable. Select and copy the link manually.",
        { exact: true },
      ),
    ).toBeVisible();
    // The business result must survive failure of the subsequent queue read.
    const queueRead = /\/api\/enrollment\/applications(?:\?|$)/;
    await admin.route(
      queueRead,
      (route) =>
        route.fulfill({
          status: 503,
          json: { message: "Synthetic queue interruption" },
        }),
      { times: 1 },
    );
    await replace.click();
    await admin
      .getByRole("dialog")
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic replacement");
    await admin
      .getByRole("dialog")
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await admin
      .getByRole("button", {
        name: "Create replacement invitation",
        exact: true,
      })
      .click();
    await expect(link).not.toHaveValue(url);
    await expect(admin.getByRole("alert")).toContainText(
      "Synthetic queue interruption",
    );
    const replaced = await link.inputValue();
    await expect(link).toBeFocused();
    await admin.getByRole("button", { name: "Refresh applications" }).click();
    await expect(admin.getByRole("alert")).toHaveCount(0);
    await expect(link).toHaveValue(replaced);
    // No raw invitation or approval password is retained in browser storage.
    const storage = await admin.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(storage).not.toContain(replaced.split("#activate=")[1]);
    expect(storage).not.toContain("long-test-only-password");
    await row
      .getByRole("button", { name: "Revoke invitation", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic revocation");
    await admin
      .getByRole("dialog")
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await admin
      .getByRole("button", { name: "Revoke invitation", exact: true })
      .last()
      .click();
    await expect(link).toHaveCount(0);
    await expect(row).toContainText("No active invitation");
    expect(
      (
        await page.request.post("/api/enrollment/activate", {
          data: { token: replaced.split("#activate=")[1], password },
          headers: { origin: "http://127.0.0.1:3139" },
        })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
    await replace.click();
    await admin
      .getByRole("dialog")
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic final invitation");
    await admin
      .getByRole("dialog")
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await admin
      .getByRole("button", {
        name: "Create replacement invitation",
        exact: true,
      })
      .click();
    await expect(link).toBeVisible();
    url = await link.inputValue();
    expect(url).not.toBe(replaced);
    await page.goto(url);
    await expect(page).toHaveURL(/#activate$/);
    await page
      .getByLabel("New password (14–256 characters)", { exact: true })
      .fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    const activation = page.getByRole("status").filter({
      has: page.getByRole("heading", { name: "Your account is activated." }),
    });
    await expect(activation).toBeVisible();
    await expect.soft(activation).toBeFocused();
    expect((await page.request.get("/api/session")).status()).toBe(401);
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await expect.soft(page).toHaveURL(/#customer-sign-in$/);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Shop", exact: true }),
    ).toBeVisible();
    const session = await (await page.request.get("/api/session")).json();
    expect(session.actor.role).toBe("buyer");
    expect(
      (await page.request.get("/api/enrollment/applications")).status(),
    ).toBe(403);
    expect((await page.request.get("/api/users")).status()).toBe(403);
    await expect(
      page.getByRole("button", { name: "Catalog · Add products", exact: true }),
    ).toHaveCount(0);
    await fits(page);
    await admin.getByRole("button", { name: "Refresh applications" }).click();
    await expect(
      row.getByRole("cell", { name: "Buyer activated", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
  }
});
