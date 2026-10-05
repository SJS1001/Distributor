import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
// Real synthetic browser/HTTP journeys; no provider requests or finance qualification.
import { test, expect, type Page } from "@playwright/test";
const origin = (n = 0) => `http://127.0.0.1:${3202 + n}`;
const panel = (p: Page) =>
  p.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const control = (p: Page) =>
  panel(p).getByRole("region", { name: "Original journal retry", exact: true });
const exact = (p: Page) =>
  control(p).getByRole("region", {
    name: "Review journal preparation",
    exact: true,
  });
async function billing(p: Page) {
  await navigateAccounting(p, "Stock journals");
  await expect(panel(p)).toBeVisible();
}
async function signIn(p: Page, n = 0, role = "admin") {
  await p.goto(origin(n));
  await p.getByLabel("Email", { exact: true }).fill(`${role}@example.test`);
  await p
    .getByLabel("Password", { exact: true })
    .fill(
      role === "admin" ? "long-test-only-password" : "test-only-long-password",
    );
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await billing(p);
}
async function open(p: Page, n = 0) {
  const list = await (
    await p.request.get(`${origin(n)}/api/accounting/journals?state=cancelled`)
  ).json();
  expect(list.items).toHaveLength(1);
  await panel(p)
    .getByLabel("Journal queue state", { exact: true })
    .selectOption("cancelled");
  await panel(p)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await panel(p)
    .getByRole("button", {
      name: `Review journal ${list.items[0].requestRef}`,
      exact: true,
    })
    .click();
  return list.items[0];
}
async function review(p: Page) {
  await control(p)
    .getByRole("button", { name: "Review cancelled journal", exact: true })
    .click();
  await control(p)
    .getByLabel("Original retry reason", { exact: true })
    .fill("Synthetic separately reviewed fresh original attempt");
  await control(p)
    .getByRole("button", { name: "Review new journal", exact: true })
    .click();
  await expect(exact(p).getByRole("heading")).toBeFocused();
  expect(await exact(p).locator("input,textarea,select").count()).toBe(0);
}
async function confirm(p: Page) {
  await exact(p)
    .getByRole("button", { name: "Prepare new journal", exact: true })
    .click();
}
async function retained(p: Page) {
  return p.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("distributor-original-journal-retry:"),
      )?.[1] ?? null,
  );
}
test("browser: original retry fixes the cancelled predecessor and creates a separately approved identity", async ({
  page,
}) => {
  await signIn(page);
  const previous = await open(page);
  const before = await (
    await page.request.get(`${origin()}/api/accounting/journals/${previous.id}`)
  ).json();
  await review(page);
  await expect(exact(page)).toContainText(previous.requestRef);
  await expect(exact(page)).toContainText("synthetic:retry-final-case");
  await expect(exact(page)).toContainText("CAD");
  await confirm(page);
  await expect(exact(page)).toHaveCount(0);
  await expect.poll(() => retained(page)).toBeNull();
  const list = await (
    await page.request.get(`${origin()}/api/accounting/journals?state=ready`)
  ).json();
  expect(list.items).toHaveLength(1);
  const retry = await (
    await page.request.get(
      `${origin()}/api/accounting/journals/${list.items[0].id}`,
    )
  ).json();
  expect(retry.id).not.toBe(previous.id);
  expect(retry.requestRef).not.toBe(previous.requestRef);
  expect(retry.attemptId).toBe(previous.id);
  expect(retry.plan.intent).toEqual(before.plan.intent);
  expect(retry.decisionBy).toBeNull();
  expect(
    await (
      await page.request.get(
        `${origin()}/api/accounting/journals/${previous.id}`,
      )
    ).json(),
  ).toEqual(before);
});

