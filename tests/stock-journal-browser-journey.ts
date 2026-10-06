import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
import { test, expect, type Page, type Browser } from "@playwright/test";
const origin = "http://127.0.0.1:3168",
  historyOrigin = "http://127.0.0.1:3169";
const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const frozen = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Frozen stock journal review",
    exact: true,
  });
const recovery = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Journal decision recovery",
    exact: true,
  });
const exact = (page: Page) =>
  recovery(page).getByRole("region", {
    name: "Exact journal decision review",
    exact: true,
  });
async function signIn(page: Page, role = "finance", url = origin) {
  // Same-document navigation to a sign-in route is only meaningful once the
  // previous principal has been fully signed out.
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await page.goto(url + "/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill(`${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(
      role === "finance"
        ? "test-only-long-password"
        : "long-test-only-password",
    );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await billing(page);
}
// Native dashboard facts. Operational analytics stamp each read with its
// observation time, so only those read-time stamps are excluded.
async function dashboardFacts(page: Page) {
  const response = await page.request.get(`${origin}/api/dashboard`);
  expect(response.status()).toBe(200);
  const dashboard = await response.json();
  for (const section of [
    dashboard.analytics?.orders,
    dashboard.analytics?.invoices,
  ])
    if (section?.period) delete section.period.asOf;
  if (dashboard.analytics?.invoices)
    delete dashboard.analytics.invoices.agingAsOf;
  return dashboard;
}
async function billing(page: Page) {
  await navigateAccounting(page, "Stock journals");
  await expect(panel(page)).toBeVisible();
}
async function retained(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-journal-decision:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
async function ready(page: Page, browser: Browser) {
  let list = await (
    await page.request.get(`${origin}/api/accounting/journals?state=ready`)
  ).json();
  if (!list.items.length) {
    const ctx = await browser.newContext(),
      admin = await ctx.newPage();
    try {
      await signIn(admin, "admin");
      const journals = await (
        await admin.request.get(`${origin}/api/accounting/journals`)
      ).json();
      const detail = await (
        await admin.request.get(
          `${origin}/api/accounting/journals/${journals.items[0].id}`,
        )
      ).json();
      const session = await (
        await admin.request.get(`${origin}/api/session`)
      ).json();
      const reply = await admin.request.post(
        `${origin}/api/commands/accounting.journal.prepare`,
        {
          headers: {
            origin,
            "x-csrf-token": session.csrf,
            "idempotency-key": crypto.randomUUID(),
          },
          data: detail.plan.input,
        },
      );
      expect(reply.ok(), await reply.text()).toBeTruthy();
    } finally {
      await ctx.close();
    }
    list = await (
      await page.request.get(`${origin}/api/accounting/journals?state=ready`)
    ).json();
  }
  expect(list.items).toHaveLength(1);
  await panel(page)
    .getByLabel("Journal queue state", { exact: true })
    .selectOption("ready");
  await panel(page)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await panel(page)
    .getByRole("button", {
      name: `Review journal ${list.items[0].requestRef}`,
      exact: true,
    })
    .click();
  await expect(
    frozen(page).getByRole("heading", {
      name: "Frozen stock journal review",
      exact: true,
    }),
  ).toBeFocused();
  return list.items[0];
}
async function review(page: Page, reason: string, decision = "reject") {
  await recovery(page)
    .getByLabel("Journal decision", { exact: true })
    .selectOption(decision);
  await recovery(page)
    .getByLabel("Journal decision reason", { exact: true })
    .fill(reason);
  await recovery(page)
    .getByRole("button", { name: "Review exact journal decision", exact: true })
    .click();
  await expect(exact(page).getByRole("heading")).toBeFocused();
  await expect(exact(page)).toContainText(reason);
  expect(await exact(page).locator("input, textarea, select").count()).toBe(0);
}

test("browser: journal queue and complete observation pages retry exact cursors without provider effects", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "admin");
  const before = await dashboardFacts(page);
  await panel(page)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await expect(panel(page).getByText(/20 journals on this page/)).toBeVisible();
  const urls: string[] = [];
  await page.route("**/api/accounting/journals?after=*", async (route) => {
    urls.push(route.request().url());
    if (urls.length === 1) await route.abort();
    else await route.continue();
  });
  await panel(page)
    .getByRole("button", { name: "Older journals", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Retry journal read", exact: true })
    .click();
  await expect(panel(page).getByText(/6 journals on this page/)).toBeVisible();
  expect(urls).toHaveLength(2);
  expect(urls[1]).toBe(urls[0]);
  await panel(page)
    .getByRole("button", { name: "Newer journals", exact: true })
    .click();
  await expect(panel(page).getByText(/20 journals on this page/)).toBeVisible();
  await ready(page, browser);
  await expect(recovery(page)).toContainText(
    "different current finance principal",
  );
  const opener = panel(page)
    .getByRole("button", { name: /^Review journal/ })
    .first();
  await panel(page)
    .getByRole("button", { name: "Close journal review", exact: true })
    .click();
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(await dashboardFacts(page)).toEqual(before);
  const ctx = await browser.newContext(),
    history = await ctx.newPage();
  try {
    await signIn(history, "finance", historyOrigin);
    await panel(history)
      .getByRole("button", { name: "Load journal queue", exact: true })
      .click();
    await panel(history)
      .getByRole("button", { name: /^Review journal/ })
      .click();
    await expect(frozen(history)).toContainText("unknown");
    await expect(
      frozen(history).getByText(/20 observations on this page/),
    ).toBeVisible();
    const observations = frozen(history).getByRole("region", {
      name: "Journal observation history",
    });
    await expect(observations.getByText(/^Observation 26/)).toBeVisible();
    const paths: string[] = [];
    await history.route("**/observations?after=*", async (route) => {
      paths.push(route.request().url());
      if (paths.length === 1) await route.abort();
      else await route.continue();
    });
    await observations
      .getByRole("button", { name: "Older journal observations", exact: true })
      .click();
    await expect(panel(history).getByRole("alert")).toBeVisible();
    await panel(history)
      .getByRole("button", { name: "Retry journal read", exact: true })
      .click();
    await expect(
      observations.getByText(/6 observations on this page/),
    ).toBeVisible();
    expect(paths[1]).toBe(paths[0]);
    await expect(observations.getByText(/^Observation 1 ·/)).toBeVisible();
    await observations
      .getByRole("button", { name: "Newer journal observations", exact: true })
      .click();
    await expect(observations.getByText(/^Observation 26/)).toBeVisible();
    expect(await recovery(history).locator("form").count()).toBe(0);
  } finally {
    await ctx.close();
  }
});

test("browser: journal decisions survive lost replies reload and principal changes with exact native replay", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const journal = await ready(page, browser),
    before = await dashboardFacts(page);
  await review(page, "Synthetic retained independent rejection");
  const attempts: { key: string; body: string }[] = [];
  await page.route(
    "**/api/commands/accounting.journal.decide",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      if (attempts.length === 1) {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    },
  );
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision", exact: true })
    .click();
  await expect(recovery(page).getByRole("alert")).toBeVisible();
  const stored = (await retained(page))!;
  expect(JSON.parse(stored.raw).key).toBe(attempts[0]!.key);
  expect(JSON.stringify(JSON.parse(stored.raw).payload)).toBe(
    attempts[0]!.body,
  );
  expect(
    (
      await (
        await page.request.get(
          `${origin}/api/accounting/journals/${journal.id}`,
        )
      ).json()
    ).state,
  ).toBe("rejected");
  await page.reload();
  await billing(page);
  await expect(
    recovery(page).getByRole("button", {
      name: "Review retained journal decision",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "admin");
  await expect(
    recovery(page).getByRole("button", {
      name: "Review retained journal decision",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await recovery(page)
    .getByRole("button", { name: "Review retained journal decision" })
    .click();
  await exact(page)
    .getByRole("button", { name: "Retry exact journal decision" })
    .click();
  await expect(frozen(page)).toContainText("rejected");
  await expect(exact(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await retained(page)).toBeNull();
  expect(await dashboardFacts(page)).toEqual(before);
});

test("browser: journal storage and coordination failures block transport and fixed reviews reject changed evidence", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await ready(page, browser);
  await review(page, "Synthetic fixed decision");
  let sent = 0;
  await page.route(
    "**/api/commands/accounting.journal.decide",
    async (route) => {
      sent++;
      await route.continue();
    },
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).journalSet = original;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-journal-decision:"))
        throw Error("Synthetic storage unavailable");
      return original.call(this, key, value);
    };
  });
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toContainText(
    "Synthetic storage unavailable",
  );
  expect(sent).toBe(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).journalSet;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toContainText("Web Locks");
  expect(sent).toBe(0);
  await page.reload();
  await billing(page);
  await ready(page, browser);
  await review(page, "Synthetic fixed original");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const storageKey = `distributor-journal-decision:${session.actor.orgId}:${session.actor.id}`;
  await page.evaluate(
    (key) => localStorage.setItem(key, "damaged"),
    storageKey,
  );
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert").last()).toContainText(
    "recovery evidence is unavailable",
  );
  expect(sent).toBe(0);
  await expect(exact(page)).toContainText("Synthetic fixed original");
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload();
  await billing(page);
  await ready(page, browser);
  await review(page, "Synthetic first reviewed decision");
  // A second tab must not replace the user's already opened decision snapshot.
  const other = await page.context().newPage();
  try {
    await other.goto(origin);
    await billing(other);
    await ready(other, browser);
    await review(other, "Synthetic different retained decision");
    await other.route("**/api/commands/accounting.journal.decide", (route) =>
      route.abort(),
    );
    await exact(other)
      .getByRole("button", { name: "Confirm journal decision" })
      .click();
    await expect(recovery(other).getByRole("alert")).toBeVisible();
    await expect(exact(page)).toContainText(
      "Synthetic first reviewed decision",
    );
    await exact(page)
      .getByRole("button", { name: "Confirm journal decision" })
      .click();
    await expect(recovery(page).getByRole("alert")).toContainText(
      "evidence changed",
    );
    expect(sent).toBe(0);
    await exact(page)
      .getByRole("button", { name: "Close journal decision review" })
      .click();
    await recovery(page)
      .getByRole("button", { name: "Review retained journal decision" })
      .click();
    await expect(exact(page)).toContainText(
      "Synthetic different retained decision",
    );
    await exact(page)
      .getByRole("button", { name: "Retry exact journal decision" })
      .click();
    await expect(frozen(page)).toContainText("rejected");
    expect(sent).toBe(1);
  } finally {
    await other.close();
  }
});

test("browser: same-profile journal lock prevents overlapping decisions and preserves uncertain original", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await ready(page, browser);
  await review(page, "Synthetic lock owner decision");
  const other = await page.context().newPage();
  try {
    await other.goto(origin);
    await billing(other);
    await ready(other, browser);
    await review(other, "Synthetic competing decision");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = false,
      second = 0;
    await page.route(
      "**/api/commands/accounting.journal.decide",
      async (route) => {
        first = true;
        await held;
        await route.fetch();
        await route.abort();
      },
    );
    await other.route(
      "**/api/commands/accounting.journal.decide",
      async (route) => {
        second++;
        await route.continue();
      },
    );
    await exact(page)
      .getByRole("button", { name: "Confirm journal decision" })
      .click();
    await expect.poll(() => first).toBeTruthy();
    await exact(other)
      .getByRole("button", { name: "Confirm journal decision" })
      .click();
    await expect(recovery(other).getByRole("alert")).toContainText(
      "Another tab",
    );
    expect(second).toBe(0);
    release();
    await expect(recovery(page).getByRole("alert")).toBeVisible();
    await exact(other)
      .getByRole("button", { name: "Close journal decision review" })
      .click();
    await recovery(other)
      .getByRole("button", { name: "Review retained journal decision" })
      .click();
    await expect(exact(other)).toContainText("Synthetic lock owner decision");
    await exact(other)
      .getByRole("button", { name: "Retry exact journal decision" })
      .click();
    await expect(frozen(other)).toContainText("rejected");
    expect(second).toBe(1);
  } finally {
    await other.close();
  }
});

