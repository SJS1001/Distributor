import {
  navigateWorkspace,
  navigateAccounting,
  openVisibleRowActions,
} from "./workspace-navigation.ts";
import {
  expectBuyerLanding,
  navigateBuyerWorkspace,
} from "./commerce-browser-navigation.ts";
import { test, expect, type Page, type Request } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const origin = "http://127.0.0.1:3166";
async function login(page: Page) {
  await page.goto(origin + "/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await nav(page, "Billing");
  await openVisibleRowActions(page);
  await expect(
    page.getByRole("button", {
      name: "Review and publish invoice",
      exact: true,
    }),
  ).toBeVisible();
}
async function nav(page: Page, name: string, section?: string) {
  await navigateWorkspace(
    page,
    name,
    section ??
      (
        {
          Billing: "Invoices",
          Inventory: "Stock",
          Orders: "Orders",
          Purchasing: "Purchase orders",
        } as Record<string, string>
      )[name],
  );
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
// Buyers use the customer navigation; Billing is labelled Invoices & payments.
async function buyerNav(page: Page, name: "Billing" | "Orders") {
  await navigateBuyerWorkspace(
    page,
    name,
    name === "Billing" ? "Invoices" : "Orders",
  );
}

test.describe("application async abandonment", () => {
  test.use({ baseURL: origin });
  for (const scenario of [
    "navigation",
    "sign-out",
    "late error",
    "direct download",
  ] as const) {
    test(`browser: PDF ${scenario} discards abandoned downloads and review without changing invoice facts`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let downloads = 0;
      page.on("download", () => downloads++);
      await login(page);
      const before = await (await page.request.get("/api/dashboard")).json();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => (release = resolve));
      let held = false,
        settled = false;
      const done = new Promise<void>((resolve) => {
        const observe = (r: Request) => {
          if (
            r.url().includes("/api/billing/documents/") &&
            r.url().endsWith("/pdf")
          )
            resolve();
        };
        page.on("requestfinished", observe);
        page.on("requestfailed", observe);
      });
      await page.route(
        "**/api/billing/documents/invoice/*/pdf",
        async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          held = true;
          await pending;
          try {
            if (scenario === "late error")
              await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                  code: "SYNTHETIC",
                  message: "Synthetic delayed PDF failure",
                }),
              });
            else await route.fulfill({ response });
          } catch {
            /* An abandoned fetch may already be closed. */
          } finally {
            settled = true;
          }
        },
      );
      await openVisibleRowActions(page);
      await page
        .getByRole("button", {
          name:
            scenario === "direct download"
              ? "Download invoice PDF"
              : "Review and publish invoice",
          exact: true,
        })
        .first()
        .click();
      await expect.poll(() => held).toBe(true);
      if (scenario === "sign-out") {
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Sign in", exact: true }),
        ).toBeVisible();
      } else await nav(page, "Inventory");
      release();
      await done;
      await expect.poll(() => settled).toBe(true);
      // This fence observes response continuations rather than stopping at transport.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
      await expect(
        page.getByText(
          "PDF download prepared. Receipt does not confirm delivery.",
          { exact: true },
        ),
      ).toHaveCount(0);
      expect(downloads).toBe(0);
      if (scenario === "sign-out") await login(page);
      const after = await (await page.request.get("/api/dashboard")).json();
      expect(after.invoices).toEqual(before.invoices);
      expect(after.stock).toEqual(before.stock);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("PDF retained preparation", () => {
  test.use({ baseURL: origin });
  for (const buyer of [false, true]) {
    test(`browser: PDF ${buyer ? "buyer" : "staff"} navigation preserves exact preparation identity for retry`, async ({
      page,
    }) => {
      if (buyer) {
        await page.goto(origin + "/#sign-in");
        await page
          .getByLabel("Email", { exact: true })
          .fill("pdf-buyer@example.test");
        await page
          .getByLabel("Password", { exact: true })
          .fill("long-pdf-buyer-password");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expectBuyerLanding(page);
        await buyerNav(page, "Billing");
      } else await login(page);
      const path = buyer
        ? "**/api/billing/inbox/*/pdf"
        : "**/api/billing/documents/invoice/*/pdf";
      const label = buyer
        ? "Download and review receipt"
        : "Review and publish invoice";
      const before = await (
        await page.request.get(
          buyer ? "/api/billing/inbox/page" : "/api/billing/downloads",
        )
      ).json();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => (release = resolve));
      const keys: string[] = [],
        receipts: string[] = [];
      let held = false,
        settled = false,
        downloads = 0;
      page.on("download", () => downloads++);
      await page.route(path, async (route) => {
        keys.push(route.request().headers()["idempotency-key"]!);
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        receipts.push(response.headers()["x-download-receipt"]!);
        if (keys.length === 1) {
          held = true;
          await pending;
        }
        try {
          await route.fulfill({ response });
        } catch {
          /* Canceled transport. */
        } finally {
          settled = true;
        }
      });
      await openVisibleRowActions(page);
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect.poll(() => held).toBe(true);
      const retained = await page.evaluate(() =>
        Object.keys(sessionStorage)
          .filter(
            (k) =>
              k.startsWith("distributor-document:") ||
              k.startsWith("distributor-inbox:"),
          )
          .map((k) => [k, sessionStorage.getItem(k)]),
      );
      expect(retained).toHaveLength(1);
      expect(retained[0]![1]).toBe(keys[0]);
      if (buyer) await buyerNav(page, "Orders");
      else await nav(page, "Inventory");
      release();
      await expect.poll(() => settled).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(downloads).toBe(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      // Reload restores the last workspace location.
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: buyer ? "Orders" : "Inventory",
          exact: true,
        }),
      ).toBeVisible();
      if (buyer) await buyerNav(page, "Billing");
      else await nav(page, "Billing");
      const downloaded = page.waitForEvent("download");
      await openVisibleRowActions(page);
      await page.getByRole("button", { name: label, exact: true }).click();
      await downloaded;
      await expect(
        page.getByRole("dialog", {
          name: buyer ? "Confirm document receipt" : "Publish reviewed PDF",
          exact: true,
        }),
      ).toBeVisible();
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(receipts[1]).toBe(receipts[0]);
      expect(downloads).toBe(1);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          retained[0]![0]!,
        ),
      ).toBeNull();
      if (buyer) {
        const after = await (
          await page.request.get("/api/billing/inbox/page")
        ).json();
        const original = before.items[0],
          current = after.items[0];
        expect(current.acknowledgments).toEqual(original.acknowledgments);
        expect(current.acknowledgmentCount).toBe(0);
        expect(current.content_hash).toBe(original.content_hash);
        expect(current.downloadCount).toBe(original.downloadCount + 1);
        expect(
          current.downloads.filter((r: any) => r.id === receipts[0]),
        ).toHaveLength(1);
      } else {
        const after = await (
          await page.request.get("/api/billing/downloads")
        ).json();
        expect(after.filter((r: any) => r.id === receipts[0])).toHaveLength(1);
        expect(after.length).toBe(before.length + 1);
      }
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    });
  }
  for (const failed of [false, true]) {
    test(`browser: PDF ${failed ? "failed" : "successful"} late dashboard refresh cannot reopen abandoned review`, async ({
      page,
    }) => {
      await login(page);
      let released!: () => void;
      const pending = new Promise<void>((resolve) => (released = resolve));
      let armed = false,
        held = false,
        settled = false;
      await page.route(
        "**/api/billing/documents/invoice/*/pdf",
        async (route) => {
          armed = true;
          await route.continue();
        },
      );
      await page.route("**/api/dashboard", async (route) => {
        if (!armed) return route.continue();
        const response = await route.fetch();
        held = true;
        await pending;
        try {
          if (failed)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                message: "Synthetic late dashboard failure",
              }),
            });
          else await route.fulfill({ response });
        } catch {
          /* Canceled refresh. */
        } finally {
          settled = true;
        }
      });
      const downloaded = page.waitForEvent("download");
      await openVisibleRowActions(page);
      await page
        .getByRole("button", {
          name: "Review and publish invoice",
          exact: true,
        })
        .click();
      await downloaded;
      await expect.poll(() => held).toBe(true);
      await nav(page, "Inventory");
      released();
      await expect.poll(() => settled).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
    });
  }
});

