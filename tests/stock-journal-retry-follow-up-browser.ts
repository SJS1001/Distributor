import { navigateAccounting } from "./workspace-navigation.ts";
// Synthetic browser/HTTP retry chains. No receiver I/O or actual finance evidence.
import { test, expect, type Page } from "@playwright/test";
const origin = (n = 0) => `http://127.0.0.1:${3209 + n}`;
const queue = (p: Page) =>
  p.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const cancellation = (p: Page) =>
  queue(p).getByRole("region", {
    name: "Original journal cancellation",
    exact: true,
  });
const fixed = (p: Page) =>
  cancellation(p).getByRole("region", {
    name: "Exact original cancellation review",
    exact: true,
  });
async function billing(p: Page) {
  await navigateAccounting(p, "Stock journals");
  await expect(queue(p)).toBeVisible();
}
async function signIn(p: Page, n = 0, role = "admin") {
  await p.goto(origin(n) + "/#sign-in");
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
async function detail(p: Page, n: number, id: string) {
  const r = await p.request.get(`${origin(n)}/api/accounting/journals/${id}`);
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function open(p: Page, n = 0) {
  const list = await (
    await p.request.get(`${origin(n)}/api/accounting/journals?state=unknown`)
  ).json();
  expect(list.items).toHaveLength(1);
  await queue(p)
    .getByLabel("Journal queue state", { exact: true })
    .selectOption("unknown");
  await queue(p)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await queue(p)
    .getByRole("button", {
      name: `Review journal ${list.items[0].requestRef}`,
      exact: true,
    })
    .click();
  return detail(p, n, list.items[0].id);
}
async function proof(p: Page) {
  await cancellation(p)
    .getByRole("button", {
      name: "Load original cancellation evidence review",
      exact: true,
    })
    .click();
  await cancellation(p)
    .getByLabel("Receiver cancellation case reference", { exact: true })
    .fill("synthetic:retry-final-case");
  await cancellation(p)
    .getByLabel("Final cancellation and non-posting evidence", { exact: true })
    .fill(
      "Synthetic exact retry request cancelled, non-posting verified and later posting prevented",
    );
  await cancellation(p)
    .getByLabel("Cancellation of this exact request is final", { exact: true })
    .check();
  await cancellation(p)
    .getByLabel("Non-posting of this exact request is verified", {
      exact: true,
    })
    .check();
  await cancellation(p)
    .getByLabel("This exact request cannot post later", { exact: true })
    .check();
  await cancellation(p)
    .getByRole("button", {
      name: "Review original cancellation evidence",
      exact: true,
    })
    .click();
  await expect(fixed(p).getByRole("heading")).toBeFocused();
  expect(await fixed(p).locator("input,textarea,select").count()).toBe(0);
}
async function confirmProof(p: Page) {
  await fixed(p)
    .getByRole("button", {
      name: "Record final original cancellation evidence",
      exact: true,
    })
    .click();
}
async function decision(p: Page) {
  await cancellation(p)
    .getByRole("button", {
      name: "Load final original cancellation evidence",
      exact: true,
    })
    .click();
  await cancellation(p)
    .getByLabel("Independent original cancellation reason", { exact: true })
    .fill("Synthetic independent retry cancellation review");
  await cancellation(p)
    .getByRole("button", {
      name: "Review independent original cancellation",
      exact: true,
    })
    .click();
  await expect(fixed(p).getByRole("heading")).toBeFocused();
}
async function confirmDecision(p: Page) {
  await fixed(p)
    .getByRole("button", {
      name: "Confirm independent original cancellation",
      exact: true,
    })
    .click();
}
async function retained(p: Page) {
  return p.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("distributor-original-journal-cancellation:"),
      )?.[1] ?? null,
  );
}
async function recover(p: Page) {
  await cancellation(p)
    .getByRole("button", {
      name: "Review retained original cancellation attempt",
      exact: true,
    })
    .click();
  await expect(fixed(p).getByRole("heading")).toBeFocused();
  await fixed(p)
    .getByRole("button", {
      name: "Recover exact original cancellation attempt",
      exact: true,
    })
    .click();
}
test("retry follow-up browser: CA final cancellation conserves the root and permits a third attempt requiring separate approval", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const child = await open(page),
    parent = await detail(page, 0, child.attemptId);
  expect(child.attemptId).toBe(parent.id);
  expect(parent.state).toBe("cancelled");
  await proof(page);
  await expect(fixed(page)).toContainText(child.requestRef);
  await expect(fixed(page)).toContainText("CAD");
  await confirmProof(page);
  await expect(fixed(page)).toHaveCount(0);
  await expect.poll(() => retained(page)).toBeNull();
  await cancellation(page)
    .getByRole("button", {
      name: "Load final original cancellation evidence",
      exact: true,
    })
    .click();
  await expect(cancellation(page)).toContainText(
    "A different current finance principal must confirm",
  );
  const context = await browser.newContext(),
    second = await context.newPage();
  try {
    await signIn(second, 0, "finance");
    await open(second);
    await decision(second);
    await expect(fixed(second)).toContainText(child.requestRef);
    await confirmDecision(second);
    await expect(fixed(second)).toHaveCount(0);
    const cancelled = await detail(second, 0, child.id);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.plan).toEqual(child.plan);
    expect(cancelled.requestRef).toBe(child.requestRef);
    expect(await detail(second, 0, parent.id)).toEqual(parent);
    const retry = queue(second).getByRole("region", {
      name: "Original journal retry",
      exact: true,
    });
    await retry
      .getByRole("button", { name: "Review cancelled journal", exact: true })
      .click();
    await retry
      .getByLabel("Original retry reason", { exact: true })
      .fill("Synthetic next separately reviewed original attempt");
    await retry
      .getByRole("button", { name: "Review new journal", exact: true })
      .click();
    await retry
      .getByRole("button", {
        name: "Prepare new journal",
        exact: true,
      })
      .click();
    await expect(
      retry.getByRole("region", {
        name: "Review journal preparation",
        exact: true,
      }),
    ).toHaveCount(0);
    const ready = await (
      await second.request.get(
        `${origin()}/api/accounting/journals?state=ready`,
      )
    ).json();
    expect(ready.items).toHaveLength(1);
    const third = await detail(second, 0, ready.items[0].id);
    expect(third.attemptId).toBe(child.id);
    expect(third.requestRef).not.toBe(child.requestRef);
    expect(third.requestRef).not.toBe(parent.requestRef);
    expect(third.plan.intent).toEqual(child.plan.intent);
    expect(third.decisionBy).toBeNull();
    expect(await detail(second, 0, child.id)).toEqual(cancelled);
    expect(await detail(second, 0, parent.id)).toEqual(parent);
  } finally {
    await context.close();
  }
});

