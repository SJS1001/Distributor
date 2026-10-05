import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
const endpoint = "/api/quickbooks/organization/revocation";
async function login(page: Page, origin: string, email = "admin@example.test") {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function panel(page: Page) {
  await navigateAccounting(page, "QuickBooks connections");
  const p = page.getByRole("region", {
    name: "Organization QuickBooks revocation",
    exact: true,
  });
  await expect(
    p.getByText("Sandbox company: 1234", { exact: true }),
  ).toBeVisible();
  return p;
}
async function review(page: Page) {
  const p = await panel(page);
  await p
    .getByRole("button", {
      name: "Review organization provider revocation",
      exact: true,
    })
    .click();
  await expect(
    p.getByText("Credential revision: 1", { exact: true }),
  ).toBeVisible();
  await expect(p.getByText(/^Permission revision 2 ·/)).toBeVisible();
  await expect(
    p.getByText("Processing countries: US, CA", { exact: true }),
  ).toBeVisible();
  const confirm = p.getByRole("button", {
    name: "Revoke organization QuickBooks sandbox",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await p
    .getByLabel(
      "I reviewed this organization, company, revision and provider revocation",
    )
    .check();
  await expect(confirm).toBeEnabled();
  return { p, confirm };
}
for (const [region, port] of [
  ["CA", 3227],
  ["US", 3228],
] as const)
  test(`organization ${region} browser revocation recovers a lost response with the original receipt and a fresh finance login`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, `http://127.0.0.1:${port}`);
    let writes = 0;
    let original: any;
    await page.route(`**${endpoint}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      original = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    const { p, confirm } = await review(page);
    await confirm.click();
    await expect(
      p.getByRole("button", {
        name: "Read retained organization revocation receipt",
        exact: true,
      }),
    ).toBeEnabled();
    expect(writes).toBe(1);
    await page.reload();
    const restored = await panel(page);
    await restored
      .getByRole("button", {
        name: "Read retained organization revocation receipt",
        exact: true,
      })
      .click();
    await expect(
      restored.getByText("Confirmation source: provider-response", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      restored.getByText("Disabled credential revision: 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login(page, `http://127.0.0.1:${port}`, "finance@example.test");
    const fresh = await panel(page);
    await fresh
      .getByRole("button", {
        name: "Read retained organization revocation receipt",
        exact: true,
      })
      .click();
    await expect(
      fresh.getByText(`Receipt: ${original.receiptId}`, { exact: true }),
    ).toBeVisible();
    await expect(
      fresh.getByText(new RegExp(`Region ${region} · Sandbox company 1234`)),
    ).toBeVisible();
    expect(writes).toBe(1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toMatch(
      /synthetic-org-browser-(access|revoke)|client-secret|distributor_session/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

test("organization browser revocation reviews an unknown provider outcome offline after withdrawal, retaining a lost review for read-only recovery", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3229";
  await login(page, origin);
  let revokes = 0,
    reviews = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(endpoint)) revokes++;
  });
  const { p, confirm } = await review(page);
  await confirm.click();
  await expect(p.getByRole("alert")).toContainText("REVOCATION_UNKNOWN");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const permission = await (
    await page.request.get(`${origin}/api/organization/ledger-residency`)
  ).json();
  const withdrawal = await page.request.post(
    `${origin}/api/commands/organization.ledger-residency.choose`,
    {
      headers: {
        origin,
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        region: "CA",
        revision: permission.choice.revision,
        mode: "strict",
        realm: null,
        acknowledgment: "Synthetic withdrawal before external review",
      },
    },
  );
  expect(withdrawal.status()).toBe(200);
  await p
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(
    p.getByText("Revocation state: unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    p.getByLabel("Provider outcome remains unconfirmed"),
  ).toBeVisible();
  await p.getByLabel("Provider outcome remains unconfirmed").check();
  await p
    .getByLabel("External revocation evidence reference")
    .fill("synthetic:operator-no-provider-confirmation");
  await p
    .getByRole("button", {
      name: "Review external organization revocation evidence",
      exact: true,
    })
    .click();
  const record = p.getByRole("button", {
    name: "Record organization revocation evidence",
    exact: true,
  });
  await expect(record).toBeDisabled();
  await p
    .getByLabel("I reviewed the external outcome and current disabled revision")
    .check();
  await page.route(`**${endpoint}/review`, async (route) => {
    reviews++;
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(2);
    expect(body.resolution).toBe("provider-unconfirmed");
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await record.click();
  await expect(
    p.getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  const fresh = await panel(page);
  await fresh
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(
    fresh.getByText("Revocation state: released", { exact: true }),
  ).toBeVisible();
  await expect(
    fresh.getByText("Confirmation source: unconfirmed", { exact: true }),
  ).toBeVisible();
  expect(revokes).toBe(1);
  expect(reviews).toBe(1);
  await expect(
    fresh.getByRole("button", {
      name: "Revoke organization QuickBooks sandbox",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("organization browser revocation retries only the original explicitly reviewed request when no receipt was committed", async ({
  page,
}) => {
  await login(page, "http://127.0.0.1:3234");
  let writes = 0;
  let original: any;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const body = route.request().postDataJSON();
    if (writes === 1) {
      original = body;
      return route.abort("failed");
    }
    expect(body).toEqual(original);
    return route.continue();
  });
  const { p, confirm } = await review(page);
  await confirm.click();
  await expect(
    p.getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  const fresh = await panel(page);
  await fresh
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(fresh.getByRole("alert")).toContainText("No receipt was found");
  await expect(
    fresh.getByText(`Retained receipt: ${original.receiptId}`, { exact: true }),
  ).toBeVisible();
  const retry = fresh.getByRole("button", {
    name: "Revoke organization QuickBooks sandbox",
    exact: true,
  });
  await expect(retry).toBeDisabled();
  expect(writes).toBe(1);
  await fresh
    .getByLabel(
      "I reviewed this organization, company, revision and provider revocation",
    )
    .check();
  await retry.click();
  await expect(
    fresh.getByText("Confirmation source: provider-response", { exact: true }),
  ).toBeVisible();
  await expect(
    fresh.getByText(`Receipt: ${original.receiptId}`, { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(2);
});

test("organization browser revocation invalidates a competing tab review and ignores a late response after navigation", async ({
  page,
  context,
}) => {
  const origin = "http://127.0.0.1:3233";
  await login(page, origin);
  const first = await review(page);
  const secondPage = await context.newPage();
  await secondPage.goto(origin);
  await expect(
    secondPage.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const second = await review(secondPage);
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const reached = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* Navigation abandoned the reply. */
    }
  });
  await first.confirm.click();
  await reached;
  await expect(second.p.getByRole("alert")).toContainText(
    "changed in another tab",
  );
  await expect(
    second.p.getByRole("button", {
      name: "Revoke organization QuickBooks sandbox",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    second.p.getByRole("button", {
      name: "Review organization provider revocation",
      exact: true,
    }),
  ).toBeDisabled();
  await second.p
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(
    second.p.getByText("Confirmation source: provider-response", {
      exact: true,
    }),
  ).toBeVisible();
  await navigateWorkspace(page, "Overview");
  release();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Organization revocation receipt",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
  await secondPage.close();
});

test("organization browser revocation preserves malformed committed responses and damaged browser evidence without a replacement write", async ({
  page,
}) => {
  await login(page, "http://127.0.0.1:3232");
  const { p, confirm } = await review(page);
  let writes = 0;
  let original: any;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    original = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    body.authority.orgId = "synthetic-other-organization";
    await route.fulfill({ response, json: body });
  });
  await confirm.click();
  await expect(p.getByRole("alert")).toContainText("could not be confirmed");
  await expect(
    p.getByRole("button", {
      name: "Review organization provider revocation",
      exact: true,
    }),
  ).toBeDisabled();
  await p
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(
    p.getByText(`Receipt: ${original.receiptId}`, { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  const damaged = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor:organization-revocation:v1:"),
    )!;
    const raw = localStorage.getItem(key)! + "corrupt";
    localStorage.setItem(key, raw);
    return { key, raw };
  });
  await page.reload();
  const fresh = await panel(page);
  await expect(fresh.getByRole("alert")).toContainText(
    "recovery evidence is unavailable",
  );
  await expect(
    fresh.getByRole("button", {
      name: "Review organization provider revocation",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    fresh.getByRole("button", {
      name: "Read original organization revocation history",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), damaged.key)).toBe(
    damaged.raw,
  );
  expect(writes).toBe(1);
  await page.evaluate((k) => localStorage.setItem(k, ""), damaged.key);
  await page.reload();
  const empty = await panel(page);
  await expect(empty.getByRole("alert")).toContainText(
    "recovery evidence is unavailable",
  );
  await expect(
    empty.getByRole("button", {
      name: "Review organization provider revocation",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    empty.getByRole("button", {
      name: "Read original organization revocation history",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), damaged.key)).toBe(
    "",
  );
  expect(writes).toBe(1);
});

test("organization browser revocation retains a review that never reached the server and confirms external evidence through an explicit exact retry", async ({
  page,
}) => {
  await login(page, "http://127.0.0.1:3230");
  let revokes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(endpoint)) revokes++;
  });
  const { p, confirm } = await review(page);
  await confirm.click();
  await expect(p.getByRole("alert")).toContainText("REVOCATION_UNKNOWN");
  await p
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await p
    .getByLabel("Provider revocation confirmed by external evidence")
    .check();
  await p
    .getByLabel("External revocation evidence reference")
    .fill("synthetic:operator-confirmed-grant");
  await p
    .getByRole("button", {
      name: "Review external organization revocation evidence",
      exact: true,
    })
    .click();
  await p
    .getByLabel("I reviewed the external outcome and current disabled revision")
    .check();
  let writes = 0;
  let original: any;
  await page.route(`**${endpoint}/review`, async (route) => {
    writes++;
    const body = route.request().postDataJSON();
    if (writes === 1) {
      original = body;
      return route.abort("failed");
    }
    expect(body).toEqual(original);
    return route.continue();
  });
  const failedReview = page.waitForEvent("requestfailed", {
    predicate: (r) =>
      r.method() === "POST" && r.url().endsWith(`${endpoint}/review`),
  });
  await p
    .getByRole("button", {
      name: "Record organization revocation evidence",
      exact: true,
    })
    .click();
  await failedReview;
  await expect(p.getByRole("alert")).toBeVisible();
  await expect(
    p.getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    }),
  ).toBeEnabled();
  const retained = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor:organization-revocation:v1:"),
    )!;
    return { key, raw: localStorage.getItem(key)! };
  });
  expect(JSON.parse(retained.raw).kind).toBe("review");
  expect(JSON.parse(retained.raw).payload).toEqual(original);
  expect(writes).toBe(1);
  await test.info().attach("retained-organization-review", {
    body: retained.raw,
    contentType: "application/json",
  });

  // Complete the initial dashboard snapshot only AFTER the explicit recovery
  // read. This reproduces the real remount ordering without timing sleeps.
  let releaseSnapshot!: () => void;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  await page.route("**/api/security", async (route) => {
    const response = await route.fetch();
    await snapshotGate;
    await route.fulfill({ response });
  });
  await page.reload();
  const fresh = await panel(page);
  await expect(
    page.getByRole("heading", {
      name: "Billing identities and terms",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await fresh
    .getByRole("button", {
      name: "Read retained organization revocation receipt",
      exact: true,
    })
    .click();
  await expect(
    fresh.getByText("Evidence reference: synthetic:operator-confirmed-grant", {
      exact: true,
    }),
  ).toBeVisible();
  releaseSnapshot();
  // This background Account aging panel is a data-load signal; the
  // Accounting review must remain visibly open throughout its arrival.
  await expect(
    page.getByRole("heading", {
      name: "Billing identities and terms",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(1);
  expect(
    await page.evaluate((k) => localStorage.getItem(k), retained.key),
  ).toBe(retained.raw);
  await expect(
    fresh.getByText("Evidence reference: synthetic:operator-confirmed-grant", {
      exact: true,
    }),
  ).toBeVisible();
  const record = fresh.getByRole("button", {
    name: "Record organization revocation evidence",
    exact: true,
  });
  await expect(record).toBeDisabled();
  expect(writes).toBe(1);
  await fresh
    .getByLabel("I reviewed the external outcome and current disabled revision")
    .check();
  await record.click();
  await expect(
    fresh.getByText("Confirmation source: operator-evidence", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(2);
  expect(revokes).toBe(1);
});

test("organization browser revocation recovers history in a new browser profile without another provider request", async ({
  page,
  browser,
}) => {
  const origin = "http://127.0.0.1:3231";
  await login(page, origin);
  let writes = 0;
  let original: any;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    original = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  const { confirm } = await review(page);
  await confirm.click();
  await expect.poll(() => writes).toBe(1);
  const context = await browser.newContext();
  try {
    const freshPage = await context.newPage();
    let freshWrites = 0;
    freshPage.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes(endpoint)) freshWrites++;
    });
    await login(freshPage, origin, "finance@example.test");
    const p = await panel(freshPage);
    await expect(
      p.getByLabel("Original organization revocation receipt identifier"),
    ).toBeVisible();
    await p
      .getByLabel("Original organization revocation receipt identifier")
      .fill(original.receiptId);
    await p
      .getByRole("button", {
        name: "Read original organization revocation history",
        exact: true,
      })
      .click();
    await expect(
      p.getByText(`Receipt: ${original.receiptId}`, { exact: true }),
    ).toBeVisible();
    await expect(
      p.getByText("Confirmation source: provider-response", { exact: true }),
    ).toBeVisible();
    await p
      .getByRole("button", {
        name: "Acknowledge terminal organization revocation receipt",
        exact: true,
      })
      .click();
    await expect(
      p.getByText(`Retained receipt: ${original.receiptId}`, { exact: true }),
    ).toHaveCount(0);
    expect(freshWrites).toBe(0);
    expect(writes).toBe(1);
    const history = await freshPage.request.get(
      `${origin}${endpoint}?receiptId=${original.receiptId}`,
    );
    expect(history.status()).toBe(200);
    expect((await history.json()).state).toBe("confirmed");
  } finally {
    await context.close();
  }
});