test.describe("file delivery abandonment", () => {
  test.use({ baseURL: origin });
  for (const kind of ["evidence", "cost"] as const) {
    test(`browser: ${kind} download cannot deliver after leaving its review`, async ({
      page,
    }) => {
      await login(page);
      const before = await (await page.request.get("/api/dashboard")).json();
      const reviewFile = async () => {
        if (kind === "evidence") {
          await nav(page, "Returns");
          await openVisibleRowActions(page);
          await page
            .getByRole("button", { name: "Evidence files", exact: true })
            .click();
          await expect(
            page.getByRole("button", {
              name: "Download evidence",
              exact: true,
            }),
          ).toBeVisible();
        } else {
          await navigateAccounting(page, "Inventory costs");
          const panel = page.getByRole("region", {
            name: "Stock cost accounting handoffs",
            exact: true,
          });
          await panel
            .getByRole("button", {
              name: "Load stock cost review",
              exact: true,
            })
            .click();
          await panel
            .getByRole("button", {
              name: "Review PDF-BOUNDARY-COST",
              exact: true,
            })
            .click();
          await expect(
            panel.getByRole("button", {
              name: "Download reviewed cost file",
              exact: true,
            }),
          ).toBeVisible();
        }
      };
      await reviewFile();
      const path =
        kind === "evidence"
          ? "**/api/warranty/claims/*/evidence/*/download"
          : "**/api/accounting/costs/*/file";
      let release!: () => void;
      const pending = new Promise<void>((resolve) => (release = resolve));
      let held = false,
        settled = false,
        downloads = 0;
      page.on("download", () => downloads++);
      const attempts: {
        key: string | undefined;
        receipt: string | undefined;
      }[] = [];
      let expectedHash = "";
      await page.route(path, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expectedHash = response.headers()["x-document-sha256"]!;
        attempts.push({
          key: route.request().headers()["idempotency-key"],
          receipt: response.headers()["x-download-receipt"],
        });
        if (settled) {
          await route.fulfill({ response });
          return;
        }
        held = true;
        await pending;
        try {
          await route.fulfill({ response });
        } catch {
          /* Abandoned transport. */
        } finally {
          settled = true;
        }
      });
      await page
        .getByRole("button", {
          name:
            kind === "evidence"
              ? "Download evidence"
              : "Download reviewed cost file",
          exact: true,
        })
        .click();
      await expect.poll(() => held).toBe(true);
      await nav(page, "Inventory");
      release();
      await expect.poll(() => settled).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(downloads).toBe(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      const after = await (await page.request.get("/api/dashboard")).json();
      expect(after.stock).toEqual(before.stock);
      expect(after.invoices).toEqual(before.invoices);
      expect(after.claims).toEqual(before.claims);
      await nav(page, kind === "evidence" ? "Returns" : "Billing");
      await reviewFile();
      const delivered = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name:
            kind === "evidence"
              ? "Download evidence"
              : "Download reviewed cost file",
          exact: true,
        })
        .click();
      const download = await delivered;
      expect(
        createHash("sha256")
          .update(await readFile((await download.path())!))
          .digest("hex"),
      ).toBe(expectedHash);
      expect(downloads).toBe(1);
      expect(attempts).toHaveLength(2);
      if (kind === "evidence") {
        expect(attempts[0]!.key).toBeTruthy();
        expect(attempts[1]).toEqual(attempts[0]);
        expect(
          await page.evaluate(() =>
            Object.keys(sessionStorage).filter((key) =>
              key.startsWith("distributor-evidence-download:"),
            ),
          ),
        ).toEqual([]);
      }
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }
});

