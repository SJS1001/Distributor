import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

async function login(page: Page, buyer = false) {
  await page.goto("/#sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "integration-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    buyer ? "Shop" : "Overview",
  );
}
async function noHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll("main *")]
      .filter(
        (element) => element.getBoundingClientRect().right > innerWidth + 1,
      )
      .slice(0, 15)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(
    geometry.width,
  );
}

test("submitted claims require an explicit decision and reason; cancel leaves the claim submitted", async ({
  page,
}) => {
  const decisions: { approved: boolean; reason: string }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/commands/warranty.review"))
      decisions.push(request.postDataJSON());
  });
  await login(page);
  await navigateWorkspace(page, "Returns");
  for (const [issue, approved] of [
    ["integration issue 01", true],
    ["integration issue 02", false],
  ] as const) {
    const row = page.getByRole("row").filter({ hasText: issue });
    await expect(row.getByText("submitted", { exact: true })).toBeVisible();
    const label = approved ? "Approve return" : "Reject request";
    const before = decisions.length;
    await row.getByRole("button", { name: label, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: approved ? "Approve return authorization" : "Reject request",
        exact: true,
      }),
    ).toBeVisible();
    const reason = dialog.getByLabel("Reason / evidence", { exact: true });
    await expect(reason).toHaveAttribute("required", "");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(reason).toBeFocused();
    expect(decisions).toHaveLength(before);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText("submitted", { exact: true })).toBeVisible();
    expect(decisions).toHaveLength(before);
    await row.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic explicit decision review");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      row.getByText(approved ? "approved" : "rejected", { exact: true }),
    ).toBeVisible();
    expect(decisions).toHaveLength(before + 1);
    expect(decisions.at(-1)).toMatchObject({
      approved,
      reason: "Synthetic explicit decision review",
    });
  }
});

test("own sessions show a current marker and readable expiry on desktop and phone", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Security");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const sessions = page.getByRole("list", {
      name: "Your active sessions",
      exact: true,
    });
    await expect(sessions).toBeVisible();
    const current = sessions
      .getByRole("listitem")
      .filter({ hasText: "This session" });
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Expires");
    // Session cards include sign-in, activity and expiry; expiry is the final timestamp.
    const time = current.locator("time").last();
    await expect(time).toBeVisible();
    expect(Date.parse((await time.getAttribute("datetime"))!)).toBeGreaterThan(
      Date.now(),
    );
    expect((await time.innerText()).trim()).not.toMatch(/^\d{12,}$/);
    await noHorizontalOverflow(page);
  }
});

test("phone Account tabs expose commercial, data location and sign-in sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await navigateWorkspace(page, "Customers");
  const topics = page.getByRole("tablist", {
    name: "Customer workspace sections",
    exact: true,
  });
  for (const label of [
    "Overview & terms",
    "Data location",
    "Sign-in security",
  ]) {
    const tab = topics.getByRole("tab", { name: label, exact: true });
    await tab.click();
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel", { name: label, exact: true }),
    ).toBeVisible();
  }
  await noHorizontalOverflow(page);
});

