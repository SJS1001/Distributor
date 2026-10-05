import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
// Synthetic approved sources and local-only preparations; no provider transport.
import { test, expect, type Page } from "@playwright/test";
const origin = (port: number) => `http://127.0.0.1:${port}`;
const panel = (page: Page) =>
  page.getByRole("region", { name: "Prepare stock journal", exact: true });
const review = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Exact journal preparation review",
    exact: true,
  });
const command = "**/api/commands/accounting.journal.prepare";
async function signIn(page: Page, port: number) {
  await page.goto(origin(port) + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
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
async function source(page: Page, port: number, leg = "original") {
  const costs = await (
    await page.request.get(`${origin(port)}/api/accounting/costs`)
  ).json();
  const packet = costs.items.find((p: any) => p.state === "reviewed");
  expect(packet).toBeTruthy();
  let id = packet.id;
  if (leg !== "original") {
    const corrections = await (
      await page.request.get(
        `${origin(port)}/api/accounting/costs/${id}/corrections`,
      )
    ).json();
    id = corrections.find((p: any) => p.state === "reviewed").id;
  }
  await panel(page)
    .getByLabel("Approved stock-cost source ID", { exact: true })
    .fill(id);
  await panel(page)
    .getByLabel("Source journal leg", { exact: true })
    .selectOption(leg);
  await panel(page)
    .getByRole("button", { name: "Load approved journal source", exact: true })
    .click();
  await expect(
    panel(page).getByRole("region", {
      name: "Approved journal source review",
      exact: true,
    }),
  ).toBeVisible();
  return id;
}
async function mapping(page: Page) {
  const inputs = panel(page)
    .getByRole("form", { name: "Map journal accounts", exact: true })
    .getByLabel(/^QuickBooks account for /);
  for (let i = 0; i < (await inputs.count()); i++)
    await inputs.nth(i).fill(String(10 + i));
  await panel(page)
    .getByLabel("Organization credential binding ID", { exact: true })
    .fill("synthetic-org-binding");
  await panel(page)
    .getByLabel("Journal preparation reason", { exact: true })
    .fill("Synthetic fixed source company date and account review");
}
async function freeze(page: Page) {
  await mapping(page);
  await panel(page)
    .getByRole("button", {
      name: "Review exact journal preparation",
      exact: true,
    })
    .click();
  await expect(review(page).getByRole("heading")).toBeFocused();
  expect(await review(page).locator("input,select,textarea").count()).toBe(0);
}
async function retained(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-journal-preparation:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
const confirm = (page: Page) =>
  review(page)
    .getByRole("button", { name: "Confirm journal preparation", exact: true })
    .click();
async function recover(page: Page) {
  await panel(page)
    .getByRole("button", {
      name: "Review retained journal preparation",
      exact: true,
    })
    .click();
  await review(page)
    .getByRole("button", {
      name: "Recover exact journal preparation",
      exact: true,
    })
    .click();
}
async function journals(page: Page, port: number) {
  return (
    await (
      await page.request.get(
        `${origin(port)}/api/accounting/journals?state=ready`,
      )
    ).json()
  ).items;
}

test("journal preparation browser: phone fixed source and distinct accounts require explicit confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, 3172);
  const before = await (
    await page.request.get(`${origin(3172)}/api/dashboard`)
  ).json();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.journal.prepare")) posts++;
  });
  const id = await source(page, 3172);
  await mapping(page);
  await panel(page)
    .getByLabel("QuickBooks account for 2100", { exact: true })
    .fill("10");
  await panel(page)
    .getByRole("button", {
      name: "Review exact journal preparation",
      exact: true,
    })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "distinct positive numeric",
  );
  expect(posts).toBe(0);
  await freeze(page);
  await expect(review(page)).toContainText(id);
  await expect(review(page)).toContainText("CAD");
  expect(posts).toBe(0);
  await review(page)
    .getByRole("button", { name: "Close preparation review", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Load approved journal source",
      exact: true,
    }),
  ).toBeFocused();
  await source(page, 3172);
  await freeze(page);
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  expect(posts).toBe(1);
  expect(await retained(page)).toBeNull();
  const ready = await journals(page, 3172);
  expect(ready).toHaveLength(1);
  const detail = await (
    await page.request.get(
      `${origin(3172)}/api/accounting/journals/${ready[0].id}`,
    )
  ).json();
  expect(detail.state).toBe("ready");
  expect(detail.plan.input.sourceId).toBe(id);
  expect(detail.plan.input.accounts).toEqual([
    { sourceAccount: "1200", accountId: "10" },
    { sourceAccount: "2100", accountId: "11" },
  ]);
  const after = await (
    await page.request.get(`${origin(3172)}/api/dashboard`)
  ).json();
  expect(after.stock).toEqual(before.stock);
  expect(after.invoices).toEqual(before.invoices);
  expect(errors).toEqual([]);
});