test.describe("late fulfillment reads", () => {
  test.use({ baseURL: origin });
  for (const action of [
    "Pick / pack",
    "Report short pick",
    "Pack shipment",
    "View short picks",
    "View delivery history",
  ] as const) {
    for (const failure of [false, true]) {
      test(`browser: late ${action} ${failure ? "failure" : "success"} cannot open review after navigation`, async ({
        page,
      }) => {
        await login(page);
        await nav(
          page,
          "Orders",
          action === "View delivery history" ? "Shipments" : "Orders",
        );
        await openVisibleRowActions(page);
        await expect(
          page.getByRole("button", { name: action, exact: true }).first(),
        ).toBeVisible();
        const before = await (await page.request.get("/api/dashboard")).json();
        let release!: () => void;
        const pending = new Promise<void>((resolve) => (release = resolve));
        let held = false,
          settled = false;
        const path =
          action === "View short picks"
            ? "**/api/orders/*/short-picks"
            : action === "View delivery history"
              ? "**/api/shipments/*/delivery/history"
              : "**/api/orders/*/picks";
        await page.route(path, async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          held = true;
          await pending;
          try {
            if (failure)
              await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                  code: "SYNTHETIC",
                  message: "Synthetic delayed fulfillment failure",
                }),
              });
            else await route.fulfill({ response });
          } catch {
            /* Canceled read. */
          } finally {
            settled = true;
          }
        });
        await openVisibleRowActions(page);
        await page
          .getByRole("button", { name: action, exact: true })
          .first()
          .click();
        await expect.poll(() => held).toBe(true);
        await nav(page, "Inventory");
        release();
        await expect.poll(() => settled).toBe(true);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        const after = await (await page.request.get("/api/dashboard")).json();
        expect(after.stock).toEqual(before.stock);
        expect(after.orders).toEqual(before.orders);
        expect(after.invoices).toEqual(before.invoices);
      });
    }
  }
});

