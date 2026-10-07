import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3129";
async function login(page: Page, email: string, buyer = false) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await response).json()).csrf;
  // Staff land on Overview; buyers land on Shop.
  await expect(
    page.getByRole("heading", {
      name: buyer ? "Shop" : "Overview",
      exact: true,
    }),
  ).toBeVisible();
  if (buyer) await buyerNav(page, "Returns");
  else await navigateWorkspace(page, "Returns");
  return csrf;
}
// Secondary claim commands live in the claim row's Actions disclosure; wait for
// the refreshed row rather than opening whatever disclosures are rendered now.
function claimRow(page: Page, claimId: string) {
  return page
    .getByRole("region", { name: "Claim records", exact: true })
    .getByRole("row")
    .filter({ hasText: claimId.slice(0, 8) });
}
// Buyers use the customer header: Overview is labelled Reports and Returns is
// reached from Account. A phone header collapses the navigation behind Menu.
async function buyerNav(page: Page, name: "Reports" | "Returns") {
  const target = page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", {
      name: name === "Returns" ? "Returns & warranty" : name,
      exact: true,
    });
  if (!(await target.isVisible()))
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await target.click();
  await expect(page.locator("#workspace-title")).toHaveText(name);
}
test("browser: warranty policy review on a phone fences stale claim dates and retains snapshots across lost replies and later changes", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const csrf = await login(page, "admin@example.test");
  const attempts: { key: string; payload: any }[] = [];
  let receipt: any;
  await page.route("**/api/commands/warranty.policy", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (attempts.length === 1) {
      receipt = await response.json();
      await route.abort("failed");
    } else {
      expect(await response.json()).toEqual(receipt);
      await route.fulfill({ response });
    }
  });
  // Coverage policy now has its own administrator section in Returns.
  await navigateWorkspace(page, "Returns", "Return & warranty policies");
  await page
    .getByText("Historical shipment coverage settings", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configure warranty coverage", exact: true })
    .click();
  const policyDialog = page.getByRole("dialog", {
    name: "Configure warranty coverage policy",
    exact: true,
  });
  await policyDialog
    .getByLabel("Coverage duration in days", { exact: true })
    .fill("730");
  await policyDialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic warranty duration review");
  await policyDialog
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(policyDialog.getByRole("alert")).toBeVisible();
  await policyDialog
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(policyDialog).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute("**/api/commands/warranty.policy");
  await navigateWorkspace(page, "Returns", "Claims and returns");
  await page
    .getByRole("button", { name: "Request return", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Request return or warranty review",
    exact: true,
  });
  await expect(dialog).toContainText("Policy version 2: 730 days");
  await dialog
    .getByLabel("Request type", { exact: true })
    .selectOption("warranty");
  await dialog
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic warranty review on phone");
  await dialog
    .getByLabel("Evidence reference", { exact: true })
    .fill("Synthetic claim evidence");
  const change = async (days: number, revision: number) => {
    const r = await page.request.post(
      `${origin}/api/commands/warranty.policy`,
      {
        headers: {
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": `other-policy-${revision}`,
        },
        data: {
          days,
          revision,
          reason: "Synthetic intervening administrator review",
        },
      },
    );
    expect(r.status()).toBe(200);
  };
  await change(30, 2);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("REVISION");
  await dialog
    .getByRole("button", { name: "Recheck claim coverage", exact: true })
    .click();
  await expect(dialog).toContainText("Policy version 3: 30 days");
  const claimAttempts: { key: string; payload: any }[] = [];
  let claim: any;
  await page.route("**/api/commands/warranty.submit", async (route) => {
    claimAttempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (claimAttempts.length === 1) {
      claim = await response.json();
      await route.abort("failed");
    } else {
      expect(await response.json()).toEqual(claim);
      await route.fulfill({ response });
    }
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await change(365, 3);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(claimAttempts).toHaveLength(2);
  expect(claimAttempts[1]).toEqual(claimAttempts[0]);
  expect(claim.coverageEnd).toBe("2024-03-30T12:00:00.000Z");
  const read = await page.request.get(
    `${origin}/api/warranty/claims/${claim.id}/coverage`,
  );
  expect(read.status()).toBe(200);
  expect((await read.json()).snapshot.policy.revision).toBe(3);
  const snapshotButton = page.getByRole("button", {
    name: "Claim coverage snapshot",
    exact: true,
  });
  // A transient read failure is visible and can be retried without a command.
  let firstRead = true;
  await page.route("**/api/warranty/claims/*/coverage", async (route) => {
    if (firstRead) {
      firstRead = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic read unavailable" }),
      });
    } else await route.continue();
  });
  await openStockActions(claimRow(page, claim.id));
  await snapshotButton.click();
  const section = page.getByRole("region", {
    name: "Retained claim coverage",
    exact: true,
  });
  await expect(section.getByRole("alert")).toContainText(
    "Synthetic read unavailable",
  );
  await section
    .getByRole("button", { name: "Retry retained coverage", exact: true })
    .click();
  await expect(section).toContainText("Policy version 3: 30 days");
  await expect(section).toContainText("2024-03-30T12:00:00.000Z");
  await section
    .getByRole("button", { name: "Close claim coverage", exact: true })
    .click();
  await expect(snapshotButton).toBeFocused();
  const buyerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const buyer = await buyerContext.newPage();
    buyer.on("pageerror", (e) => errors.push(e.message));
    await login(buyer, "coverage-buyer@example.test", true);
    await expect(
      buyer.getByRole("button", {
        name: "Configure warranty coverage",
        exact: true,
      }),
    ).toHaveCount(0);
    await openStockActions(claimRow(buyer, claim.id));
    await buyer
      .getByRole("button", { name: "Claim coverage snapshot", exact: true })
      .click();
    const retained = buyer.getByRole("region", {
      name: "Retained claim coverage",
      exact: true,
    });
    await expect(retained).toContainText("Policy version 3: 30 days");
    const current = await (
      await buyer.request.get(`${origin}/api/warranty/coverage-policy`)
    ).json();
    expect(current.revision).toBe(4);
    expect(current.reason).toBeUndefined();
    expect(current.configuredBy).toBeUndefined();
    expect(errors).toEqual([]);
  } finally {
    await buyerContext.close();
  }
});