test("retry follow-up browser: US phone recovers both lost replies after later final cancellation without rewriting lineage", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 1);
  const child = await open(page, 1),
    parent = await detail(page, 1, child.attemptId);
  await proof(page);
  await expect(fixed(page)).toContainText("US / USD");
  const evidencePath =
      "**/api/commands/accounting.journal.original-cancellation.evidence",
    cancelPath = "**/api/commands/accounting.journal.cancel-original";
  const proofs: { key: string; body: string }[] = [],
    decisions: { key: string; body: string }[] = [];
  await page.route(
    evidencePath,
    async (route) => {
      proofs.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort();
    },
    { times: 1 },
  );
  await confirmProof(page);
  await expect(cancellation(page).getByRole("alert")).toBeVisible();
  const storedProof = await retained(page);
  expect(storedProof).not.toBeNull();
  expect(JSON.parse(storedProof!).payload).toEqual(JSON.parse(proofs[0]!.body));
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    finance = await context.newPage();
  try {
    await signIn(finance, 1, "finance");
    await open(finance, 1);
    await decision(finance);
    await finance.route(
      cancelPath,
      async (route) => {
        decisions.push({
          key: route.request().headers()["idempotency-key"]!,
          body: route.request().postData()!,
        });
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.abort();
      },
      { times: 1 },
    );
    await confirmDecision(finance);
    await expect(cancellation(finance).getByRole("alert")).toBeVisible();
    const storedDecision = await retained(finance);
    expect(storedDecision).not.toBeNull();
    expect(JSON.parse(storedDecision!).payload).toEqual(
      JSON.parse(decisions[0]!.body),
    );
    const final = await detail(finance, 1, child.id);
    expect(final.state).toBe("cancelled");
    expect(final.plan).toEqual(child.plan);
    expect(
      final.observations.filter(
        (o: any) => o.body.kind === "original-cancellation-evidence",
      ),
    ).toHaveLength(1);
    expect(
      final.observations.filter(
        (o: any) => o.body.outcome === "cancelled-unposted",
      ),
    ).toHaveLength(1);
    await page.reload();
    await billing(page);
    await page.route(evidencePath, async (route) => {
      proofs.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.continue();
    });
    await recover(page);
    await expect.poll(() => retained(page)).toBeNull();
    expect(proofs).toHaveLength(2);
    expect(proofs[1]).toEqual(proofs[0]);
    expect(await detail(page, 1, child.id)).toEqual(final);
    await finance.reload();
    await billing(finance);
    await finance.route(cancelPath, async (route) => {
      decisions.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      await route.continue();
    });
    await recover(finance);
    await expect.poll(() => retained(finance)).toBeNull();
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
    expect(await detail(finance, 1, child.id)).toEqual(final);
    expect(await detail(finance, 1, parent.id)).toEqual(parent);
    expect(
      await finance.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("retry follow-up browser: substituted root identity refuses review and retains an unverified committed retry receipt", async ({
  page,
}) => {
  await signIn(page, 2);
  const child = await open(page, 2),
    parent = await detail(page, 2, child.attemptId);
  const read = "**/original-cancellation-evidence-review",
    write = "**/api/commands/accounting.journal.original-cancellation.evidence";
  let posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith("/accounting.journal.original-cancellation.evidence")
    )
      posts++;
  });
  await page.route(
    read,
    async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.journal.attemptId = null;
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await cancellation(page)
    .getByRole("button", {
      name: "Load original cancellation evidence review",
      exact: true,
    })
    .click();
  await expect(cancellation(page).getByRole("alert")).toContainText(
    "The original evidence review could not be verified",
  );
  expect(
    await cancellation(page)
      .getByLabel("Receiver cancellation case reference", { exact: true })
      .count(),
  ).toBe(0);
  expect(posts).toBe(0);
  expect(await retained(page)).toBeNull();
  await proof(page);
  const attempts: { key: string; body: string }[] = [];
  await page.route(
    write,
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        body: route.request().postData()!,
      });
      const response = await route.fetch(),
        body = await response.json();
      expect(response.ok()).toBeTruthy();
      body.journal.attemptId = null;
      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );
  await confirmProof(page);
  await expect(cancellation(page).getByRole("alert")).toContainText(
    "The original cancellation reply could not be verified",
  );
  const stored = await retained(page);
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!).payload).toEqual(JSON.parse(attempts[0]!.body));
  const observed = await detail(page, 2, child.id);
  expect(observed.state).toBe("unknown");
  expect(observed.attemptId).toBe(parent.id);
  expect(observed.plan).toEqual(child.plan);
  expect(
    observed.observations.filter(
      (o: any) => o.body.kind === "original-cancellation-evidence",
    ),
  ).toHaveLength(1);
  await page.reload();
  await billing(page);
  await page.route(write, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    await route.continue();
  });
  await recover(page);
  await expect.poll(() => retained(page)).toBeNull();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await detail(page, 2, child.id)).toEqual(observed);
  expect(await detail(page, 2, parent.id)).toEqual(parent);
});

