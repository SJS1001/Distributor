import {
  navigateAccounting,
  navigateWorkspace,
} from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
test("browser: subsequent correction requires accountant evidence before retaining a closed-period preparation", async ({
  page,
}) => {
  await signIn(page, 3308);
  await successor(page)
    .getByRole("button", {
      name: "Load settled predecessor and current policy",
      exact: true,
    })
    .click();
  const form = successor(page).getByRole("form", {
    name: "Review subsequent correction",
  });
  await form
    .getByLabel("Subsequent correction posting date", { exact: true })
    .fill("2026-10-04");
  await form
    .getByLabel("Settled replacement verification evidence", { exact: true })
    .fill("Synthetic independent replacement verified");
  await form
    .getByLabel("Subsequent correction reason", { exact: true })
    .fill("Synthetic closed period second mapping correction");
  const bodies: string[] = [];
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      bodies.push(route.request().postData()!);
      await route.continue();
    },
  );
  await form
    .getByRole("button", { name: "Review subsequent correction", exact: true })
    .click();
  await expect(successor(page).getByRole("alert")).toContainText(
    "An accountant review is required",
  );
  await expect(form).toBeVisible();
  expect(bodies).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("distributor-cost-successor:"),
      ),
    ),
  ).toHaveLength(0);
  await form
    .getByLabel("Subsequent prior period accountant review", { exact: true })
    .fill("Synthetic accountant closed period approval");
  await form
    .getByRole("button", { name: "Review subsequent correction", exact: true })
    .click();
  await expect(
    successor(page).getByRole("region", {
      name: "Fixed subsequent correction review",
    }),
  ).toBeFocused();
  await successor(page)
    .getByLabel(
      "I verified this predecessor, current policy and unchanged quantities and values",
      { exact: true },
    )
    .check();
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(saved(page)).toContainText("State: ready");
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!).priorPeriodEvidence).toBe(
    "Synthetic accountant closed period approval",
  );
});
const panel = (page: Page) =>
  page.getByRole("region", { name: "Approved cost corrections", exact: true });
const successor = (page: Page) =>
  page.getByRole("region", {
    name: "Subsequent account mapping correction",
    exact: true,
  });
const saved = (page: Page) =>
  page.getByRole("region", {
    name: "Saved account mapping correction",
    exact: true,
  });
