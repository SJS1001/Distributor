import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { seedGreePilot } from "../src/demo/gree-pilot-seed.ts";
import { seedFullPilot } from "../src/demo/pilot-full-seed.ts";
import { installVirtualClock } from "../src/demo/virtual-clock.ts";

test("full pilot seed adds dated everyday activity and retires SAMPLE labels through audited renames", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pilot-full-"));
  const path = join(directory, "app.db");
  const app = new Application(path, "CA");
  t.after(() => {
    app.close();
    rmSync(directory, { recursive: true });
  });
  const admin = app.identity.bootstrap(
    "Distributor-Canada",
    "admin@example.test",
    "only-for-local-test-admin",
    "CAD",
  );
  seedGreePilot(app, admin, {
    currentPassword: "only-for-local-test-admin",
    buyerEmail: "sample-buyer@example.test",
    buyerPassword: "only-for-local-test-buyer",
  });
  const end = Date.now();
  const clock = installVirtualClock(end - 60 * 86400000);
  let result: ReturnType<typeof seedFullPilot>;
  try {
    result = seedFullPilot(app, admin, { clock, end });
  } finally {
    clock.restore();
  }
  assert.deepEqual(result, {
    products: 16,
    addonPairs: 80,
    customers: 7,
    staffUsers: 7,
    applications: 10,
    activatedBuyers: 6,
    purchaseOrders: 14,
    receipts: result.receipts,
    salesOrders: 24,
    shipments: 20,
    payments: 13,
    transfers: 2,
    counts: 2,
    supplierReturns: 1,
    warrantyClaims: 4,
    reviewRequests: 2,
    notes: 5,
  });
  assert.ok(result.receipts >= 40);

  // Labels and identities.
  const products = app.catalog.products(admin);
  assert.equal(products.length, 27);
  assert.ok(products.every((p) => !/sample/i.test(`${p.sku} ${p.name}`)));
  assert.ok(
    app.identity.customers(admin).every((c) => !/sample/i.test(c.name)),
  );
  assert.deepEqual(
    app.inventory
      .warehouses(admin)
      .map((w) => String(w.name))
      .sort(),
    ["Ottawa branch", "Toronto distribution centre"],
  );
  assert.ok(
    app.procurement.suppliers(admin).every((s) => !/sample/i.test(s.name)),
  );

  // History spans weeks and ends before now; nothing is dated in the future.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  const span = db
    .prepare(
      "SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM orders_orders",
    )
    .get() as { first: string; last: string };
  assert.ok(Date.parse(span.first) < end - 40 * 86400000);
  assert.ok(Date.parse(span.last) <= end);
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM platform_audit WHERE action IN ('product.renamed','account.renamed','warehouse.renamed','supplier.renamed')",
        )
        .get() as { n: number }
    ).n,
    11 + 3 + 2 + 1,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check,
    "ok",
  );

  // Trade applications cover each review state.
  const statuses = db
    .prepare(
      "SELECT status, COUNT(*) AS n FROM enrollment_applications GROUP BY status ORDER BY status",
    )
    .all()
    .map((r) => `${r.status}:${r.n}`);
  assert.deepEqual(statuses, [
    "activated:6",
    "approved:1",
    "pending:2",
    "rejected:1",
  ]);
  const invitation = db
    .prepare(
      "SELECT expires_at FROM enrollment_applications WHERE status='approved'",
    )
    .get() as { expires_at: number };
  assert.ok(invitation.expires_at > Date.now());
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM enrollment_applications WHERE business_number='' OR phone='' OR notes=''",
        )
        .get() as { n: number }
    ).n,
    0,
  );

  // Running again is refused before any change.
  assert.throws(() => seedFullPilot(app, admin), /already been applied/);
});
