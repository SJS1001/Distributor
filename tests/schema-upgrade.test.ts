import versionSix from "./schema-version-six.json" with { type: "json" };
import versionFive from "./schema-version-five.json" with { type: "json" };
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/server/application.ts";
import { Database, Store } from "../src/server/database.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { fixture, accept, ship } from "./fixtures.ts";
import baseline from "../src/server/schema-baseline.json" with { type: "json" };

import versionTwo from "./schema-version-two.json" with { type: "json" };
import versionFour from "./schema-version-four.json" with { type: "json" };
import versionThree from "./schema-version-three.json" with { type: "json" };

const metadata = "platform_schema_version";
// Independent historical DDL and literal fingerprints; do not derive this fixture
// from the new schema inspector or current module constructors.
const versionOneDDL =
  "CREATE TABLE platform_schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,schema_hash TEXT NOT NULL,event_reports INTEGER NOT NULL CHECK(event_reports IN(0,1)),region TEXT NOT NULL CHECK(region IN('CA','US')),initialized_at TEXT NOT NULL) STRICT";
const versionOneHashes = {
  enabled: "3f71c82beebdec3b77f73b1fd42a1b40fda31d068411fca007ff304272260df6",
  disabled: "3211e34356f19967e025451a7299201e274cdc4a3cf15ccc8a5a892d94301221",
};
function frozenVersionOne(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  const rows = snapshot(source);
  const profile = baseline.schemas.find(
    (p) => p.eventReports === eventReports,
  )!;
  raw(destination, (db) => {
    // Reconstruct rows in manifest order while checking all references at commit.
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of profile.schema.filter((o) => o.type === "table"))
      db.exec(object.sql!);
    for (const object of profile.schema.filter((o) => o.type === "table")) {
      const records = rows[object.name]!;
      for (const record of records) {
        const columns = Object.keys(record),
          quoted = columns.map((name) => `"${name.replaceAll('"', '""')}"`);
        db.prepare(
          `INSERT INTO "${object.name}" (${quoted.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((name) => record[name]!));
      }
    }
    for (const object of profile.schema.filter((o) => o.type !== "table"))
      db.exec(object.sql!);
    db.exec(versionOneDDL);
    db.prepare("INSERT INTO platform_schema_version VALUES(1,1,?,?,?,?)").run(
      eventReports ? versionOneHashes.enabled : versionOneHashes.disabled,
      Number(eventReports),
      region,
      "2026-09-30T12:34:56.000Z",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionTwo(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionOne(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionTwo.additions) {
      db.exec(object.sql);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((name) => `"${name}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((name) => record[name]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=2,schema_hash=?",
    ).run(
      eventReports ? versionTwo.hashes.enabled : versionTwo.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionThree(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionTwo(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionThree.additions.filter((entry) => entry.type === "table"),
      ...versionThree.additions.filter((entry) => entry.type !== "table"),
    ]) {
      db.exec(object.sql!);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=3,schema_hash=?",
    ).run(
      eventReports ? versionThree.hashes.enabled : versionThree.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFour(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionThree(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionFour.additions) {
      db.exec(object.sql!);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=4,schema_hash=?",
    ).run(
      eventReports ? versionFour.hashes.enabled : versionFour.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFive(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFour(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionFive.additions) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=5,schema_hash=?",
    ).run(
      eventReports ? versionFive.hashes.enabled : versionFive.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionSix(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFive(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionSix.additions) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=6,schema_hash=?",
    ).run(
      eventReports ? versionSix.hashes.enabled : versionSix.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function directory(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), "distributor-schema-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function raw<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function schema(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .all();
}
function hash(path: string) {
  return raw(path, (db) =>
    createHash("sha256")
      .update(JSON.stringify(schema(db)))
      .digest("hex"),
  );
}
function snapshot(path: string) {
  return raw(path, (db) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .filter((r) => r.name !== metadata)
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
function legacy(path: string) {
  raw(path, (db) =>
    db.exec(
      `DROP TABLE procurement_supplier_changes; DROP TABLE fulfillment_coverage; DROP TABLE warranty_claim_coverage; DROP TABLE integration_credit_cancellations; DROP TABLE integration_credential_revocations; DROP TABLE integration_canada_post_members; DROP TABLE integration_canada_post_groups; DROP TABLE ${metadata}`,
    ),
  );
}
function conservedUpgrade(
  path: string,
  before: ReturnType<typeof snapshot>,
  sourceVersion = 1,
) {
  const after = snapshot(path);
  for (const name of [
    "integration_canada_post_groups",
    "integration_canada_post_members",
    "integration_credential_revocations",
    "integration_credit_cancellations",
    "warranty_claim_coverage",
    "fulfillment_coverage",
    "procurement_supplier_changes",
  ]) {
    if (sourceVersion >= 2 && name.startsWith("integration_canada_post"))
      continue;
    if (sourceVersion >= 3 && name === "integration_credential_revocations")
      continue;
    if (sourceVersion >= 4 && name === "integration_credit_cancellations")
      continue;
    if (sourceVersion >= 5 && name === "warranty_claim_coverage") continue;
    if (sourceVersion >= 6 && name === "fulfillment_coverage") continue;
    assert.deepEqual(
      after[name],
      [],
      "upgrade must add only empty group storage",
    );
    delete after[name];
  }
  assert.deepEqual(after, before);
}
function child(t: { after: (fn: () => void) => void }) {
  const c = fork(new URL("./schema-upgrade-child.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  c.stderr?.on("data", (data) => (stderr += String(data)));
  t.after(() => c.kill());
  return { c, stderr: () => stderr };
}
function reply(c: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("Child IPC deadline exceeded"));
    }, 20000);
    const message = (m: unknown) => {
      cleanup();
      resolve(m);
    };
    const exit = (code: number | null) => {
      cleanup();
      reject(Error(`Child exited before IPC: ${code}`));
    };
    function cleanup() {
      clearTimeout(timer);
      c.off("message", message);
      c.off("exit", exit);
    }
    c.once("message", message);
    c.once("exit", exit);
  });
}

test("blank initialization publishes one version receipt atomically; restart preserves its bytes", (t) => {
  const path = join(directory(t), "fresh.db");
  const app = new Application(path);
  app.close();
  const receipt = raw(path, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  assert.equal(receipt.length, 1);
  const before = hash(path);
  const restarted = new Application(path);
  restarted.close();
  assert.equal(hash(path), before);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
  assert.doesNotThrow(() => inspectSchema(path));
});

for (const sourceVersion of [1, 2, 3, 4, 5, 6])
  for (const region of ["CA", "US"] as const)
    for (const eventReports of [false, true])
      test(`independent version-${sourceVersion} ${region}/${eventReports} fixture requires explicit upgrade and preserves native records, sessions and ciphertext`, async (t) => {
        const security = {
          eventReports,
          providerEncryptionKey: "ab".repeat(32),
        };
        const f = fixture(t, security, region);
        const nativeShipment = ship(f, accept(f).id);
        const invoice = nativeShipment.invoiceId;
        // Versions before six could not retain shipment policy.
        if (sourceVersion < 6)
          f.app.database
            .owned("fulfillment")
            .run(
              "DELETE FROM fulfillment_coverage WHERE shipment_id=?",
              nativeShipment.id,
            );
        const historicalClaim = f.app.warranty.submit(
          f.actor,
          "historical-claim",
          {
            accountId: f.buyer,
            unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
            type: "warranty",
            issue: "Synthetic historical warranty",
            evidence: "Synthetic frozen previous-version evidence",
          },
        );
        const session = f.app.identity.login(
          "admin@example.test",
          "long-test-only-password",
        );
        const binding = {
          id: "synthetic-v1-binding",
          orgId: f.actor.orgId,
          workerUserId: f.actor.id,
          realm: "1234",
          clientId: "synthetic-v1-client",
        };
        f.app.providerCredentials.install(binding, 0, {
          accessToken: "synthetic-v1-access",
          refreshToken: "synthetic-v1-refresh",
          accessExpiresAt: Date.now() + 3600000,
          refreshExpiresAt: Date.now() + 86400000,
        });
        const dir = directory(t),
          source = join(dir, `v${sourceVersion}.db`),
          destination = join(dir, "v7.db");
        if (sourceVersion >= 2) {
          // Retain a locally prepared group, without claiming a provider response.
          f.app.database
            .owned("integration")
            .run(
              "INSERT INTO integration_canada_post_groups VALUES(?,?,?,?,?,?,'prepared',NULL,NULL,NULL,NULL,NULL,?)",
              "synthetic-retained-group",
              f.actor.orgId,
              f.w1,
              "a".repeat(64),
              "synthetic-group",
              "b".repeat(64),
              "2026-09-30T12:34:56.000Z",
            );
        }
        if (sourceVersion >= 3) {
          f.app.database
            .owned("integration")
            .run(
              "INSERT INTO integration_credential_revocations VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,?)",
              "synthetic-retained-revocation",
              f.actor.orgId,
              binding.id,
              f.actor.id,
              f.buyer,
              binding.realm,
              binding.clientId,
              1,
              2,
              1,
              "unknown",
              1790812800000,
              "Synthetic retained operator evidence",
            );
        }
        (sourceVersion === 1
          ? frozenVersionOne
          : sourceVersion === 2
            ? frozenVersionTwo
            : sourceVersion === 3
              ? frozenVersionThree
              : sourceVersion === 4
                ? frozenVersionFour
                : sourceVersion === 5
                  ? frozenVersionFive
                  : frozenVersionSix)(f.path, source, eventReports, region);
        const before = snapshot(source),
          receipt = inspectSchema(source),
          sourceBytes = readFileSync(source);
        assert.equal(receipt.kind, "previous");
        assert.equal(receipt.version, sourceVersion);
        assert.equal(
          receipt.schemaHash,
          eventReports
            ? (sourceVersion === 1
                ? versionOneHashes
                : sourceVersion === 2
                  ? versionTwo.hashes
                  : sourceVersion === 3
                    ? versionThree.hashes
                    : sourceVersion === 4
                      ? versionFour.hashes
                      : sourceVersion === 5
                        ? versionFive.hashes
                        : versionSix.hashes
              ).enabled
            : (sourceVersion === 1
                ? versionOneHashes
                : sourceVersion === 2
                  ? versionTwo.hashes
                  : sourceVersion === 3
                    ? versionThree.hashes
                    : sourceVersion === 4
                      ? versionFour.hashes
                      : sourceVersion === 5
                        ? versionFive.hashes
                        : versionSix.hashes
              ).disabled,
        );
        let constructors = 0;
        const original = Store.prototype.migrate;
        const mock = t.mock.method(
          Store.prototype,
          "migrate",
          function (this: Store, sql: string) {
            constructors++;
            return original.call(this, sql);
          },
        );
        assert.throws(() => new Application(source, region, security), {
          code: "SCHEMA_UPGRADE_REQUIRED",
        });
        mock.mock.restore();
        assert.equal(
          constructors,
          0,
          "previous stores reject before any module constructor writes",
        );
        const upgraded = await upgradeSchema(
          source,
          destination,
          receipt.schemaHash,
          region,
        );
        assert.equal(upgraded.sourceVersion, sourceVersion);
        assert.equal(upgraded.version, 7);
        const inspection = inspectSchema(destination);
        assert.equal(inspection.kind, "current");
        assert.equal(inspection.version, 7);
        assert.equal(inspection.initializedAt, receipt.initializedAt);
        assert.equal(inspection.eventReports, eventReports);
        conservedUpgrade(destination, before, sourceVersion);
        assert.deepEqual(readFileSync(source), sourceBytes);
        assert.deepEqual(inspectSchema(source), receipt);
        const clone = new Application(destination, region, security);
        try {
          assert.deepEqual(
            clone.fulfillment.shipmentCoverage(f.actor, nativeShipment.id),
            sourceVersion >= 6
              ? f.app.fulfillment.shipmentCoverage(f.actor, nativeShipment.id)
              : null,
          );
          assert.equal(
            clone.warranty.coverage(
              f.actor,
              f.app.inventory.trace(f.actor, "S1").unit.id,
              f.buyer,
            ).source,
            sourceVersion >= 6
              ? "shipment_policy"
              : "current_provisional_policy",
          );
          assert.deepEqual(
            clone.warranty.claimCoverage(f.actor, historicalClaim.id),
            sourceVersion >= 5
              ? f.app.warranty.claimCoverage(f.actor, historicalClaim.id)
              : {
                  claimId: historicalClaim.id,
                  coverageEnd: historicalClaim.coverageEnd,
                  snapshot: null,
                  coveragePolicyApproved: false,
                  eligibility: "requires_review",
                },
          );
          assert.deepEqual(
            clone.identity.session(session.token),
            f.app.identity.session(session.token),
          );
          assert.deepEqual(
            clone.providerCredentials.status(binding),
            f.app.providerCredentials.status(binding),
          );
          assert.equal(clone.billing.invoices(f.actor)[0]!.id, invoice);
          assert.deepEqual(
            clone.inventory.stock(f.actor),
            f.app.inventory.stock(f.actor),
          );
        } finally {
          clone.close();
        }
        conservedUpgrade(destination, before, sourceVersion);
      });

test("version-one receipt lies and partial new schema reject without mutation or publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=2"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    ["region", "UPDATE platform_schema_version SET region='US'"],
    [
      "partial",
      "CREATE TABLE integration_canada_post_groups(id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `${name}.db`),
      destination = join(dir, `${name}-dest.db`);
    frozenVersionOne(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const before = snapshot(source),
      sourceBytes = readFileSync(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(snapshot(source), before);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-two receipt lies and partial revocation schema reject without changing the source or publishing a clone", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=3"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE integration_credential_revocations(id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `${name}.db`),
      destination = join(dir, `${name}-destination.db`);
    frozenVersionTwo(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const sourceBytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-three receipt lies and partial cancellation schema reject without changing the source or publishing a clone", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=4"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE integration_credit_cancellations(effect_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `v3-${name}.db`),
      destination = join(dir, `v3-${name}-destination.db`);
    frozenVersionThree(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const sourceBytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-five receipt lies and partial shipment coverage schema reject unchanged without publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=6"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE fulfillment_coverage(shipment_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `v5-${name}.db`),
      destination = join(dir, `v5-${name}-destination.db`);
    frozenVersionFive(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const bytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), bytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("late migration failure rolls back every DDL and receipt and releases the lock for retry", (t) => {
  const path = join(directory(t), "failed.db"),
    original = Store.prototype.migrate;
  let injected = false;
  const mock = t.mock.method(
    Store.prototype,
    "migrate",
    function (this: Store, sql: string) {
      original.call(this, sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS report_events")) {
        injected = true;
        assert.ok(
          this.all(
            "SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
          ).length >= 150,
          "failure must occur after the late schema DDL",
        );
        throw Error("Synthetic late initialization failure");
      }
    },
  );
  assert.throws(
    () => new Application(path),
    /Synthetic late initialization failure/,
  );
  mock.mock.restore();
  assert.equal(injected, true);
  assert.deepEqual(raw(path, schema), []);
  const retry = new Application(path);
  retry.close();
  assert.equal(
    raw(path, (db) =>
      db.prepare(`SELECT count(*) AS n FROM ${metadata}`).get(),
    )!.n,
    1,
  );
});

test("OS kill at the late initialization IPC barrier leaves no partial schema or receipt and permits restart", async (t) => {
  const path = join(directory(t), "killed.db"),
    { c, stderr } = child(t);
  const paused = reply(c);
  c.send({ action: "kill-init", path });
  const barrier = await paused;
  assert.equal(barrier.paused, true, stderr());
  assert.ok(
    barrier.objects >= 150,
    "kill must occur after late uncommitted DDL",
  );
  const exited = new Promise((resolve) => c.once("exit", resolve));
  c.kill("SIGKILL");
  await exited;
  assert.deepEqual(raw(path, schema), []);
  const app = new Application(path);
  app.close();
  assert.doesNotThrow(() => inspectSchema(path));
});

test("startup fails closed on unversioned, damaged, unknown and future schemas without repair", (t) => {
  const dir = directory(t);
  for (const [name, damage] of [
    ["unversioned", `DROP TABLE ${metadata}`],
    ["drift", "DROP TABLE report_events"],
    ["unknown", "CREATE TABLE unrelated_secret(value TEXT)"],
    ["hidden-name", "CREATE TABLE sqliteXprivate(value TEXT)"],
    ["missing-metadata", `DELETE FROM ${metadata}`],
  ]) {
    const path = join(dir, `${name}.db`),
      app = new Application(path);
    app.close();
    // Choose an actual owned table rather than assuming report storage spelling.
    raw(path, (db) =>
      db.exec(
        name === "drift"
          ? `DROP TABLE ${String(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'report_%' LIMIT 1").get()!.name)}`
          : damage!,
      ),
    );
    const before = hash(path),
      data = snapshot(path);
    assert.throws(() => new Application(path), name);
    assert.equal(hash(path), before);
    assert.deepEqual(snapshot(path), data);
  }
  const path = join(dir, "future.db"),
    app = new Application(path);
  app.close();
  raw(path, (db) => {
    const columns = db.prepare(`PRAGMA table_info(${metadata})`).all();
    const version = columns.find((c) => /version/.test(String(c.name)))!;
    db.prepare(`UPDATE ${metadata} SET "${version.name}"=999`).run();
  });
  const before = hash(path),
    receipt = raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all());
  assert.throws(() => new Application(path));
  assert.equal(hash(path), before);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
});

test("outer rollback and async callbacks preserve atomicity; owned transaction bypass fails closed", (t) => {
  const db = new Database(join(directory(t), "transactions.db"));
  t.after(() => db.close());
  const store = db.owned("platform");
  assert.throws(
    () =>
      db.transaction(() => {
        store.migrate("CREATE TABLE platform_synthetic(id INTEGER)");
        store.run("INSERT INTO platform_synthetic VALUES(1)");
        throw Error("outer failure");
      }),
    /outer failure/,
  );
  assert.equal(raw(db.path, schema).length, 0);
  assert.throws(() => db.transaction(() => Promise.resolve()), /Async/);
  for (const sql of ["COMMIT", "ROLLBACK", "BEGIN", "SAVEPOINT bypass"])
    assert.throws(
      () => db.transaction(() => store.migrate(sql)),
      /authorized|prohibited/,
    );
  db.transaction(() =>
    store.migrate("CREATE TABLE platform_retry(id INTEGER)"),
  );
});

test("reviewed previous baseline clone preserves all business rows, committed WAL, money, receipts, sessions and audit cursors; repeat source remains unchanged", async (t) => {
  const security = { providerEncryptionKey: "ab".repeat(32) };
  const f = fixture(t, security),
    invoice = ship(f, accept(f).id).invoiceId;
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const binding = {
    id: "synthetic-upgrade-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-upgrade-client",
  };
  f.app.providerCredentials.install(binding, 0, {
    accessToken: "synthetic-upgrade-access",
    refreshToken: "synthetic-upgrade-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  });
  for (let i = 0; i < 45; i++)
    f.app.platform.audit(f.actor, "SyntheticUpgradeAudit", `audit-${i}`, { i });
  const cursor = f.app.platform.auditPage(f.actor).next;
  assert.ok(cursor);
  const value = f.app.inventory
    .stock(f.actor)
    .reduce((sum, unit) => sum + unit.cost * unit.quantity, 0);
  // Keep the application connection open: committed business writes remain in WAL.
  legacy(f.path);
  assert.ok(existsSync(f.path + "-wal"));
  assert.ok(statSync(f.path + "-wal").size > 32);
  const sourceSchema = hash(f.path),
    before = snapshot(f.path);
  assert.equal(
    sourceSchema,
    "2f59fa00cb3465911850fd224e4f4f5ad1d5874ff9f56fc1058fe787bc3c3157",
    "source must match the frozen previous release profile",
  );
  const sourceBytes = readFileSync(f.path),
    walBytes = readFileSync(f.path + "-wal");
  const dest = join(directory(t), "upgraded.db");
  assert.doesNotThrow(() => inspectSchema(f.path));
  await upgradeSchema(f.path, dest, sourceSchema, "CA");
  conservedUpgrade(dest, before);
  assert.equal(hash(f.path), sourceSchema);
  assert.deepEqual(snapshot(f.path), before);
  assert.deepEqual(readFileSync(f.path), sourceBytes);
  assert.deepEqual(readFileSync(f.path + "-wal"), walBytes);
  assert.equal(statSync(dest).mode & 0o777, 0o600);
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(dest + suffix))
      assert.equal(statSync(dest + suffix).mode & 0o777, 0o600);
  const upgraded = new Application(dest, "CA", security);
  try {
    assert.deepEqual(
      upgraded.identity.session(session.token),
      f.app.identity.session(session.token),
    );
    assert.deepEqual(
      upgraded.providerCredentials.status(binding),
      f.app.providerCredentials.status(binding),
    );
    assert.equal(upgraded.billing.invoices(f.actor)[0]!.id, invoice);
    assert.equal(
      upgraded.inventory
        .stock(f.actor)
        .reduce((sum, unit) => sum + unit.cost * unit.quantity, 0),
      value,
    );
    if (cursor)
      assert.deepEqual(
        upgraded.platform.auditPage(f.actor, cursor),
        f.app.platform.auditPage(f.actor, cursor),
      );
  } finally {
    upgraded.close();
  }
  const repeat = join(directory(t), "repeat.db");
  await upgradeSchema(f.path, repeat, sourceSchema, "CA");
  conservedUpgrade(repeat, before);
  const current = join(directory(t), "current.db");
  const receipt = raw(dest, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  await upgradeSchema(dest, current, hash(dest), "CA");
  assert.deepEqual(snapshot(current), snapshot(dest));
  assert.deepEqual(
    raw(current, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
});

test("eventReports false/true/false transitions preserve stored projection data and restart receipt", (t) => {
  const path = join(directory(t), "reports.db");
  let app = new Application(path, "CA", { eventReports: false });
  app.close();
  app = new Application(path, "CA", { eventReports: true });
  const actor = app.identity.bootstrap(
    "Synthetic reports",
    "report@example.test",
    "long-test-only-password",
    "CAD",
  );
  app.inventory.createWarehouse(actor, "warehouse", {
    name: "Synthetic report warehouse",
  });
  app.database.transaction(() =>
    app.platform.event(actor, "SyntheticUpgradeFact", "report-data", {
      count: 1,
    }),
  );
  assert.equal(
    app.eventDelivery.tick("event-report", { enabled: true }).completed,
    1,
  );
  app.close();
  const rows = snapshot(path),
    reports = Object.fromEntries(
      Object.entries(rows).filter(([name]) => name.startsWith("report_")),
    );
  assert.ok(
    Object.values(reports).some((value) => (value as unknown[]).length > 0),
  );
  const receipt = raw(path, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  app = new Application(path, "CA", { eventReports: false });
  app.close();
  assert.deepEqual(snapshot(path), rows);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
  app = new Application(path, "CA", { eventReports: true });
  app.close();
  assert.deepEqual(snapshot(path), rows);
});

test("upgrade rejects changed hash, region mismatch, unknown schema and malformed metadata with no destination or staging leftovers", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  f.app.close();
  const before = snapshot(f.path),
    fingerprint = hash(f.path);
  for (const [name, expected, region] of [
    ["hash", "0".repeat(64), "CA"],
    ["region", fingerprint, "US"],
  ] as const) {
    await assert.rejects(
      upgradeSchema(f.path, join(dir, name + ".db"), expected, region),
    );
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(snapshot(f.path), before);
    assert.equal(hash(f.path), fingerprint);
  }
  for (const [name, sql] of [
    ["unknown", "CREATE TABLE foreign_private(payload TEXT)"],
    ["malformed", `DELETE FROM ${metadata}`],
  ] as const) {
    const source = join(dir, name + ".db");
    // Use an approved clone to prepare a synthetic rejection source.
    await upgradeSchema(f.path, source, fingerprint, "CA");
    raw(source, (db) => db.exec(sql));
    const schemaBefore = hash(source),
      dataBefore = snapshot(source);
    const filesBefore = readdirSync(dir);
    assert.throws(() => inspectSchema(source));
    await assert.rejects(
      upgradeSchema(source, join(dir, name + "-dest.db"), schemaBefore, "CA"),
    );
    assert.deepEqual(readdirSync(dir), filesBefore);
    assert.equal(hash(source), schemaBefore);
    assert.deepEqual(snapshot(source), dataBefore);
  }
  // fixture owns closing; replace the already closed connection with a supported restart.
  f.app = new Application(f.path);
});

test("existing destination, orphan sidecars and symlinks fail without clobbering bytes", async (t) => {
  const f = fixture(t),
    dir = directory(t),
    fingerprint = hash(f.path);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const dest = join(dir, `exists${suffix || "-main"}.db`),
      obstacle = dest + suffix;
    writeFileSync(obstacle, "synthetic private obstacle");
    await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"));
    assert.equal(readFileSync(obstacle, "utf8"), "synthetic private obstacle");
    if (suffix) assert.equal(existsSync(dest), false);
  }
  const target = join(dir, "target"),
    dest = join(dir, "symlink.db");
  writeFileSync(target, "synthetic symlink target");
  symlinkSync(target, dest);
  await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"));
  assert.equal(readFileSync(target, "utf8"), "synthetic symlink target");
  const linkedSource = join(dir, "source-link.db");
  symlinkSync(f.path, linkedSource);
  await assert.rejects(
    upgradeSchema(
      linkedSource,
      join(dir, "source-link-dest.db"),
      fingerprint,
      "CA",
    ),
  );
  assert.equal(existsSync(join(dir, "source-link-dest.db")), false);
});

test("IPC-released independent clone publishers produce exactly one destination and one success", async (t) => {
  const f = fixture(t),
    dir = directory(t),
    destination = join(dir, "winner.db"),
    source = f.path,
    fingerprint = hash(source),
    before = snapshot(source);
  const children = [child(t), child(t)];
  const ready = children.map(({ c }) => {
    const p = reply(c);
    c.send({ action: "ready" });
    return p;
  });
  assert.ok((await Promise.all(ready)).every((r) => r.ready));
  const outcomes = children.map(({ c }) => {
    const p = reply(c);
    c.send({ action: "upgrade", source, destination, hash: fingerprint });
    return p;
  });
  const result = await Promise.all(outcomes);
  assert.equal(result.filter((r) => r.ok).length, 1, JSON.stringify(result));
  assert.equal(result.filter((r) => !r.ok).length, 1);
  assert.deepEqual(snapshot(destination), before);
  assert.deepEqual(snapshot(source), before);
  assert.deepEqual(
    readdirSync(dir).filter((name) => !name.startsWith("winner.db")),
    [],
  );
});

test("schema CLI help/inspect succeed, malformed usage fails and private paths stay redacted", (t) => {
  const f = fixture(t);
  function cli(args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/schema-cli.ts", ...args],
      { encoding: "utf8" },
    );
  }
  const help = cli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  const inspected = cli(["inspect", f.path]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.doesNotThrow(() => JSON.parse(inspected.stdout));
  for (const args of [[], ["upgrade"], ["inspect", f.path, "extra"]])
    assert.notEqual(cli(args).status, 0);
  const privatePath = join(directory(t), "private-customer-secret.db"),
    failed = cli(["inspect", privatePath]);
  assert.notEqual(failed.status, 0);
  assert.equal((failed.stdout + failed.stderr).includes(privatePath), false);
  assert.equal(existsSync(privatePath), false);
});

test("version receipt lies and malformed receipt schema are rejected unchanged by startup and clone inspection", async (t) => {
  const dir = directory(t);
  for (const [name, sql] of [
    ["hash", `UPDATE ${metadata} SET schema_hash='${"0".repeat(64)}'`],
    ["profile", `UPDATE ${metadata} SET event_reports=0`],
    ["timestamp", `UPDATE ${metadata} SET initialized_at='not-a-date'`],
    [
      "impossible-day",
      `UPDATE ${metadata} SET initialized_at='2026-02-30T12:00:00.000Z'`,
    ],
    [
      "invalid-leap-day",
      `UPDATE ${metadata} SET initialized_at='2025-02-29T12:00:00.000Z'`,
    ],
    ["receipt-region", `UPDATE ${metadata} SET region='US'`],
    ["receipt-schema", `ALTER TABLE ${metadata} ADD COLUMN unexpected TEXT`],
  ]) {
    const source = join(dir, name + ".db"),
      app = new Application(source);
    app.identity.bootstrap(
      "Synthetic metadata",
      "metadata@example.test",
      "long-test-only-password",
      "CAD",
    );
    app.close();
    raw(source, (db) => db.exec(sql!));
    const fingerprint = hash(source),
      before = snapshot(source),
      receipt = raw(source, (db) =>
        db.prepare(`SELECT * FROM ${metadata}`).all(),
      );
    assert.throws(() => new Application(source), name);
    assert.throws(() => inspectSchema(source), name);
    const dest = join(dir, name + "-dest.db");
    await assert.rejects(upgradeSchema(source, dest, fingerprint, "CA"));
    assert.equal(existsSync(dest), false);
    assert.equal(hash(source), fingerprint);
    assert.deepEqual(snapshot(source), before);
    assert.deepEqual(
      raw(source, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
      receipt,
    );
    assert.equal(
      readdirSync(dir).some((n) => n.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("frozen reports-disabled previous profile upgrades independently with report data absent", async (t) => {
  const dir = directory(t),
    source = join(dir, "disabled.db"),
    dest = join(dir, "disabled-clone.db");
  const app = new Application(source, "US", { eventReports: false });
  const actor = app.identity.bootstrap(
    "Synthetic US disabled",
    "us@example.test",
    "long-test-only-password",
    "USD",
  );
  app.inventory.createWarehouse(actor, "us-warehouse", {
    name: "Synthetic US warehouse",
  });
  app.close();
  legacy(source);
  const fingerprint = hash(source);
  assert.equal(
    fingerprint,
    "7ee77d2cf55922c6ba7d93360af7e7af8715fc81ef4bac964a9a07c4371b023e",
  );
  const before = snapshot(source),
    inspection = inspectSchema(source);
  assert.equal(inspection.eventReports, false);
  assert.equal(inspection.region, "US");
  await assert.rejects(upgradeSchema(source, dest, fingerprint, "CA"));
  assert.equal(existsSync(dest), false);
  const receipt = await upgradeSchema(source, dest, fingerprint, "US");
  assert.equal(receipt.eventReports, false);
  assert.equal(receipt.region, "US");
  conservedUpgrade(dest, before);
  assert.deepEqual(snapshot(source), before);
  assert.equal(hash(source), fingerprint);
  const clone = new Application(dest, "US", { eventReports: false });
  assert.equal(clone.identity.organization(actor).currency, "USD");
  clone.close();
  assert.throws(() => new Application(dest, "CA", { eventReports: false }));
});

test("upgrade requires an organization and rejects unsafe destination parent directories without staging", async (t) => {
  const dir = directory(t),
    source = join(dir, "unbootstrapped.db");
  const empty = new Application(source);
  empty.close();
  await assert.rejects(
    upgradeSchema(source, join(dir, "empty-clone.db"), hash(source), "CA"),
  );
  assert.equal(existsSync(join(dir, "empty-clone.db")), false);
  const f = fixture(t),
    parentLink = join(dir, "linked-parent");
  symlinkSync(dir, parentLink);
  await assert.rejects(
    upgradeSchema(
      f.path,
      join(parentLink, "linked-clone.db"),
      hash(f.path),
      "CA",
    ),
  );
  assert.equal(existsSync(join(dir, "linked-clone.db")), false);
  assert.equal(
    readdirSync(dir).some((n) => n.startsWith(".schema-upgrade-")),
    false,
  );
});

test("a real leap-day receipt remains valid across inspection, startup and clone", async (t) => {
  const f = fixture(t),
    dest = join(directory(t), "leap.db");
  raw(f.path, (db) =>
    db
      .prepare(`UPDATE ${metadata} SET initialized_at=?`)
      .run("2024-02-29T12:00:00.000Z"),
  );
  const before = inspectSchema(f.path);
  assert.equal(before.initializedAt, "2024-02-29T12:00:00.000Z");
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(inspectSchema(f.path), before);
  await upgradeSchema(f.path, dest, before.schemaHash, "CA");
  assert.deepEqual(inspectSchema(dest), before);
});

test("a sqlite-prefix lookalike table cannot hide schema drift from inspection or startup", async (t) => {
  const f = fixture(t),
    dest = join(directory(t), "lookalike.db");
  raw(f.path, (db) =>
    db.exec("CREATE TABLE sqliteXunexpected(value TEXT) STRICT"),
  );
  const before = snapshot(f.path),
    fingerprint = hash(f.path);
  assert.throws(() => inspectSchema(f.path), { code: "SCHEMA_DRIFT" });
  assert.throws(() => new Application(f.path), { code: "SCHEMA_DRIFT" });
  await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"), {
    code: "SCHEMA_DRIFT",
  });
  assert.equal(existsSync(dest), false);
  assert.deepEqual(snapshot(f.path), before);
  assert.equal(hash(f.path), fingerprint);
});

test("failed optional report installation preserves existing facts and version receipt for retry", (t) => {
  const path = join(directory(t), "optional.db"),
    app = new Application(path, "CA", { eventReports: false });
  app.identity.bootstrap(
    "Synthetic optional",
    "optional@example.test",
    "long-test-only-password",
    "CAD",
  );
  app.close();
  const before = snapshot(path),
    receipt = inspectSchema(path),
    original = Store.prototype.migrate;
  const mock = t.mock.method(
    Store.prototype,
    "migrate",
    function (this: Store, sql: string) {
      original.call(this, sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS report_events"))
        throw Error("Synthetic report install failure");
    },
  );
  assert.throws(
    () => new Application(path),
    /Synthetic report install failure/,
  );
  mock.mock.restore();
  assert.deepEqual(snapshot(path), before);
  assert.deepEqual(inspectSchema(path), receipt);
  new Application(path).close();
  assert.equal(inspectSchema(path).eventReports, true);
  const after = snapshot(path);
  delete after.report_events;
  assert.deepEqual(after, before);
});

test("initialization rejects caught transaction failures and arbitrary thenables without retained writes", (t) => {
  const dir = directory(t);
  for (const failure of ["caught", "thenable"]) {
    const path = join(dir, failure + ".db"),
      db = new Database(path);
    assert.throws(
      () =>
        db.initializeSchema("CA", false, () => {
          db.owned("platform").migrate(
            "CREATE TABLE platform_test(value TEXT) STRICT",
          );
          if (failure === "caught") {
            try {
              db.transaction(() => {
                db.owned("platform").run(
                  "INSERT INTO platform_test VALUES('rollback')",
                );
                throw Error("Synthetic constructor failure");
              });
            } catch {}
            return undefined;
          }
          return { then() {} };
        }),
      { code: failure === "caught" ? "SCHEMA_INITIALIZATION" : "TRANSACTION" },
    );
    db.close();
    assert.deepEqual(raw(path, schema), []);
    new Application(path).close();
  }
});