test("phone orders show status before collapsed item details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await navigateWorkspace(page, "Orders");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator("details.order-items") })
    .first();
  const details = row.locator("details.order-items");
  await expect(details.locator("summary")).toHaveText(
    "View items and quantities",
  );
  expect(
    await details.evaluate((element) => (element as HTMLDetailsElement).open),
  ).toBe(false);
  await expect(row.locator(".badge").first()).toBeVisible();
  expect(
    await row.evaluate((element) => {
      const badge = element.querySelector(".badge")!;
      const items = element.querySelector("details.order-items")!;
      return !!(
        badge.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    }),
  ).toBe(true);
  await details.locator("summary").click();
  await expect(details.getByText("EQ-1", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("invoice and stock filtered empty states recover to real rows; download history uses readable time", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Billing", "Invoices");
  const invoices = page.getByRole("region", {
    name: "Invoice queue",
    exact: true,
  });
  await expect(invoices.getByRole("status")).toContainText("1 invoice loaded");
  await page
    .getByLabel("Invoice balance", { exact: true })
    .selectOption("settled");
  await expect(
    page.getByText("No invoices match this balance filter.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all invoices", exact: true })
    .click();
  await expect(page.getByLabel("Invoice balance", { exact: true })).toHaveValue(
    "",
  );
  await expect(invoices.getByRole("status")).toContainText("1 invoice loaded");
  const historyHeading = page.getByRole("heading", {
    name: "Download request history",
    exact: true,
  });
  await expect(historyHeading).toBeVisible();
  const history = historyHeading.locator("xpath=../following-sibling::div[1]");
  const time = history.locator("time").first();
  await expect(time).toBeVisible();
  expect(
    Number.isFinite(Date.parse((await time.getAttribute("datetime"))!)),
  ).toBe(true);
  expect((await time.innerText()).trim()).not.toMatch(/^\d{12,}$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await history.locator("summary").filter({ hasText: "File details" }).click();
  await history.locator("summary").filter({ hasText: "SHA-256" }).click();
  await expect(history.locator("code")).toHaveText(/^[a-f0-9]{64}$/);
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await navigateWorkspace(page, "Inventory", "Stock");
  const stock = page.getByRole("region", { name: "Stock queue", exact: true });
  await expect(stock.getByRole("status")).toContainText("stock records loaded");
  await page
    .getByLabel("Search stock serial or bin", { exact: true })
    .fill("SYNTHETIC-NO-MATCH");
  await stock
    .getByRole("button", { name: "Search stock", exact: true })
    .click();
  await expect(
    page.getByText("No stock matches these filters.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear stock filters", exact: true })
    .click();
  await expect(
    page.getByLabel("Search stock serial or bin", { exact: true }),
  ).toHaveValue("");
  await expect(stock.getByRole("status")).not.toContainText(
    "0 stock records loaded",
  );
  await expect(
    page.getByText("No stock matches these filters.", { exact: true }),
  ).toHaveCount(0);
});

test("staff order detail returns focus to that order action summary after restoration settles", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Orders", "Orders");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator(".badge").filter({ hasText: /^open$/ }) })
    .first();
  const summary = row.locator("summary[id^=order-actions-]");
  const id = await summary.getAttribute("id");
  await row.getByRole("button", { name: /^Open order / }).click();
  const detail = page.getByRole("region", {
    name: "Focused order detail",
    exact: true,
  });
  await expect(detail).toBeVisible();
  await detail
    .getByRole("button", { name: "View this order in All orders", exact: true })
    .click();
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toBeFocused();
  await page.waitForTimeout(250);
  await expect(target).toBeFocused();
  await target.press("Enter");
  expect(
    await target.evaluate(
      (element) => (element.parentElement as HTMLDetailsElement).open,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  const picking = page.getByRole("region", {
    name: "Fulfill an order",
    exact: true,
  });
  await expect(picking).toContainText("pick its allocated stock");
  await picking
    .getByRole("button", { name: "Review packed shipments", exact: true })
    .click();
  const handover = page.getByRole("region", {
    name: "Complete shipment handover",
    exact: true,
  });
  await expect(handover).toContainText(
    "Packing alone does not complete delivery or create an invoice.",
  );
  await noHorizontalOverflow(page);
  await handover
    .getByRole("button", {
      name: "Return to orders to pick and pack",
      exact: true,
    })
    .click();
  await expect(picking).toBeVisible();
  await noHorizontalOverflow(page);
});

test("phone invoice detail keeps current balance and all line amounts inside the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await navigateWorkspace(page, "Billing", "Invoices");
  await page
    .locator(".record-title-link")
    .filter({ hasText: "INV" })
    .first()
    .click();
  const detail = page.getByRole("region", {
    name: "Invoice detail",
    exact: true,
  });
  await expect(detail).toBeVisible();
  await expect(detail.locator(".record-figures > div").first()).toContainText(
    "Current balance",
  );
  await expect(
    detail.getByRole("region", { name: "Invoice line records", exact: true }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
});
