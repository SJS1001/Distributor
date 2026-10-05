import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createDemoGateway } from "../src/demo/gateway.ts";
import { workspacePages, navigationHash } from "../src/web/navigation.ts";

test("native demo: onboarding, all native pages, incoming data, buyer scope, and reset", async ({
  page,
  browser,
}) => {
  const origin = "http://127.0.0.1:3195";
  const http = await createDemoGateway({ origin, staticRoot: resolve("dist") });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await http.listen({ host: "127.0.0.1", port: 3195 });
    await page.goto(origin + "/demo");
    await page
      .getByLabel("Fictional company name")
      .fill("Browser audit · fictional");
    await page.getByLabel("Payment scenario").selectOption("expired");
    await page
      .getByRole("button", { name: "Create my demo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Browser audit · fictional · CA · payment scenario: expired",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enter application as selected role" })
      .click();
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    await expect(
      page.getByRole("complementary", { name: "Demo workspace" }),
    ).toBeVisible();
    for (const destination of workspacePages) {
      await page.goto(origin + "/" + navigationHash({ page: destination }));
      await expect(page.locator("#workspace-title")).toHaveText(destination);
      await expect(page.locator("main")).not.toContainText("Unable to load");
    }
    await page.goto(
      origin +
        "/" +
        navigationHash({ page: "Purchasing", section: "purchasing-incoming" }),
    );
    await expect(
      page.getByRole("heading", { name: "Incoming allocations", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("Maple Workshop");
    // A second browser cannot inherit the first visitor's workspace or login.
    const other = await browser.newContext();
    try {
      const stranger = await other.newPage();
      await stranger.goto(origin);
      await expect(stranger).toHaveURL(origin + "/demo");
      await expect(
        stranger.getByRole("button", { name: "Create my demo", exact: true }),
      ).toBeVisible();
    } finally {
      await other.close();
    }
    await page.getByRole("link", { name: "Switch role or reset demo" }).click();
    await page.getByLabel("Explore as").selectOption("buyer");
    await page
      .getByRole("button", { name: "Enter application as selected role" })
      .click();
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    await page.goto(origin + "/" + navigationHash({ page: "Administration" }));
    await expect(page.locator("#workspace-title")).toHaveText("Overview");
    await page.getByRole("link", { name: "Switch role or reset demo" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Erase this demo and start again" })
      .click();
    await expect(
      page.getByRole("button", { name: "Create my demo", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await http.close();
  }
});