test("journal preparation browser: malformed US replies retain exact key and original receipt recovery never reposts", async ({
  page,
}) => {
  await signIn(page, 3173);
  await source(page, 3173);
  await freeze(page);
  await expect(review(page)).toContainText("USD");
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(command, async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    await route.fetch();
    await route.fulfill({
      status: 200,
      json: { state: "ready", id: "invented" },
    });
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "reply could not be confirmed",
  );
  const held = await retained(page);
  expect(held).not.toBeNull();
  expect(JSON.parse(held!.raw).key).toBe(requests[0]!.key);
  expect(JSON.parse(held!.raw).payload).toEqual(JSON.parse(requests[0]!.body!));
  await page.reload();
  await billing(page);
  await page.route(
    "**/api/accounting/journal-preparations/*/receipt",
    (route) =>
      route.fulfill({
        status: 200,
        json: { receipt: null, currentState: "ready" },
      }),
  );
  await recover(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "recovery reply could not be confirmed",
  );
  expect(await retained(page)).toEqual(held);
  expect(requests).toHaveLength(1);
  await page.unroute("**/api/accounting/journal-preparations/*/receipt");
  await review(page)
    .getByRole("button", {
      name: "Recover exact journal preparation",
      exact: true,
    })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  expect(requests).toHaveLength(1);
  expect(await retained(page)).toBeNull();
  expect(await journals(page, 3173)).toHaveLength(1);
});

test("journal preparation browser: closed dates remain disabled and failed source reads retry captured selection", async ({
  page,
}) => {
  await signIn(page, 3174);
  let first = true;
  const reads: string[] = [];
  await page.route("**/api/accounting/journal-sources/*?*", async (route) => {
    reads.push(route.request().url());
    if (first) {
      first = false;
      await route.fulfill({
        status: 503,
        json: { message: "Synthetic source read failure" },
      });
    } else await route.continue();
  });
  const costs = await (
    await page.request.get(`${origin(3174)}/api/accounting/costs`)
  ).json();
  await panel(page)
    .getByLabel("Approved stock-cost source ID", { exact: true })
    .fill(costs.items[0].id);
  await panel(page)
    .getByRole("button", { name: "Load approved journal source", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic source read failure",
  );
  await panel(page)
    .getByLabel("Approved stock-cost source ID", { exact: true })
    .fill("changed-form-value");
  await panel(page)
    .getByRole("button", { name: "Retry journal source read", exact: true })
    .click();
  await expect(
    panel(page).getByLabel("Approved journal posting date", { exact: true }),
  ).toHaveValue("2026-10-03");
  expect(reads[1]).toBe(reads[0]);
  expect(
    await panel(page)
      .getByLabel("Approved journal posting date", { exact: true })
      .getByRole("option", { name: "2026-10-01", exact: true })
      .isDisabled(),
  ).toBe(true);
  await expect(panel(page).getByRole("table")).toContainText("60.00");
  expect(await journals(page, 3174)).toHaveLength(0);
});

test("journal preparation browser: unavailable storage and missing coordination send no command", async ({
  page,
}) => {
  await signIn(page, 3174);
  await source(page, 3174);
  await freeze(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.journal.prepare")) posts++;
  });
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw Error("Synthetic storage unavailable");
    };
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic storage unavailable",
  );
  expect(posts).toBe(0);
  await page.reload();
  await billing(page);
  await source(page, 3174);
  await freeze(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Web Locks support",
  );
  expect(posts).toBe(0);
});

test("journal preparation browser: another tab's retained attempt cannot overwrite a fixed review", async ({
  page,
  context,
}) => {
  await signIn(page, 3174);
  await source(page, 3174);
  await freeze(page);
  const session = await (
    await page.request.get(`${origin(3174)}/api/session`)
  ).json();
  const key = `distributor-journal-preparation:${session.actor.orgId}:${session.actor.id}`;
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.journal.prepare")) posts++;
  });
  const second = await context.newPage();
  await second.goto(origin(3174));
  await second.evaluate(
    (key) => localStorage.setItem(key, "malformed-other-tab"),
    key,
  );
  await expect(panel(page).getByRole("alert")).toContainText(
    "recovery evidence is unavailable",
  );
  await expect(
    review(page).getByRole("button", {
      name: "Confirm journal preparation",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await review(page).locator("input,textarea,select").count()).toBe(0);
  expect(await retained(page)).toEqual({ key, raw: "malformed-other-tab" });
  expect(posts).toBe(0);
});

