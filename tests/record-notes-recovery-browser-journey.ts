import { test, expect, type Page } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

async function login(page: Page, email = "admin@example.test") {
  await page.goto(
    email.startsWith("notes-buyer") ? "/#customer-sign-in" : "/#admin-sign-in",
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText(
    email.startsWith("notes-buyer") ? "Shop" : "Overview",
  );
}
async function signOut(page: Page) {
  await page.goto("/#home");
  await page
    .getByRole("navigation", { name: "Public navigation" })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Customer sign in", exact: true }).first(),
  ).toBeVisible();
}
async function openNotes(page: Page) {
  await navigateWorkspace(page, "Customers");
  await page
    .getByRole("link", { name: "Synthetic buyer", exact: true })
    .click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("New staff note").first()).toBeVisible();
}

for (const action of ["add", "verify"] as const) {
  test(`uncertain note ${action} retains exact recovery through auth failures, sign-out and account switching`, async ({
    page,
  }) => {
    const body = `Recovery boundary ${action} ${crypto.randomUUID()}`;
    await login(page);
    await openNotes(page);
    if (action === "verify") {
      await page.getByLabel("New staff note").fill(body);
      await page
        .getByRole("button", { name: "Add staff note", exact: true })
        .click();
      await expect(
        page.getByText("Staff note added.", { exact: true }),
      ).toBeVisible();
      await signOut(page);
      await login(page, "verifier@example.test");
      await openNotes(page);
    } else await page.getByLabel("New staff note").fill(body);
    const commandPath = `**/api/commands/notes.${action}`;
    let payload = "",
      key = "",
      target = "";
    await page.route(commandPath, async (route) => {
      payload = route.request().postData()!;
      key = route.request().headers()["idempotency-key"]!;
      const command = JSON.parse(payload);
      target = `/api/notes/${command.kind}/${command.recordId}`;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort();
    });
    if (action === "add")
      await page
        .getByRole("button", { name: "Add staff note", exact: true })
        .click();
    else
      await page
        .locator(".record-note-list li")
        .filter({ hasText: body })
        .getByRole("button", { name: "Verify this note", exact: true })
        .click();
    const retry = page.getByRole("button", {
      name: "Retry saved note attempt",
    });
    await expect(retry).toBeEnabled();
    await page.unroute(commandPath);
    // Simulate an unresolved attempt retained by the previous same-tab release.
    const legacy = await page.evaluate(() => {
      const storageKey = Object.keys(localStorage).find((key) =>
        key.startsWith("distributor-notes:"),
      )!;
      const raw = localStorage.getItem(storageKey)!;
      sessionStorage.setItem(storageKey, raw);
      localStorage.removeItem(storageKey);
      return { storageKey, raw };
    });
    await page.reload();
    await expect(retry).toBeEnabled();
    expect(
      await page.evaluate(
        ({ storageKey }) => ({
          durable: localStorage.getItem(storageKey),
          legacy: sessionStorage.getItem(storageKey),
        }),
        legacy,
      ),
    ).toEqual({ durable: legacy.raw, legacy: null });
    for (const status of [401, 403]) {
      await page.route(commandPath, async (route) => {
        expect(route.request().postData()).toBe(payload);
        expect(route.request().headers()["idempotency-key"]).toBe(key);
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Current authority unavailable",
            code: "FORBIDDEN",
          }),
        });
      });
      await retry.click();
      await expect(page.getByRole("alert")).toContainText(
        "Current authority unavailable",
      );
      await expect(retry).toBeEnabled();
      await page.unroute(commandPath);
      await page.reload();
      await expect(retry).toBeEnabled();
    }
    await signOut(page);
    await login(page, "notes-buyer@example.test");
    await expect(page.getByText(body, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry saved note attempt" }),
    ).toHaveCount(0);
    expect((await page.request.get(target)).status()).toBe(403);
    await signOut(page);
    // A different staff member can read the record, but must not inherit this actor's command.
    await login(
      page,
      action === "add" ? "verifier@example.test" : "admin@example.test",
    );
    await openNotes(page);
    await expect(retry).toHaveCount(0);
    await signOut(page);
    await login(
      page,
      action === "add" ? "admin@example.test" : "verifier@example.test",
    );
    await openNotes(page);
    await expect(retry).toBeEnabled();
    await page.route(commandPath, async (route) => {
      expect(route.request().postData()).toBe(payload);
      expect(route.request().headers()["idempotency-key"]).toBe(key);
      await route.continue();
    });
    await retry.click();
    await expect(retry).toHaveCount(0);
    const records = (await (await page.request.get(target)).json()).items;
    expect(
      records.filter((record: { body: string }) => record.body === body),
    ).toHaveLength(1);
    if (action === "verify")
      expect(
        records.find((record: { body: string }) => record.body === body)
          .verification.verifierName,
      ).toBe("Independent approver");
  });
}

