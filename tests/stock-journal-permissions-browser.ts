import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
// Synthetic local permission changes. No provider transport or external qualification.
import { test, expect, type Page } from "@playwright/test";
const origin = (port: number) => `http://127.0.0.1:${port}`;
const panel = (p: Page) =>
  p.getByRole("region", {
    name: "Journal permission replacement",
    exact: true,
  });
const fixed = (p: Page) =>
  panel(p).getByRole("region", {
    name: "Exact journal permission review",
    exact: true,
  });
const queue = (p: Page) =>
  p.getByRole("region", {
    name: "Stock journal delivery reviews",
    exact: true,
  });
const prepare = "**/api/commands/accounting.journal.permission.prepare",
  decide = "**/api/commands/accounting.journal.permission.decide";
async function billing(p: Page) {
  await navigateAccounting(p, "Stock journals");
  await expect(panel(p)).toBeVisible();
}
async function signIn(p: Page, port: number, role = "admin") {
  // Same-document navigation to a sign-in route is only meaningful once the
  // previous principal has been fully signed out.
  await expect(
    p.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await p.goto(origin(port) + "/#admin-sign-in");
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
async function journal(p: Page, port: number) {
  const list = await (
      await p.request.get(`${origin(port)}/api/accounting/journals`)
    ).json(),
    j = list.items[0];
  expect(j).toBeTruthy();
  await queue(p)
    .getByRole("button", { name: "Load journal queue", exact: true })
    .click();
  await queue(p)
    .getByRole("button", {
      name: `Review journal ${j.requestRef}`,
      exact: true,
    })
    .click();
  await expect(
    queue(p).getByRole("region", {
      name: "Frozen stock journal review",
      exact: true,
    }),
  ).toBeVisible();
  return await (
    await p.request.get(`${origin(port)}/api/accounting/journals/${j.id}`)
  ).json();
}
async function freezePrepare(
  p: Page,
  reason = "Synthetic fixed permission preparation",
) {
  await panel(p)
    .getByRole("button", { name: "Load replacement permission", exact: true })
    .click();
  await expect(
    panel(p).getByRole("region", {
      name: "Prospective journal permission",
      exact: true,
    }),
  ).toBeVisible();
  await panel(p)
    .getByLabel("Permission preparation reason", { exact: true })
    .fill(reason);
  await panel(p)
    .getByRole("button", {
      name: "Review exact permission preparation",
      exact: true,
    })
    .click();
  await expect(
    fixed(p).getByRole("heading", {
      name: "Exact journal permission review",
      exact: true,
    }),
  ).toBeFocused();
  expect(await fixed(p).locator("input,textarea,select").count()).toBe(0);
}
async function confirm(p: Page) {
  await fixed(p)
    .getByRole("button", {
      name: "Confirm journal permission attempt",
      exact: true,
    })
    .click();
}
async function prepareReview(p: Page) {
  await freezePrepare(p);
  await confirm(p);
  await expect(panel(p).getByRole("status")).toContainText(
    "Permission review recorded:",
  );
}
async function freezeDecision(
  p: Page,
  decision = "approve",
  reason = "Synthetic independent permission decision",
) {
  await panel(p)
    .getByRole("button", {
      name: "Load journal permission history",
      exact: true,
    })
    .click();
  const last = panel(p)
    .getByRole("region", { name: "Journal permission history", exact: true })
    .locator("details")
    .first();
  await last.locator("summary").click();
  await last
    .getByRole("button", { name: /^Review permission decision / })
    .click();
  await panel(p)
    .getByLabel("Permission decision", { exact: true })
    .selectOption(decision);
  await panel(p)
    .getByLabel("Permission decision reason", { exact: true })
    .fill(reason);
  await panel(p)
    .getByRole("button", {
      name: "Review exact permission decision",
      exact: true,
    })
    .click();
  await expect(
    fixed(p).getByRole("heading", {
      name: "Exact journal permission review",
      exact: true,
    }),
  ).toBeFocused();
  expect(await fixed(p).locator("input,textarea,select").count()).toBe(0);
}
async function retained(p: Page) {
  return p.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-journal-permission:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}
async function recover(p: Page) {
  await panel(p)
    .getByRole("button", {
      name: "Review retained journal permission attempt",
      exact: true,
    })
    .click();
  await fixed(p)
    .getByRole("button", {
      name: "Recover exact journal permission attempt",
      exact: true,
    })
    .click();
}
async function withdraw(p: Page, port: number) {
  const session = await (
      await p.request.get(`${origin(port)}/api/session`)
    ).json(),
    r = await (
      await p.request.get(`${origin(port)}/api/organization/ledger-residency`)
    ).json();
  const reply = await p.request.post(
    `${origin(port)}/api/commands/organization.ledger-residency.choose`,
    {
      headers: {
        origin: origin(port),
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        region: r.choice.region,
        revision: r.choice.revision,
        mode: "strict",
        realm: null,
        acknowledgment: "Synthetic withdrawal during receipt recovery",
      },
    },
  );
  expect(reply.ok(), await reply.text()).toBeTruthy();
}
async function permissions(p: Page, port: number, id: string) {
  return await (
    await p.request.get(
      `${origin(port)}/api/accounting/journals/${id}/permissions`,
    )
  ).json();
}

test("journal permission browser: CA phone fixed terms and separate approval conserve the journal", async ({
  page,
}) => {
  const port = 3177;
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, port);
  const before = await journal(page, port);
  let posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().includes("accounting.journal.permission")
    )
      posts++;
  });
  await freezePrepare(page);
  await expect(fixed(page)).toContainText("CA");
  await expect(fixed(page)).toContainText("write");
  await expect(fixed(page)).toContainText("US, CA");
  await expect(fixed(page)).toContainText("Future processing stops");
  await expect(fixed(page)).toContainText(before.reviewHash);
  expect(posts).toBe(0);
  await fixed(page)
    .getByRole("button", {
      name: "Close journal permission review",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Load replacement permission",
      exact: true,
    }),
  ).toBeFocused();
  await freezePrepare(page);
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission review recorded:",
  );
  await panel(page)
    .getByRole("button", {
      name: "Load journal permission history",
      exact: true,
    })
    .click();
  await panel(page).locator("details summary").click();
  await expect(panel(page)).toContainText(
    "A different current finance principal",
  );
  expect(
    await panel(page)
      .getByRole("button", { name: /^Review permission decision / })
      .count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, port, "finance");
  await journal(page, port);
  await freezeDecision(page);
  expect(posts).toBe(1);
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission decision confirmed",
  );
  expect(posts).toBe(2);
  expect(await retained(page)).toBeNull();
  const h = await permissions(page, port, before.id);
  expect(h.authority.revision).toBe(before.plan.input.authority.revision + 1);
  expect(h.mode).toBe("write");
  const after = await journal(page, port);
  expect(after.plan).toEqual(before.plan);
  expect(after.requestRef).toBe(before.requestRef);
  expect(after.state).toBe("pending");
  expect(after.dispatched).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("journal permission browser: US uncertainty approves lookup only", async ({
  page,
}) => {
  const port = 3178;
  await signIn(page, port, "finance");
  const before = await journal(page, port);
  expect(before.state).toBe("unknown");
  await freezeDecision(page);
  await expect(fixed(page)).toContainText("US");
  await expect(fixed(page)).toContainText("lookup");
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission decision confirmed",
  );
  const h = await permissions(page, port, before.id);
  expect(h.mode).toBe("lookup");
  expect(h.authority.revision).toBe(before.plan.input.authority.revision + 1);
  const after = await journal(page, port);
  expect(after.state).toBe("unknown");
  expect(after.plan).toEqual(before.plan);
  expect(after.requestRef).toBe(before.requestRef);
});
test("journal permission browser: lost preparation reply recovers same body and key after withdrawal and sign-in", async ({
  page,
}) => {
  const port = 3179;
  await signIn(page, port);
  const j = await journal(page, port);
  await freezePrepare(page, "Synthetic retained preparation before withdrawal");
  const attempts: { key: string; body: string }[] = [];
  await page.route(prepare, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postData()!,
    });
    if (attempts.length === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  const original = (await retained(page))!;
  expect(JSON.parse(original.raw).payload).toEqual(
    JSON.parse(attempts[0]!.body),
  );
  await withdraw(page, port);
  await page.reload();
  await billing(page);
  await expect(
    panel(page).getByRole("button", {
      name: "Review retained journal permission attempt",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, port, "finance");
  expect(
    await panel(page)
      .getByRole("button", {
        name: "Review retained journal permission attempt",
        exact: true,
      })
      .count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, port);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission review recorded:",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await retained(page)).toBeNull();
  expect((await permissions(page, port, j.id)).reviews).toHaveLength(1);
});
test("journal permission browser: lost decision recovers original observation after withdrawal without another POST", async ({
  page,
}) => {
  const port = 3180;
  await signIn(page, port);
  const j = await journal(page, port);
  await prepareReview(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, port, "finance");
  await journal(page, port);
  await freezeDecision(page);
  let posts = 0;
  await page.route(decide, async (route) => {
    posts++;
    await route.fetch();
    await route.abort();
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  expect(await retained(page)).not.toBeNull();
  await withdraw(page, port);
  await page.reload();
  await billing(page);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission decision confirmed",
  );
  expect(posts).toBe(1);
  expect(await retained(page)).toBeNull();
  expect((await permissions(page, port, j.id)).authority.revision).toBe(
    j.plan.input.authority.revision + 1,
  );
});
test("journal permission browser: persistence, missing locks and damaged recovery block transport", async ({
  page,
}) => {
  const port = 3181;
  await signIn(page, port);
  await journal(page, port);
  await freezePrepare(page);
  let posts = 0;
  await page.route(prepare, async (r) => {
    posts++;
    await r.continue();
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).permissionSet = original;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith("distributor-journal-permission:"))
        throw Error("Synthetic storage failure");
      original.call(this, k, v);
    };
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic storage failure",
  );
  expect(posts).toBe(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).permissionSet;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText("Web Locks");
  expect(posts).toBe(0);
  await page.reload();
  await billing(page);
  await journal(page, port);
  await freezePrepare(page);
  const session = await (
      await page.request.get(`${origin(port)}/api/session`)
    ).json(),
    key = `distributor-journal-permission:${session.actor.orgId}:${session.actor.id}`;
  await page.evaluate((k) => localStorage.setItem(k, "damaged"), key);
  await confirm(page);
  await expect(panel(page).getByRole("alert").last()).toContainText(
    "recovery evidence is unavailable",
  );
  expect(posts).toBe(0);
});
test("journal permission browser: malformed receipts and cleanup failure preserve the exact original", async ({
  page,
}) => {
  const port = 3182;
  await signIn(page, port);
  await journal(page, port);
  await freezePrepare(page);
  const attempts: { key: string; body: string }[] = [];
  await page.route(prepare, async (r) => {
    attempts.push({
      key: r.request().headers()["idempotency-key"]!,
      body: r.request().postData()!,
    });
    const reply = await r.fetch();
    if (attempts.length === 1) {
      const value = await reply.json();
      value.observation.hash = "a".repeat(64);
      await r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    } else await r.fulfill({ response: reply });
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "evidence could not be confirmed",
  );
  const original = await retained(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    (window as any).permissionRemove = original;
    Storage.prototype.removeItem = function (k) {
      if (!k.startsWith("distributor-journal-permission:"))
        original.call(this, k);
    };
  });
  await fixed(page)
    .getByRole("button", {
      name: "Recover exact journal permission attempt",
      exact: true,
    })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "could not be cleared",
  );
  expect(await retained(page)).toEqual(original);
  await page.evaluate(() => {
    Storage.prototype.removeItem = (window as any).permissionRemove;
  });
  await fixed(page)
    .getByRole("button", {
      name: "Recover exact journal permission attempt",
      exact: true,
    })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission review recorded:",
  );
  expect(attempts).toHaveLength(3);
  expect(
    attempts.every(
      (a) => a.key === attempts[0]!.key && a.body === attempts[0]!.body,
    ),
  ).toBeTruthy();
  expect(await retained(page)).toBeNull();
});
test("journal permission browser: navigation after native commit keeps uncertain preparation", async ({
  page,
}) => {
  const port = 3183;
  await signIn(page, port);
  await journal(page, port);
  await freezePrepare(page);
  let release!: () => void,
    reached = false;
  const held = new Promise<void>((r) => (release = r));
  await page.route(prepare, async (r) => {
    const response = await r.fetch();
    reached = true;
    await held;
    await r.fulfill({ response });
  });
  await confirm(page);
  await expect.poll(() => reached).toBeTruthy();
  const original = await retained(page);
  await navigateWorkspace(page, "Overview");
  release();
  await page.unrouteAll({ behavior: "wait" });
  await billing(page);
  expect(await retained(page)).toEqual(original);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission review recorded:",
  );
  expect(await retained(page)).toBeNull();
});
test("journal permission browser: cancelled and tampered prospective reads never open fixed review", async ({
  page,
}) => {
  const port = 3184;
  await signIn(page, port);
  await journal(page, port);
  let release!: () => void,
    reached = false;
  const held = new Promise<void>((r) => (release = r));
  await page.route(
    "**/api/accounting/journals/*/permission-review",
    async (r) => {
      const response = await r.fetch();
      reached = true;
      await held;
      await r.fulfill({ response });
    },
  );
  await panel(page)
    .getByRole("button", { name: "Load replacement permission", exact: true })
    .click();
  await expect.poll(() => reached).toBeTruthy();
  await panel(page)
    .getByRole("button", {
      name: "Cancel journal permission read",
      exact: true,
    })
    .click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  expect(
    await panel(page)
      .getByRole("region", {
        name: "Prospective journal permission",
        exact: true,
      })
      .count(),
  ).toBe(0);
  const urls: string[] = [];
  await page.route(
    "**/api/accounting/journals/*/permission-review",
    async (r) => {
      urls.push(r.request().url());
      const response = await r.fetch();
      if (urls.length === 1) {
        const value = await response.json();
        value.disclosure.processingCountries = ["XX"];
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(value),
        });
      } else await r.fulfill({ response });
    },
  );
  await panel(page)
    .getByRole("button", { name: "Load replacement permission", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "evidence could not be confirmed",
  );
  expect(await fixed(page).count()).toBe(0);
  await panel(page)
    .getByRole("button", { name: "Retry journal permission read", exact: true })
    .click();
  await expect(
    panel(page).getByRole("region", {
      name: "Prospective journal permission",
      exact: true,
    }),
  ).toBeVisible();
  expect(urls).toHaveLength(2);
  expect(urls[0]).toBe(urls[1]);
});
test("journal permission browser: another tab cannot replace an opened review or overlap transport", async ({
  page,
}) => {
  const port = 3185;
  await signIn(page, port);
  await journal(page, port);
  await freezePrepare(page, "Synthetic first fixed review");
  const other = await page.context().newPage();
  try {
    await other.goto(origin(port));
    await billing(other);
    await journal(other, port);
    await freezePrepare(other, "Synthetic second retained review");
    let release!: () => void,
      reached = false;
    const held = new Promise<void>((r) => (release = r));
    await other.route(prepare, async (r) => {
      reached = true;
      await held;
      await r.fetch();
      await r.abort();
    });
    await confirm(other);
    await expect.poll(() => reached).toBeTruthy();
    let sent = 0;
    await page.route(prepare, async (r) => {
      sent++;
      await r.continue();
    });
    await confirm(page);
    await expect(panel(page).getByRole("alert")).toContainText("Another tab");
    expect(sent).toBe(0);
    await expect(fixed(page)).toContainText("Synthetic first fixed review");
    release();
    await expect(panel(other).getByRole("alert")).toBeVisible();
    await confirm(page);
    await expect(panel(page).getByRole("alert")).toContainText(
      "evidence changed",
    );
    expect(sent).toBe(0);
    await fixed(page)
      .getByRole("button", {
        name: "Close journal permission review",
        exact: true,
      })
      .click();
    await recover(page);
    await expect(panel(page).getByRole("status")).toContainText(
      "Permission review recorded:",
    );
    expect(sent).toBe(1);
    expect(await retained(page)).toBeNull();
  } finally {
    await other.close();
  }
});
test("journal permission browser: bounded history reads exact older rejection and independent rejection retains authority", async ({
  page,
}) => {
  const port = 3186;
  await signIn(page, port, "finance");
  const j = await journal(page, port);
  const list = await permissions(page, port, j.id);
  expect(list.olderReviews).toBe(true);
  let observations = await (
    await page.request.get(
      `${origin(port)}/api/accounting/journals/${j.id}/observations`,
    )
  ).json();
  while (observations.next)
    observations = await (
      await page.request.get(
        `${origin(port)}/api/accounting/journals/${j.id}/observations?after=${encodeURIComponent(observations.next)}`,
      )
    ).json();
  const old = observations.items.find(
    (o: any) =>
      o.body?.kind === "permission-replacement.review" &&
      !list.reviews.some((r: any) => r.id === o.body.id),
  )?.body.id;
  expect(old).toBeTruthy();
  await panel(page)
    .getByLabel("Retained permission review ID", { exact: true })
    .fill(old);
  await panel(page)
    .getByRole("button", {
      name: "Read retained permission review",
      exact: true,
    })
    .click();
  await expect(
    panel(page)
      .getByRole("region", { name: "Journal permission history", exact: true })
      .getByRole("status"),
  ).toContainText("1 retained reviews");
  await panel(page).locator("details summary").click();
  await expect(panel(page)).toContainText(
    "Synthetic historical separate rejection",
  );
  await freezeDecision(
    page,
    "reject",
    "Synthetic independent current rejection",
  );
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Permission decision confirmed",
  );
  const after = await permissions(page, port, j.id);
  expect(after.authority.revision).toBe(j.plan.input.authority.revision);
  expect(after.reviews[0].decision.body.input.decision).toBe("reject");
});