test("browser: abandoned journal reads do not reopen closed or navigated reviews", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const journal = await ready(page, browser);
  let release!: () => void;
  let held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = false;
  await page.route(
    `**/api/accounting/journals/${journal.id}`,
    async (route) => {
      reached = true;
      const reply = await route.fetch();
      await held;
      await route.fulfill({ response: reply });
    },
  );
  await panel(page)
    .getByRole("button", { name: "Refresh journal review" })
    .click();
  await expect.poll(() => reached).toBeTruthy();
  await panel(page)
    .getByRole("button", { name: "Close journal review", exact: true })
    .click();
  release();
  await expect(frozen(page)).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  reached = false;
  await page.route(
    `**/api/accounting/journals/${journal.id}`,
    async (route) => {
      reached = true;
      const reply = await route.fetch();
      await held;
      await route.fulfill({ response: reply });
    },
  );
  await panel(page)
    .getByRole("button", { name: /^Review journal/ })
    .click();
  await expect.poll(() => reached).toBeTruthy();
  await navigateWorkspace(page, "Overview");
  release();
  await page.unrouteAll({ behavior: "wait" });
  await billing(page);
  await expect(frozen(page)).toHaveCount(0);
  await expect(
    panel(page).getByText("Loading journal review…", { exact: true }),
  ).toHaveCount(0);
});

