import "./operations-health-browser-journey.ts";
import "./bin-relocation-browser-journey.ts";
import "./stock-history-browser-journey.ts";
import "./supplier-return-queue-browser-journey.ts";
import "./catalog-lifecycle-browser-journey.ts";
import "./react-render-browser-journey.ts";
import "./catalog-entry-browser-journey.ts";
import { stockFactsDashboard } from "./stock-browser-facts.ts";
import "./customer-pricing-browser-journey.ts";
import "./cart-recovery-browser-journey.ts";
import "./stock-queue-browser-journey.ts";
import "./invoice-queue-browser-journey.ts";
import "./purchase-queue-browser-journey.ts";
import "./purchase-entry-browser-journey.ts";
import "./order-queue-browser-journey.ts";
import "./replacement-carrier-browser-journey.ts";
import "./shipment-coverage-browser-journey.ts";
import "./reconciliation-browser-journey.ts";
import "./claim-queue-browser-journey.ts";
import { test, expect, type Page } from "@playwright/test";
import { totp } from "../src/server/totp.ts";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import "./quickbooks-browser-journey.ts";
import "./canada-post-browser-journey.ts";
import "./carrier-claim-browser-journey.ts";
import "./carrier-configuration-browser-journey.ts";
import "./dhl-warehouse-browser-journey.ts";
import "./zpl-browser-journey.ts";
import "./count-policy-browser-journey.ts";
import "./coverage-policy-browser-journey.ts";
test("browser: checkout rechecks stale balance, refreshes expiry, cancels navigation reads and opens only after a fresh scoped request", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (p: Page, email: string) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    const reply = p.waitForResponse(
      (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    const csrf = (await (await reply).json()).csrf;
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    return csrf;
  };
  // Separate cookie jars keep the actual buyer and administrator sessions independent.
  const adminContext = await context
    .browser()!
    .newContext({ baseURL: "http://127.0.0.1:3117" });
  const admin = await adminContext.newPage();
  try {
    const csrf = await login(admin, "admin@example.test");
    await login(page, "checkout-buyer@example.test");
    await nav(page, "Billing");
    const effects = await (await page.request.get("/api/effects")).json();
    expect(effects).toHaveLength(3);
    expect(effects.every((e: any) => e.result === null)).toBe(true);
    const [stale, expiry] = effects.filter((e: any) => e.state === "completed");
    const pending = effects.find((e: any) => e.state === "pending");
    const checkoutRow = (p: Page, e: any) =>
      p
        .getByRole("row")
        .filter({
          has: p.getByText(e.checkout.invoiceNumber, { exact: false }),
        })
        .filter({ hasText: "stripe · checkout" });
    const invoiceBefore = (
      await (await page.request.get("/api/dashboard")).json()
    ).invoices;
    await expect(
      checkoutRow(page, stale).getByRole("button", {
        name: "Open secure checkout",
        exact: true,
      }),
    ).toBeVisible();
    const paid = await admin.request.post(
      "/api/commands/billing.payment.manual",
      {
        headers: {
          "x-csrf-token": csrf,
          "idempotency-key": "browser-checkout-bank",
          origin: "http://127.0.0.1:3117",
        },
        data: {
          invoiceId: stale.reference,
          amount: 11300,
          reference: "BROWSER-CHECKOUT-BANK",
          reason: "Synthetic bank evidence",
        },
      },
    );
    expect(paid.status()).toBe(200);
    await checkoutRow(page, stale)
      .getByRole("button", { name: "Open secure checkout", exact: true })
      .click();
    await expect(checkoutRow(page, stale).getByRole("alert")).toContainText(
      "CHECKOUT_UNAVAILABLE",
    );
    expect(page.url()).toContain("127.0.0.1:3117");
    await nav(admin, "Billing");
    await checkoutRow(admin, expiry)
      .getByRole("button", { name: "Refresh checkout status", exact: true })
      .click();
    await expect(checkoutRow(admin, expiry)).toContainText("Checkout expired");
    await expect(
      checkoutRow(admin, expiry).getByRole("button", {
        name: "Open secure checkout",
        exact: true,
      }),
    ).toHaveCount(0);
    await checkoutRow(admin, pending)
      .getByRole("button", { name: "Send to provider", exact: true })
      .click();
    await expect(
      checkoutRow(admin, pending).getByRole("button", {
        name: "Open secure checkout",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await nav(page, "Billing");
    await expect(checkoutRow(page, stale)).toContainText(
      "no amount left to pay",
    );
    await expect(checkoutRow(page, expiry)).toContainText("Checkout expired");
    const path = `**/api/effects/${pending.id}/checkout`;
    let finish!: () => void;
    const held = new Promise<void>((r) => {
      finish = r;
    });
    let handled!: () => void;
    const handlerDone = new Promise<void>((r) => {
      handled = r;
    });
    await page.route(path, async () => {
      // The browser abort itself handles this route; retain the handler until it does.
      await held;
      handled();
    });
    const failed = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().endsWith(`/api/effects/${pending.id}/checkout`),
    });
    const started = page.waitForRequest((r) =>
      r.url().endsWith(`/api/effects/${pending.id}/checkout`),
    );
    await checkoutRow(page, pending)
      .getByRole("button", { name: "Open secure checkout", exact: true })
      .click();
    await started;
    await nav(page, "Overview");
    await failed;
    finish();
    await handlerDone;
    await page.unroute(path);
    await nav(page, "Billing");
    await expect(
      checkoutRow(page, pending).getByRole("button", {
        name: "Open secure checkout",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      (await (await page.request.get("/api/dashboard")).json()).invoices,
    ).toEqual(
      invoiceBefore.map((i: any) =>
        i.id === stale.reference ? { ...i, balance: 0, paid: 11300 } : i,
      ),
    );
    // Fulfill the destination locally: this verifies navigation without any Stripe network request.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Synthetic checkout destination</h1>",
      }),
    );
    await checkoutRow(page, pending)
      .getByRole("button", { name: "Open secure checkout", exact: true })
      .click();
    await expect(page).toHaveURL(
      "https://checkout.stripe.com/synthetic-browser",
    );
    await expect(
      page.getByRole("heading", { name: "Synthetic checkout destination" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
  }
});
test("browser: supplier finance follows credit, received replacement, reviewed closure, correction and bounded history without changing stock or cash", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = async (admin: boolean) => {
    await page
      .getByLabel("Email", { exact: true })
      .fill(admin ? "admin@example.test" : "source@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(admin ? "long-test-only-password" : "long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await page.goto("/");
  await login(true);
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const purchases = async () =>
    (await page.request.get("/api/purchases")).json();
  const dashboard = async () => stockFactsDashboard(page);
  const product = await cmd("product.create", {
    sku: "SUP-FUP-BROWSER",
    name: "Supplier finance bulk fixture",
    serialized: false,
    unitPrice: 2000,
    taxBasisPoints: 0,
  });
  const initial = await dashboard();
  const supplierId = (await purchases()).suppliers[0].id;
  const warehouseId = initial.warehouses.find(
    (w: any) => w.name === "Toronto",
  ).id;
  const receive = async (
    deliveryRef: string,
    quantity: number,
    unitCost: number,
  ) => {
    const po = await cmd("purchase.create", {
      supplierId,
      warehouseId,
      lines: [{ productId: product.id, quantity, unitCost }],
    });
    const line = (await purchases()).orders.find((p: any) => p.id === po.id)
      .lines[0];
    return cmd("purchase.receive", {
      poId: po.id,
      lineId: line.id,
      deliveryRef,
      quantity,
      serials: [],
      bin: "SUP-FUP",
      quarantine: true,
    });
  };
  const original = await receive("SUP-FUP-ORIGINAL", 4, 1000);
  const unit = (await dashboard()).stock.find(
    (u: any) => u.product_id === product.id,
  );
  const returned = await cmd("purchase.return", {
    receiptId: original.id,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 2,
    serial: null,
    returnRef: "SUP-FUP-RETURN",
    reason: "Synthetic faulty cartons",
    handoverEvidence: "Synthetic supplier courier receipt",
  });
  const replacement = await receive("SUP-FUP-REPLACEMENT", 1, 1200);
  const before = await dashboard(),
    ordersBefore = (await purchases()).orders;
  await page.reload();
  await nav(page, "Purchasing");
  const row = page.getByRole("row").filter({ hasText: "SUP-FUP-RETURN" });
  const evidence = async (reference: string, text: string) => {
    await page
      .getByLabel("Supplier follow-up reference (unique)", { exact: true })
      .fill(reference);
    await page
      .getByLabel("Supplier outcome / review evidence", { exact: true })
      .fill(text);
  };
  await row
    .getByRole("button", { name: "Record supplier credit", exact: true })
    .click();
  await page
    .getByLabel("Supplier credit amount (cents)", { exact: true })
    .fill("2500");
  await evidence(
    "SUP-FUP-CREDIT",
    "Synthetic credit note exceeds original cost by CAD 5.00; reviewed separately",
  );
  let discarded = false;
  const keys: string[] = [];
  await page.route("**/api/commands/purchase.return.credit", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!discarded) {
      discarded = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(row).toContainText("$25.00 supplier credit recorded");
  await expect(row).toContainText("Supplier outcomes recorded");
  await row
    .getByRole("button", { name: "Link replacement receipt", exact: true })
    .click();
  await page
    .getByLabel("Received replacement delivery", { exact: true })
    .selectOption(replacement.id);
  await evidence(
    "SUP-FUP-LINK",
    "Synthetic new receipt checked; stock was already received",
  );
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("1 replacement units linked · v2");
  await row
    .getByRole("button", { name: "Close supplier follow-up", exact: true })
    .click();
  await page
    .getByLabel("Reviewed resolution", { exact: true })
    .selectOption("no-remedy");
  await evidence(
    "SUP-FUP-CLOSE",
    "Synthetic finance review of credit and replacement allocation; no ledger posting",
  );
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "requires none",
  );
  await page
    .getByLabel("Reviewed resolution", { exact: true })
    .selectOption("reconciled");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("Follow-up closed · reconciled");
  await expect(
    row.getByRole("button", { name: "Record supplier credit", exact: true }),
  ).toHaveCount(0);
  await row
    .getByRole("button", { name: "Reopen supplier follow-up", exact: true })
    .click();
  await evidence(
    "SUP-FUP-REOPEN",
    "Synthetic supplier rescinded the note; review correction",
  );
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row
    .getByRole("button", { name: "Supplier history", exact: true })
    .click();
  let history = page.getByRole("region", {
    name: "Supplier follow-up history",
    exact: true,
  });
  await expect(history.getByRole("heading")).toBeFocused();
  await history
    .getByRole("button", {
      name: "Void supplier observation SUP-FUP-CREDIT",
      exact: true,
    })
    .click();
  await evidence(
    "SUP-FUP-VOID",
    "Synthetic credit rescinded; permanent original evidence retained",
  );
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText(
    "$0.00 supplier credit recorded · 1 replacement units linked · v5",
  );
  await expect(
    history.getByText(
      "Supplier credit recorded: CA$25.00 · Voided by later evidence",
      { exact: true },
    ),
  ).toBeVisible();
  const observations = (
    await (
      await page.request.get(`/api/purchases/returns/${returned.id}/history`)
    ).json()
  ).items;
  expect(observations).toHaveLength(5);
  for (let i = 1; i <= 21; i++)
    await cmd("purchase.return.credit", {
      returnId: returned.id,
      revision: 4 + i,
      reference: `SUP-FUP-EXTRA-${i}`,
      evidence: "Synthetic additional note for history pagination",
      amount: 1,
      currency: "CAD",
    });
  await page.reload();
  await nav(page, "Purchasing");
  await row
    .getByRole("button", { name: "Supplier history", exact: true })
    .click();
  history = page.getByRole("region", {
    name: "Supplier follow-up history",
    exact: true,
  });
  await expect(history.getByRole("listitem")).toHaveCount(20);
  let failed = false;
  await page.route(
    `**/api/purchases/returns/${returned.id}/history?after=*`,
    async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic history unavailable" }),
        });
      } else await route.continue();
    },
  );
  await history
    .getByRole("button", {
      name: "Load older supplier observations",
      exact: true,
    })
    .click();
  await expect(history.getByRole("alert")).toBeVisible();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Retry supplier history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(26);
  await expect(
    history.getByText(
      "Supplier credit recorded: CA$25.00 · Voided by later evidence",
      { exact: true },
    ),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Close supplier history", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Supplier history", exact: true }),
  ).toBeFocused();
  const after = await dashboard();
  expect(after.stock).toEqual(before.stock);
  expect(after.invoices).toEqual(before.invoices);
  expect(after.credits).toEqual(before.credits);
  expect((await purchases()).orders).toEqual(ordersBefore);
  const followup = (await purchases()).returns.find(
    (r: any) => r.id === returned.id,
  ).followup;
  expect(followup).toMatchObject({
    originalCost: 2000,
    creditAmount: 21,
    replacementQuantity: 1,
    revision: 26,
    state: "open",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(false);
  await nav(page, "Purchasing");
  await expect(
    row.getByRole("button", { name: "Record supplier credit", exact: true }),
  ).toHaveCount(0);
  await row
    .getByRole("button", { name: "Supplier history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await expect(
    history.getByRole("button", { name: /^Void supplier observation/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("browser: named carrier choices preserve legacy warning, retry once, reload and withdraw on phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("named-carriers@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Customers");
  await expect(
    page.getByText(/Previous carrier exception needs review/),
  ).toBeVisible();
  const choose = () =>
    page.getByRole("button", { name: "Residency choice", exact: true }).click();
  const labels = [
    "UPS",
    "FedEx",
    "USPS",
    "Canada Post",
    "Purolator",
    "DHL Express",
  ];
  const permission = (name: string) =>
    page.getByLabel(`Allow ${name} processing outside the storage region`, {
      exact: true,
    });
  await choose();
  for (const name of labels) await expect(permission(name)).not.toBeChecked();
  await expect(
    page.getByLabel(
      "Allow selected carrier processing outside the storage region",
      { exact: true },
    ),
  ).toHaveCount(0);
  await permission("UPS").check();
  await permission("Canada Post").check();
  await page
    .getByLabel("Acknowledgment of reviewed processor terms")
    .fill("Synthetic buyer review of UPS and Canada Post exceptions");
  let dropped = false;
  const keys: string[] = [];
  await page.route("**/api/commands/account.residency", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  let account = (await (await page.request.get("/api/dashboard")).json())
    .accounts[0];
  expect(account.residency_version).toBe(3);
  expect(JSON.parse(account.provider_exceptions)).toEqual([
    "ups",
    "canada-post",
  ]);
  await page.reload();
  await nav(page, "Customers");
  await choose();
  for (const name of labels) {
    if (["UPS", "Canada Post"].includes(name))
      await expect(permission(name)).toBeChecked();
    else await expect(permission(name)).not.toBeChecked();
  }
  await permission("UPS").uncheck();
  await permission("Canada Post").uncheck();
  await page.getByLabel("Processor policy").selectOption("strict");
  await page
    .getByLabel("Acknowledgment of reviewed processor terms")
    .fill("Synthetic buyer withdraws both exceptions");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  account = (await (await page.request.get("/api/dashboard")).json())
    .accounts[0];
  expect(account.residency_version).toBe(4);
  expect(account.residency_mode).toBe("strict");
  expect(JSON.parse(account.provider_exceptions)).toEqual([]);
});
async function recordedProviderAcceptance(page: Page, providers: string[]) {
  const disclosures = await (
    await page.request.get("/api/provider-disclosures")
  ).json();
  return {
    basis: "recorded",
    representative: "Synthetic customer representative",
    evidenceRef: "synthetic:explicit-browser-customer-acceptance",
    disclosures: providers.map((provider) => ({
      provider,
      disclosureId: disclosures.find((d: any) => d.provider === provider).id,
    })),
  };
}
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
test("browser: refund notices page safely, retain personal reads after a lost response, and reopen after a verified failure", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const login = async (p: Page, email: string, password: string) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(p, "Billing");
  };
  const inbox = (p: Page) =>
    p.getByRole("region", { name: "Refund notices", exact: true });
  const notices = async (p: Page) =>
    (await p.request.get("/api/billing/refund-notices")).json();
  const snapshot = async () => stockFactsDashboard(page);
  await login(page, "admin@example.test", "long-test-only-password");
  const before = await snapshot();
  const original = await notices(page);
  expect(original.items).toHaveLength(25);
  expect(original.unread).toBe(27);
  const notice = original.items[0];
  expect(notice.revision).toBe(27);
  const panel = inbox(page),
    row = panel.locator("tbody tr").first();
  await expect(panel.getByRole("status")).toContainText(
    "27 unread refund notices · 25 loaded",
  );
  let lostPage = false;
  await page.route("**/api/billing/refund-notices?after=*", async (route) => {
    if (!lostPage) {
      lostPage = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load older refund notices", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(25);
  await panel
    .getByRole("button", { name: "Retry refund notices", exact: true })
    .click();
  await expect(panel.locator("tbody tr")).toHaveCount(27);
  await expect(
    panel.getByRole("button", {
      name: "Load older refund notices",
      exact: true,
    }),
  ).toHaveCount(0);
  const opener = row.getByRole("button", {
    name: "View refund history",
    exact: true,
  });
  await opener.click();
  const history = page.getByRole("region", {
    name: "Refund notice history",
    exact: true,
  });
  await expect(history.getByRole("heading")).toBeFocused();
  await expect(history.locator("li")).toHaveCount(25);
  let lostHistory = false;
  await page.route(
    `**/api/billing/refund-notices/${notice.id}/history?after=*`,
    async (route) => {
      if (!lostHistory) {
        lostHistory = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await history
    .getByRole("button", { name: "Load older refund updates", exact: true })
    .click();
  await expect(history.getByRole("alert")).toBeVisible();
  await expect(history.locator("li")).toHaveCount(25);
  await history
    .getByRole("button", { name: "Retry refund history", exact: true })
    .click();
  await expect(history.locator("li")).toHaveCount(27);
  const updates = await history.locator("li").allTextContents();
  expect(new Set(updates).size).toBe(27);
  await history
    .getByRole("button", { name: "Close refund history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  const keys: string[] = [];
  let lostAck = false;
  await page.route(
    "**/api/commands/billing.refund.notice.acknowledge",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!lostAck) {
        lostAck = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await row
    .getByRole("button", { name: "Mark notice read", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review refund notice",
    exact: true,
  });
  await expect(dialog).toContainText("It does not confirm repayment");
  await dialog
    .getByRole("button", { name: "Mark notice read", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Mark notice read", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(row).toContainText("Read by you");
  expect((await notices(page)).unread).toBe(26);
  const afterRead = await snapshot();
  expect(afterRead.stock).toEqual(before.stock);
  expect(afterRead.orders).toEqual(before.orders);
  expect(afterRead.invoices).toEqual(before.invoices);
  await page.reload();
  await nav(page, "Billing");
  await expect(row).toContainText("Read by you");
  const buyerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const otherContext = await browser.newContext();
  try {
    const buyer = await buyerContext.newPage(),
      other = await otherContext.newPage();
    await login(
      buyer,
      "refund-buyer@example.test",
      "long-notice-test-password",
    );
    const personal = await notices(buyer);
    expect(personal.unread).toBe(27);
    expect(personal.items[0].acknowledged).toBe(false);
    expect(personal.items.every((n: any) => n.accountId === undefined)).toBe(
      true,
    );
    expect(JSON.stringify(personal)).not.toMatch(
      /Private browser|NOTICE-REF|re_|pi_browser|effectId|webhookSecret/,
    );
    await expect(
      inbox(buyer).getByRole("columnheader", { name: "Customer", exact: true }),
    ).toHaveCount(0);
    await expect(inbox(buyer)).toContainText(
      "Do not send bank details or payment credentials",
    );
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const buyerRow = inbox(buyer).locator("tbody tr").first();
    await buyerRow
      .getByRole("button", { name: "Mark notice read", exact: true })
      .click();
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Mark notice read", exact: true })
      .click();
    await expect(buyerRow).toContainText("Read by you");
    await buyer.reload();
    await nav(buyer, "Billing");
    await expect(buyerRow).toContainText("Read by you");
    expect((await notices(buyer)).unread).toBe(26);
    await login(
      other,
      "refund-other@example.test",
      "long-notice-test-password",
    );
    expect((await notices(other)).items).toEqual([]);
    expect(
      (
        await other.request.get(
          `/api/billing/refund-notices/${notice.id}/history`,
        )
      ).status(),
    ).toBe(404);
    // Synthetic provider reads exercise the same authenticated HTTP route as the staff control.
    // Notice acknowledgment itself never makes a provider request or changes native money.
    const effects = await (await page.request.get("/api/effects")).json();
    const effect = effects.find(
      (e: any) => e.kind === "refund" && e.reference === notice.id,
    );
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const refresh = () =>
      page.request.post(`/api/effects/${effect.id}/refresh-refund`, {
        headers: { origin: "http://127.0.0.1:3117", "x-csrf-token": csrf },
      });
    expect((await refresh()).status()).toBe(200);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("earlier exception resolved");
    await expect(row).toContainText("update 28");
    await expect(
      row.getByRole("button", { name: "Mark notice read", exact: true }),
    ).toBeVisible();
    const confirmed = await snapshot();
    expect(
      confirmed.invoices.find((i: any) => i.id === notice.invoiceId).refunded,
    ).toBe(400);
    expect((await refresh()).status()).toBe(200);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("failed · needs review");
    await expect(row).toContainText("update 29");
    await buyer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(buyerRow).toContainText(
      "previous refund confirmation may have been reversed",
    );
    await expect(
      buyerRow.getByRole("button", { name: "Mark notice read", exact: true }),
    ).toBeVisible();
    expect((await notices(buyer)).unread).toBe(27);
    const final = await snapshot();
    expect(final.stock).toEqual(before.stock);
    expect(final.orders).toEqual(before.orders);
    expect(final.invoices).toEqual(before.invoices);
    expect(errors).toEqual([]);
  } finally {
    await buyerContext.close();
    await otherContext.close();
  }
});
test("browser: reviewed stock QR downloads retain one receipt after a lost response and leave stock unchanged", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await stockFactsDashboard(page);
  const u = before.stock.find(
    (s: any) => s.state === "stock" && s.quantity > 0 && s.serial,
  );
  expect(u).toBeTruthy();
  const history = await (await page.request.get("/api/stock/labels")).json();
  let lost = false;
  const keys: string[] = [];
  await page.route(`**/api/stock/${u.id}/label`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await nav(page, "Inventory");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator("small", { hasText: `${u.serial} · stock` }) });
  await row
    .getByRole("button", { name: "Prepare QR label", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Prepare stock QR label",
    exact: true,
  });
  await expect(dialog).toContainText(u.serial);
  await dialog
    .getByLabel("Copies (including deliberate duplicates)", { exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Prepare and download", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Prepare and download", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`Stock_${u.id}.pdf`);
  const bytes = await readFile((await download.path())!);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  expect(pdf.numPages).toBe(2);
  await task.destroy();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const receipts = await (await page.request.get("/api/stock/labels")).json();
  expect(receipts.length).toBe(history.length + 1);
  expect(receipts[0].unit_id).toBe(u.id);
  expect(receipts[0].copies).toBe(2);
  expect(receipts[0].state).toBe("prepared");
  expect(receipts[0].content_hash).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const after = await stockFactsDashboard(page);
  expect(after.stock).toEqual(before.stock);
  expect(errors).toEqual([]);
});

test("browser: audit history traverses older pages, retains retries and cancels stale reads", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const login = async (p: Page, email: string, password: string) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login(page, "event-admin@example.test", "long-event-test-password");
  const before = await stockFactsDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const endpoint = "/api/audit/page";
  let firstFailure = false;
  await page.route(`**${endpoint}`, async (route) => {
    if (!firstFailure) {
      firstFailure = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await nav(page, "Audit history");
  const panel = page.getByRole("region", {
    name: "Audit history",
    exact: true,
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry audit history", exact: true })
    .click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  const first = await (await page.request.get(endpoint)).json();
  expect(first.items).toHaveLength(20);
  expect(JSON.stringify(first)).not.toMatch(
    /requestHash|detail|payload|password_hash/,
  );
  for (const row of first.items)
    expect(Object.keys(row).sort()).toEqual([
      "action",
      "actor_id",
      "created_at",
      "id",
      "reference",
    ]);
  let continuationFailure = false;
  await page.route(`**${endpoint}?after=*`, async (route) => {
    if (!continuationFailure) {
      continuationFailure = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load older audit records", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  await panel
    .getByRole("button", { name: "Retry audit history", exact: true })
    .click();
  await expect(panel.locator("tbody tr")).toHaveCount(40);
  const second = await (
    await page.request.get(
      `${endpoint}?after=${encodeURIComponent(first.next)}`,
    )
  ).json();
  const ids: string[] = [...first.items, ...second.items].map((r) => r.id);
  let next: string | null = second.next;
  let pages = 2;
  while (next && pages < 200) {
    const data = await (
      await page.request.get(`${endpoint}?after=${encodeURIComponent(next)}`)
    ).json();
    ids.push(...data.items.map((r: { id: string }) => r.id));
    next = data.next;
    await panel
      .getByRole("button", { name: "Load older audit records", exact: true })
      .click();
    await expect(panel.locator("tbody tr")).toHaveCount(ids.length);
    pages++;
  }
  expect(next).toBeNull();
  expect(ids.length).toBeGreaterThan(200);
  expect(new Set(ids).size).toBe(ids.length);
  await expect(
    panel.getByRole("heading", { name: "Audit history", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.unroute(`**${endpoint}?after=*`);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  for (const action of ["Refresh", "Sign out"] as const) {
    let announce!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${endpoint}?after=*`, async (route) => {
      const response = await route.fetch();
      announce();
      await held;
      await route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "Load older audit records", exact: true })
      .click();
    await started;
    const refreshed =
      action === "Refresh"
        ? page.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.pathname === endpoint &&
              url.search === "" &&
              response.request().method() === "GET"
            );
          })
        : null;
    await page.getByRole("button", { name: action, exact: true }).click();
    if (refreshed) {
      const response = await refreshed;
      expect(response.status()).toBe(200);
      await response.finished();
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    } else
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    release();
    await page.unrouteAll({ behavior: "wait" });
    if (action === "Refresh")
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    else await expect(panel).toHaveCount(0);
  }
  const supportContext = await browser.newContext(),
    buyerContext = await browser.newContext();
  try {
    const support = await supportContext.newPage(),
      buyer = await buyerContext.newPage();
    await login(
      support,
      "event-support@example.test",
      "long-event-test-password",
    );
    await nav(support, "Audit history");
    await expect(
      support
        .getByRole("region", { name: "Audit history", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(20);
    await login(
      buyer,
      "refund-buyer@example.test",
      "long-notice-test-password",
    );
    await expect(
      buyer
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("button", { name: "Audit history", exact: true }),
    ).toHaveCount(0);
    expect((await buyer.request.get(endpoint)).status()).toBe(403);
    expect((await buyer.request.get("/api/audit")).status()).toBe(403);
  } finally {
    await supportContext.close();
    await buyerContext.close();
  }
  expect(
    (
      await page.request.post("/api/login", {
        data: {
          email: "event-admin@example.test",
          password: "long-event-test-password",
        },
        headers: { origin: "http://127.0.0.1:3117" },
      })
    ).status(),
  ).toBe(200);
  const after = await stockFactsDashboard(page);
  for (const key of ["stock", "orders", "invoices"])
    expect(after[key]).toEqual(before[key]);
  expect(errors).toEqual([]);
});
async function installScanHarness(page: Page) {
  // Real local MediaStream lifetime, synthetic decoding/permission outcomes; no physical camera claim.
  await page.addInitScript(() => {
    const harness: any = {
      queue: [],
      requests: 0,
      stops: 0,
      mode: "allow",
      resolve: null,
    };
    (window as any).__scanHarness = harness;
    class SyntheticDetector {
      static async getSupportedFormats() {
        return ["code_128", "qr_code"];
      }
      async detect() {
        return (harness.queue.shift() ?? []).map((rawValue: string) => ({
          rawValue,
        }));
      }
    }
    harness.detector = SyntheticDetector;
    (window as any).BarcodeDetector = SyntheticDetector;
    const capture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.fillRect(0, 0, 100, 100);
      const stream = canvas.captureStream(10);
      const timer = setInterval(() => context.fillRect(0, 0, 100, 100), 50);
      const track = stream.getTracks()[0]!,
        original = track.stop.bind(track);
      track.stop = () => {
        harness.stops++;
        clearInterval(timer);
        original();
      };
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        harness.requests++;
        if (harness.mode === "deny")
          throw new DOMException("Synthetic denial", "NotAllowedError");
        if (harness.mode === "pending")
          return new Promise((resolve) => {
            harness.resolve = () => resolve(capture());
          });
        return capture();
      },
    });
  });
}
test("browser: reviewed customer/catalog imports retain rejects, explicit matches and strict defaults and recover a lost approval response once", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await stockFactsDashboard(page),
    eq = before.products.find((p: any) => p.sku === "EQ-1");
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "BROWSER-C-1",
      targetId: null,
      name: "Browser imported customer A",
      tier: "standard",
      creditLimit: 100000,
      held: false,
    },
    {
      sourceId: "BROWSER-C-2",
      targetId: null,
      name: "Browser imported customer B",
      tier: "trade",
      creditLimit: 200000,
      held: true,
    },
  ];
  const dryRun = async (
    batchRef: string,
    kind: string,
    value: number,
    sourceRows: unknown[],
  ) => {
    await page
      .getByRole("button", { name: "Dry run customer/catalog", exact: true })
      .click();
    await page.getByLabel("Import type", { exact: true }).selectOption(kind);
    await page
      .getByLabel("Batch reference (new for each correction)", { exact: true })
      .fill(batchRef);
    await page
      .getByLabel("Source dataset reference (keep for corrected batches)", {
        exact: true,
      })
      .fill("BROWSER-MASTERS-CUTOFF");
    await page
      .getByLabel("Original source SHA-256", { exact: true })
      .fill("b".repeat(64));
    await page
      .getByLabel("Source cutoff (UTC)", { exact: true })
      .fill("2026-09-01T00:00:00.000Z");
    await page
      .getByLabel("Independent source record count", { exact: true })
      .fill("2");
    await page
      .getByLabel("Independent control amount (CAD cents)", { exact: true })
      .fill(String(value));
    await page
      .getByLabel("Source rights, mapping and cutoff evidence", { exact: true })
      .fill(
        "Synthetic browser source, mapping, rights and independent totals reviewed",
      );
    await page
      .getByLabel("Master rows (JSON)", { exact: true })
      .fill(JSON.stringify(sourceRows));
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-MASTERS-BLOCKED", "customer", 300001, rows);
  const blocked = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independently supplied",
  );
  await expect(
    blocked.getByRole("button", { name: "Approve master batch", exact: true }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Correct independent control amount in a new batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-MASTERS-CUSTOMERS", "customer", 300000, rows);
  const customers = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-CUSTOMERS",
    exact: true,
  });
  await expect(customers).toContainText("2 create / 0 match. 0 review issues");
  await expect(customers).toContainText('"held":true');
  expect((await stockFactsDashboard(page)).accounts).toHaveLength(
    before.accounts.length,
  );
  let lost = false;
  await page.route("**/api/commands/import.masters.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await customers
    .getByRole("button", { name: "Approve master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Reviewed synthetic customers, holds and credit control totals");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(customers).toContainText("applied");
  const catalogRows = [
    {
      sourceId: "BROWSER-P-MATCH",
      targetId: eq.id,
      sku: eq.sku,
      name: eq.name,
      serialized: true,
      unitPrice: eq.unit_price,
      taxBasisPoints: eq.tax_bp,
    },
    {
      sourceId: "BROWSER-P-CREATE",
      targetId: null,
      sku: "BROWSER-MASTER-B",
      name: "Browser imported bulk product",
      serialized: false,
      unitPrice: 2000,
      taxBasisPoints: 0,
    },
  ];
  await dryRun("BROWSER-MASTERS-CATALOG", "catalog", 12000, catalogRows);
  const catalog = page.getByRole("region", {
    name: "Master batch BROWSER-MASTERS-CATALOG",
    exact: true,
  });
  await expect(catalog).toContainText("1 create / 1 match. 0 review issues");
  await expect(catalog).toContainText('"taxBasisPoints":1300');
  await catalog
    .getByRole("button", { name: "Approve master batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Reviewed exact product target and new SKU");
  await next(page);
  await expect(catalog).toContainText("applied");
  const after = await stockFactsDashboard(page),
    imported = after.accounts.filter((c: any) =>
      c.name.startsWith("Browser imported"),
    );
  expect(imported).toHaveLength(2);
  expect(imported.reduce((s: number, c: any) => s + c.credit_limit, 0)).toBe(
    300000,
  );
  expect(imported.filter((c: any) => c.held)).toHaveLength(1);
  for (const c of imported)
    expect([
      c.residency_mode,
      c.provider_exceptions,
      c.residency_version,
    ]).toEqual(["strict", "[]", 1]);
  expect(after.products).toHaveLength(before.products.length + 1);
  expect(after.products.find((p: any) => p.id === eq.id)).toEqual(eq);
  expect(after.stock).toEqual(before.stock);
  expect(after.invoices).toEqual(before.invoices);
  await page.reload();
  await nav(page, "Imports");
  await expect(customers).toContainText("applied");
  await expect(catalog).toContainText("applied");
  const batches = await (await page.request.get("/api/imports/masters")).json();
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-MASTERS-CUSTOMERS").result
      .mappings,
  ).toHaveLength(2);
  expect(
    batches
      .find((b: any) => b.batchRef === "BROWSER-MASTERS-CATALOG")
      .result.mappings.map((m: any) => m.action),
  ).toEqual(["match", "create"]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/imports/masters")).status()).toBe(403);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: opening dry runs reconcile independent totals and apply serial/bulk custody once after a lost approval response", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "S-A",
      sku: "OPEN-S",
      warehouse: "Toronto",
      bin: "A-1",
      serial: "OPEN-S1",
      quantity: 1,
      unitCost: 6000,
      condition: "usable",
    },
    {
      sourceId: "S-B",
      sku: "OPEN-S",
      warehouse: "Toronto",
      bin: "A-1",
      serial: "OPEN-S2",
      quantity: 1,
      unitCost: 6000,
      condition: "usable",
    },
    {
      sourceId: "B-A",
      sku: "OPEN-B",
      warehouse: "Toronto",
      bin: "B-1",
      serial: null,
      quantity: 3,
      unitCost: 1000,
      condition: "usable",
    },
    {
      sourceId: "B-B",
      sku: "OPEN-B",
      warehouse: "Ottawa",
      bin: "Q-1",
      serial: null,
      quantity: 1,
      unitCost: 1000,
      condition: "quarantine",
    },
  ];
  const dryRun = async (batchRef: string, value: number) => {
    await page
      .getByRole("button", { name: "Dry run opening stock", exact: true })
      .click();
    await page
      .getByLabel("Batch reference (new for each correction)", { exact: true })
      .fill(batchRef);
    await page
      .getByLabel("Source dataset reference (keep for corrected batches)", {
        exact: true,
      })
      .fill("BROWSER-SYNTHETIC-CUTOFF");
    await page
      .getByLabel("Original source SHA-256", { exact: true })
      .fill("a".repeat(64));
    await page
      .getByLabel("Source cutoff (UTC)", { exact: true })
      .fill("2026-09-01T00:00:00.000Z");
    await page
      .getByLabel("Independent source quantity", { exact: true })
      .fill("6");
    await page
      .getByLabel("Independent source cost (CAD cents)", { exact: true })
      .fill(String(value));
    await page
      .getByLabel("Source rights, mapping and cutoff evidence", { exact: true })
      .fill(
        "Synthetic browser fixture only; independent source totals and cutoff reviewed",
      );
    await page
      .getByLabel("Opening rows (JSON)", { exact: true })
      .fill(JSON.stringify(rows));
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-OPEN-BLOCKED", 16001);
  const blocked = page.getByRole("region", {
    name: "Opening batch BROWSER-OPEN-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independently supplied",
  );
  await expect(
    blocked.getByRole("button", { name: "Approve opening stock", exact: true }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject opening batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Independent source value corrected in a new immutable batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-OPEN-READY", 16000);
  const ready = page.getByRole("region", {
    name: "Opening batch BROWSER-OPEN-READY",
    exact: true,
  });
  await expect(ready).toContainText("0 review issues");
  const stock = async () => {
    const dashboard = await stockFactsDashboard(page);
    const ids = dashboard.products
      .filter((p: any) => p.sku.startsWith("OPEN-"))
      .map((p: any) => p.id);
    return dashboard.stock.filter((u: any) => ids.includes(u.product_id));
  };
  expect(await stock()).toHaveLength(0);
  let lost = false;
  await page.route("**/api/commands/import.opening.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await ready
    .getByRole("button", { name: "Approve opening stock", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill(
      "Synthetic quantity, original costs, rights and frozen cutoff reviewed",
    );
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(ready).toContainText("applied");
  const units = await stock();
  expect(units).toHaveLength(4);
  expect(units.reduce((s: number, u: any) => s + u.quantity, 0)).toBe(6);
  expect(units.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    16000,
  );
  expect(units.reduce((s: number, u: any) => s + u.available, 0)).toBe(5);
  await page.reload();
  await nav(page, "Imports");
  await expect(ready).toContainText("applied");
  const batches = await (await page.request.get("/api/imports/opening")).json();
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-OPEN-READY").result
      .mappings,
  ).toHaveLength(4);
  expect(
    batches.find((b: any) => b.batchRef === "BROWSER-OPEN-BLOCKED").state,
  ).toBe("rejected");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/imports/opening")).status()).toBe(403);
  expect(errors).toEqual([]);
});
async function next(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
test("browser: partial transfer retries preserve transit stock and separate damaged/quarantined arrivals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  const lot = page
    .getByRole("row")
    .filter({ hasText: "TR-1" })
    .filter({
      has: page.getByRole("button", { name: "Transfer", exact: true }),
    });
  await lot.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page.getByLabel("Units", { exact: true }).fill("4");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic browser relocation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const transfer = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "TR-1" });
  await expect(transfer).toContainText(
    "4 dispatched · 0 received · 4 in transit",
  );
  let lost = false;
  await page.route("**/api/commands/transfer.receive", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  for (const [quantity, condition, reference, remaining] of [
    [2, "usable", "BROWSER-TRANSFER-USABLE", 2],
    [1, "damaged", "BROWSER-TRANSFER-DAMAGE", 1],
    [1, "quarantine", "BROWSER-TRANSFER-QUARANTINE", 0],
  ] as const) {
    await transfer
      .getByRole("button", { name: "Receive transfer", exact: true })
      .click();
    await expect(
      page.getByLabel("Units arriving", { exact: true }),
    ).toHaveAttribute("max", String(quantity === 2 ? 4 : remaining + 1));
    await page
      .getByLabel("Units arriving", { exact: true })
      .fill(String(quantity));
    await page
      .getByLabel("Arrival reference (unique per portion)", { exact: true })
      .fill(reference);
    await page
      .getByLabel("Destination bin", { exact: true })
      .fill(condition === "usable" ? "B-1" : "Q-1");
    await page.getByLabel("Condition", { exact: true }).selectOption(condition);
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic arrival inspection");
    await next(page);
    if (quantity === 2) {
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await next(page);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(transfer).toContainText(
      `4 dispatched · ${4 - remaining} received · ${remaining} in transit`,
    );
    await expect(transfer).toContainText(
      `${reference} · ${quantity} ${condition}`,
    );
  }
  await expect(
    transfer.getByRole("cell", { name: "received", exact: true }),
  ).toBeVisible();
  await expect(
    transfer.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  const dashboard = await stockFactsDashboard(page);
  const product = dashboard.products.find((p: any) => p.sku === "TR-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(6);
  expect(
    stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(6000);
  expect(stock.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(4);
  const transfers = await (await page.request.get("/api/transfers")).json();
  expect(
    transfers.find((tr: any) => tr.lines[0].product_id === product.id).lines[0]
      .receipts,
  ).toHaveLength(3);
  expect(errors).toEqual([]);
});
test("browser: two site-limited operators dispatch and scan a serial without destination stock access at the source", async ({
  page,
}) => {
  const login = async (email: string) => {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await page.goto("/");
  await login("source@example.test");
  await nav(page, "Inventory");
  const serial = page.getByRole("row").filter({ hasText: "S3" });
  await serial.getByRole("button", { name: "Transfer", exact: true }).click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic separate-site dispatch");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const transfer = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "S3" });
  await expect(transfer).toContainText(
    "1 dispatched · 0 received · 1 in transit",
  );
  await expect(
    transfer.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  const sourceDashboard = await (
    await page.request.get("/api/dashboard")
  ).json();
  expect(
    sourceDashboard.stock.every(
      (u: any) => u.warehouse_id === sourceDashboard.warehouses[0].id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("destination@example.test");
  await nav(page, "Inventory");
  await transfer
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await page
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill("S2");
  await page
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill("BROWSER-SERIAL-ARRIVAL");
  await page.getByLabel("Destination bin", { exact: true }).fill("B-2");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic scanned arrival");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "SERIAL",
  );
  await page
    .getByLabel("Scan transferred serial (leave blank for bulk)", {
      exact: true,
    })
    .fill("S3");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(transfer).toContainText(
    "1 dispatched · 1 received · 0 in transit",
  );
  const destination = await stockFactsDashboard(page);
  expect(
    destination.stock.find((u: any) => u.serial === "S3").warehouse_id,
  ).toBe(destination.warehouses[0].id);
});
test("browser: multi-line cart, lost acceptance response, serial/bulk fulfillment, residency choice, paid return and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const beforeOrder = await page.request.get("/api/dashboard");
  const priorOrderIds = new Set(
    (await beforeOrder.json()).orders.map((order: { id: string }) => order.id),
  );
  await nav(page, "Orders");
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Synthetic buyer" });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await page
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("1");
  await page
    .getByLabel("SUP-1 · Synthetic supplies", { exact: true })
    .fill("2");
  await next(page);
  await expect(page.getByRole("dialog")).toContainText("$169.50");
  let intercepted = false;
  await page.route("**/api/commands/order.accept", async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dashboard = await page.request.get("/api/dashboard");
  const newOrders = (await dashboard.json()).orders.filter(
    (order: { id: string }) => !priorOrderIds.has(order.id),
  );
  expect(newOrders).toHaveLength(1);
  const orderId = newOrders[0].id;
  const orderRow = page
    .getByRole("row")
    .filter({ hasText: orderId.slice(0, 8) });
  for (const label of ["EQ-1", "SUP-1"]) {
    await orderRow
      .getByRole("button", { name: "Pick / pack", exact: true })
      .click();
    const allocation = page.getByLabel("Allocation", { exact: true });
    await expect(allocation).toBeVisible();
    const value = await allocation
      .locator("option")
      .evaluateAll(
        (options, label) =>
          options
            .find((o) => o.textContent?.startsWith(String(label)))
            ?.getAttribute("value"),
        label,
      );
    await allocation.selectOption(value!);
    if (label === "EQ-1")
      await page
        .getByLabel("Scan serial (leave blank for bulk)", { exact: true })
        .fill("S1");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await orderRow
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Synthetic collection counter");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Confirm collection", exact: true })
    .click();
  await page
    .getByLabel("Handover evidence", { exact: true })
    .fill("Browser synthetic handover");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  const billed = await page.request.get("/api/dashboard");
  const invoice = (await billed.json()).invoices.find(
    (i: { order_id: string }) => i.order_id === orderId,
  );
  expect(invoice).toBeDefined();
  const invoiceRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Download invoice PDF",
        exact: true,
      }),
    })
    .filter({ hasText: invoice.number });
  await expect(
    invoiceRow.getByRole("cell", { name: "CA$169.50", exact: true }),
  ).toHaveCount(2);
  await invoiceRow
    .getByRole("button", { name: "Request Stripe checkout", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("RESIDENCY_BLOCKED");
  await nav(page, "Customers");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Synthetic buyer", exact: true }),
    })
    .getByRole("button", { name: "Residency choice", exact: true })
    .click();
  await page
    .getByLabel("Application storage region", { exact: true })
    .selectOption("US");
  await page
    .getByLabel("Acknowledgment of reviewed processor terms", { exact: true })
    .fill("Synthetic reviewed terms");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "REGIONAL_MIGRATION_REQUIRED",
  );
  await page
    .getByLabel("Application storage region", { exact: true })
    .selectOption("CA");
  await page
    .getByLabel("Processor policy", { exact: true })
    .selectOption("provider-exceptions");
  await page
    .getByLabel("Allow Stripe processing outside the storage region", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Authorized customer representative", { exact: true })
    .fill("Synthetic buyer representative");
  await page
    .getByLabel("External customer acceptance evidence", { exact: true })
    .fill("synthetic:stripe-customer-acceptance");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  await invoiceRow
    .getByRole("button", { name: "Request Stripe checkout", exact: true })
    .click();
  const checkoutEffectRow = page
    .getByRole("row")
    .filter({ hasText: invoice.number })
    .filter({ hasText: "stripe · checkout" });
  await expect(
    checkoutEffectRow.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await checkoutEffectRow
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("PROVIDER_DISABLED");
  await expect(
    checkoutEffectRow.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await invoiceRow
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page
    .getByLabel("Bank / payment reference", { exact: true })
    .fill("BANK-BROWSER-1");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic bank confirmation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Returns");
  await page
    .getByRole("button", { name: "Submit claim / return", exact: true })
    .click();
  await page
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic return");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Browser fixture");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Approve return authorization", { exact: true })
    .check();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic approval");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Receive return", exact: true })
    .click();
  await page.getByLabel("Quarantine bin", { exact: true }).fill("Q-1");
  await page.getByLabel("Scan returned serial", { exact: true }).fill("S1");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page
    .getByLabel("Inspection findings", { exact: true })
    .fill("Sealed and undamaged");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Disposition", exact: true }).click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Restock approved");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Issue return credit", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Return credit approved");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Billing");
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Download invoice PDF",
          exact: true,
        }),
      })
      .filter({
        hasText: invoice.number,
      })
      .getByRole("cell", { name: "-CA$113.00", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Customers");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Synthetic buyer", exact: true }),
    })
    .getByRole("button", { name: "Residency choice", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "local-evidence/browser-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("browser: split packing retries once, void releases holds, and each handover invoices only its quantity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const snapshot = async () => stockFactsDashboard(page);
  const before = await snapshot();
  const priorOrderIds = new Set(before.orders.map((o: any) => o.id));
  const bulk = before.products.find((p: any) => p.sku === "SUP-1");
  const initialStock = before.stock.find(
    (u: any) => u.product_id === bulk.id,
  ).quantity;
  await nav(page, "Orders");
  await page
    .getByRole("button", { name: "Prepare order", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: "Synthetic buyer" });
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await page
    .getByLabel("EQ-1 · Synthetic equipment", { exact: true })
    .fill("0");
  await page
    .getByLabel("SUP-1 · Synthetic supplies", { exact: true })
    .fill("3");
  await next(page);
  await expect(page.getByRole("dialog")).toContainText("$84.75");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const order = (await snapshot()).orders.find(
    (o: any) => !priorOrderIds.has(o.id),
  );
  expect(order).toBeDefined();
  const orderRow = page
    .getByRole("row")
    .filter({ hasText: order.id.slice(0, 8) });
  await orderRow
    .getByRole("button", { name: "Pick / pack", exact: true })
    .click();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await orderRow
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  const units = page.getByLabel(/SUP-1.*units to pack/);
  await expect(units).toHaveValue("3");
  await units.fill("1");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection one");
  let lost = false;
  await page.route("**/api/commands/fulfillment.pack", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const first = await snapshot();
  expect(
    first.shipments.filter((s: any) => s.order_id === order.id),
  ).toHaveLength(1);
  expect(
    first.invoices.filter((i: any) => i.order_id === order.id),
  ).toHaveLength(0);
  expect(first.stock.find((u: any) => u.product_id === bulk.id).quantity).toBe(
    initialStock,
  );

  await orderRow
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(units).toHaveValue("2");
  await expect(units).toHaveAttribute("max", "2");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection two");
  await units.fill("0");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Select at least one unit",
  );
  await units.fill("2");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await orderRow
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "No picked units are available",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = (destination: string) =>
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: destination, exact: true }),
    });
  await row("Split collection two")
    .getByRole("button", { name: "Void packing", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic changed packing");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await orderRow
    .getByRole("button", { name: "Pack shipment", exact: true })
    .click();
  await expect(units).toHaveValue("2");
  await page
    .getByLabel("Destination / collection point", { exact: true })
    .fill("Split collection replacement");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const destination of [
    "Split collection one",
    "Split collection replacement",
  ]) {
    await row(destination)
      .getByRole("button", { name: "Confirm collection", exact: true })
      .click();
    await page
      .getByLabel("Handover evidence", { exact: true })
      .fill("Synthetic split handover");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (destination === "Split collection one") {
      const partial = await snapshot();
      const current = partial.orders.find((o: any) => o.id === order.id);
      expect(current.state).toBe("open");
      expect(current.lines[0].shipped).toBe(1);
      expect(current.lines[0].allocated).toBe(2);
      expect(
        partial.invoices.find((i: any) => i.order_id === order.id).total,
      ).toBe(2825);
    }
  }
  const final = await snapshot();
  const completed = final.orders.find((o: any) => o.id === order.id);
  expect(completed.state).toBe("closed");
  expect(completed.lines[0].shipped).toBe(3);
  expect(completed.lines[0].allocated).toBe(0);
  const invoices = final.invoices.filter((i: any) => i.order_id === order.id);
  expect(invoices).toHaveLength(2);
  expect(invoices.reduce((sum: number, i: any) => sum + i.total, 0)).toBe(8475);
  expect(final.stock.find((u: any) => u.product_id === bulk.id).quantity).toBe(
    initialStock - 3,
  );
  expect(
    final.shipments.filter(
      (s: any) => s.order_id === order.id && s.state === "void",
    ),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("browser: administrator reconciles missing transfer stock and recovers found portions without erasing the loss or duplicating lost-response approvals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let releaseDestinations!: () => void;
  const destinationsHeld = new Promise<void>((resolve) => {
    releaseDestinations = resolve;
  });
  await page.route("**/api/transfer-destinations", async (route) => {
    const response = await route.fetch();
    await destinationsHeld;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  const lot = page
    .getByRole("row")
    .filter({ hasText: "LOSS-1" })
    .filter({
      has: page.getByRole("button", { name: "Transfer", exact: true }),
    });
  const transferButton = lot.getByRole("button", {
    name: "Transfer",
    exact: true,
  });
  await expect(transferButton).toBeDisabled();
  expect(errors).toEqual([]);
  releaseDestinations();
  await expect(transferButton).toBeEnabled();
  await page.unroute("**/api/transfer-destinations");
  await transferButton.click();
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption({ label: "Ottawa" });
  await page.getByLabel("Units", { exact: true }).fill("3");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic reconciliation relocation");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tr = page
    .getByRole("row")
    .filter({ hasText: "Toronto → Ottawa" })
    .filter({ hasText: "LOSS-1" });
  await expect(tr).toContainText("3 dispatched · 0 received · 3 in transit");
  let discarded = false;
  await page.route("**/api/commands/transfer.loss", async (route) => {
    if (!discarded) {
      discarded = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await tr
    .getByRole("button", { name: "Approve transit loss", exact: true })
    .click();
  await page
    .getByLabel("Missing units to write off", { exact: true })
    .fill("2");
  await page
    .getByLabel("Loss evidence reference (unique per portion)", { exact: true })
    .fill("BROWSER-LOSS-1");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Investigation and receiving count confirm two missing cartons");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tr).toContainText(
    "3 dispatched · 0 received · 1 in transit · 2 unrecovered loss",
  );
  await expect(tr).toContainText(
    "BROWSER-LOSS-1 · 2 loss approved · 2 unrecovered",
  );
  await tr
    .getByRole("button", { name: "Receive transfer", exact: true })
    .click();
  await expect(page.getByLabel("Units arriving", { exact: true })).toHaveValue(
    "1",
  );
  await page
    .getByLabel("Arrival reference (unique per portion)", { exact: true })
    .fill("BROWSER-UNLOST-ARRIVAL");
  await page.getByLabel("Destination bin", { exact: true }).fill("B-1");
  await page.getByLabel("Condition", { exact: true }).selectOption("usable");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("One unlost carton arrived");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    tr.getByRole("cell", { name: "reconciled-with-loss", exact: true }),
  ).toBeVisible();
  await expect(
    tr.getByRole("button", { name: "Receive transfer", exact: true }),
  ).toHaveCount(0);
  for (const [condition, ref, remaining] of [
    ["quarantine", "BROWSER-FOUND-1", 1],
    ["damaged", "BROWSER-FOUND-2", 0],
  ] as const) {
    await tr
      .getByRole("button", { name: "Recover lost stock", exact: true })
      .click();
    await expect(page.getByLabel("Condition", { exact: true })).toHaveValue(
      "quarantine",
    );
    await page.getByLabel("Units found", { exact: true }).fill("1");
    await page
      .getByLabel("Recovery reference (unique per portion)", { exact: true })
      .fill(ref);
    await page.getByLabel("Destination bin", { exact: true }).fill("Q-1");
    await page.getByLabel("Condition", { exact: true }).selectOption(condition);
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Carrier located missing carton; condition recorded");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tr).toContainText(
      `BROWSER-LOSS-1 · 2 loss approved · ${remaining} unrecovered`,
    );
    await expect(tr).toContainText(`${ref} · 1 recovered ${condition}`);
  }
  await expect(
    tr.getByRole("cell", { name: "received", exact: true }),
  ).toBeVisible();
  await expect(
    tr.getByRole("button", { name: "Recover lost stock", exact: true }),
  ).toHaveCount(0);
  const transfers = await (await page.request.get("/api/transfers")).json();
  const transfer = transfers.find((r: any) =>
    r.lines[0].losses.some((l: any) => l.loss_ref === "BROWSER-LOSS-1"),
  );
  const line = transfer.lines[0];
  expect(line.losses).toHaveLength(1);
  expect(line.losses[0].recoveries).toHaveLength(2);
  expect(line.receipts).toHaveLength(1);
  expect(
    line.receivedQuantity + line.remainingQuantity + line.lostQuantity,
  ).toBe(3);
  const dashboard = await stockFactsDashboard(page);
  const positions = dashboard.stock.filter(
    (u: any) => u.product_id === line.product_id,
  );
  expect(positions.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(
    4,
  );
  expect(
    positions.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(4000);
  expect(positions.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(
    2,
  );
  expect(errors).toEqual([]);
});

test("browser: warehouse count observation survives reload, administrator retry applies once, and stale stock requires rejection/recount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (admin: boolean) => {
    await page
      .getByLabel("Email", { exact: true })
      .fill(admin ? "admin@example.test" : "source@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(admin ? "long-test-only-password" : "long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(page, "Inventory");
  };
  await page.goto("/");
  await login(false);
  const lot = page
    .getByRole("row")
    .filter({ hasText: "COUNT-1" })
    .filter({
      has: page.getByRole("button", { name: "Start count", exact: true }),
    });
  const findLot = async () => {
    // Dashboard refresh restores the first stock page. Search the fixture bin
    // rather than assuming a counted lot remains on that page after mutations.
    await page
      .getByLabel("Search stock serial or bin", { exact: true })
      .fill("COUNT-1");
    await page
      .getByRole("button", { name: "Search stock", exact: true })
      .click();
    await expect(lot).toBeVisible();
  };
  await findLot();
  await lot.getByRole("button", { name: "Start count", exact: true }).click();
  await page
    .getByLabel("Count reference (unique)", { exact: true })
    .fill("BROWSER-COUNT");
  await next(page);
  const count = page.getByRole("row").filter({ hasText: "BROWSER-COUNT" });
  await count
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  await page.getByLabel("Physical units observed", { exact: true }).fill("5");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("One carton absent from the counted bin");
  await next(page);
  await expect(count).toContainText("submitted");
  await expect(
    count.getByRole("button", { name: "Approve count", exact: true }),
  ).toHaveCount(0);
  await findLot();
  await expect(lot).toContainText("6 / 0 / 6");
  await page.reload();
  await nav(page, "Inventory");
  await expect(count).toContainText("6 expected · 5 observed");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(true);
  let lost = false;
  await page.route("**/api/commands/count.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await count
    .getByRole("button", { name: "Approve count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Supervisor verified the count evidence");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(count).toContainText("approved");
  await findLot();
  await expect(lot).toContainText("5 / 0 / 5");
  await lot.getByRole("button", { name: "Start count", exact: true }).click();
  await page
    .getByLabel("Count reference (unique)", { exact: true })
    .fill("BROWSER-STALE");
  await next(page);
  const stale = page.getByRole("row").filter({ hasText: "BROWSER-STALE" });
  await stale
    .getByRole("button", { name: "Record observation", exact: true })
    .click();
  await page.getByLabel("Physical units observed", { exact: true }).fill("4");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Observation before later inspection");
  await next(page);
  await expect(stale).toContainText("submitted");
  await findLot();
  await lot.getByRole("button", { name: "Inspect", exact: true }).click();
  await page
    .getByLabel("Condition", { exact: true })
    .selectOption("quarantine");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Inspection changed stock after count cutoff");
  await next(page);
  await stale
    .getByRole("button", { name: "Approve count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Try stale approval");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Stock changed after the count cutoff",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await stale
    .getByRole("button", { name: "Reject count", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Recount required after inspection");
  await next(page);
  await expect(stale).toContainText("rejected");
  await findLot();
  await expect(lot).toContainText("5 / 0 / 0");
  const dashboard = await stockFactsDashboard(page);
  const product = dashboard.products.find((p: any) => p.sku === "COUNT-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((sum: number, u: any) => sum + u.quantity, 0)).toBe(5);
  expect(
    stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(5000);
  expect(stock.reduce((sum: number, u: any) => sum + u.available, 0)).toBe(0);
  const counts = await (await page.request.get("/api/counts")).json();
  expect(
    counts.find((c: any) => c.count_ref === "BROWSER-COUNT").result.adjustment
      .valueDelta,
  ).toBe(-1000);
  expect(
    counts.find((c: any) => c.count_ref === "BROWSER-STALE").result.adjustment,
  ).toBe(null);
  expect(errors).toEqual([]);
});

test("browser: supplier handover retries one physical removal, preserves purchase totals and pending credit, and warehouse users see evidence without approval", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (admin: boolean) => {
    await page
      .getByLabel("Email", { exact: true })
      .fill(admin ? "admin@example.test" : "source@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill(admin ? "long-test-only-password" : "long-warehouse-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(page, "Purchasing");
  };
  await page.goto("/");
  await login(true);
  const receipt = page
    .getByRole("row")
    .filter({ hasText: "SUPPLIER-RETURN-STOCK" });
  await expect(receipt).toContainText("6 purchased · 0 returned");
  await receipt
    .getByRole("button", { name: "Return to supplier", exact: true })
    .click();
  await page.getByLabel("Units handed over", { exact: true }).fill("2");
  await page
    .getByLabel("Supplier return reference (unique)", { exact: true })
    .fill("BROWSER-SUPRET");
  await page
    .getByLabel("Supplier handover evidence", { exact: true })
    .fill("Synthetic courier handover receipt");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Supplier accepted two defective cartons");
  let discarded = false;
  await page.route("**/api/commands/purchase.return", async (route) => {
    if (!discarded) {
      discarded = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(receipt).toContainText("6 purchased · 2 returned");
  await expect(receipt).toContainText("4 unreserved");
  const history = page.getByRole("row").filter({ hasText: "BROWSER-SUPRET" });
  await expect(history).toContainText("2 units");
  await expect(history).toContainText("Supplier credit pending");
  await expect(history).toContainText("Synthetic courier handover receipt");
  await page.reload();
  await nav(page, "Purchasing");
  await expect(history).toHaveCount(1);
  await expect(receipt).toContainText("6 purchased · 2 returned");
  const purchases = await (await page.request.get("/api/purchases")).json();
  const original = purchases.receipts.find(
    (r: any) => r.delivery_ref === "SUPPLIER-RETURN-STOCK",
  );
  const po = purchases.orders.find((r: any) => r.id === original.po_id);
  expect(po.state).toBe("received");
  expect(po.lines[0].received).toBe(6);
  const returned = purchases.returns.filter(
    (r: any) => r.return_ref === "BROWSER-SUPRET",
  );
  expect(returned).toHaveLength(1);
  expect(returned[0].quantity * returned[0].unit_cost).toBe(2000);
  const dashboard = await stockFactsDashboard(page);
  const product = dashboard.products.find((p: any) => p.sku === "SUPRET-1");
  const stock = dashboard.stock.filter((u: any) => u.product_id === product.id);
  expect(stock.reduce((s: number, u: any) => s + u.quantity, 0)).toBe(4);
  expect(stock.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    4000,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(false);
  await expect(history).toContainText("Supplier credit pending");
  await expect(
    receipt.getByRole("button", { name: "Return to supplier", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: unpaid documents reconcile historical amounts, retain blocked reviews and recover one approval before collecting new cash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await stockFactsDashboard(page),
    buyer = before.accounts.find((a: any) => a.name === "Synthetic buyer"),
    product = before.products.find((p: any) => p.sku === "EQ-1"),
    effectsBefore = await (await page.request.get("/api/effects")).json();
  await nav(page, "Imports");
  const rows = [
    {
      sourceId: "BROWSER-DOC-1",
      accountId: buyer.id,
      number: "BROWSER-LEGACY-001",
      issuedAt: "2026-08-01T00:00:00.000Z",
      dueAt: "2026-08-31T00:00:00.000Z",
      net: 20000,
      tax: 2600,
      total: 22600,
      credited: 11300,
      paid: 4000,
      refunded: 1000,
      balance: 8300,
      lines: [
        {
          productId: product.id,
          description: "Original equipment description",
          quantity: 2,
          unitPrice: 10000,
          unitTax: 1300,
          creditedQuantity: 1,
        },
      ],
    },
  ];
  const dryRun = async (batchRef: string, balance: number) => {
    await page
      .getByRole("button", { name: "Dry run unpaid documents", exact: true })
      .click();
    for (const [label, value] of [
      ["Batch reference (new for each correction)", batchRef],
      [
        "Source dataset reference (keep for corrected batches)",
        "BROWSER-DOCUMENTS-CUTOFF",
      ],
      ["Original source SHA-256", "d".repeat(64)],
      ["Source cutoff (UTC)", "2026-09-01T00:00:00.000Z"],
      ["Independent document count", "1"],
      ["Independent original net (CAD cents)", "20000"],
      ["Independent original tax (CAD cents)", "2600"],
      ["Independent historical credits (CAD cents)", "11300"],
      ["Independent historical payments (CAD cents)", "4000"],
      ["Independent historical refunds (CAD cents)", "1000"],
      ["Independent outstanding balance (CAD cents)", String(balance)],
      [
        "Source rights, mapping and cutoff evidence",
        "Synthetic frozen original invoice and independent financial totals reviewed",
      ],
      ["Unpaid document rows (JSON)", JSON.stringify(rows)],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await dryRun("BROWSER-DOCUMENTS-BLOCKED", 8301);
  const blocked = page.getByRole("region", {
    name: "Document batch BROWSER-DOCUMENTS-BLOCKED",
    exact: true,
  });
  await expect(blocked.getByRole("alert")).toContainText(
    "independent source totals",
  );
  await expect(
    blocked.getByRole("button", {
      name: "Approve document batch",
      exact: true,
    }),
  ).toHaveCount(0);
  await blocked
    .getByRole("button", { name: "Reject document batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Correct the independent balance in a new batch");
  await next(page);
  await expect(blocked).toContainText("rejected");
  await dryRun("BROWSER-DOCUMENTS-READY", 8300);
  const review = page.getByRole("region", {
    name: "Document batch BROWSER-DOCUMENTS-READY",
    exact: true,
  });
  await expect(review).toContainText(
    "1 documents. Eligible: 1 documents. 0 review issues",
  );
  await expect(review).toContainText('"creditedQuantity":1');
  expect((await stockFactsDashboard(page)).invoices).toHaveLength(
    before.invoices.length,
  );
  let lost = false;
  await page.route("**/api/commands/import.documents.decide", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await review
    .getByRole("button", { name: "Approve document batch", exact: true })
    .click();
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill(
      "Reviewed original amounts and historical settlements against independent source",
    );
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(review).toContainText("applied");
  await expect(blocked).toContainText("rejected");
  await page.reload();
  await nav(page, "Imports");
  await expect(review).toContainText("applied");
  const batches = await (
      await page.request.get("/api/imports/documents")
    ).json(),
    applied = batches.find(
      (b: any) => b.batchRef === "BROWSER-DOCUMENTS-READY",
    );
  expect(applied.result.mappings).toHaveLength(1);
  expect(applied.result.value).toBe(8300);
  const after = await stockFactsDashboard(page),
    imported = after.invoices.find(
      (i: any) => i.number === "BROWSER-LEGACY-001",
    );
  expect(after.invoices).toHaveLength(before.invoices.length + 1);
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.shipments).toEqual(before.shipments);
  expect(await (await page.request.get("/api/effects")).json()).toEqual(
    effectsBefore,
  );
  expect(imported).toMatchObject({
    origin: "opening",
    total: 22600,
    credited: 11300,
    paid: 4000,
    refunded: 1000,
    balance: 8300,
    order_id: null,
    shipment_id: null,
  });
  expect(imported.lines[0]).toMatchObject({
    quantity: 2,
    historical_credited_quantity: 1,
    credited_quantity: 1,
    creditable_quantity: 1,
  });
  await nav(page, "Billing");
  const invoice = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-LEGACY-001" });
  await expect(invoice).toContainText("Historical opening document");
  await expect(invoice).toContainText("BROWSER-DOC-1");
  await expect(invoice).toContainText("$226.00");
  await expect(invoice).toContainText("$83.00");
  await invoice
    .getByRole("button", { name: "Credit units", exact: true })
    .click();
  await expect(page.getByLabel("Invoice line", { exact: true })).toContainText(
    "2 invoiced · 1 credited · 1 remaining",
  );
  await page.getByLabel("Units to credit", { exact: true }).fill("2");
  await page
    .getByLabel("Unique business reference", { exact: true })
    .fill("BROWSER-OVER-CREDIT");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Attempt exceeds the historical remaining units");
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "remaining invoiced quantity",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await invoice
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page.getByLabel("Amount in cents", { exact: true }).fill("1000");
  await page
    .getByLabel("Bank / payment reference", { exact: true })
    .fill("BROWSER-POST-CUTOFF-CASH");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Verified new bank receipt after migration cutoff");
  await next(page);
  await expect(invoice).toContainText("$73.00");
  const updated = await stockFactsDashboard(page),
    paid = updated.invoices.find((i: any) => i.id === imported.id);
  expect(paid).toMatchObject({ paid: 5000, refunded: 1000, balance: 7300 });
  const csv = await (await page.request.get("/api/accounting.csv")).text();
  expect(csv).toContain('"origin","source_ref","source_id","cutoff_at"');
  expect(csv).toContain('"BROWSER-DOCUMENTS-CUTOFF","BROWSER-DOC-1"');
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("source@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-warehouse-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/imports/documents")).status()).toBe(403);
  expect(errors).toEqual([]);
});

test("browser: billing profiles, immutable PDF retries, credit downloads and aging exports show prepared evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/dashboard")).json();
  const invoice = before.invoices.find(
    (i: any) => i.number === "BROWSER-LEGACY-001",
  );
  const downloadsBefore = await (
    await page.request.get("/api/billing/downloads")
  ).json();
  await nav(page, "Billing");
  const issuerName = (
    await (await page.request.get("/api/billing/profiles")).json()
  ).issuer.name;
  const profileRow = page
    .getByRole("row")
    .filter({ hasText: issuerName })
    .filter({
      has: page.getByRole("button", {
        name: "Edit billing details",
        exact: true,
      }),
    });
  await profileRow
    .getByRole("button", { name: "Edit billing details", exact: true })
    .click();
  await page
    .getByLabel("Billing name", { exact: true })
    .fill("Distributeur Québec navigateur");
  await page
    .getByLabel("Billing address", { exact: true })
    .fill("123 rue de Québec\nMontréal QC");
  await page
    .getByLabel("Tax registration", { exact: true })
    .fill("SYNTHETIC-TAX");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic browser billing identity review");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Distributeur Québec navigateur" }),
  ).toContainText("Montréal QC");
  const invoiceRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-LEGACY-001" })
    .filter({
      has: page.getByRole("button", {
        name: "Download invoice PDF",
        exact: true,
      }),
    });
  let lost = false;
  let preparedHash = "";
  let preparedReceipt = "";
  await page.route(
    `**/api/billing/documents/invoice/${invoice.id}/pdf`,
    async (route) => {
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        preparedHash = response.headers()["x-document-sha256"]!;
        preparedReceipt = response.headers()["x-download-receipt"]!;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await invoiceRow
    .getByRole("button", { name: "Download invoice PDF", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await invoiceRow
    .getByRole("button", { name: "Download invoice PDF", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Invoice_BROWSER-LEGACY-001.pdf");
  const bytes = await readFile((await download.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(preparedHash);
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const parts = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const text = await (await pdf.getPage(n)).getTextContent();
    parts.push(text.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  await task.destroy();
  expect(parts.join(" ")).toContain("Distributeur Québec navigateur");
  expect(parts.join(" ")).toContain("CAD 226.00");
  expect(parts.join(" ")).toContain("not the original source PDF");
  expect(parts.join(" ")).toContain("original identities unavailable");
  await expect(
    page.getByRole("heading", {
      name: "Prepared document downloads",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "PDF download prepared. Receipt does not confirm delivery.",
      { exact: true },
    ),
  ).toBeVisible();
  const receipts = await (
    await page.request.get("/api/billing/downloads")
  ).json();
  expect(receipts).toHaveLength(downloadsBefore.length + 1);
  expect(receipts[0]).toMatchObject({
    id: preparedReceipt,
    state: "prepared",
    content_hash: preparedHash,
  });
  const creditPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download credit PDF", exact: true })
    .first()
    .click();
  const credit = await creditPromise;
  expect(credit.suggestedFilename()).toMatch(/^Credit_.*\.pdf$/);
  expect(
    (await readFile((await credit.path())!)).subarray(0, 5).toString(),
  ).toBe("%PDF-");
  const csvPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export aging CSV", exact: true })
    .click();
  const csv = await csvPromise;
  const csvText = await readFile((await csv.path())!, "utf8");
  expect(csvText).toContain('"days_31_60_cents"');
  expect(csvText).toContain('"pending_refunds_cents"');
  expect(errors).toEqual([]);
});

test("browser: provision/change password, retry one grant review, deactivate/reactivate, reset and revoke sessions", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = "browser-lifecycle@example.test",
    initial = "browser-initial-password",
    changed = "browser-changed-password",
    reset = "browser-reset-password",
    final = "browser-final-password";
  const signIn = async (
    p: Page,
    address: string,
    secret: string,
    heading = "Overview",
  ) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(address);
    await p.getByLabel("Password", { exact: true }).fill(secret);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  };
  const passwordChange = async (p: Page, current: string, value: string) => {
    await p.getByLabel("Current password", { exact: true }).fill(current);
    await p
      .getByLabel("New password (14–256 characters)", { exact: true })
      .fill(value);
    await p.getByLabel("Confirm new password", { exact: true }).fill(value);
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      p.getByRole("heading", {
        name: "Sign in to your workspace",
        exact: true,
      }),
    ).toBeVisible();
  };
  await signIn(page, "admin@example.test", "long-test-only-password");
  await nav(page, "Administration");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Browser lifecycle operator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Initial password (14+ characters)", { exact: true })
    .fill(initial);
  await page
    .getByLabel("Your current password", { exact: true })
    .fill("long-test-only-password");
  await page.getByLabel("Role", { exact: true }).selectOption("warehouse");
  await page
    .getByLabel("Permitted warehouses", { exact: true })
    .selectOption({ label: "Toronto" });
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Password change required");
  const workerContext = await browser.newContext(),
    secondContext = await browser.newContext();
  try {
    const worker = await workerContext.newPage(),
      second = await secondContext.newPage();
    worker.on("pageerror", (error) => errors.push(error.message));
    await signIn(worker, email, initial, "Change initial password");
    expect((await worker.request.get("/api/dashboard")).status()).toBe(403);
    await passwordChange(worker, initial, changed);
    await signIn(worker, email, changed);
    await signIn(second, email, changed);
    expect((await worker.request.get("/api/users")).status()).toBe(403);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("v2");
    let discarded = false;
    const keys: string[] = [];
    await page.route("**/api/commands/user.update", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!discarded) {
        discarded = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await row
      .getByRole("button", {
        name: "Edit access: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Permitted warehouses", { exact: true })
      .selectOption({ label: "Ottawa" });
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic reassignment to Ottawa");
    await next(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Failed to fetch",
    );
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await page.unroute("**/api/commands/user.update");
    const users = await (await page.request.get("/api/users")).json(),
      u = users.find((u: any) => u.email === email);
    expect(u.revision).toBe(3);
    expect(u.sessions).toBe(0);
    await expect(row).toContainText("Ottawa");
    for (const p of [worker, second])
      expect((await p.request.get("/api/session")).status()).toBe(401);
    const reviews = await (await page.request.get("/api/audit")).json();
    expect(
      reviews.filter(
        (a: any) => a.action === "user.access.changed" && a.reference === u.id,
      ),
    ).toHaveLength(1);
    const status = async (active: boolean) => {
      await row
        .getByRole("button", {
          name: "Edit access: Browser lifecycle operator",
          exact: true,
        })
        .click();
      await page.getByLabel("Active user", { exact: true }).setChecked(active);
      await page
        .getByLabel("Your current password", { exact: true })
        .fill("long-test-only-password");
      await page
        .getByLabel("Reason / evidence", { exact: true })
        .fill(
          active
            ? "Synthetic reviewed reactivation"
            : "Synthetic access suspension",
        );
      await next(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await status(false);
    await expect(row).toContainText("Inactive");
    const denied = await worker.request.post("/api/login", {
      headers: { origin: "http://127.0.0.1:3117" },
      data: { email, password: changed },
    });
    expect(denied.status()).toBe(401);
    await status(true);
    await signIn(worker, email, changed);
    await row
      .getByRole("button", {
        name: "Reset password: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("New initial password (14+ characters)", { exact: true })
      .fill(reset);
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic help desk reset");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await worker.request.get("/api/session")).status()).toBe(401);
    await signIn(worker, email, reset, "Change initial password");
    await passwordChange(worker, reset, final);
    await signIn(worker, email, final);
    await signIn(second, email, final);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row).toContainText("v7");
    await row
      .getByRole("button", {
        name: "Revoke sessions: Browser lifecycle operator",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("long-test-only-password");
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic all-device revocation");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const p of [worker, second])
      expect((await p.request.get("/api/session")).status()).toBe(401);
    await signIn(worker, email, final);
    await nav(worker, "Security");
    await worker
      .getByRole("button", { name: "End all my sessions", exact: true })
      .click();
    await worker
      .getByRole("dialog")
      .getByRole("button", { name: "End sessions", exact: true })
      .click();
    await expect(
      worker.getByRole("heading", {
        name: "Sign in to your workspace",
        exact: true,
      }),
    ).toBeVisible();
    expect((await worker.request.get("/api/session")).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    await workerContext.close();
    await secondContext.close();
  }
});

test("browser: receipt scans save without stock, resume after reload, review camera values and retry one confirmed receipt", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installScanHarness(page);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Catalog");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("SKU", { exact: true }).fill("BROWSER-SCAN");
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Synthetic scanned equipment");
  await page.getByLabel("Unit price in cents", { exact: true }).fill("10000");
  await page
    .getByLabel("Tax rate in basis points", { exact: true })
    .fill("1300");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Purchasing");
  await page
    .getByRole("button", { name: "Purchase order", exact: true })
    .click();
  await page
    .getByLabel("Warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  await page
    .getByLabel("Purchase product search", { exact: true })
    .fill("BROWSER-SCAN");
  await page
    .getByRole("button", { name: "Search purchase products", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add BROWSER-SCAN", exact: true })
    .click();
  await page.getByLabel("Units for BROWSER-SCAN", { exact: true }).fill("2");
  await page
    .getByLabel("Unit cost in cents for BROWSER-SCAN", { exact: true })
    .fill("6000");
  await page
    .getByRole("button", { name: "Review purchase order", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Create reviewed purchase order",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const poRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-SCAN · 0/2 received" });
  await poRow
    .getByRole("button", { name: "Start receipt draft", exact: true })
    .click();
  await page
    .getByLabel("Supplier delivery reference", { exact: true })
    .fill("BROWSER-SCAN-DELIVERY");
  await page
    .getByLabel("Observed SKU on delivery", { exact: true })
    .fill("WRONG-SKU");
  await page.getByLabel("Units", { exact: true }).fill("2");
  await page
    .getByLabel("Serials, one per line (blank for bulk)", { exact: true })
    .fill("BROWSER-D1");
  await page.getByLabel("Receiving bin", { exact: true }).fill("SCAN-BIN");
  const saveDraft = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
  await saveDraft();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Observed SKU",
  );
  const skuScanner = page.getByRole("region", {
    name: "Scanner for Observed SKU on delivery",
    exact: true,
  });
  await page.evaluate(() =>
    (window as any).__scanHarness.queue.push(["BROWSER-SCAN"]),
  );
  await skuScanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(skuScanner).toContainText("Detected: BROWSER-SCAN");
  await expect(
    page.getByLabel("Observed SKU on delivery", { exact: true }),
  ).toHaveValue("WRONG-SKU");
  await skuScanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(
    page.getByLabel("Observed SKU on delivery", { exact: true }),
  ).toHaveValue("BROWSER-SCAN");
  expect(await page.evaluate(() => (window as any).__scanHarness.stops)).toBe(
    1,
  );
  const saveKeys: string[] = [];
  await page.route("**/api/commands/purchase.draft.save", async (route) => {
    saveKeys.push(route.request().headers()["idempotency-key"]!);
    if (saveKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await saveDraft();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await saveDraft();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saveKeys).toHaveLength(2);
  expect(saveKeys[0]).toBe(saveKeys[1]);
  await page.unroute("**/api/commands/purchase.draft.save");
  const draftRow = page
    .getByRole("row")
    .filter({ hasText: "BROWSER-SCAN-DELIVERY" });
  await expect(draftRow).toContainText("draft · v1");
  await expect(poRow).toContainText("0/2 received");
  await page.reload();
  await nav(page, "Purchasing");
  await draftRow
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "exactly one unique serial",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await draftRow
    .getByRole("button", { name: "Resume scans", exact: true })
    .click();
  const serials = page.getByLabel("Serials, one per line (blank for bulk)", {
    exact: true,
  });
  await expect(serials).toHaveValue("BROWSER-D1");
  const scanner = page.getByRole("region", {
    name: "Scanner for Serials, one per line (blank for bulk)",
    exact: true,
  });
  const detect = async (values: string[]) => {
    await page.evaluate(
      (values) => (window as any).__scanHarness.queue.push(values),
      values,
    );
    await scanner
      .getByRole("button", { name: "Scan with camera", exact: true })
      .click();
  };
  await detect(["BROWSER-D1", "BROWSER-D2"]);
  await expect(scanner).toContainText("More than one label");
  await page.evaluate(() =>
    (window as any).__scanHarness.queue.push(["BROWSER-D1"]),
  );
  await expect(scanner).toContainText("Detected: BROWSER-D1");
  await scanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(scanner).toContainText("already in the list");
  await expect(serials).toHaveValue("BROWSER-D1");
  await detect(["BROWSER-D2"]);
  await expect(scanner).toContainText("Detected: BROWSER-D2");
  await scanner
    .getByRole("button", { name: "Use detected value", exact: true })
    .click();
  await expect(serials).toHaveValue("BROWSER-D1\nBROWSER-D2");
  await saveDraft();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(draftRow).toContainText("draft · v2");
  const confirmKeys: string[] = [];
  await page.route("**/api/commands/purchase.draft.confirm", async (route) => {
    confirmKeys.push(route.request().headers()["idempotency-key"]!);
    if (confirmKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await draftRow
    .getByRole("button", { name: "Review and receive", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "BROWSER-D1, BROWSER-D2",
  );
  const receive = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Receive stock", exact: true })
      .click();
  await receive();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await receive();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(confirmKeys).toHaveLength(2);
  expect(confirmKeys[0]).toBe(confirmKeys[1]);
  const savedRow = draftRow.filter({ hasText: "received · v3" });
  await expect(savedRow).toHaveCount(1);
  const purchases = await (await page.request.get("/api/purchases")).json();
  const draft = purchases.drafts.find(
    (d: any) => d.delivery_ref === "BROWSER-SCAN-DELIVERY",
  );
  expect(
    purchases.receipts.filter((r: any) => r.po_id === draft.po_id),
  ).toHaveLength(1);
  const dashboard = await stockFactsDashboard(page);
  const stock = dashboard.stock.filter((u: any) =>
    ["BROWSER-D1", "BROWSER-D2"].includes(u.serial),
  );
  expect(stock).toHaveLength(2);
  expect(stock.reduce((s: number, u: any) => s + u.quantity * u.cost, 0)).toBe(
    12000,
  );
  expect(stock.every((u: any) => u.condition === "quarantine")).toBe(true);
  await savedRow
    .getByRole("button", { name: "View draft history", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("v1 · draft");
  await expect(page.getByRole("dialog")).toContainText("v3 · received");
  expect(errors).toEqual([]);
});

test("browser: camera fallback, Enter suffix and cancelled pending access preserve manual entry and release late streams", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installScanHarness(page);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Inventory");
  const open = () =>
    page.getByRole("button", { name: "Find serial", exact: true }).click();
  await open();
  const scanner = page.getByRole("region", {
    name: "Scanner for Scan or enter serial",
    exact: true,
  });
  await page.evaluate(() => {
    (window as any).BarcodeDetector = undefined;
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner).toContainText("unavailable in this browser");
  expect(
    await page.evaluate(() => (window as any).__scanHarness.requests),
  ).toBe(0);
  await page.getByLabel("Scan or enter serial", { exact: true }).fill("S1");
  await page.getByLabel("Scan or enter serial", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Serial history", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).BarcodeDetector = (window as any).__scanHarness.detector;
    (window as any).__scanHarness.mode = "deny";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner).toContainText("Camera access unavailable");
  await expect(
    page.getByLabel("Scan or enter serial", { exact: true }),
  ).toHaveValue("S1");
  await page.evaluate(() => {
    (window as any).__scanHarness.mode = "pending";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as any).__scanHarness.resolve)),
    )
    .toBe(true);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.evaluate(() => (window as any).__scanHarness.resolve());
  await expect
    .poll(() => page.evaluate(() => (window as any).__scanHarness.stops))
    .toBe(1);
  await open();
  await page.evaluate(() => {
    (window as any).__scanHarness.mode = "allow";
  });
  await scanner
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  await expect(scanner.getByRole("status")).toContainText("Show one label");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__scanHarness.stops))
    .toBe(2);
  expect(errors).toEqual([]);
});

test("browser: customer inbox review, cancellation and lost responses preserve explicit personal receipt and withdrawal history", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const origin = "http://127.0.0.1:3117";
  const initial = "inbox-initial-password",
    password = "inbox-changed-password";
  const signIn = async (
    p: Page,
    email: string,
    secret: string,
    heading = "Overview",
  ) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(secret);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  };
  const cmd = async (name: string, data: unknown) => {
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin,
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const inbox = async (p = page) =>
    (await p.request.get("/api/billing/inbox")).json();
  await signIn(page, "admin@example.test", "long-test-only-password");
  const account = await cmd("account.create", {
    name: "Browser inbox customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const other = await cmd("account.create", {
    name: "Browser other inbox customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "INBOX-BROWSER",
    name: "Synthetic inbox equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const dashboard = await stockFactsDashboard(page);
  const warehouseId = dashboard.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const orders = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: orders.orders.find((x: any) => x.id === po.id).lines[0].id,
    deliveryRef: "BROWSER-INBOX-DELIVERY",
    quantity: 2,
    serials: [],
    bin: "INBOX",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await stockFactsDashboard(page);
  const pack = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((x: any) => x.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: pack.id,
    handoverEvidence: "Synthetic inbox handover",
  });
  for (const [suffix, accountId] of [
    ["buyer", account.id],
    ["colleague", account.id],
    ["other", other.id],
  ])
    await cmd("user.create", {
      email: `inbox-${suffix}@example.test`,
      name: `Inbox ${suffix}`,
      password: initial,
      role: "buyer",
      accountId,
      sites: [],
      currentPassword: "long-test-only-password",
    });
  const before = await stockFactsDashboard(page);
  const invoice = before.invoices.find((i: any) => i.id === shipped.invoiceId);
  expect(invoice.total).toBe(22600);
  await page.reload();
  await nav(page, "Billing");
  const invoiceRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Download invoice PDF",
        exact: true,
      }),
    })
    .filter({ hasText: invoice.number });
  const review = async () => {
    const event = page.waitForEvent("download");
    await invoiceRow
      .getByRole("button", { name: "Review and publish invoice", exact: true })
      .click();
    const download = await event;
    const bytes = await readFile((await download.path())!);
    await expect(
      page.getByRole("dialog", { name: "Publish reviewed PDF", exact: true }),
    ).toBeVisible();
    return bytes;
  };
  const original = await review();
  const hash = createHash("sha256").update(original).digest("hex");
  await expect(page.getByRole("dialog")).toContainText(
    "buyer must separately confirm receipt",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (await inbox()).filter((p: any) => p.document_id === invoice.id),
  ).toHaveLength(0);
  expect(await review()).toEqual(original);
  const publishKeys: string[] = [];
  await page.route("**/api/commands/billing.portal.publish", async (route) => {
    publishKeys.push(route.request().headers()["idempotency-key"]!);
    if (publishKeys.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("dialog")
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic finance review of original customer PDF");
  const publish = page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish to customer inbox", exact: true });
  await publish.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await publish.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(publishKeys).toHaveLength(2);
  expect(publishKeys[0]).toBe(publishKeys[1]);
  await page.unroute("**/api/commands/billing.portal.publish");
  const publications = (await inbox()).filter(
    (p: any) => p.document_id === invoice.id,
  );
  expect(publications).toHaveLength(1);
  const publication = publications[0];
  expect(publication.content_hash).toBe(hash);
  expect(publication.acknowledgments).toHaveLength(0);
  const contexts = [];
  try {
    const buyerContext = await browser.newContext();
    contexts.push(buyerContext);
    const buyer = await buyerContext.newPage();
    const loginBuyer = async (p: Page, suffix: string) => {
      await signIn(
        p,
        `inbox-${suffix}@example.test`,
        initial,
        "Change initial password",
      );
      await p.getByLabel("Current password", { exact: true }).fill(initial);
      await p
        .getByLabel("New password (14–256 characters)", { exact: true })
        .fill(password);
      await p
        .getByLabel("Confirm new password", { exact: true })
        .fill(password);
      await p
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(
        p.getByRole("heading", {
          name: "Sign in to your workspace",
          exact: true,
        }),
      ).toBeVisible();
      await signIn(p, `inbox-${suffix}@example.test`, password);
      await nav(p, "Billing");
    };
    await loginBuyer(buyer, "buyer");
    const otherContext = await browser.newContext();
    contexts.push(otherContext);
    const otherBuyer = await otherContext.newPage();
    await loginBuyer(otherBuyer, "other");
    expect(await inbox(otherBuyer)).toEqual([]);
    await expect(
      otherBuyer.getByRole("row").filter({ hasText: invoice.number }),
    ).toHaveCount(0);
    const buyerRow = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    const downloadKeys: string[] = [];
    await buyer.route(
      `**/api/billing/inbox/${publication.id}/pdf`,
      async (route) => {
        downloadKeys.push(route.request().headers()["idempotency-key"]!);
        if (downloadKeys.length === 1) {
          const response = await route.fetch(),
            headers = response.headers();
          delete headers["x-download-receipt"];
          await route.fulfill({ response, headers });
        } else if (downloadKeys.length === 2) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    const downloadButton = buyerRow.getByRole("button", {
      name: "Download and review receipt",
      exact: true,
    });
    await downloadButton.click();
    await expect(buyer.getByRole("alert")).toContainText(
      "Download receipt is missing",
    );
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await downloadButton.click();
    await expect(buyer.getByRole("alert")).toBeVisible();
    const event = buyer.waitForEvent("download");
    await downloadButton.click();
    const downloaded = await event;
    expect(await readFile((await downloaded.path())!)).toEqual(original);
    await expect(
      buyer.getByRole("dialog", {
        name: "Confirm document receipt",
        exact: true,
      }),
    ).toBeVisible();
    expect(downloadKeys).toHaveLength(3);
    expect(new Set(downloadKeys).size).toBe(1);
    let current = (await inbox())[0];
    expect(current.downloads).toHaveLength(1);
    expect(current.downloads[0].state).toBe("prepared");
    expect(current.acknowledgments).toHaveLength(0);
    await buyer
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await inbox())[0].acknowledgments).toHaveLength(0);
    const confirmDownload = buyer.waitForEvent("download");
    await downloadButton.click();
    await confirmDownload;
    const confirmDialog = buyer.getByRole("dialog", {
      name: "Confirm document receipt",
      exact: true,
    });
    await expect(confirmDialog).toContainText(
      "does not confirm payment or agreement",
    );
    const ackKeys: string[] = [];
    await buyer.route(
      "**/api/commands/billing.portal.acknowledge",
      async (route) => {
        ackKeys.push(route.request().headers()["idempotency-key"]!);
        if (ackKeys.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await confirmDialog
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(confirmDialog.getByRole("alert")).toBeVisible();
    await confirmDialog
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(confirmDialog).toHaveCount(0);
    expect(ackKeys).toHaveLength(2);
    expect(ackKeys[0]).toBe(ackKeys[1]);
    current = (await inbox())[0];
    expect(current.acknowledgments).toHaveLength(1);
    expect(current.acknowledgments[0].content_hash).toBe(hash);
    expect(current.acknowledgments[0].actor_name).toBe("Inbox buyer");
    const received = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download received PDF",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    const again = buyer.waitForEvent("download");
    await received
      .getByRole("button", { name: "Download received PDF", exact: true })
      .click();
    await again;
    await expect(
      received.getByRole("button", {
        name: "Download received PDF",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    expect((await inbox())[0].acknowledgments).toHaveLength(1);
    const colleagueContext = await browser.newContext();
    contexts.push(colleagueContext);
    const colleague = await colleagueContext.newPage();
    await loginBuyer(colleague, "colleague");
    const personal = (await inbox(colleague)).find(
      (p: any) => p.id === publication.id,
    );
    expect(personal.downloads).toHaveLength(0);
    expect(personal.acknowledgments).toHaveLength(0);
    await expect(
      colleague
        .getByRole("row")
        .filter({
          has: colleague.getByRole("button", {
            name: "Download and review receipt",
            exact: true,
          }),
        })
        .filter({ hasText: invoice.number }),
    ).toContainText("Awaiting buyer confirmation");
    await page.reload();
    await nav(page, "Billing");
    const staffRow = page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Withdraw publication",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    await expect(staffRow).toContainText("Inbox buyer");
    await staffRow
      .getByRole("button", { name: "Withdraw publication", exact: true })
      .click();
    const withdrawDialog = page.getByRole("dialog", {
      name: "Withdraw portal publication",
      exact: true,
    });
    await withdrawDialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic routing correction");
    const withdrawalKeys: string[] = [];
    await page.route(
      "**/api/commands/billing.portal.withdraw",
      async (route) => {
        withdrawalKeys.push(route.request().headers()["idempotency-key"]!);
        if (withdrawalKeys.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await withdrawDialog
      .getByRole("button", { name: "Withdraw from inbox", exact: true })
      .click();
    await expect(withdrawDialog.getByRole("alert")).toBeVisible();
    await withdrawDialog
      .getByRole("button", { name: "Withdraw from inbox", exact: true })
      .click();
    await expect(withdrawDialog).toHaveCount(0);
    expect(withdrawalKeys).toHaveLength(2);
    expect(withdrawalKeys[0]).toBe(withdrawalKeys[1]);
    // A stale open page must recheck withdrawal before delivering cached bytes.
    await received
      .getByRole("button", { name: "Download received PDF", exact: true })
      .click();
    await expect(buyer.getByRole("alert")).toContainText("DOCUMENT_WITHDRAWN");
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    await buyer.reload();
    await nav(buyer, "Billing");
    await expect(
      buyer.getByRole("button", { name: "Download received PDF", exact: true }),
    ).toHaveCount(0);
    current = (await inbox())[0];
    expect(current.state).toBe("withdrawn");
    expect(current.acknowledgments).toHaveLength(1);
    const after = await stockFactsDashboard(page);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.stock).toEqual(before.stock);
    expect(after.orders).toEqual(before.orders);
    expect(after.shipments).toEqual(before.shipments);
    expect(await review()).toEqual(original);
    await page
      .getByRole("dialog")
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic reviewed republication");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish to customer inbox", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const history = (await inbox()).filter(
      (p: any) => p.document_id === invoice.id,
    );
    expect(history).toHaveLength(2);
    const replacement = history.find((p: any) => p.state === "available");
    expect(replacement.id).not.toBe(publication.id);
    expect(replacement.content_hash).toBe(hash);
    expect(replacement.acknowledgments).toHaveLength(0);
    expect(
      history.find((p: any) => p.id === publication.id).acknowledgments,
    ).toHaveLength(1);
    const credit = await cmd("billing.credit", {
      invoiceId: invoice.id,
      reference: "BROWSER-INBOX-CREDIT",
      reason: "Synthetic original-price return",
      lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
    });
    await page.reload();
    await nav(page, "Billing");
    const creditRow = page
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Review and publish credit",
          exact: true,
        }),
      })
      .filter({ hasText: credit.number });
    const creditDownload = page.waitForEvent("download");
    await creditRow
      .getByRole("button", { name: "Review and publish credit", exact: true })
      .click();
    const creditBytes = await readFile((await (await creditDownload).path())!);
    const creditHash = createHash("sha256").update(creditBytes).digest("hex");
    await expect(
      page.getByRole("dialog", { name: "Publish reviewed PDF", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic credit PDF review");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish to customer inbox", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const creditPub = (await inbox()).find(
      (p: any) => p.document_id === credit.id,
    );
    expect(creditPub.kind).toBe("credit");
    expect(creditPub.content_hash).toBe(creditHash);
    await buyer.reload();
    await nav(buyer, "Billing");
    const buyerCredit = buyer
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: creditPub.number });
    const creditEvent = buyer.waitForEvent("download");
    await buyerCredit
      .getByRole("button", { name: "Download and review receipt", exact: true })
      .click();
    expect(await readFile((await (await creditEvent).path())!)).toEqual(
      creditBytes,
    );
    await buyer
      .getByRole("dialog", { name: "Confirm document receipt", exact: true })
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click();
    await expect(buyer.getByRole("dialog")).toHaveCount(0);
    expect(
      (await inbox()).find((p: any) => p.id === creditPub.id).acknowledgments[0]
        .content_hash,
    ).toBe(creditHash);
    const final = await stockFactsDashboard(page);
    expect(final.invoices.find((i: any) => i.id === invoice.id).balance).toBe(
      11300,
    );
    expect(final.stock).toEqual(before.stock);
    expect(final.orders).toEqual(before.orders);
    expect(final.shipments).toEqual(before.shipments);
    // Exercise real continuation beyond the first 50 rows and request records.
    const buyerSession = await (await buyer.request.get("/api/session")).json();
    const buyerHeaders = { origin, "x-csrf-token": buyerSession.csrf };
    const requestIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      const response = await buyer.request.post(
        `/api/billing/inbox/${replacement.id}/pdf`,
        {
          headers: { ...buyerHeaders, "idempotency-key": crypto.randomUUID() },
          data: {},
        },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      requestIds.push(response.headers()["x-download-receipt"]!);
    }
    const reviewedCredit = await page.request.post(
      `/api/billing/documents/credit/${credit.id}/pdf`,
      {
        headers: {
          origin,
          "x-csrf-token": (
            await (await page.request.get("/api/session")).json()
          ).csrf,
          "idempotency-key": crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(reviewedCredit.ok()).toBeTruthy();
    const creditReviewId = reviewedCredit.headers()["x-download-receipt"]!;
    let currentCredit = creditPub;
    const republishCredit = async () => {
      await cmd("billing.portal.withdraw", {
        publicationId: currentCredit.id,
        revision: 1,
        reason: "Synthetic history pagination",
      });
      currentCredit = await cmd("billing.portal.publish", {
        downloadId: creditReviewId,
        reason: "Synthetic reviewed credit republication",
      });
    };
    for (let i = 0; i < 55; i++) await republishCredit();
    await page.reload();
    await nav(page, "Billing");
    await expect(
      invoiceRow.getByRole("button", {
        name: "Review and publish invoice",
        exact: true,
      }),
    ).toHaveCount(0);
    const staffInbox = page.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await expect(
      staffInbox.getByRole("row").filter({ hasText: invoice.number }),
    ).toHaveCount(0);
    await buyer.reload();
    await nav(buyer, "Billing");
    const buyerInbox = buyer.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    const olderUrls: string[] = [];
    await buyer.route("**/api/billing/inbox/page?after=*", async (route) => {
      olderUrls.push(route.request().url());
      if (olderUrls.length === 1) await route.abort("failed");
      else await route.continue();
    });
    await republishCredit(); // Later insertion must not enter the existing continuation.
    await buyerInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("alert")).toBeVisible();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    await buyerInbox
      .getByRole("button", { name: "Retry older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "58 publications loaded",
    );
    expect(olderUrls).toHaveLength(2);
    expect(olderUrls[0]).toBe(olderUrls[1]);
    expect(await buyerInbox.getByRole("row").count()).toBe(59); // Header plus exactly 58 rows.
    const replacementRow = buyerInbox
      .getByRole("row")
      .filter({
        has: buyer.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number });
    await replacementRow
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    const historyPanel = buyer.getByRole("region", {
      name: "Document history",
      exact: true,
    });
    const requests = historyPanel.getByRole("region", {
      name: "Prepared PDF requests",
      exact: true,
    });
    await expect(requests.getByRole("status")).toHaveText("50 records loaded");
    const historyUrls: string[] = [];
    await buyer.route(
      `**/api/billing/inbox/${replacement.id}/history/downloads?after=*`,
      async (route) => {
        historyUrls.push(route.request().url());
        if (historyUrls.length === 1) await route.abort("failed");
        else await route.continue();
      },
    );
    await requests
      .getByRole("button", {
        name: "Load older PDF requests",
        exact: true,
      })
      .click();
    await expect(requests.getByRole("alert")).toBeVisible();
    await expect(requests.getByRole("status")).toHaveText("50 records loaded");
    await requests
      .getByRole("button", { name: "Retry PDF requests", exact: true })
      .click();
    await expect(requests.getByRole("status")).toHaveText("55 records loaded");
    expect(historyUrls).toHaveLength(2);
    expect(historyUrls[0]).toBe(historyUrls[1]);
    const requestText = await requests.getByRole("row").allTextContents();
    for (const id of requestIds)
      expect(requestText.filter((text) => text.includes(id))).toHaveLength(1);
    await expect(requests).toContainText("prepared only");
    await expect(
      historyPanel
        .getByRole("region", { name: "Receipt confirmations", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await historyPanel
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    await expect(
      replacementRow.getByRole("button", {
        name: "View document history",
        exact: true,
      }),
    ).toBeFocused();
    // Refresh discards continuation and history, then includes the newest insertion.
    await buyer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "50 publications loaded",
    );
    await buyerInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await expect(buyerInbox.getByRole("status")).toHaveText(
      "59 publications loaded",
    );
    const withdrawn = buyerInbox
      .getByRole("row")
      .filter({ hasText: invoice.number })
      .filter({ hasText: "withdrawn" });
    await withdrawn
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await expect(
      historyPanel.getByRole("region", {
        name: "Receipt confirmations",
        exact: true,
      }),
    ).toContainText("Inbox buyer");
    await expect(
      historyPanel.getByRole("region", {
        name: "Receipt confirmations",
        exact: true,
      }),
    ).toContainText("does not confirm payment or agreement");
    // A colleague sees no personal requests for this same publication.
    await colleague.reload();
    await nav(colleague, "Billing");
    const colleagueInbox = colleague.getByRole("region", {
      name: "Customer document inbox",
      exact: true,
    });
    await colleagueInbox
      .getByRole("button", { name: "Load older documents", exact: true })
      .click();
    await colleagueInbox
      .getByRole("row")
      .filter({
        has: colleague.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number })
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await expect(
      colleague
        .getByRole("region", { name: "Prepared PDF requests", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await expect(
      colleague
        .getByRole("region", { name: "Receipt confirmations", exact: true })
        .getByRole("status"),
    ).toHaveText("0 records loaded");
    await colleague
      .getByRole("region", { name: "Document history", exact: true })
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    const delayedUrl = `**/api/billing/inbox/${replacement.id}/history/downloads`;
    let release!: () => void, started!: () => void, finished!: () => void;
    const pendingResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    const responseStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const responseFinished = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await colleague.route(delayedUrl, async (route) => {
      const response = await route.fetch();
      started();
      await pendingResponse;
      try {
        await route.fulfill({ response });
      } catch {
        /* Closing the history cancels this read. */
      }
      finished();
    });
    await colleagueInbox
      .getByRole("row")
      .filter({
        has: colleague.getByRole("button", {
          name: "Download and review receipt",
          exact: true,
        }),
      })
      .filter({ hasText: invoice.number })
      .getByRole("button", { name: "View document history", exact: true })
      .click();
    await responseStarted;
    await colleague
      .getByRole("region", { name: "Document history", exact: true })
      .getByRole("button", { name: "Close document history", exact: true })
      .click();
    release();
    await responseFinished;
    await expect(
      colleague.getByRole("region", { name: "Document history", exact: true }),
    ).toHaveCount(0);
    await colleague.unroute(delayedUrl);
    const paginationFinal = await stockFactsDashboard(page);
    expect(paginationFinal).toEqual(final);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("browser: manual manufacturer history recovers lost responses, rejects stale decisions and preserves stock and money", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Manufacturer browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "MFG-BROWSER",
    name: "Manufacturer browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "MFG-DELIVERY",
    quantity: 1,
    serials: ["MFG-SERIAL"],
    bin: "MFG",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "MFG-SERIAL").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "mfg-issue",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  const before = await dashboard();
  const originalClaim = before.claims.find((c: any) => c.id === claim.id);
  const invariant = (value: any) => ({
    stock: value.stock,
    orders: value.orders,
    shipments: value.shipments,
    invoices: value.invoices,
  });
  const keys: string[] = [];
  let lost = false;
  await page.route(
    "**/api/commands/warranty.manufacturer.refer",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.reload();
  await nav(page, "Returns");
  const claimRow = page
    .getByRole("row")
    .filter({ hasText: claim.id.slice(0, 8) })
    .filter({
      has: page.getByRole("button", {
        name: "Record manufacturer referral",
        exact: true,
      }),
    });
  const refer = async (reference: string) => {
    await claimRow
      .getByRole("button", {
        name: "Record manufacturer referral",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Record manufacturer referral",
      exact: true,
    });
    await dialog
      .getByLabel("Manufacturer", { exact: true })
      .fill("Synthetic Maker");
    await dialog
      .getByLabel("Manufacturer case reference", { exact: true })
      .fill(reference);
    await dialog
      .getByLabel("Referral evidence reference", { exact: true })
      .fill("mfg-referral-" + reference);
    await dialog
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Requested externally");
    await dialog
      .getByRole("button", { name: "Record referral", exact: true })
      .click();
    return dialog;
  };
  const referralDialog = await refer("BROWSER-M-001");
  await expect(referralDialog.getByRole("alert")).toBeVisible();
  await referralDialog
    .getByRole("button", { name: "Record referral", exact: true })
    .click();
  await expect(referralDialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const section = page.getByRole("region", {
    name: "Manufacturer case history",
    exact: true,
  });
  const first = section.getByRole("row").filter({ hasText: "BROWSER-M-001" });
  await expect(first).toContainText("pending · revision 1");
  await first
    .getByRole("button", { name: "Record manufacturer response", exact: true })
    .click();
  const responseDialog = page.getByRole("dialog", {
    name: "Record manufacturer response",
    exact: true,
  });
  const pending = (await dashboard()).claims.find((c: any) => c.id === claim.id)
    .manufacturerCases[0];
  await cmd("warranty.manufacturer.decide", {
    caseId: pending.id,
    revision: 1,
    outcome: "accepted",
    evidence: "mfg-concurrent-response",
    reason: "Recorded by another staff session",
  });
  await responseDialog
    .getByLabel("Manufacturer outcome", { exact: true })
    .selectOption("denied");
  await responseDialog
    .getByLabel("Response evidence reference", { exact: true })
    .fill("mfg-stale-response");
  await responseDialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Stale attempt");
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog.getByRole("alert")).toContainText(
    "Manufacturer case changed",
  );
  await responseDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(first).toContainText("accepted · revision 2");
  await expect(first).not.toContainText("mfg-stale-response");
  const followup = await refer("BROWSER-M-002");
  await expect(followup).not.toBeVisible();
  const second = section.getByRole("row").filter({ hasText: "BROWSER-M-002" });
  const responseKeys: string[] = [];
  let lostResponse = false;
  await page.route(
    "**/api/commands/warranty.manufacturer.decide",
    async (route) => {
      responseKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostResponse) {
        lostResponse = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await second
    .getByRole("button", { name: "Record manufacturer response", exact: true })
    .click();
  await responseDialog
    .getByLabel("Manufacturer outcome", { exact: true })
    .selectOption("cancelled");
  await responseDialog
    .getByLabel("Response evidence reference", { exact: true })
    .fill("mfg-cancellation");
  await responseDialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic duplicate enquiry withdrawn externally");
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog.getByRole("alert")).toBeVisible();
  await responseDialog
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(responseDialog).not.toBeVisible();
  expect(responseKeys).toHaveLength(2);
  expect(responseKeys[0]).toBe(responseKeys[1]);
  await page.reload();
  await nav(page, "Returns");
  await expect(first).toContainText("accepted · revision 2");
  await expect(second).toContainText("cancelled · revision 2");
  const after = await dashboard();
  const finalClaim = after.claims.find((c: any) => c.id === claim.id);
  expect(finalClaim.manufacturerCases).toHaveLength(2);
  expect(
    finalClaim.manufacturerCases.map((m: any) => m.history.length),
  ).toEqual([2, 2]);
  const { manufacturerCases: _beforeCases, ...original } = originalClaim;
  const { manufacturerCases: _afterCases, ...final } = finalClaim;
  expect(final).toEqual(original);
  expect(invariant(after)).toEqual(invariant(before));
  expect(after.invoices.find((i: any) => i.order_id === order.id).total).toBe(
    11300,
  );
  expect(errors).toEqual([]);
});

test("browser: replacement collection retries, cancellation, scan validation and successor claim retain serial history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Replacement browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "REP-BROWSER",
    name: "Replacement browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 3, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "REP-DELIVERY",
    quantity: 3,
    serials: ["REP-OLD", "REP-NEW", "REP-SPARE"],
    bin: "REP",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "REP-OLD").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "mfg-issue",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  await cmd("warranty.receive", {
    claimId: claim.id,
    warehouseId,
    bin: "REP-Q",
    serial: "REP-OLD",
  });
  await cmd("warranty.inspect", {
    claimId: claim.id,
    findings: "Synthetic replacement inspection",
  });
  const before = await dashboard();
  const finances = (d: any) => ({
    orders: d.orders,
    shipments: d.shipments,
    invoices: d.invoices,
  });
  await page.reload();
  await nav(page, "Returns");
  const section = page.getByRole("region", {
    name: "Replacement history",
    exact: true,
  });
  const claimRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Approve replacement",
        exact: true,
      }),
    })
    .filter({ hasText: claim.id.slice(0, 8) });
  const reserve = async () => {
    await claimRow
      .getByRole("button", { name: "Approve replacement", exact: true })
      .click();
    await page.getByLabel("Replacement serial", { exact: true }).selectOption({
      label: `REP-NEW · ${before.warehouses.find((w: any) => w.id === warehouseId).name} / REP`,
    });
    await page
      .getByLabel("Reason / evidence", { exact: true })
      .fill("Synthetic replacement review");
    await page
      .getByRole("button", { name: "Reserve replacement", exact: true })
      .click();
  };
  await reserve();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let current = (await dashboard()).claims.find((c: any) => c.id === claim.id)
    .replacements[0];
  await section
    .getByRole("button", { name: "Hand over replacement", exact: true })
    .click();
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-NEW");
  await page
    .getByLabel("Collection recipient", { exact: true })
    .fill("Synthetic recipient");
  await page
    .getByLabel("Collection evidence reference", { exact: true })
    .fill("Synthetic stale dialog");
  await cmd("warranty.replacement.cancel", {
    replacementId: current.id,
    revision: 1,
    reason: "Synthetic concurrent cancellation",
  });
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Replacement changed",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(section).toContainText("cancelled · v2");
  const keys: Record<string, string[]> = {};
  const lost = new Set<string>();
  for (const name of [
    "warranty.replacement.reserve",
    "warranty.replacement.handover",
  ]) {
    keys[name] = [];
    await page.route(`**/api/commands/${name}`, async (route) => {
      keys[name]!.push(route.request().headers()["idempotency-key"]!);
      if (!lost.has(name)) {
        lost.add(name);
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
  }
  await reserve();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Reserve replacement", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const activeRow = section.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "Hand over replacement",
      exact: true,
    }),
  });
  await activeRow
    .getByRole("button", { name: "Hand over replacement", exact: true })
    .click();
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-SPARE");
  await page
    .getByLabel("Collection recipient", { exact: true })
    .fill("Synthetic recipient");
  await page
    .getByLabel("Collection evidence reference", { exact: true })
    .fill("Synthetic collection receipt");
  // Invalid scan is checked before installing lost-response interception for a successful handover.
  await page.unroute("**/api/commands/warranty.replacement.handover");
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Scanned replacement serial does not match",
  );
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("REP-NEW");
  await page.route(
    "**/api/commands/warranty.replacement.handover",
    async (route) => {
      const name = "warranty.replacement.handover";
      keys[name]!.push(route.request().headers()["idempotency-key"]!);
      if (!lost.has(name)) {
        lost.add(name);
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Record handover", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const v of Object.values(keys)) {
    expect(v).toHaveLength(2);
    expect(v[0]).toBe(v[1]);
  }
  await page.reload();
  await nav(page, "Returns");
  await expect(section).toContainText("handed_over · v2");
  await expect(section).toContainText("Synthetic collection receipt");
  const after = await dashboard();
  expect(finances(after)).toEqual(finances(before));
  expect(after.stock.find((u: any) => u.serial === "REP-OLD").state).toBe(
    "scrapped",
  );
  expect(after.stock.find((u: any) => u.serial === "REP-NEW").state).toBe(
    "sold",
  );
  expect(after.stock.find((u: any) => u.serial === "REP-SPARE").available).toBe(
    1,
  );
  const native = page
    .getByRole("row")
    .filter({ hasText: claim.id.slice(0, 8) })
    .filter({ hasText: "Synthetic failure" });
  await expect(
    native.getByRole("button", { name: "Issue return credit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Submit claim / return", exact: true })
    .click();
  await page.getByLabel("Search sold serials", { exact: true }).fill("REP-NEW");
  await page
    .getByRole("button", { name: "Search serials", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Sold serial search status" }),
  ).toContainText("1 sold serial");
  await page
    .getByLabel("Sold serial", { exact: true })
    .selectOption({ label: "REP-NEW" });
  await expect(
    page
      .getByLabel("Sold serial", { exact: true })
      .locator("option")
      .filter({ hasText: "REP-OLD" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Request type", { exact: true })
    .selectOption("warranty");
  await page
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic successor failure");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Synthetic successor evidence");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const final = await dashboard(),
    successor = final.claims.find(
      (c: any) => c.issue === "Synthetic successor failure",
    ),
    original = final.claims.find((c: any) => c.id === claim.id);
  expect(successor.invoice_id).toBe(original.invoice_id);
  expect(successor.coverage_end).toBe(original.coverage_end);
  expect(errors).toEqual([]);
});

test("browser: credited cash refund request and bank verification retry one reservation and one repayment", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const account = await cmd("account.create", {
    name: "Refund browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "REF-BROWSER",
    name: "Refund browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await stockFactsDashboard(page),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const received = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: received.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "REF-BROWSER-DEL",
    quantity: 1,
    serials: ["REF-BROWSER-UNIT"],
    bin: "REF",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await stockFactsDashboard(page);
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic refund fixture counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic refund fixture handover",
  });
  const invoiceId = shipped.invoiceId;
  await cmd("billing.payment.manual", {
    invoiceId,
    amount: 11300,
    reference: "REF-BROWSER-PAY",
    reason: "Synthetic payment evidence",
  });
  const paid = await stockFactsDashboard(page),
    invoice = paid.invoices.find((i: any) => i.id === invoiceId);
  await cmd("billing.credit", {
    invoiceId,
    reference: "REF-BROWSER-CR",
    reason: "Synthetic credit",
    lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
  });
  const before = await stockFactsDashboard(page);
  await page.reload();
  await nav(page, "Billing");
  const row = page.getByRole("row").filter({ hasText: invoice.number });
  await row
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Request credited cash refund",
    exact: true,
  });
  await dialog
    .getByLabel("Unique refund reference", { exact: true })
    .fill("REF-BROWSER-REQUEST");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic credited cash request");
  let lost = false;
  const keys: string[] = [];
  await page.route("**/api/commands/billing.refund.request", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  let refunds = await (await page.request.get("/api/billing/refunds")).json();
  expect(refunds.filter((r: any) => r.invoice_id === invoiceId)).toHaveLength(
    1,
  );
  await row
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Request credited cash refund",
    exact: true,
  });
  await dialog
    .getByLabel("Unique refund reference", { exact: true })
    .fill("REF-BROWSER-OVER");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic excess check");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Refund exceeds");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const refundRow = page
    .getByRole("row")
    .filter({ hasText: "REF-BROWSER-REQUEST" });
  await refundRow
    .getByRole("button", { name: "Verify manual refund", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Verify bank refund",
    exact: true,
  });
  await dialog
    .getByLabel("Bank refund reference", { exact: true })
    .fill("REF-BROWSER-BANK");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic verified bank repayment");
  let bankLost = false;
  const bankKeys: string[] = [];
  await page.route("**/api/commands/billing.refund.manual", async (route) => {
    bankKeys.push(route.request().headers()["idempotency-key"]!);
    if (!bankLost) {
      bankLost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(bankKeys).toHaveLength(2);
  expect(bankKeys[0]).toBe(bankKeys[1]);
  await expect(refundRow).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(
    page.getByRole("row").filter({ hasText: "REF-BROWSER-REQUEST" }),
  ).toContainText("completed");
  refunds = await (await page.request.get("/api/billing/refunds")).json();
  expect(refunds.find((r: any) => r.invoice_id === invoiceId).state).toBe(
    "completed",
  );
  const after = await stockFactsDashboard(page);
  const final = after.invoices.find((i: any) => i.id === invoiceId);
  expect(final.paid).toBe(11300);
  expect(final.credited).toBe(11300);
  expect(final.refunded).toBe(11300);
  expect(final.balance).toBe(0);
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.shipments).toEqual(before.shipments);
  expect(errors).toEqual([]);
});

test("browser: accounting invoice, cash and credit queues retry lost responses and reconcile uncertain sends without changing native facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const account = await cmd("account.create", {
    name: "Accounting browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "QBO-BROWSER",
    name: "Accounting browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await stockFactsDashboard(page),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const received = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: received.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "QBO-BROWSER-DEL",
    quantity: 2,
    serials: ["QBO-BROWSER-UNIT", "QBO-BROWSER-UNIT-2"],
    bin: "QBO",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const pick of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const picked = await stockFactsDashboard(page);
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic accounting counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic accounting handover",
  });
  const payment = await cmd("billing.payment.manual", {
    invoiceId: shipped.invoiceId,
    amount: 11300,
    reference: "QBO-BROWSER-CASH",
    reason: "Synthetic verified bank receipt",
  });
  const before = await stockFactsDashboard(page),
    invoice = before.invoices.find((i: any) => i.id === shipped.invoiceId);
  await page.reload();
  await nav(page, "Billing");
  const invoiceRow = page
    .getByRole("row")
    .filter({ has: page.locator("strong", { hasText: invoice.number }) });
  const cashRow = page.getByRole("row").filter({ hasText: "QBO-BROWSER-CASH" });
  await expect(cashRow).toContainText("Reconcile QuickBooks invoice first");
  await invoiceRow
    .getByRole("button", { name: "Queue QuickBooks invoice", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks invoice",
    exact: true,
  });
  await dialog
    .getByLabel("QuickBooks customer ID", { exact: true })
    .fill("customer-1");
  await dialog
    .getByLabel("QuickBooks item ID · Accounting browser equipment", {
      exact: true,
    })
    .fill("item-1");
  await dialog
    .getByLabel("QuickBooks tax code ID", { exact: true })
    .fill("tax-1");
  await dialog
    .getByLabel("QuickBooks tax rate ID", { exact: true })
    .fill("rate-1");
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("RESIDENCY_BLOCKED");
  await cmd("account.residency", {
    accountId: account.id,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic named QuickBooks exception",
    acceptance: await recordedProviderAcceptance(page, ["quickbooks"]),
  });
  const invoiceKeys: string[] = [];
  let lostInvoice = false;
  await page.route("**/api/commands/quickbooks.invoice", async (route) => {
    invoiceKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostInvoice) {
      lostInvoice = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue invoice", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(invoiceKeys).toHaveLength(2);
  expect(invoiceKeys[0]).toBe(invoiceKeys[1]);
  const effects = () => page.request.get("/api/effects").then((r) => r.json());
  let rows = await effects();
  const invoiceEffect = rows.find(
    (e: any) =>
      e.provider === "quickbooks" &&
      e.kind === "invoice" &&
      e.reference === invoice.id,
  );
  expect(rows.filter((e: any) => e.id === invoiceEffect.id)).toHaveLength(1);
  await expect(
    cashRow.getByRole("button", { name: "Queue QuickBooks payment" }),
  ).toHaveCount(0);
  const operation = (kind: string) =>
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: `quickbooks · ${kind}`,
          exact: true,
        }),
      })
      .filter({ hasNotText: "Reserved capacity released" });
  await operation("invoice")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("invoice")).toContainText("unknown");
  await expect(
    operation("invoice").getByRole("button", {
      name: "Send to provider",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("invoice")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("invoice")).toContainText("completed");
  await cashRow
    .getByRole("button", { name: "Queue QuickBooks payment", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks payment",
    exact: true,
  });
  await expect(dialog).toContainText("without charging the customer");
  await expect(dialog.getByLabel("Apply to invoice (cents)")).toHaveValue("0");
  await dialog.getByLabel("Apply to invoice (cents)").fill("11300");
  await dialog.getByLabel("QuickBooks deposit account ID").fill("bank-1");
  const paymentKeys: string[] = [];
  let lostPayment = false;
  await page.route("**/api/commands/quickbooks.payment", async (route) => {
    paymentKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostPayment) {
      lostPayment = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue payment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue payment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(paymentKeys).toHaveLength(2);
  expect(paymentKeys[0]).toBe(paymentKeys[1]);
  rows = await effects();
  expect(
    rows.filter((e: any) => e.kind === "payment" && e.reference === payment.id),
  ).toHaveLength(1);
  await operation("payment")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("payment")).toContainText("unknown");
  await operation("payment")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("payment")).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(cashRow).toContainText("completed");
  await expect(
    cashRow.getByRole("button", {
      name: "Queue QuickBooks payment",
      exact: true,
    }),
  ).toHaveCount(0);
  const after = await stockFactsDashboard(page);
  expect(after.stock).toEqual(before.stock);
  expect(after.orders).toEqual(before.orders);
  expect(after.invoices).toEqual(before.invoices);
  const lines = invoice.lines;
  const credit = await cmd("billing.credit", {
    invoiceId: invoice.id,
    reference: "QBO-BROWSER-CREDIT",
    reason: "Synthetic accounting credit",
    lines: [{ lineId: lines[0].id, quantity: 1 }],
  });
  const creditedBefore = await stockFactsDashboard(page);
  const creditFacts = await (await page.request.get("/api/credits")).json();
  await page.reload();
  await nav(page, "Billing");
  const creditRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: credit.number, exact: true }),
  });
  await creditRow
    .getByRole("button", { name: "Queue QuickBooks credit", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks credit",
    exact: true,
  });
  await expect(dialog).toContainText("credit stays unapplied");
  const creditKeys: string[] = [];
  let lostCredit = false;
  await page.route("**/api/commands/quickbooks.credit", async (route) => {
    creditKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostCredit) {
      lostCredit = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue credit", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue credit", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(creditKeys).toHaveLength(2);
  expect(creditKeys[0]).toBe(creditKeys[1]);
  expect(
    (await effects()).filter(
      (e: any) => e.kind === "credit" && e.reference === credit.id,
    ),
  ).toHaveLength(1);
  await operation("credit")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("credit")).toContainText("unknown");
  await expect(
    operation("credit").getByRole("button", {
      name: "Send to provider",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("credit")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("credit")).toContainText("completed");
  await page.reload();
  await nav(page, "Billing");
  await expect(creditRow).toContainText("completed");
  await expect(
    creditRow.getByRole("button", {
      name: "Queue QuickBooks credit",
      exact: true,
    }),
  ).toHaveCount(0);
  const review = operation("invoice").getByRole("region", {
    name: "QuickBooks balance review",
  });
  await expect(review).toContainText(
    "No QuickBooks balance comparison recorded.",
  );
  const balanceKeys: string[] = [];
  let lostBalance = false;
  await page.route(
    `**/api/effects/${invoiceEffect.id}/balance`,
    async (route) => {
      balanceKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostBalance) {
        lostBalance = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await review
    .getByRole("button", { name: "Check QuickBooks balance", exact: true })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  await page.reload();
  await nav(page, "Billing");
  await expect(review).toContainText("Balance difference");
  await review
    .getByRole("button", { name: "Check QuickBooks balance", exact: true })
    .click();
  await expect(review.getByRole("alert")).toHaveCount(0);
  expect(balanceKeys).toHaveLength(2);
  expect(balanceKeys[0]).toBe(balanceKeys[1]);
  await review
    .getByRole("button", { name: "View balance history", exact: true })
    .click();
  const balanceHistory = review.getByLabel("Balance history", { exact: true });
  await expect(balanceHistory.getByRole("listitem")).toHaveCount(1);
  await expect(balanceHistory).toContainText(
    "QuickBooks CA$113.00, Distributor CA$0.00; difference CA$113.00",
  );
  await review
    .getByRole("button", { name: "Check QuickBooks balance", exact: true })
    .click();
  await expect(balanceHistory.getByRole("listitem")).toHaveCount(2);
  expect(balanceKeys[2]).not.toBe(balanceKeys[0]);
  await page.reload();
  await nav(page, "Billing");
  await expect(review).toContainText("Balance difference");
  expect(
    (
      await page.request
        .get(`/api/effects/${invoiceEffect.id}/balance-history?limit=20`)
        .then((r) => r.json())
    ).items,
  ).toHaveLength(2);
  const balanceCsrf = (
    await page.request.get("/api/session").then((r) => r.json())
  ).csrf;
  for (let i = 0; i < 19; i++) {
    const response = await page.request.post(
      `/api/effects/${invoiceEffect.id}/balance`,
      {
        headers: {
          origin: "http://127.0.0.1:3117",
          "x-csrf-token": balanceCsrf,
          "idempotency-key": crypto.randomUUID(),
        },
      },
    );
    expect(response.status()).toBe(200);
  }
  await review
    .getByRole("button", { name: "View balance history", exact: true })
    .click();
  await expect(balanceHistory.getByRole("listitem")).toHaveCount(20);
  let lostBalancePage = false;
  await page.route(
    `**/api/effects/${invoiceEffect.id}/balance-history?limit=20&after=*`,
    async (route) => {
      if (!lostBalancePage) {
        lostBalancePage = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await balanceHistory
    .getByRole("button", { name: "Load more balance checks" })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  await expect(balanceHistory.getByRole("listitem")).toHaveCount(20);
  await balanceHistory
    .getByRole("button", { name: "Load more balance checks" })
    .click();
  await expect(balanceHistory.getByRole("listitem")).toHaveCount(21);
  await expect(
    balanceHistory.getByRole("button", { name: "Load more balance checks" }),
  ).toHaveCount(0);
  await creditRow
    .getByRole("button", { name: "Apply QuickBooks credit", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Apply QuickBooks credit",
    exact: true,
  });
  await expect(dialog).toContainText("without repaying or charging cash");
  await expect(dialog.getByLabel("Credit application (cents)")).toHaveValue(
    "0",
  );
  await dialog.getByLabel("Credit application (cents)").fill("11300");
  const applicationKeys: string[] = [];
  let lostApplication = false;
  await page.route("**/api/commands/quickbooks.credit.apply", async (route) => {
    applicationKeys.push(route.request().headers()["idempotency-key"]!);
    if (!lostApplication) {
      lostApplication = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue application", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue application", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(applicationKeys).toHaveLength(2);
  expect(applicationKeys[0]).toBe(applicationKeys[1]);
  expect(
    (await effects()).filter((e: any) => e.kind === "credit-application"),
  ).toHaveLength(1);
  await expect(creditRow).toContainText("Reserved CA$113.00");
  await expect(
    creditRow.getByRole("button", {
      name: "Apply QuickBooks credit",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("credit-application")
    .getByRole("button", {
      name: "Cancel unsent credit application",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Cancel unsent credit application",
    exact: true,
  });
  await expect(dialog).toContainText("CA$113.00");
  await expect(dialog).toContainText(invoice.number);
  await expect(dialog).toContainText(
    "native credit, invoice and cash remain unchanged",
  );
  const cancellationReason = "Correct browser credit before sending";
  await dialog
    .getByLabel("Cancellation reason", { exact: true })
    .fill(cancellationReason);
  const cancellationKeys: string[] = [];
  let lostCancellation = false;
  await page.route(
    "**/api/commands/quickbooks.credit.cancel",
    async (route) => {
      cancellationKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostCancellation) {
        lostCancellation = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await dialog
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(cancellationKeys).toHaveLength(2);
  expect(cancellationKeys[0]).toBe(cancellationKeys[1]);
  const canceledRows = (await effects()).filter(
    (e: any) => e.accountingApplication?.cancellation,
  );
  expect(canceledRows).toHaveLength(1);
  expect(canceledRows[0].state).toBe("blocked");
  expect(canceledRows[0].accountingApplication.cancellation.amount).toBe(11300);
  expect(canceledRows[0].accountingApplication.cancellation.reason).toBe(
    cancellationReason,
  );
  const canceledRow = page
    .getByRole("row")
    .filter({ hasText: cancellationReason });
  await expect(canceledRow).toContainText("canceled");
  await expect(canceledRow).toContainText("Reserved capacity released");
  await expect(
    canceledRow.getByRole("button", { name: "Send to provider", exact: true }),
  ).toHaveCount(0);
  await expect(creditRow).toContainText("Reserved CA$0.00");
  await page.reload();
  await nav(page, "Billing");
  await expect(canceledRow).toContainText(cancellationReason);
  await creditRow
    .getByRole("button", { name: "Apply QuickBooks credit", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Apply QuickBooks credit",
    exact: true,
  });
  await dialog.getByLabel("Credit application (cents)").fill("11300");
  await dialog
    .getByRole("button", { name: "Queue application", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await effects()).filter((e: any) => e.kind === "credit-application"),
  ).toHaveLength(2);
  await expect(creditRow).toContainText("Reserved CA$113.00");
  await operation("credit-application")
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(operation("credit-application")).toContainText("unknown");
  await expect(
    operation("credit-application").getByRole("button", {
      name: "Cancel unsent credit application",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    operation("credit-application").getByRole("button", {
      name: "Send to provider",
      exact: true,
    }),
  ).toHaveCount(0);
  await operation("credit-application")
    .getByRole("button", { name: "Check provider outcome", exact: true })
    .click();
  await expect(operation("credit-application")).toContainText("completed");
  await expect(
    operation("credit-application").getByRole("button", {
      name: "Cancel unsent credit application",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await nav(page, "Billing");
  await expect(operation("credit-application")).toContainText("completed");
  await review
    .getByRole("button", { name: "Check QuickBooks balance", exact: true })
    .click();
  await expect(review).toContainText("Balances agree");
  await expect(
    creditRow.getByRole("button", {
      name: "Apply QuickBooks credit",
      exact: true,
    }),
  ).toHaveCount(0);
  const creditedAfter = await stockFactsDashboard(page);
  expect(creditedAfter.stock).toEqual(creditedBefore.stock);
  expect(creditedAfter.orders).toEqual(creditedBefore.orders);
  expect(creditedAfter.invoices).toEqual(creditedBefore.invoices);
  expect(await (await page.request.get("/api/credits")).json()).toEqual(
    creditFacts,
  );
  expect(errors).toEqual([]);
});

test("browser: authenticator setup retries, required second factor, recovery reuse refusal and all-session removal", async ({
  page,
  browser,
}) => {
  const email = "mfa-browser@example.test",
    password = "long-mfa-browser-password",
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date() });
  const enterPassword = async (p: Page) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await enterPassword(page);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  const panel = page.getByRole("region", { name: "Authenticator security" });
  // A response that arrives after its deadline must never display the bundle.
  let staleKey = "",
    staleSecret = "";
  await page.route("**/api/security/mfa/setup", async (route) => {
    staleKey = route.request().postDataJSON().key;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    staleSecret = body.secret;
    await route.fulfill({
      response,
      json: { ...body, expiresAt: Date.now() - 60000 },
    });
  });
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Setup expired");
  await expect(panel.getByLabel("Authenticator setup key")).toHaveCount(0);
  await expect(panel.getByRole("list", { name: "Recovery codes" })).toHaveCount(
    0,
  );
  await expect(
    panel.getByLabel("Current password for authenticator", { exact: true }),
  ).toHaveValue("");
  expect(await panel.textContent()).not.toContain(staleSecret);
  await page.unroute("**/api/security/mfa/setup");
  let lostSetup = false;
  let firstSetup:
    | {
        enrollmentId: string;
        expiresAt: number;
        secret: string;
        recoveryCodes: string[];
      }
    | undefined;
  const keys: string[] = [];
  await page.route("**/api/security/mfa/setup", async (route) => {
    keys.push(route.request().postDataJSON().key);
    if (!lostSetup) {
      lostSetup = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      firstSetup = await response.json();
      await route.abort("failed");
    } else {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      firstSetup = await response.json();
      await route.fulfill({ response });
    }
  });
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Failed to fetch");
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(panel.getByLabel("Authenticator setup key")).toHaveValue(
    firstSetup!.secret,
  );
  let codes = await panel
    .getByRole("list", { name: "Recovery codes" })
    .locator("code")
    .allTextContents();
  expect(codes).toEqual(firstSetup!.recoveryCodes);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe(staleKey);
  // Only the browser clock advances. Server expiry is covered in Node/process tests.
  const expiredSecret = firstSetup!.secret,
    expiredCodes = [...codes];
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel.getByLabel("Authenticator or recovery code").fill("123456");
  await panel.getByLabel("I saved my recovery codes securely").check();
  await page.clock.fastForward(600001);
  await expect(panel.getByRole("alert")).toContainText("Setup expired");
  await expect(panel.getByLabel("Authenticator setup key")).toHaveCount(0);
  await expect(panel.getByRole("list", { name: "Recovery codes" })).toHaveCount(
    0,
  );
  await expect(panel.getByLabel("Authenticator or recovery code")).toHaveCount(
    0,
  );
  await expect(
    panel.getByLabel("Current password for authenticator", { exact: true }),
  ).toHaveValue("");
  for (const value of [expiredSecret, ...expiredCodes])
    expect(await panel.textContent()).not.toContain(value);
  await page.clock.setSystemTime(new Date());
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(panel.getByLabel("Authenticator setup key")).toBeVisible();
  await expect(panel.getByLabel("Authenticator setup key")).not.toHaveValue(
    expiredSecret,
  );
  await expect(panel.getByLabel("Authenticator setup key")).toHaveValue(
    firstSetup!.secret,
  );
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(keys[1]);
  expect(firstSetup!.secret).not.toBe(expiredSecret);
  await expect(
    panel.getByLabel("I saved my recovery codes securely"),
  ).not.toBeChecked();
  codes = await panel
    .getByRole("list", { name: "Recovery codes" })
    .locator("code")
    .allTextContents();
  expect(codes).toEqual(firstSetup!.recoveryCodes);
  await page.unroute("**/api/security/mfa/setup");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const secret of [password, firstSetup!.secret, ...codes])
    expect(stored).not.toContain(secret);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(panel.getByLabel("Authenticator setup key")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel.getByLabel("I saved my recovery codes securely").check();
  await panel.getByLabel("Authenticator or recovery code").fill("invalid");
  await panel
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("MFA_INVALID");
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await panel
    .getByLabel("Authenticator or recovery code")
    .fill(totp(firstSetup!.secret, Math.floor(Date.now() / 30000)));
  let lostConfirm = false;
  await page.route("**/api/security/mfa/confirm", async (route) => {
    lostConfirm = true;
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await panel
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Failed to fetch");
  expect(lostConfirm).toBe(true);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await page.unroute("**/api/security/mfa/confirm");
  // Reload recovers the actual server state after the committed response was lost.
  await enterPassword(page);
  const signInCode = page.getByLabel("Authenticator or recovery code", {
    exact: true,
  });
  await expect(signInCode).toBeVisible();
  expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  await signInCode.fill(codes[0]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  await page.reload();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    second.on("pageerror", (e) => errors.push(e.message));
    await enterPassword(second);
    await second.getByLabel("Authenticator or recovery code").fill(codes[0]!);
    await second.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(second.getByRole("alert")).toContainText("MFA_INVALID");
    expect((await second.request.get("/api/dashboard")).status()).toBe(401);
    await second.getByLabel("Authenticator or recovery code").fill(codes[1]!);
    await second.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      second.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(panel).toContainText("8 unused recovery codes");
    await panel
      .getByLabel("Current password for authenticator", { exact: true })
      .fill(password);
    await panel.getByLabel("Authenticator or recovery code").fill(codes[2]!);
    await panel
      .getByRole("button", { name: "Remove authenticator", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Sign in to your workspace",
        exact: true,
      }),
    ).toBeVisible();
    expect((await second.request.get("/api/session")).status()).toBe(401);
    expect((await page.request.get("/api/session")).status()).toBe(401);
    await enterPassword(page);
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(page, "Security");
    await expect(
      panel.getByRole("button", { name: "Set up authenticator", exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/security")).json()).revision,
    ).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    await secondContext.close();
  }
});

test("browser: stock cost reviews survive lost replies and separate immutable download from receiver acceptance", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Billing");
  const panel = page.getByRole("region", {
    name: "Stock cost accounting handoffs",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Load stock cost review", exact: true })
    .click();
  const source = await (
    await page.request.get("/api/accounting/cost-source")
  ).json();
  expect(source.movements.length).toBeGreaterThan(0);
  const session = await (await page.request.get("/api/session")).json(),
    headers = { origin: "http://127.0.0.1:3117", "x-csrf-token": session.csrf };
  const mappings = source.byType
    .filter((v: any) => v.increase || v.decrease)
    .map((v: any) => ({
      type: v.type,
      offsetAccount: v.type === "receipt" ? "2100" : "5000",
    }));
  const input = {
    version: 1,
    batchRef: "BROWSER-COST",
    afterSequence: source.afterSequence,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings,
    expectedMovements: source.movements.length,
    expectedIncrease: source.increase,
    expectedDecrease: source.decrease,
    expectedOpeningValue: source.openingValue,
    expectedClosingValue: source.closingValue,
    acknowledgment: "Synthetic regional ledger and duplicate-posting evidence",
  };
  // Synthetic UI fixtures establish interaction only; these totals are not human financial approval.
  const form = panel.getByRole("form", { name: "Prepare stock cost handoff" });
  await form
    .getByLabel("Cost batch reference", { exact: true })
    .fill(input.batchRef);
  await form
    .getByLabel("Inventory account code", { exact: true })
    .fill(input.inventoryAccount);
  await form
    .getByLabel("Offset account mappings (JSON)", { exact: true })
    .fill(JSON.stringify(mappings));
  for (const [label, value] of [
    ["Independent movement count", input.expectedMovements],
    ["Independent cost increase (cents)", input.expectedIncrease],
    ["Independent cost decrease (cents)", input.expectedDecrease],
    ["Independent opening stock value (cents)", input.expectedOpeningValue],
    ["Independent closing stock value (cents)", input.expectedClosingValue],
  ] as const)
    await form.getByLabel(label, { exact: true }).fill(String(value));
  await form
    .getByLabel("Regional receiver and duplicate-posting review evidence", {
      exact: true,
    })
    .fill(input.acknowledgment);
  const keys: string[] = [];
  let lost = false;
  await page.route("**/api/commands/accounting.cost.prepare", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await form
    .getByRole("button", { name: "Prepare cost handoff", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await form
    .getByRole("button", { name: "Prepare cost handoff", exact: true })
    .click();
  const review = panel.getByRole("region", {
    name: "Saved cost review",
    exact: true,
  });
  await expect(
    review.getByRole("heading", {
      name: "Saved cost review: BROWSER-COST",
      exact: true,
    }),
  ).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  expect(
    (
      await (await page.request.get("/api/accounting/costs")).json()
    ).items.filter((p: any) => p.batchRef === "BROWSER-COST"),
  ).toHaveLength(1);
  const before = await stockFactsDashboard(page);
  for (let i = 0; i < 23; i++) {
    const response = await page.request.post(
      "/api/commands/accounting.cost.prepare",
      {
        headers: { ...headers, "idempotency-key": `cost-history-${i}` },
        data: { ...input, batchRef: `BROWSER-HISTORY-${i}` },
      },
    );
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await nav(page, "Billing");
  await panel
    .getByRole("button", { name: "Load stock cost review", exact: true })
    .click();
  const history = panel.getByRole("table", {
    name: "Saved stock cost handoffs",
    exact: true,
  });
  await expect(history.locator("tbody tr")).toHaveCount(20);
  let lostHistory = false;
  await page.route(
    "**/api/accounting/costs?limit=20&before=*",
    async (route) => {
      if (!lostHistory) {
        lostHistory = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await panel
    .getByRole("button", { name: "Load older cost handoffs", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(history.locator("tbody tr")).toHaveCount(20);
  await panel
    .getByRole("button", { name: "Load older cost handoffs", exact: true })
    .click();
  await expect(history.locator("tbody tr")).toHaveCount(24);
  await panel
    .getByRole("button", { name: "Review BROWSER-COST", exact: true })
    .click();
  const decision = review.getByRole("form", {
    name: "Decide stock cost handoff",
  });
  await decision
    .getByLabel("Cost review decision", { exact: true })
    .selectOption("approve");
  await decision
    .getByLabel("Cost decision reason", { exact: true })
    .fill("Synthetic frozen cutoff review");
  await decision
    .getByRole("button", { name: "Record cost decision", exact: true })
    .click();
  await expect(
    review.getByRole("heading", {
      name: "Saved cost review: BROWSER-COST",
      exact: true,
    }),
  ).toBeVisible();
  const packet = (
    await (await page.request.get("/api/accounting/costs")).json()
  ).items;
  const saved = await (
    await page.request.get(
      `/api/accounting/costs/${(await (await page.request.get("/api/accounting/costs?limit=100")).json()).items.find((p: any) => p.batchRef === "BROWSER-COST").id}`,
    )
  ).json();
  expect(packet).toHaveLength(20);
  expect(saved.state).toBe("reviewed");
  expect(saved.receipt).toBeNull();
  const downloadEvent = page.waitForEvent("download");
  await review
    .getByRole("button", { name: "Download reviewed cost file", exact: true })
    .click();
  const download = await downloadEvent,
    path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    saved.contentHash,
  );
  expect(JSON.parse(bytes.toString()).report.journal).toEqual(
    saved.report.journal,
  );
  const acceptance = review.getByRole("form", {
    name: "Record stock cost receiver acceptance",
  });
  for (const [label, value] of [
    ["Accepted file SHA-256", saved.contentHash],
    ["Regional ledger receiver reference", "synthetic-ca-ledger"],
    ["External acceptance reference", "BROWSER-IMPORT-1"],
    ["Independent receiver debit total (cents)", String(saved.controls.debit)],
    [
      "Independent receiver credit total (cents)",
      String(saved.controls.credit),
    ],
    [
      "Receiver acceptance evidence",
      "Synthetic receiver verified exact file and totals",
    ],
  ])
    await acceptance.getByLabel(label!, { exact: true }).fill(value!);
  await acceptance
    .getByLabel("Receiver region", { exact: true })
    .selectOption(source.region);
  await acceptance
    .getByRole("button", {
      name: "Record cost receiver acceptance",
      exact: true,
    })
    .click();
  await expect(
    review.getByRole("heading", {
      name: "Saved cost review: BROWSER-COST",
      exact: true,
    }),
  ).toBeVisible();
  await expect(review.getByRole("status")).toContainText(
    "Receiver acceptance recorded:",
  );
  const accepted = await (
    await page.request.get(`/api/accounting/costs/${saved.id}`)
  ).json();
  expect(accepted.state).toBe("accepted");
  const after = await stockFactsDashboard(page);
  for (const key of ["stock", "invoices", "orders", "shipments"])
    expect(after[key]).toEqual(before[key]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    review.getByRole("button", {
      name: "Download reviewed cost file",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  try {
    await buyer.goto("/");
    await buyer
      .getByLabel("Email", { exact: true })
      .fill("refund-buyer@example.test");
    await buyer
      .getByLabel("Password", { exact: true })
      .fill("long-notice-test-password");
    await buyer.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      buyer.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(buyer, "Billing");
    await expect(
      buyer.getByRole("region", {
        name: "Stock cost accounting handoffs",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (await buyer.request.get("/api/accounting/cost-source")).status(),
    ).toBe(403);
  } finally {
    await buyerContext.close();
  }
  expect(errors).toEqual([]);
});

test("browser: confirmed cash refunds queue one accounting expense and zero-cash credit link after lost replies without changing native facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const account = await cmd("account.create", {
    name: "Accounting refund browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "QBO-REFUND-BROWSER",
    name: "Accounting refund equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await stockFactsDashboard(page),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const received = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: received.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "QBO-REFUND-BROWSER-DEL",
    quantity: 2,
    serials: [],
    bin: "REFUND",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await stockFactsDashboard(page);
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic accounting refund counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  const shipped = await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic accounting refund handover",
  });
  const invoiceId = shipped.invoiceId;
  const payment = await cmd("billing.payment.manual", {
    invoiceId,
    amount: 22600,
    reference: "QBO-REFUND-BROWSER-CASH",
    reason: "Synthetic verified cash",
  });
  const paid = await stockFactsDashboard(page),
    invoice = paid.invoices.find((i: any) => i.id === invoiceId);
  const credit = await cmd("billing.credit", {
    invoiceId,
    reference: "QBO-REFUND-BROWSER-CREDIT",
    reason: "Synthetic returned equipment credit",
    lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
  });
  await cmd("account.residency", {
    accountId: account.id,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic named QuickBooks processing exception",
    acceptance: await recordedProviderAcceptance(page, ["quickbooks"]),
  });
  const reconcileSetup = async (id: string) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const options = {
      headers: { "x-csrf-token": csrf, origin: "http://127.0.0.1:3117" },
    };
    const sent = await page.request.post(`/api/effects/${id}/execute`, options);
    expect(sent.status(), await sent.text()).toBe(200);
    expect((await sent.json()).state).toBe("unknown");
    const read = await page.request.post(
      `/api/effects/${id}/reconcile`,
      options,
    );
    expect(read.status(), await read.text()).toBe(200);
    expect((await read.json()).state).toBe("completed");
  };
  await reconcileSetup(
    (
      await cmd("quickbooks.invoice", {
        invoiceId,
        customerRef: "customer-1",
        itemRefs: { [product.id]: "item-1" },
        taxCodeRef: "tax-1",
        taxRateRef: "rate-1",
      })
    ).id,
  );
  await reconcileSetup(
    (
      await cmd("quickbooks.payment", {
        paymentId: payment.id,
        appliedAmount: 22600,
        depositAccountRef: "bank-1",
      })
    ).id,
  );
  await reconcileSetup(
    (await cmd("quickbooks.credit", { creditId: credit.id })).id,
  );
  const refund = await cmd("billing.refund.request", {
    invoiceId,
    paymentId: payment.id,
    amount: 5000,
    reference: "QBO-REFUND-BROWSER-REQUEST",
    reason: "Synthetic credited cash refund",
  });
  await cmd("billing.refund.manual", {
    refundId: refund.id,
    reference: "QBO-REFUND-BROWSER-BANK",
    reason: "Synthetic completed bank refund",
  });
  const nativeFacts = async () => {
    const dashboard = await stockFactsDashboard(page);
    return {
      stock: dashboard.stock,
      orders: dashboard.orders,
      shipments: dashboard.shipments,
      invoices: dashboard.invoices,
      credits: await (await page.request.get("/api/credits")).json(),
      payments: await (await page.request.get("/api/billing/payments")).json(),
      refunds: await (await page.request.get("/api/billing/refunds")).json(),
    };
  };
  const before = await nativeFacts();
  await page.reload();
  await nav(page, "Billing");
  await page.setViewportSize({ width: 390, height: 844 });
  const refundRow = page.getByRole("row").filter({
    has: page.getByRole("cell", {
      name: "QBO-REFUND-BROWSER-REQUEST",
      exact: true,
    }),
  });
  await refundRow
    .getByRole("button", {
      name: "Queue QuickBooks refund expense",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks refund expense",
    exact: true,
  });
  await expect(dialog).toContainText("already returned to the customer");
  await expect(
    dialog.getByLabel("Original QuickBooks credit", { exact: true }),
  ).toHaveValue(credit.id);
  await dialog
    .getByLabel("QuickBooks refund bank account ID", { exact: true })
    .fill("bank-1");
  await dialog
    .getByLabel("QuickBooks accounts receivable ID", { exact: true })
    .fill("ar-1");
  await dialog
    .getByLabel("QuickBooks non-tax expense code ID", { exact: true })
    .fill("NON");
  await dialog
    .getByLabel("Refund accounting date", { exact: true })
    .fill("2026-10-01");
  const expenseKeys: string[] = [],
    linkKeys: string[] = [];
  const loseFirstReply = async (name: string, keys: string[]) => {
    let lost = false;
    await page.route(`**/api/commands/${name}`, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
  };
  await loseFirstReply("quickbooks.refund", expenseKeys);
  await dialog
    .getByRole("button", { name: "Queue refund expense", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue refund expense", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(expenseKeys).toHaveLength(2);
  expect(expenseKeys[0]).toBe(expenseKeys[1]);
  const effects = async () => (await page.request.get("/api/effects")).json();
  let rows = await effects();
  expect(
    rows.filter(
      (e: any) => e.kind === "refund-expense" && e.reference === refund.id,
    ),
  ).toHaveLength(1);
  const operation = (kind: string) =>
    page.getByRole("row").filter({
      has: page.getByRole("cell", {
        name: `quickbooks · ${kind}`,
        exact: true,
      }),
    });
  const reconcileScreen = async (kind: string) => {
    await operation(kind)
      .getByRole("button", { name: "Send to provider", exact: true })
      .click();
    await expect(operation(kind)).toContainText("unknown");
    await expect(
      operation(kind).getByRole("button", {
        name: "Send to provider",
        exact: true,
      }),
    ).toHaveCount(0);
    await operation(kind)
      .getByRole("button", { name: "Check provider outcome", exact: true })
      .click();
    await expect(operation(kind)).toContainText("completed");
  };
  await reconcileScreen("refund-expense");
  await expect(
    refundRow.getByRole("button", {
      name: "Link refund expense to credit",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await nav(page, "Billing");
  await refundRow
    .getByRole("button", { name: "Link refund expense to credit", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Link refund expense to credit",
    exact: true,
  });
  await expect(dialog).toContainText("zero-cash accounting payment");
  await loseFirstReply("quickbooks.refund.apply", linkKeys);
  await dialog
    .getByRole("button", { name: "Queue refund link", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue refund link", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(linkKeys).toHaveLength(2);
  expect(linkKeys[0]).toBe(linkKeys[1]);
  rows = await effects();
  expect(
    rows.filter(
      (e: any) => e.kind === "refund-application" && e.reference === refund.id,
    ),
  ).toHaveLength(1);
  await reconcileScreen("refund-application");
  await page.reload();
  await nav(page, "Billing");
  await expect(refundRow).toContainText("QuickBooks refund link: completed");
  await expect(operation("refund-expense")).toContainText(
    "Confirmed cash already returned",
  );
  expect(await nativeFacts()).toEqual(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: serial loss review and recovery retain history, retry once and restore original held stock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  let counter = 0;
  const cmd = async (name: string, data: any) => {
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": session.csrf,
        "idempotency-key": `custody-ui-${counter++}`,
      },
      data,
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const snapshot = async () => stockFactsDashboard(page);
  const warehouseId = (await snapshot()).warehouses.find(
    (w: any) => w.name === "Toronto",
  ).id;
  const productId = (
    await cmd("product.create", {
      sku: "CUSTODY-UI",
      name: "Synthetic custody equipment",
      serialized: true,
      unitPrice: 10000,
      taxBasisPoints: 1300,
    })
  ).id;
  const supplierId = (
    await cmd("supplier.create", { name: "Synthetic custody supplier" })
  ).id;
  const poId = (
    await cmd("purchase.create", {
      supplierId,
      warehouseId,
      lines: [{ productId, quantity: 1, unitCost: 6000 }],
    })
  ).id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const lineId = purchases.orders.find((p: any) => p.id === poId).lines[0].id;
  const serial = "CUSTODY-UI-SERIAL-1";
  await cmd("purchase.receive", {
    poId,
    lineId,
    deliveryRef: "CUSTODY-UI-DEL",
    quantity: 1,
    serials: [serial],
    bin: "CUSTODY-BIN",
    quarantine: true,
  });
  const before = await snapshot();
  const unit = before.stock.find((u: any) => u.serial === serial);
  for (let i = 0; i < 24; i++) {
    const r = await cmd("serial.missing.report", {
      unitId: unit.id,
      revision: unit.revision,
      serial,
      reviewRef: `CUSTODY-UI-REJECT-${i}`,
      reason: `Synthetic earlier observation ${i}`,
    });
    await cmd("serial.missing.decide", {
      reviewId: r.id,
      decision: "reject",
      reason: "Synthetic evidence insufficient",
    });
  }
  await page.reload();
  await nav(page, "Inventory");
  await page
    .getByLabel("Search stock serial or bin", { exact: true })
    .fill(serial);
  await page.getByRole("button", { name: "Search stock", exact: true }).click();
  const stockRow = page
    .getByRole("row")
    .filter({ hasText: serial })
    .filter({
      has: page.getByRole("button", {
        name: "Report missing serial",
        exact: true,
      }),
    });
  await stockRow
    .getByRole("button", { name: "Report missing serial", exact: true })
    .click();
  await page
    .getByLabel("Expected serial on stock record", { exact: true })
    .fill(serial);
  await page
    .getByLabel("Custody review reference (unique)", { exact: true })
    .fill("CUSTODY-UI-MISSING");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic searched original shelf and neighboring bins");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const observed = await snapshot();
  expect(observed.stock.find((u: any) => u.id === unit.id).quantity).toBe(1);
  expect(observed.invoices).toEqual(before.invoices);
  const panel = page.getByRole("region", {
    name: "Serial custody reviews",
    exact: true,
  });
  await expect(panel.getByRole("status")).toHaveText("20 reviews loaded");
  let lostPage = false;
  await page.route("**/api/stock/serial-reviews?after=*", async (route) => {
    if (!lostPage) {
      lostPage = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load more custody reviews", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  await panel
    .getByRole("button", { name: "Retry custody reviews", exact: true })
    .click();
  await expect(panel.locator("tbody tr")).toHaveCount(25);
  const reviewRow = panel
    .getByRole("row")
    .filter({ hasText: "CUSTODY-UI-MISSING" });
  await reviewRow
    .getByRole("button", { name: "Approve serial loss", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("original stock value");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic administrator checked custody evidence");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const missing = (await snapshot()).stock.find((u: any) => u.id === unit.id);
  expect([missing.quantity, missing.cost, missing.condition]).toEqual([
    0,
    6000,
    "quarantine",
  ]);
  await panel
    .getByRole("button", { name: "Load more custody reviews", exact: true })
    .click();
  await expect(reviewRow).toContainText("approved");
  await reviewRow
    .getByRole("button", { name: "Recover serial", exact: true })
    .click();
  await page.getByLabel("Scan recovered serial", { exact: true }).fill(serial);
  await page
    .getByLabel("Recovery receipt reference (unique)", { exact: true })
    .fill("CUSTODY-UI-FOUND");
  await page
    .getByLabel("Recovered stock bin", { exact: true })
    .fill("CUSTODY-FOUND-BIN");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic scanned matching serial found on another shelf");
  const keys: string[] = [];
  let lostRecovery = false;
  await page.route("**/api/commands/serial.missing.recover", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lostRecovery) {
      lostRecovery = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await panel
    .getByRole("button", { name: "Load more custody reviews", exact: true })
    .click();
  await expect(reviewRow).toContainText("recovered");
  await expect(reviewRow).toContainText("CUSTODY-UI-FOUND");
  const after = await snapshot(),
    recovered = after.stock.find((u: any) => u.id === unit.id);
  expect([
    recovered.serial,
    recovered.quantity,
    recovered.cost,
    recovered.condition,
    recovered.bin,
    recovered.available,
  ]).toEqual([serial, 1, 6000, "quarantine", "CUSTODY-FOUND-BIN", 0]);
  expect(after.invoices).toEqual(before.invoices);
  expect(after.orders).toEqual(before.orders);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Search stock serial or bin", { exact: true })
    .fill(serial);
  await page.getByRole("button", { name: "Search stock", exact: true }).click();
  await stockRow.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: short picks retry once, retain paged history after failure, and invoice only actual handover", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  let counter = 0;
  const cmd = async (name: string, data: any) => {
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": session.csrf,
        "idempotency-key": `short-ui-${counter++}`,
      },
      data,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const snapshot = async () => stockFactsDashboard(page);
  const before = await snapshot(),
    warehouseId = before.warehouses.find((w: any) => w.name === "Toronto").id;
  const productId = (
    await cmd("product.create", {
      sku: "SHORT-UI",
      name: "Synthetic short-pick supplies",
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    })
  ).id;
  const accountId = (
    await cmd("account.create", {
      name: "Synthetic short-pick buyer",
      tier: "standard",
      creditLimit: 1000000,
    })
  ).id;
  const supplierId = (
    await cmd("supplier.create", { name: "Synthetic short-pick supplier" })
  ).id;
  const poId = (
    await cmd("purchase.create", {
      supplierId,
      warehouseId,
      lines: [{ productId, quantity: 25, unitCost: 1000 }],
    })
  ).id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const lineId = purchases.orders.find((p: any) => p.id === poId).lines[0].id;
  await cmd("purchase.receive", {
    poId,
    lineId,
    deliveryRef: "SHORT-UI-DEL",
    quantity: 25,
    serials: [],
    bin: "SHORT-BIN",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId,
    warehouseId,
    revision: 0,
    lines: [{ productId, quantity: 25 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const orderId = (
    await cmd("order.accept", { quoteId: quote.id, allowBackorder: false })
  ).id;
  const picks = async () =>
    (await page.request.get(`/api/orders/${orderId}/picks`)).json();
  const allocation = (await picks())[0];
  await cmd("fulfillment.pick", {
    orderId,
    allocationId: allocation.id,
    serial: null,
  });
  await cmd("fulfillment.pack", {
    orderId,
    revision: 1,
    mode: "collection",
    address: "Short-pick actual collection",
    lines: [{ allocationId: allocation.id, quantity: 1 }],
  });
  await page.reload();
  await nav(page, "Orders");
  const orderRow = page
    .getByRole("row")
    .filter({ hasText: "Synthetic short-pick buyer" })
    .filter({ hasText: orderId.slice(0, 8) });
  await orderRow
    .getByRole("button", { name: "Report short pick", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("become backordered");
  await page.getByLabel("Unavailable units", { exact: true }).fill("2");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic shelf shortage reviewed separately");
  const keys: string[] = [];
  let lost = false;
  await page.route("**/api/commands/fulfillment.short-pick", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await next(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const initialReports = await (
    await page.request.get(`/api/orders/${orderId}/short-picks`)
  ).json();
  expect(initialReports.items).toHaveLength(1);
  await expect(orderRow).toContainText(
    "25 ordered / 23 reserved / 0 shipped / 0 canceled",
  );
  const after = await snapshot(),
    stock = after.stock.filter((u: any) => u.product_id === productId);
  expect(
    stock.reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(25000);
  expect(stock.find((u: any) => u.condition === "quarantine").quantity).toBe(2);
  expect(
    after.invoices.filter((i: any) => i.order_id === orderId),
  ).toHaveLength(0);
  for (let i = 0; i < 22; i++) {
    const current = (await snapshot()).orders.find(
        (o: any) => o.id === orderId,
      ),
      a = (await picks())[0];
    await cmd("fulfillment.short-pick", {
      orderId,
      revision: current.revision,
      allocationId: a.id,
      unitRevision: a.unitRevision,
      quantity: 1,
      reason: `Synthetic remaining shortage ${i}`,
    });
  }
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await orderRow
    .getByRole("button", { name: "View short picks", exact: true })
    .click();
  const history = page.getByRole("dialog");
  await expect(history).toContainText("20 reports loaded.");
  let lostPage = false;
  await page.route(
    `**/api/orders/${orderId}/short-picks?after=*`,
    async (route) => {
      if (!lostPage) {
        lostPage = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await history
    .getByRole("button", { name: "Load more reports", exact: true })
    .click();
  await expect(history.getByRole("alert")).toBeVisible();
  await expect(history).toContainText("20 reports loaded.");
  await history
    .getByRole("button", { name: "Load more reports", exact: true })
    .click();
  await expect(history).toContainText("23 reports loaded.");
  const description = await history.locator(".description").innerText();
  expect(
    description.split("\n").filter((l) => l.includes("held stock")),
  ).toHaveLength(23);
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Short-pick actual collection" })
    .getByRole("button", { name: "Confirm collection", exact: true })
    .click();
  await page
    .getByLabel("Handover evidence", { exact: true })
    .fill("Synthetic single verified unit collected");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await orderRow
    .getByRole("button", { name: "Cancel units", exact: true })
    .click();
  await page.getByLabel("Units", { exact: true }).fill("24");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic customer cancels backorder");
  await next(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(orderRow).toContainText(
    "25 ordered / 0 reserved / 1 shipped / 24 canceled",
  );
  const final = await snapshot();
  expect(
    final.invoices
      .filter((i: any) => i.order_id === orderId)
      .map((i: any) => i.total),
  ).toEqual([2825]);
  expect(
    final.stock
      .filter((u: any) => u.product_id === productId)
      .reduce((sum: number, u: any) => sum + u.quantity * u.cost, 0),
  ).toBe(24000);
  await page.setViewportSize({ width: 390, height: 844 });
  await orderRow
    .getByRole("button", { name: "View short picks", exact: true })
    .click();
  await expect(history).toContainText("20 reports loaded.");
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: claim evidence retries across reload, verifies downloads and keeps staff files private", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Evidence browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "EVD-BROWSER",
    name: "Evidence browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 1, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "EVD-DELIVERY",
    quantity: 1,
    serials: ["EVD-SERIAL"],
    bin: "EVD",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "EVD-SERIAL").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "evidence-issue",
  });

  const before = await dashboard();
  const nativeFacts = (d: any) => ({
    stock: d.stock,
    orders: d.orders,
    shipments: d.shipments,
    invoices: d.invoices,
    claims: d.claims,
  });
  const path = `/api/warranty/claims/${claim.id}/evidence`;
  const keys: string[] = [];
  let lost = false;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  const open = async () => {
    await page.reload();
    await nav(page, "Returns");
    await page
      .getByRole("row")
      .filter({ hasText: claim.id.slice(0, 8) })
      .filter({
        has: page.getByRole("button", { name: "Evidence files", exact: true }),
      })
      .getByRole("button", { name: "Evidence files", exact: true })
      .click();
  };
  const panel = page.getByRole("region", {
    name: "Claim evidence files",
    exact: true,
  });
  const bytes = Buffer.from("Synthetic browser photo description\n");
  const attach = async () => {
    await panel.getByLabel("Evidence file", { exact: true }).setInputFiles({
      name: "inspection.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await panel
      .getByLabel("Evidence description", { exact: true })
      .fill("Private inspection");
    await panel
      .getByRole("button", { name: "Attach evidence", exact: true })
      .click();
  };
  await open();
  await expect(panel.getByRole("heading")).toBeFocused();
  await attach();
  await expect(panel.getByRole("alert")).toBeVisible();
  expect((await (await page.request.get(path)).json()).items).toHaveLength(1);
  await open();
  await attach();
  await expect(panel).toContainText("Attached inspection.txt");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const first = (await (await page.request.get(path)).json()).items[0];
  expect(first.contentHash).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("distributor-evidence-upload:"),
      ),
    ),
  ).toEqual([]);
  const csrf = (await (await page.request.get("/api/session")).json()).csrf;
  for (let i = 0; i < 11; i++) {
    const response = await page.request.post(path, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": csrf,
        "idempotency-key": `evidence-page-${i}`,
      },
      data: {
        filename: `customer-${i}.txt`,
        mediaType: "text/plain",
        audience: "customer",
        description: `Customer inspection ${i}`,
        contentBase64: Buffer.from(`Customer evidence ${i}`).toString("base64"),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
  await panel
    .getByRole("button", { name: "Refresh evidence files", exact: true })
    .click();
  await expect(panel).toContainText("10 files loaded");
  let failedPage = false;
  await page.route(`**${path}?after=*`, async (route) => {
    if (!failedPage) {
      failedPage = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load more evidence files", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel).toContainText("10 files loaded");
  await panel
    .getByRole("button", { name: "Retry evidence files", exact: true })
    .click();
  await expect(panel).toContainText("12 files loaded");
  expect(
    await panel
      .getByRole("button", { name: "Download evidence", exact: true })
      .count(),
  ).toBe(12);
  let corrupt = true;
  const downloadKeys: string[] = [];
  await page.route(`**${path}/${first.id}/download`, async (route) => {
    downloadKeys.push(route.request().headers()["idempotency-key"]!);
    if (corrupt) {
      corrupt = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({
        response,
        body: Buffer.from("corrupted response bytes"),
      });
    } else await route.continue();
  });
  const fileRow = panel.getByRole("row").filter({ hasText: "inspection.txt" });
  let downloaded = 0;
  page.on("download", () => downloaded++);
  await fileRow
    .getByRole("button", { name: "Download evidence", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "integrity check failed",
  );
  expect(downloaded).toBe(0);
  const event = page.waitForEvent("download");
  await fileRow
    .getByRole("button", { name: "Download evidence", exact: true })
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toBe(
    `warranty-evidence-${first.id}.txt`,
  );
  expect(await readFile((await download.path())!)).toEqual(bytes);
  expect(downloadKeys).toHaveLength(2);
  expect(downloadKeys[0]).toBe(downloadKeys[1]);
  await expect(panel).toContainText("Verified inspection.txt");
  expect(nativeFacts(await dashboard())).toEqual(nativeFacts(before));
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole("button", { name: "Close evidence files", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: claim.id.slice(0, 8) })
      .filter({
        has: page.getByRole("button", { name: "Evidence files", exact: true }),
      })
      .getByRole("button", { name: "Evidence files", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await cmd("user.create", {
    name: "Evidence buyer",
    email: "evidence-buyer@example.test",
    password: "long-evidence-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
    currentPassword: "long-test-only-password",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("evidence-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-evidence-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await nav(page, "Returns");
  await page
    .getByRole("row")
    .filter({ hasText: claim.id.slice(0, 8) })
    .filter({
      has: page.getByRole("button", { name: "Evidence files", exact: true }),
    })
    .getByRole("button", { name: "Evidence files", exact: true })
    .click();
  await expect(panel).toContainText("10 files loaded");
  await expect(
    panel.getByLabel("Evidence visibility", { exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Load more evidence files", exact: true })
    .click();
  await expect(panel).toContainText("11 files loaded");
  await expect(panel).not.toContainText("Private inspection");
  await expect(panel).not.toContainText("inspection.txt");
  const buyerCsrf = (await (await page.request.get("/api/session")).json())
    .csrf;
  const denied = await page.request.post(`${path}/${first.id}/download`, {
    headers: {
      origin: "http://127.0.0.1:3117",
      "x-csrf-token": buyerCsrf,
      "idempotency-key": "buyer-private",
    },
    data: {},
  });
  expect(denied.status()).toBe(404);
  expect(errors).toEqual([]);
});

test("browser: replacement shipping retries, exceptions, paged history and buyer privacy preserve original money", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Shipping browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "RSH-BROWSER",
    name: "Shipping browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 3, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "RSH-DELIVERY",
    quantity: 3,
    serials: ["RSH-OLD", "RSH-NEW", "RSH-SPARE"],
    bin: "REP",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "RSH-OLD").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "mfg-issue",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  await cmd("warranty.receive", {
    claimId: claim.id,
    warehouseId,
    bin: "RSH-Q",
    serial: "RSH-OLD",
  });
  await cmd("warranty.inspect", {
    claimId: claim.id,
    findings: "Synthetic replacement inspection",
  });
  const before = await dashboard();
  const r = await cmd("warranty.replacement.reserve", {
    claimId: claim.id,
    newUnitId: before.stock.find((u: any) => u.serial === "RSH-NEW").id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic shipping authorization",
  });
  const invariant = (d: any) => ({
    orders: d.orders,
    invoices: d.invoices,
    shipments: d.shipments,
  });
  await page.reload();
  await nav(page, "Returns");
  const section = page.getByRole("region", {
    name: "Replacement history",
    exact: true,
  });
  const row = section.getByRole("row").filter({ hasText: "RSH-NEW" });
  const opener = row.getByRole("button", {
    name: "Dispatch replacement",
    exact: true,
  });
  await opener.click();
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("RSH-SPARE");
  await page
    .getByLabel("Delivery recipient", { exact: true })
    .fill("Private shipping recipient");
  await page
    .getByLabel("Delivery address", { exact: true })
    .fill("Private shipping address");
  await page
    .getByLabel("Carrier name", { exact: true })
    .fill("Synthetic carrier");
  await page
    .getByLabel("Carrier tracking reference", { exact: true })
    .fill("RSH-TRACK-1");
  await page
    .getByLabel("Carrier handover evidence", { exact: true })
    .fill("Private carrier receipt");
  await page
    .getByLabel("Delivery address", { exact: true })
    .fill("Private shipping address");
  await page
    .getByLabel("Carrier name", { exact: true })
    .fill("Synthetic shipping carrier");
  await page
    .getByLabel("Carrier tracking reference", { exact: true })
    .fill("RSH-TRACK-1");
  await page
    .getByLabel("Carrier handover evidence", { exact: true })
    .fill("Private carrier handover receipt");
  await page
    .getByRole("button", { name: "Record dispatch", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Scanned replacement serial does not match",
  );
  const dispatchKeys: string[] = [];
  let lostDispatch = false;
  await page.route(
    "**/api/commands/warranty.replacement.dispatch",
    async (route) => {
      dispatchKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostDispatch) {
        lostDispatch = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByLabel("Scan replacement serial", { exact: true })
    .fill("RSH-NEW");
  await page
    .getByRole("button", { name: "Record dispatch", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Record dispatch", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(dispatchKeys).toHaveLength(2);
  expect(dispatchKeys[0]).toBe(dispatchKeys[1]);
  await expect(row).toContainText("Shipping: in_transit · v1");
  await expect(row).toContainText("Private shipping address");
  const observedAt = new Date().toISOString();
  await row
    .getByRole("button", { name: "Record shipping outcome", exact: true })
    .click();
  await page
    .getByLabel("Shipping outcome", { exact: true })
    .selectOption("delayed");
  await page
    .getByLabel("Observed time (UTC ISO)", { exact: true })
    .fill(observedAt);
  await page
    .getByLabel("Shipping evidence reference", { exact: true })
    .fill("RSH-DELAY");
  await page
    .getByLabel("Shipping observation", { exact: true })
    .fill("Private delay evidence");
  const updateKeys: string[] = [];
  let lostUpdate = false;
  await page.route(
    "**/api/commands/warranty.replacement.shipping.update",
    async (route) => {
      updateKeys.push(route.request().headers()["idempotency-key"]!);
      if (!lostUpdate) {
        lostUpdate = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(updateKeys).toHaveLength(2);
  expect(updateKeys[0]).toBe(updateKeys[1]);
  await page.unroute("**/api/commands/warranty.replacement.shipping.update");
  await expect(row).toContainText("Shipping: delayed · v2");
  // An open review cannot overwrite a newer independent observation.
  await row
    .getByRole("button", { name: "Record shipping outcome", exact: true })
    .click();
  await page
    .getByLabel("Shipping outcome", { exact: true })
    .selectOption("delivered");
  await page
    .getByLabel("Shipping evidence reference", { exact: true })
    .fill("RSH-STALE");
  await page
    .getByLabel("Shipping observation", { exact: true })
    .fill("Stale review");
  await cmd("warranty.replacement.shipping.update", {
    replacementId: r.id,
    revision: 2,
    state: "lost",
    reference: "RSH-LOSS",
    evidence: "Private lost evidence",
    observedAt: new Date().toISOString(),
  });
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Replacement shipping changed",
  );
  await page.keyboard.press("Escape");
  for (let revision = 3; revision < 23; revision++) {
    await cmd("warranty.replacement.shipping.update", {
      replacementId: r.id,
      revision,
      state: "in_transit",
      reference: `RSH-HISTORY-${revision}`,
      evidence: "Private carrier observation",
      observedAt: new Date().toISOString(),
    });
  }
  await page.reload();
  await nav(page, "Returns");
  await expect(row).toContainText("Shipping: in_transit · v23");
  const historyOpener = row.getByRole("button", {
    name: "View shipping history",
    exact: true,
  });
  await historyOpener.click();
  const dialog = page.getByRole("dialog", {
    name: "Replacement shipping history",
    exact: true,
  });
  await expect(dialog).toContainText("v1 · in_transit");
  await expect(dialog).toContainText("v20 · in_transit");
  await expect(dialog).not.toContainText("v21 · in_transit");
  let lostPage = false;
  await page.route(
    `**/api/warranty/replacements/${r.id}/shipping/history?after=*`,
    async (route) => {
      if (!lostPage) {
        lostPage = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await dialog
    .getByRole("button", {
      name: "Load more shipping observations",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toContainText("v1 · in_transit");
  await dialog
    .getByRole("button", {
      name: "Load more shipping observations",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("v23 · in_transit");
  await expect(dialog).toContainText("Private lost evidence");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(historyOpener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await row
    .getByRole("button", { name: "Record shipping outcome", exact: true })
    .click();
  await page
    .getByLabel("Shipping outcome", { exact: true })
    .selectOption("delivered");
  await page
    .getByLabel("Shipping evidence reference", { exact: true })
    .fill("RSH-DELIVERED");
  await page
    .getByLabel("Shipping observation", { exact: true })
    .fill("Private delivery evidence");
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("Shipping: delivered · v24");
  await expect(
    row.getByRole("button", { name: "Record shipping outcome", exact: true }),
  ).toHaveCount(0);
  const after = await dashboard();
  expect(invariant(after)).toEqual(invariant(before));
  expect(after.stock.find((u: any) => u.serial === "RSH-NEW").state).toBe(
    "sold",
  );
  expect(after.stock.find((u: any) => u.serial === "RSH-OLD").state).toBe(
    "scrapped",
  );
  await cmd("user.create", {
    name: "Shipping buyer",
    email: "shipping-buyer@example.test",
    password: "long-shipping-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
    currentPassword: "long-test-only-password",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("shipping-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-shipping-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await nav(page, "Returns");
  await expect(row).toContainText("RSH-TRACK-1");
  await expect(row).not.toContainText("Private");
  await expect(
    row.getByRole("button", { name: "Dispatch replacement", exact: true }),
  ).toHaveCount(0);
  await historyOpener.click();
  await expect(dialog).toContainText("v3 · lost");
  await expect(dialog).not.toContainText("Private");
  await expect(dialog).not.toContainText("RSH-LOSS");
  const buyerData = await dashboard();
  expect(buyerData.claims.every((c: any) => c.account_id === account.id)).toBe(
    true,
  );
  const publicHistory = await (
    await page.request.get(
      `/api/warranty/replacements/${r.id}/shipping/history`,
    )
  ).json();
  expect(JSON.stringify(publicHistory)).not.toContain("Private");
  expect(
    publicHistory.items.every(
      (h: any) =>
        !Object.hasOwn(h, "actorId") &&
        !Object.hasOwn(h, "reference") &&
        !Object.hasOwn(h, "evidence"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: shipment delivery retries, stale conflicts, paged history and buyer privacy preserve stock and billing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Delivery browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "DSH-BROWSER",
    name: "Shipping browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 3, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "DSH-DELIVERY",
    quantity: 3,
    serials: ["DSH-OLD", "DSH-NEW", "DSH-SPARE"],
    bin: "REP",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "carrier",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    carrier: "Synthetic delivery carrier",
    tracking: "DSH-TRACK-1",
    handoverEvidence: "Synthetic carrier handover",
  });
  const before = await dashboard();
  const facts = (d: any) => ({
    stock: d.stock,
    orders: d.orders,
    invoices: d.invoices,
    shipments: d.shipments.map(({ delivery, ...s }: any) => s),
  });
  await page.reload();
  await nav(page, "Orders");
  const row = page
    .locator("tbody tr")
    .filter({ hasText: packed.id.slice(0, 8) });
  await expect(row).toContainText("Delivery: handed_over · v0");
  const openOutcome = async (
    state: string,
    reference: string,
    evidence: string,
  ) => {
    await row
      .getByRole("button", { name: "Record delivery outcome", exact: true })
      .click();
    await page
      .getByLabel("Delivery outcome", { exact: true })
      .selectOption(state);
    await page
      .getByLabel("Delivery evidence reference", { exact: true })
      .fill(reference);
    await page
      .getByLabel("Delivery observation", { exact: true })
      .fill(evidence);
  };
  await openOutcome(
    "delayed",
    "DSH-DELAY",
    "Private carrier delay observation",
  );
  let lost = false;
  const keys: string[] = [];
  await page.route(
    "**/api/commands/fulfillment.delivery.update",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!lost) {
        lost = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/commands/fulfillment.delivery.update");
  await expect(row).toContainText("Delivery: delayed · v1");
  await openOutcome("delivered", "DSH-STALE", "Private stale observation");
  await cmd("fulfillment.delivery.update", {
    shipmentId: packed.id,
    revision: 1,
    state: "lost",
    reference: "DSH-LOST",
    evidence: "Private lost carrier observation",
    observedAt: new Date().toISOString(),
  });
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Shipment delivery changed",
  );
  await page.keyboard.press("Escape");
  for (let revision = 2; revision < 23; revision++)
    await cmd("fulfillment.delivery.update", {
      shipmentId: packed.id,
      revision,
      state: "in_transit",
      reference: `DSH-${revision}`,
      evidence: "Private transit observation",
      observedAt: new Date().toISOString(),
    });
  await page.reload();
  await nav(page, "Orders");
  await expect(row).toContainText("Delivery: in_transit · v23");
  const opener = row.getByRole("button", {
    name: "View delivery history",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Shipment delivery history",
    exact: true,
  });
  await expect(dialog).toContainText("v1 · delayed");
  await expect(dialog).toContainText("v20 · in_transit");
  await expect(dialog).not.toContainText("v21 · in_transit");
  let failedPage = false;
  await page.route(
    `**/api/shipments/${packed.id}/delivery/history?after=*`,
    async (route) => {
      if (!failedPage) {
        failedPage = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await dialog
    .getByRole("button", {
      name: "Load more delivery observations",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toContainText("v1 · delayed");
  await dialog
    .getByRole("button", {
      name: "Load more delivery observations",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("v23 · in_transit");
  await expect(dialog).toContainText("Private lost carrier observation");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openOutcome("delivered", "DSH-POD", "Private carrier proof");
  await page
    .getByRole("button", { name: "Record outcome", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toContainText("Delivery: delivered · v24");
  await expect(
    row.getByRole("button", { name: "Record delivery outcome", exact: true }),
  ).toHaveCount(0);
  expect(facts(await dashboard())).toEqual(facts(before));
  await cmd("user.create", {
    name: "Delivery buyer",
    email: "delivery-browser-buyer@example.test",
    password: "long-delivery-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
    currentPassword: "long-test-only-password",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("delivery-browser-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-delivery-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await nav(page, "Orders");
  await expect(row).toContainText("Delivery: delivered · v24");
  await expect(
    row.getByRole("button", { name: "Record delivery outcome", exact: true }),
  ).toHaveCount(0);
  await opener.click();
  await expect(dialog).toContainText("v2 · lost");
  await expect(dialog).not.toContainText("Private");
  await expect(dialog).not.toContainText("DSH-LOST");
  const publicHistory = await (
    await page.request.get(`/api/shipments/${packed.id}/delivery/history`)
  ).json();
  expect(
    publicHistory.items.every(
      (h: any) =>
        !Object.hasOwn(h, "reference") &&
        !Object.hasOwn(h, "evidence") &&
        !Object.hasOwn(h, "actorId"),
    ),
  ).toBe(true);
  const buyerData = await dashboard();
  expect(
    buyerData.shipments.every((s: any) => s.account_id === account.id),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: shipment pages retain rows after failure and discard continuations after refresh or sign-out", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const cmd = async (name: string, payload: any) => {
    const response = await page.request.post(`/api/commands/${name}`, {
      data: payload,
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Paging browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "PAGES-BROWSER",
    name: "Paging bulk equipment",
    serialized: false,
    unitPrice: 100,
    taxBasisPoints: 1300,
  });
  const warehouseId = (await dashboard()).warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 23, unitCost: 60 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "PAGES-DELIVERY",
    quantity: 23,
    serials: [],
    bin: "PAGES",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 23 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  expect(picks).toHaveLength(1);
  await cmd("fulfillment.pick", {
    orderId: order.id,
    allocationId: picks[0].id,
    serial: null,
  });
  const revision = (await dashboard()).orders.find(
    (o: any) => o.id === order.id,
  ).revision;
  const packedIds: string[] = [];
  for (let i = 0; i < 23; i++) {
    const packed = await cmd("fulfillment.pack", {
      orderId: order.id,
      revision,
      mode: "carrier",
      address: `Page shipment ${String(i).padStart(2, "0")}`,
      lines: [{ allocationId: picks[0].id, quantity: 1 }],
    });
    packedIds.push(packed.id);
  }
  await cmd("fulfillment.ship", {
    shipmentId: packedIds[0],
    carrier: "Synthetic queue carrier",
    tracking: "QUEUE-DELAYED",
    handoverEvidence: "Synthetic warehouse handover",
  });
  await cmd("fulfillment.delivery.update", {
    shipmentId: packedIds[0],
    revision: 0,
    state: "delayed",
    reference: "QUEUE-DELAY",
    evidence: "Synthetic delayed delivery evidence",
    observedAt: new Date().toISOString(),
  });
  const before = await dashboard();
  const expected: any[] = [];
  let cursor: string | null = null;
  do {
    const result = await (
      await page.request.get(
        `/api/shipments/page${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
      )
    ).json();
    expected.push(...result.items);
    cursor = result.next;
  } while (cursor);
  expect(expected.filter((s) => packedIds.includes(s.id))).toHaveLength(23);
  let releaseExtras!: () => void, capturedExtras!: () => void;
  const extrasGate = new Promise<void>((resolve) => {
    releaseExtras = resolve;
  });
  const extrasReady = new Promise<void>((resolve) => {
    capturedExtras = resolve;
  });
  await page.route("**/api/effects", async (route) => {
    const response = await route.fetch();
    capturedExtras();
    await extrasGate;
    await route.fulfill({ response });
  });
  await page.reload();
  await extrasReady;
  await nav(page, "Orders");
  const panel = page.getByRole("region", {
    name: "Shipment history",
    exact: true,
  });
  const more = () =>
    panel.getByRole("button", { name: "Load more shipments", exact: true });
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  let fail = true;
  await page.route("**/api/shipments/page?after=*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { code: "TEST", message: "Synthetic shipment page failure" },
      });
    } else await route.continue();
  });
  await more().click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic shipment page failure",
  );
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  let loaded = 20;
  while (loaded < expected.length) {
    await more().click();
    loaded = Math.min(loaded + 20, expected.length);
    await expect(panel.locator("tbody tr")).toHaveCount(loaded);
  }
  await expect(more()).toHaveCount(0);
  await expect(
    panel.getByRole("heading", { name: "Shipments", exact: true }),
  ).toBeFocused();
  expect(
    await panel.locator("tbody tr td:nth-child(2)").allTextContents(),
  ).toEqual(expected.map((s) => s.address));
  await page.unroute("**/api/shipments/page?after=*");
  const status = panel.getByLabel("Shipment status", { exact: true });
  await status.selectOption("delayed");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(panel.locator("tbody tr")).toContainText("Page shipment 00");
  await expect(panel.locator("tbody tr")).toContainText("delayed");
  // Changing the queue must not discard unrelated in-flight dashboard sections.
  releaseExtras();
  await nav(page, "Security");
  await expect(
    page.getByText("admin@example.test", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/effects");
  await nav(page, "Orders");
  await expect(status).toHaveValue("delayed");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await status.selectOption("returned");
  await expect(panel.getByRole("status")).toContainText("No shipments match");
  await expect(panel.locator("tbody tr")).toHaveCount(0);
  let filterFail = true;
  await page.route("**/api/shipments/page?state=lost", async (route) => {
    if (filterFail) {
      filterFail = false;
      await route.fulfill({
        status: 503,
        json: { code: "TEST", message: "Synthetic shipment filter failure" },
      });
    } else await route.continue();
  });
  await status.selectOption("lost");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic shipment filter failure",
  );
  await expect(panel.locator("tbody tr")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Retry shipment filter", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("No shipments match");
  await page.unroute("**/api/shipments/page?state=lost");
  // A filter request can finish after a new selection; its old rows stay absent.
  let releaseFilter!: () => void, capturedFilter!: () => void;
  const filterGate = new Promise<void>((resolve) => {
    releaseFilter = resolve;
  });
  const filterReady = new Promise<void>((resolve) => {
    capturedFilter = resolve;
  });
  await page.route("**/api/shipments/page?state=delayed", async (route) => {
    const response = await route.fetch();
    capturedFilter();
    await filterGate;
    await route.fulfill({ response });
  });
  await status.selectOption("delayed");
  await filterReady;
  await status.selectOption("returned");
  await expect(panel.getByRole("status")).toContainText("No shipments match");
  const oldFilter = page.waitForResponse((r) =>
    r.url().includes("/api/shipments/page?state=delayed"),
  );
  releaseFilter();
  await oldFilter;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(status).toHaveValue("returned");
  await expect(panel.locator("tbody tr")).toHaveCount(0);
  await page.unroute("**/api/shipments/page?state=delayed");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  await expect(status).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  for (const action of ["Refresh", "Sign out"] as const) {
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    await page.route("**/api/shipments/page?after=*", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      captured();
      await gate;
      await route.fulfill({ response });
    });
    await more().click();
    await ready;
    await page.getByRole("button", { name: action, exact: true }).click();
    if (action === "Refresh") {
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    } else
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    const delivered = page.waitForResponse((r) =>
      r.url().includes("/api/shipments/page?after="),
    );
    release();
    await delivered;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    if (action === "Refresh")
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    else await expect(panel).toHaveCount(0);
    await page.unroute("**/api/shipments/page?after=*");
  }
  const after = await page.request.post("/api/login", {
    data: { email: "admin@example.test", password: "long-test-only-password" },
    headers: { origin: "http://127.0.0.1:3117" },
  });
  // Browsing/refresh/sign-out change no native stock, order or invoice facts.
  expect(after.status()).toBe(200);
  const final = await dashboard();
  for (const key of ["stock", "orders", "invoices"])
    expect(final[key]).toEqual(before[key]);
  expect(errors).toEqual([]);
});

test("browser: event diagnostics preserve pages and exact reviewed retries without changing native facts", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const login = async (
    p: Page,
    email: string,
    password = "long-event-test-password",
  ) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login(page, "event-admin@example.test");
  // A longer navigation must keep every control reachable on short desktops.
  await page.setViewportSize({ width: 1280, height: 600 });
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  const dashboard = async () => stockFactsDashboard(page);
  const before = await dashboard();
  const endpoint = "/api/events/event-report/deliveries";
  let initialFailure = false;
  await page.route(`**${endpoint}`, async (route) => {
    if (!initialFailure) {
      initialFailure = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await nav(page, "Event reporting");
  const panel = page.getByRole("region", {
    name: "Event reporting",
    exact: true,
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry event deliveries", exact: true })
    .click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  const diagnostic = await (await page.request.get(endpoint)).json();
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /payload|lease_token|private event payload/,
  );
  await expect(
    panel.getByRole("list", { name: "Delivery totals", exact: true }),
  ).toContainText("quarantined: 24");
  let pageFailure = false;
  await page.route(`**${endpoint}?after=*`, async (route) => {
    if (!pageFailure) {
      pageFailure = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load older deliveries", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  await panel
    .getByRole("button", { name: "Retry event deliveries", exact: true })
    .click();
  await expect(panel.locator("tbody tr").nth(23)).toBeVisible();
  const loaded = await panel
    .locator("tbody tr td:first-child")
    .allTextContents();
  expect(new Set(loaded).size).toBe(loaded.length);
  const row = panel.locator("tbody tr").filter({
    has: page.getByRole("cell", { name: "ui-event-23", exact: true }),
  });
  const opener = row.getByRole("button", {
    name: "View attempts",
    exact: true,
  });
  await opener.click();
  const history = page.getByRole("region", {
    name: "Event attempt history",
    exact: true,
  });
  await expect(history.getByRole("heading")).toBeFocused();
  await expect(history.locator("li")).toHaveCount(20);
  let historyFailure = false;
  await page.route(
    `**${endpoint}/ui-event-23/history?before=*`,
    async (route) => {
      if (!historyFailure) {
        historyFailure = true;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await history
    .getByRole("button", { name: "Load older attempts", exact: true })
    .click();
  await expect(history.getByRole("alert")).toBeVisible();
  await expect(history.locator("li")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Retry attempt history", exact: true })
    .click();
  await expect(history.locator("li")).toHaveCount(23);
  expect(new Set(await history.locator("li").allTextContents()).size).toBe(23);
  await history
    .getByRole("button", { name: "Close attempt history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole("button", { name: "Review retry", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Review event retry",
    exact: true,
  });
  await expect(dialog.getByLabel("Reason / evidence")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Review retry", exact: true }),
  ).toBeFocused();
  const original = diagnostic.items.find(
    (item: any) => item.event_id === "ui-event-23",
  );
  await row.getByRole("button", { name: "Review retry", exact: true }).click();
  await dialog
    .getByLabel("Reason / evidence")
    .fill("Synthetic reviewed compatibility decision");
  const keys: string[] = [],
    payloads: string[] = [];
  let lost = false;
  await page.route("**/api/commands/events.retry", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    payloads.push(route.request().postData()!);
    if (!lost) {
      lost = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Queue reviewed retry", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Queue reviewed retry", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(payloads[0]).toBe(payloads[1]);
  const afterRetry = await (await page.request.get(endpoint)).json();
  const saved = afterRetry.items.find(
    (item: any) => item.event_id === "ui-event-23",
  );
  expect(saved.revision).toBe(original.revision + 1);
  expect(saved.state).toBe("retry");
  expect(saved.attempts).toBe(23);
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  // Concurrent reviewed update makes the displayed revision stale.
  const stale = afterRetry.items.find(
    (item: any) => item.event_id === "ui-event-22",
  );
  const session = await (await page.request.get("/api/session")).json();
  const payload = {
    consumerId: "event-report",
    eventId: stale.event_id,
    revision: stale.revision,
    reason: "Concurrent synthetic review",
  };
  const headers = {
    origin: "http://127.0.0.1:3117",
    "x-csrf-token": session.csrf,
    "idempotency-key": "browser-concurrent-event-review",
  };
  expect(
    (
      await page.request.post("/api/commands/events.retry", {
        data: payload,
        headers,
      })
    ).status(),
  ).toBe(200);
  const staleRow = panel.locator("tbody tr").filter({
    has: page.getByRole("cell", { name: "ui-event-22", exact: true }),
  });
  await staleRow
    .getByRole("button", { name: "Review retry", exact: true })
    .click();
  await dialog.getByLabel("Reason / evidence").fill("Stale synthetic review");
  await dialog
    .getByRole("button", { name: "Queue reviewed retry", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("REVISION");
  await expect(
    dialog.getByRole("button", { name: "Queue reviewed retry", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByLabel("Reason / evidence")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(20);
  const supportContext = await browser.newContext(),
    buyerContext = await browser.newContext();
  try {
    const support = await supportContext.newPage(),
      buyer = await buyerContext.newPage();
    await login(support, "event-support@example.test");
    await nav(support, "Event reporting");
    const supportPanel = support.getByRole("region", {
      name: "Event reporting",
      exact: true,
    });
    await expect(supportPanel.locator("tbody tr")).toHaveCount(20);
    await expect(
      supportPanel.getByRole("button", { name: "Review retry", exact: true }),
    ).toHaveCount(0);
    const supportSession = await (
      await support.request.get("/api/session")
    ).json();
    expect(
      (
        await support.request.post("/api/commands/events.retry", {
          data: { ...payload, revision: stale.revision + 1 },
          headers: {
            ...headers,
            "x-csrf-token": supportSession.csrf,
            "idempotency-key": "support-event-review",
          },
        })
      ).status(),
    ).toBe(403);
    await login(
      buyer,
      "refund-buyer@example.test",
      "long-notice-test-password",
    );
    await expect(
      buyer
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("button", { name: "Event reporting", exact: true }),
    ).toHaveCount(0);
    expect((await buyer.request.get(endpoint)).status()).toBe(403);
    expect(
      (await buyer.request.get(`${endpoint}/ui-event-23/history`)).status(),
    ).toBe(403);
  } finally {
    await supportContext.close();
    await buyerContext.close();
  }
  await page.unroute(`**${endpoint}?after=*`);
  for (const action of ["Refresh", "Sign out"] as const) {
    let announce!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${endpoint}?after=*`, async (route) => {
      const response = await route.fetch();
      announce();
      await held;
      await route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "Load older deliveries", exact: true })
      .click();
    await started;
    await page.getByRole("button", { name: action, exact: true }).click();
    if (action === "Refresh")
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    else
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    release();
    await page.unrouteAll({ behavior: "wait" });
    if (action === "Refresh")
      await expect(panel.locator("tbody tr")).toHaveCount(20);
    else await expect(panel).toHaveCount(0);
  }
  expect(
    (
      await page.request.post("/api/login", {
        data: {
          email: "event-admin@example.test",
          password: "long-event-test-password",
        },
        headers: { origin: "http://127.0.0.1:3117" },
      })
    ).status(),
  ).toBe(200);
  const after = await dashboard();
  for (const key of ["stock", "orders", "invoices"])
    expect(after[key]).toEqual(before[key]);
  expect(errors).toEqual([]);
});

test("browser: customers review immutable provider terms, stale consent stops, and withdrawal retains acceptance history", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  const login = async (p: Page, email: string) => {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(p, "Customers");
  };
  await login(page, "admin@example.test");
  const before = await stockFactsDashboard(page);
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    buyerPage = await context.newPage();
  try {
    await login(buyerPage, "named-carriers@example.test");
    const account = (
      await (await buyerPage.request.get("/api/dashboard")).json()
    ).accounts[0];
    await buyerPage
      .getByRole("button", { name: "Residency choice", exact: true })
      .click();
    await buyerPage
      .getByLabel("Processor policy")
      .selectOption("provider-exceptions");
    await buyerPage
      .getByLabel("Allow FedEx processing outside the storage region", {
        exact: true,
      })
      .check();
    await buyerPage
      .getByLabel("Acknowledgment of reviewed processor terms")
      .fill("Synthetic buyer reviewed original FedEx terms");
    // Keep this original review open while staff replaces its immutable terms.
    await page
      .getByRole("button", { name: "Publish provider disclosure", exact: true })
      .click();
    await page
      .getByLabel("Named provider", { exact: true })
      .selectOption("fedex");
    await page
      .getByLabel("New disclosure version")
      .fill("synthetic-browser-v2");
    await page
      .getByLabel("Processing purposes", { exact: true })
      .fill("Synthetic shipment processing purpose");
    await page
      .getByLabel("Minimum data fields", { exact: true })
      .fill("Synthetic consignee name\nSynthetic destination");
    await page
      .getByLabel("Processing countries", { exact: true })
      .fill("CA, US");
    await page
      .getByLabel("Subprocessors", { exact: true })
      .fill("Synthetic subprocessor only");
    await page
      .getByLabel("Retention and deletion", { exact: true })
      .fill("Synthetic thirty-day retention; not actual provider policy");
    await page
      .getByLabel("Withdrawal consequences", { exact: true })
      .fill("Synthetic withdrawal stops later transmissions");
    await page
      .getByLabel("Terms reference", { exact: true })
      .fill("synthetic:browser-terms-v2");
    await page
      .getByLabel("Vendor and business qualification evidence", { exact: true })
      .fill("Synthetic private business review only");
    const keys: string[] = [];
    let dropped = false;
    await page.route(
      "**/api/commands/provider.disclosure.publish",
      async (route) => {
        keys.push(route.request().headers()["idempotency-key"]!);
        if (!dropped) {
          dropped = true;
          const r = await route.fetch();
          expect(r.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await next(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await next(buyerPage);
    await expect(
      buyerPage.getByRole("dialog").getByRole("alert"),
    ).toContainText(/terms changed/);
    let current = (await (await buyerPage.request.get("/api/dashboard")).json())
      .accounts[0];
    expect(current.residency_version).toBe(account.residency_version);
    await buyerPage
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await buyerPage.reload();
    await nav(buyerPage, "Customers");
    await buyerPage
      .getByRole("button", { name: "Residency choice", exact: true })
      .click();
    const dialog = buyerPage.getByRole("dialog");
    await dialog
      .locator("summary")
      .filter({ hasText: "FedEx · synthetic-browser-v2" })
      .click();
    for (const content of [
      "Synthetic shipment processing purpose",
      "Synthetic consignee name, Synthetic destination",
      "CA, US",
      "Synthetic subprocessor only",
      "Synthetic thirty-day retention",
      "Synthetic withdrawal stops later transmissions",
      "synthetic:browser-terms-v2",
    ])
      await expect(
        dialog.getByText(content, {
          exact:
            content !== "Synthetic thirty-day retention" &&
            content !== "Synthetic withdrawal stops later transmissions",
        }),
      ).toBeVisible();
    await expect(
      dialog.getByText("Synthetic private business review only"),
    ).toHaveCount(0);
    await expect(
      buyerPage.getByLabel("Authorized customer representative"),
    ).toHaveCount(0);
    const permission = buyerPage.getByLabel(
      "Allow FedEx processing outside the storage region",
      { exact: true },
    );
    await expect(permission).not.toBeChecked();
    await permission.check();
    await buyerPage
      .getByLabel("Processor policy")
      .selectOption("provider-exceptions");
    await buyerPage
      .getByLabel("Acknowledgment of reviewed processor terms")
      .fill("Synthetic authenticated buyer reviewed FedEx v2");
    await next(buyerPage);
    await expect(dialog).toHaveCount(0);
    current = (await (await buyerPage.request.get("/api/dashboard")).json())
      .accounts[0];
    expect(current.residency_version).toBe(account.residency_version + 1);
    const historyUrl = `/api/accounts/${account.id}/provider-acceptances?version=${current.residency_version}`;
    const receipt = await (await buyerPage.request.get(historyUrl)).json();
    expect(receipt).toHaveLength(1);
    expect(receipt[0].basis).toBe("buyer");
    expect(receipt[0].evidence_ref).toBeNull();
    expect(receipt[0].representative).toBe("Named carrier buyer");
    await page
      .getByRole("button", { name: "Withdraw FedEx disclosure", exact: true })
      .click();
    await page
      .getByLabel("Reason / evidence")
      .fill("Synthetic reviewed withdrawal of provider terms");
    await next(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await buyerPage.reload();
    await nav(buyerPage, "Customers");
    await expect(
      buyerPage.getByText(/FedEx terms require review/),
    ).toBeVisible();
    await buyerPage
      .getByRole("button", { name: "Residency choice", exact: true })
      .click();
    await expect(permission).toHaveCount(0);
    await buyerPage.getByLabel("Processor policy").selectOption("strict");
    await buyerPage
      .getByLabel("Acknowledgment of reviewed processor terms")
      .fill("Synthetic withdrawal of all exceptions");
    await next(buyerPage);
    await expect(buyerPage.getByRole("dialog")).toHaveCount(0);
    expect(await (await buyerPage.request.get(historyUrl)).json()).toEqual(
      receipt,
    );
    const after = await stockFactsDashboard(page);
    for (const key of ["stock", "orders", "invoices"])
      expect(after[key]).toEqual(before[key]);
    expect(
      await buyerPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("browser: provider acceptance history retains pages and exact terms, isolates accounts and cancels stale reads", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (p: Page, email: string) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await nav(p, "Customers");
  };
  await login(page, "history-buyer@example.test");
  const before = await stockFactsDashboard(page);
  const account = before.accounts[0];
  const versionsUrl = `/api/accounts/${account.id}/provider-acceptance-versions`;
  const acceptanceUrl = `/api/accounts/${account.id}/provider-acceptances?version=2`;
  const original = await (await page.request.get(acceptanceUrl)).json();
  const history = page.getByRole("region", {
    name: "Provider acceptance history",
    exact: true,
  });
  const open = async () => {
    await page
      .getByRole("button", { name: "Acceptance history", exact: true })
      .click();
    await expect(
      history.getByRole("heading", {
        name: `Provider acceptance history — ${account.name}`,
        exact: true,
      }),
    ).toBeFocused();
    await expect(history.getByRole("status")).toHaveText(
      "20 accepted choices loaded",
    );
  };
  await open();
  await expect(history).toContainText(
    "Current customer choice: 28 · Strict regional residency",
  );
  await expect(
    history.getByText(/Initial, strict and legacy unreviewed choices/),
  ).toBeVisible();
  const pageRoute = "**/api/accounts/*/provider-acceptance-versions?after=*";
  let failed = false;
  await page.route(pageRoute, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic history read failure" }),
      });
    } else await route.continue();
  });
  await history
    .getByRole("button", { name: "Load older accepted choices" })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic history read failure",
  );
  await expect(history.getByRole("status")).toHaveText(
    "20 accepted choices loaded",
  );
  await history
    .getByRole("button", { name: "Retry acceptance history" })
    .click();
  await expect(history.getByRole("status")).toHaveText(
    "25 accepted choices loaded",
  );
  await expect(
    history.getByRole("button", { name: "Load older accepted choices" }),
  ).toHaveCount(0);
  await page.unroute(pageRoute);

  // Private vendor review evidence stays absent, while the exact accepted public
  // terms and staff-recorded external customer evidence remain accessible.
  const termsRoute = `**/api/provider-disclosures/${original[0].disclosure_id}`;
  let badTerms = 0;
  await page.route(termsRoute, async (route) => {
    badTerms++;
    if (badTerms === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Synthetic retained terms read failure",
        }),
      });
    } else if (badTerms === 2) {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), hash: "0".repeat(64) },
      });
    } else await route.continue();
  });
  await history
    .getByRole("button", {
      name: "View accepted terms for choice 2",
      exact: true,
    })
    .click();
  const terms = history.getByRole("region", {
    name: "Accepted terms for choice 2",
    exact: true,
  });
  await expect(terms.getByRole("alert")).toContainText(
    "Synthetic retained terms read failure",
  );
  await expect(terms.getByText(/No reviewed provider acceptance/)).toHaveCount(
    0,
  );
  await terms.getByRole("button", { name: "Retry accepted terms" }).click();
  await expect(terms.getByRole("alert")).toContainText(
    "Accepted terms do not match",
  );
  await terms.getByRole("button", { name: "Retry accepted terms" }).click();
  await expect(
    terms.getByRole("heading", {
      name: "Accepted terms · choice 2",
      exact: true,
    }),
  ).toBeFocused();
  const stripe = terms.getByRole("region", {
    name: "Stripe acceptance",
    exact: true,
  });
  await expect(stripe).toContainText(
    "Staff recording external customer acceptance",
  );
  await expect(stripe).toContainText("synthetic:explicit-customer-acceptance");
  await expect(
    stripe.getByText(
      original.find((a: any) => a.provider === "stripe").disclosure_hash,
      { exact: true },
    ),
  ).toBeVisible();
  await stripe.locator("summary").click();
  await expect(stripe).toContainText(
    "Synthetic test processing only; no vendor qualification",
  );
  await expect(stripe).toContainText("Synthetic transaction total");
  await expect(stripe).toContainText("US, CA");
  await expect(stripe).toContainText("synthetic:test-only-terms");
  await expect(
    history.getByText(
      "Synthetic fixture qualification; not actual vendor evidence",
    ),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.unroute(termsRoute);

  // Withdrawal changes current permission, never the customer's retained terms.
  const adminContext = await browser.newContext();
  try {
    const staff = await adminContext.newPage();
    await login(staff, "admin@example.test");
    const csrf = (await (await staff.request.get("/api/session")).json()).csrf;
    const disclosure = (
      await (await staff.request.get("/api/provider-disclosures")).json()
    ).find((d: any) => d.provider === "dhl-express");
    expect(
      (
        await staff.request.post("/api/commands/provider.disclosure.withdraw", {
          headers: {
            "x-csrf-token": csrf,
            "idempotency-key": "history-test-withdraw-dhl",
            origin: "http://127.0.0.1:3117",
          },
          data: {
            provider: "dhl-express",
            disclosureId: disclosure.id,
            reason: "Synthetic history-only withdrawal evidence",
          },
        })
      ).status(),
    ).toBe(200);
    await history
      .getByRole("button", {
        name: "View accepted terms for choice 27",
        exact: true,
      })
      .click();
    const buyerTerms = history.getByRole("region", {
      name: "Accepted terms for choice 27",
      exact: true,
    });
    await expect(
      buyerTerms.getByRole("heading", {
        name: "Accepted terms · choice 27",
        exact: true,
      }),
    ).toBeFocused();
    const dhl = buyerTerms.getByRole("region", {
      name: "DHL Express acceptance",
      exact: true,
    });
    await expect(dhl).toContainText("Authenticated buyer");
    await expect(dhl).toContainText("Synthetic history representative");
    await dhl.locator("summary").click();
    await expect(dhl).toContainText("synthetic:test-only-terms");
    await expect(
      buyerTerms.getByText("Customer acceptance evidence", { exact: true }),
    ).toHaveCount(0);
    expect(await (await page.request.get(acceptanceUrl)).json()).toEqual(
      original,
    );

    const otherContext = await browser.newContext();
    try {
      const other = await otherContext.newPage();
      await login(other, "empty-history@example.test");
      expect((await other.request.get(versionsUrl)).status()).toBe(403);
      expect((await other.request.get(acceptanceUrl)).status()).toBe(403);
      await other
        .getByRole("button", { name: "Acceptance history", exact: true })
        .click();
      await expect(
        other.getByText(
          "No reviewed provider acceptances are recorded for this account.",
        ),
      ).toBeVisible();
      await expect(
        other.getByText("Synthetic history representative", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await otherContext.close();
    }
  } finally {
    await adminContext.close();
  }
  const after = await stockFactsDashboard(page);
  for (const field of ["stock", "orders", "invoices"])
    expect(after[field]).toEqual(before[field]);
  expect(after.accounts[0]).toEqual(account);
  await history
    .getByRole("button", { name: "Close acceptance history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Acceptance history", exact: true }),
  ).toBeFocused();
  await expect(history).toHaveCount(0);

  // Hold an actual terms response across navigation, refresh and sign-out.
  // Every old mounted view must discard it when the response is released.
  for (const action of ["Navigation", "Refresh", "Sign out"] as const) {
    await open();
    let announce!: () => void, release!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let cancelled = false;
    const routePattern = "**/api/accounts/*/provider-acceptances?version=2";
    await page.route(
      routePattern,
      async (route) => {
        const response = await route.fetch();
        announce();
        await held;
        try {
          await route.fulfill({ response });
        } catch (error) {
          // Chromium has already handled a fetch aborted by unmount. Only
          // tolerate that result after observing this request's cancellation.
          if (!cancelled || !String(error).includes("Route is already handled"))
            throw error;
        } finally {
          finish();
        }
      },
      { times: 1 },
    );
    try {
      if (
        !(await history
          .getByRole("button", {
            name: "View accepted terms for choice 2",
            exact: true,
          })
          .count())
      ) {
        await history
          .getByRole("button", { name: "Load older accepted choices" })
          .click();
        await expect(history.getByRole("status")).toHaveText(
          "25 accepted choices loaded",
        );
      }
      await history
        .getByRole("button", {
          name: "View accepted terms for choice 2",
          exact: true,
        })
        .click();
      await started;
      const failed = page.waitForEvent("requestfailed", {
        predicate: (request) => request.url().endsWith(acceptanceUrl),
      });
      if (action === "Navigation") await nav(page, "Orders");
      else
        await page.getByRole("button", { name: action, exact: true }).click();
      expect((await failed).failure()?.errorText).toContain("ERR_ABORTED");
      cancelled = true;
      if (action === "Refresh")
        await expect(history.getByRole("status")).toHaveText(
          "20 accepted choices loaded",
        );
      else await expect(history).toHaveCount(0);
    } finally {
      release();
      await finished;
      // Keep interception stable until the whole dashboard refresh completes;
      // the history's first page can finish before the remaining reads.
      if (action === "Refresh")
        await expect(
          page.getByRole("button", { name: "Refresh", exact: true }),
        ).toBeEnabled();
      await page.unroute(routePattern);
    }
    await expect(
      page.getByRole("region", {
        name: "Accepted terms for choice 2",
        exact: true,
      }),
    ).toHaveCount(0);
    if (action === "Navigation") await nav(page, "Customers");
    if (action === "Refresh")
      await history
        .getByRole("button", { name: "Close acceptance history", exact: true })
        .click();
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("browser: phone order amendments retain accepted money, retry lost responses and page scoped history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = async (email: string) => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  const cmd = async (name: string, data: unknown) => {
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const dashboard = async () =>
    await (await page.request.get("/api/dashboard")).json();
  await login("admin@example.test");
  const account = await cmd("account.create", {
    name: "Synthetic amendment phone customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "AMEND-PHONE",
    name: "Synthetic amendment equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const warehouseId = (await dashboard()).warehouses[0].id;
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const accepted = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: true,
  });
  const original = (await dashboard()).orders.find(
    (o: any) => o.id === accepted.id,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await nav(page, "Orders");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Synthetic amendment phone customer" })
    .filter({
      has: page.getByRole("button", {
        name: "View amendment history",
        exact: true,
      }),
    });
  const history = page.getByRole("region", {
    name: "Order amendment history",
    exact: true,
  });
  const opener = row.getByRole("button", {
    name: "View amendment history",
    exact: true,
  });
  await opener.click();
  await expect(history).toContainText("No order amendments recorded.");
  await expect(history.getByRole("heading")).toBeFocused();
  await history
    .getByRole("button", { name: "Close amendment history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  const keys: string[] = [];
  await page.route("**/api/commands/order.amend", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (keys.length === 1) {
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await row
    .getByRole("button", {
      name: "Amend quantity: AMEND-PHONE",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Accepted unit price CA$100.00 and unit tax CA$13.00 are retained.",
  );
  await expect(dialog).toContainText("Picked stock must be unpicked");
  await page.getByLabel("New total ordered units", { exact: true }).fill("2");
  await page
    .getByLabel("Allow backorder for additional units", { exact: true })
    .check();
  await page
    .getByLabel("Buyer-visible reason for amendment", { exact: true })
    .fill("Synthetic buyer asked for a second unit");
  await dialog
    .getByRole("button", { name: "Save amendment", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("New total ordered units", { exact: true }),
  ).toHaveValue("2");
  await dialog
    .getByRole("button", { name: "Save amendment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/commands/order.amend");
  await expect(row).toContainText("2 ordered / 0 reserved");
  const amended = (await dashboard()).orders.find(
    (o: any) => o.id === accepted.id,
  );
  expect(amended.warehouse_id).toBe(original.warehouse_id);
  expect(amended.lines[0].product_id).toBe(original.lines[0].product_id);
  expect(amended.lines[0].unit_price).toBe(10000);
  expect(amended.lines[0].unit_tax).toBe(1300);
  let records = await (
    await page.request.get(`/api/orders/${accepted.id}/amendments`)
  ).json();
  expect(records.items).toHaveLength(1);
  expect(records.items[0]).toMatchObject({
    before_quantity: 1,
    after_quantity: 2,
    before_total: 11300,
    after_total: 22600,
    allocated_delta: 0,
  });
  let revision = amended.revision;
  for (let i = 0; i < 21; i++) {
    await cmd("order.amend", {
      orderId: accepted.id,
      lineId: original.lines[0].id,
      revision,
      quantity: i % 2 === 0 ? 3 : 2,
      allowBackorder: true,
      reason: `Synthetic amendment history ${i + 1}`,
    });
    revision++;
  }
  await cmd("user.create", {
    name: "Synthetic amendment buyer",
    email: "amendment-phone@example.test",
    password: "long-test-only-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
    currentPassword: "long-test-only-password",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await login("amendment-phone@example.test");
  await nav(page, "Orders");
  await expect(
    page.getByRole("button", { name: "View amendment history", exact: true }),
  ).toHaveCount(1);
  await expect(
    row.getByRole("button", {
      name: "Amend quantity: AMEND-PHONE",
      exact: true,
    }),
  ).toBeVisible();
  let failOlder = true;
  await page.route(
    `**/api/orders/${accepted.id}/amendments?after=*`,
    async (route) => {
      if (failOlder) {
        failOlder = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic history unavailable" }),
        });
      } else await route.continue();
    },
  );
  const firstHistoryPath = `**/api/orders/${accepted.id}/amendments`;
  await page.route(firstHistoryPath, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic first history unavailable" }),
    }),
  );
  await opener.click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic first history unavailable",
  );
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await page.unroute(firstHistoryPath);
  await history
    .getByRole("button", { name: "Retry amendment history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Load older amendments", exact: true })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic history unavailable",
  );
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Retry amendment history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(22);
  await expect(history).toContainText(
    "Synthetic buyer asked for a second unit",
  );
  await expect(
    history.getByRole("button", { name: "Load older amendments", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**/api/orders/${accepted.id}/amendments?after=*`);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(history).toHaveCount(0);
  await opener.click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await nav(page, "Overview");
  await expect(history).toHaveCount(0);
  await nav(page, "Orders");
  await expect(history).toHaveCount(0);
  // Hold a real history request until navigation aborts it; no stale history may reappear.
  let finish!: () => void;
  let handled!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const done = new Promise<void>((resolve) => {
    handled = resolve;
  });
  const path = `**/api/orders/${accepted.id}/amendments`;
  await page.route(path, async () => {
    await held;
    handled();
  });
  const started = page.waitForRequest((r) =>
    r.url().endsWith(`/api/orders/${accepted.id}/amendments`),
  );
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().endsWith(`/api/orders/${accepted.id}/amendments`),
  });
  await opener.click();
  await started;
  await expect(history).toContainText("Loading amendment history…");
  await nav(page, "Overview");
  await aborted;
  finish();
  await done;
  await page.unroute(path);
  await nav(page, "Orders");
  await expect(history).toHaveCount(0);
  await opener.click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Close amendment history", exact: true })
    .click();
  await row
    .getByRole("button", { name: "Amend quantity: AMEND-PHONE", exact: true })
    .click();
  await page.getByLabel("New total ordered units", { exact: true }).fill("1");
  await expect(
    page.getByLabel("Allow backorder for additional units", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByLabel("Buyer-visible reason for amendment", { exact: true })
    .fill("Synthetic buyer reduced the backorder");
  await dialog
    .getByRole("button", { name: "Save amendment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("1 ordered / 0 reserved");
  records = await (
    await page.request.get(`/api/orders/${accepted.id}/amendments`)
  ).json();
  expect(records.items[0]).toMatchObject({
    before_quantity: 3,
    after_quantity: 1,
    before_total: 33900,
    after_total: 11300,
    unit_price: 10000,
    unit_tax: 1300,
    allocated_delta: 0,
  });
  await opener.click();
  await expect(history).toContainText("Synthetic buyer reduced the backorder");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(history).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: phone reservation deadlines and expiry preserve accepted money, retry committed expiry and show scoped history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = async (email: string) => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  const cmd = async (name: string, data: unknown) => {
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        origin: "http://127.0.0.1:3117",
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const dashboard = async () =>
    (await page.request.get("/api/dashboard")).json();
  await login("admin@example.test");
  const account = await cmd("account.create", {
    name: "Synthetic reservation phone customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const other = await cmd("account.create", {
    name: "Synthetic other reservation customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "RESERVE-PHONE",
    name: "Synthetic reserved equipment",
    serialized: false,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const warehouseId = (await dashboard()).warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const lineId = (
    await (await page.request.get("/api/purchases")).json()
  ).orders.find((o: any) => o.id === po.id).lines[0].id;
  // Separate received lots give one picked and one unpicked reservation.
  for (let i = 0; i < 2; i++)
    await cmd("purchase.receive", {
      poId: po.id,
      lineId,
      deliveryRef: `SYNTHETIC-RESERVATION-${i}`,
      quantity: 1,
      serials: [],
      bin: `RESERVATION-${i}`,
      quarantine: false,
    });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const accepted = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${accepted.id}/picks`)
  ).json();
  expect(picks).toHaveLength(2);
  await cmd("fulfillment.pick", {
    orderId: accepted.id,
    allocationId: picks[0].id,
    serial: picks[0].serial,
  });
  const original = (await dashboard()).orders.find(
    (o: any) => o.id === accepted.id,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await nav(page, "Orders");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Synthetic reservation phone customer" })
    .filter({
      has: page.getByRole("button", {
        name: "View reservation history",
        exact: true,
      }),
    });
  const opener = row.getByRole("button", {
    name: "View reservation history",
    exact: true,
  });
  const history = page.getByRole("region", {
    name: "Order reservation history",
    exact: true,
  });
  await expect(row).toContainText("No reservation deadline");
  await opener.click();
  await expect(history).toContainText("No reservation changes recorded.");
  await expect(history.getByRole("heading")).toBeFocused();
  await history
    .getByRole("button", { name: "Close reservation history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await row
    .getByRole("button", { name: "Set reservation deadline", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const future = new Date(Date.now() + 3600000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page
    .getByLabel("Future reservation deadline (local time)", { exact: true })
    .fill(local);
  await page
    .getByLabel("Buyer-visible reason for reservation change", { exact: true })
    .fill("Synthetic reviewed reservation window");
  await dialog
    .getByRole("button", { name: "Save reservation deadline", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("Reservation deadline:");
  await row
    .getByRole("button", { name: "Renew reservation deadline", exact: true })
    .click();
  const renewed = new Date(future.getTime() + 3600000);
  const renewedLocal = new Date(
    renewed.getTime() - renewed.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  await page
    .getByLabel("Future reservation deadline (local time)", { exact: true })
    .fill(renewedLocal);
  await page
    .getByLabel("Buyer-visible reason for reservation change", { exact: true })
    .fill("Synthetic explicit reviewed renewal");
  await dialog
    .getByRole("button", { name: "Save reservation deadline", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await row
    .getByRole("button", { name: "Clear reservation deadline", exact: true })
    .click();
  await page
    .getByLabel("Buyer-visible reason for reservation change", { exact: true })
    .fill("Synthetic reviewed clearing");
  await dialog
    .getByRole("button", { name: "Clear reservation deadline", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("No reservation deadline");
  let order = (await dashboard()).orders.find((o: any) => o.id === accepted.id);
  const dueAt = Date.now() + 150;
  await cmd("order.reservation.deadline", {
    orderId: accepted.id,
    revision: order.revision,
    expiresAt: dueAt,
    reason: "Synthetic short reservation window",
  });
  await expect
    .poll(
      async () =>
        (await dashboard()).orders.find((o: any) => o.id === accepted.id)
          .reservation.overdue,
    )
    .toBe(true);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row).toContainText("Reservation deadline due");
  const keys: string[] = [];
  const payloads: unknown[] = [];
  await page.route(
    "**/api/commands/order.reservation.expire",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      payloads.push(route.request().postDataJSON());
      if (keys.length === 1) {
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await row
    .getByRole("button", { name: "Expire unpicked reservations", exact: true })
    .click();
  await expect(dialog).toContainText("credit exposure stay intact");
  await expect(dialog).toContainText("Picked and packed stock is preserved");
  await page
    .getByLabel("Buyer-visible reason for reservation expiry", { exact: true })
    .fill("Synthetic reviewed release after deadline");
  await dialog
    .getByRole("button", { name: "Expire unpicked reservations", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Expire unpicked reservations", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(payloads[0]).toEqual(payloads[1]);
  await page.unroute("**/api/commands/order.reservation.expire");
  await expect(row).toContainText("2 ordered / 1 reserved");
  order = (await dashboard()).orders.find((o: any) => o.id === accepted.id);
  expect(order.total).toBe(original.total);
  expect(order.lines[0]).toMatchObject({
    quantity: 2,
    allocated: 1,
    unit_price: 10000,
    unit_tax: 1300,
  });
  let records = await (
    await page.request.get(`/api/orders/${accepted.id}/reservations`)
  ).json();
  expect(records.items.filter((r: any) => r.action === "expire")).toHaveLength(
    1,
  );
  expect(records.items[0].lines[0]).toMatchObject({
    released: 1,
    retainedPicked: 1,
  });
  await opener.click();
  await expect(history).toContainText(
    "1 released to backorder · 1 picked units retained",
  );
  await expect(history).toContainText("Synthetic reserved equipment");
  await expect(history).toContainText("Reservation deadline cleared");
  await history
    .getByRole("button", { name: "Close reservation history", exact: true })
    .click();
  let revision = order.revision;
  for (let i = 0; i < 21; i++) {
    await cmd("order.reservation.deadline", {
      orderId: accepted.id,
      revision,
      expiresAt: Date.now() + 3600000 + i * 60000,
      reason: `Synthetic reviewed renewal ${i + 1}`,
    });
    revision++;
  }
  for (const [suffix, accountId] of [
    ["buyer", account.id],
    ["other", other.id],
  ])
    await cmd("user.create", {
      name: `Synthetic reservation ${suffix}`,
      email: `reservation-${suffix}@example.test`,
      password: "long-test-only-password",
      role: "buyer",
      accountId,
      sites: [],
      requirePasswordChange: false,
      currentPassword: "long-test-only-password",
    });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("reservation-other@example.test");
  expect(
    (
      await page.request.get(`/api/orders/${accepted.id}/reservations`)
    ).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("reservation-buyer@example.test");
  await nav(page, "Orders");
  await expect(row).toContainText("Reservation deadline:");
  for (const name of [
    "Set reservation deadline",
    "Renew reservation deadline",
    "Clear reservation deadline",
    "Expire unpicked reservations",
  ])
    await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
  const first = `**/api/orders/${accepted.id}/reservations`;
  await page.route(first, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic history unavailable" }),
    }),
  );
  await opener.click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic history unavailable",
  );
  await expect(history.getByRole("listitem")).toHaveCount(0);
  await page.unroute(first);
  await history
    .getByRole("button", { name: "Retry reservation history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  let failOlder = true;
  const older = `**/api/orders/${accepted.id}/reservations?after=*`;
  await page.route(older, async (route) => {
    if (failOlder) {
      failOlder = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Synthetic older history unavailable",
        }),
      });
    } else await route.continue();
  });
  await history
    .getByRole("button", { name: "Load older reservations", exact: true })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic older history unavailable",
  );
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await history
    .getByRole("button", { name: "Retry reservation history", exact: true })
    .click();
  await expect(history.getByRole("listitem")).toHaveCount(26);
  await expect(history).toContainText(
    "Synthetic reviewed release after deadline",
  );
  await expect(history).toContainText("Reservation deadline renewed");
  await page.unroute(older);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(history).toHaveCount(0);
  // Verify that navigation aborts the actual pending scoped history read.
  let finish!: () => void;
  let handled!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const done = new Promise<void>((resolve) => {
    handled = resolve;
  });
  await page.route(first, async () => {
    await held;
    handled();
  });
  const started = page.waitForRequest((r) =>
    r.url().endsWith(`/api/orders/${accepted.id}/reservations`),
  );
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (r) =>
      r.url().endsWith(`/api/orders/${accepted.id}/reservations`),
  });
  await opener.click();
  await started;
  await expect(history).toContainText("Loading reservation history…");
  await nav(page, "Overview");
  await aborted;
  finish();
  await done;
  await page.unroute(first);
  await nav(page, "Orders");
  await expect(history).toHaveCount(0);
  await opener.click();
  await expect(history.getByRole("listitem")).toHaveCount(20);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(history).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: phone checkout replacement reviews partial balance and retries a lost committed response exactly", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = async (p: Page, email: string) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login(page, "admin@example.test");
  const session = await (await page.request.get("/api/session")).json();
  const headers = {
    origin: "http://127.0.0.1:3117",
    "x-csrf-token": session.csrf,
  };
  const effects = () => page.request.get("/api/effects").then((r) => r.json());
  const original = (await effects()).find(
    (e: any) =>
      e.kind === "checkout" &&
      e.state === "completed" &&
      e.checkout?.currentBalance === 11300,
  );
  expect(original).toBeTruthy();
  // This isolated synthetic account is seeded by the existing native browser fixture.
  // Refresh observes expired/unpaid through its local adapter; no provider call occurs.
  const refreshed = await page.request.post(
    `/api/effects/${original.id}/refresh-checkout`,
    { headers },
  );
  expect(refreshed.ok(), await refreshed.text()).toBeTruthy();
  const paid = await page.request.post("/api/commands/billing.payment.manual", {
    headers: { ...headers, "idempotency-key": "phone-checkout-partial-bank" },
    data: {
      invoiceId: original.checkout.invoiceId,
      amount: 1300,
      reference: "PHONE-CHECKOUT-PARTIAL-BANK",
      reason: "Synthetic partial bank payment",
    },
  });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  await nav(page, "Billing");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const originalRow = page
    .getByRole("row")
    .filter({ hasText: "stripe · checkout" })
    .filter({ hasText: original.checkout.invoiceNumber });
  await expect(originalRow).toContainText("Current invoice balance: CA$100.00");
  await originalRow
    .getByRole("button", { name: "Close checkout link", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Close checkout link",
    exact: true,
  });
  await expect(dialog).toContainText(
    "buyer will no longer be able to use the old link",
  );
  await dialog.press("Escape");
  await expect(
    originalRow.getByRole("button", {
      name: "Close checkout link",
      exact: true,
    }),
  ).toBeFocused();
  const review = originalRow.getByRole("button", {
    name: "Review checkout replacement",
    exact: true,
  });
  await review.click();
  dialog = page.getByRole("dialog", {
    name: "Review checkout replacement",
    exact: true,
  });
  const reason = dialog.getByLabel(
    "Buyer-visible reason for checkout replacement",
    { exact: true },
  );
  await expect(reason).toBeFocused();
  await expect(dialog).toContainText("Original frozen amount: CA$113.00");
  await expect(dialog).toContainText("current invoice balance): CA$100.00");
  await expect(reason).toHaveAttribute("maxlength", "1000");
  await dialog.press("Escape");
  await expect(review).toBeFocused();
  await review.click();
  await reason.fill(
    "Synthetic partial payment: replace expired link for remaining balance",
  );
  const attempts: { key: string | undefined; payload: any }[] = [];
  let receipt: any;
  const path = "**/api/commands/stripe.checkout.renew";
  await page.route(path, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    const result = await response.json();
    if (attempts.length === 1) {
      receipt = result;
      await route.abort("failed");
    } else {
      expect(result).toEqual(receipt);
      await route.fulfill({ response });
    }
  });
  await dialog
    .getByRole("button", { name: "Prepare replacement checkout", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(reason).toHaveValue(
    "Synthetic partial payment: replace expired link for remaining balance",
  );
  await dialog
    .getByRole("button", { name: "Prepare replacement checkout", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.payload).toMatchObject({
    effectId: original.id,
    amount: 10000,
  });
  const retained = await effects();
  const predecessor = retained.find((e: any) => e.id === original.id);
  const successor = retained.find(
    (e: any) => e.reference === `renewal:${original.id}`,
  );
  expect(predecessor.checkout.state).toBe("superseded");
  expect(predecessor.checkout.amount).toBe(11300);
  expect(successor.id).not.toBe(original.id);
  expect(successor.state).toBe("pending");
  expect(successor.checkout.amount).toBe(10000);
  expect(successor.checkout.currentBalance).toBe(10000);
  expect(successor.checkout.replacementReason).toBe(
    attempts[0]!.payload.reason,
  );
  expect(
    retained.filter((e: any) => e.reference === `renewal:${original.id}`),
  ).toHaveLength(1);
  const rows = page
    .getByRole("row")
    .filter({ hasText: "stripe · checkout" })
    .filter({ hasText: original.checkout.invoiceNumber });
  const oldRow = rows.filter({ hasText: "Superseded checkout" });
  await expect(
    oldRow.getByRole("button", { name: "Send to provider", exact: true }),
  ).toHaveCount(0);
  await expect(
    oldRow.getByRole("button", { name: "Open secure checkout", exact: true }),
  ).toHaveCount(0);
  const newRow = rows.filter({ hasText: "Current checkout" });
  await expect(newRow).toContainText("Awaiting explicit provider send");
  await newRow
    .getByRole("button", { name: "Send to provider", exact: true })
    .click();
  await expect(
    newRow.getByRole("button", { name: "Open secure checkout", exact: true }),
  ).toBeVisible();
  await page.unroute(path);
  const buyerContext = await context.browser()!.newContext({
    baseURL: "http://127.0.0.1:3117",
    viewport: { width: 390, height: 844 },
  });
  try {
    const buyer = await buyerContext.newPage();
    await login(buyer, "checkout-buyer@example.test");
    await nav(buyer, "Billing");
    const buyerRows = buyer
      .getByRole("row")
      .filter({ hasText: "stripe · checkout" })
      .filter({ hasText: original.checkout.invoiceNumber });
    await expect(
      buyerRows
        .filter({ hasText: "Current checkout" })
        .getByRole("button", { name: "Open secure checkout", exact: true }),
    ).toBeVisible();
    await expect(buyerRows).toHaveCount(2);
    for (const name of [
      "Review checkout replacement",
      "Close checkout link",
      "Send to provider",
      "Refresh checkout status",
    ])
      await expect(
        buyerRows.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    await expect(
      buyerRows.filter({ hasText: "Current checkout" }),
    ).toContainText(attempts[0]!.payload.reason);
  } finally {
    await buyerContext.close();
  }
  expect(errors).toEqual([]);
});

test("browser: phone carrier review retries a lost committed prepare, cancels and replaces without stock or invoice changes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (p: Page, email: string) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    const response = p.waitForResponse(
      (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    const csrf = (await (await response).json()).csrf;
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    return csrf;
  };
  const csrf = await login(page, "admin@example.test");
  const allShipments = async () => {
    const items: any[] = [];
    let after: string | null = null;
    do {
      const response = await page.request.get(
        `/api/shipments/page${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      );
      expect(response.status()).toBe(200);
      const result: { items: any[]; next: string | null } =
        await response.json();
      items.push(...result.items);
      after = result.next;
    } while (after);
    return items;
  };
  const before = await stockFactsDashboard(page);
  before.shipments = await allShipments();
  const shipment = before.shipments.find((s: any) =>
    s.address.startsWith("Synthetic carrier destination,"),
  );
  expect(shipment.state).toBe("packed");
  const snapshot = (d: any) => ({
    stock: d.stock,
    order: d.orders.find((o: any) => o.id === shipment.order_id),
    invoices: d.invoices,
    shipment: d.shipments.find((s: any) => s.id === shipment.id),
  });
  const original = snapshot(before);
  const showCarrierRow = async (p: Page) => {
    await nav(p, "Orders");
    const panel = p.getByRole("region", {
      name: "Shipment history",
      exact: true,
    });
    const row = panel.getByRole("row").filter({ hasText: shipment.address });
    while (!(await row.count())) {
      const count = await panel.locator("tbody tr").count();
      const response = p.waitForResponse(
        (r) =>
          r.url().includes("/api/shipments/page?after=") &&
          r.request().method() === "GET",
      );
      await panel
        .getByRole("button", { name: "Load more shipments", exact: true })
        .click();
      const result = await (await response).json();
      await expect(panel.locator("tbody tr")).toHaveCount(
        count + result.items.length,
      );
    }
    return row;
  };
  const row = await showCarrierRow(page);
  await row
    .getByRole("button", { name: "Review carrier booking", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Carrier booking review",
    exact: true,
  });
  await expect(
    review.getByRole("heading", {
      name: "Carrier booking review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    review.getByText("Carrier send and reconciliation are disabled.", {
      exact: false,
    }),
  ).toBeVisible();
  const fill = async (service: string) => {
    await review
      .getByRole("combobox", { name: "Carrier provider", exact: true })
      .selectOption("ups");
    await review.getByLabel("Service", { exact: true }).fill(service);
    const fields = [
      ["Name", "Synthetic test contact"],
      ["Address line 1", "2 Test Street"],
      ["City", "Ottawa"],
      ["Province / state", "ON"],
      ["Postal / ZIP code", "K1A 0B1"],
      ["Phone", "4165550100"],
    ] as const;
    for (const legend of [
      "Reviewed warehouse origin",
      "Reviewed destination",
    ]) {
      const group = review.getByRole("group", { name: legend, exact: true });
      for (const [field, value] of fields)
        await group.getByLabel(field, { exact: true }).fill(value);
      await group
        .getByRole("combobox", { name: "Country", exact: true })
        .selectOption("CA");
    }
    for (const field of [
      "Weight (grams)",
      "Length (mm)",
      "Width (mm)",
      "Height (mm)",
    ])
      await review.getByLabel(field, { exact: true }).fill("100");
    await review.getByRole("checkbox").check();
    await review
      .getByLabel("Address review acknowledgment / evidence", { exact: true })
      .fill("Synthetic explicit origin, parcel and destination review");
  };
  await fill("Synthetic phone ground");
  const attempts: { key: string; payload: any }[] = [];
  let saved: any;
  await page.route("**/api/commands/carrier.prepare", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    saved = await response.json();
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await review
    .getByRole("button", { name: "Prepare reviewed booking", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText("Failed to fetch");
  await review
    .getByRole("button", { name: "Prepare reviewed booking", exact: true })
    .click();
  await expect(
    review.getByRole("heading", { name: "Current booking", exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute("**/api/commands/carrier.prepare");
  expect(saved.id).toBeTruthy();
  const first = (
    await (
      await page.request.get(`/api/shipments/${shipment.id}/carrier`)
    ).json()
  ).booking;
  expect(first.id).toBe(saved.id);
  expect(first.state).toBe("pending");
  await expect(
    review.getByRole("button", {
      name: "Send reviewed carrier booking",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/carrier/${first.id}/send`, {
        headers: { "x-csrf-token": csrf, origin: "http://127.0.0.1:3117" },
        data: {},
      })
    ).status(),
  ).toBe(503);
  await review
    .getByLabel("Cancellation reason", { exact: true })
    .fill("Synthetic phone cancellation before provider send");
  await review
    .getByRole("button", {
      name: "Cancel reviewed pending booking",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("This unsent booking was canceled.", { exact: false }),
  ).toBeVisible();
  await fill("Synthetic successor service");
  await review
    .getByRole("button", { name: "Prepare reviewed booking", exact: true })
    .click();
  await expect(
    review.getByRole("heading", { name: "Current booking", exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText("UPS · Synthetic successor service · pending", {
      exact: false,
    }),
  ).toBeVisible();
  const second = (
    await (
      await page.request.get(`/api/shipments/${shipment.id}/carrier`)
    ).json()
  ).booking;
  expect(second.id).not.toBe(first.id);
  expect(second.reviewHash).not.toBe(first.reviewHash);
  await review
    .getByRole("button", { name: "Load carrier booking history", exact: true })
    .click();
  await expect(review.getByText("Loaded: 2.", { exact: false })).toBeVisible();
  const history = (
    await (
      await page.request.get(`/api/shipments/${shipment.id}/carrier/history`)
    ).json()
  ).items;
  expect(history.map((b: any) => b.state)).toEqual(["canceled", "pending"]);
  await page.reload();
  await (
    await showCarrierRow(page)
  )
    .getByRole("button", { name: "Review carrier booking", exact: true })
    .click();
  await expect(
    review.getByText(`Booking ID: ${second.id}`, { exact: true }),
  ).toBeVisible();
  const after = await stockFactsDashboard(page);
  after.shipments = await allShipments();
  expect(snapshot(after)).toEqual(original);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const readerContext = await context
    .browser()!
    .newContext({ baseURL: "http://127.0.0.1:3117" });
  try {
    const reader = await readerContext.newPage();
    reader.on("pageerror", (e) => errors.push(e.message));
    await login(reader, "carrier-reader@example.test");
    expect(
      (
        await reader.request.get(`/api/shipments/${shipment.id}/carrier`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await reader.request.get(
          `/api/shipments/${shipment.id}/carrier/history`,
        )
      ).status(),
    ).toBe(403);
    const users = await (await page.request.get("/api/users")).json(),
      user = users.find((u: any) => u.email === "carrier-reader@example.test");
    const grant = await page.request.post("/api/commands/user.update", {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": "carrier-phone-grant",
        origin: "http://127.0.0.1:3117",
      },
      data: {
        userId: user.id,
        revision: user.revision,
        email: user.email,
        name: user.name,
        role: "warehouse",
        sites: [shipment.warehouse_id],
        active: true,
        currentPassword: "long-test-only-password",
        reason: "Synthetic reviewed grant for carrier warehouse",
      },
    });
    expect(grant.status()).toBe(200);
    await login(reader, "carrier-reader@example.test");
    const permitted = await reader.request.get(
      `/api/shipments/${shipment.id}/carrier`,
    );
    expect(permitted.status()).toBe(200);
    expect((await permitted.json()).booking.id).toBe(second.id);
    const permittedHistory = await reader.request.get(
      `/api/shipments/${shipment.id}/carrier/history`,
    );
    expect(permittedHistory.status()).toBe(200);
    expect((await permittedHistory.json()).items.map((b: any) => b.id)).toEqual(
      [first.id, second.id],
    );
    await (
      await showCarrierRow(reader)
    )
      .getByRole("button", { name: "Review carrier booking", exact: true })
      .click();
    await expect(
      reader
        .getByRole("region", { name: "Carrier booking review", exact: true })
        .getByText(`Booking ID: ${second.id}`, { exact: true }),
    ).toBeVisible();
  } finally {
    await readerContext.close();
  }
  expect(errors).toEqual([]);
});

test("browser: phone checkout history pages frozen observations, preserves retries and aborts scoped reads", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (
    p: Page,
    email: string,
    password = "long-test-only-password",
  ) => {
    await p.goto("/");
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login(page, "checkout-buyer@example.test");
  const effects = await (await page.request.get("/api/effects")).json();
  // When a prior journey prepared a successor, either generation reads the
  // same invoice-wide history; this assertion also runs after the full suite.
  for (const predecessor of effects.filter(
    (effect: any) => effect.checkout?.state === "superseded",
  )) {
    const successor = effects.find(
      (effect: any) =>
        effect.id !== predecessor.id &&
        effect.checkout?.invoiceId === predecessor.checkout.invoiceId,
    );
    expect(successor).toBeTruthy();
    const previous = await (
      await page.request.get(`/api/effects/${predecessor.id}/checkout/history`)
    ).json();
    const current = await (
      await page.request.get(`/api/effects/${successor.id}/checkout/history`)
    ).json();
    expect(previous).toEqual(current);
    expect(
      current.items.some((item: any) => item.effectId === predecessor.id),
    ).toBe(true);
  }
  let target: any;
  let first: any;
  for (const effect of effects) {
    const reply = await page.request.get(
      `/api/effects/${effect.id}/checkout/history`,
    );
    expect(reply.ok(), await reply.text()).toBeTruthy();
    const history = await reply.json();
    if (history.next) {
      target = effect;
      first = history;
      break;
    }
  }
  expect(target).toBeTruthy();
  expect(first.items).toHaveLength(20);
  const path = `/api/effects/${target.id}/checkout/history`;
  const older = await (
    await page.request.get(`${path}?after=${encodeURIComponent(first.next)}`)
  ).json();
  expect(older.items.length).toBeGreaterThan(0);
  const all = [...first.items, ...older.items];
  for (const item of all) {
    expect(Object.keys(item).sort()).toEqual(
      [
        "id",
        "effectId",
        "invoiceId",
        "observedAt",
        "source",
        "outcome",
        "reference",
        "amount",
        "currency",
        "status",
        "paymentStatus",
        "expiresAt",
      ].sort(),
    );
  }
  expect(JSON.stringify(all)).not.toMatch(
    /https:|checkoutUrl|actor_id|account_id|metadata/,
  );
  await nav(page, "Billing");
  const row = page
    .getByRole("row")
    .filter({ hasText: "stripe · checkout" })
    .filter({ hasText: target.checkout.invoiceNumber })
    .first();
  const opener = row.getByRole("button", {
    name: "View checkout history",
    exact: true,
  });
  await opener.click();
  const region = row.getByRole("region", {
    name: "Checkout history",
    exact: true,
  });
  await expect(
    region.getByRole("heading", { name: "Checkout history", exact: true }),
  ).toBeFocused();
  await expect(region.getByRole("listitem")).toHaveCount(20);
  await expect(region).toContainText(first.items[0].observedAt);
  await expect(region).toContainText(first.items[0].reference);
  await expect(region).toContainText(first.items[0].effectId);
  await expect(region).toContainText(first.items[0].currency);
  await expect(region).toContainText("Verified");
  await expect(region).toContainText(
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: first.items[0].currency,
    }).format(first.items[0].amount / 100),
  );
  await expect(region).toContainText(first.items[0].status);
  await expect(region).toContainText(first.items[0].paymentStatus);
  await expect(region.getByText("refresh", { exact: true })).toHaveCount(20);
  expect(await region.getByRole("link").count()).toBe(0);
  expect(await region.innerText()).not.toMatch(/https:|checkout\.stripe\.com/);
  const pattern = `**${path}*`;
  let fail = true;
  await page.route(pattern, async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic history interruption" },
      });
    } else await route.continue();
  });
  await region
    .getByRole("button", {
      name: "Load older checkout observations",
      exact: true,
    })
    .click();
  await expect(region.getByRole("alert")).toContainText(
    "Synthetic history interruption",
  );
  await expect(region.getByRole("listitem")).toHaveCount(20);
  const continued = page.waitForRequest((r) =>
    r.url().includes(`${path}?after=`),
  );
  await region
    .getByRole("button", { name: "Retry checkout history", exact: true })
    .click();
  expect(new URL((await continued).url()).searchParams.get("after")).toBe(
    first.next,
  );
  await expect(region.getByRole("listitem")).toHaveCount(all.length);
  fail = true;
  await region
    .getByRole("button", { name: "Reload checkout history", exact: true })
    .click();
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByRole("listitem")).toHaveCount(all.length);
  const reloaded = page.waitForRequest((r) => r.url().endsWith(path));
  await region
    .getByRole("button", { name: "Retry checkout history", exact: true })
    .click();
  await reloaded;
  await expect(region.getByRole("listitem")).toHaveCount(20);
  await page.unroute(pattern);
  // Whitelisted partial/unverified and not-found snapshots render without inferred status.
  await page.route(pattern, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...first.items[0],
            id: "synthetic-unverified",
            effectId: "previous-checkout-generation",
            outcome: "unverified",
            reference: null,
            status: null,
            paymentStatus: null,
            expiresAt: null,
          },
          {
            ...first.items[0],
            id: "synthetic-not-found",
            outcome: "not_found",
            reference: null,
            status: null,
            paymentStatus: null,
            expiresAt: null,
          },
        ],
        next: null,
      },
    }),
  );
  await region
    .getByRole("button", { name: "Reload checkout history", exact: true })
    .click();
  await expect(region.getByRole("listitem")).toHaveCount(2);
  await expect(region).toContainText("Unverified");
  await expect(region).toContainText("Not found");
  await expect(region).toContainText("previous-checkout-generation");
  await expect(
    region
      .getByRole("listitem")
      .first()
      .getByText("Unavailable", { exact: true }),
  ).toHaveCount(4);
  expect(await region.getByRole("link").count()).toBe(0);
  await page.unroute(pattern);
  await page.route(pattern, (route) =>
    route.fulfill({ json: { items: [], next: null } }),
  );
  await region
    .getByRole("button", { name: "Reload checkout history", exact: true })
    .click();
  await expect(region).toContainText(
    "No retained checkout observations. Older observations were not backfilled.",
  );
  await page.unroute(pattern);
  await region
    .getByRole("button", { name: "Close checkout history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await expect(region).toHaveCount(0);

  // Every exit aborts its pending browser fetch and late responses cannot restore it.
  for (const exit of ["close", "revision", "navigation", "signout"] as const) {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let handled!: () => void;
    const done = new Promise<void>((resolve) => {
      handled = resolve;
    });
    await page.route(pattern, async () => {
      await held;
      handled();
    });
    const started = page.waitForRequest((r) => r.url().endsWith(path));
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().endsWith(path),
    });
    await opener.click();
    await started;
    if (exit === "close")
      await region
        .getByRole("button", { name: "Close checkout history", exact: true })
        .click();
    else if (exit === "revision") {
      await page.route("**/api/effects", async (route) => {
        const response = await route.fetch();
        const current = await response.json();
        await route.fulfill({
          response,
          json: current.map((effect: any) =>
            effect.id === target.id
              ? {
                  ...effect,
                  checkout: {
                    ...effect.checkout,
                    reviewVersion: "synthetic-new-review",
                  },
                }
              : effect,
          ),
        });
      });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    } else if (exit === "navigation") await nav(page, "Overview");
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await aborted;
    finish();
    await done;
    await page.unroute(pattern);
    if (exit === "revision") await page.unroute("**/api/effects");
    await expect(
      page.getByRole("region", { name: "Checkout history", exact: true }),
    ).toHaveCount(0);
    if (exit === "navigation") await nav(page, "Billing");
  }
  const foreignContext = await context
    .browser()!
    .newContext({ baseURL: "http://127.0.0.1:3117" });
  try {
    const foreign = await foreignContext.newPage();
    await login(
      foreign,
      "refund-buyer@example.test",
      "long-notice-test-password",
    );
    const denied = await foreign.request.get(
      `${path}?after=${encodeURIComponent(first.next)}`,
    );
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain(first.items[0].reference);
  } finally {
    await foreignContext.close();
  }
  expect(errors).toEqual([]);
});

test("browser: cash refund pages and on-demand history retain failed pages and cancel closed, refreshed or signed-out reads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [],
    historyReads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/api\/billing\/refunds\/[^/]+\/observations/.test(r.url()))
      historyReads.push(r.url());
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Billing");
  const refunds = page.getByRole("region", {
    name: "Cash refunds",
    exact: true,
  });
  await expect(refunds.getByRole("status").first()).toHaveText(
    "20 refunds loaded",
  );
  expect(historyReads).toHaveLength(0);
  const initial = await (
    await page.request.get("/api/billing/refunds/page")
  ).json();
  let pageFailure = true;
  await page.route("**/api/billing/refunds/page?after=*", async (route) => {
    if (pageFailure) {
      pageFailure = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic older refund read failed" }),
      });
    } else await route.continue();
  });
  await refunds
    .getByRole("button", { name: "Load older refunds", exact: true })
    .click();
  await expect(refunds.getByRole("alert")).toContainText(
    "Synthetic older refund read failed",
  );
  await expect(refunds.getByRole("status").first()).toHaveText(
    "20 refunds loaded",
  );
  await refunds
    .getByRole("button", { name: "Retry older refunds", exact: true })
    .click();
  const next = await (
    await page.request.get(`/api/billing/refunds/page?after=${initial.next}`)
  ).json();
  await expect(refunds.getByRole("status").first()).toHaveText(
    `${20 + next.items.length} refunds loaded`,
  );
  while (
    await refunds
      .getByRole("button", { name: "Load older refunds", exact: true })
      .count()
  )
    await refunds
      .getByRole("button", { name: "Load older refunds", exact: true })
      .click();
  const target = refunds.getByRole("row").filter({
    has: page.getByRole("cell", { name: "NOTICE-REF-26", exact: true }),
  });
  const opener = target.getByRole("button", {
    name: "View refund history",
    exact: true,
  });
  const allRefunds = await (
    await page.request.get("/api/billing/refunds")
  ).json();
  const observationCount = allRefunds.find(
    (r: any) => r.reference === "NOTICE-REF-26",
  ).observations.length;
  expect(observationCount).toBeGreaterThanOrEqual(27);
  let failure = true;
  await page.route(
    "**/api/billing/refunds/*/observations?after=*",
    async (route) => {
      if (failure) {
        failure = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Synthetic older observation read failed",
          }),
        });
      } else await route.continue();
    },
  );
  await page.route(
    "**/api/billing/refunds/*/observations",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Synthetic initial history read failed",
        }),
      }),
    { times: 1 },
  );
  await opener.click();
  const history = page.getByRole("region", {
    name: "Refund provider history",
    exact: true,
  });
  await expect(history.getByRole("heading")).toBeFocused();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic initial history read failed",
  );
  await expect(history.getByRole("status")).toHaveText("0 observations loaded");
  await history
    .getByRole("button", { name: "Retry refund observations", exact: true })
    .click();
  await expect(history.getByRole("status")).toHaveText(
    "20 observations loaded",
  );
  await history
    .getByRole("button", {
      name: "Load older refund observations",
      exact: true,
    })
    .click();
  await expect(history.getByRole("alert")).toContainText(
    "Synthetic older observation read failed",
  );
  await expect(history.getByRole("status")).toHaveText(
    "20 observations loaded",
  );
  await history
    .getByRole("button", { name: "Retry refund observations", exact: true })
    .click();
  await expect(history.getByRole("status")).toHaveText(
    `${observationCount} observations loaded`,
  );
  await expect(history.getByRole("heading")).toBeFocused();
  await expect(
    history.getByRole("button", {
      name: "Load older refund observations",
      exact: true,
    }),
  ).toHaveCount(0);
  await history
    .getByRole("button", { name: "Close refund history", exact: true })
    .click();
  await expect(opener).toBeFocused();
  await expect(history).toHaveCount(0);
  const firstRefund = refunds
    .getByRole("button", { name: "View refund history", exact: true })
    .first();
  // Await an intercepted actual read before closing; release only after the UI unmount.
  for (const action of ["close", "navigate", "refresh", "signout"] as const) {
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/billing/refunds/*/observations", async (route) => {
      const response = await route.fetch();
      entered();
      await paused;
      try {
        await route.fulfill({ response });
      } catch {
        /* Cancellation is expected after unmount. */
      }
    });
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        /\/api\/billing\/refunds\/[^/]+\/observations$/.test(request.url()),
    });
    await firstRefund.click();
    await reading;
    await expect(history.getByRole("status")).toHaveText(
      "0 observations loaded · Loading…",
    );
    if (action === "close")
      await history
        .getByRole("button", { name: "Close refund history", exact: true })
        .click();
    if (action === "navigate") await nav(page, "Overview");
    if (action === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (action === "signout")
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(history).toHaveCount(0);
    await aborted;
    release();
    await page.unroute("**/api/billing/refunds/*/observations");
    if (action === "navigate") await nav(page, "Billing");
    if (action !== "signout") await expect(refunds).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(history).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("refund-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-notice-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const ownRefundId = initial.items[0].id;
  expect((await page.request.get("/api/billing/refunds/page")).status()).toBe(
    403,
  );
  expect(
    (
      await page.request.get(`/api/billing/refunds/${ownRefundId}/observations`)
    ).status(),
  ).toBe(403);
  await nav(page, "Billing");
  await expect(refunds).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: required role MFA blocks workspace, retries and cancels setup reads, survives reload and prevents removal", async ({
  page,
}) => {
  const email = "required-mfa@example.test",
    password = "long-required-mfa-password",
    errors: string[] = [],
    workspaceReads: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/api\/(dashboard|users|stock)(?:\?|$)/.test(r.url()))
      workspaceReads.push(r.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const login = async () => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await page.route(
    "**/api/security",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic setup read failed" }),
      }),
    { times: 1 },
  );
  await login();
  const heading = page.getByRole("heading", {
      name: "Set up your authenticator",
      exact: true,
    }),
    panel = page.getByRole("region", { name: "Authenticator security" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic setup read failed",
  );
  await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(
    0,
  );
  expect(workspaceReads).toEqual([]);
  expect((await page.request.get("/api/dashboard")).status()).toBe(403);
  await page
    .getByRole("button", { name: "Retry security setup", exact: true })
    .click();
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(panel).toBeVisible();
  expect(workspaceReads).toEqual([]);
  // Signing out must abort a pending security read and never restore its response.
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => (entered = resolve)),
    paused = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/security", async (route) => {
    const response = await route.fetch();
    entered();
    await paused;
    try {
      await route.fulfill({ response });
    } catch {
      /* The request was canceled by sign-out. */
    }
  });
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().endsWith("/api/security"),
  });
  await page.reload();
  await reading;
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await aborted;
  release();
  await page.unroute("**/api/security");
  await expect(panel).toHaveCount(0);
  await login();
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await panel.getByLabel("Authenticator setup key").inputValue();
  const codes = await panel
    .getByRole("list", { name: "Recovery codes" })
    .locator("code")
    .allTextContents();
  expect(codes).toHaveLength(10);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const value of [password, secret, ...codes])
    expect(stored).not.toContain(value);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel.getByLabel("I saved my recovery codes securely").check();
  await panel
    .getByLabel("Authenticator or recovery code")
    .fill(totp(secret, Math.floor(Date.now() / 30000)));
  await panel
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  expect(workspaceReads).toEqual([]);
  await login();
  await expect(
    page.getByLabel("Authenticator or recovery code", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(codes[0]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  await expect(panel.getByRole("status")).toHaveText(
    "Your role requires an authenticator. Removal is unavailable.",
  );
  await expect(
    panel.getByRole("button", { name: "Remove authenticator", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: required MFA recovery renewal keeps the factor, cancels stale responses, expires secrets and recovers lost responses on a phone", async ({
  page,
}) => {
  const email = "renewal-mfa@example.test",
    password = "long-renewal-mfa-password",
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const login = async (code?: string) => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (code) {
      await page
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(code);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
  };
  await login();
  const panel = page.getByRole("region", { name: "Authenticator security" });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await panel.getByLabel("Authenticator setup key").inputValue(),
    old = await panel
      .getByRole("list", { name: "Recovery codes", exact: true })
      .locator("code")
      .allTextContents();
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByLabel("I saved my recovery codes securely", { exact: true })
    .check();
  await panel
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(totp(secret, Math.floor(Date.now() / 30000)));
  await panel
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await login(old[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  const renewal = page.getByRole("region", {
      name: "Replace recovery codes",
      exact: true,
    }),
    newCodes = renewal.getByRole("list", {
      name: "New recovery codes",
      exact: true,
    }),
    prepare = renewal.getByRole("button", {
      name: "Prepare replacement codes",
      exact: true,
    });
  await expect(renewal).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Remove authenticator", exact: true }),
  ).toHaveCount(0);
  // Cancel a response whose preparation already committed; it cannot resurrect secrets.
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((r) => (entered = r)),
    paused = new Promise<void>((r) => (release = r));
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      const response = await route.fetch();
      entered();
      await paused;
      try {
        await route.fulfill({ response });
      } catch {}
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await reading;
  await renewal
    .getByRole("button", { name: "Cancel replacement", exact: true })
    .click();
  release();
  await expect(newCodes).toHaveCount(0);
  await expect(prepare).toBeEnabled();
  // Sign-out unmounts the renewal panel and fences a committed late response.
  const signedOutRead = new Promise<void>((r) => (entered = r)),
    signedOutPause = new Promise<void>((r) => (release = r));
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      const response = await route.fetch();
      entered();
      await signedOutPause;
      try {
        await route.fulfill({ response });
      } catch {}
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await signedOutRead;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(newCodes).toHaveCount(0);
  await login(old[1]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  // Synthetic browser deadline verifies clearing; server expiry is independently checked in backend tests.
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      const response = await route.fetch(),
        result = await response.json();
      await route.fulfill({
        response,
        json: { ...result, expiresAt: Date.now() + 150 },
      });
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toContainText("Replacement expired");
  await expect(newCodes).toHaveCount(0);
  await expect(
    renewal.getByLabel("Current password for recovery codes"),
  ).toHaveValue("");
  // A response already expired at arrival is never displayed.
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      const response = await route.fetch(),
        result = await response.json();
      await route.fulfill({
        response,
        json: { ...result, expiresAt: Date.now() - 1 },
      });
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toContainText("Replacement expired");
  await expect(newCodes).toHaveCount(0);
  await expect(
    renewal.getByLabel("Current password for recovery codes"),
  ).toHaveValue("");
  let delivered: string[] = [],
    retryKey = "";
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      retryKey = route.request().postDataJSON().key;
      const response = await route.fetch();
      delivered = (await response.json()).recoveryCodes;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toBeVisible();
  let retried = "";
  await page.route(
    "**/api/security/mfa/recovery/prepare",
    async (route) => {
      retried = route.request().postDataJSON().key;
      await route.continue();
    },
    { times: 1 },
  );
  await prepare.click();
  await expect(newCodes).toBeVisible();
  const codes = await newCodes.locator("code").allTextContents();
  expect(codes).toEqual(delivered);
  expect(retried).toBe(retryKey);
  expect(codes).toHaveLength(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const value of [password, secret, ...codes])
    expect(stored).not.toContain(value);
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await renewal
    .getByLabel("Existing authenticator or recovery code")
    .fill(old[2]!);
  // The native required checkbox prevents an unacknowledged activation.
  let confirms = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/security/mfa/recovery/confirm")) confirms++;
  });
  await renewal
    .getByRole("button", { name: "Confirm replacement codes", exact: true })
    .click();
  expect(confirms).toBe(0);
  await expect(newCodes).toBeVisible();
  await renewal
    .getByLabel("I saved my new recovery codes securely", { exact: true })
    .check();
  await page.route(
    "**/api/security/mfa/recovery/confirm",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await renewal
    .getByRole("button", { name: "Confirm replacement codes", exact: true })
    .click();
  await expect(renewal.getByRole("alert")).toBeVisible();
  expect((await page.request.get("/api/security")).status()).toBe(401);
  await login(codes[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  await expect(
    panel.getByRole("button", { name: "Remove authenticator", exact: true }),
  ).toHaveCount(0);
  await expect(newCodes).toHaveCount(0);
  // A delivered confirmation clears every secret and returns to sign-in.
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await prepare.click();
  await expect(newCodes).toBeVisible();
  const finalCodes = await newCodes.locator("code").allTextContents();
  await renewal
    .getByLabel("Current password for recovery codes")
    .fill(password);
  await renewal
    .getByLabel("Existing authenticator or recovery code")
    .fill(codes[1]!);
  await renewal
    .getByLabel("I saved my new recovery codes securely", { exact: true })
    .check();
  await renewal
    .getByRole("button", { name: "Confirm replacement codes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Recovery codes replaced.", { exact: false }),
  ).toBeVisible();
  await expect(newCodes).toHaveCount(0);
  await login(finalCodes[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  expect(errors).toEqual([]);
});

test("browser: required MFA authenticator replacement verifies both factors, cancels stale responses, expires secrets and recovers lost responses on a phone", async ({
  page,
}) => {
  const email = "replacement-mfa@example.test",
    password = "long-replacement-mfa-password",
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const login = async (code?: string) => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (code) {
      await page
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(code);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
  };
  await login();
  const panel = page.getByRole("region", { name: "Authenticator security" });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await panel.getByLabel("Authenticator setup key").inputValue(),
    old = await panel
      .getByRole("list", { name: "Recovery codes", exact: true })
      .locator("code")
      .allTextContents();
  await panel
    .getByLabel("Current password for authenticator", { exact: true })
    .fill(password);
  await panel
    .getByLabel("I saved my recovery codes securely", { exact: true })
    .check();
  await panel
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(totp(secret, Math.floor(Date.now() / 30000)));
  await panel
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await login(old[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  const renewal = page.getByRole("region", {
      name: "Replace authenticator",
      exact: true,
    }),
    newCodes = renewal.getByRole("list", {
      name: "New recovery codes",
      exact: true,
    }),
    prepare = renewal.getByRole("button", {
      name: "Prepare new authenticator",
      exact: true,
    });
  await expect(renewal).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Remove authenticator", exact: true }),
  ).toHaveCount(0);
  // Cancel a response whose preparation already committed; it cannot resurrect secrets.
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((r) => (entered = r)),
    paused = new Promise<void>((r) => (release = r));
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      const response = await route.fetch();
      entered();
      await paused;
      try {
        await route.fulfill({ response });
      } catch {}
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await reading;
  await renewal
    .getByRole("button", {
      name: "Cancel authenticator replacement",
      exact: true,
    })
    .click();
  release();
  await expect(newCodes).toHaveCount(0);
  await expect(prepare).toBeEnabled();
  // Sign-out unmounts the renewal panel and fences a committed late response.
  const signedOutRead = new Promise<void>((r) => (entered = r)),
    signedOutPause = new Promise<void>((r) => (release = r));
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      const response = await route.fetch();
      entered();
      await signedOutPause;
      try {
        await route.fulfill({ response });
      } catch {}
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await signedOutRead;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(newCodes).toHaveCount(0);
  await login(old[1]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  // Synthetic browser deadline verifies clearing; server expiry is independently checked in backend tests.
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      const response = await route.fetch(),
        result = await response.json();
      await route.fulfill({
        response,
        json: { ...result, expiresAt: Date.now() + 150 },
      });
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toContainText("Replacement expired");
  await expect(newCodes).toHaveCount(0);
  await expect(
    renewal.getByLabel("Current password for authenticator replacement"),
  ).toHaveValue("");
  // A response already expired at arrival is never displayed.
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      const response = await route.fetch(),
        result = await response.json();
      await route.fulfill({
        response,
        json: { ...result, expiresAt: Date.now() - 1 },
      });
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toContainText("Replacement expired");
  await expect(newCodes).toHaveCount(0);
  await expect(
    renewal.getByLabel("Current password for authenticator replacement"),
  ).toHaveValue("");
  let delivered: string[] = [],
    retryKey = "",
    deliveredSecret = "";
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      retryKey = route.request().postDataJSON().key;
      const response = await route.fetch();
      const result = await response.json();
      delivered = result.recoveryCodes;
      deliveredSecret = result.secret;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await expect(renewal.getByRole("alert")).toBeVisible();
  let retried = "";
  await page.route(
    "**/api/security/mfa/replacement/prepare",
    async (route) => {
      retried = route.request().postDataJSON().key;
      await route.continue();
    },
    { times: 1 },
  );
  await prepare.click();
  await expect(newCodes).toBeVisible();
  const codes = await newCodes.locator("code").allTextContents();
  expect(codes).toEqual(delivered);
  const replacementSecret = await renewal
    .getByLabel("New authenticator setup key")
    .inputValue();
  expect(replacementSecret).toBe(deliveredSecret);
  expect(retried).toBe(retryKey);
  expect(codes).toHaveLength(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const value of [password, secret, replacementSecret, ...codes])
    expect(stored).not.toContain(value);
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await renewal
    .getByLabel("Existing authenticator or recovery code")
    .fill(old[2]!);
  await renewal
    .getByLabel("Code from new authenticator")
    .fill(totp(replacementSecret, Math.floor(Date.now() / 30000)));
  // The native required checkbox prevents an unacknowledged activation.
  let confirms = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/security/mfa/replacement/confirm")) confirms++;
  });
  await renewal
    .getByRole("button", { name: "Confirm new authenticator", exact: true })
    .click();
  expect(confirms).toBe(0);
  await expect(newCodes).toBeVisible();
  await renewal
    .getByLabel("I saved my new recovery codes securely", { exact: true })
    .check();
  await page.route(
    "**/api/security/mfa/replacement/confirm",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await renewal
    .getByRole("button", { name: "Confirm new authenticator", exact: true })
    .click();
  await expect(renewal.getByRole("alert")).toBeVisible();
  expect((await page.request.get("/api/security")).status()).toBe(401);
  await login(old[3]);
  await expect(page.getByRole("alert")).toContainText("Code is invalid");
  await login(codes[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  await expect(
    panel.getByRole("button", { name: "Remove authenticator", exact: true }),
  ).toHaveCount(0);
  await expect(newCodes).toHaveCount(0);
  // A delivered confirmation clears every secret and returns to sign-in.
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await prepare.click();
  await expect(newCodes).toBeVisible();
  const finalCodes = await newCodes.locator("code").allTextContents();
  const finalSecret = await renewal
    .getByLabel("New authenticator setup key")
    .inputValue();
  await renewal
    .getByLabel("Current password for authenticator replacement")
    .fill(password);
  await renewal
    .getByLabel("Existing authenticator or recovery code")
    .fill(codes[1]!);
  await renewal
    .getByLabel("Code from new authenticator")
    .fill(totp(finalSecret, Math.floor(Date.now() / 30000)));
  await renewal
    .getByLabel("I saved my new recovery codes securely", { exact: true })
    .check();
  await renewal
    .getByRole("button", { name: "Confirm new authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Authenticator replaced.", { exact: false }),
  ).toBeVisible();
  await expect(newCodes).toHaveCount(0);
  await login(finalCodes[0]);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Security");
  await expect(panel).toContainText("9 unused recovery codes");
  expect(errors).toEqual([]);
});

test("browser: recorded payment pages preserve USD without dashboard invoices, retry and cancel reads", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3118",
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const login = async (email: string) => {
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login("admin@example.test");
  const initialResponse = await page.request.get(
    origin + "/api/billing/payments/page",
  );
  expect(initialResponse.status()).toBe(200);
  const initial = await initialResponse.json();
  expect(initial.items).toHaveLength(20);
  expect(initial.items.every((p: any) => p.currency === "USD")).toBe(true);
  const before = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  const paymentsBefore = await (
    await page.request.get(origin + "/api/billing/payments")
  ).json();
  // Remove every dashboard invoice to exercise the summary's original invoice facts.
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch(),
      dashboard = await response.json();
    await route.fulfill({ response, json: { ...dashboard, invoices: [] } });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await nav(page, "Billing");
  const payments = page.getByRole("region", {
    name: "Recorded cash payments",
    exact: true,
  });
  await expect(payments.getByRole("status")).toHaveText("20 payments loaded");
  const firstRow = payments.getByRole("row").filter({
    has: page.getByRole("cell", {
      name: `manual · ${initial.items[0].external_ref}`,
      exact: true,
    }),
  });
  await expect(firstRow).toContainText(initial.items[0].invoiceNumber);
  await expect(
    firstRow.getByRole("cell", { name: "$0.01", exact: true }),
  ).toBeVisible();
  await firstRow
    .getByRole("button", { name: "Queue QuickBooks payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Queue QuickBooks payment",
    exact: true,
  });
  await expect(dialog).toContainText(`Record $0.01 already received`);
  await expect(dialog).toContainText(initial.items[0].invoiceNumber);
  await expect(dialog).not.toContainText("CA$");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  let fail = true;
  await page.route("**/api/billing/payments/page?after=*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Synthetic older payment read failed",
        }),
      });
    } else await route.continue();
  });
  await payments
    .getByRole("button", { name: "Load older payments", exact: true })
    .click();
  await expect(payments.getByRole("alert")).toContainText(
    "Synthetic older payment read failed",
  );
  await expect(payments.getByRole("status")).toHaveText("20 payments loaded");
  await payments
    .getByRole("button", { name: "Retry older payments", exact: true })
    .click();
  await expect(payments.getByRole("status")).toHaveText("40 payments loaded");
  await payments
    .getByRole("button", { name: "Load older payments", exact: true })
    .click();
  await expect(payments.getByRole("status")).toHaveText("43 payments loaded");
  await expect(payments.getByRole("heading")).toBeFocused();
  await expect(
    payments.getByRole("button", { name: "Load older payments", exact: true }),
  ).toHaveCount(0);
  const displayed = await payments
    .locator("tbody tr td:nth-child(3)")
    .allTextContents();
  expect(new Set(displayed).size).toBe(43);
  expect(displayed.every((text) => text.includes("SYNTHETIC-USD-PAGE-"))).toBe(
    true,
  );
  await page.unroute("**/api/billing/payments/page?after=*");
  for (const action of ["navigate", "refresh", "signout"] as const) {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(payments.getByRole("status")).toHaveText("20 payments loaded");
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => (entered = resolve)),
      paused = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/billing/payments/page?after=*", async (route) => {
      const response = await route.fetch();
      entered();
      await paused;
      try {
        await route.fulfill({ response });
      } catch {
        /* Expected cancellation after unmount. */
      }
    });
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        request.url().includes("/api/billing/payments/page?after="),
    });
    await payments
      .getByRole("button", { name: "Load older payments", exact: true })
      .click();
    await reading;
    await expect(payments.getByRole("status")).toHaveText(
      "20 payments loaded · Loading…",
    );
    if (action === "navigate") await nav(page, "Overview");
    if (action === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (action === "signout")
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await aborted;
    release();
    await page.unroute("**/api/billing/payments/page?after=*");
    if (action === "navigate") await nav(page, "Billing");
    if (action !== "signout")
      await expect(payments.getByRole("status")).toHaveText(
        "20 payments loaded",
      );
  }
  await expect(payments).toHaveCount(0);
  await page.unroute("**/api/dashboard");
  await login("admin@example.test");
  const after = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  for (const key of ["invoices", "stock", "orders", "accounts"])
    expect(after[key]).toEqual(before[key]);
  expect(
    await (await page.request.get(origin + "/api/billing/payments")).json(),
  ).toEqual(paymentsBefore);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("payment-pages-buyer@example.test");
  expect(
    (await page.request.get(origin + "/api/billing/payments/page")).status(),
  ).toBe(403);
  await nav(page, "Billing");
  await expect(payments).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: invoice refund payment selection pages, retries and cancels before reserving original cash", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3118",
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, data: any) => {
    const csrf = (
      await (await page.request.get(origin + "/api/session")).json()
    ).csrf;
    const response = await page.request.post(origin + `/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin,
      },
      data,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const initial = await (
    await page.request.get(origin + "/api/billing/payments/page")
  ).json();
  const invoiceId = initial.items[0].invoice_id;
  const dashboard = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  const invoice = dashboard.invoices.find((i: any) => i.id === invoiceId);
  await cmd("billing.credit", {
    invoiceId,
    reference: "SYNTHETIC-PAGED-REFUND-CREDIT",
    reason: "Synthetic selection qualification",
    lines: [{ lineId: invoice.lines[0].id, quantity: 1 }],
  });
  const before = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  const beforePayments = await (
    await page.request.get(origin + "/api/billing/payments")
  ).json();
  const endpoint = origin + `/api/billing/invoices/${invoiceId}/payments/page`;
  const first = await (await page.request.get(endpoint)).json();
  const middle = await (
    await page.request.get(endpoint + "?after=" + first.next)
  ).json();
  const last = await (
    await page.request.get(endpoint + "?after=" + middle.next)
  ).json();
  expect(last.items).toHaveLength(3);
  const target = last.items[2];
  await page.reload();
  await nav(page, "Billing");
  const invoiceRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: invoice.number, exact: false }),
    })
    .filter({
      has: page.getByRole("button", { name: "Request refund", exact: true }),
    });
  const open = async () => {
    await invoiceRow
      .getByRole("button", { name: "Request refund", exact: true })
      .click();
  };
  const dialog = page.getByRole("dialog", {
    name: "Request credited cash refund",
    exact: true,
  });
  await open();
  await expect(dialog.getByRole("status")).toHaveText(
    "20 invoice payments loaded",
  );
  const selector = dialog.getByLabel("Original payment", { exact: true });
  await expect(selector).toHaveValue(first.items[0].id);
  let failed = false;
  const pagePattern = "**/api/billing/invoices/*/payments/page?after=*";
  await page.route(pagePattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic invoice payment read failed" },
      });
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Load older invoice payments", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic invoice payment read failed",
  );
  await expect(selector).toHaveValue(first.items[0].id);
  await expect(selector.getByRole("option")).toHaveCount(21);
  await dialog
    .getByRole("button", { name: "Retry invoice payments", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "40 invoice payments loaded",
  );
  await selector.selectOption(middle.items[5].id);
  await dialog
    .getByRole("button", { name: "Load older invoice payments", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "43 invoice payments loaded",
  );
  await expect(selector).toHaveValue(middle.items[5].id);
  await expect(selector).toBeFocused();
  await selector.selectOption(target.id);
  await expect(selector.getByRole("option", { selected: true })).toContainText(
    target.external_ref,
  );
  await expect(selector.getByRole("option", { selected: true })).toContainText(
    "$0.01",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Load older invoice payments",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.unroute(pagePattern);
  // The dialog owns the first read as well as its continuation.
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => (entered = resolve)),
    paused = new Promise<void>((resolve) => (release = resolve));
  const firstPattern = "**/api/billing/invoices/*/payments/page";
  await page.route(firstPattern, async (route) => {
    const response = await route.fetch();
    entered();
    await paused;
    try {
      await route.fulfill({ response });
    } catch {
      /* Expected cancellation after close. */
    }
  });
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url() === endpoint,
  });
  await open();
  await reading;
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await aborted;
  release();
  await page.unroute(firstPattern);
  expect(
    await (await page.request.get(origin + "/api/dashboard")).json(),
  ).toEqual(before);
  expect(
    await (await page.request.get(origin + "/api/billing/payments")).json(),
  ).toEqual(beforePayments);
  await open();
  await expect(dialog.getByRole("status")).toHaveText(
    "20 invoice payments loaded",
  );
  await dialog
    .getByRole("button", { name: "Load older invoice payments", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "40 invoice payments loaded",
  );
  await dialog
    .getByRole("button", { name: "Load older invoice payments", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "43 invoice payments loaded",
  );
  await selector.selectOption(target.id);
  await dialog.getByLabel("Amount in cents", { exact: true }).fill("1");
  await dialog
    .getByLabel("Unique refund reference", { exact: true })
    .fill("SYNTHETIC-OLDER-PAYMENT-REFUND");
  await dialog
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Synthetic original payment selection");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const refunds = await (
    await page.request.get(origin + "/api/billing/refunds")
  ).json();
  const refund = refunds.find(
    (r: any) => r.reference === "SYNTHETIC-OLDER-PAYMENT-REFUND",
  );
  expect(refund.payment_id).toBe(target.id);
  expect(refund.amount).toBe(1);
  expect(refund.state).toBe("pending");
  const after = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  for (const key of ["invoices", "stock", "orders"])
    expect(after[key]).toEqual(before[key]);
  expect(
    await (await page.request.get(origin + "/api/billing/payments")).json(),
  ).toEqual(beforePayments);
  expect(errors).toEqual([]);
});

test("browser: sold coverage is on demand, retries, clears serial changes, cancels exits and shows buyer provisional dates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (email: string, password = "long-test-only-password") => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const reply = page.waitForResponse(
      (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const csrf = (await (await reply).json()).csrf;
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    return csrf;
  };
  const csrf = await login("admin@example.test");
  const cmd = async (name: string, payload: unknown) => {
    const r = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const account = await cmd("account.create", {
    name: "Coverage browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "COVERAGE-BROWSER",
    name: "Coverage browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await (await page.request.get("/api/dashboard")).json(),
    warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const afterPurchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: afterPurchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "COV-DEL",
    quantity: 2,
    serials: ["COV-S1", "COV-S2"],
    bin: "A",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const current = await (await page.request.get("/api/dashboard")).json();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: current.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic coverage handover",
  });
  await cmd("user.create", {
    currentPassword: "long-test-only-password",
    name: "Coverage buyer",
    email: "coverage-browser@example.test",
    password: "long-user-test-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
  });
  const reads: string[] = [];
  const pattern = "**/api/warranty/sold-units/*/coverage?*";
  page.on("request", (r) => {
    if (r.url().includes("/coverage?")) reads.push(r.url());
  });
  const opener = page.getByRole("button", {
    name: "Check sold serial coverage",
    exact: true,
  });
  const panel = page.getByRole("region", {
    name: "Sold serial coverage",
    exact: true,
  });
  const select = panel.getByLabel("Sold serial for coverage", { exact: true });
  const check = panel.getByRole("button", {
    name: "Check coverage dates",
    exact: true,
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await nav(page, "Returns");
  expect(reads).toEqual([]);
  await opener.click();
  await expect(panel.getByRole("heading")).toBeFocused();
  await expect(check).toBeDisabled();
  await panel.getByLabel("Search sold serials").fill("COV-");
  await panel
    .getByRole("button", { name: "Search serials", exact: true })
    .click();
  await expect(
    panel.getByRole("status", { name: "Sold serial search status" }),
  ).toContainText("2 sold serials");
  await select.selectOption({ label: "COV-S1" });
  expect(reads).toEqual([]);
  let failed = false;
  await page.route(pattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        json: { message: "Synthetic coverage read failure", code: "TEST" },
      });
    } else await route.continue();
  });
  await check.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic coverage read failure",
  );
  await panel
    .getByRole("button", { name: "Retry coverage lookup", exact: true })
    .click();
  await expect(
    panel.getByRole("status", { name: "Coverage status" }),
  ).toHaveText("Coverage dates loaded");
  expect(reads[0]).toBe(reads[1]);
  await expect(panel).toContainText("Duration retained at shipment: 365 days.");
  await expect(panel).toContainText("Eligibility requires review.");
  await select.selectOption({ label: "COV-S2" });
  await expect(panel).not.toContainText("Serial COV-S1");
  await expect(
    panel.getByRole("status", { name: "Coverage status" }),
  ).toHaveText("Select a serial and check its coverage dates.");
  await check.click();
  await expect(panel).toContainText("Serial COV-S2");
  await page.unroute(pattern);
  for (const exit of [
    "serial",
    "close",
    "refresh",
    "navigation",
    "signout",
  ] as const) {
    let release!: () => void, handled!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      done = new Promise<void>((r) => {
        handled = r;
      });
    await page.route(pattern, async () => {
      await held;
      handled();
    });
    const started = page.waitForRequest((r) => r.url().includes("/coverage?"));
    await check.click();
    const pending = await started;
    const cancelled = page.waitForEvent("requestfailed", (r) => r === pending);
    if (exit === "serial") await select.selectOption({ label: "COV-S1" });
    else if (exit === "close")
      await panel
        .getByRole("button", { name: "Close coverage lookup", exact: true })
        .click();
    else if (exit === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    else if (exit === "navigation") await nav(page, "Overview");
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await cancelled;
    release();
    await done;
    await page.unroute(pattern);
    if (exit === "serial") {
      await expect(panel).not.toContainText("Serial COV-S2");
      await panel
        .getByRole("button", { name: "Close coverage lookup", exact: true })
        .click();
    }
    if (exit === "serial" || exit === "close")
      await expect(opener).toBeFocused();
    if (exit === "signout") break;
    if (exit === "refresh")
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
    await nav(page, "Returns");
    await opener.click();
    await select.selectOption({ label: "COV-S2" });
  }
  await login("coverage-browser@example.test", "long-user-test-password");
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Returns");
  await opener.click();
  expect(await select.locator("option").allTextContents()).toEqual([
    "Select a sold serial",
    "COV-S1",
    "COV-S2",
  ]);
  await select.selectOption({ label: "COV-S1" });
  await check.click();
  await expect(
    panel.getByRole("status", { name: "Coverage status" }),
  ).toHaveText("Coverage dates loaded");
  await expect(panel).toContainText("Coverage rules are provisional.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: warranty activity page, retry, cancel and preserve buyer privacy", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const response = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const dashboard = async () => stockFactsDashboard(page);
  const account = await cmd("account.create", {
    name: "Decision browser customer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "DEC-BROWSER",
    name: "Decision browser equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const initial = await dashboard();
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 2, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "DEC-DELIVERY",
    quantity: 2,
    serials: ["DEC-SERIAL", "DEC-SERIAL2"],
    bin: "DEC",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 2 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const p of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const picked = await dashboard();
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic manufacturer fixture handover",
  });
  const sold = await dashboard();
  const claim = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "DEC-SERIAL").id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "evidence-issue",
  });

  const second = await cmd("warranty.submit", {
    accountId: account.id,
    unitId: sold.stock.find((u: any) => u.serial === "DEC-SERIAL2").id,
    type: "warranty",
    issue: "Synthetic second claim",
    evidence: "Synthetic second report",
  });
  await cmd("warranty.review", {
    claimId: claim.id,
    approved: true,
    reason: "Private decision approval",
  });
  for (let i = 0; i < 21; i++) {
    const maker = await cmd("warranty.manufacturer.refer", {
      claimId: claim.id,
      manufacturer: "Synthetic maker",
      reference: `DEC-MAKER-${i}`,
      evidence: "Private referral evidence",
      reason: `Private referral ${i}`,
    });
    await cmd("warranty.manufacturer.decide", {
      caseId: maker.id,
      revision: 1,
      outcome: "cancelled",
      evidence: "Private response evidence",
      reason: `Private cancellation ${i}`,
    });
  }
  await cmd("warranty.receive", {
    claimId: claim.id,
    warehouseId,
    bin: "Private receipt bin",
    serial: "DEC-SERIAL",
  });
  await cmd("warranty.inspect", {
    claimId: claim.id,
    findings: "Private inspection " + "x".repeat(1500),
  });
  await cmd("user.create", {
    name: "Decision buyer",
    email: "decision-buyer@example.test",
    password: "long-decision-password",
    role: "buyer",
    accountId: account.id,
    sites: [],
    requirePasswordChange: false,
    currentPassword: "long-test-only-password",
  });
  const before = await dashboard();
  const nativeFacts = (d: any) => ({
    stock: d.stock,
    orders: d.orders,
    shipments: d.shipments,
    invoices: d.invoices,
    claims: d.claims,
  });
  const path = `/api/warranty/claims/${claim.id}/decisions`;
  const pattern = `**${path}*`;
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(path)) reads.push(r.url());
  });
  const dashboardReads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/dashboard")
      dashboardReads.push(r.url());
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  expect(dashboardReads).toHaveLength(1);
  await nav(page, "Returns");
  expect(reads).toEqual([]);
  const opener = (id: string) =>
    page
      .getByRole("row")
      .filter({ hasText: id.slice(0, 8) })
      .filter({
        has: page.getByRole("button", {
          name: "Claim activity",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Claim activity", exact: true });
  const panel = page.getByRole("region", {
    name: "Claim activity",
    exact: true,
  });
  await opener(claim.id).click();
  await expect(panel.getByRole("heading")).toBeFocused();
  await expect(panel.getByRole("status")).toHaveText("20 records loaded");
  await expect(panel).toContainText("Private decision approval");
  await expect(
    panel.getByRole("columnheader", { name: "Recorded by", exact: true }),
  ).toBeVisible();
  let failed = false;
  const cursors: string[] = [];
  await page.route(`**${path}?after=*`, async (route) => {
    cursors.push(route.request().url());
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        json: { message: "Synthetic decision read failure", code: "TEST" },
      });
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic decision read failure",
  );
  await expect(panel.getByRole("status")).toHaveText("20 records loaded");
  await expect(
    panel.getByRole("button", { name: "Retry claim activity", exact: true }),
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Retry claim activity", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("40 records loaded");
  expect(cursors[0]).toBe(cursors[1]);
  await expect(
    panel.getByRole("button", { name: "Load more activity", exact: true }),
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("46 records loaded");
  await expect(
    panel.getByRole("button", { name: "All records loaded", exact: true }),
  ).toBeDisabled();
  expect(await panel.getByRole("row").count()).toBe(47);
  await expect(panel).toContainText("Private receipt bin");
  await expect(panel).toContainText("Private inspection " + "x".repeat(1500));
  for (const action of ["submitted", "received", "inspected"])
    await expect(
      panel.getByRole("cell", { name: action, exact: true }),
    ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await panel
      .locator(".claim-activity-detail")
      .last()
      .evaluate((el) => ({
        contained: el.scrollWidth <= el.clientWidth,
        fitsPhone: el.getBoundingClientRect().width <= 390,
        multiline: el.getBoundingClientRect().height > 32,
      })),
  ).toEqual({ contained: true, fitsPhone: true, multiline: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel.getByRole("heading")).toBeFocused();
  await page.unroute(`**${path}?after=*`);
  await panel
    .getByRole("button", { name: "Close claim activity", exact: true })
    .click();
  await expect(opener(claim.id)).toBeFocused();
  await opener(claim.id).click();
  await expect(panel.getByRole("status")).toHaveText("20 records loaded");
  await opener(second.id).click();
  await expect(panel.getByRole("status")).toHaveText("1 record loaded");
  await expect(panel).toContainText("submitted");
  await expect(panel).toContainText("Synthetic second claim");
  await expect(panel).not.toContainText("Private decision approval");
  await panel
    .getByRole("button", { name: "Close claim activity", exact: true })
    .click();
  // Every exit must cancel the actual browser request, including the first page.
  for (const exit of ["close", "refresh", "navigation", "signout"] as const) {
    let release!: () => void, handled!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const done = new Promise<void>((r) => (handled = r));
    await page.route(pattern, async () => {
      await held;
      handled();
    });
    const started = page.waitForRequest((r) => r.url().endsWith(path));
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().endsWith(path),
    });
    await opener(claim.id).click();
    await started;
    if (exit === "close")
      await panel
        .getByRole("button", { name: "Close claim activity", exact: true })
        .click();
    else if (exit === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    else if (exit === "navigation") await nav(page, "Overview");
    else {
      expect(nativeFacts(await dashboard())).toEqual(nativeFacts(before));
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    }
    await aborted;
    release();
    await done;
    if (exit === "refresh")
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
    await page.unroute(pattern);
    await expect(panel).toHaveCount(0);
    if (exit === "navigation") await nav(page, "Returns");
  }
  await page
    .getByLabel("Email", { exact: true })
    .fill("decision-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-decision-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Returns");
  await opener(claim.id).click();
  await expect(panel.getByRole("status")).toHaveText("20 records loaded");
  await expect(
    panel.getByRole("columnheader", { name: "Detail", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("columnheader", { name: "Recorded by", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("40 records loaded");
  await panel
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("46 records loaded");
  await expect(panel).not.toContainText("Private");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("browser: sold serial pages search, retry, cancel and select current claim custody beyond the dashboard page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (email: string, password: string) => {
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  };
  await login("admin@example.test", "long-test-only-password");
  const cmd = async (name: string, payload: any) => {
    const csrf = (await (await page.request.get("/api/session")).json()).csrf;
    const r = await page.request.post(`/api/commands/${name}`, {
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3117",
      },
      data: payload,
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const initial = await stockFactsDashboard(page);
  const warehouseId = initial.warehouses[0].id;
  const purchases = await (await page.request.get("/api/purchases")).json();
  const account = await cmd("account.create", {
    name: "Serial page buyer",
    tier: "standard",
    creditLimit: 1000000,
  });
  const product = await cmd("product.create", {
    sku: "SOLD-SEARCH-BROWSER",
    name: "Sold page equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
  const serials = Array.from(
    { length: 25 },
    (_, i) => `SS-PAGE-${String(i).padStart(3, "0")}${i === 24 ? "%_'" : ""}`,
  );
  const po = await cmd("purchase.create", {
    supplierId: purchases.suppliers[0].id,
    warehouseId,
    lines: [{ productId: product.id, quantity: 25, unitCost: 6000 }],
  });
  const purchase = await (await page.request.get("/api/purchases")).json();
  await cmd("purchase.receive", {
    poId: po.id,
    lineId: purchase.orders.find((p: any) => p.id === po.id).lines[0].id,
    deliveryRef: "SOLD-SEARCH-PAGE",
    quantity: 25,
    serials,
    bin: "SS-PAGE",
    quarantine: false,
  });
  const cart = await cmd("cart.save", {
    accountId: account.id,
    warehouseId,
    revision: 0,
    lines: [{ productId: product.id, quantity: 25 }],
  });
  const quote = await cmd("cart.quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = await cmd("order.accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = await (
    await page.request.get(`/api/orders/${order.id}/picks`)
  ).json();
  for (const pick of picks)
    await cmd("fulfillment.pick", {
      orderId: order.id,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const picked = await stockFactsDashboard(page);
  const packed = await cmd("fulfillment.pack", {
    orderId: order.id,
    revision: picked.orders.find((o: any) => o.id === order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p: any) => ({
      allocationId: p.id,
      quantity: p.quantity,
    })),
  });
  await cmd("fulfillment.ship", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic 25-unit sale",
  });
  const latest = await stockFactsDashboard(page);
  const target = latest.stock.find((u: any) => u.serial === serials[24]);
  await cmd("user.create", {
    email: "sold-search-buyer@example.test",
    name: "Sold search buyer",
    password: "long-user-test-password",
    requirePasswordChange: false,
    role: "buyer",
    sites: [],
    accountId: account.id,
    currentPassword: "long-test-only-password",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("sold-search-buyer@example.test", "long-user-test-password");
  const buyerDashboard = await (
    await page.request.get("/api/dashboard")
  ).json();
  expect(buyerDashboard.soldUnits).toHaveLength(20);
  expect(
    buyerDashboard.soldUnits.every((u: any) => u.accountId === account.id),
  ).toBe(true);
  expect(buyerDashboard.soldUnitNext).toBeTruthy();
  await nav(page, "Returns");
  const opener = page.getByRole("button", {
    name: "Check sold serial coverage",
    exact: true,
  });
  const panel = page.getByRole("region", {
    name: "Sold serial coverage",
    exact: true,
  });
  const status = panel.getByRole("status", {
    name: "Sold serial search status",
    exact: true,
  });
  const select = panel.getByLabel("Sold serial for coverage", { exact: true });
  const query = panel.getByLabel("Search sold serials", { exact: true });
  const pattern = "**/api/warranty/sold-units/page*";
  const reads: string[] = [],
    submissions: any[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/warranty/sold-units/page")) reads.push(r.url());
    if (r.url().endsWith("/api/commands/warranty.submit"))
      submissions.push(r.postDataJSON());
  });
  await opener.click();
  expect(reads).toEqual([]);
  await expect(status).toContainText("20 sold serials");
  await expect(select.locator("option")).toHaveCount(21);
  await select.selectOption({ label: serials[0] });
  await panel
    .getByRole("button", { name: "Check coverage dates", exact: true })
    .click();
  await expect(
    panel.getByRole("status", { name: "Coverage status" }),
  ).toHaveText("Coverage dates loaded");
  let fail = true;
  await page.route(pattern, async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic serial search failure", code: "TEST" },
      });
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Next sold serials", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic serial search failure",
  );
  await expect(select.locator("option")).toHaveCount(21);
  await expect(select).toHaveValue("");
  await expect(panel).not.toContainText(`Serial ${serials[0]}`);
  await expect(
    panel.getByRole("button", { name: "Retry coverage lookup", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Retry serial search", exact: true })
    .click();
  expect(new URL(reads[0]!).searchParams.get("after")).toBe(
    buyerDashboard.soldUnitNext,
  );
  expect(reads[1]).toBe(reads[0]);
  await expect(status).toContainText(
    "5 sold serials on this page · End of results",
  );
  await expect(select).toBeFocused();
  await expect(select.locator("option")).toHaveCount(6);
  await expect(
    panel.getByRole("button", { name: "Next sold serials", exact: true }),
  ).toHaveCount(0);
  await select.selectOption({ label: serials[24] });
  await panel
    .getByRole("button", { name: "Check coverage dates", exact: true })
    .click();
  await expect(panel).toContainText(`Serial ${serials[24]}`);
  await query.fill("%_'");
  await expect(select).toHaveValue("");
  await expect(panel).not.toContainText(`Serial ${serials[24]}`);
  await query.press("Enter");
  await expect(status).toContainText("1 sold serial");
  expect(await select.locator("option").allTextContents()).toEqual([
    "Select a sold serial",
    serials[24],
  ]);
  await query.fill("No matching equipment");
  await panel
    .getByRole("button", { name: "Search serials", exact: true })
    .click();
  await expect(panel).toContainText("No matching sold serials available.");
  await query.fill("");
  await query.press("Enter");
  await expect(status).toContainText("20 sold serials");
  await page.unroute(pattern);
  for (const exit of [
    "input",
    "close",
    "refresh",
    "navigation",
    "signout",
  ] as const) {
    let release!: () => void, handled!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      done = new Promise<void>((r) => {
        handled = r;
      });
    await page.route(pattern, async () => {
      await held;
      handled();
    });
    const started = page.waitForRequest((r) =>
      r.url().includes("/api/warranty/sold-units/page"),
    );
    await panel
      .getByRole("button", { name: "Next sold serials", exact: true })
      .click();
    const pending = await started,
      cancelled = page.waitForEvent("requestfailed", (r) => r === pending);
    if (exit === "input") await query.fill("SS-PAGE");
    else if (exit === "close")
      await panel
        .getByRole("button", { name: "Close coverage lookup", exact: true })
        .click();
    else if (exit === "refresh")
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
    else if (exit === "navigation") await nav(page, "Overview");
    else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await cancelled;
    release();
    await done;
    await page.unroute(pattern);
    if (exit === "input") {
      await panel
        .getByRole("button", { name: "Close coverage lookup", exact: true })
        .click();
    }
    if (exit === "input" || exit === "close")
      await expect(opener).toBeFocused();
    if (exit === "signout") break;
    if (exit === "refresh")
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
    await nav(page, "Returns");
    await opener.click();
  }
  await login("sold-search-buyer@example.test", "long-user-test-password");
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Returns");
  await page
    .getByRole("button", { name: "Submit claim / return", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Next sold serials", exact: true })
    .click();
  await expect(
    dialog.getByRole("status", { name: "Sold serial search status" }),
  ).toContainText("5 sold serials");
  await dialog.getByLabel("Search sold serials", { exact: true }).fill("%_'");
  await dialog
    .getByLabel("Search sold serials", { exact: true })
    .press("Enter");
  await expect(
    dialog.getByRole("status", { name: "Sold serial search status" }),
  ).toContainText("1 sold serial");
  expect(submissions).toEqual([]);
  await dialog
    .getByLabel("Sold serial", { exact: true })
    .selectOption({ label: serials[24] });
  await dialog
    .getByLabel("Request type", { exact: true })
    .selectOption("warranty");
  await dialog
    .getByLabel("Issue / reason", { exact: true })
    .fill("Synthetic search-selected issue");
  await dialog
    .getByLabel("Evidence reference", { exact: true })
    .fill("Synthetic search-selected evidence");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toHaveLength(1);
  expect(submissions[0].unitId).toBe(target.id);
  expect(submissions[0].accountId).toBe(account.id);
  const submitted = await stockFactsDashboard(page);
  expect(
    submitted.claims.filter(
      (c: any) =>
        c.unit_id === target.id &&
        c.issue === "Synthetic search-selected issue",
    ),
  ).toHaveLength(1);
  for (const exit of ["cancel", "refresh", "navigation", "signout"] as const) {
    await page
      .getByRole("button", { name: "Submit claim / return", exact: true })
      .click();
    let release!: () => void, handled!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      done = new Promise<void>((r) => {
        handled = r;
      });
    await page.route(pattern, async () => {
      await held;
      handled();
    });
    const started = page.waitForRequest((r) =>
      r.url().includes("/api/warranty/sold-units/page"),
    );
    await dialog
      .getByRole("button", { name: "Next sold serials", exact: true })
      .click();
    const pending = await started,
      cancelled = page.waitForEvent("requestfailed", (r) => r === pending);
    if (exit === "cancel")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    else if (exit === "refresh")
      await page
        .getByRole("button", { name: "Refresh", exact: true })
        .press("Enter");
    else if (exit === "navigation")
      await page
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("button", { name: "Overview", exact: true })
        .press("Enter");
    else
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .press("Enter");
    await cancelled;
    release();
    await done;
    await page.unroute(pattern);
    await expect(dialog).toHaveCount(0);
    if (exit === "refresh")
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
    if (exit === "navigation") await nav(page, "Returns");
    expect(submissions).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});
