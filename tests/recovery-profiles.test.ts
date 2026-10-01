import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { supportedSchemaHash } from "../src/server/schema.ts";
import type { Adapter } from "../src/server/integration.ts";
import type { Region } from "../src/server/iam.ts";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";

// Read-only independent oracles: never invoke a constructor to inspect a recovered profile.
function inspect(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const objects = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
      )
      .all();
    const rows = Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          String(name),
          db
            .prepare(
              `SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    );
    return {
      schemaHash: createHash("sha256")
        .update(JSON.stringify(objects))
        .digest("hex"),
      receipt: db.prepare("SELECT * FROM platform_schema_version").get(),
      reports: objects.some((o) => o.name === "report_events"),
      rows,
    };
  } finally {
    db.close();
  }
}
function clean(path: string) {
  assert.deepEqual(
    readdirSync(dirname(path)).filter((n) => n.startsWith(".recovery-")),
    [],
  );
}
function decoded(archive: string, key: Buffer) {
  const raw = readFileSync(archive),
    end = 12 + raw.readUInt32BE(8);
  const manifest = JSON.parse(raw.subarray(12, end).toString()) as Record<
    string,
    unknown
  >;
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(String(manifest.iv), "hex"),
  );
  cipher.setAAD(raw.subarray(0, end));
  cipher.setAuthTag(raw.subarray(-16));
  const plain = Buffer.concat([
    cipher.update(raw.subarray(end, -16)),
    cipher.final(),
  ]);
  assert.equal(plain.subarray(0, 16).toString(), "SQLite format 3\u0000");
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest).sort(), [
    "bytes",
    "completedAt",
    "iv",
    "region",
    "schemaHash",
    "snapshotHash",
    "version",
  ]);
  assert.equal(
    manifest.snapshotHash,
    createHash("sha256").update(plain).digest("hex"),
  );
  return { manifest, plain };
}
function authenticated(
  path: string,
  manifest: unknown,
  plain: Buffer,
  key: Buffer,
  iv: string,
) {
  const header = Buffer.from(JSON.stringify(manifest)),
    length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const prefix = Buffer.concat([Buffer.from("DISTBKP1"), length, header]);
  // Use the valid original IV even when the deliberately malformed header has an array/null IV.
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  cipher.setAAD(prefix);
  writeFileSync(
    path,
    Buffer.concat([
      prefix,
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]),
    { mode: 0o600 },
  );
}
function operator(args: string[], key: Buffer) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/recovery-cli.ts", ...args],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      child.on("error", reject);
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.on("close", (code) => resolve({ code, out, err }));
      child.stdin.end(key.toString("hex") + "\n");
    },
  );
}

for (const region of ["CA", "US"] as const) {
  for (const eventReports of [false, true]) {
    test(`${region} encrypted recovery preserves stored reports=${eventReports}, cutoff WAL facts and isolation across disabled-runtime restart`, async (t) => {
      const credentialKey = "ab".repeat(32);
      const f = fixture(
        t,
        { eventReports, providerEncryptionKey: credentialKey },
        region,
      );
      const archive = join(dirname(f.path), "profile.backup"),
        target = join(dirname(f.path), "restored.db"),
        key = randomBytes(32);
      // Preserve an enabled stored profile with reporting disabled before writing cutoff facts to WAL.
      if (eventReports) {
        f.app.close();
        f.app = new Application(f.path, region, {
          eventReports: false,
          providerEncryptionKey: credentialKey,
        });
      }
      const shipped = ship(f, accept(f).id);
      f.app.billing.manualPayment(f.actor, "cutoff-cash", {
        invoiceId: shipped.invoiceId,
        amount: 4000,
        reference: "SYNTHETIC-CUTOFF",
        reason: "Synthetic cutoff",
      });
      chooseProviders(f, f.actor, "choice", {
        accountId: f.buyer,
        region,
        mode: "provider-exceptions",
        providers: ["quickbooks"],
        version: 1,
        acknowledgment: "Synthetic named choice",
      });
      const pending = f.app.integration.accounting(
        f.actor,
        "pending-accounting",
        {
          invoiceId: shipped.invoiceId,
          customerRef: "c",
          itemRefs: { [f.product]: "i" },
          taxCodeRef: "t",
          taxRateRef: "r",
        },
      );
      f.app.providerCredentials.install(
        {
          id: "synthetic-profile",
          orgId: f.actor.orgId,
          workerUserId: f.actor.id,
          realm: "1234",
          clientId: "synthetic-client",
        },
        0,
        {
          accessToken: "synthetic-profile-access",
          refreshToken: "synthetic-profile-refresh",
          accessExpiresAt: Date.now() + 3600000,
          refreshExpiresAt: Date.now() + 86400000,
        },
      );
      const login = f.app.identity.login(
        "admin@example.test",
        "long-test-only-password",
      );
      assert.ok(existsSync(f.path + "-wal"));
      assert.ok(statSync(f.path + "-wal").size > 0);
      const before = inspect(f.path);
      assert.equal(before.reports, eventReports);
      assert.equal(before.schemaHash, supportedSchemaHash(eventReports));
      const receipt = await createBackup(f.path, archive, region, key);
      assert.deepEqual(
        inspect(f.path),
        before,
        "backup must leave every source row and exact schema unchanged",
      );
      assert.equal(receipt.version, 1);
      assert.equal(receipt.schemaVersion, 1);
      assert.equal(receipt.eventReports, eventReports);
      assert.equal(receipt.schemaHash, before.schemaHash);
      assert.equal(
        decoded(archive, key).manifest.schemaHash,
        before.schemaHash,
      );
      assert.equal(statSync(archive).mode & 0o777, 0o600);
      assert.equal(
        readFileSync(archive).includes(
          Buffer.from("synthetic-profile-refresh"),
        ),
        false,
      );
      clean(f.path);
      f.app.billing.manualPayment(f.actor, "later-cash", {
        invoiceId: shipped.invoiceId,
        amount: 2000,
        reference: "SYNTHETIC-AFTER",
        reason: "After cutoff",
      });
      ship(f, accept(f, 1, "later-order").id);
      const after = inspect(f.path);
      const restored = await restoreBackup(archive, target, region, key);
      assert.equal(restored.schemaVersion, 1);
      assert.equal(restored.eventReports, eventReports);
      assert.equal(restored.schemaHash, before.schemaHash);
      assert.equal(restored.snapshotHash, receipt.snapshotHash);
      assert.equal(restored.invalidatedSessions, 1);
      assert.equal(restored.providerHold, true);
      const restoredRaw = inspect(target);
      assert.deepEqual(restoredRaw.receipt, before.receipt);
      assert.equal(restoredRaw.schemaHash, before.schemaHash);
      assert.equal(restoredRaw.reports, eventReports);
      assert.deepEqual(
        restoredRaw.rows.report_events,
        before.rows.report_events,
      );
      assert.equal(statSync(target).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(target)).mode & 0o777, 0o700);
      let calls = 0;
      const adapter: Adapter = {
        execute: async () => {
          calls++;
          return { reference: "never", result: {} };
        },
        lookup: async () => {
          calls++;
          return null;
        },
      };
      for (let restart = 0; restart < 2; restart++) {
        const app = new Application(target, region, {
          eventReports: false,
          providerEncryptionKey: credentialKey,
        });
        try {
          const stock = app.inventory
            .stock(f.actor)
            .filter((u) => u.state === "stock");
          assert.equal(
            stock.reduce((n, u) => n + u.quantity, 0),
            2,
          );
          assert.equal(
            stock.reduce((n, u) => n + u.quantity * u.cost, 0),
            12000,
          );
          assert.equal(app.inventory.trace(f.actor, "S1").unit.state, "sold");
          assert.equal(app.orders.list(f.actor).length, 1);
          assert.equal(
            app.billing.invoice(f.actor, shipped.invoiceId).currency,
            region === "CA" ? "CAD" : "USD",
          );
          assert.deepEqual(app.billing.totals(f.actor, shipped.invoiceId), {
            credited: 0,
            paid: 4000,
            refunded: 0,
            balance: 7300,
          });
          assert.throws(() => app.identity.session(login.token), {
            code: "UNAUTHENTICATED",
          });
          assert.ok(app.platform.recoveryHold());
          assert.equal(
            app.integration.effect(f.actor, pending.id).state,
            "pending",
          );
          const credentials = app.database
            .owned("integration")
            .get(
              "SELECT revision,state,material,claim,started_at FROM integration_credentials",
            );
          assert.deepEqual(
            { ...credentials },
            {
              revision: 2,
              state: "disabled",
              material: null,
              claim: null,
              started_at: null,
            },
          );
          await assert.rejects(
            app.integration.execute(f.actor, pending.id, adapter),
            { code: "RECOVERY_HOLD" },
          );
          assert.equal(calls, 0);
          assert.deepEqual(inspect(target).receipt, before.receipt);
          assert.equal(inspect(target).schemaHash, before.schemaHash);
          assert.equal(inspect(target).reports, eventReports);
        } finally {
          app.close();
        }
      }
      assert.deepEqual(
        inspect(f.path),
        after,
        "restore must not change the live source",
      );
      assert.equal(f.app.identity.session(login.token).actor.id, f.actor.id);
      assert.equal(f.app.orders.list(f.actor).length, 2);
      assert.equal(f.app.billing.totals(f.actor, shipped.invoiceId).paid, 6000);
      clean(f.path);
    });
  }
}

test("authenticated valid SQLite cannot be relabeled with the other supported profile hash", async (t) => {
  for (const eventReports of [false, true]) {
    const f = fixture(t, { eventReports }),
      key = randomBytes(32),
      archive = join(dirname(f.path), "valid.backup"),
      target = join(dirname(f.path), "rejected.db");
    await createBackup(f.path, archive, "CA", key);
    const { manifest, plain } = decoded(archive, key),
      before = inspect(f.path);
    const forged = join(dirname(f.path), "other-profile.backup");
    authenticated(
      forged,
      { ...manifest, schemaHash: supportedSchemaHash(!eventReports) },
      plain,
      key,
      String(manifest.iv),
    );
    await assert.rejects(restoreBackup(forged, target, "CA", key), {
      code: "RECOVERY_SCHEMA",
    });
    assert.equal(existsSync(target), false);
    assert.deepEqual(inspect(f.path), before);
    clean(f.path);
  }
});

test("authenticated malformed manifest types and impossible dates reject identical valid SQLite without publication", async (t) => {
  const f = fixture(t, { eventReports: false }),
    key = randomBytes(32),
    archive = join(dirname(f.path), "valid.backup");
  await createBackup(f.path, archive, "CA", key);
  const { manifest, plain } = decoded(archive, key),
    before = inspect(f.path);
  const cases: [string, unknown][] = [
    ["null", null],
    ["array", [manifest]],
    ["string", JSON.stringify(manifest)],
    ...["snapshotHash", "schemaHash", "iv", "completedAt", "region"].flatMap(
      (field): [string, unknown][] => [
        [field + "-array", { ...manifest, [field]: [manifest[field]] }],
        [field + "-null", { ...manifest, [field]: null }],
        [field + "-number", { ...manifest, [field]: 123 }],
        [field + "-object", { ...manifest, [field]: {} }],
      ],
    ),
    [
      "impossible-day",
      { ...manifest, completedAt: "2026-02-30T12:00:00.000Z" },
    ],
    ["non-leap-day", { ...manifest, completedAt: "2025-02-29T12:00:00.000Z" }],
    ["date-only", { ...manifest, completedAt: "2026-10-01T" }],
    [
      "date-offset",
      { ...manifest, completedAt: "2026-10-01T12:00:00.000+00:00" },
    ],
    ["bytes-string", { ...manifest, bytes: String(manifest.bytes) }],
    ["bytes-array", { ...manifest, bytes: [manifest.bytes] }],
    ["version-array", { ...manifest, version: [1] }],
    ["version-string", { ...manifest, version: "1" }],
  ];
  for (const [label, value] of cases) {
    const forged = join(dirname(f.path), label + ".backup"),
      target = join(dirname(f.path), label + ".db");
    authenticated(forged, value, plain, key, String(manifest.iv));
    await assert.rejects(
      restoreBackup(forged, target, "CA", key),
      { code: "RECOVERY_FORMAT" },
      label,
    );
    assert.equal(existsSync(target), false, label);
    assert.deepEqual(inspect(f.path), before, label);
    clean(f.path);
  }
  // Exact ISO roundtrip must accept a real leap day, not simply reject all February 29 values.
  const leap = join(dirname(f.path), "leap.backup"),
    leapTarget = join(dirname(f.path), "leap.db");
  authenticated(
    leap,
    { ...manifest, completedAt: "2024-02-29T12:00:00.000Z" },
    plain,
    key,
    String(manifest.iv),
  );
  assert.equal(
    (await restoreBackup(leap, leapTarget, "CA", key)).sourceCompletedAt,
    "2024-02-29T12:00:00.000Z",
  );
  clean(f.path);
});

test("authenticated altered version/profile receipts and legacy/foreign layouts never publish or overwrite evidence", async (t) => {
  const f = fixture(t, { eventReports: false }),
    key = randomBytes(32),
    archive = join(dirname(f.path), "valid.backup");
  await createBackup(f.path, archive, "CA", key);
  const { manifest, plain } = decoded(archive, key),
    before = inspect(f.path);
  const existing = join(dirname(f.path), "existing.db");
  writeFileSync(existing, "preserved destination", { mode: 0o600 });
  const cases = [
    ["version", "UPDATE platform_schema_version SET version=999"],
    ["profile", "UPDATE platform_schema_version SET event_reports=1"],
    [
      "receipt-hash",
      "UPDATE platform_schema_version SET schema_hash='" +
        supportedSchemaHash(true) +
        "'",
    ],
    [
      "receipt-day",
      "UPDATE platform_schema_version SET initialized_at='2026-02-30T12:00:00.000Z'",
    ],
    [
      "receipt-leap",
      "UPDATE platform_schema_version SET initialized_at='2025-02-29T12:00:00.000Z'",
    ],
    ["legacy", "DROP TABLE platform_schema_version"],
    ["foreign", "CREATE TABLE foreign_authority(value TEXT) STRICT"],
  ];
  for (const [label, sql] of cases) {
    const modified = join(dirname(f.path), label + "-plain.db");
    writeFileSync(modified, plain, { mode: 0o600 });
    const db = new DatabaseSync(modified);
    try {
      db.exec(sql!);
    } finally {
      db.close();
    }
    const bytes = readFileSync(modified),
      forged = join(dirname(f.path), label + ".backup"),
      target = join(dirname(f.path), label + ".db");
    // Recompute byte/hash metadata to force schema validation, rather than a generic hash failure.
    authenticated(
      forged,
      {
        ...manifest,
        bytes: bytes.length,
        snapshotHash: createHash("sha256").update(bytes).digest("hex"),
      },
      bytes,
      key,
      String(manifest.iv),
    );
    await assert.rejects(
      restoreBackup(forged, target, "CA", key),
      { code: "RECOVERY_SCHEMA" },
      label,
    );
    assert.equal(existsSync(target), false, label);
    await assert.rejects(restoreBackup(forged, existing, "CA", key), {
      code: "RECOVERY_EXISTS",
    });
    assert.equal(readFileSync(existing, "utf8"), "preserved destination");
    assert.deepEqual(inspect(f.path), before, label);
    clean(f.path);
  }
});

test("operator CLI backs up/restores disabled US profile through protected stdin and reports verified schema metadata", async (t) => {
  const region: Region = "US",
    f = fixture(t, { eventReports: false }, region),
    key = randomBytes(32);
  const archive = join(dirname(f.path), "cli.backup"),
    target = join(dirname(f.path), "cli.db"),
    before = inspect(f.path);
  const backed = await operator(["backup", f.path, archive, region], key);
  assert.equal(backed.code, 0, backed.err);
  const restored = await operator(["restore", archive, target, region], key);
  assert.equal(restored.code, 0, restored.err);
  for (const result of [backed, restored]) {
    const receipt = JSON.parse(result.out);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.eventReports, false);
    assert.equal(receipt.schemaHash, before.schemaHash);
    assert.equal(receipt.region, region);
    assert.equal(
      (result.out + result.err).includes(key.toString("hex")),
      false,
    );
    assert.equal(
      (result.out + result.err).includes("long-test-only-password"),
      false,
    );
  }
  assert.deepEqual(inspect(target).receipt, before.receipt);
  assert.equal(inspect(target).reports, false);
  const app = new Application(target, region, { eventReports: false });
  try {
    assert.ok(app.platform.recoveryHold());
    assert.equal(app.inventory.availability(f.actor, f.product, f.w1), 3);
  } finally {
    app.close();
  }
  assert.equal(inspect(target).schemaHash, before.schemaHash);
  assert.deepEqual(inspect(f.path), before);
  clean(f.path);
});
