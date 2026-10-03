import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:3167";
const panel = (page: Page) =>
  page.getByRole("region", { name: "Approved cost corrections", exact: true });
const review = (page: Page) =>
  page.getByRole("region", {
    name: "Saved account mapping correction",
    exact: true,
  });
async function signIn(page: Page, email = "admin@example.test") {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Billing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load stock cost review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review CORRECTION-ORIGINAL", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Load cost corrections", exact: true })
    .click();
  await expect(
    panel(page)
      .getByText(/correction policy|Correction policy/)
      .first(),
  ).toBeVisible();
}
async function prepare(
  page: Page,
  outcome = "posted",
  reason = "Synthetic browser mapping correction",
) {
  const form = panel(page).getByRole("form", {
    name: "Prepare approved cost correction",
  });
  await form
    .getByLabel("Correction posting date", { exact: true })
    .fill("2026-10-03");
  await form
    .getByLabel("Verified original ledger outcome", { exact: true })
    .selectOption(outcome);
  await form
    .getByLabel("Correction ledger receiver", { exact: true })
    .fill("synthetic-browser-ledger");
  await form
    .getByLabel("Original ledger outcome reference", { exact: true })
    .fill("synthetic-browser-original");
  await form
    .getByLabel("Original ledger posting date", { exact: true })
    .fill("2026-09-29");
  await form
    .getByLabel("Verified ledger outcome evidence", { exact: true })
    .fill("Synthetic ledger reviewed");
  await form
    .getByLabel("Prior period accountant review", { exact: true })
    .fill("Synthetic accountant reviewed");
  await form
    .getByLabel("Account mapping correction reason", { exact: true })
    .fill(reason);
  return form;
}
test("browser: phone correction retries exact attempts, requires separate finance and downloads immutable balanced journals", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  const before = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  await panel(page)
    .getByText("Configure correction policy", { exact: true })
    .click();
  const policy = panel(page).getByRole("form", {
    name: "Configure stock cost correction policy",
  });
  for (const [label, value] of [
    ["Correction policy version", "synthetic-v1"],
    ["Correction mapping version", "synthetic-chart-v2"],
    [
      "Established valuation and finance basis",
      "Synthetic established valuation retained",
    ],
    ["Closed through date", "2026-09-30"],
    ["Corrected inventory account", "1201"],
    [
      "Corrected movement mappings (JSON)",
      '[{"type":"receipt","offsetAccount":"2101"}]',
    ],
    [
      "Responsible finance policy evidence",
      "Synthetic responsible finance approval",
    ],
  ] as const)
    await policy.getByLabel(label, { exact: true }).fill(value);
  const attempts: string[] = [];
  await page.route("**/api/commands/accounting.cost.policy", async (route) => {
    attempts.push(route.request().postData()!);
    if (attempts.length === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await policy.getByRole("button", { name: "Save correction policy" }).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await policy.getByRole("button", { name: "Save correction policy" }).click();
  await expect(panel(page)).toContainText("Correction policy revision 1");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await page.unrouteAll({ behavior: "wait" });
  const form = await prepare(page);
  const corrections: string[] = [];
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      corrections.push(route.request().postData()!);
      if (corrections.length === 1) {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    },
  );
  await form.getByRole("button", { name: "Prepare cost correction" }).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await form.getByRole("button", { name: "Prepare cost correction" }).click();
  await expect(review(page)).toBeFocused();
  await expect(review(page)).toContainText("State: ready");
  expect(corrections).toHaveLength(2);
  expect(corrections[1]).toBe(corrections[0]);
  await page.unrouteAll({ behavior: "wait" });
  await review(page)
    .getByLabel("Correction review decision", { exact: true })
    .selectOption("approve");
  await review(page)
    .getByLabel("Independent correction review reason", { exact: true })
    .fill("Synthetic self review refused");
  await review(page)
    .getByRole("button", { name: "Record correction decision" })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    /different|separate/i,
  );
  await expect(review(page)).toContainText("State: ready");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const otherContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const other = await otherContext.newPage();
  try {
    await signIn(other, "finance@example.test");
    await panel(other)
      .getByRole("button", { name: /^Open cost correction / })
      .click();
    await review(other)
      .getByLabel("Correction review decision", { exact: true })
      .selectOption("approve");
    await review(other)
      .getByLabel("Independent correction review reason", { exact: true })
      .fill("Synthetic independent finance reviewed");
    await review(other)
      .getByRole("button", { name: "Record correction decision" })
      .click();
    await expect(review(other)).toContainText("State: reviewed");
    const download = other.waitForEvent("download");
    await review(other)
      .getByRole("button", { name: "Download approved cost correction" })
      .click();
    const bytes = await readFile((await (await download).path())!);
    const artifact = JSON.parse(bytes.toString());
    const hash = createHash("sha256").update(bytes).digest("hex");
    await expect(review(other)).toContainText(hash);
    expect(artifact.reversal).toHaveLength(6);
    expect(artifact.replacement).toHaveLength(6);
    for (const lines of [artifact.reversal, artifact.replacement])
      expect(lines.reduce((s: number, l: any) => s + l.debit, 0)).toBe(
        lines.reduce((s: number, l: any) => s + l.credit, 0),
      );
    expect(artifact.replacement[0].account).toBe("1201");
    expect(artifact.preparedBy).not.toBe(artifact.reviewedBy);
    expect(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await otherContext.close();
  }
  const after = await (
    await page.request.get(`${origin}/api/dashboard`)
  ).json();
  expect(after.stock).toEqual(before.stock);
  expect(errors).toEqual([]);
});
test("browser: correction reads discard responses after navigation and sign-out", async ({
  page,
}) => {
  await signIn(page);
  for (const action of ["navigate", "signout"]) {
    let started!: () => void, release!: () => void;
    const reading = new Promise<void>((r) => (started = r)),
      held = new Promise<void>((r) => (release = r));
    await page.route("**/api/accounting/cost-policy", async (route) => {
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await panel(page)
      .getByRole("button", { name: "Refresh cost corrections", exact: true })
      .click();
    await reading;
    if (action === "navigate")
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Overview", exact: true })
        .click();
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(panel(page)).toHaveCount(0);
    if (action === "navigate") {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Billing", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Load stock cost review", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Review CORRECTION-ORIGINAL",
          exact: true,
        })
        .click();
      await panel(page)
        .getByRole("button", { name: "Load cost corrections", exact: true })
        .click();
      await expect(
        panel(page).getByRole("button", {
          name: "Refresh cost corrections",
          exact: true,
        }),
      ).toBeEnabled();
    }
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
