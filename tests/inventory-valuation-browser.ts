import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:3291";
const panel = (p: Page) =>
  p.getByRole("region", { name: "Stock valuation", exact: true });
const review = (p: Page) =>
  panel(p).getByRole("region", { name: "Exact valuation review", exact: true });
async function signIn(p: Page, email = "admin@example.test", server = origin) {
  await p.goto(server);
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await inventory(p);
}
async function inventory(p: Page) {
  await p
    .getByRole("navigation")
    .getByRole("button", { name: "Inventory", exact: true })
    .click();
}
async function open(p: Page, serial = "S1") {
  await p
    .getByRole("row")
    .filter({ hasText: `${serial} · stock` })
    .getByRole("button", { name: "Stock valuation", exact: true })
    .click();
  await expect(panel(p)).toBeVisible();
}
async function configure(p: Page) {
  await panel(p)
    .getByLabel("Policy version", { exact: true })
    .fill("synthetic-browser-1");
  await panel(p)
    .getByLabel("Established accounting basis", { exact: true })
    .fill("Synthetic accountant-established customer basis");
  await panel(p)
    .getByLabel("Costing method", { exact: true })
    .selectOption("specific-identification");
  await panel(p)
    .getByLabel("Effective from", { exact: true })
    .fill("2026-01-01");
  await panel(p)
    .getByLabel("Closed through", { exact: true })
    .fill("2026-08-31");
  await panel(p)
    .getByLabel("Finance policy evidence", { exact: true })
    .fill("Synthetic established method and periods");
  await panel(p)
    .getByLabel("Non-interchangeability evidence", { exact: true })
    .fill("Synthetic individually distinct equipment");
  await panel(p)
    .getByRole("button", { name: "Review valuation policy", exact: true })
    .click();
  await expect(review(p).getByRole("heading")).toBeFocused();
  expect(await review(p).locator("input,select,textarea").count()).toBe(0);
  await review(p)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    panel(p).getByText("Policy revision 1", { exact: true }),
  ).toBeVisible();
}
async function fillPreparation(p: Page, reference: string, target = 4000) {
  await panel(p)
    .getByLabel("Valuation reference", { exact: true })
    .fill(reference);
  await panel(p)
    .getByLabel("Target carrying value (minor units)", { exact: true })
    .fill(String(target));
  await panel(p).getByLabel("Posting date", { exact: true }).fill("2026-10-03");
  await panel(p)
    .getByLabel("Valuation reason", { exact: true })
    .fill("Synthetic independently assessed decrease");
  await panel(p)
    .getByLabel("Value evidence", { exact: true })
    .fill("Synthetic lot recoverable value evidence");
  await panel(p)
    .getByLabel("Accountant evidence", { exact: true })
    .fill("Synthetic basis and open-period classification");
}
async function prepare(p: Page, reference: string, target = 4000) {
  await fillPreparation(p, reference, target);
  await panel(p)
    .getByRole("button", { name: "Review valuation adjustment", exact: true })
    .click();
  await expect(review(p).getByRole("heading")).toBeFocused();
  expect(await review(p).locator("input,select,textarea").count()).toBe(0);
}
async function rows(p: Page, unitId: string) {
  return (
    await (
      await p.request.get(`${origin}/api/stock/${unitId}/valuations`)
    ).json()
  ).rows;
}

test("browser: Canada-resident organization can review and prepare its configured USD valuation", async ({
  page,
}) => {
  const server = "http://127.0.0.1:3292";
  await signIn(page, "admin@example.test", server);
  await open(page);
  await configure(page);
  await expect(
    panel(page).getByRole("heading", {
      name: "Prepare valuation adjustment",
      exact: true,
    }),
  ).toBeVisible();
  await prepare(page, "BROWSER-CA-USD", 4500);
  await expect(review(page)).toContainText("CA · USD");
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    panel(page).getByText("BROWSER-CA-USD", { exact: true }),
  ).toBeVisible();
  const stock = (
    await (await page.request.get(`${server}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S1");
  const valuations = (
    await (
      await page.request.get(`${server}/api/stock/${unit.id}/valuations`)
    ).json()
  ).rows;
  expect(valuations).toHaveLength(1);
  expect(valuations[0].review.region).toBe("CA");
  expect(valuations[0].review.currency).toBe("USD");
  expect(valuations[0].state).toBe("ready");
  expect(valuations[0].review.unit.cost).toBe(6000);
});

test("browser: valuation explains a closed posting period before retaining or sending an adjustment", async ({
  page,
}) => {
  const server = "http://127.0.0.1:3292";
  await signIn(page, "admin@example.test", server);
  await open(page, "S2");
  const stock = (
    await (await page.request.get(`${server}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S2");
  if (
    !(
      await (
        await page.request.get(
          `${server}/api/stock/${unit.id}/valuation-policy`,
        )
      ).json()
    ).policy
  )
    await configure(page);
  let sends = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/commands/inventory.valuation.prepare"))
      sends++;
  });
  await fillPreparation(page, "BROWSER-OPEN-PERIOD");
  await panel(page)
    .getByLabel("Posting date", { exact: true })
    .fill("2026-08-31");
  await panel(page)
    .getByRole("button", { name: "Review valuation adjustment", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Posting date must be in an open period",
  );
  await expect(review(page)).toHaveCount(0);
  expect(sends).toBe(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("distributor-valuation:"),
      ),
    ),
  ).toHaveLength(0);
  await panel(page)
    .getByLabel("Posting date", { exact: true })
    .fill("2026-10-03");
  await panel(page)
    .getByRole("button", { name: "Review valuation adjustment", exact: true })
    .click();
  await expect(review(page).getByRole("heading")).toBeFocused();
  expect(sends).toBe(0);
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    panel(page).getByText("BROWSER-OPEN-PERIOD", { exact: true }),
  ).toBeVisible();
  expect(sends).toBe(1);
});

