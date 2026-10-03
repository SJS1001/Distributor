// Synthetic browser and native evidence only; no provider requests.
import { test, expect, type Page } from "@playwright/test";
const origin = (port: number) => `http://127.0.0.1:${port}`;
const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Original journal reconciliation",
    exact: true,
  });
const review = (page: Page) =>
  panel(page).getByRole("region", {
    name: "Exact original journal reconciliation",
    exact: true,
  });
const endpoint = "**/api/commands/accounting.cost.reconcile-journals";
async function signIn(page: Page, port: number, admin = false) {
  await page.goto(origin(port));
  await page
    .getByLabel("Email", { exact: true })
    .fill(admin ? "admin@example.test" : "finance@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(admin ? "long-test-only-password" : "test-only-long-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await billing(page);
}
async function billing(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Billing", exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
}
async function open(page: Page, port: number) {
  const costs = await (
    await page.request.get(`${origin(port)}/api/accounting/costs`)
  ).json();
  const packet = costs.items[0];
  await panel(page)
    .getByLabel("Approved original cost packet ID", { exact: true })
    .fill(packet.id);
  await panel(page)
    .getByRole("button", { name: "Load original reconciliation", exact: true })
    .click();
  await expect(
    panel(page).getByRole("region", {
      name: "Original posting date controls",
      exact: true,
    }),
  ).toBeVisible();
  return packet;
}
async function freeze(page: Page, ref: string) {
  for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"])
    await panel(page)
      .getByLabel(`Independent ledger evidence for ${date}`, { exact: true })
      .fill(`synthetic:ledger:${date}`);
  await panel(page)
    .getByLabel("Independent batch reconciliation reference", { exact: true })
    .fill(ref);
  await panel(page)
    .getByLabel("Reconciliation reason", { exact: true })
    .fill("Synthetic independent finance reconciliation");
  await panel(page)
    .getByLabel("I reconciled every original posting date", { exact: true })
    .check();
  await panel(page)
    .getByRole("button", {
      name: "Review exact original reconciliation",
      exact: true,
    })
    .click();
  await expect(
    review(page).getByRole("heading", {
      name: "Exact original journal reconciliation",
      exact: true,
    }),
  ).toBeFocused();
}
const confirm = (page: Page) =>
  review(page)
    .getByRole("button", {
      name: "Confirm original reconciliation",
      exact: true,
    })
    .click();
async function retained(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-journal-reconciliation:"),
    );
    return key ? { key, raw: localStorage.getItem(key)! } : null;
  });
}

