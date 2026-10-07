import { test, expect } from "@playwright/test";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";
import {
  navigateWorkspace,
  navigateCustomerWorkspace as buyerNavigate,
} from "./workspace-navigation.ts";

test("compact staff and customer layouts preserve navigation, account history and mobile menu", async ({
  page,
}, testInfo) => {
  const cleanup: (() => void)[] = [];
  const f = fixture({ after: (fn) => cleanup.push(fn) });
  f.app.identity.createUser(f.actor, "layout-buyer", {
    email: "layout-buyer@example.test",
    password: "synthetic-buyer-password",
    name: "Layout buyer",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    requirePasswordChange: false,
  });
  const origin = "http://127.0.0.1:3260";
  const http = await createHttp(f.app, { origin, secureCookies: false });
  http.addHook("onSend", async (_request, reply, payload) => {
    const policy = reply.getHeader("Content-Security-Policy");
    if (typeof policy === "string")
      reply.header(
        "Content-Security-Policy",
        policy.replace(/upgrade-insecure-requests;?/g, ""),
      );
    return payload;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fits = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  const login = async (email: string, password: string) => {
    await page.goto(origin + "/#sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toBeVisible();
  };
  try {
    await http.listen({ host: "127.0.0.1", port: 3260 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login("admin@example.test", "long-test-only-password");
    await navigateWorkspace(page, "Orders");
    await expect(
      page.getByRole("navigation", {
        name: "Sales & customers pages",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".workspace-tabs")).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await expect(
      page.getByText("How fulfillment works", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Open an order's Actions and pick its allocated stock.", {
        exact: true,
      }),
    ).toBeHidden();
    expect(
      (await page
        .getByRole("region", { name: "Order queue", exact: true })
        .boundingBox())!.y,
    ).toBeLessThan(420);
    await page.screenshot({
      path: testInfo.outputPath("admin-orders-desktop.png"),
    });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of [
        "Inventory",
        "Catalog",
        "Customers",
        "Billing",
        "Overview",
      ]) {
        await navigateWorkspace(page, name);
        await expect(page.locator("#workspace-title")).toHaveText(name);
        await fits();
      }
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login("layout-buyer@example.test", "synthetic-buyer-password");
    await buyerNavigate(page, "Account");
    await expect(
      page.getByRole("tab", { name: "Overview & terms", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("heading", { name: "Your sign-in security", exact: true }),
    ).toBeHidden();
    await page.getByRole("tab", { name: "Data location", exact: true }).click();
    await expect(page).toHaveURL(/section=account-data-location/);
    await page
      .getByRole("tab", { name: "Sign-in security", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your sign-in security", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Sign-in security", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(
      page.getByRole("tab", { name: "Data location", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("tab", { name: "Data location", exact: true })
      .press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Sign-in security", exact: true }),
    ).toBeFocused();
    await fits();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const nav = page.getByRole("navigation", {
      name: "Workspace",
      exact: true,
    });
    const shop = await nav
      .getByRole("button", { name: "Shop", exact: true })
      .boundingBox();
    const orders = await nav
      .getByRole("button", { name: "Orders", exact: true })
      .boundingBox();
    expect(shop).not.toBeNull();
    expect(orders).not.toBeNull();
    expect(Math.abs(shop!.y - orders!.y)).toBeLessThan(2);
    await page.screenshot({
      path: testInfo.outputPath("customer-mobile-menu.png"),
    });
    await nav.getByRole("button", { name: "Shop", exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of [
        "Shop",
        "Orders",
        "Invoices & payments",
        "Reports",
        "Account",
        "Returns",
      ]) {
        await buyerNavigate(page, name);
        await fits();
        if (name === "Shop") {
          const first = page.locator(".sf-card").first();
          await expect(first).toBeVisible();
          expect((await first.boundingBox())!.y).toBeLessThan(440);
          await page.screenshot({
            path: testInfo.outputPath(`customer-shop-${width}.png`),
          });
        }
        if (name === "Account" && width === 1440)
          await page.screenshot({
            path: testInfo.outputPath("customer-account-desktop.png"),
          });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  }
});