test("browser: valuation evidence and fixed review fit a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const server = "http://127.0.0.1:3292";
  await signIn(page, "admin@example.test", server);
  await open(page, "S3");
  const stock = (
    await (await page.request.get(`${server}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S3");
  if (
    !(
      await (
        await page.request.get(
          `${server}/api/stock/${unit.id}/valuation-policy`,
        )
      ).json()
    ).policy
  )
    await configure(page);
  await expect(
    panel(page).getByRole("heading", {
      name: "Prepare valuation adjustment",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await panel(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await prepare(page, "BROWSER-PHONE-REVIEW");
  expect(
    await review(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await review(page)
    .getByRole("button", { name: "Back to valuation", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("distributor-valuation:"),
      ),
    ),
  ).toHaveLength(0);
});

test("browser: damaged valuation recovery evidence blocks replacement writes and remains intact", async ({
  page,
}) => {
  const server = "http://127.0.0.1:3292";
  await signIn(page, "admin@example.test", server);
  const { actor } = await (
    await page.request.get(`${server}/api/session`)
  ).json();
  const key = `distributor-valuation:${actor.orgId}:${actor.id}`;
  const damaged = '{"version":1,"kind":"prepare","fingerprint":"damaged"}';
  await page.evaluate(
    ({ key, damaged }) => localStorage.setItem(key, damaged),
    { key, damaged },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await inventory(page);
  await open(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Valuation recovery evidence cannot be verified" })
      .first(),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", {
      name: "Review valuation policy",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Recover exact valuation attempt",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    damaged,
  );
});

test("browser: valuation policy and fixed adjustment require a separate finance approval without rewriting acquisition", async ({
  page,
  context,
}) => {
  await signIn(page);
  await open(page);
  await configure(page);
  const stock = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S1");
  await prepare(page, "BROWSER-VALUE-1");
  await expect(review(page)).toContainText("4000");
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    panel(page).getByText("BROWSER-VALUE-1", { exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Review decision", exact: true }),
  ).toBeDisabled();
  const c = await context.browser()!.newContext();
  const second = await c.newPage();
  try {
    await signIn(second, "valuation@example.test");
    await open(second);
    await panel(second)
      .getByLabel("Decision reason", { exact: true })
      .fill("Synthetic independent assessment");
    await panel(second)
      .getByRole("button", { name: "Review decision", exact: true })
      .click();
    await expect(review(second)).toContainText("BROWSER-VALUE-1");
    await review(second)
      .getByRole("button", { name: "Confirm exact valuation", exact: true })
      .click();
    await expect(
      panel(second).getByText("reviewed", { exact: true }),
    ).toBeVisible();
    expect((await rows(second, unit.id))[0].decision.by).not.toBe(
      (await rows(second, unit.id))[0].createdBy,
    );
    const current = await (
      await second.request.get(
        `${origin}/api/stock/${unit.id}/valuation-review`,
      )
    ).json();
    expect(current.carryingValue).toBe(4000);
    expect(current.unit.cost).toBe(6000);
    expect(current.unit.quantity).toBe(1);
  } finally {
    await c.close();
  }
});

test("browser: malformed valuation approval reply retains evidence and recovers the native terminal decision without resend", async ({
  page,
  context,
}) => {
  await signIn(page);
  await open(page, "S3");
  const stock = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S3");
  if (
    !(
      await (
        await page.request.get(
          `${origin}/api/stock/${unit.id}/valuation-policy`,
        )
      ).json()
    ).policy
  )
    await configure(page);
  await prepare(page, "BROWSER-MALFORMED-APPROVAL", 4300);
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    panel(page).getByText("BROWSER-MALFORMED-APPROVAL", { exact: true }),
  ).toBeVisible();
  const c = await context.browser()!.newContext();
  const second = await c.newPage();
  let decisions = 0;
  try {
    await signIn(second, "valuation@example.test");
    await open(second, "S3");
    await panel(second)
      .getByLabel("Decision reason", { exact: true })
      .fill("Independent synthetic approval reason");
    await panel(second)
      .getByRole("button", { name: "Review decision", exact: true })
      .click();
    await second.route(
      "**/api/commands/inventory.valuation.decide",
      async (route) => {
        decisions++;
        const response = await route.fetch();
        const body = await response.json();
        body.decision.reason = "Unreviewed replacement reason";
        await route.fulfill({ response, json: body });
      },
    );
    await review(second)
      .getByRole("button", { name: "Confirm exact valuation", exact: true })
      .click();
    await expect(panel(second).getByRole("alert")).toBeVisible();
    expect(decisions).toBe(1);
    const retained = await second.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("distributor-valuation:"),
      );
      return key ? localStorage.getItem(key) : null;
    });
    expect(retained).not.toBeNull();
    const original = JSON.parse(retained!);
    expect(original.kind).toBe("decide");
    expect(original.payload.reason).toBe(
      "Independent synthetic approval reason",
    );
    expect((await rows(second, unit.id))[0].state).toBe("reviewed");
    await second.reload();
    await expect(
      second.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await inventory(second);
    await second
      .getByRole("button", {
        name: "Recover exact valuation attempt",
        exact: true,
      })
      .click();
    await expect(review(second)).toContainText(original.payload.reason);
    await review(second)
      .getByRole("button", { name: "Confirm exact valuation", exact: true })
      .click();
    await expect(
      second.getByRole("button", {
        name: "Recover exact valuation attempt",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(review(second)).toHaveCount(0);
    expect(decisions).toBe(1);
    const native = (await rows(second, unit.id)).filter(
      (v: any) => v.reference === "BROWSER-MALFORMED-APPROVAL",
    );
    expect(native).toHaveLength(1);
    expect(native[0].decision.reason).toBe(original.payload.reason);
    const current = await (
      await second.request.get(
        `${origin}/api/stock/${unit.id}/valuation-review`,
      )
    ).json();
    expect(current.carryingValue).toBe(4300);
    expect(current.unit.cost).toBe(6000);
    expect(current.unit.quantity).toBe(1);
  } finally {
    await c.close();
  }
});

test("browser: lost valuation preparation reply survives reload and retries its original body and key once", async ({
  page,
}) => {
  await signIn(page);
  await open(page, "S2");
  const stock = (
    await (await page.request.get(`${origin}/api/dashboard`)).json()
  ).stock;
  const unit = stock.find((s: any) => s.serial === "S2");
  const policy = await (
    await page.request.get(`${origin}/api/stock/${unit.id}/valuation-policy`)
  ).json();
  if (!policy.policy) await configure(page);
  const sent: { key: string | undefined; body: string | null }[] = [];
  await page.route(
    "**/api/commands/inventory.valuation.prepare",
    async (route) => {
      sent.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      await route.fetch();
      await route.abort("failed");
    },
  );
  await prepare(page, "BROWSER-LOST-PREPARATION", 4200);
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  const retained = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-valuation:"),
    );
    return key ? localStorage.getItem(key) : null;
  });
  expect(retained).not.toBeNull();
  const original = JSON.parse(retained!);
  expect(sent).toHaveLength(1);
  expect(original.key).toBe(sent[0]!.key);
  expect(original.payload.reference).toBe("BROWSER-LOST-PREPARATION");
  expect(
    (await rows(page, unit.id)).filter(
      (v: any) => v.reference === original.payload.reference,
    ),
  ).toHaveLength(1);
  await page.unroute("**/api/commands/inventory.valuation.prepare");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await inventory(page);
  await page
    .getByRole("button", {
      name: "Recover exact valuation attempt",
      exact: true,
    })
    .click();
  await expect(review(page)).toContainText("BROWSER-LOST-PREPARATION");
  expect(await review(page).locator("input,select,textarea").count()).toBe(0);
  await page.route(
    "**/api/commands/inventory.valuation.prepare",
    async (route) => {
      sent.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      await route.continue();
    },
  );
  await review(page)
    .getByRole("button", { name: "Confirm exact valuation", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Recover exact valuation attempt",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(review(page)).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        Object.keys(localStorage).find((k) =>
          k.startsWith("distributor-valuation:"),
        ) ?? "missing",
      ),
    ),
  ).toBeNull();
  const native = (await rows(page, unit.id)).filter(
    (v: any) => v.reference === original.payload.reference,
  );
  expect(native).toHaveLength(1);
  expect(native[0].state).toBe("ready");
  expect(native[0].input.targetValue).toBe(4200);
  const current = await (
    await page.request.get(`${origin}/api/stock/${unit.id}/valuation-review`)
  ).json();
  expect(current.carryingValue).toBe(6000);
  expect(current.unit.quantity).toBe(1);
});
