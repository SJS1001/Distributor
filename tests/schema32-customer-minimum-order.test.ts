import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
for (const eventReports of [false, true])
  test(`schema31 to33 conserves all existing data with minimums disabled, reports=${eventReports}`, async (t) => {
    const f = fixture(t, { eventReports });
    const order = accept(f);
    const source = f.path,
      target = join(dirname(source), "schema32.db");
    f.app.close();
    const db = new DatabaseSync(source);
    db.exec(
      "DROP TABLE warranty_claim_eligibility; DROP TABLE warranty_policy_history; DROP TABLE warranty_installation_history; DROP TABLE warranty_installations; DROP TABLE warranty_product_terms; DROP TABLE warranty_return_policy; DROP TABLE iam_customer_minimum_orders",
    );
    const hash = schemaFingerprint(db);
    db.prepare(
      "UPDATE platform_schema_version SET version=31,schema_hash=?",
    ).run(hash);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'platform_schema_version' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const rows = Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
    db.close();
    const bytes = readFileSync(source);
    assert.equal(inspectSchema(source).version, 31);
    assert.throws(() => new Application(source, "CA", { eventReports }), {
      code: "SCHEMA_UPGRADE_REQUIRED",
    });
    const receipt = await upgradeSchema(source, target, hash, "CA");
    assert.equal(receipt.sourceVersion, 31);
    assert.equal(receipt.version, 33);
    assert.equal(SCHEMA_VERSION, 33);
    assert.deepEqual(readFileSync(source), bytes);
    const upgraded = new DatabaseSync(target);
    for (const table of tables)
      assert.deepEqual(
        upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        rows[table],
      );
    assert.equal(
      upgraded
        .prepare("SELECT COUNT(*) AS n FROM iam_customer_minimum_orders")
        .get()!.n,
      0,
    );
    assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    upgraded.close();
    f.app = new Application(target, "CA", { eventReports });
    assert.equal(
      f.app.identity.minimumOrders.get(f.actor, f.buyer).minimumSubtotal,
      0,
    );
    assert.equal(f.app.orders.order(f.actor, order.id).id, order.id);
    f.app.identity.minimumOrders.save(f.actor, "restorable-policy", {
      accountId: f.buyer,
      expectedRevision: 0,
      minimumSubtotal: 20000,
      minimumEquipmentQuantity: 2,
      reason: "Recovery policy test",
    });
    const archive = join(dirname(source), "minimum.distributor-backup"),
      restored = join(dirname(source), "restored.db"),
      key = Buffer.alloc(32, 9);
    await createBackup(target, archive, "CA", key);
    await restoreBackup(archive, restored, "CA", key);
    const restoredDb = new DatabaseSync(restored);
    assert.equal(
      restoredDb
        .prepare("SELECT minimum_subtotal FROM iam_customer_minimum_orders")
        .get()!.minimum_subtotal,
      20000,
    );
    assert.equal(
      restoredDb
        .prepare(
          "SELECT minimum_equipment_quantity FROM iam_customer_minimum_orders",
        )
        .get()!.minimum_equipment_quantity,
      2,
    );
    assert.equal(inspectSchema(restored).version, 33);
    restoredDb.close();
  });
