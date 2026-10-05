import { navigateAccounting } from "./workspace-navigation.ts";
// Synthetic browser recovery and independent attestations; no provider transport.
import { test, expect, type Page } from "@playwright/test";
const ca = "http://127.0.0.1:3170",
  us = "http://127.0.0.1:3171";
const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const recovery = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Journal cancellation recovery",
    exact: true,
  });
const exact = (page: Page) =>
  recovery(page).getByRole("region", {
    name: "Exact journal cancellation review",
    exact: true,
  });
async function signIn(page: Page, origin = ca, role = "admin") {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill(`${role}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(
      role === "admin" ? "long-test-only-password" : "test-only-long-password",
    );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await billing(page);
}
async function billing(page: Page) {
  await navigateAccounting(page, "Stock journals");
  await expect(panel(page)).toBeVisible();
}
async function open(page: Page, origin = ca) {
  const list = await (
    await page.request.get(`${origin}/api/accounting/journals?state=unknown`)
  ).json();
  expect(list.items).toHaveLength(1);
  await panel(page)
    .getByLabel("Journal queue state", { exact: true })
    .selectOption("unknown");
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
    panel(page).getByRole("heading", {
      name: "Frozen stock journal review",
      exact: true,
    }),
  ).toBeVisible();
  return list.items[0];
}
async function review(
  page: Page,
  reason = "Synthetic independently checked same external attempt",
) {
  await recovery(page)
    .getByRole("button", {
      name: "Load final cancellation evidence",
      exact: true,
    })
    .click();
  await recovery(page)
    .getByLabel("Journal cancellation reason", { exact: true })
    .fill(reason);
  await recovery(page)
    .getByRole("button", {
      name: "Review exact journal cancellation",
      exact: true,
    })
    .click();
  await expect(exact(page).getByRole("heading")).toBeFocused();
  expect(await exact(page).locator("input, textarea, select").count()).toBe(0);
  await expect(exact(page)).toContainText(reason);
}
async function retained(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-journal-cancellation:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
const confirm = (page: Page) =>
  exact(page)
    .getByRole("button", { name: "Confirm journal cancellation", exact: true })
    .click();
const retry = (page: Page) =>
  exact(page)
    .getByRole("button", {
      name: "Retry exact journal cancellation",
      exact: true,
    })
    .click();
const restore = async (page: Page) => {
  await recovery(page)
    .getByRole("button", {
      name: "Review retained journal cancellation",
      exact: true,
    })
    .click();
  await expect(exact(page).getByRole("heading")).toBeFocused();
};

test("browser: journal cancellation refuses self-review, damaged storage, unwritable storage and missing tab coordination", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const journal = await open(page);
  const context = await browser.newContext(),
    finance = await context.newPage();
  try {
    await signIn(finance, ca, "finance");
    await open(finance);
    await recovery(finance)
      .getByRole("button", {
        name: "Load final cancellation evidence",
        exact: true,
      })
      .click();
    await expect(recovery(finance)).toContainText(
      "A different current finance principal must bind",
    );
    await expect(
      recovery(finance).getByRole("button", {
        name: "Review exact journal cancellation",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.journal.cancel-correction"))
      posts++;
  });
  const session = await (await page.request.get(`${ca}/api/session`)).json();
  const key = `distributor-journal-cancellation:${session.actor.orgId}:${session.actor.id}`;
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), key);
  await page.reload();
  await billing(page);
  await expect(recovery(page)).toContainText(
    "recovery evidence is unavailable",
  );
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.reload();
  await billing(page);
  await open(page);
  await review(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("Synthetic storage failure");
    };
  });
  await confirm(page);
  await expect(recovery(page).getByRole("alert")).toContainText(
    "Synthetic storage failure",
  );
  expect(await retained(page)).toBeNull();
  expect(posts).toBe(0);
  await page.reload();
  await billing(page);
  await open(page);
  await review(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await confirm(page);
  await expect(recovery(page).getByRole("alert")).toContainText(
    "Web Locks support",
  );
  expect(posts).toBe(0);
  expect(await retained(page)).toBeNull();
  const current = await (
    await page.request.get(`${ca}/api/accounting/journals/${journal.id}`)
  ).json();
  expect(current.state).toBe("unknown");
  expect(current.observations).toHaveLength(1);
});

test("browser: journal cancellation abandons late evidence and preserves fixed review across changed retained evidence", async ({
  page,
}) => {
  await signIn(page);
  await open(page);
  let release!: () => void, entered!: () => void, finished!: () => void;
  const completed = new Promise<void>((resolve) => (finished = resolve));
  const held = new Promise<void>((resolve) => (release = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  await page.route("**/cancellation-review", async (route) => {
    const response = await route.fetch();
    entered();
    await held;
    try {
      await route.fulfill({ response });
    } catch (error) {
      // Closing the native review aborts the fetch before this delayed delivery.
      expect(String(error)).toMatch(/already handled|closed|aborted/);
    } finally {
      finished();
    }
  });
  await recovery(page)
    .getByRole("button", {
      name: "Load final cancellation evidence",
      exact: true,
    })
    .click();
  await started;
  await panel(page)
    .getByRole("button", { name: "Close journal review", exact: true })
    .click();
  release();
  await completed;
  await page.unroute("**/cancellation-review");
  await expect(
    recovery(page).getByRole("region", {
      name: "Retained final cancellation evidence",
      exact: true,
    }),
  ).toHaveCount(0);
  await open(page);
  await review(page, "Synthetic fixed cancellation review");
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("cancel-correction")) posts++;
  });
  const session = await (await page.request.get(`${ca}/api/session`)).json();
  const key = `distributor-journal-cancellation:${session.actor.orgId}:${session.actor.id}`;
  await page.evaluate((key) => {
    localStorage.setItem(key, "{broken");
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, key);
  await expect(exact(page)).toContainText(
    "Synthetic fixed cancellation review",
  );
  await expect(recovery(page)).toContainText(
    "recovery evidence is unavailable",
  );
  await expect(
    exact(page).getByRole("button", {
      name: "Confirm journal cancellation",
      exact: true,
    }),
  ).toBeDisabled();
  expect(posts).toBe(0);
});

test("browser: journal cancellation lost success recovers exact original after reload and sign-in without duplicate observations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const journal = await open(page);
  await review(page);
  const sends: { key: string | null; body: string | null }[] = [];
  await page.route(
    "**/api/commands/accounting.journal.cancel-correction",
    async (route) => {
      sends.push({
        key: route.request().headers()["idempotency-key"] ?? null,
        body: route.request().postData(),
      });
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    },
  );
  await confirm(page);
  await expect(recovery(page).getByRole("alert")).toBeVisible();
  const saved = await retained(page);
  expect(saved).not.toBeNull();
  await page.unroute("**/api/commands/accounting.journal.cancel-correction");
  await page.reload();
  await billing(page);
  await restore(page);
  await expect(exact(page)).toContainText(journal.requestRef);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await exact(page)
    .getByRole("button", {
      name: "Close journal cancellation review",
      exact: true,
    })
    .click();
  await expect(
    recovery(page).getByRole("button", {
      name: "Review retained journal cancellation",
      exact: true,
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, ca, "finance");
  await expect(
    recovery(page).getByRole("button", {
      name: "Review retained journal cancellation",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await restore(page);
  page.on("request", (r) => {
    if (r.url().endsWith("cancel-correction"))
      sends.push({
        key: r.headers()["idempotency-key"] ?? null,
        body: r.postData(),
      });
  });
  await retry(page);
  await expect(
    panel(page).getByRole("region", {
      name: "Frozen stock journal review",
      exact: true,
    }),
  ).toContainText("cancelled");
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(await retained(page)).toBeNull();
  const current = await (
    await page.request.get(`${ca}/api/accounting/journals/${journal.id}`)
  ).json();
  expect(
    current.observations.filter(
      (o: { body: { outcome: string } }) =>
        o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(1);
});

test("browser: US journal cancellation retains malformed receipts and failed cleanup then recovers exact historical receipt", async ({
  page,
}) => {
  await signIn(page, us);
  const journal = await open(page, us);
  await review(page);
  const sends: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("cancel-correction"))
      sends.push(r.headers()["idempotency-key"] + ":" + r.postData());
  });
  await page.route(
    "**/api/commands/accounting.journal.cancel-correction",
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...(await response.json()),
          cancellation: { recordedBy: "wrong-principal" },
        }),
      });
    },
  );
  await confirm(page);
  await expect(recovery(page).getByRole("alert")).toContainText(
    "reply could not be confirmed",
  );
  const saved = await retained(page);
  expect(saved).not.toBeNull();
  await page.unroute("**/api/commands/accounting.journal.cancel-correction");
  await page.reload();
  await billing(page);
  await restore(page);
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw Error("Synthetic cleanup failure");
    };
  });
  await retry(page);
  await expect(recovery(page).getByRole("alert")).toContainText(
    "Synthetic cleanup failure",
  );
  expect(await retained(page)).toEqual(saved);
  await page.reload();
  await billing(page);
  await restore(page);
  await retry(page);
  await expect(
    panel(page).getByRole("region", {
      name: "Frozen stock journal review",
      exact: true,
    }),
  ).toContainText("cancelled");
  expect(await retained(page)).toBeNull();
  expect(sends).toHaveLength(3);
  expect(new Set(sends).size).toBe(1);
  const current = await (
    await page.request.get(`${us}/api/accounting/journals/${journal.id}`)
  ).json();
  expect(
    current.observations.filter(
      (o: { body: { outcome: string } }) =>
        o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(1);
});