test("journal reconciliation browser: phone reviews all three dates and preserves stock with explicit finance confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, 3187);
  const before = await (
    await page.request.get(`${origin(3187)}/api/dashboard`)
  ).json();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals"))
      posts++;
  });
  const packet = await open(page, 3187);
  for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"])
    await expect(panel(page)).toContainText(date);
  await expect(panel(page)).toContainText("CAD");
  await freeze(page, "synthetic:browser-three-date");
  expect(await review(page).locator("input,select,textarea").count()).toBe(0);
  expect(posts).toBe(0);
  await confirm(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Original journal reconciliation confirmed",
  );
  const accepted = await (
    await page.request.get(`${origin(3187)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(accepted.state).toBe("accepted");
  expect(accepted.receipt.debit).toBe(18000);
  expect(accepted.receipt.credit).toBe(18000);
  expect(
    accepted.receipt.nativeReconciliation.journals.map((r: any) => [
      r.postingDate,
      r.externalId,
      r.debit,
      r.credit,
      r.evidenceRef,
    ]),
  ).toEqual([
    ["2026-10-01", "500", 6000, 6000, "synthetic:ledger:2026-10-01"],
    ["2026-10-02", "501", 6000, 6000, "synthetic:ledger:2026-10-02"],
    ["2026-10-03", "502", 6000, 6000, "synthetic:ledger:2026-10-03"],
  ]);
  expect(await retained(page)).toBeNull();
  const after = await (
    await page.request.get(`${origin(3187)}/api/dashboard`)
  ).json();
  expect(after.stock).toEqual(before.stock);
  expect(posts).toBe(1);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("journal reconciliation browser: lost US reply recovers the exact receipt by reading before any retry", async ({
  page,
}) => {
  await signIn(page, 3188);
  const packet = await open(page, 3188);
  await expect(panel(page)).toContainText("USD");
  await freeze(page, "synthetic:us-lost-reply");
  let postedKey = "",
    postedBody = "",
    posts = 0;
  await page.route(endpoint, async (route) => {
    posts++;
    postedKey = route.request().headers()["idempotency-key"]!;
    postedBody = route.request().postData()!;
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"unexpected":"lost reply"}',
    });
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "reply could not be verified",
  );
  const saved = (await retained(page))!;
  expect(JSON.parse(saved.raw).key).toBe(postedKey);
  expect(JSON.parse(saved.raw).payload).toEqual(JSON.parse(postedBody));
  const accepted = await (
    await page.request.get(`${origin(3188)}/api/accounting/costs/${packet.id}`)
  ).json();
  await page.unroute(endpoint);
  await page.reload();
  await billing(page);
  let recoveryPosts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals"))
      recoveryPosts++;
  });
  const reads: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      r.url().includes(`/api/accounting/costs/${packet.id}`)
    )
      reads.push(r.url());
  });
  await panel(page)
    .getByRole("button", {
      name: "Review retained original reconciliation",
      exact: true,
    })
    .click();
  await review(page)
    .getByRole("button", {
      name: "Recover exact original reconciliation",
      exact: true,
    })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Original journal reconciliation confirmed",
  );
  expect(posts).toBe(1);
  expect(recoveryPosts).toBe(0);
  expect(reads.map((url) => new URL(url).pathname)).toEqual([
    `/api/accounting/costs/${packet.id}/journal-reconciliation`,
    `/api/accounting/costs/${packet.id}`,
  ]);
  expect(await retained(page)).toBeNull();
  expect(
    (
      await (
        await page.request.get(
          `${origin(3188)}/api/accounting/costs/${packet.id}`,
        )
      ).json()
    ).receipt,
  ).toEqual(accepted.receipt);
  await expect(
    panel(page).getByRole("button", {
      name: "Load original reconciliation",
      exact: true,
    }),
  ).toBeFocused();
});

test("journal reconciliation browser: a pending original date remains readable and cannot be confirmed", async ({
  page,
}) => {
  await signIn(page, 3189);
  const packet = await open(page, 3189);
  await expect(panel(page)).toContainText("state pending");
  await expect(panel(page)).toContainText(
    "2026-10-03 has no final posted native original",
  );
  await expect(
    panel(page).getByRole("button", {
      name: "Review exact original reconciliation",
      exact: true,
    }),
  ).toHaveCount(0);
  const current = await (
    await page.request.get(`${origin(3189)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(current.state).toBe("reviewed");
  expect(current.receipt).toBeNull();
});

test("journal reconciliation browser: a Canadian USD source remains readable without unsupported native originals", async ({
  page,
}) => {
  await signIn(page, 3190);
  const packet = await open(page, 3190);
  await expect(panel(page)).toContainText("CA · USD");
  await expect(panel(page)).toContainText(
    "No native original journal for this date",
  );
  await expect(
    panel(page).getByRole("button", {
      name: "Review exact original reconciliation",
      exact: true,
    }),
  ).toHaveCount(0);
  const current = await (
    await page.request.get(`${origin(3190)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(current.region).toBe("CA");
  expect(current.currency).toBe("USD");
  expect(current.state).toBe("reviewed");
  expect(current.receipt).toBeNull();
});

async function recover(page: Page) {
  await panel(page)
    .getByRole("button", {
      name: "Review retained original reconciliation",
      exact: true,
    })
    .click();
  await review(page)
    .getByRole("button", {
      name: "Recover exact original reconciliation",
      exact: true,
    })
    .click();
}

test("journal reconciliation browser: a request lost before delivery retries only its exact original key and evidence", async ({
  page,
}) => {
  await signIn(page, 3191);
  const packet = await open(page, 3191);
  await freeze(page, "synthetic:never-delivered");
  let key = "",
    body = "";
  await page.route(endpoint, async (route) => {
    key = route.request().headers()["idempotency-key"]!;
    body = route.request().postData()!;
    await route.abort("failed");
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toBeVisible();
  const saved = (await retained(page))!;
  expect(JSON.parse(saved.raw).key).toBe(key);
  expect(JSON.parse(saved.raw).payload).toEqual(JSON.parse(body));
  await page.unroute(endpoint);
  await page.reload();
  await billing(page);
  const calls: string[] = [];
  let retryKey = "",
    retryBody = "";
  page.on("request", (r) => {
    if (
      r
        .url()
        .includes(`/api/accounting/costs/${packet.id}/journal-reconciliation`)
    )
      calls.push("read");
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals")) {
      calls.push("post");
      retryKey = r.headers()["idempotency-key"]!;
      retryBody = r.postData()!;
    }
  });
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Original journal reconciliation confirmed",
  );
  expect(calls).toEqual(["read", "post"]);
  expect(retryKey).toBe(key);
  expect(retryBody).toBe(body);
  expect(await retained(page)).toBeNull();
  const accepted = await (
    await page.request.get(`${origin(3191)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(accepted.receipt.externalRef).toBe("synthetic:never-delivered");
  expect(accepted.receipt.nativeReconciliation.journals).toEqual(
    JSON.parse(body).journals,
  );
});

test("journal reconciliation browser: storage changing during hashing cannot overwrite another exact attempt", async ({
  page,
}) => {
  await signIn(page, 3192);
  const packet = await open(page, 3192);
  const native = await (
    await page.request.get(
      `${origin(3192)}/api/accounting/costs/${packet.id}/journal-reconciliation`,
    )
  ).json();
  const session = await (
    await page.request.get(`${origin(3192)}/api/session`)
  ).json();
  const {
    reviewHash,
    issues: _issues,
    accepted: _accepted,
    superseded: _superseded,
    canConfirm: _canConfirm,
    ...snapshot
  } = native;
  const competing = {
    key: "11111111-1111-4111-8111-111111111111",
    snapshot,
    payload: {
      packetId: packet.id,
      contentHash: native.contentHash,
      reviewHash,
      externalRef: "synthetic:competing-tab",
      reason: "Independent synthetic competing review",
      confirmation: "all-dates-reconciled",
      journals: native.dates.map((d: any) => ({
        journalId: d.journal.id,
        postingDate: d.postingDate,
        externalId: d.journal.posted.externalId,
        syncToken: d.journal.posted.syncToken,
        debit: d.debit,
        credit: d.credit,
        evidenceRef: `synthetic:other-ledger:${d.postingDate}`,
      })),
    },
  };
  await freeze(page, "synthetic:original-review");
  const fixed = await review(page).innerText();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals"))
      posts++;
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
      key: `distributor-journal-reconciliation:${native.organizationId}:${session.actor.id}`,
      raw: JSON.stringify(competing),
    },
  );
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "recovery evidence changed",
  );
  expect(posts).toBe(0);
  expect(await review(page).innerText()).toBe(fixed);
  expect(JSON.parse((await retained(page))!.raw)).toEqual(competing);
  const current = await (
    await page.request.get(`${origin(3192)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(current.state).toBe("reviewed");
  expect(current.receipt).toBeNull();
});

test("journal reconciliation browser: failed retention sends nothing and failed cleanup recovers the unchanged receipt by reading", async ({
  page,
}) => {
  await signIn(page, 3193);
  const packet = await open(page, 3193);
  await freeze(page, "synthetic:storage-failure");
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals"))
      posts++;
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreSetItem = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("distributor-journal-reconciliation:"))
        throw Error("Synthetic storage write failure");
      return original.call(this, key, value);
    };
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic storage write failure",
  );
  expect(posts).toBe(0);
  expect(await retained(page)).toBeNull();
  await page.evaluate(() => {
    (window as any).restoreSetItem();
    const original = Storage.prototype.removeItem;
    (window as any).restoreRemoveItem = () => {
      Storage.prototype.removeItem = original;
    };
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("distributor-journal-reconciliation:"))
        throw Error("Synthetic storage cleanup failure");
      return original.call(this, key);
    };
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "Synthetic storage cleanup failure",
  );
  expect(posts).toBe(1);
  const saved = (await retained(page))!;
  const accepted = await (
    await page.request.get(`${origin(3193)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(accepted.state).toBe("accepted");
  await page.evaluate(() => (window as any).restoreRemoveItem());
  await page.reload();
  await billing(page);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Original journal reconciliation confirmed",
  );
  expect(posts).toBe(1);
  expect(await retained(page)).toBeNull();
  const current = await (
    await page.request.get(`${origin(3193)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(current.receipt).toEqual(accepted.receipt);
  expect(current.receipt.nativeReconciliation.journals).toEqual(
    JSON.parse(saved.raw).payload.journals,
  );
});

test("journal reconciliation browser: cancelled reads and closed late replies cannot reopen review or clear the uncertain attempt", async ({
  page,
}) => {
  await signIn(page, 3194);
  const costs = await (
    await page.request.get(`${origin(3194)}/api/accounting/costs`)
  ).json();
  const packet = costs.items[0];
  let releaseRead!: () => void, readArrived!: () => void;
  const arrived = new Promise<void>((resolve) => {
    readArrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readEndpoint = `**/api/accounting/costs/${packet.id}/journal-reconciliation`;
  await page.route(readEndpoint, async (route) => {
    const response = await route.fetch();
    readArrived();
    await released;
    await route.fulfill({ response }).catch(() => {});
  });
  await panel(page)
    .getByLabel("Approved original cost packet ID", { exact: true })
    .fill(packet.id);
  await panel(page)
    .getByRole("button", { name: "Load original reconciliation", exact: true })
    .click();
  await arrived;
  await panel(page)
    .getByRole("button", { name: "Cancel reconciliation read", exact: true })
    .click();
  releaseRead();
  await page.unroute(readEndpoint);
  await expect(
    panel(page).getByRole("region", {
      name: "Original posting date controls",
      exact: true,
    }),
  ).toHaveCount(0);
  await open(page, 3194);
  await freeze(page, "synthetic:late-accepted-reply");
  let releasePost!: () => void, committed!: () => void;
  const commit = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const postReleased = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  let posts = 0;
  await page.route(endpoint, async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await postReleased;
    await route.fulfill({ response }).catch(() => {});
  });
  await confirm(page);
  await commit;
  const saved = (await retained(page))!;
  await review(page)
    .getByRole("button", {
      name: "Close original reconciliation review",
      exact: true,
    })
    .click();
  releasePost();
  await page.unroute(endpoint);
  await expect(review(page)).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", {
      name: "Review retained original reconciliation",
      exact: true,
    }),
  ).toBeFocused();
  expect(await retained(page)).toEqual(saved);
  await recover(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Original journal reconciliation confirmed",
  );
  expect(posts).toBe(1);
  expect(await retained(page)).toBeNull();
});

test("journal reconciliation browser: another tab's lock and malformed retained evidence block confirmation", async ({
  page,
  context,
}) => {
  await signIn(page, 3195);
  const packet = await open(page, 3195);
  await freeze(page, "synthetic:lock-owner");
  const session = await (
    await page.request.get(`${origin(3195)}/api/session`)
  ).json();
  const key = `distributor-journal-reconciliation:${session.actor.orgId}:${session.actor.id}`;
  const other = await context.newPage();
  await other.goto(origin(3195));
  await other.evaluate(async (key) => {
    await new Promise<void>((resolve) => {
      void navigator.locks.request(key, async () => {
        resolve();
        await new Promise<void>((release) => {
          (window as any).releaseReconciliationLock = release;
        });
      });
    });
  }, key);
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands/accounting.cost.reconcile-journals"))
      posts++;
  });
  await confirm(page);
  await expect(panel(page).getByRole("alert")).toContainText("Another tab");
  expect(posts).toBe(0);
  expect(await retained(page)).toBeNull();
  await other.evaluate(() => (window as any).releaseReconciliationLock());
  await other.close();
  await page.evaluate((key) => {
    const raw = '{"key":"malformed-attempt"}';
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw }));
  }, key);
  await expect(panel(page).getByRole("alert").first()).toContainText(
    "recovery evidence is unavailable",
  );
  await expect(
    review(page).getByRole("button", {
      name: "Confirm original reconciliation",
      exact: true,
    }),
  ).toBeDisabled();
  expect(posts).toBe(0);
  expect((await retained(page))!.raw).toBe('{"key":"malformed-attempt"}');
  const current = await (
    await page.request.get(`${origin(3195)}/api/accounting/costs/${packet.id}`)
  ).json();
  expect(current.state).toBe("reviewed");
  expect(current.receipt).toBeNull();
});