test("browser: original retry refuses a substituted review and preserves uncertainty after malformed replies", async ({
  page,
}) => {
  await signIn(page, 2);
  await open(page, 2);
  await page.route(
    "**/original-retry-review",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.snapshot.requestRef = "DJ-000000000000000000";
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await control(page)
    .getByRole("button", { name: "Review cancelled journal", exact: true })
    .click();
  await expect(control(page).getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(
    control(page).getByRole("form", {
      name: "Original retry entry",
      exact: true,
    }),
  ).toHaveCount(0);
  await review(page);
  const requests: { key: string; body: string }[] = [];
  await page.route(
    commandPath,
    async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const response = await route.fetch();
      const body = await response.json();
      body.attemptId = null;
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await confirm(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "We couldn't confirm this journal preparation",
  );
  const kept = await retained(page);
  expect(kept).not.toBeNull();
  await page.reload();
  await billing(page);
  await recoverReview(page);
  await page.route(
    commandPath,
    async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.fulfill({
        status: 409,
        json: {
          code: "JOURNAL_REVIEW_CHANGED",
          message: "Synthetic retained preparation needs reconciliation",
        },
      });
    },
    { times: 1 },
  );
  await recover(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "JOURNAL_REVIEW_CHANGED",
  );
  expect(await retained(page)).toBe(kept);
  await expect(exact(page)).toBeVisible();
  await page.route(
    commandPath,
    async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.continue();
    },
    { times: 1 },
  );
  await recover(page);
  await expect(exact(page)).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  await expect.poll(() => retained(page)).toBeNull();
  const all = await (
    await page.request.get(`${origin(2)}/api/accounting/journals`)
  ).json();
  expect(all.items).toHaveLength(2);
  expect(all.items.filter((j: any) => j.state === "ready")).toHaveLength(1);
});

const commandPath = "**/api/commands/accounting.journal.original-retry.prepare";
test("browser: original retry preserves a competing retained request that arrives during validation", async ({
  page,
}) => {
  await signIn(page, 6);
  const parent = await open(page, 6);
  await review(page);
  const fixed = await exact(page).innerText();
  const native = await (
    await page.request.get(
      `${origin(6)}/api/accounting/journals/${parent.id}/original-retry-review`,
    )
  ).json();
  const session = await (
    await page.request.get(`${origin(6)}/api/session`)
  ).json();
  const competing = {
    key: "11111111-1111-4111-8111-111111111111",
    review: native,
    payload: {
      journalId: parent.id,
      reviewHash: native.reviewHash,
      reason: "Synthetic competing original retry review",
    },
  };
  const sent: string[] = [];
  page.on("request", (r) => {
    if (
      r
        .url()
        .endsWith("/api/commands/accounting.journal.original-retry.prepare")
    )
      sent.push(r.postData()!);
  });
  await page.evaluate(
    ({ key, raw }) => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      let first = true;
      crypto.subtle.digest = async (...args) => {
        const result = await original(...args);
        if (first) {
          first = false;
          localStorage.setItem(key, raw);
          window.dispatchEvent(
            new StorageEvent("storage", { key, newValue: raw }),
          );
        }
        return result;
      };
    },
    {
      key: `distributor-original-journal-retry:${session.actor.orgId}:${session.actor.id}`,
      raw: JSON.stringify(competing),
    },
  );
  await confirm(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "saved preparation changed",
  );
  expect(sent).toHaveLength(0);
  expect(await exact(page).innerText()).toBe(fixed);
  expect(JSON.parse((await retained(page))!)).toEqual(competing);
  await exact(page)
    .getByRole("button", { name: "Close journal review", exact: true })
    .click();
  await recoverReview(page);
  await expect(exact(page)).toContainText(
    "Synthetic competing original retry review",
  );
  await recover(page);
  await expect(exact(page)).toHaveCount(0);
  expect(sent).toHaveLength(1);
  const all = await (
    await page.request.get(`${origin(6)}/api/accounting/journals`)
  ).json();
  expect(all.items).toHaveLength(2);
});
test("browser: original retry coordinates competing tabs and refuses a second fresh successor", async ({
  page,
}) => {
  await signIn(page, 5);
  await open(page, 5);
  await review(page);
  const other = await page.context().newPage();
  try {
    await other.goto(origin(5));
    await billing(other);
    await open(other, 5);
    await review(other);
    let release!: () => void, arrived!: () => void;
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await other.route(
      commandPath,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        arrived();
        await released;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const sent: string[] = [];
    page.on("request", (r) => {
      if (
        r
          .url()
          .endsWith("/api/commands/accounting.journal.original-retry.prepare")
      )
        sent.push(r.postData()!);
    });
    await confirm(other);
    await arrival;
    const kept = await retained(other);
    await confirm(page);
    await expect(control(page).getByRole("alert")).toContainText("Another tab");
    expect(sent).toHaveLength(0);
    expect(await retained(page)).toBe(kept);
    release();
    await expect(exact(other)).toHaveCount(0);
    await confirm(page);
    await expect(control(page).getByRole("alert")).toBeVisible();
    await expect(exact(page)).toHaveCount(0);
    expect(sent).toHaveLength(1);
    await expect.poll(() => retained(page)).toBeNull();
    const all = await (
      await page.request.get(`${origin(5)}/api/accounting/journals`)
    ).json();
    expect(all.items).toHaveLength(2);
    expect(all.items.filter((j: any) => j.state === "ready")).toHaveLength(1);
  } finally {
    await other.close();
  }
});
test("browser: original retry sends nothing without durable storage or Web Locks", async ({
  page,
}) => {
  await signIn(page, 3);
  await open(page, 3);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (
      r
        .url()
        .endsWith("/api/commands/accounting.journal.original-retry.prepare")
    )
      sent.push(r.postData()!);
  });
  await review(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-original-journal-retry:"))
        throw Error("Synthetic browser storage failure");
      return original.call(this, key, value);
    };
  });
  await confirm(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "Synthetic browser storage failure",
  );
  expect(sent).toHaveLength(0);
  expect(await retained(page)).toBeNull();
  await page.reload();
  await billing(page);
  await open(page, 3);
  await review(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await confirm(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "Web Locks support",
  );
  expect(sent).toHaveLength(0);
  const all = await (
    await page.request.get(`${origin(3)}/api/accounting/journals`)
  ).json();
  expect(all.items).toHaveLength(1);
  expect(all.items[0].state).toBe("cancelled");
});
async function recoverReview(p: Page) {
  await control(p)
    .getByRole("button", {
      name: "Review saved journal preparation",
      exact: true,
    })
    .click();
  await expect(exact(p).getByRole("heading")).toBeFocused();
}
async function recover(p: Page) {
  await exact(p)
    .getByRole("button", {
      name: "Recover saved preparation",
      exact: true,
    })
    .click();
}
test("browser: original retry abandons late reads and retains late committed preparation across navigation", async ({
  page,
}) => {
  await signIn(page, 4);
  await open(page, 4);
  let releaseRead!: () => void, arrivedRead!: () => void;
  const readArrived = new Promise<void>((resolve) => {
    arrivedRead = resolve;
  });
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readPath = "**/original-retry-review";
  await page.route(readPath, async (route) => {
    const response = await route.fetch();
    arrivedRead();
    await readReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await control(page)
    .getByRole("button", { name: "Review cancelled journal", exact: true })
    .click();
  await readArrived;
  await navigateWorkspace(page, "Overview");
  releaseRead();
  await page.unroute(readPath);
  await billing(page);
  await expect(
    control(page).getByRole("form", {
      name: "Original retry entry",
      exact: true,
    }),
  ).toHaveCount(0);
  await open(page, 4);
  await review(page);
  let releasePost!: () => void, arrivedPost!: () => void;
  const postArrived = new Promise<void>((resolve) => {
    arrivedPost = resolve;
  });
  const postReleased = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route(commandPath, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    arrivedPost();
    await postReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await confirm(page);
  await postArrived;
  const saved = await retained(page);
  expect(saved).not.toBeNull();
  await navigateWorkspace(page, "Overview");
  releasePost();
  await page.unroute(commandPath);
  await billing(page);
  expect(await retained(page)).toBe(saved);
  await recoverReview(page);
  await exact(page)
    .getByRole("button", { name: "Close journal review", exact: true })
    .click();
  await expect(
    control(page).getByRole("button", {
      name: "Review saved journal preparation",
      exact: true,
    }),
  ).toBeFocused();
  expect(await retained(page)).toBe(saved);
  await recoverReview(page);
  await recover(page);
  await expect(exact(page)).toHaveCount(0);
  await expect.poll(() => retained(page)).toBeNull();
  const all = await (
    await page.request.get(`${origin(4)}/api/accounting/journals`)
  ).json();
  expect(all.items).toHaveLength(2);
  expect(all.items.filter((j: any) => j.state === "ready")).toHaveLength(1);
});
test("browser: original retry US phone recovers the exact lost preparation after separate approval", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 1);
  const parent = await open(page, 1);
  await review(page);
  await expect(exact(page)).toContainText("US / USD");
  const requests: { key: string; body: string }[] = [];
  await page.route(
    commandPath,
    async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await confirm(page);
  await expect(control(page).getByRole("alert")).toBeVisible();
  const original = await retained(page);
  expect(original).not.toBeNull();
  const list = await (
    await page.request.get(`${origin(1)}/api/accounting/journals?state=ready`)
  ).json();
  expect(list.items).toHaveLength(1);
  const retry = list.items[0];
  expect(retry.attemptId).toBe(parent.id);
  // The preparing principal cannot inherit approval or approve its own new attempt.
  const session = await (
    await page.request.get(`${origin(1)}/api/session`)
  ).json();
  const refused = await page.request.post(
    `${origin(1)}/api/commands/accounting.journal.decide`,
    {
      headers: {
        origin: origin(1),
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        journalId: retry.id,
        reviewHash: retry.reviewHash,
        decision: "approve",
        reason: "Synthetic self-approval must refuse",
      },
    },
  );
  expect(refused.status()).toBe(403);
  const ctx = await browser.newContext(),
    finance = await ctx.newPage();
  try {
    await signIn(finance, 1, "finance");
    await panel(finance)
      .getByLabel("Journal queue state", { exact: true })
      .selectOption("ready");
    await panel(finance)
      .getByRole("button", { name: "Load journal queue", exact: true })
      .click();
    await panel(finance)
      .getByRole("button", {
        name: `Review journal ${retry.requestRef}`,
        exact: true,
      })
      .click();
    const decisions = panel(finance).getByRole("region", {
      name: "Journal decision recovery",
      exact: true,
    });
    await decisions
      .getByLabel("Journal decision", { exact: true })
      .selectOption("approve");
    await decisions
      .getByLabel("Journal decision reason", { exact: true })
      .fill("Synthetic independent finance retry approval");
    await decisions
      .getByRole("button", {
        name: "Review exact journal decision",
        exact: true,
      })
      .click();
    await decisions
      .getByRole("button", { name: "Confirm journal decision", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await finance.request.get(
                `${origin(1)}/api/accounting/journals/${retry.id}`,
              )
            ).json()
          ).state,
      )
      .toBe("pending");
    const approved = await (
      await finance.request.get(
        `${origin(1)}/api/accounting/journals/${retry.id}`,
      )
    ).json();
    await page.reload();
    await billing(page);
    await recoverReview(page);
    await expect(exact(page)).toContainText(parent.requestRef);
    await page.route(commandPath, async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.continue();
    });
    await recover(page);
    await expect(exact(page)).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await expect.poll(() => retained(page)).toBeNull();
    expect(
      await (
        await page.request.get(
          `${origin(1)}/api/accounting/journals/${retry.id}`,
        )
      ).json(),
    ).toEqual(approved);
    const all = await (
      await page.request.get(`${origin(1)}/api/accounting/journals`)
    ).json();
    expect(all.items).toHaveLength(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await ctx.close();
  }
});