test("journal preparation browser: correction reversal and replacement expose their exact current attempts", async ({
  page,
}) => {
  await signIn(page, 3175);
  const id = await source(page, 3175, "reversal");
  await freeze(page);
  await expect(review(page)).toContainText("reversal");
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  await source(page, 3175, "replacement");
  await freeze(page);
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  const ready = await journals(page, 3175);
  expect(ready).toHaveLength(2);
  expect(ready.map((p: any) => p.leg).sort()).toEqual([
    "replacement",
    "reversal",
  ]);
  expect(
    ready.every((p: any) => p.sourceId === id && p.state === "ready"),
  ).toBe(true);
});

test("journal preparation browser: lost committed reply recovers original receipt after permission withdrawal", async ({
  page,
}) => {
  await signIn(page, 3176);
  await source(page, 3176);
  await freeze(page);
  let posts = 0;
  await page.route(command, async (route) => {
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  const held = await retained(page);
  expect(held).not.toBeNull();
  const session = await (
    await page.request.get(`${origin(3176)}/api/session`)
  ).json();
  const residency = await (
    await page.request.get(`${origin(3176)}/api/organization/ledger-residency`)
  ).json();
  const withdrawal = await page.request.post(
    `${origin(3176)}/api/commands/organization.ledger-residency.choose`,
    {
      headers: {
        origin: origin(3176),
        "x-csrf-token": session.csrf,
        "idempotency-key": "synthetic-withdrawal",
      },
      data: {
        region: "CA",
        revision: residency.choice.revision,
        mode: "strict",
        realm: null,
        acknowledgment: "Synthetic permission withdrawal",
      },
    },
  );
  expect(withdrawal.status()).toBe(200);
  await page.reload();
  await billing(page);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  expect(posts).toBe(1);
  expect(await retained(page)).toBeNull();
  expect(await journals(page, 3176)).toHaveLength(1);
  const attempt = JSON.parse(held!.raw);
  const blocked = await page.request.get(
    `${origin(3176)}/api/accounting/journal-sources/${attempt.payload.sourceId}?leg=original`,
  );
  expect(blocked.status()).toBe(409);
});

test("journal preparation browser: absent receipt retries only original key and failed cleanup remains recoverable", async ({
  page,
}) => {
  await signIn(page, 3174);
  await source(page, 3174);
  await freeze(page);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(command, async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (requests.length === 1) await route.abort("failed");
    else await route.continue();
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  const held = await retained(page);
  expect(held).not.toBeNull();
  expect(await journals(page, 3174)).toHaveLength(0);
  await page.reload();
  await billing(page);
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("distributor-journal-preparation:"))
        throw Error("Synthetic cleanup unavailable");
      return remove.call(this, key);
    };
  });
  await recover(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic cleanup unavailable",
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(await retained(page)).toEqual(held);
  expect(await journals(page, 3174)).toHaveLength(1);
  await page.reload();
  await billing(page);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Journal preparation confirmed",
  );
  expect(requests).toHaveLength(2);
  expect(await retained(page)).toBeNull();
  expect(await journals(page, 3174)).toHaveLength(1);
});

test("journal preparation browser: navigation cancels delayed source read without reopening a review", async ({
  page,
}) => {
  await signIn(page, 3174);
  const costs = await (
    await page.request.get(`${origin(3174)}/api/accounting/costs`)
  ).json();
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    seen = new Promise<void>((resolve) => (started = resolve)),
    done = new Promise<void>((resolve) => (finished = resolve));
  await page.route("**/api/accounting/journal-sources/*?*", async (route) => {
    started();
    await gate;
    try {
      await route.continue();
    } catch (e) {
      expect(String(e)).toMatch(/handled|aborted|closed/i);
    } finally {
      finished();
    }
  });
  await panel(page)
    .getByLabel("Approved stock-cost source ID", { exact: true })
    .fill(costs.items[0].id);
  await panel(page)
    .getByRole("button", { name: "Load approved journal source", exact: true })
    .click();
  await seen;
  await navigateWorkspace(page, "Overview");
  release();
  await done;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await billing(page);
  await expect(
    panel(page).getByRole("region", {
      name: "Approved journal source review",
      exact: true,
    }),
  ).toHaveCount(0);
});