test("browser: journal authority failure retains the original and native pre-effect refusal clears only that attempt", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const journal = await ready(page, browser);
  await review(page, "Synthetic expired-session review");
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const loggedOut = await page.request.post(`${origin}/api/logout`, {
    headers: { origin, "x-csrf-token": session.csrf },
  });
  expect(loggedOut.ok()).toBeTruthy();
  const attempts: { key: string; body: string }[] = [];
  await page.route(
    "**/api/commands/accounting.journal.decide",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.continue();
    },
  );
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toBeVisible();
  expect(await retained(page)).not.toBeNull();
  // The browser learns that its server session ended when it next reads the
  // session; the retained attempt survives that reload.
  await page.reload();
  await signIn(page);
  // A separate request records a competing decision; the old submitted attempt has no effect.
  const currentSession = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const reply = await page.request.post(
    `${origin}/api/commands/accounting.journal.decide`,
    {
      headers: {
        origin,
        "x-csrf-token": currentSession.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        journalId: journal.id,
        reviewHash: journal.reviewHash,
        decision: "reject",
        reason: "Synthetic competing native review",
      },
    },
  );
  expect(reply.ok(), await reply.text()).toBeTruthy();
  await recovery(page)
    .getByRole("button", { name: "Review retained journal decision" })
    .click();
  await exact(page)
    .getByRole("button", { name: "Retry exact journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toContainText(
    "JOURNAL_DECISION",
  );
  await expect(frozen(page)).toContainText("Synthetic competing native review");
  expect(await retained(page)).toBeNull();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
});

