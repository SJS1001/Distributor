import { test, expect, type Page, type Locator } from "@playwright/test";
import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";

// This dedicated fixture is HTTP loopback. WebKit upgrades loopback assets under
// Helmet's production CSP; remove only that directive from fixture HTML receipts.
// This does not establish production HTTPS/CSP or physical-device acceptance.
async function adaptWebkitHttp(page: Page) {
  if (page.context().browser()?.browserType().name() !== "webkit") return;
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"])
      headers["content-security-policy"] = headers[
        "content-security-policy"
      ].replace(/(?:^|;)\s*upgrade-insecure-requests(?=;|$)/g, "");
    await route.fulfill({ response, headers });
  });
}
test.beforeEach(async ({ page }) => adaptWebkitHttp(page));

async function login(page: Page, buyer = false) {
  await page.goto(buyer ? "/#customer-sign-in" : "/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(buyer ? "completion-buyer@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    })),
  ).toEqual({ width: 320, scroll: 320 });
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `local-evidence/ui-ux-completion-2026-10-07/${page.context().browser()?.browserType().name()}-${name}.png`,
  });
}
async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const luminance = (color: string) => {
      const values = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
    };
    let parent: Element | null = element,
      background = "rgb(255, 255, 255)";
    while (parent) {
      const bg = getComputedStyle(parent).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        background = bg;
        break;
      }
      parent = parent.parentElement;
    }
    const color = getComputedStyle(element).color,
      a = luminance(color),
      b = luminance(background);
    return {
      color,
      background,
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    };
  });
}

test("320px buyer reports and invoice keep actual money intact and visible secondary text at normal contrast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page, true);
  await navigateWorkspace(page, "Overview");
  const amounts = page.locator(".metric-card > strong");
  await expect(amounts.first()).toBeVisible();
  for (const amount of await amounts.all()) {
    if (/CAD|USD/.test(await amount.innerText())) {
      await expect(amount).toHaveCSS("white-space", "nowrap");
      expect(
        await amount.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length;
        }),
      ).toBe(1);
    }
  }
  const secondary = page.locator(
    ".metric-hint, .quick-access-hint, .aging-zero",
  );
  expect(await secondary.count()).toBeGreaterThan(0);
  for (const label of await secondary.all())
    expect((await contrast(label)).ratio).toBeGreaterThanOrEqual(4.5);
  await noOverflow(page);
  await screenshot(page, "buyer-reports-320");
  await navigateWorkspace(page, "Billing", "Invoices");
  await page
    .locator(".record-title-link")
    .filter({ hasText: "SYNTHETIC-completion" })
    .first()
    .click();
  const detail = page.getByRole("region", {
    name: "Invoice detail",
    exact: true,
  });
  await expect(detail.locator(".record-figures > div").first()).toContainText(
    "Current balance",
  );
  await expect(detail.locator(".record-figures dd")).toHaveCount(5);
  for (const amount of await detail.locator(".record-figures dd").all())
    await expect(amount).toHaveCSS("white-space", "nowrap");
  const lines = detail.getByRole("region", {
    name: "Invoice line records",
    exact: true,
  });
  await expect(lines).toHaveAttribute("tabindex", "0");
  await lines.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(lines.locator('td[data-label="Line total"]')).toHaveText(
    "CAD 113.00",
  );
  await noOverflow(page);
  await screenshot(page, "invoice-320-local-scroll");
});

test("320px staff customer label passes actual cascade contrast and retains credit-limit context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page);
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  const label = page.locator(".customer-record .eyebrow");
  await expect(label).toHaveText("Customer record");
  expect((await contrast(label)).ratio).toBeGreaterThanOrEqual(4.5);
  await expect(
    page.getByText("Credit limit", { exact: true }).first(),
  ).toBeVisible();
  await noOverflow(page);
  await screenshot(page, "customer-record-320");
});

