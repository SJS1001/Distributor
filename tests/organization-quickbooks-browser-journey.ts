import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, origin: string) {
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
async function billing(page: Page) {
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Organization QuickBooks connection",
    exact: true,
  });
  await expect(panel).toContainText("Sandbox company 1234");
  return panel;
}
async function provider(page: Page, origin: string) {
  await page.route(
    "https://appcenter.intuit.com/connect/oauth2?**",
    async (route) => {
      const auth = new URL(route.request().url()),
        returned = new URL(auth.searchParams.get("redirect_uri")!);
      expect(returned.href).toBe(`${origin}/quickbooks/organization/callback`);
      returned.search = new URLSearchParams({
        state: auth.searchParams.get("state")!,
        code: "synthetic-organization-code",
        realmId: "1234",
      }).toString();
      const denied = new URL(returned);
      denied.searchParams.delete("code");
      denied.searchParams.delete("realmId");
      denied.searchParams.set("error", "access_denied");
      await route.fulfill({
        contentType: "text/html",
        body: `<a href="${returned.href.replaceAll("&", "&amp;")}">Return organization company</a><a href="${denied.href.replaceAll("&", "&amp;")}">Deny organization connection</a>`,
      });
    },
  );
}
async function begin(page: Page) {
  const panel = await billing(page);
  await panel
    .getByRole("button", {
      name: "Review organization QuickBooks connection",
      exact: true,
    })
    .click();
  const review = panel.getByRole("region", {
    name: "Review organization connection",
    exact: true,
  });
  await expect(review).toContainText("Permission revision 2");
  await expect(review).toContainText("Processing countries: US, CA");
  await expect(review).toContainText("Synthetic organization representative");
  const confirm = review.getByRole("button", {
    name: "Connect organization QuickBooks sandbox",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await review
    .getByLabel(
      "I reviewed this organization, company and processing permission",
      { exact: true },
    )
    .check();
  await confirm.click();
  await expect(
    page.getByRole("link", {
      name: "Return organization company",
      exact: true,
    }),
  ).toBeVisible();
}
for (const [region, port] of [
  ["CA", 3220],
  ["US", 3221],
] as const) {
  test(`browser: organization QuickBooks ${region} fixed permission, Strict callback, lost completion and reviewed local disconnect`, async ({
    page,
  }) => {
    const origin = `http://127.0.0.1:${port}`,
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await provider(page, origin);
    await login(page, origin);
    await begin(page);
    const incoming = page.waitForResponse((r) =>
      r.url().startsWith(`${origin}/quickbooks/organization/callback?`),
    );
    await page
      .getByRole("link", { name: "Return organization company", exact: true })
      .click();
    const landing = await incoming;
    expect((await landing.request().allHeaders()).cookie).toBeUndefined();
    expect(landing.headers()["cache-control"]).toBe("no-store");
    expect(landing.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page).toHaveURL(`${origin}/quickbooks/organization/callback`);
    await expect(
      page.getByRole("heading", {
        name: "Organization QuickBooks connection result",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText(`Region ${region}`);
    await expect(page.locator("body")).not.toContainText(
      "synthetic-organization-code",
    );
    const finish = page.getByRole("button", {
      name: "Finish organization QuickBooks connection",
      exact: true,
    });
    await expect(finish).toBeDisabled();
    await page
      .getByLabel("I confirm the reviewed organization and sandbox company", {
        exact: true,
      })
      .check();
    let exchanges = 0;
    await page.route(
      "**/api/quickbooks/organization/authorization/complete",
      async (route) => {
        exchanges++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      },
    );
    await finish.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(finish).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Check organization connection result",
        exact: true,
      })
      .click();
    await expect(page.locator("body")).toContainText(
      "Connection attempt: completed",
    );
    await expect(page.locator("body")).toContainText("Credentials: ready");
    await page.reload();
    await expect(page.locator("body")).toContainText(
      "Connection attempt: completed",
    );
    expect(exchanges).toBe(1);
    await page
      .getByRole("link", { name: "Return to Distributor", exact: true })
      .click();
    const panel = await billing(page);
    // Organization installation never creates a buyer connection.
    const buyer = await (
      await page.request.get(`${origin}/api/quickbooks/authorization`)
    ).json();
    expect(buyer).toEqual({ enabled: false });
    await panel
      .getByRole("button", {
        name: "Review local organization disconnect",
        exact: true,
      })
      .click();
    const review = panel.getByRole("region", {
      name: "Review organization disconnect",
      exact: true,
    });
    await expect(review).toContainText("revision 1");
    await expect(review).toContainText("This does not revoke access at Intuit");
    await panel
      .getByRole("button", {
        name: "Check organization connection status",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "Check organization connection status",
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByRole("button", {
        name: "Review local organization disconnect",
        exact: true,
      })
      .click();
    let disconnects = 0;
    await page.route(
      "**/api/quickbooks/organization/authorization/disconnect",
      async (route) => {
        disconnects++;
        expect(route.request().postDataJSON()).toEqual({ revision: 1 });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      },
    );
    await review
      .getByRole("button", {
        name: "Confirm local organization disconnect",
        exact: true,
      })
      .click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(review).toHaveCount(0);
    await panel
      .getByRole("button", {
        name: "Check organization connection status",
        exact: true,
      })
      .click();
    await expect(panel).toContainText("Credentials: disabled");
    await expect(panel).toContainText("Revision 2");
    expect(disconnects).toBe(1);
    const storage = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(storage).not.toContain("synthetic-organization-code");
    expect(storage).not.toContain("synthetic-browser-access");
    expect(storage).not.toContain("synthetic-browser-refresh");
    const dimensions = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1]! + 1);
    expect(errors).toEqual([]);
  });
}

async function withdraw(page: Page, origin: string) {
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const current = await (
    await page.request.get(`${origin}/api/organization/ledger-residency`)
  ).json();
  const reply = await page.request.post(
    `${origin}/api/commands/organization.ledger-residency.choose`,
    {
      headers: {
        origin,
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        region: current.choice.region,
        revision: current.choice.revision,
        mode: "strict",
        realm: null,
        acknowledgment: "Synthetic withdrawal during organization connection",
      },
    },
  );
  expect(reply.ok(), await reply.text()).toBeTruthy();
}

test("browser: organization QuickBooks strict regional permission blocks connection", async ({
  page,
}) => {
  await login(page, "http://127.0.0.1:3222");
  const panel = await billing(page);
  await expect(panel).toContainText(
    "Current organization processing permission is unavailable",
  );
  await expect(
    panel.getByRole("button", {
      name: "Review organization QuickBooks connection",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("region", {
      name: "Review organization connection",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("browser: organization QuickBooks withdrawn permission prevents callback completion", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3223";
  await provider(page, origin);
  await login(page, origin);
  await begin(page);
  await withdraw(page, origin);
  let completions = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/authorization/complete")) completions++;
  });
  await page
    .getByRole("link", { name: "Return organization company", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/quickbooks/organization/callback`);
  await expect(page.locator("body")).toContainText("Permission revision 2");
  await expect(page.locator("body")).toContainText(
    "The original attempt or its processing permission is unavailable",
  );
  await expect(
    page.getByRole("button", {
      name: "Finish organization QuickBooks connection",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Credentials: missing");
  expect(completions).toBe(0);
});

test("browser: organization QuickBooks original callback cannot be completed by a replacement login", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3224";
  await provider(page, origin);
  await login(page, origin);
  await begin(page);
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const logout = await page.request.post(`${origin}/api/logout`, {
    headers: { origin, "x-csrf-token": session.csrf },
  });
  expect(logout.ok()).toBeTruthy();
  const relogin = await page.request.post(`${origin}/api/login`, {
    headers: { origin },
    data: { email: "admin@example.test", password: "long-test-only-password" },
  });
  expect(relogin.ok()).toBeTruthy();
  await page
    .getByRole("link", { name: "Return organization company", exact: true })
    .click();
  await expect(page.locator("body")).toContainText("No attempt for this login");
  await expect(
    page.getByRole("button", {
      name: "Finish organization QuickBooks connection",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Credentials: missing");
});

test("browser: organization QuickBooks lost begin response requires status and explicit cancellation", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3225";
  await login(page, origin);
  const panel = await billing(page);
  let starts = 0;
  await page.route(
    "**/api/quickbooks/organization/authorization/begin",
    async (route) => {
      starts++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await panel
    .getByRole("button", {
      name: "Review organization QuickBooks connection",
      exact: true,
    })
    .click();
  await panel
    .getByLabel(
      "I reviewed this organization, company and processing permission",
      { exact: true },
    )
    .check();
  await panel
    .getByRole("button", {
      name: "Connect organization QuickBooks sandbox",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Review organization QuickBooks connection",
      exact: true,
    }),
  ).toBeDisabled();
  await panel
    .getByRole("button", {
      name: "Check organization connection status",
      exact: true,
    })
    .click();
  await expect(panel).toContainText("Connection attempt: pending");
  await panel
    .getByRole("button", {
      name: "Cancel organization connection attempt",
      exact: true,
    })
    .click();
  await expect(panel).toContainText("Connection attempt: canceled");
  await expect(panel).toContainText("Credentials: missing");
  expect(starts).toBe(1);
});

test("browser: organization QuickBooks explicit provider denial consumes callback once", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3226";
  await provider(page, origin);
  await login(page, origin);
  await begin(page);
  await page
    .getByRole("link", { name: "Deny organization connection", exact: true })
    .click();
  await page
    .getByLabel("I confirm the reviewed organization and sandbox company", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Finish organization QuickBooks connection",
      exact: true,
    })
    .click();
  await expect(page.locator("body")).toContainText(
    "Connection attempt: denied",
  );
  await expect(page.locator("body")).toContainText("Credentials: missing");
  await expect(
    page.getByRole("button", {
      name: "Finish organization QuickBooks connection",
      exact: true,
    }),
  ).toHaveCount(0);
});
