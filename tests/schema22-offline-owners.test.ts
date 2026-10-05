import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical } from "../src/server/core.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { fixture } from "./fixtures.ts";
const laterTables = [
  "catalog_product_availability",
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
const tables = [
  "integration_offline_checkout_paid",
  "integration_offline_original_leases",
] as const;
// Frozen from the published schema21 source, before this schema change.
const v21 = {
  enabled: "9429d1f584cf247934481bbd160e47484261367517d66ae2842ac0e24c0e6fed",
  disabled: "86f77a0415930f5945cd06ddabb8734f914136ca3818735004d7a0ab2c4b18dd",
};
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
              !tables.includes(r.name as (typeof tables)[number]) &&
              !laterTables.includes(String(r.name)),
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
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`schema21 ${region}/${currency} reports=${reports}: explicit empty owner upgrade conserves rows and source`, async (t) => {
      const f = fixture(t, { eventReports: reports }, region, currency),
        source = join(dirname(f.path), "source21.db"),
        target = join(dirname(f.path), "upgraded22.db");
      raw(f.path, (db) => db.prepare("VACUUM INTO ?").run(source));
      raw(source, (db) => {
        for (const table of [...tables, ...laterTables])
          db.exec(`DROP TABLE ${table}`);
        const hash = reports ? v21.enabled : v21.disabled;
        assert.equal(schemaFingerprint(db), hash);
        db.prepare(
          "UPDATE platform_schema_version SET version=21,schema_hash=?",
        ).run(hash);
      });
      const original = readFileSync(source),
        before = business(source),
        old = inspectSchema(source);
      assert.equal(old.version, 21);
      assert.equal(old.kind, "previous");
      assert.throws(
        () => new Application(source, region, { eventReports: reports }),
        { code: "SCHEMA_UPGRADE_REQUIRED" },
      );
      assert.deepEqual(readFileSync(source), original);
      const receipt = await upgradeSchema(
        source,
        target,
        old.schemaHash,
        region,
      );
      assert.equal(receipt.sourceVersion, 21);
      assert.equal(receipt.version, SCHEMA_VERSION);
      assert.equal(receipt.version, SCHEMA_VERSION);
      assert.equal(inspectSchema(target).kind, "current");
      assert.equal(inspectSchema(target).initializedAt, old.initializedAt);
      assert.equal(business(target), before);
      assert.deepEqual(readFileSync(source), original);
      const app = new Application(target, region, { eventReports: reports });
      try {
        app.database.transaction(() => {
          for (const table of tables)
            assert.equal(
              app.database
                .owned("integration")
                .get(`SELECT COUNT(*) AS n FROM ${table}`)!.n,
              0,
            );
          // An explicit schema upgrade does not confer isolated restore status.
          assert.throws(
            () => app.database.captureRestoreCandidateInTransaction(),
            { code: "RESTORE_REVIEW" },
          );
          assert.equal(app.platform.offline.readInTransaction(), null);
        });
      } finally {
        app.close();
      }
      assert.equal(business(target), before);
    });
test("registered empty owner schema preserves exact drift refusal", (t) => {
  const f = fixture(t);
  raw(f.path, (db) =>
    db.exec("CREATE TABLE integration_unregistered_probe(id TEXT) STRICT"),
  );
  assert.throws(() => inspectSchema(f.path), { code: "SCHEMA_DRIFT" });
});
