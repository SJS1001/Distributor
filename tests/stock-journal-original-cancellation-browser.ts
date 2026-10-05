import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
// Public browser/HTTP journeys with synthetic isolated originals; no provider IO.
import { test, expect, type Page } from "@playwright/test";
const origin = (n = 0) => `http://127.0.0.1:${3196 + n}`;
const panel = (p: Page) =>
  p.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const control = (p: Page) =>
  panel(p).getByRole("region", {
    name: "Original journal cancellation",
    exact: true,
  });
const exact = (p: Page) =>
  control(p).getByRole("region", {
    name: "Exact original cancellation review",
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
    await p.request.get(`${origin(n)}/api/accounting/journals?state=unknown`)
  ).json();
  expect(list.items).toHaveLength(1);
  await panel(p)
    .getByLabel("Journal queue state", { exact: true })
    .selectOption("unknown");
  await panel(p)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await panel(p)
    .getByRole("button", {
      name: `Review journal ${list.items[0].requestRef}`,
      exact: true,
    })
    .click();
  await expect(control(p)).toBeVisible();
  return list.items[0];
}
async function proof(p: Page) {
  await control(p)
    .getByRole("button", {
      name: "Load original cancellation evidence review",
      exact: true,
    })
    .click();
  await control(p)
    .getByLabel("Receiver cancellation case reference", { exact: true })
    .fill("synthetic:final-case");
  await control(p)
    .getByLabel("Final cancellation and non-posting evidence", { exact: true })
    .fill(
      "Synthetic exact request cancelled; independently checked non-posting and no later posting",
    );
  await control(p)
    .getByLabel("Cancellation of this exact request is final", { exact: true })
    .check();
  await control(p)
    .getByLabel("Non-posting of this exact request is verified", {
      exact: true,
    })
    .check();
  await control(p)
    .getByLabel("This exact request cannot post later", { exact: true })
    .check();
  await control(p)
    .getByRole("button", {
      name: "Review original cancellation evidence",
      exact: true,
    })
    .click();
  await expect(exact(p).getByRole("heading")).toBeFocused();
  expect(await exact(p).locator("input,textarea,select").count()).toBe(0);
}
async function confirmProof(p: Page) {
  await exact(p)
    .getByRole("button", {
      name: "Record final original cancellation evidence",
      exact: true,
    })
    .click();
}
async function decision(p: Page) {
  await control(p)
    .getByRole("button", {
      name: "Load final original cancellation evidence",
      exact: true,
    })
    .click();
  await control(p)
    .getByLabel("Independent original cancellation reason", { exact: true })
    .fill("Synthetic separate finance review of exact request and case");
  await control(p)
    .getByRole("button", {
      name: "Review independent original cancellation",
      exact: true,
    })
    .click();
  await expect(exact(p).getByRole("heading")).toBeFocused();
  expect(await exact(p).locator("input,textarea,select").count()).toBe(0);
}
async function retained(p: Page) {
  return p.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("distributor-original-journal-cancellation:"),
      )?.[1] ?? null,
  );
}
test("browser: original cancellation fixes final evidence and requires separate finance confirmation", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const j = await open(page);
  await proof(page);
  await expect(exact(page)).toContainText(j.requestRef);
  await expect(exact(page)).toContainText("CAD");
  await confirmProof(page);
  await expect(exact(page)).toHaveCount(0);
  await expect.poll(() => retained(page)).toBeNull();
  await control(page)
    .getByRole("button", {
      name: "Load final original cancellation evidence",
      exact: true,
    })
    .click();
  await expect(control(page)).toContainText(
    "A different current finance principal must confirm",
  );
  const context = await browser.newContext(),
    second = await context.newPage();
  await signIn(second, 0, "finance");
  await open(second);
  await decision(second);
  await expect(exact(second)).toContainText("synthetic:final-case");
  await exact(second)
    .getByRole("button", {
      name: "Confirm independent original cancellation",
      exact: true,
    })
    .click();
  await expect(exact(second)).toHaveCount(0);
  const detail = await (
    await second.request.get(`${origin()}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("cancelled");
  expect(detail.requestRef).toBe(j.requestRef);
  expect(
    detail.observations.filter(
      (o: any) => o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(1);
  await context.close();
});

test("browser: original cancellation US phone recovers both exact lost replies after reload", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 1);
  const j = await open(page, 1);
  await proof(page);
  await expect(exact(page)).toContainText("US / USD");
  const requests: { key: string; body: string }[] = [];
  const evidencePath =
    "**/api/commands/accounting.journal.original-cancellation.evidence";
  await page.route(
    evidencePath,
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
  await confirmProof(page);
  await expect(control(page).getByRole("alert")).toBeVisible();
  const original = await retained(page);
  expect(original).not.toBeNull();
  await page.reload();
  await billing(page);
  await control(page)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(exact(page).getByRole("heading")).toBeFocused();
  await page.route(evidencePath, async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    await route.continue();
  });
  await exact(page)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(exact(page)).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect.poll(() => retained(page)).toBeNull();
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    finance = await ctx.newPage();
  await signIn(finance, 1, "finance");
  await open(finance, 1);
  await decision(finance);
  const cancellationPath = "**/api/commands/accounting.journal.cancel-original";
  const decisions: { key: string; body: string }[] = [];
  await finance.route(
    cancellationPath,
    async (route) => {
      decisions.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await exact(finance)
    .getByRole("button", {
      name: "Confirm independent original cancellation",
      exact: true,
    })
    .click();
  await expect(control(finance).getByRole("alert")).toBeVisible();
  const pending = await retained(finance);
  expect(pending).not.toBeNull();
  await finance.reload();
  await billing(finance);
  await control(finance)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  await finance.route(cancellationPath, async (route) => {
    decisions.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    await route.continue();
  });
  await exact(finance)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(exact(finance)).toHaveCount(0);
  expect(decisions).toHaveLength(2);
  expect(decisions[1]).toEqual(decisions[0]);
  const detail = await (
    await finance.request.get(`${origin(1)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("cancelled");
  expect(
    detail.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(1);
  expect(
    detail.observations.filter(
      (o: any) => o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(1);
  expect(
    await finance.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await ctx.close();
});

test("browser: original cancellation rejects substituted reviews and retains a malformed committed receipt", async ({
  page,
}) => {
  await signIn(page, 2);
  const j = await open(page, 2);
  await page.route(
    "**/original-cancellation-evidence-review",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.snapshot.requestRef = "DJ-000000000000000000";
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await control(page)
    .getByRole("button", {
      name: "Load original cancellation evidence review",
      exact: true,
    })
    .click();
  await expect(control(page).getByRole("alert")).toContainText(
    "could not be verified",
  );
  await expect(
    control(page).getByRole("form", {
      name: "Original cancellation evidence entry",
    }),
  ).toHaveCount(0);
  await proof(page);
  await page.route(
    "**/api/commands/accounting.journal.original-cancellation.evidence",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.evidence = null;
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await confirmProof(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "The original cancellation reply could not be verified",
  );
  expect(await retained(page)).not.toBeNull();
  await page.reload();
  await billing(page);
  await control(page)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  const kept = await retained(page);
  await page.route(
    "**/api/commands/accounting.journal.original-cancellation.evidence",
    async (route) =>
      route.fulfill({
        status: 409,
        json: {
          code: "JOURNAL_CANCELLATION_EVIDENCE",
          message: "Synthetic retained proof requires reconciliation",
        },
      }),
    { times: 1 },
  );
  await exact(page)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(control(page).getByRole("alert")).toContainText(
    "JOURNAL_CANCELLATION_EVIDENCE",
  );
  expect(await retained(page)).toBe(kept);
  await expect(exact(page)).toBeVisible();
  await exact(page)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(exact(page)).toHaveCount(0);
  const detail = await (
    await page.request.get(`${origin(2)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("unknown");
  expect(
    detail.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(1);
});

test("browser: original cancellation sends nothing without durable storage or Web Locks", async ({
  page,
}) => {
  await signIn(page, 3);
  const j = await open(page, 3);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (
      r
        .url()
        .endsWith(
          "/api/commands/accounting.journal.original-cancellation.evidence",
        )
    )
      sent.push(r.postData()!);
  });
  await proof(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-original-journal-cancellation:"))
        throw Error("Synthetic browser storage failure");
      return original.call(this, key, value);
    };
  });
  await confirmProof(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "Synthetic browser storage failure",
  );
  expect(sent).toHaveLength(0);
  expect(await retained(page)).toBeNull();
  await page.reload();
  await billing(page);
  await open(page, 3);
  await proof(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await confirmProof(page);
  await expect(control(page).getByRole("alert")).toContainText(
    "Web Locks support",
  );
  expect(sent).toHaveLength(0);
  const detail = await (
    await page.request.get(`${origin(3)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("unknown");
  expect(
    detail.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(0);
});

test("browser: original cancellation abandons late reads and preserves a late committed submission", async ({
  page,
}) => {
  await signIn(page, 4);
  const j = await open(page, 4);
  let releaseRead!: () => void, arrivedRead!: () => void;
  const readArrived = new Promise<void>((resolve) => {
    arrivedRead = resolve;
  });
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readPath = "**/original-cancellation-evidence-review";
  await page.route(readPath, async (route) => {
    const response = await route.fetch();
    arrivedRead();
    await readReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await control(page)
    .getByRole("button", {
      name: "Load original cancellation evidence review",
      exact: true,
    })
    .click();
  await readArrived;
  await navigateWorkspace(page, "Overview");
  releaseRead();
  await page.unroute(readPath);
  await billing(page);
  await expect(
    control(page).getByRole("form", {
      name: "Original cancellation evidence entry",
    }),
  ).toHaveCount(0);
  await open(page, 4);
  await proof(page);
  let releasePost!: () => void, arrivedPost!: () => void;
  const postArrived = new Promise<void>((resolve) => {
    arrivedPost = resolve;
  });
  const postReleased = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const postPath =
    "**/api/commands/accounting.journal.original-cancellation.evidence";
  await page.route(postPath, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    arrivedPost();
    await postReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await confirmProof(page);
  await postArrived;
  const saved = await retained(page);
  expect(saved).not.toBeNull();
  await navigateWorkspace(page, "Overview");
  releasePost();
  await page.unroute(postPath);
  await billing(page);
  expect(await retained(page)).toBe(saved);
  await control(page)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  await exact(page)
    .getByRole("button", {
      name: "Close original cancellation review",
      exact: true,
    })
    .click();
  await expect(
    control(page).getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    }),
  ).toBeFocused();
  expect(await retained(page)).toBe(saved);
  await control(page)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  await exact(page)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(exact(page)).toHaveCount(0);
  const detail = await (
    await page.request.get(`${origin(4)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("unknown");
  expect(
    detail.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(1);
});

test("browser: original cancellation refuses a superseded independent review and requires the newest proof", async ({
  page,
  browser,
}) => {
  await signIn(page, 5);
  const j = await open(page, 5);
  await proof(page);
  await confirmProof(page);
  await expect(exact(page)).toHaveCount(0);
  const ctx = await browser.newContext(),
    finance = await ctx.newPage();
  await signIn(finance, 5, "finance");
  await open(finance, 5);
  await decision(finance);
  await proof(page);
  await confirmProof(page);
  await expect(exact(page)).toHaveCount(0);
  await exact(finance)
    .getByRole("button", {
      name: "Confirm independent original cancellation",
      exact: true,
    })
    .click();
  await expect(control(finance).getByRole("alert")).toBeVisible();
  await expect(exact(finance)).toHaveCount(0);
  await expect.poll(() => retained(finance)).toBeNull();
  const stillUnknown = await (
    await finance.request.get(`${origin(5)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(stillUnknown.state).toBe("unknown");
  expect(
    stillUnknown.observations.filter(
      (o: any) => o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(0);
  await decision(finance);
  await exact(finance)
    .getByRole("button", {
      name: "Confirm independent original cancellation",
      exact: true,
    })
    .click();
  await expect(exact(finance)).toHaveCount(0);
  const detail = await (
    await finance.request.get(`${origin(5)}/api/accounting/journals/${j.id}`)
  ).json();
  expect(detail.state).toBe("cancelled");
  expect(
    detail.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(2);
  expect(
    detail.observations.filter(
      (o: any) => o.body.outcome === "cancelled-unposted",
    ),
  ).toHaveLength(1);
  await ctx.close();
});
