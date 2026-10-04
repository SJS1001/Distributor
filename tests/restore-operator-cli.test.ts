import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { captureRestoreCandidate } from "../src/server/restore-review.ts";
import { inspectSchema } from "../src/server/schema-upgrade.ts";

function directory(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), "distributor-restore-cli-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function store(t: { after: (fn: () => void) => void }, isolated = false) {
  const path = join(directory(t), "candidate.db");
  const app = new Application(path, "CA", { eventReports: false });
  if (isolated) {
    const actor = app.identity.bootstrap(
      "Synthetic Distributor",
      "admin@example.test",
      "long-test-only-password",
      "CAD",
    );
    app.database
      .owned("iam")
      .run(
        "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?)",
        actor.id,
        actor.orgId,
        "synthetic-key",
        "synthetic-expired-enrollment",
        1,
        "synthetic-encrypted-material",
        1,
      );
    const integration = app.database.owned("integration");
    integration.run(
      "INSERT INTO integration_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "synthetic-expired-customer-oauth",
      actor.orgId,
      "synthetic-binding",
      "synthetic-account",
      actor.id,
      "1234",
      "synthetic-client",
      "http://127.0.0.1/synthetic-callback",
      "b".repeat(64),
      0,
      1,
      1,
      "pending",
      null,
      null,
      null,
    );
    integration.run(
      "INSERT INTO integration_ledger_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "synthetic-expired-ledger-oauth",
      actor.orgId,
      "synthetic-binding",
      actor.id,
      "1234",
      "synthetic-client",
      "http://127.0.0.1/synthetic-callback",
      "c".repeat(64),
      0,
      "{}",
      1,
      "pending",
      null,
      null,
      null,
    );
    // This legacy fact deliberately has no derived history row. Status must not
    // turn an operator inspection into a constructor backfill.
    app.database
      .owned("fulfillment")
      .run(
        "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
        "synthetic-legacy-delivery",
        actor.orgId,
        "synthetic-legacy-shipment",
        "synthetic-legacy-reference",
        "2026-10-04T00:00:00.000Z",
        actor.id,
      );
    app.database.owned("inventory").run("DELETE FROM inventory_cost_clock");
    app.platform.isolateRestore("a".repeat(64), "2026-10-04T00:00:00.000Z");
  }
  app.close();
  chmodSync(path, 0o600);
  return path;
}

function run(
  path: string,
  action: string,
  input: string | Buffer = "{}",
  env: Record<string, string | undefined> = {},
) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server/restore-operator-cli.ts", action],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_PATH: path,
        DATA_REGION: "CA",
        ...env,
      },
      input,
      encoding: "utf8",
      timeout: 15000,
    },
  );
}

test("restore operator status opens an existing store and returns one JSON line", (t) => {
  const path = store(t, true);
  const before = captureRestoreCandidate(path);
  assert.equal(inspectSchema(path).eventReports, false);
  const result = run(path, "release-status");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    release: null,
    hostInstalled: false,
  });
  assert.equal(inspectSchema(path).eventReports, false);
  const after = captureRestoreCandidate(path);
  assert.equal(after.logicalHash, before.logicalHash);
  assert.deepEqual(after, before);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      db
        .prepare(
          "SELECT material FROM iam_mfa_pending WHERE enrollment_id='synthetic-expired-enrollment'",
        )
        .get()?.material,
      "synthetic-encrypted-material",
    );
    assert.equal(
      db
        .prepare(
          "SELECT state FROM integration_authorizations WHERE id='synthetic-expired-customer-oauth'",
        )
        .get()?.state,
      "pending",
    );
    assert.equal(
      db
        .prepare(
          "SELECT state FROM integration_ledger_authorizations WHERE id='synthetic-expired-ledger-oauth'",
        )
        .get()?.state,
      "pending",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM fulfillment_delivery_history").get()
        ?.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM inventory_cost_clock").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("restore operator rejects a zero-byte path without initializing it", (t) => {
  const path = join(directory(t), "empty.db");
  writeFileSync(path, Buffer.alloc(0), { mode: 0o600 });
  const result = run(path, "release-status");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(statSync(path).size, 0);
  assert.equal(readFileSync(path).length, 0);
  assert.equal(existsSync(`${path}-wal`), false);
  assert.equal(existsSync(`${path}-shm`), false);
});

test("restore operator rejects malformed and oversized private input before opening a store", (t) => {
  const path = join(directory(t), "missing.db");
  for (const input of [
    "[1]",
    "{",
    '{"unexpected":"field"}',
    Buffer.from([0xff]),
    " ".repeat(1024 * 1024 + 1),
  ]) {
    const result = run(path, "release-status", input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^RESTORE_(INPUT|OPERATION): Restore operation did not complete\./,
    );
    assert.equal(existsSync(path), false);
  }
  const incomplete = run(path, "release-prepare", "{}");
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /^RESTORE_INPUT:/);
  assert.equal(existsSync(path), false);
});

test("restore operator refuses missing region, unknown action and linked stores without creating one", (t) => {
  const path = store(t);
  const missing = join(directory(t), "missing.db");
  const noRegion = run(path, "release-status", "{}", {
    DATA_REGION: undefined,
  });
  assert.equal(noRegion.status, 1);
  assert.equal(noRegion.stdout, "");
  const beforeRegionMismatch = readFileSync(path);
  const wrongRegion = run(path, "release-status", "{}", { DATA_REGION: "US" });
  assert.equal(wrongRegion.status, 1);
  assert.equal(wrongRegion.stdout, "");
  assert.deepEqual(readFileSync(path), beforeRegionMismatch);
  const unknown = run(missing, "not-an-action");
  assert.equal(unknown.status, 1);
  assert.equal(existsSync(missing), false);
  const linked = join(directory(t), "linked.db");
  linkSync(path, linked);
  const hardlink = run(linked, "release-status");
  assert.equal(hardlink.status, 1);
  assert.equal(hardlink.stdout, "");
  const symbolic = join(directory(t), "symbolic.db");
  symlinkSync(path, symbolic);
  const symlink = run(symbolic, "release-status");
  assert.equal(symlink.status, 1);
  assert.equal(symlink.stdout, "");
});

test("restore operator defaults closed for mutations and redacts rejected private input", (t) => {
  const path = store(t);
  const secret = "synthetic-private-evidence-do-not-print";
  const result = run(
    path,
    "release-prepare",
    JSON.stringify({ input: { privateEvidence: secret } }),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /^RESTORE_DISABLED: Restore operation did not complete\./,
  );
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(result.stderr.includes(path), false);
});
