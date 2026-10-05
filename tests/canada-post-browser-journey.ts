import { navigateWorkspace } from "./workspace-navigation.ts";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:3120";
async function login(page: Page) {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const csrf = (await (await response).json()).csrf;
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  return csrf;
}
async function open(page: Page) {
  await navigateWorkspace(page, "Orders", "Shipments");
  await page
    .getByRole("button", {
      name: "Review Canada Post warehouse groups",
      exact: true,
    })
    .click();
  const pane = page.getByRole("region", {
    name: "Canada Post warehouse groups",
    exact: true,
  });
  await pane
    .getByLabel("Canada Post warehouse", { exact: true })
    .selectOption({ label: "Toronto" });
  return pane;
}
async function native(page: Page) {
  const d = await (await page.request.get(origin + "/api/dashboard")).json();
  const shipments: any[] = [];
  let after: string | null = null;
  do {
    const p = await (
      await page.request.get(
        origin + `/api/shipments/page${after ? `?after=${after}` : ""}`,
      )
    ).json();
    shipments.push(...p.items);
    after = p.next;
  } while (after);
  return { stock: d.stock, orders: d.orders, invoices: d.invoices, shipments };
}

test("browser: Canada Post warehouse selection cancels stale reads, refuses disabled operations and recovers candidate page failures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const d = await (await page.request.get(origin + "/api/dashboard")).json();
  const toronto = d.warehouses.find((w: any) => w.name === "Toronto").id;
  const ottawa = d.warehouses.find((w: any) => w.name === "Ottawa").id;
  let release!: () => void, seen!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    held = new Promise<void>((resolve) => (seen = resolve));
  await page.route(
    `**/api/warehouses/${toronto}/canada-post/candidates`,
    async (route) => {
      const response = await route.fetch();
      seen();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  const panel = await open(page);
  await held;
  await panel
    .getByLabel("Canada Post warehouse", { exact: true })
    .selectOption(ottawa);
  await expect(
    panel.getByText("Canada Post test processing is disabled", {
      exact: false,
    }),
  ).toBeVisible();
  release();
  await page.unroute(`**/api/warehouses/${toronto}/canada-post/candidates`);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "Prepare selected Canada Post group",
      exact: true,
    }),
  ).toBeDisabled();
  let failures = 0;
  await page.route(
    `**/api/warehouses/${toronto}/canada-post/candidates`,
    async (route) => {
      if (failures++ === 0)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Synthetic candidate read unavailable",
            code: "TEST_READ",
          }),
        });
      else await route.continue();
    },
  );
  await panel
    .getByLabel("Canada Post warehouse", { exact: true })
    .selectOption(toronto);
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic candidate read unavailable",
  );
  await expect(
    panel.getByRole("button", {
      name: "Prepare selected Canada Post group",
      exact: true,
    }),
  ).toBeDisabled();
  await panel
    .getByRole("button", {
      name: "Retry pending Canada Post bookings",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("checkbox")).toHaveCount(20);
  await panel
    .getByRole("button", {
      name: "Load more pending Canada Post bookings",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("checkbox")).toHaveCount(23);
  await expect(
    panel.getByRole("button", {
      name: "Load more pending Canada Post bookings",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Close Canada Post groups", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Review Canada Post warehouse groups",
      exact: true,
    }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("browser: Canada Post phone group preparation survives a lost reply, recovers members and manifest without resending, and downloads exact private evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const csrf = await login(page);
  const d = await (await page.request.get(origin + "/api/dashboard")).json(),
    warehouse = d.warehouses.find((w: any) => w.name === "Toronto").id;
  const before = await native(page);
  const first = await (
    await page.request.get(
      origin + `/api/warehouses/${warehouse}/canada-post/candidates`,
    )
  ).json();
  const last = await (
    await page.request.get(
      origin +
        `/api/warehouses/${warehouse}/canada-post/candidates?after=${first.next}`,
    )
  ).json();
  const headers = (key: string) => ({
    origin,
    "x-csrf-token": csrf,
    "idempotency-key": key,
  });
  for (let i = 0; i < 22; i++) {
    const prepared = await page.request.post(
      origin + "/api/commands/canada-post.group.prepare",
      {
        headers: headers(`history-${i}`),
        data: {
          warehouseId: warehouse,
          entries: [
            {
              bookingId: first.items[0].id,
              reviewHash: first.items[0].reviewHash,
            },
          ],
        },
      },
    );
    expect(prepared.status()).toBe(200);
    const g = await prepared.json();
    const canceled = await page.request.post(
      origin + "/api/commands/canada-post.group.cancel",
      {
        headers: headers(`history-cancel-${i}`),
        data: {
          groupId: g.id,
          reviewHash: g.reviewHash,
          reason: "Synthetic retained history",
        },
      },
    );
    expect(canceled.status()).toBe(200);
  }
  const panel = await open(page);
  await expect(
    panel.getByRole("button", { name: /^Review Canada Post group / }),
  ).toHaveCount(20);
  await panel
    .getByRole("button", { name: "Load more Canada Post groups", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: /^Review Canada Post group / }),
  ).toHaveCount(22);
  await expect(
    panel.getByRole("button", {
      name: "Load more Canada Post groups",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("checkbox", {
      name: `Select Canada Post booking ${first.items[0].id}`,
      exact: true,
    })
    .check();
  await panel
    .getByRole("button", {
      name: "Load more pending Canada Post bookings",
      exact: true,
    })
    .click();
  await panel
    .getByRole("checkbox", {
      name: `Select Canada Post booking ${last.items[2].id}`,
      exact: true,
    })
    .check();
  const attempts: { key: string | null; payload: any }[] = [];
  let groupId = "";
  await page.route(
    "**/api/commands/canada-post.group.prepare",
    async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"] ?? null,
        payload: route.request().postDataJSON(),
      });
      if (attempts.length === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        groupId = (await response.json()).id;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await panel
    .getByRole("button", {
      name: "Prepare selected Canada Post group",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Failed to fetch");
  await expect(
    panel.getByRole("checkbox", {
      name: `Select Canada Post booking ${first.items[0].id}`,
      exact: true,
    }),
  ).toBeDisabled();
  await panel
    .getByRole("button", {
      name: "Retry exact Canada Post group preparation",
      exact: true,
    })
    .click();
  const review = panel.getByRole("region", {
    name: "Canada Post group review",
    exact: true,
  });
  await expect(
    review.getByText("Group status: prepared", { exact: false }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(
    review.getByText(`Group: ${groupId}`, { exact: true }),
  ).toBeVisible();
  const creates: string[] = [],
    recoveries: string[] = [];
  let manifestWrites = 0,
    manifestRecoveries = 0;
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (r.url().endsWith("/create")) creates.push(r.url());
    if (r.url().includes("/members/") && r.url().endsWith("/reconcile"))
      recoveries.push(r.url());
    if (r.url().endsWith("/manifest/transmit")) manifestWrites++;
    if (r.url().endsWith("/manifest/reconcile")) manifestRecoveries++;
  });
  for (const b of [first.items[0], last.items[2]]) {
    await review
      .getByRole("button", {
        name: `Create Canada Post member ${b.id}`,
        exact: true,
      })
      .click();
    await expect(review.getByRole("alert")).toBeVisible();
    await expect(
      review.getByRole("button", { name: /^Create Canada Post member / }),
    ).toHaveCount(0);
    await review
      .getByRole("button", {
        name: "Retry current Canada Post group",
        exact: true,
      })
      .click();
    await expect(
      review.getByText("Member status: unknown", { exact: false }),
    ).toBeVisible();
    await review
      .getByRole("button", {
        name: `Recover Canada Post member ${b.id}`,
        exact: true,
      })
      .click();
    await expect(
      review.getByText(`Booking: ${b.id} · Member status: created`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    review.getByText("Group status: closed", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", {
      name: "Transmit reviewed Canada Post manifest",
      exact: true,
    }),
  ).toHaveCount(0);
  await review
    .getByRole("button", { name: "Review Canada Post manifest", exact: true })
    .click();
  await expect(
    review.getByRole("region", {
      name: "Canada Post manifest review",
      exact: true,
    }),
  ).toBeVisible();
  await review
    .getByRole("button", {
      name: "Refresh current Canada Post group",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Group status: closed", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("region", {
      name: "Canada Post manifest review",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("button", {
      name: "Transmit reviewed Canada Post manifest",
      exact: true,
    }),
  ).toHaveCount(0);
  await review
    .getByRole("button", { name: "Review Canada Post manifest", exact: true })
    .click();
  await review
    .getByRole("button", {
      name: "Transmit reviewed Canada Post manifest",
      exact: true,
    })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  await review
    .getByRole("button", {
      name: "Retry current Canada Post group",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Group status: unknown", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", {
      name: "Transmit reviewed Canada Post manifest",
      exact: true,
    }),
  ).toHaveCount(0);
  await review
    .getByRole("button", { name: "Review Canada Post manifest", exact: true })
    .click();
  await review
    .getByRole("button", {
      name: "Recover existing Canada Post manifest",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Group status: transmitted", { exact: false }),
  ).toBeVisible();
  expect(creates).toHaveLength(2);
  expect(new Set(creates).size).toBe(2);
  expect(recoveries).toHaveLength(2);
  expect(manifestWrites).toBe(1);
  expect(manifestRecoveries).toBe(1);
  const manifestDocument = await page.request.get(
    origin + `/api/canada-post/groups/${groupId}/manifest/document`,
  );
  expect(manifestDocument.status()).toBe(200);
  expect(manifestDocument.headers()["cache-control"]).toBe("no-store");
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.route(
    `**/api/canada-post/groups/${groupId}/manifest/document`,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "x-document-sha256": "0".repeat(64) },
      });
    },
  );
  await review
    .getByRole("button", { name: "Download Canada Post manifest", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText(
    "Manifest integrity check failed",
  );
  expect(downloads).toBe(0);
  await page.unroute(`**/api/canada-post/groups/${groupId}/manifest/document`);
  await review
    .getByRole("button", {
      name: "Retry current Canada Post group",
      exact: true,
    })
    .click();
  const downloading = page.waitForEvent("download");
  await review
    .getByRole("button", { name: "Download Canada Post manifest", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("canada-post-manifest.pdf");
  const bytes = await readFile((await download.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifestDocument.headers()["x-document-sha256"],
  );
  await expect(
    review.getByRole("link", { name: /^Download Canada Post label / }),
  ).toHaveCount(2);
  expect(await native(page)).toEqual(before);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await panel
    .getByRole("button", { name: "Close Canada Post groups", exact: true })
    .click();
  const shipmentRow = page
    .getByRole("region", { name: "Shipment history", exact: true })
    .getByRole("row")
    .filter({ hasText: last.items[2].shipmentId.slice(0, 8) });
  await shipmentRow
    .getByRole("button", { name: "Review carrier booking", exact: true })
    .click();
  const carrierReview = page.getByRole("region", {
    name: "Carrier booking review",
    exact: true,
  });
  await expect(
    carrierReview.getByText(`Current group: ${groupId}`, { exact: false }),
  ).toBeVisible();
  await expect(
    carrierReview.getByRole("button", {
      name: "Cancel reviewed pending booking",
      exact: true,
    }),
  ).toHaveCount(0);
  await carrierReview
    .getByRole("button", {
      name: "Open Canada Post warehouse groups",
      exact: true,
    })
    .click();
  await expect(carrierReview).toHaveCount(0);
  await expect(
    panel.getByLabel("Canada Post warehouse", { exact: true }),
  ).toHaveValue(warehouse);
  expect(errors).toEqual([]);
});

test("browser: Canada Post failed selection can be reviewed again and wholly unsent cancellation stays available with provider controls disabled", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const before = await native(page);
  const panel = await open(page);
  await expect(panel.getByRole("checkbox").first()).toBeEnabled();
  const bookingName = await panel
    .getByRole("checkbox")
    .first()
    .getAttribute("aria-label");
  await panel.getByRole("checkbox").first().check();
  await page.route("**/api/commands/canada-post.group.prepare", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Synthetic review changed",
        code: "REVIEW_CHANGED",
      }),
    }),
  );
  await panel
    .getByRole("button", {
      name: "Prepare selected Canada Post group",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic review changed",
  );
  await expect(panel.getByRole("checkbox").first()).toBeDisabled();
  await page.unroute("**/api/commands/canada-post.group.prepare");
  await panel
    .getByRole("button", {
      name: "Review warehouse before changing selection",
      exact: true,
    })
    .click();
  const booking = panel.getByRole("checkbox", {
    name: bookingName!,
    exact: true,
  });
  await expect(booking).not.toBeChecked();
  await booking.check();
  await panel
    .getByRole("button", {
      name: "Prepare selected Canada Post group",
      exact: true,
    })
    .click();
  const review = panel.getByRole("region", {
    name: "Canada Post group review",
    exact: true,
  });
  await expect(
    review.getByText("Group status: prepared", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByText("Destination: Synthetic receiver", { exact: false }),
  ).toBeVisible();
  const groupId = (await review.getByText(/^Group: /).innerText()).slice(7);
  await page.route(`**/api/canada-post/groups/${groupId}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Synthetic current group unavailable",
        code: "TEST_READ",
      }),
    }),
  );
  await review
    .getByRole("button", {
      name: "Refresh current Canada Post group",
      exact: true,
    })
    .click();
  await expect(review.getByRole("alert")).toContainText(
    "Synthetic current group unavailable",
  );
  await expect(
    review.getByRole("button", {
      name: "Cancel wholly unsent Canada Post group",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("button", { name: /^Create Canada Post member / }),
  ).toHaveCount(0);
  await page.unroute(`**/api/canada-post/groups/${groupId}`);
  await page.route("**/api/warehouses/*/canada-post/groups", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), enabled: false },
    });
  });
  await review
    .getByRole("button", {
      name: "Retry current Canada Post group",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Provider operations are disabled for this warehouse.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: /^Create Canada Post member / }),
  ).toHaveCount(0);
  await review
    .getByLabel("Canada Post group cancellation reason", { exact: true })
    .fill("Synthetic operator cancels wholly unsent group");
  let cancellations = 0;
  await page.route(
    "**/api/commands/canada-post.group.cancel",
    async (route) => {
      cancellations++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await review
    .getByRole("button", {
      name: "Cancel wholly unsent Canada Post group",
      exact: true,
    })
    .click();
  await expect(review.getByRole("alert")).toContainText("Failed to fetch");
  await review
    .getByRole("button", {
      name: "Retry current Canada Post group",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Group status: canceled", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", {
      name: "Cancel wholly unsent Canada Post group",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(cancellations).toBe(1);
  await panel
    .getByRole("button", {
      name: "Refresh pending Canada Post bookings",
      exact: true,
    })
    .click();
  await expect(booking).toBeVisible();
  expect(await native(page)).toEqual(before);
  await navigateWorkspace(page, "Inventory", "Stock");
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