for (const fault of [
  "malformed durable",
  "malformed legacy",
  "conflicting attempts",
  "failed migration",
] as const) {
  test(`note recovery locks without losing originals for ${fault}`, async ({
    page,
  }) => {
    await login(page);
    await openNotes(page);
    await page.route("**/api/commands/notes.add", (route) => route.abort());
    await page
      .getByLabel("New staff note")
      .fill(`Unsent storage fixture ${fault}`);
    await page
      .getByRole("button", { name: "Add staff note", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saved note attempt" }),
    ).toBeEnabled();
    const original = await page.evaluate((fault) => {
      const storageKey = Object.keys(localStorage).find((key) =>
        key.startsWith("distributor-notes:"),
      )!;
      const raw = localStorage.getItem(storageKey)!;
      if (fault === "malformed durable") localStorage.setItem(storageKey, "");
      if (fault === "malformed legacy") sessionStorage.setItem(storageKey, "{");
      if (fault === "conflicting attempts") {
        const other = JSON.parse(raw);
        other.key = crypto.randomUUID();
        sessionStorage.setItem(storageKey, JSON.stringify(other));
      }
      if (fault === "failed migration") {
        sessionStorage.setItem(storageKey, raw);
        localStorage.removeItem(storageKey);
      }
      return {
        storageKey,
        durable: localStorage.getItem(storageKey),
        legacy: sessionStorage.getItem(storageKey),
      };
    }, fault);
    if (fault === "failed migration")
      await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && key.startsWith("distributor-notes:"))
            throw new DOMException("Unavailable storage", "QuotaExceededError");
          return set.call(this, key, value);
        };
      });
    await page.reload();
    await expect(page.getByRole("alert")).toHaveText(
      "Saved note attempt cannot be read. Restore browser storage and reload before adding or verifying notes.",
    );
    await expect(page.getByLabel("New staff note")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add staff note", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Retry saved note attempt" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh staff notes" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Saved note attempt cannot be read",
    );
    expect(
      await page.evaluate(
        ({ storageKey }) => ({
          storageKey,
          durable: localStorage.getItem(storageKey),
          legacy: sessionStorage.getItem(storageKey),
        }),
        original,
      ),
    ).toEqual(original);
  });
}

test("a stale second tab cannot overwrite another tab's unresolved note", async ({
  page,
  context,
}) => {
  await login(page);
  await openNotes(page);
  const stale = await context.newPage();
  await stale.goto("/");
  await openNotes(stale);
  const body = `Original tab ${crypto.randomUUID()}`;
  await stale.getByLabel("New staff note").fill("Stale tab draft");
  await page.route("**/api/commands/notes.add", async (route) => {
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort();
  });
  await page.getByLabel("New staff note").fill(body);
  await page
    .getByRole("button", { name: "Add staff note", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved note attempt" }),
  ).toBeEnabled();
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("distributor-notes:"),
    )!;
    return { key, raw: localStorage.getItem(key)! };
  });
  let sent = 0;
  await stale.route("**/api/commands/notes.add", (route) => {
    sent++;
    return route.abort();
  });
  await stale
    .getByRole("button", { name: "Add staff note", exact: true })
    .click();
  await expect(stale.getByRole("alert")).toContainText(
    "Another saved note attempt exists",
  );
  await expect(stale.getByLabel("New staff note")).toBeDisabled();
  await stale.getByRole("button", { name: "Refresh staff notes" }).click();
  await expect(stale.getByRole("alert")).toContainText(
    "Another saved note attempt exists",
  );
  expect(sent).toBe(0);
  expect(
    await stale.evaluate(({ key }) => localStorage.getItem(key), saved),
  ).toBe(saved.raw);
  await stale.unroute("**/api/commands/notes.add");
  await stale.reload();
  const retry = stale.getByRole("button", { name: "Retry saved note attempt" });
  await expect(retry).toBeEnabled();
  await stale.route("**/api/commands/notes.add", async (route) => {
    const attempt = JSON.parse(saved.raw);
    expect(route.request().headers()["idempotency-key"]).toBe(attempt.key);
    expect(route.request().postData()).toBe(JSON.stringify(attempt.payload));
    await route.continue();
  });
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(
    stale.locator(".record-note-list li").filter({ hasText: body }),
  ).toHaveCount(1);
  await expect(stale.getByText("Stale tab draft", { exact: true })).toHaveCount(
    0,
  );
});

test("legacy note attempt survives public sign-out before the record mounts", async ({
  page,
}) => {
  await login(page);
  await openNotes(page);
  await page.route("**/api/commands/notes.add", (route) => route.abort());
  await page.getByLabel("New staff note").fill("Legacy public sign-out draft");
  await page
    .getByRole("button", { name: "Add staff note", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saved note attempt" }),
  ).toBeEnabled();
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("distributor-notes:"),
    )!;
    const raw = localStorage.getItem(key)!;
    sessionStorage.setItem(key, raw);
    sessionStorage.setItem("unrelated-session-state", "must clear");
    localStorage.removeItem(key);
    return { key, raw };
  });
  await signOut(page);
  expect(
    await page.evaluate(
      ({ key }) => ({
        raw: sessionStorage.getItem(key),
        unrelated: sessionStorage.getItem("unrelated-session-state"),
      }),
      saved,
    ),
  ).toEqual({ raw: saved.raw, unrelated: null });
  await login(page, "notes-buyer@example.test");
  await expect(
    page.getByText("Legacy public sign-out draft", { exact: true }),
  ).toHaveCount(0);
  await signOut(page);
  await login(page);
  await openNotes(page);
  await expect(
    page.getByRole("button", { name: "Retry saved note attempt" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      ({ key }) => ({
        durable: localStorage.getItem(key),
        legacy: sessionStorage.getItem(key),
      }),
      saved,
    ),
  ).toEqual({ durable: saved.raw, legacy: null });
});
