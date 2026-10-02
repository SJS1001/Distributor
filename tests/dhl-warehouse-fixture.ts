import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { DhlTestClient } from "../src/server/dhl-test.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";

export function dhlWarehouse(
  t: Parameters<typeof fixture>[0],
  country: "US" | "CA",
  bulk = false,
) {
  const f = fixture(t, {}, country);
  if (bulk) {
    f.product = f.app.catalog.create(f.actor, "dhl-ui-bulk", {
      sku: "DHL-UI-BULK",
      name: "Synthetic bulk equipment",
      serialized: false,
      unitPrice: 98765,
      taxBasisPoints: 0,
    }).id;
    const poId = f.app.procurement.create(f.actor, "dhl-ui-po", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity: 3, unitCost: 2500 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, "dhl-ui-receive", {
      poId,
      lineId: String(line.id),
      deliveryRef: "SYNTHETIC-DHL-UI",
      quantity: 3,
      serials: [],
      bin: "B-1",
      quarantine: false,
    });
  }
  const orderId = accept(f, 2).id;
  chooseProviders(f, f.actor, "dhl-ui-choice", {
    accountId: f.buyer,
    region: country,
    mode: "provider-exceptions",
    providers: ["dhl-express", "usps"],
    version: 1,
    acknowledgment: "Synthetic customer processor choice",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `dhl-ui-pick-${p.id}`, {
      orderId,
      allocationId: p.id,
      serial: p.serial,
    });
  const shipmentId = f.app.fulfillment.pack(f.actor, "dhl-ui-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address: "Synthetic DHL warehouse recipient",
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  return Object.assign(f, { orderId, shipmentId, picks });
}
async function pdf(width: number) {
  const document = await PDFDocument.create();
  document
    .addPage([width, 432])
    .drawText(`Synthetic warehouse document ${width}`);
  return Buffer.from(await document.save()).toString("base64");
}
// Independent original synthetic transport; it never invokes global fetch.
// Actual coordinator/client/PDF parsing is used, without carrier accounts or I/O.
export async function dhlBrowser(after: (fn: () => void) => void) {
  const documents = await Promise.all([pdf(201), pdf(301), pdf(401)]);
  const servers = [];
  for (const [index, variant] of [
    { country: "US", bulk: false, lost: false },
    { country: "CA", bulk: false, lost: false },
    { country: "US", bulk: true, lost: false },
    { country: "CA", bulk: false, lost: false },
    { country: "US", bulk: false, lost: true },
  ].entries()) {
    const f = dhlWarehouse(
      { after },
      variant.country as "US" | "CA",
      variant.bulk,
    );
    const client = new DhlTestClient(
      {
        orgId: f.actor.orgId,
        username: "synthetic-user",
        password: "synthetic-secret",
        accountNumber: "123456789",
        country: variant.country as "US" | "CA",
        services: (["US", "CA"] as const).map((destinationCountry) => ({
          service: `Reviewed DHL ${destinationCountry}`,
          productCode: "P",
          localProductCode: "P",
          destinationCountry,
        })),
      },
      async (input, init) => {
        assert.equal(
          String(input),
          "https://express.api.dhl.com/mydhlapi/test/shipments",
        );
        assert.equal(init!.method, "POST");
        const body = JSON.parse(String(init!.body));
        assert.equal(body.pickup.isRequested, false);
        assert.equal(
          body.customerDetails.shipperDetails.contactInformation.companyName,
          "Reviewed warehouse company",
        );
        assert.equal(
          body.customerDetails.receiverDetails.contactInformation.companyName,
          "Reviewed recipient company",
        );
        if (variant.lost) throw Error("Synthetic DHL lost response");
        return new Response(
          JSON.stringify({
            shipmentTrackingNumber: "1234567890",
            packages: [
              { referenceNumber: 1, trackingNumber: "JD123456789012345678" },
            ],
            documents: documents
              .slice(0, body.content.isCustomsDeclarable ? 3 : 2)
              .map((content, i) => ({
                typeCode: i === 2 ? "invoice" : "label",
                imageFormat: "PDF",
                content,
                packageReferenceNumber: 1,
              })),
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json",
              "Message-Reference": new Headers(init!.headers).get(
                "Message-Reference",
              )!,
            },
          },
        );
      },
      () => Date.parse("2026-10-02T14:30:00Z"),
    );
    const port = 3123 + index;
    const http = await createHttp(f.app, {
      origin: `http://127.0.0.1:${port}`,
      carriers: new CarrierRuntime(f.app, [
        { orgId: f.actor.orgId, adapter: client },
      ]),
    });
    await http.listen({ host: "127.0.0.1", port });
    servers.push(http);
  }
  return servers;
}
