import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import frozen from "./schema-version-twenty-four.json" with { type: "json" };

function raw<T>(path: string, fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
// Frozen complete DDL from actual archived sourceCommit, not current DDL with
// new objects subtracted. Both optional reporting shapes are independently pinned.
for (const profile of frozen.profiles)
  test(`frozen schema24 upgrades additively to current; reports=${profile.eventReports}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "distributor-schema25-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, "source24.db"),
      target = join(dir, "target25.db");
    raw(source, (db) => {
      for (const object of [...profile.schema].sort(
        (a, b) => Number(b.type === "table") - Number(a.type === "table"),
      ))
        db.exec(object.sql);
      assert.equal(schemaFingerprint(db), profile.hash);
      db.prepare(
        "INSERT INTO platform_schema_version VALUES(1,24,?,?,?,?)",
      ).run(
        profile.hash,
        Number(profile.eventReports),
        "CA",
        "2026-10-01T00:00:00.000Z",
      );
      db.prepare("INSERT INTO iam_organizations VALUES(?,?,?,?,?)").run(
        "synthetic-org",
        "Synthetic migrated distributor",
        "CA",
        "CAD",
        "{}",
      );
      db.prepare(
        "INSERT INTO iam_accounts(id,org_id,name,currency,tier,credit_limit) VALUES(?,?,?,?,?,?)",
      ).run(
        "synthetic-account",
        "synthetic-org",
        "Existing contractor",
        "CAD",
        "reviewed-trade",
        123400,
      );
    });
    const bytes = readFileSync(source),
      before = raw(source, (db) => ({
        org: db.prepare("SELECT * FROM iam_organizations").all(),
        accounts: db.prepare("SELECT * FROM iam_accounts").all(),
      }));
    assert.equal(inspectSchema(source).version, 24);
    assert.equal(inspectSchema(source).kind, "previous");
    assert.throws(
      () =>
        new Application(source, "CA", { eventReports: profile.eventReports }),
      { code: "SCHEMA_UPGRADE_REQUIRED" },
    );
    assert.deepEqual(readFileSync(source), bytes);
    const receipt = await upgradeSchema(source, target, profile.hash, "CA");
    assert.equal(receipt.sourceVersion, 24);
    assert.equal(receipt.version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 26);
    assert.equal(inspectSchema(target).kind, "current");
    assert.equal(
      inspectSchema(target).initializedAt,
      "2026-10-01T00:00:00.000Z",
    );
    assert.deepEqual(
      raw(target, (db) => ({
        org: db.prepare("SELECT * FROM iam_organizations").all(),
        accounts: db.prepare("SELECT * FROM iam_accounts").all(),
      })),
      before,
    );
    const app = new Application(target, "CA", {
      eventReports: profile.eventReports,
    });
    try {
      for (const table of [
        "catalog_account_policies",
        "catalog_entitlements",
        "catalog_product_policies",
        "catalog_resources",
        "catalog_resource_history",
        "orders_review_requests",
        "orders_review_history",
        "orders_review_quotes",
      ]) {
        const owner = table.startsWith("catalog_") ? "catalog" : "orders";
        assert.equal(
          app.database.owned(owner).get(`SELECT COUNT(*) AS n FROM ${table}`)!
            .n,
          0,
          `${table} must start empty; no automatic grants`,
        );
      }
      assert.throws(
        () =>
          app.database
            .owned("enrollment")
            .run("UPDATE iam_accounts SET credit_limit=0"),
        /not authorized|ownership|owner/i,
      );
    } finally {
      app.close();
    }
    assert.deepEqual(readFileSync(source), bytes);
    raw(source, (db) =>
      db.exec("CREATE TABLE catalog_unregistered(id TEXT) STRICT"),
    );
    assert.throws(() => inspectSchema(source), { code: "SCHEMA_DRIFT" });
  });
