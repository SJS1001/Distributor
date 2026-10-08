import { test, expect } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";
// Isolated HTTP fixture: WebKit otherwise upgrades local asset requests to HTTPS.
// Production headers are unchanged.
test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:3261/", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"])
      headers["content-security-policy"] = headers[
        "content-security-policy"
      ].replace(/upgrade-insecure-requests;?/g, "");
    await route.fulfill({ response, headers });
  });
});

test("customer summary, contacts and purchasing rules refresh from the workspace without remounting", async ({
  page,
}) => {
  const reads = { summary: 0, contacts: 0, purchasing: 0 };
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/orders/page?") && u.includes("state=open"))
      reads.summary++;
    if (/\/api\/accounts\/[^/]+\/contacts/.test(u)) reads.contacts++;
    if (/\/api\/catalog\/purchasing\/[^/?]+$/.test(u)) reads.purchasing++;
  });
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic buyer", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => Math.min(reads.summary, reads.contacts, reads.purchasing))
    .toBeGreaterThan(0);
  const before = { ...reads };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => reads.summary).toBeGreaterThan(before.summary);
  await expect.poll(() => reads.contacts).toBeGreaterThan(before.contacts);
  await expect.poll(() => reads.purchasing).toBeGreaterThan(before.purchasing);
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page
    .getByLabel("Contact name", { exact: true })
    .fill("Retained draft contact");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Contact name", { exact: true })).toHaveValue(
    "Retained draft contact",
  );
});

async function openCustomer(page: import("@playwright/test").Page) {
  await page.goto("/#admin-sign-in");
  const email = page.getByLabel("Email", { exact: true });
  await expect(
    email.or(page.getByRole("button", { name: "Sign out", exact: true })),
  ).toBeVisible();
  if (await email.isVisible()) {
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic buyer", exact: true }),
  ).toBeVisible();
}

test("changed purchasing and pricing revisions require explicit review while preserving dirty fields", async ({
  page,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page.getByLabel("Catalog access", { exact: true }).selectOption("none");
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Retained purchasing explanation");
  await page.route(/\/api\/catalog\/purchasing\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, revision: body.revision + 1 },
    });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Purchasing rules changed since this draft was reviewed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Catalog access", { exact: true })).toHaveValue(
    "none",
  );
  await expect(
    page.getByLabel("Reason for purchasing rule change"),
  ).toHaveValue("Retained purchasing explanation");
  await expect(
    page.getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Use latest purchasing revision for this draft",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Catalog access", { exact: true })).toHaveValue(
    "none",
  );
  await expect(
    page.getByLabel("Reason for purchasing rule change"),
  ).toHaveValue("Retained purchasing explanation");
  await expect(
    page.getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page.getByLabel("Price calculation").selectOption("multiplier");
  await page.getByLabel("MSRP multiplier", { exact: true }).fill("0.625");
  await page
    .getByRole("textbox", { name: "Reason for pricing change", exact: true })
    .fill("Retained pricing explanation");
  await page.route(/\/api\/catalog\/pricing\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, revision: body.revision + 1 },
    });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Pricing changed since this draft was reviewed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveValue(
    "0.625",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Reason for pricing change",
      exact: true,
    }),
  ).toHaveValue("Retained pricing explanation");
  await expect(
    page.getByRole("button", { name: "Save customer pricing", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Use latest pricing revision for this draft",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveValue(
    "0.625",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Reason for pricing change",
      exact: true,
    }),
  ).toHaveValue("Retained pricing explanation");
  await expect(
    page.getByRole("button", { name: "Save customer pricing", exact: true }),
  ).toBeEnabled();
});

