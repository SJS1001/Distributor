import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import frozen from "./schema-version-twenty-five.json" with { type: "json" };

function raw<T>(path: string, fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
for (const profile of frozen.profiles)
  test(`exact archived schema25 upgrades additively to26 with unchanged facts; reports=${profile.eventReports}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "distributor-schema26-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const source = join(dir, "source25.db"),
      target = join(dir, "target26.db");
    raw(source, (db) => {
      for (const o of [...profile.schema].sort(
        (a, b) => Number(b.type === "table") - Number(a.type === "table"),
      ))
        db.exec(o.sql);
      assert.equal(schemaFingerprint(db), profile.hash);
      db.prepare(
        "INSERT INTO platform_schema_version VALUES(1,25,?,?,?,?)",
      ).run(
        profile.hash,
        Number(profile.eventReports),
        "CA",
        "2026-10-01T00:00:00.000Z",
      );
      db.exec(
        "INSERT INTO iam_organizations VALUES('org','Synthetic migration','CA','CAD','{}')",
      );
      db.exec(
        "INSERT INTO iam_accounts(id,org_id,name,currency,tier,credit_limit) VALUES('account','org','Synthetic customer','CAD','trade',100000)",
      );
      db.exec(
        "INSERT INTO catalog_products VALUES('product','org','MIGRATE-1','Retained product',0,12000,1300,'CAD',1)",
      );
      db.exec(
        "INSERT INTO catalog_account_policies VALUES('org','account','selected',1,2)",
      );
      db.exec(
        "INSERT INTO catalog_entitlements VALUES('org','account','product')",
      );
      db.exec(
        "INSERT INTO catalog_product_policies VALUES('org','product',1,3)",
      );
      db.exec(
        "INSERT INTO inventory_units VALUES('unit','org','product','warehouse','A',NULL,7,10000,'usable','stock',2)",
      );
    });
    const bytes = readFileSync(source);
    const tables = profile.schema
      .filter((o) => o.type === "table" && o.name !== "platform_schema_version")
      .map((o) => o.name);
    const rows = (path: string) =>
      raw(path, (db) =>
        Object.fromEntries(
          tables.map((table) => [
            table,
            db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          ]),
        ),
      );
    const before = rows(source);
    assert.equal(inspectSchema(source).version, 25);
    assert.throws(
      () =>
        new Application(source, "CA", { eventReports: profile.eventReports }),
      { code: "SCHEMA_UPGRADE_REQUIRED" },
    );
    assert.deepEqual(readFileSync(source), bytes);
    const receipt = await upgradeSchema(source, target, profile.hash, "CA");
    assert.equal(receipt.sourceVersion, 25);
    assert.equal(receipt.version, SCHEMA_VERSION);
    assert.ok(SCHEMA_VERSION >= 26);
    assert.equal(inspectSchema(target).kind, "current");
    assert.deepEqual(rows(target), before);
    assert.equal(
      inspectSchema(target).initializedAt,
      "2026-10-01T00:00:00.000Z",
    );
    raw(target, (db) =>
      assert.equal(
        db
          .prepare("SELECT COUNT(*) AS n FROM catalog_product_availability")
          .get()!.n,
        0,
      ),
    );
    const app = new Application(target, "CA", {
      eventReports: profile.eventReports,
    });
    app.close();
    assert.deepEqual(readFileSync(source), bytes);
  });