const permission = (p: Page) =>
  queue(p).getByRole("region", {
    name: "Journal permission replacement",
    exact: true,
  });
const permissionFixed = (p: Page) =>
  permission(p).getByRole("region", {
    name: "Exact journal permission review",
    exact: true,
  });
async function permissionHistory(p: Page, n: number, id: string) {
  const r = await p.request.get(
    `${origin(n)}/api/accounting/journals/${id}/permissions`,
  );
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function permissionConfirm(p: Page) {
  await permissionFixed(p)
    .getByRole("button", {
      name: "Confirm journal permission attempt",
      exact: true,
    })
    .click();
}
async function permissionRetained(p: Page) {
  return p.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("distributor-journal-permission:"),
      )?.[1] ?? null,
  );
}
for (const n of [3, 4]) {
  test(`retry follow-up browser: ${n === 3 ? "CA" : "US"} replacement is lookup only and separately approved${n === 4 ? " with read-first lost decision recovery" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, n);
    const child = await open(page, n),
      parent = await detail(page, n, child.attemptId),
      initial = await permissionHistory(page, n, child.id);
    let posts = 0;
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        r.url().includes("accounting.journal.permission")
      )
        posts++;
    });
    await permission(page)
      .getByRole("button", { name: "Load replacement permission", exact: true })
      .click();
    await expect(
      permission(page).getByRole("region", {
        name: "Prospective journal permission",
        exact: true,
      }),
    ).toBeVisible();
    await permission(page)
      .getByLabel("Permission preparation reason", { exact: true })
      .fill("Synthetic retry permission revision review");
    await permission(page)
      .getByRole("button", {
        name: "Review exact permission preparation",
        exact: true,
      })
      .click();
    await expect(
      permissionFixed(page).getByRole("heading", {
        name: "Exact journal permission review",
        exact: true,
      }),
    ).toBeFocused();
    await expect(permissionFixed(page)).toContainText(n === 3 ? "CA" : "US");
    await expect(permissionFixed(page)).toContainText("lookup");
    await expect(permissionFixed(page)).toContainText(child.reviewHash);
    await expect(permissionFixed(page)).toContainText(child.requestRef);
    await expect(permissionFixed(page)).toContainText(
      "Future processing stops",
    );
    expect(
      await permissionFixed(page).locator("input,textarea,select").count(),
    ).toBe(0);
    expect(posts).toBe(0);
    await permissionConfirm(page);
    await expect(permission(page).getByRole("status")).toContainText(
      "Permission review recorded:",
    );
    await permission(page)
      .getByRole("button", {
        name: "Load journal permission history",
        exact: true,
      })
      .click();
    await permission(page).locator("details summary").click();
    await expect(permission(page)).toContainText(
      "A different current finance principal",
    );
    expect(
      await permission(page)
        .getByRole("button", { name: /^Review permission decision / })
        .count(),
    ).toBe(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, n, "finance");
    await open(page, n);
    await permission(page)
      .getByRole("button", {
        name: "Load journal permission history",
        exact: true,
      })
      .click();
    const review = permission(page)
      .getByRole("region", { name: "Journal permission history", exact: true })
      .locator("details")
      .first();
    await review.locator("summary").click();
    await review
      .getByRole("button", { name: /^Review permission decision / })
      .click();
    await permission(page)
      .getByLabel("Permission decision", { exact: true })
      .selectOption("approve");
    await permission(page)
      .getByLabel("Permission decision reason", { exact: true })
      .fill("Synthetic independent retry lookup approval");
    await permission(page)
      .getByRole("button", {
        name: "Review exact permission decision",
        exact: true,
      })
      .click();
    await expect(
      permissionFixed(page).getByRole("heading", {
        name: "Exact journal permission review",
        exact: true,
      }),
    ).toBeFocused();
    await expect(permissionFixed(page)).toContainText(child.reviewHash);
    await expect(permissionFixed(page)).toContainText("lookup");
    let decisions = 0;
    if (n === 4) {
      await page.route(
        "**/api/commands/accounting.journal.permission.decide",
        async (route) => {
          decisions++;
          const response = await route.fetch();
          expect(response.ok()).toBeTruthy();
          await route.abort();
        },
      );
    }
    await permissionConfirm(page);
    if (n === 4) {
      await expect(permission(page).getByRole("alert")).toBeVisible();
      expect(await permissionRetained(page)).not.toBeNull();
      const session = await (
          await page.request.get(`${origin(n)}/api/session`)
        ).json(),
        choice = await (
          await page.request.get(
            `${origin(n)}/api/organization/ledger-residency`,
          )
        ).json();
      const r = await page.request.post(
        `${origin(n)}/api/commands/organization.ledger-residency.choose`,
        {
          headers: {
            origin: origin(n),
            "x-csrf-token": session.csrf,
            "idempotency-key": crypto.randomUUID(),
          },
          data: {
            region: choice.choice.region,
            revision: choice.choice.revision,
            mode: "strict",
            realm: null,
            acknowledgment:
              "Synthetic withdrawal during retry receipt recovery",
          },
        },
      );
      expect(r.ok(), await r.text()).toBeTruthy();
      const committed = await permissionHistory(page, n, child.id);
      await page.reload();
      await billing(page);
      await permission(page)
        .getByRole("button", {
          name: "Review retained journal permission attempt",
          exact: true,
        })
        .click();
      await expect(
        permissionFixed(page).getByRole("heading", {
          name: "Exact journal permission review",
          exact: true,
        }),
      ).toBeFocused();
      await permissionFixed(page)
        .getByRole("button", {
          name: "Recover exact journal permission attempt",
          exact: true,
        })
        .click();
      await expect(permission(page).getByRole("status")).toContainText(
        "Permission decision confirmed",
      );
      expect(decisions).toBe(1);
      expect(await permissionHistory(page, n, child.id)).toEqual(committed);
    } else
      await expect(permission(page).getByRole("status")).toContainText(
        "Permission decision confirmed",
      );
    await expect.poll(() => permissionRetained(page)).toBeNull();
    const h = await permissionHistory(page, n, child.id);
    expect(h.mode).toBe("lookup");
    expect(h.authority.revision).toBe(initial.authority.revision + 1);
    expect(h.reviews).toHaveLength(1);
    expect(await detail(page, n, child.id)).toMatchObject({
      state: "unknown",
      attemptId: parent.id,
      reviewHash: child.reviewHash,
      plan: child.plan,
      requestRef: child.requestRef,
    });
    expect(await detail(page, n, parent.id)).toEqual(parent);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
