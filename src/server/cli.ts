import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Application } from "./application.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { check } from "./core.ts";
import { type Region } from "./iam.ts";
const action = process.argv[2];
check(
  ["bootstrap", "demo"].includes(action ?? ""),
  "CLI",
  "Supported actions: bootstrap, demo.",
  400,
);
const app = new Application(
  process.env.DATABASE_PATH ?? "local-evidence/distributor.db",
  (process.env.DATA_REGION ?? "CA") as Region,
  { eventReports: configuredEventReports() },
);
try {
  let password = process.env.BOOTSTRAP_PASSWORD;
  if (!password && action === "demo")
    password = randomBytes(24).toString("base64url");
  if (!password) {
    check(
      !process.stdin.isTTY,
      "CLI",
      "Supply BOOTSTRAP_PASSWORD or pipe the password on stdin; interactive input would echo it.",
      400,
    );
    const reader = createInterface({ input: process.stdin });
    password = await reader.question("");
    reader.close();
  }
  const email = process.env.BOOTSTRAP_EMAIL ?? "admin@example.test",
    actor = app.identity.bootstrap(
      process.env.ORGANIZATION_NAME ?? "Synthetic Distributor",
      email,
      password!,
      app.identity.region === "CA" ? "CAD" : "USD",
    );
  if (action === "demo") {
    const w1 = app.inventory.createWarehouse(actor, "demo-w1", {
      name: "Toronto",
    }).id;
    app.inventory.createWarehouse(actor, "demo-w2", { name: "Ottawa" });
    app.identity.createCustomer(actor, "demo-account", {
      name: "Synthetic buyer",
      tier: "standard",
      creditLimit: 1000000,
    });
    const p = app.catalog.create(actor, "demo-product", {
        sku: "DEMO-EQ-1",
        name: "Synthetic equipment",
        serialized: true,
        unitPrice: 10000,
        taxBasisPoints: 1300,
      }).id,
      s = app.procurement.supplier(actor, "demo-supplier", {
        name: "Synthetic supplier",
      }).id;
    const po = app.procurement.create(actor, "demo-po", {
        supplierId: s,
        warehouseId: w1,
        lines: [{ productId: p, quantity: 3, unitCost: 6000 }],
      }).id,
      line = app.procurement.orders(actor).find((o) => o.id === po)!.lines[0]!;
    app.procurement.receive(actor, "demo-receipt", {
      poId: po,
      lineId: String(line.id),
      deliveryRef: "DEMO-DELIVERY-1",
      quantity: 3,
      serials: ["DEMO-S1", "DEMO-S2", "DEMO-S3"],
      bin: "A-1",
      quarantine: false,
    });
    process.stdout.write(
      `Synthetic demo created. Sign in with ${email}\nGenerated local demo password: ${password}\n`,
    );
  } else
    process.stdout.write(
      `Organization created; administrator ${email}. Store region: ${app.identity.region}.\n`,
    );
} finally {
  app.close();
}
