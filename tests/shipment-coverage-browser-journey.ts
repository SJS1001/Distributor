import {
  navigateWorkspace,
  openVisibleRowActions,
} from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3131";
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
// Buyers use the customer header: Overview is labelled Reports and Returns is
// reached from Account. A phone header collapses the navigation behind Menu.
async function buyerNav(page: Page, name: "Reports" | "Returns") {
  const target = page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", {
      name: name === "Returns" ? "Account" : name,
      exact: true,
    });
  if (!(await target.isVisible()))
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await target.click();
  if (name === "Returns")
    await page
      .getByRole("button", {
        name: "Returns and warranty requests",
        exact: true,
      })
      .click();
  await expect(page.locator("#workspace-title")).toHaveText(name);
}
test("browser: phone claim retains handover policy across later revisions, transient coverage reads and lost claim replies", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage(),
      csrf = await login(admin, "admin@example.test");
    await login(page, "sale-buyer@example.test", true);
    await expect(
      page.getByRole("button", {
        name: "Configure warranty coverage",
        exact: true,
      }),
    ).toHaveCount(0);
    const units = await (
      await page.request.get(`${origin}/api/warranty/sold-units/page`)
    ).json();
    const unit = units.items[0];
    const url = `${origin}/api/warranty/sold-units/${unit.id}/coverage?accountId=${unit.accountId}`;
    const coverage = await (await page.request.get(url)).json();
    expect(coverage.source).toBe("shipment_policy");
    expect(coverage.policy.revision).toBe(2);
    expect(coverage.policy.days).toBe(730);
    expect(
      (
        await (
          await page.request.get(`${origin}/api/warranty/coverage-policy`)
        ).json()
      ).revision,
    ).toBe(3);
    await page
      .getByRole("button", { name: "Check sold serial coverage", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Sold serial coverage",
      exact: true,
    });
    await panel
      .getByLabel("Sold serial for coverage", { exact: true })
      .selectOption({ label: "S1" });
    await panel
      .getByRole("button", { name: "Check coverage dates", exact: true })
      .click();
    await expect(panel).toContainText(
      "Duration retained at shipment: 730 days.",
    );
    await expect(panel).toContainText(coverage.coverageEnd);
    await panel
      .getByRole("button", { name: "Close coverage lookup", exact: true })
      .click();
    let failedRead = false;
    await page.route(
      "**/api/warranty/sold-units/*/coverage?*",
      async (route) => {
        if (!failedRead) {
          failedRead = true;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            json: { message: "Synthetic shipment coverage unavailable" },
          });
        } else await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Submit claim / return", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request return or warranty review",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic shipment coverage unavailable",
    );
    await dialog
      .getByRole("button", { name: "Retry claim coverage", exact: true })
      .click();
    await expect(dialog).toContainText("Policy version 2: 730 days");
    await expect(dialog).toContainText("Duration retained at shipment");
    await expect(dialog).toContainText(coverage.coverageEnd);
    await dialog
      .getByLabel("Request type", { exact: true })
      .selectOption("warranty");
    await dialog
      .getByLabel("Issue / reason", { exact: true })
      .fill("Synthetic failed sale");
    await dialog
      .getByLabel("Evidence reference", { exact: true })
      .fill("Synthetic evidence");
    const changed = await admin.request.post(
      `${origin}/api/commands/warranty.policy`,
      {
        headers: {
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": "another-policy",
        },
        data: { days: 0, revision: 3, reason: "Synthetic later change" },
      },
    );
    expect(changed.status()).toBe(200);
    const attempts: { key: string; payload: any }[] = [];
    let claim: any;
    await page.route("**/api/commands/warranty.submit", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        payload: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (attempts.length === 1) {
        claim = await response.json();
        await route.abort("failed");
      } else {
        expect(await response.json()).toEqual(claim);
        await route.fulfill({ response });
      }
    });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]!.payload.policyRevision).toBe(2);
    expect(claim.coverageEnd).toBe(coverage.coverageEnd);
    await openVisibleRowActions(page);
    await page
      .getByRole("button", { name: "Claim coverage snapshot", exact: true })
      .click();
    const retained = page.getByRole("region", {
      name: "Retained claim coverage",
      exact: true,
    });
    await expect(retained).toContainText("Policy version 2: 730 days");
    await expect(retained).toContainText("retained at original shipment");
    await expect(retained).toContainText(coverage.coverageEnd);
    await expect(retained).toContainText("Eligibility requires review");
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
  }
});
