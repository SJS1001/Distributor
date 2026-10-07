import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
const additions = [
  "warranty_claim_eligibility",
  "warranty_policy_history",
  "warranty_installation_history",
  "warranty_installations",
  "warranty_product_terms",
  "warranty_return_policy",
];
for (const eventReports of [false, true])
  test(`schema32 clone upgrade preserves rows/source and schema33 recovery retains registration and policy, reports=${eventReports}`, async (t) => {
    const f = fixture(t, { eventReports }),
      shipment = ship(f, accept(f).id),
      unitId = f.app.inventory.trace(f.actor, "S1").unit.id,
      productId = f.app.inventory.unit(f.actor, unitId).product_id,
      source = f.path,
      target = join(dirname(source), "schema33.db");
    f.app.close();
    const db = new DatabaseSync(source);
    for (const table of additions) db.exec(`DROP TABLE ${table}`);
    const hash = schemaFingerprint(db);
    db.prepare(
      "UPDATE platform_schema_version SET version=32,schema_hash=?",
    ).run(hash);
    const tables = db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'platform_schema_version' ORDER BY name",
        )
        .all()
        .map((r) => String(r.name)),
      rows = Object.fromEntries(
        tables.map((table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    db.close();
    const bytes = readFileSync(source);
    assert.equal(inspectSchema(source).version, 32);
    assert.throws(() => new Application(source, "CA", { eventReports }), {
      code: "SCHEMA_UPGRADE_REQUIRED",
    });
    const receipt = await upgradeSchema(source, target, hash, "CA");
    assert.equal(receipt.sourceVersion, 32);
    assert.equal(receipt.version, 33);
    assert.equal(SCHEMA_VERSION, 33);
    assert.deepEqual(readFileSync(source), bytes);
    const upgraded = new DatabaseSync(target);
    for (const table of tables)
      assert.deepEqual(
        upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        rows[table],
      );
    for (const table of additions)
      assert.equal(
        upgraded.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,
        0,
      );
    assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    upgraded.close();
    f.app = new Application(target, "CA", { eventReports });
    const api = f.app.warranty.registration;
    api.saveReturnPolicy(f.actor, "return", {
      expectedRevision: 0,
      days: 30,
      reason: "Synthetic policy",
    });
    api.saveTerms(f.actor, "terms", {
      productId,
      expectedRevision: 0,
      manufacturer: "Synthetic manufacturer",
      reference: "synthetic:terms",
      startsAt: "installation",
      days: 3650,
      notes: "Synthetic test terms",
      reason: "Synthetic test",
    });
    api.save(f.actor, "install", {
      unitId,
      accountId: f.buyer,
      shipmentId: shipment.id,
      ownershipId: shipment.id,
      expectedRevision: 0,
      installedOn: f.app.fulfillment
        .shipment(f.actor, shipment.id)
        .shipped_at!.slice(0, 10),
      installer: "Synthetic",
      site: "Synthetic",
      evidence: "synthetic:install",
      reason: "Synthetic test",
    });
    const c = f.app.warranty.submit(f.actor, "claim", {
      accountId: f.buyer,
      unitId,
      type: "warranty",
      issue: "Synthetic",
      evidence: "Synthetic",
    });
    const archive = join(dirname(source), "warranty.distributor-backup"),
      restored = join(dirname(source), "restored.db"),
      key = Buffer.alloc(32, 7);
    await createBackup(target, archive, "CA", key);
    await restoreBackup(archive, restored, "CA", key);
    assert.equal(inspectSchema(restored).version, 33);
    const restoredDb = new DatabaseSync(restored);
    for (const table of additions) {
      const original = new DatabaseSync(target, { readOnly: true });
      try {
        assert.deepEqual(
          restoredDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          original.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        );
      } finally {
        original.close();
      }
    }
    assert.equal(
      restoredDb
        .prepare("SELECT claim_id FROM warranty_claim_eligibility")
        .get()!.claim_id,
      c.id,
    );
    assert.deepEqual(restoredDb.prepare("PRAGMA foreign_key_check").all(), []);
    restoredDb.close();
    const recovered = new Application(restored, "CA", { eventReports });
    try {
      assert.ok(recovered.platform.recoveryHold());
      assert.equal(
        recovered.warranty.registration.review(f.actor, unitId, f.buyer)
          .registration!.revision,
        1,
      );
    } finally {
      recovered.close();
    }
  });
