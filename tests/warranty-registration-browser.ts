import { test, expect } from "@playwright/test";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept, ship } from "./fixtures.ts";
import {
  navigateWorkspace,
  navigateCustomerWorkspace,
  openStockActions,
} from "./workspace-navigation.ts";

test("separate policies, retained installation corrections and warranty requests survive elapsed ordinary returns", async ({
  page,
}, testInfo) => {
  const cleanup: (() => void)[] = [];
  const f = fixture({ after: (fn) => cleanup.push(fn) });
  const shipment = ship(f, accept(f, 2).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const returnUnitId = f.app.inventory.trace(f.actor, "S2").unit.id;
  const ago = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString();
  // Model a pre-retained-policy sale; the synthetic custody date and any
  // retained handover policy must never disagree.
  f.app.database
    .owned("fulfillment")
    .run("DELETE FROM fulfillment_coverage WHERE shipment_id=?", shipment.id);
  // Explicit synthetic sale age; no actual customer or live data is used.
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET shipped_at=? WHERE id=?",
      ago(90),
      shipment.id,
    );
  f.app.identity.createUser(f.actor, "registration-buyer", {
    email: "registration-buyer@example.test",
    password: "synthetic-buyer-password",
    name: "Registration buyer",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    requirePasswordChange: false,
  });
  const origin = "http://127.0.0.1:3261";
  const http = await createHttp(f.app, { origin, secureCookies: false });
  http.addHook("onSend", async (_request, reply, payload) => {
    const policy = reply.getHeader("Content-Security-Policy");
    if (typeof policy === "string")
      reply.header(
        "Content-Security-Policy",
        policy.replace(/upgrade-insecure-requests;?/g, ""),
      );
    return payload;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fits = async () => {
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) => element.getBoundingClientRect().right > innerWidth + 1,
        )
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
        })),
    }));
    expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(
      geometry.width,
    );
  };
  const login = async (email: string, password: string) => {
    await page.goto(origin + "/#sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toBeVisible();
  };
  try {
    await http.listen({ host: "127.0.0.1", port: 3261 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login("admin@example.test", "long-test-only-password");
    await navigateWorkspace(page, "Returns", "Return & warranty policies");
    const returns = page.getByRole("region", {
      name: "Ordinary return policy",
      exact: true,
    });
    await returns
      .getByLabel("Return window (days)", { exact: true })
      .fill("30");
    await returns
      .getByLabel("Reason for policy change", { exact: true })
      .fill("Synthetic 30-day return policy");
    await returns
      .getByRole("button", { name: "Review return policy", exact: true })
      .click();
    await returns
      .getByRole("button", { name: "Save return policy", exact: true })
      .click();
    await expect(returns).toContainText("Ordinary return policy saved.");
    await page
      .getByRole("combobox", {
        name: "Product for warranty terms",
        exact: true,
      })
      .selectOption(f.product);
    const terms = page.getByRole("region", {
      name: "Product warranty terms",
      exact: true,
    });
    await terms
      .getByLabel("Manufacturer", { exact: true })
      .fill("Synthetic manufacturer");
    await terms
      .getByLabel("Warranty reference", { exact: true })
      .fill("synthetic:warranty-terms-v1");
    await terms
      .getByRole("combobox", { name: "Warranty starts at", exact: true })
      .selectOption("installation");
    await terms
      .getByLabel("Warranty duration (days)", { exact: true })
      .fill("365");
    await terms
      .getByLabel("Warranty notes", { exact: true })
      .fill("Synthetic documented one-year installation terms");
    await terms
      .getByLabel("Reason for policy change", { exact: true })
      .fill("Record independently reviewed product terms");
    await terms
      .getByRole("button", {
        name: "Review product warranty terms",
        exact: true,
      })
      .click();
    await terms
      .getByRole("button", { name: "Save product warranty terms", exact: true })
      .click();
    await expect(terms).toContainText("Product warranty terms saved.");
    expect(f.app.warranty.registration.returnPolicy(f.actor).days).toBe(30);
    expect(f.app.warranty.registration.terms(f.actor, f.product).days).toBe(
      365,
    );
    // A second operator changes retained records while the browser has a
    // reviewed policy and an unsaved terms draft. Global Refresh must retain
    // both edits and their reviewed revisions, while exposing stale reads.
    await returns
      .getByLabel("Return window (days)", { exact: true })
      .fill("45");
    await returns
      .getByLabel("Reason for policy change", { exact: true })
      .fill("Unsaved reviewed policy");
    await returns
      .getByRole("button", { name: "Review return policy", exact: true })
      .click();
    await terms
      .getByLabel("Warranty duration (days)", { exact: true })
      .fill("777");
    f.app.warranty.registration.saveReturnPolicy(
      f.actor,
      "browser-other-policy",
      {
        expectedRevision: 1,
        days: 30,
        reason: "Concurrent reviewed policy",
      },
    );
    const originalTerms = f.app.warranty.registration.terms(f.actor, f.product);
    f.app.warranty.registration.saveTerms(f.actor, "browser-other-terms", {
      productId: f.product,
      expectedRevision: 1,
      manufacturer: originalTerms.manufacturer!,
      reference: originalTerms.reference!,
      startsAt: "installation",
      days: 365,
      notes: originalTerms.notes!,
      reason: "Concurrent reviewed terms",
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(returns).toContainText(
      "Policy changed. Your draft, reviewed revision and retained request were preserved",
    );
    await expect(
      returns.getByRole("region", {
        name: "Review return policy",
        exact: true,
      }),
    ).toContainText("45");
    await expect(
      terms.getByLabel("Warranty duration (days)", { exact: true }),
    ).toHaveValue("777");
    await expect(terms).toContainText(
      "Policy changed. Your draft, reviewed revision and retained request were preserved",
    );
    await returns
      .getByRole("button", {
        name: "Reload current policy and discard draft",
        exact: true,
      })
      .click();
    await terms
      .getByRole("button", {
        name: "Reload current policy and discard draft",
        exact: true,
      })
      .click();
    await expect(
      returns.getByLabel("Return window (days)", { exact: true }),
    ).toHaveValue("30");
    await expect(
      terms.getByLabel("Warranty duration (days)", { exact: true }),
    ).toHaveValue("365");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await fits();
      await page.screenshot({
        path: testInfo.outputPath(`policies-${width}.png`),
      });
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login("registration-buyer@example.test", "synthetic-buyer-password");
    await navigateCustomerWorkspace(page, "Returns", "Warranty registration");
    const registration = page.getByRole("region", {
      name: "Installation registration",
      exact: true,
    });
    await registration
      .getByLabel("Sold serial for installation", { exact: true })
      .selectOption(unitId);
    await expect(registration).toContainText("registration revision 0");
    await expect(
      registration.getByRole("region", { name: "Ordinary return assessment" }),
    ).toContainText("Ordinary return window has elapsed.");
    await expect(registration).toContainText(
      "Register installation to calculate the warranty dates.",
    );
    await registration
      .getByLabel("Installation date", { exact: true })
      .fill(ago(10).slice(0, 10));
    await registration
      .getByLabel("Installer", { exact: true })
      .fill("Synthetic installer");
    await registration
      .getByLabel("Installation site", { exact: true })
      .fill("Synthetic site A");
    await registration
      .getByLabel("Installation evidence reference", { exact: true })
      .fill("synthetic:installation-report-1");
    await registration
      .getByLabel("Reason for registration or correction", { exact: true })
      .fill("Record initial installation");
    // Definitive date rejection must restore editable fields and allow a
    // corrected request, without retaining a retry for the rejected payload.
    for (const invalidDate of [ago(-2).slice(0, 10), ago(100).slice(0, 10)]) {
      await registration
        .getByLabel("Installation date", { exact: true })
        .fill(invalidDate);
      await registration
        .getByRole("button", {
          name: "Review installation registration",
          exact: true,
        })
        .click();
      await registration
        .getByRole("button", {
          name: "Save installation registration",
          exact: true,
        })
        .click();
      await expect(registration.getByRole("alert")).toContainText(
        "Installation must be on or after recorded shipment or replacement handover and cannot be in the future.",
      );
      await expect(
        registration.getByLabel("Installation date", { exact: true }),
      ).toBeEditable();
      await expect(
        registration.getByLabel("Installation site", { exact: true }),
      ).toHaveValue("Synthetic site A");
      await expect(
        registration.getByRole("button", {
          name: "Retry retained registration",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        f.app.warranty.registration.review(f.actor, unitId, f.buyer).history,
      ).toHaveLength(0);
    }
    await registration
      .getByLabel("Installation date", { exact: true })
      .fill(ago(10).slice(0, 10));
    await registration
      .getByRole("button", {
        name: "Review installation registration",
        exact: true,
      })
      .click();
    await expect(
      registration.getByRole("region", {
        name: "Review installation registration",
        exact: true,
      }),
    ).toContainText("Synthetic site A");
    let intercepted = false;
    await page.route(
      "**/api/commands/warranty.registration.save",
      async (route) => {
        if (intercepted) return route.continue();
        intercepted = true;
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        await route.abort("failed");
      },
    );
    await registration
      .getByRole("button", {
        name: "Save installation registration",
        exact: true,
      })
      .click();
    await expect(
      registration.getByRole("button", {
        name: "Retry retained registration",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      f.app.warranty.registration.review(f.actor, unitId, f.buyer).history,
    ).toHaveLength(1);
    // The response was lost after commit: Refresh must keep the exact attempt
    // at revision zero even though its fresh server read is revision one.
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(registration).toContainText(
      "Installation record or ownership changed. Your draft, reviewed revision and retained request were preserved",
    );
    await expect(
      registration.getByRole("button", {
        name: "Retry retained registration",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(registration).toContainText("registration revision 1");
    const retainedReview = registration.getByRole("region", {
      name: "Review installation registration",
      exact: true,
    });
    await expect(retainedReview).toContainText("Synthetic site A");
    await expect(retainedReview).toContainText("Reviewed revision0");
    await page.reload();
    await expect(
      registration.getByRole("button", {
        name: "Retry retained registration",
        exact: true,
      }),
    ).toBeEnabled();
    await registration
      .getByRole("button", { name: "Retry retained registration", exact: true })
      .click();
    await expect(registration).toContainText(
      "Installation registration saved.",
    );
    await registration
      .getByLabel("Sold serial for installation", { exact: true })
      .selectOption(unitId);
    await expect(registration).toContainText("registration revision 1");
    await expect(registration).toContainText(
      "Within the calculated warranty dates.",
    );
    await page.unroute("**/api/commands/warranty.registration.save");
    await registration
      .getByLabel("Installation site", { exact: true })
      .fill("Synthetic corrected site B");
    await registration
      .getByLabel("Reason for registration or correction", { exact: true })
      .fill("Correct installation site reference");
    await registration
      .getByRole("button", {
        name: "Review installation registration",
        exact: true,
      })
      .click();
    await registration
      .getByRole("button", {
        name: "Save installation registration",
        exact: true,
      })
      .click();
    await expect(registration).toContainText("registration revision 2");
    await registration
      .getByText("Installation correction history (2)", { exact: true })
      .click();
    await expect(registration.locator("tbody tr")).toHaveCount(2);
    await expect(registration.locator("tbody")).toContainText(
      "Synthetic site A",
    );
    await expect(registration.locator("tbody")).toContainText(
      "Synthetic corrected site B",
    );
    expect(
      f.app.warranty.registration.review(f.actor, unitId, f.buyer).history,
    ).toHaveLength(2);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await fits();
      await page.screenshot({
        path: testInfo.outputPath(`installation-${width}.png`),
      });
    }
    await navigateCustomerWorkspace(page, "Returns", "Claims and returns");
    await page
      .getByRole("button", { name: "Request return", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request return or warranty review",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Request type", { exact: true }),
    ).toHaveValue("return");
    await dialog
      .getByLabel("Sold serial", { exact: true })
      .selectOption(returnUnitId);
    await expect(dialog).toContainText("Ordinary return window has elapsed.");
    await dialog
      .getByLabel("Issue / reason", { exact: true })
      .fill("Synthetic ordinary return review");
    await dialog
      .getByLabel("Evidence reference", { exact: true })
      .fill("synthetic:ordinary-return-report");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: "Warranty claim", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Request type", { exact: true }),
    ).toHaveValue("warranty");
    await expect(dialog).toContainText("Ordinary return window has elapsed.");
    await dialog
      .getByLabel("Sold serial", { exact: true })
      .selectOption(unitId);
    await expect(dialog).toContainText("Within the calculated warranty dates.");
    await dialog
      .getByLabel("Issue / reason", { exact: true })
      .fill("Synthetic equipment stopped operating");
    await dialog
      .getByLabel("Evidence reference", { exact: true })
      .fill("synthetic:inspection-report");
    await fits();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "submitted for distributor review" }),
    ).toBeVisible();
    const claims = f.app.warranty.list(f.actor);
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.type).sort()).toEqual([
      "return",
      "warranty",
    ]);
    const warrantyClaim = claims.find((claim) => claim.type === "warranty")!;
    const assessment = f.app.warranty.registration.claimAssessment(
      f.actor,
      warrantyClaim.id,
    );
    expect(assessment.snapshot?.registration?.revision).toBe(2);
    expect(assessment.snapshot?.returnEligibility.datePosition).toBe("elapsed");
    expect(assessment.snapshot?.warrantyEligibility.datePosition).toBe(
      "within_dates",
    );
    await navigateCustomerWorkspace(page, "Returns", "Warranty registration");
    await registration
      .getByLabel("Sold serial for installation", { exact: true })
      .selectOption(unitId);
    await registration
      .getByLabel("Installation site", { exact: true })
      .fill("Unsaved site draft");
    await registration
      .getByLabel("Reason for registration or correction", { exact: true })
      .fill("Unsaved reason");
    const beforeCorrection = f.app.warranty.registration.review(
      f.actor,
      unitId,
      f.buyer,
    );
    f.app.warranty.registration.save(f.actor, "browser-concurrent-correction", {
      unitId,
      accountId: f.buyer,
      shipmentId: shipment.id,
      ownershipId: beforeCorrection.ownershipId,
      expectedRevision: 2,
      installedOn: ago(80).slice(0, 10),
      installer: "Synthetic installer",
      site: "Concurrent corrected site C",
      evidence: "synthetic:installation-report-2",
      reason: "Correct independently reviewed installation date",
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(registration).toContainText("registration revision 3");
    await expect(registration).toContainText(
      "Installation record or ownership changed. Your draft, reviewed revision and retained request were preserved",
    );
    await expect(
      registration.getByLabel("Installation site", { exact: true }),
    ).toHaveValue("Unsaved site draft");
    await expect(
      registration.getByRole("textbox", {
        name: "Reason for registration or correction",
        exact: true,
      }),
    ).toHaveValue("Unsaved reason");
    await registration
      .getByRole("button", {
        name: "Reload current installation and discard draft",
        exact: true,
      })
      .click();
    await expect(
      registration.getByLabel("Installation site", { exact: true }),
    ).toHaveValue("Concurrent corrected site C");
    await navigateCustomerWorkspace(page, "Returns", "Claims and returns");
    const claimRow = page
      .getByRole("row")
      .filter({ hasText: "Synthetic equipment stopped operating" });
    await openStockActions(claimRow);
    await claimRow
      .getByRole("button", { name: "Claim coverage snapshot", exact: true })
      .click();
    const submitted = claimRow.getByRole("region", {
      name: "Submitted claim assessment",
      exact: true,
    });
    const current = claimRow.getByRole("region", {
      name: "Current claim assessment",
      exact: true,
    });
    const correctedAssessment = f.app.warranty.registration.claimAssessment(
      f.actor,
      warrantyClaim.id,
    );
    expect(correctedAssessment.snapshot?.registration?.revision).toBe(2);
    expect(correctedAssessment.current.registration?.revision).toBe(3);
    expect(correctedAssessment.current.warrantyEligibility.endAt).not.toBe(
      correctedAssessment.snapshot?.warrantyEligibility.endAt,
    );
    await expect(submitted).toContainText(
      `Warranty end: ${correctedAssessment.snapshot!.warrantyEligibility.endAt}`,
    );
    await expect(current).toContainText(
      `Warranty end: ${correctedAssessment.current.warrantyEligibility.endAt}`,
    );
    f.app.warranty.registration.save(f.actor, "browser-open-claim-correction", {
      unitId,
      accountId: f.buyer,
      shipmentId: shipment.id,
      ownershipId: beforeCorrection.ownershipId,
      expectedRevision: 3,
      installedOn: ago(70).slice(0, 10),
      installer: "Synthetic installer",
      site: "Concurrent corrected site D",
      evidence: "synthetic:installation-report-3",
      reason: "Correct installation while claim assessment is open",
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const refreshedAssessment = f.app.warranty.registration.claimAssessment(
      f.actor,
      warrantyClaim.id,
    );
    await expect(submitted).toContainText(
      `Warranty end: ${correctedAssessment.snapshot!.warrantyEligibility.endAt}`,
    );
    await expect(current).toContainText(
      `Warranty end: ${refreshedAssessment.current.warrantyEligibility.endAt}`,
    );
    const assessmentUrl = `**/api/warranty/claims/${warrantyClaim.id}/assessment`;
    await page.route(assessmentUrl, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic assessment read failure" }),
      }),
    );
    await current
      .getByRole("button", { name: "Refresh current assessment", exact: true })
      .click();
    await expect(submitted).toContainText(
      `Warranty end: ${correctedAssessment.snapshot!.warrantyEligibility.endAt}`,
    );
    await expect(claimRow.getByRole("alert")).toContainText(
      "Synthetic assessment read failure",
    );
    await expect(current).toContainText(
      `Warranty end: ${refreshedAssessment.current.warrantyEligibility.endAt}`,
    );
    await page.unroute(assessmentUrl);
    await claimRow
      .getByRole("button", { name: "Retry retained coverage", exact: true })
      .click();
    await expect(claimRow.getByRole("alert")).toHaveCount(0);
    await expect(submitted).toContainText(
      `Warranty end: ${correctedAssessment.snapshot!.warrantyEligibility.endAt}`,
    );
    await fits();
    expect(errors).toEqual([]);
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});
