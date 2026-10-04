import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { SCHEMA_VERSION, schemaFingerprint } from "../src/server/schema.ts";
import { INTEGRATION_OFFLINE_REFUND_SCHEMA } from "../src/server/integration-offline-refund-schema.ts";
import { fixture } from "./fixtures.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";

const table = "integration_offline_failed_refunds";
// Captured from published bb0a2b2e before changing the schema, independently of
// the current profile under test. Removing all later additions must match.
const v18 = {
  enabled: "18310a051c7e1d3e278e11251cd1cdc417517148e61aa45a42d39fab96cd07b8",
  disabled: "66885390969e98b27ea19044f4e7b3cc399518fb50c9196962d2293f4569d942",
};
function raw<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function rows(path: string) {
  return raw(path, (db) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .filter(
          (r) =>
            r.name !== "platform_schema_version" &&
            r.name !== table &&
            r.name !== "integration_offline_original_cancellations" &&
            r.name !== "integration_offline_canada_post_members",
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
  );
}
function previous(source: string, target: string, reports: boolean) {
  raw(source, (db) => db.prepare("VACUUM INTO ?").run(target));
  raw(target, (db) => {
    db.exec("DROP TABLE integration_offline_canada_post_members");
    db.exec("DROP TABLE integration_offline_original_cancellations");
    db.exec(`DROP TABLE ${table}`);
    const expected = reports ? v18.enabled : v18.disabled;
    assert.equal(schemaFingerprint(db), expected);
    db.prepare(
      "UPDATE platform_schema_version SET version=18,schema_hash=?",
    ).run(expected);
  });
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`schema18 ${region}/${currency}/${reports} explicitly upgrades into empty immutable provenance without changing source or business rows`, async (t) => {
      const f = fixture(t, { eventReports: reports }, region, currency);
      const source = join(dirname(f.path), "previous.db"),
        destination = join(dirname(f.path), "upgraded.db");
      previous(f.path, source, reports);
      const inspected = inspectSchema(source),
        bytes = readFileSync(source),
        before = rows(source);
      assert.equal(inspected.version, 18);
      assert.equal(inspected.kind, "previous");
      assert.throws(
        () => new Application(source, region, { eventReports: reports }),
        { code: "SCHEMA_UPGRADE_REQUIRED" },
      );
      assert.deepEqual(readFileSync(source), bytes);
      const receipt = await upgradeSchema(
        source,
        destination,
        inspected.schemaHash,
        region,
      );
      assert.equal(receipt.sourceVersion, 18);
      assert.equal(receipt.version, SCHEMA_VERSION);
      assert.equal(inspectSchema(destination).kind, "current");
      assert.equal(
        inspectSchema(destination).initializedAt,
        inspected.initializedAt,
      );
      assert.deepEqual(rows(destination), before);
      assert.deepEqual(
        raw(destination, (db) => db.prepare(`SELECT * FROM ${table}`).all()),
        [],
      );
      assert.deepEqual(readFileSync(source), bytes);
      assert.deepEqual(inspectSchema(source), inspected);
      const app = new Application(destination, region, {
        eventReports: reports,
      });
      try {
        assert.equal(app.identity.currentActor(f.actor).orgId, f.actor.orgId);
        assert.equal(
          app.database
            .owned("integration")
            .get(`SELECT count(*) AS n FROM ${table}`)?.n,
          0,
        );
      } finally {
        app.close();
      }
      assert.deepEqual(rows(destination), before);
    });

function storage(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    store = f.app.database.owned("integration");
  store.run(
    "INSERT INTO integration_effects VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "effect-a",
    f.actor.orgId,
    f.buyer,
    "stripe",
    "refund",
    "refund-a",
    "{}",
    "unknown",
    null,
    null,
    "2026-10-03T00:00:00.000Z",
    1,
    1,
    null,
  );
  const record = canonical({
    version: 1,
    originalPoll: {
      token: "synthetic-retired-token",
      started_at: 1,
      retry_at: 0,
    },
    observationId: 1,
  });
  const insert = () =>
    store.run(
      `INSERT INTO ${table} VALUES(?,?,?,?,?,?)`,
      "effect-a",
      f.actor.orgId,
      "request-a",
      digest("synthetic-binding"),
      record,
      digest(record),
    );
  const read = () => store.all(`SELECT * FROM ${table}`);
  return { ...f, store, record, insert, read };
}
test("Integration provenance rejects UPDATE, DELETE and implicit REPLACE deletion with original bytes retained", (t) => {
  const s = storage(t);
  s.insert();
  const before = s.read();
  for (const sql of [
    `UPDATE ${table} SET record='replacement'`,
    `DELETE FROM ${table}`,
    `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`,
  ]) {
    assert.throws(() => s.store.run(sql), /append-only/);
    assert.deepEqual(s.read(), before);
  }
  const app = new Application(s.path);
  try {
    assert.deepEqual(
      app.database.owned("integration").all(`SELECT * FROM ${table}`),
      before,
    );
    assert.throws(
      () =>
        app.database
          .owned("integration")
          .run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
      /append-only/,
    );
  } finally {
    app.close();
  }
  assert.deepEqual(s.read(), before);
});
test("provenance has unique native effect, request and binding identities, a same-owner foreign key and UTF8 bounds", (t) => {
  const s = storage(t);
  s.insert();
  const before = s.read();
  assert.throws(s.insert);
  assert.throws(
    () =>
      s.store.run(
        `INSERT INTO ${table} VALUES(?,?,?,?,?,?)`,
        "missing-effect",
        s.actor.orgId,
        "request-b",
        digest("binding-b"),
        "{}",
        digest("{}"),
      ),
    /FOREIGN KEY/,
  );
  s.store.run(
    "INSERT INTO integration_effects SELECT 'effect-b',org_id,account_id,provider,kind,'refund-b',payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id='effect-a'",
  );
  for (const [request, binding, record, hash] of [
    ["request-a", digest("binding-b"), "{}", digest("{}")],
    ["request-b", digest("synthetic-binding"), "{}", digest("{}")],
    ["request-b", digest("binding-b"), "é".repeat(32769), digest("oversized")],
    ["request-b", digest("binding-b"), "", digest("")],
    ["request-b", digest("binding-b"), "{}", "short"],
  ]) {
    assert.throws(() =>
      s.store.run(
        `INSERT INTO ${table} VALUES(?,?,?,?,?,?)`,
        "effect-b",
        s.actor.orgId,
        request!,
        binding!,
        record!,
        hash!,
      ),
    );
    assert.deepEqual(s.read(), before);
  }
});
test("foreign native owners cannot read, insert, alter or remove Integration provenance", (t) => {
  const s = storage(t);
  s.insert();
  const before = s.read();
  for (const owner of ["billing", "platform", "inventory"] as const) {
    const store = s.app.database.owned(owner);
    assert.throws(() => store.all(`SELECT * FROM ${table}`));
    assert.throws(() =>
      store.run(`INSERT INTO ${table} SELECT * FROM ${table}`),
    );
    assert.throws(() => store.run(`DELETE FROM ${table}`));
    assert.throws(() => store.migrate(`DROP TABLE ${table}`));
  }
  assert.deepEqual(s.read(), before);
});
test("rollback restores both mutable poll claim and immutable before-claim receipt atomically", (t) => {
  const s = storage(t);
  s.store.run(
    "INSERT INTO integration_refund_polls VALUES(?,?,?,?,?)",
    "effect-a",
    s.actor.orgId,
    "synthetic-retired-token",
    1,
    0,
  );
  const before = rows(s.path);
  assert.throws(
    () =>
      s.app.database.transaction(() => {
        s.insert();
        s.store.run(
          "UPDATE integration_refund_polls SET token=NULL,started_at=NULL WHERE effect_id='effect-a'",
        );
        throw Error("synthetic precommit failure");
      }),
    /precommit failure/,
  );
  assert.deepEqual(s.read(), []);
  assert.deepEqual(rows(s.path), before);
  s.app.database.transaction(() => {
    s.insert();
    s.store.run(
      "UPDATE integration_refund_polls SET token=NULL,started_at=NULL WHERE effect_id='effect-a'",
    );
  });
  assert.equal(s.read()[0]?.record, s.record);
  assert.equal(
    s.store.get(
      "SELECT token FROM integration_refund_polls WHERE effect_id='effect-a'",
    )?.token,
    null,
  );
});
test("retained provenance participates in the actual writer candidate fingerprint", (t) => {
  const s = storage(t);
  chmodSync(s.path, 0o600);
  s.app.database.transaction(() =>
    s.app.platform.isolateRestore(
      digest("synthetic-snapshot"),
      "2026-10-01T00:00:00.000Z",
    ),
  );
  const capture = () =>
    s.app.database.transaction(() =>
      s.app.database.captureRestoreCandidateInTransaction(),
    );
  const before = capture();
  s.insert();
  const after = capture();
  assert.notEqual(after.logicalHash, before.logicalHash);
  assert.equal(after.schemaHash, before.schemaHash);
  assert.equal(after.snapshotHash, before.snapshotHash);
});
test("exact schema identity detects missing append-only guard before initialization mutates anything", (t) => {
  const f = fixture(t),
    source = join(dirname(f.path), "drift.db");
  raw(f.path, (db) => db.prepare("VACUUM INTO ?").run(source));
  raw(source, (db) =>
    db.exec(`DROP TRIGGER ${INTEGRATION_OFFLINE_REFUND_SCHEMA[1]!.name}`),
  );
  const bytes = readFileSync(source);
  assert.throws(() => new Application(source), { code: "SCHEMA_DRIFT" });
  assert.deepEqual(readFileSync(source), bytes);
});
test("current encrypted isolated recovery conserves nonempty provenance and its append-only guards", async (t) => {
  const s = storage(t);
  s.insert();
  const before = s.read();
  const archive = join(dirname(s.path), "provenance.backup"),
    destination = join(dirname(s.path), "restored-provenance.db"),
    key = randomBytes(32);
  const backup = await createBackup(s.path, archive, "CA", key);
  const restored = await restoreBackup(archive, destination, "CA", key);
  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  const app = new Application(destination, "CA");
  try {
    const store = app.database.owned("integration");
    assert.deepEqual(store.all(`SELECT * FROM ${table}`), before);
    assert(app.platform.recoveryHold());
    assert.throws(() => store.run(`DELETE FROM ${table}`), /append-only/);
    assert.throws(
      () => store.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
      /append-only/,
    );
    assert.deepEqual(store.all(`SELECT * FROM ${table}`), before);
  } finally {
    app.close();
  }
  assert.deepEqual(s.read(), before);
});