test("browser: navigation during journal decision retains exact recovery after native commit", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await ready(page, browser);
  await review(page, "Synthetic abandoned submitted rejection");
  let release!: () => void,
    reached = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attempts: { key: string; body: string }[] = [];
  await page.route(
    "**/api/commands/accounting.journal.decide",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const reply = await route.fetch();
      if (attempts.length === 1) {
        reached = true;
        await held;
      }
      await route.fulfill({ response: reply });
    },
  );
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect.poll(() => reached).toBeTruthy();
  const stored = await retained(page);
  await navigateWorkspace(page, "Overview");
  release();
  await expect(panel(page)).toHaveCount(0);
  await billing(page);
  expect(await retained(page)).toEqual(stored);
  await recovery(page)
    .getByRole("button", { name: "Review retained journal decision" })
    .click();
  await exact(page)
    .getByRole("button", { name: "Retry exact journal decision" })
    .click();
  await expect(frozen(page)).toContainText("rejected");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await retained(page)).toBeNull();
});

test("browser: malformed journal receipts and cleanup failures retain exact approval without resending ledger effects", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const journal = await ready(page, browser);
  const before = await dashboardFacts(page);
  await review(page, "Synthetic independently queued approval", "approve");
  const attempts: { key: string; body: string }[] = [];
  await page.route(
    "**/api/commands/accounting.journal.decide",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const reply = await route.fetch();
      if (attempts.length === 1)
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...(await reply.json()), reviewHash: "bad" }),
        });
      else await route.fulfill({ response: reply });
    },
  );
  await exact(page)
    .getByRole("button", { name: "Confirm journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toContainText(
    "reply could not be confirmed",
  );
  const stored = (await retained(page))!;
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    (window as any).journalRemove = original;
    Storage.prototype.removeItem = function (key) {
      if (!key.startsWith("distributor-journal-decision:"))
        original.call(this, key);
    };
  });
  await exact(page)
    .getByRole("button", { name: "Retry exact journal decision" })
    .click();
  await expect(recovery(page).getByRole("alert")).toContainText(
    "could not be cleared",
  );
  expect(await retained(page)).toEqual(stored);
  await page.evaluate(() => {
    Storage.prototype.removeItem = (window as any).journalRemove;
  });
  await exact(page)
    .getByRole("button", { name: "Retry exact journal decision" })
    .click();
  await expect(frozen(page)).toContainText("pending");
  await expect(exact(page)).toHaveCount(0);
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every(
      (a) => a.key === attempts[0]!.key && a.body === attempts[0]!.body,
    ),
  ).toBeTruthy();
  expect(await retained(page)).toBeNull();
  const current = await (
    await page.request.get(`${origin}/api/accounting/journals/${journal.id}`)
  ).json();
  expect(current.state).toBe("pending");
  expect(current.observations).toHaveLength(0);
  expect(current.dispatched).toBe(false);
  expect(await dashboardFacts(page)).toEqual(before);
});
