import { test, expect, type Locator } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const variants = [
  { port: 3123, country: "US", destination: "US", bulk: false, lost: false },
  { port: 3124, country: "CA", destination: "CA", bulk: false, lost: false },
  { port: 3125, country: "US", destination: "CA", bulk: true, lost: false },
  { port: 3126, country: "CA", destination: "US", bulk: false, lost: false },
  { port: 3127, country: "US", destination: "CA", bulk: false, lost: true },
];
async function address(
  pane: Locator,
  legend: string,
  country: string,
  recipient: boolean,
) {
  const group = pane.getByRole("group", { name: legend, exact: true });
  for (const [field, value] of [
    [
      "Name",
      recipient ? "Reviewed recipient contact" : "Reviewed warehouse contact",
    ],
    ["Address line 1", recipient ? "20 Test Road" : "10 Test Road"],
    ["City", country === "US" ? "Buffalo" : "Toronto"],
    ["Province / state", country === "US" ? "NY" : "ON"],
    ["Postal / ZIP code", country === "US" ? "14201" : "M5V 1A1"],
    ["Phone", "7165550100"],
  ])
    await group.getByLabel(field!, { exact: true }).fill(value!);
  await group
    .getByRole("combobox", { name: "Country", exact: true })
    .selectOption(country);
}
async function declaration(
  pane: Locator,
  cross: boolean,
  lineCount: number,
  invoice = "SYNTHETIC-EXPORT",
) {
  await pane
    .getByLabel("Shipper company", { exact: true })
    .fill("Reviewed warehouse company");
  await pane
    .getByLabel("Receiver company", { exact: true })
    .fill("Reviewed recipient company");
  await pane
    .getByLabel("Planned shipping date and time", { exact: true })
    .fill("2026-10-03T10:30");
  await pane
    .getByLabel("UTC offset at shipping time", { exact: true })
    .fill("-04:00");
  await pane
    .getByLabel("Shipment goods description", { exact: true })
    .fill("Explicit reviewed equipment");
  await pane
    .getByRole("combobox", { name: "Incoterm", exact: true })
    .selectOption("DAP");
  if (!cross) return;
  await pane
    .getByRole("combobox", { name: "Declaration currency", exact: true })
    .selectOption("CAD");
  await pane
    .getByRole("combobox", { name: "Customs invoice type", exact: true })
    .selectOption("commercial");
  await pane
    .getByLabel("Customs invoice number", { exact: true })
    .fill(invoice);
  await pane
    .getByLabel("Customs invoice date", { exact: true })
    .fill("2026-10-01");
  await pane
    .getByRole("combobox", { name: "Export reason", exact: true })
    .selectOption("commercial_purpose_or_sale");
  for (let i = 0; i < lineCount; i++) {
    const group = pane.getByRole("group", {
      name: `Packed goods ${i + 1}`,
      exact: true,
    });
    await group
      .getByLabel("Declared goods description", { exact: true })
      .fill(`Explicit declared goods ${i + 1}`);
    await group
      .getByLabel("Declared value per unit", { exact: true })
      .fill(i === 0 ? "123.45" : "0.01");
    await group
      .getByLabel("Country of manufacture (two-letter code)", { exact: true })
      .fill("CA");
    await group.getByLabel("Commodity code", { exact: true }).fill("001234");
    await group
      .getByLabel("Total line net weight (grams)", { exact: true })
      .fill("250");
  }
  await pane
    .getByLabel("Customs review acknowledgment / evidence", { exact: true })
    .fill(
      "Explicit synthetic review of all packed goods; no provider qualification",
    );
}
async function parcelAndAcknowledgments(pane: Locator) {
  for (const [field, value] of [
    ["Weight (grams)", "1000"],
    ["Length (mm)", "300"],
    ["Width (mm)", "200"],
    ["Height (mm)", "100"],
  ])
    await pane.getByLabel(field!, { exact: true }).fill(value!);
  await pane
    .getByLabel("Address review acknowledgment / evidence", { exact: true })
    .fill("Synthetic actual warehouse/recipient address review");
  await pane
    .getByRole("checkbox", {
      name: "I reviewed the entered structured destination",
      exact: false,
    })
    .check();
  await pane
    .getByRole("checkbox", {
      name: "I reviewed this carrier account",
      exact: false,
    })
    .check();
}
for (const variant of variants)
  test(`browser: DHL phone ${variant.country} to ${variant.destination} ${variant.bulk ? "bulk" : "serial"} ${variant.lost ? "uncertain no-resend" : "declaration and private documents"}`, async ({
    page,
  }) => {
    const origin = `http://127.0.0.1:${variant.port}`;
    const cross = variant.country !== variant.destination;
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const native = async () => {
      const d = await (
        await page.request.get(origin + "/api/dashboard")
      ).json();
      return {
        stock: d.stock,
        orders: d.orders,
        shipments: d.shipments,
        invoices: d.invoices,
      };
    };
    const before = await native();
    const shipment = before.shipments.find(
      (s: any) => s.address === "Synthetic DHL warehouse recipient",
    );
    const path = origin + `/api/shipments/${shipment.id}/carrier`;
    const reviewedGoods = (await (await page.request.get(path)).json())
      .packedGoods;
    expect(
      reviewedGoods.map((g: any) => ({
        allocationId: g.allocationId,
        quantity: g.quantity,
      })),
    ).toEqual(shipment.lines);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Orders", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: shipment.id.slice(0, 8),
          exact: true,
        }),
      })
      .getByRole("button", { name: "Review carrier booking", exact: true })
      .click();
    const pane = page.getByRole("region", {
      name: "Carrier booking review",
      exact: true,
    });
    await pane
      .getByRole("combobox", { name: "Carrier provider", exact: true })
      .selectOption("dhl-express");
    await pane
      .getByRole("combobox", { name: "Service", exact: true })
      .selectOption(`Reviewed DHL ${variant.destination}`);
    await address(pane, "Reviewed warehouse origin", variant.country, false);
    await address(pane, "Reviewed destination", variant.destination, true);
    if (cross) {
      expect(reviewedGoods).toHaveLength(variant.bulk ? 1 : 2);
      await expect(
        pane.getByLabel("Declared value per unit", { exact: true }).first(),
      ).toHaveValue("");
      await expect(
        pane.getByRole("combobox", {
          name: "Declaration currency",
          exact: true,
        }),
      ).toHaveValue("");
      // Changing countries clears the customs form; values cannot leak into a
      // domestic request or a differently reviewed cross-border route.
      await pane
        .getByLabel("Declared value per unit", { exact: true })
        .first()
        .fill("99.99");
      const destination = pane.getByRole("group", {
        name: "Reviewed destination",
        exact: true,
      });
      await destination
        .getByRole("combobox", { name: "Country", exact: true })
        .selectOption(variant.country);
      await expect(
        pane.getByRole("group", {
          name: "Cross-border customs declaration",
          exact: true,
        }),
      ).toHaveCount(0);
      await destination
        .getByRole("combobox", { name: "Country", exact: true })
        .selectOption(variant.destination);
      await expect(
        pane.getByLabel("Declared value per unit", { exact: true }).first(),
      ).toHaveValue("");
    }
    if (variant.port === 3123) {
      await pane
        .getByLabel("Shipper company", { exact: true })
        .fill("Discarded company");
      const provider = pane.getByRole("combobox", {
        name: "Carrier provider",
        exact: true,
      });
      await provider.selectOption("usps");
      await expect(
        pane.getByRole("group", {
          name: "DHL shipping declaration",
          exact: true,
        }),
      ).toHaveCount(0);
      await provider.selectOption("dhl-express");
      await expect(
        pane.getByLabel("Shipper company", { exact: true }),
      ).toHaveValue("");
      await pane
        .getByRole("combobox", { name: "Service", exact: true })
        .selectOption(`Reviewed DHL ${variant.destination}`);
    }
    await declaration(pane, cross, reviewedGoods.length);
    await parcelAndAcknowledgments(pane);
    const attempts: { key: string; payload: any }[] = [];
    await page.route("**/api/commands/carrier.prepare", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"]!,
        payload: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (variant.lost && attempts.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    const prepare = pane.getByRole("button", {
      name: "Prepare reviewed booking",
      exact: true,
    });
    if (cross) {
      await prepare.click();
      expect(attempts).toHaveLength(0);
      await pane
        .getByRole("checkbox", {
          name: "I reviewed every packed line",
          exact: false,
        })
        .check();
      const unitValue = pane
        .getByLabel("Declared value per unit", { exact: true })
        .first();
      await unitValue.fill("1.001");
      await prepare.click();
      expect(attempts).toHaveLength(0);
      await unitValue.fill("123.45");
    }
    await prepare.click();
    if (variant.lost) {
      await expect(pane.getByRole("alert")).toContainText("Failed to fetch");
      await prepare.click();
      await expect(
        pane.getByRole("heading", { name: "Current booking", exact: true }),
      ).toBeVisible();
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
    }
    await expect(
      pane.getByRole("heading", { name: "Current booking", exact: true }),
    ).toBeVisible();
    const retained = pane.getByRole("region", {
      name: "Retained DHL declaration",
      exact: true,
    });
    await expect(retained).toContainText("2026-10-03T10:30:00-04:00");
    await expect(retained).toContainText("Reviewed warehouse company");
    let prepared = (await (await page.request.get(path)).json()).booking;
    const original = prepared;
    expect(prepared.dhl).toEqual(attempts[0]!.payload.dhl);
    if (cross) {
      expect(
        prepared.dhl.customs.lines.map((g: any) => ({
          allocationId: g.allocationId,
          quantity: g.quantity,
        })),
      ).toEqual(shipment.lines);
      expect(prepared.dhl.customs.lines[0].unitValueMinor).toBe(12345);
      expect(prepared.dhl.customs.lines[0].commodityCode).toBe("001234");
      await expect(retained).toContainText(
        variant.bulk
          ? "Total declared value: CAD 246.90"
          : "Total declared value: CAD 123.46",
      );
    } else {
      expect(prepared.dhl.customs).toBeUndefined();
      await expect(retained).toContainText("Domestic shipment");
    }
    if (variant.bulk) {
      await pane
        .getByLabel("Cancellation reason", { exact: true })
        .fill("Explicit revised customs review before any provider request");
      await pane
        .getByRole("button", {
          name: "Cancel reviewed pending booking",
          exact: true,
        })
        .click();
      await expect(pane).toContainText(
        `Reviewed DHL ${variant.destination} · canceled`,
      );
      await expect(
        pane.getByLabel("Customs invoice number", { exact: true }),
      ).toHaveValue("");
      await expect(
        pane.getByLabel("Declared value per unit", { exact: true }),
      ).toHaveValue("");
      await expect(
        pane.getByLabel("Shipper company", { exact: true }),
      ).toHaveValue("");
      await expect(
        pane.getByRole("checkbox", {
          name: "I reviewed every packed line",
          exact: false,
        }),
      ).not.toBeChecked();
      await pane
        .getByRole("combobox", { name: "Service", exact: true })
        .selectOption(`Reviewed DHL ${variant.destination}`);
      await address(pane, "Reviewed warehouse origin", variant.country, false);
      await address(pane, "Reviewed destination", variant.destination, true);
      await declaration(pane, cross, reviewedGoods.length, "SYNTHETIC-REVISED");
      await parcelAndAcknowledgments(pane);
      await pane
        .getByRole("checkbox", {
          name: "I reviewed every packed line",
          exact: false,
        })
        .check();
      await prepare.click();
      await expect(pane).toContainText(
        `Reviewed DHL ${variant.destination} · pending`,
      );
      prepared = (await (await page.request.get(path)).json()).booking;
      expect(prepared.id).not.toBe(original.id);
      expect(prepared.reviewHash).not.toBe(original.reviewHash);
      expect(prepared.dhl.customs.invoiceNumber).toBe("SYNTHETIC-REVISED");
      expect(attempts).toHaveLength(2);
      expect(attempts[1]!.key).not.toBe(attempts[0]!.key);
      expect(prepared.dhl).toEqual(attempts[1]!.payload.dhl);
    }
    await page.unroute("**/api/commands/carrier.prepare");
    expect(await native()).toEqual(before);
    const send = pane.getByRole("button", {
      name: "Send reviewed carrier booking",
      exact: true,
    });
    await send.click();
    if (variant.lost) {
      await expect(pane.getByRole("alert")).toContainText("CARRIER_TRANSPORT");
      await pane
        .getByRole("button", {
          name: "Retry current carrier review",
          exact: true,
        })
        .click();
      await expect(pane).toContainText(
        `Reviewed DHL ${variant.destination} · unknown`,
      );
      await expect(send).toHaveCount(0);
      await expect(prepare).toHaveCount(0);
      await pane
        .getByRole("button", {
          name: "Reconcile existing carrier booking",
          exact: true,
        })
        .click();
      await expect(pane.getByRole("alert")).toContainText(
        "CARRIER_RECOVERY_UNSUPPORTED",
      );
      await pane
        .getByRole("button", {
          name: "Retry current carrier review",
          exact: true,
        })
        .click();
      expect((await (await page.request.get(path)).json()).booking.id).toBe(
        prepared.id,
      );
    } else {
      await expect(pane).toContainText(
        `Reviewed DHL ${variant.destination} · booked`,
      );
      const link = pane.getByRole("link", {
        name: "Download carrier label",
        exact: true,
      });
      const reply = await page.request.get(
        origin + (await link.getAttribute("href")),
      );
      expect(reply.status()).toBe(200);
      const document = await PDFDocument.load(await reply.body());
      expect(document.getPages().map((p) => p.getWidth())).toEqual(
        cross ? [201, 301, 401] : [201, 301],
      );
    }
    await pane
      .getByRole("button", {
        name: "Load carrier booking history",
        exact: true,
      })
      .click();
    await expect(
      pane.getByRole("region", {
        name: "Retained DHL declaration",
        exact: true,
      }),
    ).toHaveCount(variant.bulk ? 3 : 2);
    if (variant.bulk) {
      const history = (await (await page.request.get(path + "/history")).json())
        .items;
      const canceled = history.find((item: any) => item.id === original.id);
      expect(canceled.state).toBe("canceled");
      expect(canceled.dhl).toEqual(original.dhl);
      expect(canceled.reviewHash).toBe(original.reviewHash);
      await expect(
        retained.filter({ hasText: "SYNTHETIC-EXPORT" }),
      ).toHaveCount(1);
      await expect(
        retained.filter({ hasText: "SYNTHETIC-REVISED" }),
      ).toHaveCount(2);
    }
    const after = (await (await page.request.get(path)).json()).booking;
    expect(after.dhl).toEqual(prepared.dhl);
    expect(after.reviewHash).toBe(prepared.reviewHash);
    expect(await native()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