test("a committed purchasing change with a lost response retries the exact payload after global refresh", async ({
  page,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page.getByLabel("Catalog access", { exact: true }).selectOption("all");
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Synthetic reviewed purchasing change");
  const attempts: { key: string | undefined; payload: unknown }[] = [];
  await page.route("**/api/commands/catalog.purchasing.set", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved purchasing change",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    }),
  ).toBeDisabled();
  await page.reload();
  await openCustomer(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await expect(page.getByLabel("Catalog access", { exact: true })).toHaveValue(
    "all",
  );
  await expect(
    page.getByLabel("Catalog access", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Reason for purchasing rule change"),
  ).toHaveValue("Synthetic reviewed purchasing change");
  await page
    .getByRole("button", { name: "Retry saved purchasing change", exact: true })
    .click();
  await expect(
    page.getByText("Customer purchasing rules saved.", { exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]?.key).toBeTruthy();
  await expect(
    page.getByLabel("Reason for purchasing rule change"),
  ).toHaveValue("");
});

test("contacts recover a lost committed response and clear unauthorized reads on refresh", async ({
  page,
}) => {
  const contactName = `Synthetic recovered contact ${crypto.randomUUID()}`;
  await openCustomer(page);
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByLabel("Contact name", { exact: true }).fill(contactName);
  const attempts: { key: string | undefined; payload: unknown }[] = [];
  await page.route("**/api/commands/account.contact.save", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save contact", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved contact change",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Retry saved contact change", exact: true })
    .click();
  await expect(page.getByText("Contact saved.", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(
    page.getByRole("button", {
      name: `Edit ${contactName}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page
      .locator(".customer-summary-card")
      .filter({ hasText: "Primary contact" }),
  ).toContainText(contactName);
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await page.route(/\/api\/accounts\/[^/]+\/contacts$/, (route) =>
    route.fulfill({
      status: 403,
      json: { message: "Synthetic contact access denied", code: "FORBIDDEN" },
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Synthetic contact access denied (FORBIDDEN)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Edit ${contactName}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add contact", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry contacts", exact: true }),
  ).toBeVisible();
});

test("customer pricing retains an exact committed retry through global refresh", async ({
  page,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page.getByLabel("Price calculation").selectOption("multiplier");
  await page.getByLabel("MSRP multiplier", { exact: true }).fill("0.65");
  await page
    .getByRole("textbox", { name: "Reason for pricing change", exact: true })
    .fill("Synthetic exact pricing recovery");
  const attempts: { key: string | undefined; payload: unknown }[] = [];
  await page.route("**/api/commands/catalog.pricing.set", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      payload: route.request().postDataJSON(),
    });
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Save customer pricing", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved pricing change",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save customer pricing", exact: true }),
  ).toBeDisabled();
  const pricingRead = /\/api\/catalog\/pricing\/[^/?]+$/;
  await page.route(pricingRead, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic denied pricing read" }),
    }),
  );
  await page.reload();
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await expect(
    page.getByText("Synthetic denied pricing read", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Retry saved pricing change",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".pricing-recovery")).toHaveCount(0);
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveCount(
    0,
  );
  expect(attempts).toHaveLength(1);
  await page.unroute(pricingRead);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveValue(
    "0.65",
  );
  await expect(
    page.getByLabel("MSRP multiplier", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", {
      name: "Reason for pricing change",
      exact: true,
    }),
  ).toHaveValue("Synthetic exact pricing recovery");
  await page
    .getByRole("button", { name: "Retry saved pricing change", exact: true })
    .click();
  await expect(page.getByText("Pricing saved.", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(
    page.getByRole("textbox", {
      name: "Reason for pricing change",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveValue(
    "0.65",
  );
});

test("restored access returns dirty purchasing and pricing drafts with their original reviewed revisions", async ({
  page,
}) => {
  await openCustomer(page);
  let denied = true;
  const read = async (route: import("@playwright/test").Route) => {
    if (denied)
      await route.fulfill({
        status: 403,
        json: { message: "Synthetic access denied", code: "FORBIDDEN" },
      });
    else {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, revision: body.revision + 1 },
      });
    }
  };
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page.getByLabel("Catalog access", { exact: true }).selectOption("none");
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Retained during access failure");
  await page.route(/\/api\/catalog\/purchasing\/[^/?]+$/, read);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Catalog access", { exact: true })).toHaveCount(
    0,
  );
  denied = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Catalog access", { exact: true })).toHaveValue(
    "none",
  );
  await expect(
    page.getByLabel("Reason for purchasing rule change"),
  ).toHaveValue("Retained during access failure");
  await expect(
    page.getByRole("button", {
      name: "Use latest purchasing revision for this draft",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page.getByLabel("Price calculation").selectOption("multiplier");
  await page.getByLabel("MSRP multiplier", { exact: true }).fill("0.615");
  await page
    .getByRole("textbox", { name: "Reason for pricing change", exact: true })
    .fill("Retained during pricing access failure");
  denied = true;
  await page.route(/\/api\/catalog\/pricing\/[^/?]+$/, read);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveCount(
    0,
  );
  denied = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("MSRP multiplier", { exact: true })).toHaveValue(
    "0.615",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Reason for pricing change",
      exact: true,
    }),
  ).toHaveValue("Retained during pricing access failure");
  await expect(
    page.getByRole("button", {
      name: "Use latest pricing revision for this draft",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save customer pricing", exact: true }),
  ).toBeDisabled();
});

test("product purchasing retains the exact committed attempt after reload", async ({
  page,
}) => {
  await openCustomer(page);
  const openRules = async () => {
    await navigateWorkspace(page, "Catalog");
    await page
      .getByRole("button", { name: "Manage EQ-1", exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Catalog product management" })
      .getByRole("tab", { name: "Purchasing rules", exact: true })
      .click();
  };
  await openRules();
  const review = page.getByLabel(
    "Require distributor approval for orders containing this product",
  );
  await review.check();
  await page
    .getByLabel("Reason for product rule change")
    .fill("Synthetic retained product purchasing change");
  const attempts: { key: string | undefined; payload: unknown }[] = [];
  await page.route(
    "**/api/commands/catalog.product-purchasing.set",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        payload: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      if (attempts.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await page
    .getByRole("button", { name: "Save product purchasing rule", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved product purchasing change",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await openRules();
  await expect(review).toBeChecked();
  await expect(review).toBeDisabled();
  await expect(page.getByLabel("Reason for product rule change")).toHaveValue(
    "Synthetic retained product purchasing change",
  );
  await page
    .getByRole("button", {
      name: "Retry saved product purchasing change",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Product purchasing rule saved.", { exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]?.key).toBeTruthy();
});

test("a competing tab cannot overwrite a distinct retained purchasing attempt", async ({
  page,
  context,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  const other = await context.newPage();
  await other.route("http://127.0.0.1:3261/", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"])
      headers["content-security-policy"] = headers[
        "content-security-policy"
      ].replace(/upgrade-insecure-requests;?/g, "");
    await route.fulfill({ response, headers });
  });
  await other.goto("http://127.0.0.1:3261/");
  await navigateWorkspace(other, "Customers");
  await other
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await other.getByRole("tab", { name: "Terms", exact: true }).click();
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("First tab exact pending attempt");
  let writes = 0;
  await context.route(
    "**/api/commands/catalog.purchasing.set",
    async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    },
  );
  await page
    .getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved purchasing change",
      exact: true,
    }),
  ).toBeVisible();
  const retained = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("distributor-purchasing:"),
    ),
  );
  await other
    .getByLabel("Reason for purchasing rule change")
    .fill("Second tab distinct replacement attempt");
  await other
    .getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    })
    .click();
  await expect(
    other
      .getByText(
        "Another saved change exists for this record. Reload and review that exact change before retrying.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(
    await other.evaluate(() =>
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith("distributor-purchasing:"),
      ),
    ),
  ).toEqual(retained);
  await other.close();
});

for (const failure of ["corrupt", "unavailable"] as const) {
  test(`purchasing ${failure} storage blocks native writes`, async ({
    page,
  }) => {
    await openCustomer(page);
    await page.getByRole("tab", { name: "Terms", exact: true }).click();
    await page
      .getByLabel("Reason for purchasing rule change")
      .fill("Blocked synthetic replacement");
    let writes = 0;
    await page.route(
      "**/api/commands/catalog.purchasing.set",
      async (route) => {
        writes++;
        await route.abort();
      },
    );
    await page.evaluate((kind) => {
      if (kind === "corrupt") {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith("distributor-purchasing:")) return "damaged";
          return original.call(this, key);
        };
      } else {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith("distributor-purchasing:"))
            throw Error("Synthetic unavailable purchasing storage");
          return original.call(this, key);
        };
      }
    }, failure);
    await page
      .getByRole("button", {
        name: "Save customer purchasing rules",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Save customer purchasing rules",
        exact: true,
      }),
    ).toBeDisabled();
    expect(writes).toBe(0);
  });
}

test("a competing tab cannot overwrite a distinct retained pricing attempt", async ({
  page,
  context,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Pricing", exact: true }).click();
  const other = await context.newPage();
  await other.route("http://127.0.0.1:3261/", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"])
      headers["content-security-policy"] = headers[
        "content-security-policy"
      ].replace(/upgrade-insecure-requests;?/g, "");
    await route.fulfill({ response, headers });
  });
  await other.goto("http://127.0.0.1:3261/");
  await navigateWorkspace(other, "Customers");
  await other
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await other.getByRole("tab", { name: "Pricing", exact: true }).click();
  await page
    .getByLabel("Reason for pricing change")
    .fill("First tab exact pending attempt");
  let writes = 0;
  await context.route("**/api/commands/catalog.pricing.set", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort("failed");
  });
  await page
    .getByRole("button", {
      name: "Save customer pricing",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry saved pricing change",
      exact: true,
    }),
  ).toBeVisible();
  const retained = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("distributor-pricing:"),
    ),
  );
  await other
    .getByLabel("Reason for pricing change")
    .fill("Second tab distinct replacement attempt");
  await other
    .getByRole("button", {
      name: "Save customer pricing",
      exact: true,
    })
    .click();
  await expect(
    other
      .getByText(
        "Another saved change exists for this record. Reload and review that exact change before retrying.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(
    await other.evaluate(() =>
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith("distributor-pricing:"),
      ),
    ),
  ).toEqual(retained);
  await other.close();
});

test("missing browser coordination blocks a purchasing native write", async ({
  page,
}) => {
  await openCustomer(page);
  await page.getByRole("tab", { name: "Terms", exact: true }).click();
  await page
    .getByLabel("Reason for purchasing rule change")
    .fill("Synthetic missing coordination");
  let writes = 0;
  await page.route("**/api/commands/catalog.purchasing.set", async (route) => {
    writes++;
    await route.abort();
  });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await page
    .getByRole("button", {
      name: "Save customer purchasing rules",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByText(
        "Browser coordination is unavailable. Restore browser coordination before changing this record.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  expect(writes).toBe(0);
});

for (const deniedStatus of [403, 404]) {
  test(`customer history retains transient paging but clears denied ${deniedStatus} records`, async ({
    page,
  }) => {
    await openCustomer(page);
    const cursors: string[] = [];
    let afterReads = 0;
    await page.route("**/api/orders/page?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("state")) return route.continue();
      const after = url.searchParams.get("after");
      if (after) {
        cursors.push(after);
        afterReads++;
        if (afterReads !== 2)
          return route.fulfill({
            status: afterReads === 1 ? 503 : deniedStatus,
            json: {
              message:
                afterReads === 1
                  ? "Synthetic history temporarily unavailable"
                  : "Synthetic history authority denied",
            },
          });
      }
      return route.fulfill({
        json: {
          items: [
            {
              id: after ? "synthetic-history-two" : "synthetic-history-one",
              number: after ? "PRIVATE-HISTORY-TWO" : "PRIVATE-HISTORY-ONE",
              created_at: "2026-10-07T12:00:00Z",
              state: "open",
              total: 100,
              currency: "CAD",
            },
          ],
          next: "synthetic-history-cursor",
        },
      });
    });
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "PRIVATE-HISTORY-ONE", exact: true }),
    ).toBeVisible();
    const more = page.getByRole("button", {
      name: "Load more orders",
      exact: true,
    });
    await more.click();
    await expect(
      page.getByText("Synthetic history temporarily unavailable", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "PRIVATE-HISTORY-ONE", exact: true }),
    ).toBeVisible();
    await expect(more).toBeEnabled();
    await more.click();
    await expect(
      page.getByRole("link", { name: "PRIVATE-HISTORY-TWO", exact: true }),
    ).toBeVisible();
    expect(cursors.slice(0, 2)).toEqual([
      "synthetic-history-cursor",
      "synthetic-history-cursor",
    ]);
    await more.click();
    await expect(
      page.getByText("Synthetic history authority denied", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /PRIVATE-HISTORY/ }),
    ).toHaveCount(0);
    await expect(more).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Customer records", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry orders", exact: true }),
    ).toBeVisible();
  });
}