async function signIn(page: Page, port: number, finance = false) {
  await page.goto(`http://127.0.0.1:${port}`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(finance ? "finance@example.test" : "admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(finance ? "test-only-long-password" : "long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateAccounting(page, "Inventory costs");
  await page
    .getByRole("button", { name: "Load stock cost review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review ORIGINAL", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Load cost corrections", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: /^Open cost correction/ })
    .first()
    .click();
}
async function reviewSuccessor(page: Page) {
  await successor(page)
    .getByRole("button", {
      name: "Load settled predecessor and current policy",
      exact: true,
    })
    .click();
  const form = successor(page).getByRole("form", {
    name: "Review subsequent correction",
  });
  await form
    .getByLabel("Subsequent correction posting date", { exact: true })
    .fill("2026-10-04");
  await form
    .getByLabel("Settled replacement verification evidence", { exact: true })
    .fill("Synthetic independent replacement verified");
  await form
    .getByLabel("Subsequent correction reason", { exact: true })
    .fill("Synthetic second chart mapping correction");
  await form
    .getByRole("button", { name: "Review subsequent correction", exact: true })
    .click();
  await expect(
    successor(page).getByRole("region", {
      name: "Fixed subsequent correction review",
    }),
  ).toBeFocused();
  await successor(page)
    .getByLabel(
      "I verified this predecessor, current policy and unchanged quantities and values",
      { exact: true },
    )
    .check();
}
test("browser: subsequent correction recovers exact lost preparation and requires separate approval", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 3301);
  await reviewSuccessor(page);
  await expect(successor(page)).toContainText("1202");
  const bodies: string[] = [],
    keys: string[] = [];
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      bodies.push(route.request().postData()!);
      keys.push(route.request().headers()["idempotency-key"]!);
      if (bodies.length === 1) {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    },
  );
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(successor(page).getByRole("alert")).toBeVisible();
  await page.reload();
  await signInAlready(page);
  await expect(successor(page)).toContainText("Retained preparation");
  await successor(page)
    .getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    })
    .click();
  await expect(saved(page)).toContainText("State: ready");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(keys[1]).toBe(keys[0]);
  const body = JSON.parse(bodies[0]!);
  expect(body.predecessor).toBeTruthy();
  expect(body.externalRef).toBe("synthetic-replacement");
  await page.unrouteAll({ behavior: "wait" });
  await saved(page)
    .getByLabel("Correction review decision", { exact: true })
    .selectOption("approve");
  await saved(page)
    .getByLabel("Independent correction review reason", { exact: true })
    .fill("Synthetic same principal refused");
  await saved(page)
    .getByRole("button", { name: "Record correction decision" })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    /different|separate/i,
  );
  const context = await browser.newContext();
  const reviewer = await context.newPage();
  await signIn(reviewer, 3301, true);
  await expect(saved(reviewer)).toContainText("State: ready");
  await saved(reviewer)
    .getByLabel("Correction review decision", { exact: true })
    .selectOption("approve");
  await saved(reviewer)
    .getByLabel("Independent correction review reason", { exact: true })
    .fill("Synthetic independent second mapping review");
  await saved(reviewer)
    .getByRole("button", { name: "Record correction decision" })
    .click();
  await expect(saved(reviewer)).toContainText("State: reviewed");
  await context.close();
});
async function signInAlready(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateAccounting(page, "Inventory costs");
  await page
    .getByRole("button", { name: "Load stock cost review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review ORIGINAL", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Load cost corrections", exact: true })
    .click();
  // Recover from the reviewed predecessor; the uncertain child remains separately saved.
  const items = panel(page).getByRole("button", {
    name: /^Open cost correction/,
  });
  await items.last().click();
}
test("browser: subsequent correction replaces final cancelled US replacement without reversal", async ({
  page,
}) => {
  await signIn(page, 3302);
  await successor(page)
    .getByRole("button", {
      name: "Load settled predecessor and current policy",
      exact: true,
    })
    .click();
  const form = successor(page).getByRole("form", {
    name: "Review subsequent correction",
  });
  await form
    .getByLabel("Subsequent correction posting date", { exact: true })
    .fill("2026-10-04");
  await form
    .getByLabel("Settled replacement verification evidence", { exact: true })
    .fill("Synthetic USD cancellation checked");
  await form
    .getByLabel("Final replacement cancellation evidence", { exact: true })
    .fill("Synthetic final non-posting evidence");
  await form
    .getByLabel("Subsequent correction reason", { exact: true })
    .fill("Synthetic cancelled replacement remap");
  await form
    .getByRole("button", { name: "Review subsequent correction", exact: true })
    .click();
  await expect(successor(page)).toContainText('"outcome": "unposted"');
  await expect(successor(page)).toContainText('"currency": "USD"');
  await successor(page)
    .getByLabel(
      "I verified this predecessor, current policy and unchanged quantities and values",
      { exact: true },
    )
    .check();
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(saved(page)).toContainText("State: ready");
  await saved(page)
    .getByText("Inspect frozen correction and balanced journals", {
      exact: true,
    })
    .click();
  await expect(saved(page)).toContainText('"reversal": []');
  await expect(saved(page)).toContainText('"account": "1202"');
  await expect(saved(page)).toContainText('"debit": 18000');
});
test("browser: subsequent correction refuses unresolved predecessor legs", async ({
  page,
}) => {
  await signIn(page, 3303);
  let writes = 0;
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      writes++;
      await route.continue();
    },
  );
  await successor(page)
    .getByRole("button", {
      name: "Load settled predecessor and current policy",
      exact: true,
    })
    .click();
  await expect(successor(page).getByRole("alert")).toContainText(
    "Resolve every predecessor leg first",
  );
  await expect(
    successor(page).getByRole("form", { name: "Review subsequent correction" }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});
test("browser: subsequent correction retains malformed committed preparation receipt until exact recovery", async ({
  page,
}) => {
  await signIn(page, 3304);
  await reviewSuccessor(page);
  const keys: string[] = [];
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      const response = await route.fetch();
      const result = await response.json();
      if (keys.length === 1) result.plan.orgId = "wrong-organization";
      await route.fulfill({ response, json: result });
    },
  );
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(successor(page).getByRole("alert")).toContainText(
    "identity or integrity",
  );
  const retained = await page.evaluate(() =>
    Object.entries(localStorage).find(([k]) =>
      k.startsWith("distributor-cost-successor:"),
    ),
  );
  expect(retained).toBeTruthy();
  await successor(page)
    .getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    })
    .click();
  await expect(saved(page)).toContainText("State: ready");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("distributor-cost-successor:"),
      ),
    ),
  ).toEqual([]);
});
test("browser: subsequent correction refuses damaged and empty retained evidence without replacement writes", async ({
  page,
}) => {
  await signIn(page, 3305);
  await reviewSuccessor(page);
  let writes = 0;
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      writes++;
      await route.abort();
    },
  );
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(successor(page).getByRole("alert")).toBeVisible();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-cost-successor:"),
    )!;
    const a = JSON.parse(localStorage.getItem(key)!);
    a.payload.reason = "Changed evidence";
    localStorage.setItem(key, JSON.stringify(a));
  });
  await successor(page)
    .getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    })
    .click();
  await expect(successor(page).getByRole("alert")).toContainText("damaged");
  expect(writes).toBe(1);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("distributor-cost-successor:"),
    )!;
    localStorage.setItem(key, "");
  });
  await page.reload();
  await signInAlready(page);
  await expect(successor(page).getByRole("alert")).toContainText("damaged");
  await expect(
    successor(page).getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    successor(page).getByRole("button", {
      name: "Prepare subsequent correction",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
});
test("browser: subsequent correction coordinates competing tabs around one exact preparation", async ({
  page,
  context,
}) => {
  await signIn(page, 3306);
  await reviewSuccessor(page);
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:3306");
  await signInAlready(other);
  await reviewSuccessor(other);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const keys: string[] = [];
  await context.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (keys.length === 1) {
        await route.fetch();
        await gate;
        await route.abort();
      } else await route.continue();
    },
  );
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect.poll(() => keys.length).toBe(1);
  await successor(other)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(successor(other).getByRole("alert")).toContainText(
    "Another tab",
  );
  expect(keys).toHaveLength(1);
  release();
  await expect(
    successor(page).getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    }),
  ).toBeEnabled();
  await successor(other)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await expect(successor(other).getByRole("alert")).toContainText(
    "retained preparation",
  );
  await successor(other)
    .getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    })
    .click();
  await expect(saved(other)).toContainText("State: ready");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});
test("browser: subsequent correction retains preparation after an abandoned committed reply", async ({
  page,
}) => {
  await signIn(page, 3307);
  await reviewSuccessor(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let committed!: () => void;
  const done = new Promise<void>((r) => (committed = r));
  await page.route(
    "**/api/commands/accounting.cost.correction.prepare",
    async (route) => {
      const response = await route.fetch();
      committed();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await successor(page)
    .getByRole("button", { name: "Prepare subsequent correction", exact: true })
    .click();
  await done;
  await navigateWorkspace(page, "Overview");
  release();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("distributor-cost-successor:"),
      ),
    ),
  ).toHaveLength(1);
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await signInAlready(page);
  await successor(page)
    .getByRole("button", {
      name: "Recover exact subsequent preparation",
      exact: true,
    })
    .click();
  await expect(saved(page)).toContainText("State: ready");
});
