import { test, expect } from "@playwright/test";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept, ship } from "./fixtures.ts";
import {
  navigateWorkspace,
  navigateCustomerWorkspace,
} from "./workspace-navigation.ts";

test("repaired original handover recovers its readable receipt after reload following a lost committed reply", async ({
  page,
}) => {
  const cleanup: (() => void)[] = [];
  const f = fixture({ after: (fn) => cleanup.push(fn) });
  ship(f, accept(f).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const beforeCoverage = f.app.warranty.coverage(f.actor, unitId, f.buyer);
  const claim = f.app.warranty.submit(f.actor, "repair-request", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic repaired original",
    evidence: "Synthetic evidence",
  });
  f.app.warranty.review(f.actor, "approve", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "receive", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: claim.id,
    findings: "Synthetic findings",
  });
  f.app.warranty.dispose(f.actor, "repair", {
    claimId: claim.id,
    disposition: "repair",
    reason: "Synthetic repair",
  });
  f.app.identity.createUser(f.actor, "repair-buyer", {
    email: "repair-buyer@example.test",
    password: "synthetic-buyer-password",
    name: "Repair buyer",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    requirePasswordChange: false,
  });
  const origin = "http://127.0.0.1:3281";
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
  const login = async (email: string, password: string) => {
    await page.goto(
      origin +
        (email === "admin@example.test"
          ? "/#admin-sign-in"
          : "/#customer-sign-in"),
    );
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toBeVisible();
  };
  try {
    await http.listen({ host: "127.0.0.1", port: 3281 });
    await page.setViewportSize({ width: 390, height: 844 });
    await login("admin@example.test", "long-test-only-password");
    await navigateWorkspace(page, "Returns", "Claims and returns");
    await page
      .getByRole("button", { name: "Return repaired equipment", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("serial S1");
    await dialog.getByLabel("Scan repaired serial", { exact: true }).fill("S1");
    await dialog
      .getByLabel("Handover recipient", { exact: true })
      .fill("Synthetic recipient");
    await dialog
      .getByLabel("Collection or carrier handover evidence", { exact: true })
      .fill("Synthetic signed collection");
    await dialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic repair complete");
    const attempts: { body: string | null; key: string | undefined }[] = [];
    await page.route(
      "**/api/commands/warranty.repair.handover",
      async (route) => {
        attempts.push({
          body: route.request().postData(),
          key: route.request().headers()["idempotency-key"],
        });
        if (attempts.length === 1) {
          const result = await route.fetch();
          expect(result.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    const confirm = dialog.getByRole("button", {
      name: "Confirm repaired equipment handover",
      exact: true,
    });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(f.app.inventory.trace(f.actor, "S1").unit.state).toBe("sold");
    await page.reload();
    await navigateWorkspace(page, "Returns", "Claims and returns");
    expect(attempts).toHaveLength(1);
    await page
      .getByLabel(`Actions for claim ${claim.id.slice(0, 8)}`, { exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "View repaired equipment handover",
        exact: true,
      })
      .click();
    const receipt = page.getByRole("dialog");
    await expect(receipt).toContainText("Repaired equipment handover receipt");
    await expect(receipt).toContainText("Synthetic recipient");
    await expect(receipt).toContainText("Synthetic signed collection");
    await expect(receipt).toContainText("Synthetic repair complete");
    await expect(receipt).toContainText("S1");
    await receipt
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByText("Repaired equipment handed over", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Issue return credit", exact: true }),
    ).toHaveCount(0);
    expect(
      f.app.inventory
        .trace(f.actor, "S1")
        .movements.filter((m) => m.type === "repair.handover"),
    ).toHaveLength(1);
    expect(f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd).toBe(
      beforeCoverage.coverageEnd,
    );
    const activityAction = page.getByRole("button", {
      name: "Claim activity",
      exact: true,
    });
    if (!(await activityAction.isVisible()))
      await page
        .getByLabel(`Actions for claim ${claim.id.slice(0, 8)}`, {
          exact: true,
        })
        .click();
    await activityAction.click();
    const activity = page.getByRole("region", {
      name: "Claim activity",
      exact: true,
    });
    await expect(activity).toContainText("Original serial");
    await expect(activity).toContainText("Synthetic recipient");
    await expect(activity).toContainText("Synthetic signed collection");
    await expect(activity).not.toContainText('"version":1');
    await activity
      .getByRole("button", { name: "Close claim activity", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login("repair-buyer@example.test", "synthetic-buyer-password");
    await navigateCustomerWorkspace(page, "Returns", "Claims and returns");
    await expect(
      page.getByText("Repaired equipment handed over", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Your original equipment has been returned. Its existing warranty dates are preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Return repaired equipment",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByLabel(`Actions for claim ${claim.id.slice(0, 8)}`, { exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "View repaired equipment handover",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText("S1");
    await expect(page.getByRole("dialog")).not.toContainText(
      "Synthetic recipient",
    );
    await expect(page.getByRole("dialog")).not.toContainText(
      "Synthetic signed collection",
    );
    await expect(page.getByRole("dialog")).not.toContainText(
      "Synthetic repair complete",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await http.close();
    cleanup.reverse().forEach((fn) => fn());
  }
});
