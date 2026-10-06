import { navigateWorkspace, withRowActions } from "./workspace-navigation.ts";
import { test, expect, type Page, type Locator } from "@playwright/test";
const origin = "http://127.0.0.1:3121";
const reason = "Synthetic stopped writer and carrier investigation";
async function login(page: Page, email = "admin@example.test") {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function orders(page: Page) {
  await navigateWorkspace(page, "Orders", "Shipments");
}
async function bookings(page: Page) {
  const dashboard = await (
    await page.request.get(origin + "/api/dashboard")
  ).json();
  const rows = [];
  for (const s of dashboard.shipments) {
    const r = await (
      await page.request.get(origin + `/api/shipments/${s.id}/carrier`)
    ).json();
    if (r.booking) rows.push(r.booking);
  }
  return rows;
}
async function native(page: Page) {
  const d = await (await page.request.get(origin + "/api/dashboard")).json();
  return {
    stock: d.stock,
    orders: d.orders,
    invoices: d.invoices,
    shipments: d.shipments,
  };
}
async function ordinary(page: Page, shipmentId: string) {
  await orders(page);
  await (
    await withRowActions(
      page.getByRole("row").filter({
        has: page.getByRole("cell", {
          name: shipmentId.slice(0, 8),
          exact: true,
        }),
      }),
    )
  )
    .getByRole("button", { name: "Review carrier booking", exact: true })
    .click();
  const pane = page.getByRole("region", {
    name: "Carrier booking review",
    exact: true,
  });
  await expect(
    pane.getByRole("region", {
      name: "Interrupted booking claim",
      exact: true,
    }),
  ).toBeVisible();
  return pane;
}
async function group(page: Page, id: string) {
  await orders(page);
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
  await pane
    .getByRole("button", {
      name: `Review Canada Post group ${id}`,
      exact: true,
    })
    .click();
  return pane.getByRole("region", {
    name: "Canada Post group review",
    exact: true,
  });
}
async function review(claim: Locator, seconds = "120") {
  await claim
    .getByLabel("Minimum claim age (seconds)", { exact: true })
    .fill(seconds);
  await claim
    .getByRole("button", {
      name: "Review exact interrupted claim",
      exact: true,
    })
    .click();
  await expect(claim.getByText("Claim state:", { exact: false })).toBeVisible();
}
async function acknowledge(claim: Locator) {
  await claim
    .getByLabel("Investigation and release reason", { exact: true })
    .fill(reason);
  await claim.getByRole("checkbox").check();
}
async function cmd(page: Page, key: string, payload: unknown) {
  const csrf = (await (await page.request.get(origin + "/api/session")).json())
    .csrf;
  return page.request.post(origin + "/api/commands/carrier.claim.release", {
    headers: { origin, "x-csrf-token": csrf, "idempotency-key": key },
    data: payload,
  });
}

test("browser: phone ordinary claim release retains an exact lost-response retry across reload and changes no native facts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const booking = (await bookings(page))
    .filter((b) => b.provider === "ups")
    .sort((a, b) => a.shipmentId.localeCompare(b.shipmentId))[0]!;
  const before = await native(page);
  let pane = await ordinary(page, booking.shipmentId);
  let claim = pane.getByRole("region", {
    name: "Interrupted booking claim",
    exact: true,
  });
  await expect(claim.getByLabel("Minimum claim age (seconds)")).toHaveValue("");
  await review(claim);
  await acknowledge(claim);
  const attempts: { body: string | null; key: string | undefined }[] = [];
  let first = true;
  await page.route("**/api/commands/carrier.claim.release", async (route) => {
    attempts.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (first) {
      first = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(
    claim.getByRole("button", {
      name: "Retry exact claim release",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    claim.getByLabel("Investigation and release reason"),
  ).toHaveCount(0);
  const stored = (
    await (
      await page.request.get(
        origin + `/api/shipments/${booking.shipmentId}/carrier`,
      )
    ).json()
  ).booking;
  expect(stored.state).toBe("unknown");
  await page.reload();
  // Reload restores the signed-in workspace location instead of Overview.
  await expect(page.locator("#workspace-title")).toHaveText("Orders");
  pane = await ordinary(page, booking.shipmentId);
  claim = pane.getByRole("region", {
    name: "Interrupted booking claim",
    exact: true,
  });
  await expect(claim).toContainText(reason);
  await claim
    .getByRole("button", { name: "Retry exact claim release", exact: true })
    .click();
  await expect(pane.getByRole("status")).toContainText(
    "Claim released to unknown",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await native(page)).toEqual(before);
  await expect(
    pane.getByRole("button", {
      name: "Send reviewed carrier booking",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("distributor-claim-release:"),
        ).length,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});

test("browser: phone member claim review cancels reads on age and warehouse changes, then refuses a competing released claim", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const d = await (await page.request.get(origin + "/api/dashboard")).json();
  const warehouse = d.warehouses.find((w: any) => w.name === "Toronto").id;
  const groups = (
    await (
      await page.request.get(
        origin + `/api/warehouses/${warehouse}/canada-post/groups`,
      )
    ).json()
  ).items;
  const g = groups.find((v: any) => v.state === "creating");
  const target = {
    kind: "member",
    groupId: g.id,
    bookingId: g.entries.find((e: any) => e.state === "creating").bookingId,
  };
  const before = await native(page);
  let pane = await group(page, g.id);
  let claim = pane.getByRole("region", {
    name: "Interrupted member claim",
    exact: true,
  });
  const path = `/api/canada-post/groups/${g.id}/members/${target.bookingId}/claim`;
  let finish!: () => void, seen!: () => void;
  let gate = new Promise<void>((r) => (finish = r)),
    started = new Promise<void>((r) => (seen = r));
  await page.route(`**${path}?*`, async (route) => {
    const response = await route.fetch();
    seen();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await claim.getByLabel("Minimum claim age (seconds)").fill("120");
  const failed = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().includes(path),
  });
  await claim
    .getByRole("button", {
      name: "Review exact interrupted claim",
      exact: true,
    })
    .click();
  await started;
  await claim.getByLabel("Minimum claim age (seconds)").fill("121");
  await failed;
  finish();
  await page.unroute(`**${path}?*`);
  await expect(
    claim.getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    }),
  ).toHaveCount(0);
  await review(claim);
  await acknowledge(claim);
  const current = await (
    await page.request.get(origin + path + "?minimumAgeMs=120000")
  ).json();
  expect(
    (
      await cmd(page, "member-competing-release", {
        target,
        minimumAgeMs: 120000,
        claimHash: current.claimHash,
        reason,
      })
    ).status(),
  ).toBe(200);
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(claim.getByRole("alert")).toContainText("STATE");
  await claim
    .getByRole("button", { name: "Discard saved release attempt", exact: true })
    .click();
  await pane
    .getByRole("button", {
      name: "Refresh current Canada Post group",
      exact: true,
    })
    .click();
  await expect(pane).toContainText("Member status: unknown");
  await expect(pane).toContainText("Member status: pending");
  expect(await native(page)).toEqual(before);
  // A freshly held read is aborted when the warehouse scope is replaced.
  claim = pane.getByRole("region", {
    name: "Interrupted member claim",
    exact: true,
  });
  gate = new Promise<void>((r) => (finish = r));
  started = new Promise<void>((r) => (seen = r));
  await page.route(`**${path}?*`, async (route) => {
    const response = await route.fetch();
    seen();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await claim.getByLabel("Minimum claim age (seconds)").fill("120");
  const failedScope = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().includes(path),
  });
  await claim
    .getByRole("button", {
      name: "Review exact interrupted claim",
      exact: true,
    })
    .click();
  await started;
  await page
    .getByLabel("Canada Post warehouse", { exact: true })
    .selectOption({ label: "Ottawa" });
  await failedScope;
  finish();
  await page.unroute(`**${path}?*`);
  await expect(
    page.getByRole("region", { name: "Interrupted member claim", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("browser: phone manifest claim release keeps all created members and refuses warehouse access to administrator controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const d = await (await page.request.get(origin + "/api/dashboard")).json();
  const warehouse = d.warehouses.find((w: any) => w.name === "Toronto").id;
  const g = (
    await (
      await page.request.get(
        origin + `/api/warehouses/${warehouse}/canada-post/groups`,
      )
    ).json()
  ).items.find((v: any) => v.state === "transmitting");
  const before = await native(page);
  const pane = await group(page, g.id);
  const claim = pane.getByRole("region", {
    name: "Interrupted manifest claim",
    exact: true,
  });
  await review(claim);
  await acknowledge(claim);
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(pane.getByRole("status")).toContainText(
    "Manifest claim released to unknown",
  );
  const after = await (
    await page.request.get(origin + `/api/canada-post/groups/${g.id}`)
  ).json();
  expect(after.state).toBe("unknown");
  expect(after.entries).toEqual(g.entries);
  expect(after.providerGroupId).toBe(g.providerGroupId);
  expect(await native(page)).toEqual(before);
  await expect(
    pane.getByRole("button", {
      name: "Transmit reviewed Canada Post manifest",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // Let sign-out finish before opening sign-in; a still-signed-in workspace
  // otherwise normalizes #sign-in to Overview and signs out onto the public home.
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await login(page, "claim-warehouse@example.test");
  const staff = await group(page, g.id);
  await expect(
    staff.getByRole("region", {
      name: "Interrupted manifest claim",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get(
        origin +
          `/api/canada-post/groups/${g.id}/manifest/claim?minimumAgeMs=120000`,
      )
    ).status(),
  ).toBe(403);
  expect(errors).toEqual([]);
});

test("browser: phone claim release enforces reason and acknowledgment, retains an age refusal and refreshes without a resend", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const booking = (await bookings(page)).find(
    (b) => b.provider === "ups" && b.state === "running",
  );
  const before = await native(page);
  const pane = await ordinary(page, booking.shipmentId);
  let claim = pane.getByRole("region", {
    name: "Interrupted booking claim",
    exact: true,
  });
  const attempts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/commands/carrier.claim.release")
    )
      attempts.push(request.postData()!);
  });
  await review(claim, "86400");
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(
    claim.getByLabel("Investigation and release reason"),
  ).toBeFocused();
  expect(attempts).toEqual([]);
  await claim.getByLabel("Investigation and release reason").fill(reason);
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(claim.getByRole("checkbox")).toBeFocused();
  expect(attempts).toEqual([]);
  await claim.getByRole("checkbox").check();
  await claim.getByLabel("Investigation and release reason").fill("   ");
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(claim.getByRole("alert")).toHaveText(
    "Enter an investigation and release reason.",
  );
  expect(attempts).toEqual([]);
  await claim.getByLabel("Investigation and release reason").fill(reason);
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(claim.getByRole("alert")).toContainText("CLAIM_ACTIVE");
  await expect(
    claim.getByRole("button", {
      name: "Retry exact claim release",
      exact: true,
    }),
  ).toBeEnabled();
  expect(attempts).toHaveLength(1);
  expect(
    (
      await (
        await page.request.get(
          origin + `/api/shipments/${booking.shipmentId}/carrier`,
        )
      ).json()
    ).booking.state,
  ).toBe("running");
  expect(await native(page)).toEqual(before);
  await claim
    .getByRole("button", { name: "Discard saved release attempt", exact: true })
    .click();
  await pane
    .getByRole("button", { name: "Refresh carrier review", exact: true })
    .click();
  claim = pane.getByRole("region", {
    name: "Interrupted booking claim",
    exact: true,
  });
  await expect(claim.getByLabel("Minimum claim age (seconds)")).toHaveValue("");
  await review(claim);
  await expect(claim.getByRole("checkbox")).not.toBeChecked();
  await acknowledge(claim);
  await claim
    .getByRole("button", {
      name: "Release reviewed claim to unknown",
      exact: true,
    })
    .click();
  await expect(pane.getByRole("status")).toContainText(
    "Claim released to unknown",
  );
  expect(attempts).toHaveLength(2);
  expect(JSON.parse(attempts[0]!).minimumAgeMs).toBe(86400000);
  expect(JSON.parse(attempts[1]!).minimumAgeMs).toBe(120000);
  expect(await native(page)).toEqual(before);
  expect(errors).toEqual([]);
});
