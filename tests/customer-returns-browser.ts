import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

const origin = "http://127.0.0.1:3230";
async function login(page: Page, email: string, buyer: boolean) {
  await page.goto("/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await reply).json()).csrf as string;
  await expect(page.locator("#workspace-title")).toHaveText(
    buyer ? "Shop" : "Overview",
  );
  return csrf;
}

test("phone buyer finds Request RMA, retries a lost reply once, and follows staff authorization without exposing another account", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const staffContext = await browser.newContext();
  try {
    const csrf = await login(
      page,
      `returns-${testInfo.project.name}@example.test`,
      true,
    );
    // Exercise the customer's direct visible header, including its phone menu.
    await navigateWorkspace(page, "Returns");
    await expect(
      page.getByRole("region", { name: "Return guidance" }),
    ).toContainText(
      "Submitting a request does not approve a refund or replacement.",
    );
    await expect(page.getByText("Private foreign customer issue")).toHaveCount(
      0,
    );
    const sold = await (
      await page.request.get("/api/warranty/sold-units/page")
    ).json();
    expect(sold.items).toHaveLength(1);
    const own = sold.items[0];
    await page
      .getByRole("button", { name: "Request RMA", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request return or warranty review",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Request RMA", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Request RMA", exact: true })
      .click();
    expect(
      await dialog
        .getByLabel("Sold serial", { exact: true })
        .locator("option")
        .allTextContents(),
    ).toEqual(["Select a sold serial", own.serial]);
    await dialog
      .getByLabel("Sold serial", { exact: true })
      .selectOption(own.id);
    await expect(dialog).toContainText("Eligibility requires review");
    await dialog
      .getByLabel("Issue / reason", { exact: true })
      .fill("Synthetic own serial failure");
    await dialog
      .getByLabel("Evidence reference", { exact: true })
      .fill("synthetic:inspection-reference");
    const attempts: { key: string; payload: Record<string, unknown> }[] = [];
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
    // A committed replay must retain its receipt even if the following read
    // fails. This is distinct from losing the submit response above.
    let refreshFailed = false;
    await page.route("**/api/dashboard", async (route) => {
      if (!refreshFailed) {
        refreshFailed = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "SYNTHETIC_REFRESH_FAILURE",
            message: "Synthetic saved-request refresh unavailable.",
          }),
        });
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(`Request ${claim.id} submitted for distributor review.`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      `Request ${claim.id} submitted; refresh failed:`,
    );
    expect(refreshFailed).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]!.payload.unitId).toBe(own.id);
    expect(attempts[0]!.payload.accountId).toBe(own.accountId);
    await page.reload();
    await expect(page.locator("#workspace-title")).toHaveText("Returns");
    const row = page
      .getByRole("region", { name: "Claim records", exact: true })
      .getByRole("row")
      .filter({ hasText: claim.id.slice(0, 8) });
    await expect(row).toContainText("Awaiting distributor review");
    await expect(
      row.getByRole("button", { name: "Approve return", exact: true }),
    ).toHaveCount(0);
    const headers = {
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": `duplicate-${testInfo.project.name}`,
    };
    const duplicate = await page.request.post("/api/commands/warranty.submit", {
      headers,
      data: attempts[0]!.payload,
    });
    expect(duplicate.status()).toBe(409);
    expect(
      (await (await page.request.get("/api/warranty/claims/page")).json())
        .items,
    ).toHaveLength(1);
    const prohibitedReview = await page.request.post(
      "/api/commands/warranty.review",
      {
        headers: {
          ...headers,
          "idempotency-key": `buyer-review-${testInfo.project.name}`,
        },
        data: {
          claimId: claim.id,
          approved: true,
          reason: "Synthetic buyer cannot authorize",
        },
      },
    );
    expect(prohibitedReview.status()).toBe(403);
    const staff = await staffContext.newPage();
    await login(staff, "returns-warranty@example.test", false);
    await navigateWorkspace(staff, "Returns");
    const staffRow = staff
      .getByRole("region", { name: "Claim records", exact: true })
      .getByRole("row")
      .filter({ hasText: claim.id.slice(0, 8) });
    await staffRow
      .getByRole("button", { name: "Approve return", exact: true })
      .click();
    const review = staff.getByRole("dialog", {
      name: "Approve return authorization",
      exact: true,
    });
    await expect(review).toContainText(`Sold serial: ${own.serial}`);
    await expect(review).toContainText(
      "This does not issue a credit or replacement.",
    );
    await review
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic staff return authorization");
    await review
      .getByRole("button", { name: "Approve return", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("Return authorized");
    await expect(row).toContainText(
      "Confirm the return address, reference and handover instructions with your distributor before sending equipment.",
    );
    const staffClaims = await (
      await staff.request.get("/api/warranty/claims/page")
    ).json();
    const foreign = staffClaims.items.find(
      (c: any) => c.issue === "Private foreign customer issue",
    );
    expect(foreign).toBeTruthy();
    expect(
      (
        await page.request.get(`/api/warranty/claims/${foreign.id}/coverage`)
      ).status(),
    ).toBe(403);
    const foreignSubmit = await page.request.post(
      "/api/commands/warranty.submit",
      {
        headers: {
          ...headers,
          "idempotency-key": `foreign-submit-${testInfo.project.name}`,
        },
        data: {
          ...attempts[0]!.payload,
          unitId: foreign.unit_id,
          accountId: foreign.account_id,
        },
      },
    );
    expect(foreignSubmit.status()).toBe(403);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Return from Account through the same primary phone navigation.
    await navigateWorkspace(page, "Account");
    await navigateWorkspace(page, "Returns");
    await expect(row).toContainText("Return authorized");
    expect(errors).toEqual([]);
  } finally {
    await staffContext.close();
  }
});

test("buyer without sold equipment sees the prerequisite and practical support guidance", async ({
  page,
}) => {
  await login(page, "returns-empty@example.test", true);
  await navigateWorkspace(page, "Returns");
  await expect(
    page.getByRole("button", { name: "Request RMA", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Return guidance" }),
  ).toContainText("No eligible sold equipment is available");
  await expect(
    page.getByRole("region", { name: "Return guidance" }),
  ).toContainText(
    "contact your distributor with the serial and order or invoice reference",
  );
  await expect(
    page.getByRole("button", { name: "Start a claim or return", exact: true }),
  ).toHaveCount(0);
});
