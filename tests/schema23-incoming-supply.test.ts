import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical } from "../src/server/core.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { fixture, accept } from "./fixtures.ts";
const additions = [
  "catalog_resource_history",
  "catalog_resources",
  "orders_review_quotes",
  "orders_review_history",
  "orders_review_requests",
  "catalog_entitlements",
  "catalog_account_policies",
  "catalog_product_policies",

  "enrollment_applications",
  "enrollment_limits",
  "orders_incoming_commitments",
  "orders_incoming_history",
  "inventory_incoming_holds",
];
function raw<T>(path: string, fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function business(path: string) {
  return raw(path, (db) =>
    canonical(
      Object.fromEntries(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
          )
          .all()
          .filter(
            (r) =>
              r.name !== "platform_schema_version" &&
              !additions.includes(String(r.name)),
          )
          .map((r) => [
            String(r.name),
            db
              .prepare(
                `SELECT * FROM "${String(r.name).replaceAll('"', '""')}" ORDER BY rowid`,
              )
              .all(),
          ]),
      ),
    ),
  );
}
for (const reports of [false, true])
  test(`schema22 to current keeps existing stock/order records and source; reports=${reports}`, async (t) => {
    const f = fixture(t, { eventReports: reports });
    accept(f, 2);
    const source = join(dirname(f.path), "source22.db"),
      target = join(dirname(f.path), "upgraded23.db");
    raw(f.path, (db) => db.prepare("VACUUM INTO ?").run(source));
    raw(source, (db) => {
      for (const table of additions) db.exec(`DROP TABLE ${table}`);
      const hash = schemaFingerprint(db);
      db.prepare(
        "UPDATE platform_schema_version SET version=22,schema_hash=?",
      ).run(hash);
    });
    const sourceBytes = readFileSync(source),
      before = business(source),
      old = inspectSchema(source);
    assert.equal(old.kind, "previous");
    assert.equal(old.version, 22);
    assert.throws(
      () => new Application(source, "CA", { eventReports: reports }),
      { code: "SCHEMA_UPGRADE_REQUIRED" },
    );
    const receipt = await upgradeSchema(source, target, old.schemaHash, "CA");
    assert.equal(receipt.sourceVersion, 22);
    assert.equal(receipt.version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 25);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.equal(business(target), before);
    assert.equal(inspectSchema(target).kind, "current");
    const app = new Application(target, "CA", { eventReports: reports });
    try {
      for (const table of additions) {
        const owner = table.startsWith("orders_")
          ? "orders"
          : table.startsWith("enrollment_")
            ? "enrollment"
            : table.startsWith("catalog_")
              ? "catalog"
              : "inventory";
        assert.equal(
          app.database.owned(owner).get(`SELECT COUNT(*) AS n FROM ${table}`)!
            .n,
          0,
        );
      }
    } finally {
      app.close();
    }
    assert.equal(business(target), before);
  });