test("long financial transaction report retains visible sticky columns while vertically and horizontally scrolled", async ({
  page,
}) => {
  await login(page);
  const report = page.getByRole("region", {
    name: "Sales and adjustment report",
  });
  await report.getByLabel("Report from").fill("2026-09-01");
  await report.getByLabel("Report through").fill("2026-10-07");
  await report.getByRole("button", { name: "Apply report period" }).click();
  await report.getByRole("tab", { name: "Transactions", exact: true }).click();
  const figures = report.getByRole("region", {
    name: "Report figures",
    exact: true,
  });
  expect(await figures.getByRole("row").count()).toBeGreaterThan(40);
  await figures.scrollIntoViewIfNeeded();
  await figures.focus();
  await figures.press("PageDown");
  await expect
    .poll(() => figures.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(figures.locator("thead")).toHaveCSS("position", "sticky");
  expect(
    await figures.evaluate((el) =>
      Math.abs(
        el.querySelector("thead")!.getBoundingClientRect().top -
          el.getBoundingClientRect().top,
      ),
    ),
  ).toBeLessThanOrEqual(3);
  await screenshot(page, "long-report-sticky-header");
  await page.setViewportSize({ width: 320, height: 640 });
  await figures.scrollIntoViewIfNeeded();
  await figures.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = 700;
  });
  await expect(
    figures.getByRole("columnheader", { name: "Document", exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
  await screenshot(page, "long-report-320-scroll");
});

test("short viewport quantity editor keeps final actions accessible, keyboard focus contained and close restores opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await login(page, true);
  await page
    .getByRole("button", { name: "View Synthetic equipment", exact: true })
    .click();
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page
    .locator(".sf-local-feedback")
    .getByRole("button", { name: "View cart", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ship from warehouse", exact: true })
    .selectOption({ label: "Toronto" });
  const opener = page.getByRole("button", {
    name: "Review order quantities",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const actions = dialog.locator("form > .actions").last();
  await expect(actions).toHaveCSS("position", "sticky");
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    actions.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeInViewport();
  await screenshot(page, "quantity-editor-320x400");
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({
      contained: document
        .querySelector('[role="dialog"]')!
        .contains(document.activeElement),
      element: document.activeElement?.outerHTML.slice(0, 500),
    }));
    expect(focus.contained, `Tab ${i + 1}: ${focus.element}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await noOverflow(page);
});

test("mobile count policy short labels retain qualifying help and cancellation sends no policy command", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 500 });
  const commands: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/commands/")) commands.push(req.url());
  });
  await login(page);
  await navigateWorkspace(page, "Inventory", "Cycle counts");
  await page
    .locator("summary")
    .filter({ hasText: "Count review policy and configuration" })
    .click();
  await page
    .getByRole("button", { name: "Configure count review", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const policy = dialog.getByLabel("Approval duties", { exact: true });
  await expect(policy.locator("option")).toHaveText([
    "Select…",
    "Administrator review",
    "Independent review",
  ]);
  await policy.selectOption("independent");
  await expect(
    dialog.getByText(
      "Administrator review permits self-review and direct corrections. Independent review requires an administrator other than the count starter and observer.",
      { exact: true },
    ),
  ).toBeVisible();
  await screenshot(page, "count-policy-320");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(commands.filter((url) => url.endsWith("/count.policy"))).toEqual([]);
  await noOverflow(page);
});

test("loaded access search is case insensitive, no-match recovers, buyer role activates required account field", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Administration", "Staff and buyer access");
  const search = page.getByLabel("Find staff or buyer access", { exact: true });
  await search.fill("SYNTHETIC COMPLETION BUYER");
  await expect(
    page.getByRole("row").filter({ hasText: "Synthetic completion buyer" }),
  ).toHaveCount(1);
  await search.fill("missing-user-unique");
  await expect(
    page.getByText("No users match this search.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const account = dialog.getByLabel("Buyer account (buyer role only)", {
    exact: true,
  });
  await expect(account).toBeDisabled();
  await dialog.getByLabel("Role", { exact: true }).selectOption("buyer");
  await expect(account).toBeEnabled();
  await expect(account).toHaveAttribute("required", "");
  await dialog.getByLabel("Role", { exact: true }).selectOption("warehouse");
  await expect(account).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("stock inspection keeps selected record identity and billing identity keeps the selected customer context", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Inventory", "Stock");
  const row = page
    .getByRole("row")
    .filter({ hasText: "EQ-1" })
    .filter({ has: page.locator("details.stock-actions") })
    .first();
  await openStockActions(row);
  await row.getByRole("button", { name: "Inspect", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("EQ-1");
  await expect(dialog).toContainText("Stock ID");
  await expect(dialog).toContainText("bin");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigateWorkspace(page, "Billing", "Account aging");
  await page
    .getByRole("row")
    .filter({ hasText: "Synthetic buyer" })
    .getByRole("button", { name: "Edit billing details", exact: true })
    .click();
  await expect(dialog).toContainText("Customer: Synthetic buyer");
  await expect(dialog).toContainText("Customer ID");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("aging investigation preserves pagination and unknown due filters across invoice actions and refresh recovery", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Billing", "Account aging");
  await page
    .getByRole("button", {
      name: "Synthetic buyer · Investigate account balance",
      exact: true,
    })
    .click();
  const investigation = page.getByRole("region", {
    name: "Account balance investigation",
    exact: true,
  });
  await expect(
    investigation.getByRole("heading", {
      name: "Synthetic buyer · Balance investigation",
      exact: true,
    }),
  ).toBeFocused();
  const filter = investigation.getByLabel("Investigate", { exact: true });
  await filter.selectOption("all");
  await expect(investigation.getByRole("status")).toContainText("20 of 45");
  await investigation
    .getByRole("button", { name: "Show more matching invoices", exact: true })
    .click();
  await expect(investigation.getByRole("status")).toContainText("40 of 45");
  await investigation
    .getByRole("button", { name: "Show more matching invoices", exact: true })
    .click();
  await expect(investigation.getByRole("status")).toContainText("45 of 45");
  await investigation
    .getByRole("button", {
      name: /SYNTHETIC-completion-invoice-000 · Investigate invoice/,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Invoice detail", exact: true }),
  ).toContainText("SYNTHETIC-completion-invoice-000");
  const paymentCommands: string[] = [];
  const paymentListener = (req: import("@playwright/test").Request) => {
    if (req.url().includes("/api/commands/billing.payment.manual"))
      paymentCommands.push(req.url());
  };
  page.on("request", paymentListener);
  const invoice = page.getByRole("region", {
    name: "Invoice detail",
    exact: true,
  });
  await invoice.locator("summary").filter({ hasText: "More actions" }).click();
  await invoice
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  const paymentDialog = page.getByRole("dialog");
  await expect(paymentDialog).toContainText("Record verified manual payment");
  await expect(
    paymentDialog.getByLabel("Amount in cents", { exact: true }),
  ).toHaveValue("11300");
  await paymentDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(paymentCommands).toEqual([]);
  page.off("request", paymentListener);
  await page
    .getByRole("button", { name: /Account balance investigation/ })
    .click();
  await expect(filter).toHaveValue("all");
  await expect(investigation.getByRole("status")).toContainText("45 of 45");
  await filter.selectOption("unknownDue");
  await expect(investigation.getByRole("status")).toContainText("15 of 15");
  const rows = investigation.locator("tbody tr");
  await expect(rows).toHaveCount(15);
  for (const row of await rows.all()) {
    await expect(row.locator("td").nth(1)).toContainText("Unknown due date");
    await expect(row.locator("td").nth(6)).toHaveText("CAD 113.00");
  }
  const observed = await investigation
    .locator("time")
    .first()
    .getAttribute("datetime");
  await page.route("**/api/billing/aging", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic aging refresh unavailable" }),
    }),
  );
  await investigation
    .getByRole("button", { name: "Refresh account balances", exact: true })
    .click();
  await expect(investigation.getByRole("alert")).toContainText(
    "Showing the last successful observation",
  );
  await expect(investigation.locator("time").first()).toHaveAttribute(
    "datetime",
    observed!,
  );
  await expect(rows).toHaveCount(15);
  await page.unroute("**/api/billing/aging");
  await investigation
    .getByRole("button", { name: "Retry account balances", exact: true })
    .click();
  await expect(investigation.getByRole("alert")).toHaveCount(0);
  await expect(filter).toHaveValue("unknownDue");
  await expect(rows).toHaveCount(15);
  await page.setViewportSize({ width: 320, height: 640 });
  await noOverflow(page);
  await screenshot(page, "aging-investigation-320");
});

test("ending another synthetic session retains current access and ending current session returns to sign in", async ({
  page,
  browser,
}) => {
  await login(page);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await adaptWebkitHttp(otherPage);
  await login(otherPage);
  await navigateWorkspace(page, "Security");
  const sessions = page.getByRole("list", {
    name: "Your active sessions",
    exact: true,
  });
  const others = sessions
    .getByRole("listitem")
    .filter({ hasNotText: "This session" });
  expect(await others.count()).toBeGreaterThan(0);
  const selectedReference = await others.first().locator("small").innerText();
  await others.first().getByRole("button").click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("End only the selected signed-in session");
  await expect(dialog).toContainText(
    selectedReference.replace("Session reference: ", ""),
  );
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("incorrect-test-only-password");
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Saved session end", exact: true }),
  ).toHaveCount(0);
  await expect(
    sessions.getByRole("listitem").filter({ hasText: selectedReference }),
  ).toHaveCount(1);
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#workspace-title")).toHaveText("Security");
  await expect(
    sessions.getByRole("listitem").filter({ hasText: selectedReference }),
  ).toHaveCount(0);
  const current = sessions
    .getByRole("listitem")
    .filter({ hasText: "This session" });
  await current.getByRole("button").click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("You will need to sign in again");
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.locator("#workspace-title")).toHaveCount(0);
  await other.close();
});

test("loaded receipt search recovers and provider and catalog routes expose direct task controls", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Purchasing", "Purchase orders");
  await expect(
    page.getByRole("button", { name: "Create purchase order", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Purchasing", "Receipts & returns");
  const search = page.getByLabel("Find a receipt in the loaded records", {
    exact: true,
  });
  await search.fill("del-1");
  await expect(page.getByRole("row").filter({ hasText: "DEL-1" })).toHaveCount(
    1,
  );
  await search.fill("eq-1");
  await expect(page.getByRole("row").filter({ hasText: "DEL-1" })).toHaveCount(
    1,
  );
  await search.fill("unique-missing-delivery");
  await expect(
    page.getByText("No matching receipts in the loaded records.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear receipt search", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("row").filter({ hasText: "DEL-1" })).toHaveCount(
    1,
  );
  await navigateWorkspace(page, "Catalog");
  const reference = page.locator("details.catalog-reference");
  await expect(reference).not.toHaveAttribute("open", "");
  await expect(reference.locator("summary")).toHaveText(
    "Manufacturer reference library",
  );
  await expect(
    page.getByRole("columnheader", {
      name: "Base price (staff reference)",
      exact: true,
    }),
  ).toBeVisible();
  await navigateWorkspace(page, "Billing", "Provider activity");
  await expect(
    page.getByText(
      /No provider operations have been queued. Native invoices and payments remain available/,
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open invoices", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Invoices", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("lost current-session end reply retains exact retry through same-actor sign in without ending replacement session", async ({
  page,
}) => {
  await login(page);
  await navigateWorkspace(page, "Security");
  const attempts: { key: string | undefined; payload: unknown }[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/commands/user.session.end-own"))
      attempts.push({
        key: req.headers()["idempotency-key"],
        payload: req.postDataJSON(),
      });
  });
  let loseReply = true;
  await page.route("**/api/commands/user.session.end-own", async (route) => {
    if (!loseReply) return route.continue();
    loseReply = false;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });
  const sessions = page.getByRole("list", {
    name: "Your active sessions",
    exact: true,
  });
  await sessions
    .getByRole("listitem")
    .filter({ hasText: "This session" })
    .getByRole("button")
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await dialog
    .getByRole("button", { name: "End session", exact: true })
    .click();
  const saved = page.getByRole("region", {
    name: "Saved session end",
    exact: true,
  });
  await expect(saved).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "saved attempt remains available",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  // The failed transport reply leaves the old cookie until an authenticated
  // retry discovers that its original session has already ended.
  await saved
    .getByRole("button", { name: "Retry ending selected session", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Recover saved session end");
  await expect(
    dialog.getByLabel("Your current password", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await dialog
    .getByRole("button", { name: "Retry session end", exact: true })
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await login(page);
  await navigateWorkspace(page, "Security");
  await saved
    .getByRole("button", { name: "Retry ending selected session", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Your current password", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await dialog
    .getByRole("button", { name: "Retry session end", exact: true })
    .click();
  await expect(
    page.getByText(
      "The selected session has ended. Your current sign-in stays active.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("#workspace-title")).toHaveText("Security");
  await expect(
    sessions.getByRole("listitem").filter({ hasText: "This session" }),
  ).toHaveCount(1);
  expect(attempts).toHaveLength(3);
  expect(attempts[0]?.key).toBeTruthy();
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toEqual(attempts[0]);
});
