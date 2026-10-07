import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { navigationHash } from "../src/web/navigation.ts";
import {
  navigateWorkspace,
  navigateCustomerWorkspace,
} from "./workspace-navigation.ts";

test("every administration and customer destination exposes usable sections and safe controls", async ({
  page,
}, testInfo) => {
  const cleanup: (() => void)[] = [];
  const f = fixture({ after: (fn) => cleanup.push(fn) });
  const shipment = ship(f, accept(f, 1).id);
  const openOrder = accept(f, 1, "open-audit-order");
  const invoice = f.app.billing
    .invoices(f.actor)
    .find((i) => i.id === shipment.invoiceId)!;
  chooseProviders(f, f.actor, "audit-provider-permission", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic browser audit only",
  });
  const checkout = f.app.integration.checkout(f.actor, "audit-checkout", {
    invoiceId: invoice.id,
  });
  const checkoutReceipt = {
    reference: "cs_test_page_audit",
    result: {
      amount: invoice.total,
      currency: "cad",
      status: "open",
      paymentStatus: "unpaid",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      checkoutUrl: "https://checkout.stripe.com/synthetic-page-audit",
    },
  };
  await f.app.integration.execute(f.actor, checkout.id, {
    execute: async () => checkoutReceipt,
    lookup: async () => checkoutReceipt,
  });
  f.app.identity.createUser(f.actor, "page-audit-buyer", {
    email: "page-audit-buyer@example.test",
    password: "synthetic-buyer-password",
    name: "Page audit buyer",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    requirePasswordChange: false,
  });
  const origin = "http://127.0.0.1:3262";
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
  const errors: string[] = [],
    failedReads: { url: string; status: number }[] = [];
  let auditActive = false;
  let authenticationEpoch = 0;
  const requestEpochs = new Map<object, number>();
  const expectedFailures: string[] = [];
  page.on("request", (request) => {
    if (auditActive) requestEpochs.set(request, authenticationEpoch);
  });
  const testedBuild = readFileSync("dist/index.html", "utf8").match(
    /src="([^"]+\.js)"/,
  )?.[1];
  const injectedReadRequests = new Set<object>();
  const inventory: unknown[] = [],
    controls: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      auditActive &&
      requestEpochs.get(response.request()) === authenticationEpoch &&
      response.status() >= 400 &&
      !injectedReadRequests.has(response.request()) &&
      response.url().includes("/api/") &&
      !response.url().includes("/api/operations/health")
    )
      failedReads.push({
        url: response.url().replace(origin, ""),
        status: response.status(),
      });
  });
  const login = async (email: string, password: string) => {
    auditActive = false;
    authenticationEpoch++;
    await page.goto(
      origin +
        (email === "admin@example.test"
          ? "/#admin-sign-in"
          : "/#customer-sign-in"),
    );
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toBeVisible();
    auditActive = true;
  };
  const logout = async () => {
    const response = page.waitForResponse(
      (reply) => reply.url().endsWith("/api/logout"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator("#workspace-title")).toBeHidden();
  };
  const inspect = async (
    audience: string,
    destination: string,
    section: string,
  ) => {
    await page.evaluate(() => scrollTo(0, 0));
    const visibleDialog = page.getByRole("dialog");
    const contents =
      (await visibleDialog.count()) && (await visibleDialog.isVisible())
        ? visibleDialog
        : page.locator("#workspace-content");
    const details = await contents.evaluate((main) => {
      const visible = (element: Element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden";
      const text = (element: Element) =>
        (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const headings = [...main.querySelectorAll("h1,h2,h3,h4")]
        .filter(visible)
        .map((element) => ({ level: element.tagName, text: text(element) }));
      const buttons = [...main.querySelectorAll("button")]
        .filter(visible)
        .map((element) => ({
          name: element.getAttribute("aria-label") ?? text(element),
          disabled: element.disabled,
        }));
      const inputs = [...main.querySelectorAll("input,select,textarea")]
        .filter(visible)
        .map((element) => ({
          tag: element.tagName,
          type: element.getAttribute("type"),
          label:
            element.getAttribute("aria-label") ??
            element
              .closest("label")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ??
            "",
          disabled: (element as HTMLInputElement).disabled,
        }));
      return { headings, buttons, inputs };
    });
    inventory.push({
      audience,
      destination,
      section,
      url: page.url().replace(origin, ""),
      ...details,
    });
    expect
      .soft(
        await page.locator("#workspace-content h1:visible").allTextContents(),
        `${audience}/${destination}/${section} page title`,
      )
      .toHaveLength(1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
          .filter(
            (element) => element.getBoundingClientRect().right > innerWidth + 1,
          )
          .slice(0, 10)
          .map((element) => ({
            tag: element.tagName,
            class: element.className,
            text: element.textContent?.slice(0, 80),
            width: getComputedStyle(element).width,
            maxWidth: getComputedStyle(element).maxWidth,
            parentWidth: element.parentElement?.getBoundingClientRect().width,
            right: element.getBoundingClientRect().right,
          })),
      }));
      inventory.push({ audience, destination, section, geometry });
      expect
        .soft(
          geometry.scrollWidth,
          `${audience}/${destination}/${section}/${width}: ${JSON.stringify(geometry)}`,
        )
        .toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(
          `${audience}-${destination}-${section}-${width}`.replace(
            /[^a-zA-Z0-9-]/g,
            "_",
          ) + ".png",
        ),
        fullPage: width !== 320,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // Inspect disclosure hierarchy through the same visible summaries that
    // operators use. No command or provider connection is submitted here.
    const summaries = contents.locator("details > summary");
    for (const summary of await summaries.all()) {
      if (!(await summary.isVisible())) continue;
      // WebKit can report nonzero boxes for summaries inside collapsed details.
      // Their parent disclosure must be opened before the nested control exists.
      if (
        await summary.evaluate((element) => {
          for (
            let ancestor = element.parentElement?.parentElement;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            if (
              ancestor.tagName === "DETAILS" &&
              !ancestor.hasAttribute("open")
            )
              return true;
          }
          return false;
        })
      )
        continue;
      const initiallyOpen = await summary.evaluate((element) =>
        element.parentElement!.hasAttribute("open"),
      );
      if (initiallyOpen) continue;
      await summary.click();
      controls.push({
        audience,
        destination,
        section,
        control: (await summary.textContent())?.trim(),
        action: "disclosure opened",
      });
      await summary.click();
    }
    const safeDialogs = [
      "Add warehouse",
      "Find serial",
      "Add supplier",
      "Add product",
      "Add customer",
      "Create user",
      "Request return",
      "Warranty claim",
      "End all my sessions",
    ];
    for (const name of safeDialogs) {
      const button = contents.getByRole("button", { name, exact: true });
      if (
        (await button.count()) !== 1 ||
        !(await button.isVisible()) ||
        !(await button.isEnabled())
      )
        continue;
      await button.click();
      const dialog = page.getByRole("dialog");
      if ((await dialog.count()) && (await dialog.isVisible())) {
        controls.push({
          audience,
          destination,
          section,
          control: name,
          action: "dialog opened and canceled",
        });
        const cancel = dialog.getByRole("button", {
          name: /^(Cancel|Close|Close dialog)$/,
        });
        if (await cancel.count()) await cancel.first().click();
        else await page.keyboard.press("Escape");
        await expect.soft(dialog).toBeHidden();
      } else {
        controls.push({
          audience,
          destination,
          section,
          control: name,
          action: "inline control opened",
        });
        // Restore the page when a safe opener navigates to another section.
        await page.reload();
        await expect(page.locator("#workspace-title")).toBeVisible();
      }
    }
  };
  const audit = async (
    audience: "admin" | "customer",
    destinations: string[],
  ) => {
    for (const destination of destinations) {
      await page.setViewportSize({ width: 1440, height: 900 });
      if (audience === "admin") await navigateWorkspace(page, destination);
      else await navigateCustomerWorkspace(page, destination);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
      const tablist = page.getByRole("tablist");
      const names = await tablist.getByRole("tab").allTextContents();
      if (!names.length) await inspect(audience, destination, "main");
      for (const name of names) {
        const tab = tablist.getByRole("tab", {
          name: name.trim(),
          exact: true,
        });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        const panelId = await tab.getAttribute("aria-controls");
        expect(panelId).toBeTruthy();
        await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
        await inspect(audience, destination, name.trim());
      }
    }
  };
  try {
    await http.listen({ host: "127.0.0.1", port: 3262 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await login("admin@example.test", "long-test-only-password");
    if (process.env.DISTRIBUTOR_AUDIT_TERMS_ONLY === "1") {
      await navigateWorkspace(page, "Customers");
      await page
        .getByRole("link", { name: "Synthetic buyer", exact: true })
        .click();
      await page.getByRole("tab", { name: "Terms", exact: true }).click();
      await inspect("admin", "Customer record", "Terms");
      expect(errors).toEqual([]);
      expect(failedReads).toEqual([]);
      return;
    }
    await audit("admin", [
      "Overview",
      "Orders",
      "Customers",
      "Catalog",
      "Inventory",
      "Purchasing",
      "Returns",
      "Billing",
      "Reconciliation",
      "Operations health",
      "Audit history",
      "Event reporting",
      "Imports",
      "Administration",
      "Security",
    ]);
    await navigateWorkspace(page, "Customers");
    await page
      .getByRole("link", { name: "Synthetic buyer", exact: true })
      .click();
    for (const name of await page
      .getByRole("tablist", { name: "Customer record sections" })
      .getByRole("tab")
      .allTextContents()) {
      const tab = page
        .getByRole("tablist", { name: "Customer record sections" })
        .getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await inspect("admin", "Customer record", name);
      if (name === "Contacts") {
        await page
          .getByRole("button", { name: "Add contact", exact: true })
          .click();
        await expect(
          page.getByRole("textbox", { name: "Contact name", exact: true }),
        ).toBeVisible();
        await inspect("admin", "Customer record", "New contact");
        await page
          .getByRole("button", { name: "Cancel contact edit", exact: true })
          .click();
      }
      if (name === "History") {
        const historyTabs = page.getByRole("tablist", {
          name: "Customer history sections",
          exact: true,
        });
        for (const historyName of await historyTabs
          .getByRole("tab")
          .allTextContents()) {
          await historyTabs
            .getByRole("tab", { name: historyName, exact: true })
            .click();
          await inspect("admin", "Customer history", historyName);
        }
      }
    }
    await navigateWorkspace(page, "Catalog");
    let productReads = 0;
    await page.route("**/api/catalog/products/page?*", async (route) => {
      if (++productReads === 1) {
        expectedFailures.push("Synthetic catalog search 503");
        injectedReadRequests.add(route.request());
        await route.fulfill({
          status: 503,
          json: { message: "Synthetic catalog read failure" },
        });
      } else await route.continue();
    });
    await page
      .getByRole("searchbox", { name: "Catalog search", exact: true })
      .fill("Synthetic");
    await page
      .getByRole("button", { name: "Search catalog", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Synthetic catalog read failure" }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Catalog search", exact: true }),
    ).toHaveValue("Synthetic");
    await page
      .getByRole("button", { name: "Search catalog", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Images & documents for/ })
      .first()
      .click();
    const productDialog = page.getByRole("dialog", { name: /^Manage / });
    await expect(productDialog).toBeVisible();
    for (const name of await productDialog.getByRole("tab").allTextContents()) {
      const tab = productDialog.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await inspect("admin", "Product management", name);
      if (name === "Images" || name === "Documents") {
        const add = productDialog.getByRole("button", {
          name: name === "Images" ? "Add image" : "Add document",
          exact: true,
        });
        await add.click();
        await expect(
          productDialog.getByRole("textbox", {
            name: "Resource title",
            exact: true,
          }),
        ).toBeVisible();
        await inspect("admin", "Product management", `${name} draft form`);
        await add.click();
      }
    }
    await productDialog
      .getByRole("button", { name: "Close product management", exact: true })
      .click();
    await expect(productDialog).toBeHidden();
    expect(productReads).toBeGreaterThanOrEqual(2);
    await page.goto(
      origin +
        "/" +
        navigationHash({
          page: "Orders",
          section: "orders-queue",
          orderState: "closed",
          orderId: openOrder.id,
        }),
    );
    await page
      .getByRole("button", { name: "Open actions for this order", exact: true })
      .click();
    // The section is named even when the browser exposes section semantics generically.
    await expect(
      page.getByRole("heading", {
        name: "Actions for this order",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      new URLSearchParams(new URL(page.url()).hash.slice(1)).get("orders"),
    ).toBe("closed");
    await expect(
      page.getByRole("button", {
        name: `Open order ${openOrder.id}`,
        exact: true,
      }),
    ).toBeVisible();
    await inspect("admin", "Focused order actions", "excluded by filter");
    await page
      .getByRole("button", { name: "Return to all orders", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Order state", exact: true }),
    ).toHaveValue("closed");
    await expect(
      page.locator('[aria-label="Selected order actions"]'),
    ).toHaveCount(0);
    auditActive = false;
    await logout();
    await login("page-audit-buyer@example.test", "synthetic-buyer-password");
    await audit("customer", [
      "Shop",
      "Orders",
      "Billing",
      "Overview",
      "Returns",
      "Account",
    ]);
    await navigateCustomerWorkspace(page, "Shop");
    await page
      .getByRole("button", { name: /^View Synthetic/ })
      .first()
      .click();
    await expect(
      page.getByRole("tablist", { name: "Product information" }),
    ).toBeVisible();
    for (const name of await page
      .getByRole("tablist", { name: "Product information" })
      .getByRole("tab")
      .allTextContents()) {
      const tab = page
        .getByRole("tablist", { name: "Product information" })
        .getByRole("tab", { name, exact: true });
      await tab.click();
      await inspect("customer", "Product details", name);
    }
    await page
      .getByRole("button", { name: "Add to cart", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View cart (1 item)", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your cart", exact: true }),
    ).toBeVisible();
    await inspect("customer", "Shop cart", "populated");
    const cartQuantity = page.getByRole("spinbutton", {
      name: /Quantity of .* in cart/,
    });
    await cartQuantity.fill("2");
    await expect(
      page.getByRole("button", { name: "Close cart", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Remove .* from cart$/ }).click();
    await expect(
      page.getByText("Your cart is empty. Add products from the Shop.", {
        exact: true,
      }),
    ).toBeVisible();
    await inspect("customer", "Shop cart", "empty");
    await navigateCustomerWorkspace(page, "Billing");
    await page.getByRole("tab", { name: "Account aging", exact: true }).click();
    for (const [label, filter] of [
      ["Not due", "notDue"],
      ["1–30 days", "days1to30"],
      ["31–60 days", "days31to60"],
      ["61–90 days", "days61to90"],
      ["Over 90 days", "daysOver90"],
      ["unknown due dates", "unknownDue"],
      ["Credit balance", "credit"],
      ["Net balance", "all"],
    ]) {
      await page
        .getByRole("button", {
          name: `Investigate ${label} for Synthetic buyer`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Investigate", exact: true }),
      ).toHaveValue(filter!);
      await page
        .getByRole("button", { name: "← Account aging", exact: true })
        .click();
    }
    await page.getByRole("tab", { name: "Invoices", exact: true }).click();
    await page.getByRole("link", { name: invoice.number, exact: true }).click();
    const breadcrumb = page.getByRole("navigation", {
      name: "Workspace breadcrumb",
      exact: true,
    });
    await expect(
      breadcrumb.getByRole("link", {
        name: "Invoices & payments",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      breadcrumb.getByText("Invoice details", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Request Stripe checkout",
        exact: true,
      }),
    ).toBeVisible();
    const checkoutCommand = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/commands/stripe.checkout"),
      { timeout: 20_000 },
    );
    await page
      .getByRole("button", { name: "Request Stripe checkout", exact: true })
      .click();
    expect((await checkoutCommand).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    controls.push({
      audience: "customer",
      destination: "Invoice details",
      control: "Request Stripe checkout",
      action: "synthetic native command completed",
    });
    const invoiceDownload = page.waitForEvent("download", { timeout: 20_000 });
    await page
      .getByRole("button", { name: "Download invoice PDF", exact: true })
      .click();
    const downloaded = await invoiceDownload;
    expect(downloaded.suggestedFilename()).toMatch(/\.pdf$/i);
    expect(await downloaded.failure()).toBeNull();
    controls.push({
      audience: "customer",
      destination: "Invoice details",
      control: "Download invoice PDF",
      action: "download completed",
    });
    await inspect("customer", "Invoice details", "checkout action");
    const routeBeforePayment = page.url();
    f.app.billing.manualPayment(f.actor, "audit-independent-payment", {
      invoiceId: invoice.id,
      reference: "AUDIT-BANK-1",
      amount: 1000,
      reason: "Synthetic independently confirmed payment",
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const balance = page
      .locator(".record-figures > div")
      .filter({ has: page.locator("dt", { hasText: "Current balance" }) })
      .locator("dd");
    await expect(balance).toHaveText(
      new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        currencyDisplay: "code",
      }).format((invoice.total - 1000) / 100),
    );
    await expect(
      page
        .locator(".record-figures > div")
        .filter({ has: page.locator("dt", { hasText: "Paid" }) })
        .locator("dd"),
    ).toHaveText("CAD 10.00");
    expect(page.url()).toBe(routeBeforePayment);
    await inspect("customer", "Invoice details", "refreshed payment");
    await breadcrumb
      .getByRole("link", { name: "Invoices & payments", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: invoice.number, exact: true }),
    ).toBeVisible();
    auditActive = false;
    await logout();
    await login("admin@example.test", "long-test-only-password");
    await page.goto(
      origin +
        "/" +
        navigationHash({
          page: "Billing",
          section: "billing-invoices",
          invoiceId: invoice.id,
        }),
    );
    await expect(
      page.getByRole("region", { name: "Recorded payments", exact: true }),
    ).toBeVisible();
    f.app.billing.manualPayment(f.actor, "audit-independent-second-payment", {
      invoiceId: invoice.id,
      reference: "AUDIT-BANK-2",
      amount: 1000,
      reason: "Synthetic second independently confirmed payment",
    });
    const adminInvoiceRoute = page.url();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Recorded payments", exact: true })
        .getByText("manual · AUDIT-BANK-2", { exact: true }),
    ).toBeVisible();
    expect(page.url()).toBe(adminInvoiceRoute);
    await inspect("admin", "Invoice details", "refreshed payment list");
    expect(expectedFailures).toHaveLength(1);
    expect.soft(errors).toEqual([]);
    expect.soft(failedReads).toEqual([]);
  } finally {
    writeFileSync(
      testInfo.outputPath("page-inventory.json"),
      JSON.stringify(
        {
          build: testedBuild,
          expectedFailures,
          inventory,
          controls,
          errors,
          failedReads,
        },
        null,
        2,
      ),
    );
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});
