import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3150";
test("browser: phone operations health exposes full redacted queues and hold, clears failed refresh and abandons navigation/sign-out reads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("support@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Operations health");
  const panel = page.getByRole("region", {
    name: "Operations health",
    exact: true,
  });
  await expect(panel).toContainText("Recovery hold active");
  const stripe = panel.getByRole("region", {
    name: "Stripe effects",
    exact: true,
  });
  await expect(stripe).toContainText("pending: 34");
  await expect(stripe).toContainText("unknown: 1 · Operator review required");
  await expect(stripe).toContainText("Created 2020-01-02 03:04 UTC");
  await expect(
    panel.getByRole("region", { name: "Local event reporting", exact: true }),
  ).toContainText("Consumer disabled");
  await expect(
    panel.getByRole("region", { name: "Refund outcome checks", exact: true }),
  ).toContainText("requires action: 1");
  await expect(panel).not.toContainText("PRIVATE");
  const response = await page.request.get(`${origin}/api/operations/health`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.json()).queues).toHaveLength(11);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.route("**/api/operations/health", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "SYNTHETIC_OUTAGE",
        message: "Synthetic health outage",
      }),
    }),
  );
  await panel
    .getByRole("button", { name: "Refresh operations health", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic health outage",
  );
  await expect(stripe).toHaveCount(0);
  await page.unroute("**/api/operations/health");
  await panel
    .getByRole("button", { name: "Refresh operations health", exact: true })
    .click();
  await expect(stripe).toContainText("pending: 34");

  for (const destination of ["Overview", "sign-out"]) {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/operations/health", async (route) => {
      const native = await route.fetch();
      entered();
      await held;
      await route
        .fulfill({
          response: native,
          json: { ...(await native.json()), region: "ABANDONED-RESULT" },
        })
        .catch(() => {});
    });
    await panel
      .getByRole("button", { name: "Refresh operations health", exact: true })
      .click();
    await started;
    if (destination === "sign-out") {
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    } else {
      await navigateWorkspace(page, destination);
      await expect(
        page.getByRole("heading", { name: destination, exact: true }),
      ).toBeVisible();
    }
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(
      page.getByText("ABANDONED-RESULT", { exact: false }),
    ).toHaveCount(0);
    await expect(panel).toHaveCount(0);
    if (destination !== "sign-out") {
      await navigateWorkspace(page, "Operations health");
      await expect(stripe).toContainText("pending: 34");
    }
  }
  expect(errors).toEqual([]);
});
