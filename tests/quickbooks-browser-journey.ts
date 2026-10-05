import { navigateAccounting } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";

test("browser: QuickBooks authorization keeps Strict login cookies, cancels attempts, handles denial and recovers a lost completion response without retrying code", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3119";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    "https://appcenter.intuit.com/connect/oauth2?**",
    async (route) => {
      const auth = new URL(route.request().url());
      expect(auth.searchParams.get("client_id")).toBe("synthetic-client");
      expect(auth.searchParams.get("scope")).toBe(
        "com.intuit.quickbooks.accounting",
      );
      const returned = new URL(auth.searchParams.get("redirect_uri")!);
      expect(returned.href).toBe(`${origin}/quickbooks/callback`);
      returned.search = new URLSearchParams({
        state: auth.searchParams.get("state")!,
        code: "synthetic-browser-code",
        realmId: "1234",
      }).toString();
      const denied = new URL(returned);
      denied.searchParams.delete("code");
      denied.searchParams.delete("realmId");
      denied.searchParams.set("error", "access_denied");
      await route.fulfill({
        contentType: "text/html",
        body: `<a href="${returned.href.replaceAll("&", "&amp;")}">Return synthetic company</a><a href="${denied.href.replaceAll("&", "&amp;")}">Deny synthetic connection</a>`,
      });
    },
  );
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const billing = async () => {
    await navigateAccounting(page, "QuickBooks connections");
    await expect(
      page.getByRole("region", { name: "QuickBooks connection", exact: true }),
    ).toContainText("Sandbox company 1234");
  };
  await billing();
  await page
    .getByRole("button", { name: "Connect QuickBooks sandbox", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Return synthetic company" }),
  ).toBeVisible();
  await page.goto(origin);
  await billing();
  await page
    .getByRole("button", { name: "Cancel connection attempt", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "QuickBooks connection", exact: true }),
  ).toContainText("Connection attempt: canceled");
  await page
    .getByRole("button", { name: "Connect QuickBooks sandbox", exact: true })
    .click();
  await page.getByRole("link", { name: "Deny synthetic connection" }).click();
  await expect(page).toHaveURL(`${origin}/quickbooks/callback`);
  await page
    .getByRole("button", { name: "Finish QuickBooks connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection attempt: denied", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Distributor" }).click();
  await billing();
  await page
    .getByRole("button", { name: "Connect QuickBooks sandbox", exact: true })
    .click();
  const incoming = page.waitForRequest((r) =>
    r.url().startsWith(`${origin}/quickbooks/callback?`),
  );
  await page.getByRole("link", { name: "Return synthetic company" }).click();
  expect((await (await incoming).allHeaders()).cookie).toBeUndefined();
  await expect(page).toHaveURL(`${origin}/quickbooks/callback`);
  await expect(
    page.getByRole("button", {
      name: "Finish QuickBooks connection",
      exact: true,
    }),
  ).toBeEnabled();
  expect(await page.locator("body").innerText()).not.toContain(
    "synthetic-browser-code",
  );
  const summary = await (
    await page.request.get(`${origin}/api/quickbooks/authorization`)
  ).json();
  expect(summary.credentials.revision).toBe(0);
  expect(summary.attempt.state).toBe("pending");
  let exchanges = 0;
  await page.route(
    "**/api/quickbooks/authorization/complete",
    async (route) => {
      exchanges++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await page
    .getByRole("button", { name: "Finish QuickBooks connection", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Finish QuickBooks connection",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check connection result", exact: true })
    .click();
  await expect(
    page.getByText("Connection attempt: completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sandbox company 1234 · Credentials: ready", {
      exact: true,
    }),
  ).toBeVisible();
  expect(exchanges).toBe(1);
  await page.reload();
  await expect(
    page.getByText("Connection attempt: completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Finish QuickBooks connection",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(exchanges).toBe(1);
  await page.getByRole("link", { name: "Return to Distributor" }).click();
  await billing();
  await expect(
    page.getByRole("region", { name: "QuickBooks connection", exact: true }),
  ).toContainText("Revision 1");
  const connection = page.getByRole("region", {
    name: "QuickBooks connection",
    exact: true,
  });
  await connection
    .getByRole("button", {
      name: "Review local QuickBooks disconnect",
      exact: true,
    })
    .click();
  const review = page.getByRole("region", {
    name: "Review QuickBooks disconnect",
    exact: true,
  });
  await expect(review).toContainText("revision 1");
  await expect(review).toContainText("This does not revoke access at Intuit");
  await review
    .getByRole("button", { name: "Keep QuickBooks connection", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(connection).toContainText("Credentials: ready");
  await connection
    .getByRole("button", {
      name: "Review local QuickBooks disconnect",
      exact: true,
    })
    .click();
  await connection
    .getByRole("button", {
      name: "Check QuickBooks connection status",
      exact: true,
    })
    .click();
  await expect(review).toHaveCount(0);
  await expect(
    connection.getByRole("button", {
      name: "Check QuickBooks connection status",
      exact: true,
    }),
  ).toBeEnabled();
  await connection
    .getByRole("button", {
      name: "Review local QuickBooks disconnect",
      exact: true,
    })
    .click();
  let disconnects = 0;
  await page.route(
    "**/api/quickbooks/authorization/disconnect",
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
      name: "Confirm local QuickBooks disconnect",
      exact: true,
    })
    .click();
  await expect(connection.getByRole("alert")).toBeVisible();
  await expect(review).toHaveCount(0);
  await expect(
    connection.getByRole("button", {
      name: "Review local QuickBooks disconnect",
      exact: true,
    }),
  ).toBeDisabled();
  await connection
    .getByRole("button", {
      name: "Check QuickBooks connection status",
      exact: true,
    })
    .click();
  await expect(connection).toContainText("Credentials: disabled");
  await expect(connection).toContainText("Revision 2");
  await expect(
    connection.getByRole("button", {
      name: "Review local QuickBooks disconnect",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(disconnects).toBe(1);
  await page.reload();
  await billing();
  await expect(connection).toContainText("Credentials: disabled");
  expect(disconnects).toBe(1);
  const dimensions = await page.evaluate(() => ({
    screen: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.screen + 1);
  expect(errors).toEqual([]);
});