test.describe("active fulfillment read retry", () => {
  test.use({ baseURL: origin });
  for (const action of ["Pick / pack", "View delivery history"] as const) {
    test(`browser: ${action} active failure can retry and open its current review`, async ({
      page,
    }) => {
      await login(page);
      await nav(
        page,
        "Orders",
        action === "View delivery history" ? "Shipments" : "Orders",
      );
      const path =
        action === "Pick / pack"
          ? "**/api/orders/*/picks"
          : "**/api/shipments/*/delivery/history";
      await page.route(path, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "SYNTHETIC",
            message: "Synthetic active review failure",
          }),
        }),
      );
      await openVisibleRowActions(page);
      await page
        .getByRole("button", { name: action, exact: true })
        .first()
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Synthetic active review failure",
      );
      await openVisibleRowActions(page);
      await expect(
        page.getByRole("button", { name: action, exact: true }).first(),
      ).toBeEnabled();
      await page.unroute(path);
      await openVisibleRowActions(page);
      await page
        .getByRole("button", { name: action, exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("dialog", {
          name:
            action === "Pick / pack"
              ? "Confirm picked stock"
              : "Shipment delivery history",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page
        .getByRole("button", {
          name: action === "Pick / pack" ? "Cancel" : "Close",
          exact: true,
        })
        .click();
    });
  }
});

test.describe("read-only fulfillment history closure", () => {
  test.use({ baseURL: origin });
  for (const action of ["View delivery history", "View short picks"] as const) {
    test(`browser: closing ${action} restores focus without saving or refreshing`, async ({
      page,
    }) => {
      await login(page);
      await nav(
        page,
        "Orders",
        action === "View delivery history" ? "Shipments" : "Orders",
      );
      const before = await (await page.request.get("/api/dashboard")).json();
      await openVisibleRowActions(page);
      const opener = page
        .getByRole("button", { name: action, exact: true })
        .first();
      await opener.click();
      const dialog = page.getByRole("dialog", {
        name:
          action === "View delivery history"
            ? "Shipment delivery history"
            : "Short-pick reports",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      let refreshes = 0,
        commands = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/api/dashboard")) refreshes++;
        if (request.url().includes("/api/commands/")) commands++;
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
      expect(refreshes).toBe(0);
      expect(commands).toBe(0);
      const after = await (await page.request.get("/api/dashboard")).json();
      expect(after.stock).toEqual(before.stock);
      expect(after.orders).toEqual(before.orders);
      expect(after.invoices).toEqual(before.invoices);
    });
  }
});

test.describe("purchase creation refresh abandonment", () => {
  test.use({ baseURL: origin });
  for (const failure of [false, true]) {
    test(`browser: purchase creation delayed ${failure ? "error" : "success"} refresh cannot overwrite another page`, async ({
      page,
    }) => {
      await login(page);
      const before = await (await page.request.get("/api/dashboard")).json();
      const purchases = await (await page.request.get("/api/purchases")).json();
      await nav(page, "Purchasing");
      await page
        .getByRole("button", { name: "Create purchase order", exact: true })
        .click();
      await page
        .getByLabel("Supplier", { exact: true })
        .selectOption({ label: "Synthetic supplier" });
      await page
        .getByLabel("Warehouse", { exact: true })
        .selectOption({ label: "Toronto" });
      await page.getByRole("button", { name: "Add EQ-1", exact: true }).click();
      await page.getByLabel("Units for EQ-1", { exact: true }).fill("1");
      await page
        .getByLabel("Unit cost in cents for EQ-1", { exact: true })
        .fill("6000");
      await page
        .getByRole("button", { name: "Review purchase order", exact: true })
        .click();
      let held = false,
        settled = false,
        commands = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => (release = resolve));
      const finished = new Promise<void>((resolve) => {
        const observe = (request: Request) => {
          if (request.url().endsWith("/api/dashboard")) resolve();
        };
        page.on("requestfinished", observe);
        page.on("requestfailed", observe);
      });
      await page.route("**/api/commands/purchase.create", async (route) => {
        commands++;
        await route.continue();
      });
      await page.route("**/api/dashboard", async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        held = true;
        await pending;
        try {
          if (failure)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                message: "Synthetic purchase refresh failure",
              }),
            });
          else await route.fulfill({ response });
        } catch {
          /* Abandoned transport may already be closed. */
        } finally {
          settled = true;
        }
      });
      await page
        .getByRole("button", {
          name: "Create reviewed purchase order",
          exact: true,
        })
        .click();
      await expect.poll(() => held).toBe(true);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await nav(page, "Inventory");
      release();
      await finished;
      await expect.poll(() => settled).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText(/Purchase order .* created/)).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const after = await (await page.request.get("/api/dashboard")).json();
      const final = await (await page.request.get("/api/purchases")).json();
      expect(final.orders).toHaveLength(purchases.orders.length + 1);
      const created = final.orders.filter(
        (order: any) =>
          !purchases.orders.some((old: any) => old.id === order.id),
      );
      expect(created).toHaveLength(1);
      expect(
        created[0].lines.map((line: any) => [line.quantity, line.unit_cost]),
      ).toEqual([[1, 6000]]);
      expect(after.stock).toEqual(before.stock);
      expect(after.invoices).toEqual(before.invoices);
      expect(commands).toBe(1);
    });
  }
});
