import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Database } from "../src/server/database.ts";
import {
  captureRestoreCandidate,
  type RestoreCandidate,
} from "../src/server/restore-review.ts";
import { fixture } from "./fixtures.ts";

// This fixed operation exposes no unrestricted SQL callback.
function capture(database: Database): RestoreCandidate {
  return database.captureRestoreCandidateInTransaction();
}
function isolated(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  reports = true,
) {
  const f = fixture(t, { eventReports: reports }, region);
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return f;
}

for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`native snapshot preserves the exact ${region} reports=${reports} candidate binding`, (t) => {
      const f = isolated(t, region, reports);
      const before = captureRestoreCandidate(f.path);
      const current = f.app.database.transaction(() => capture(f.app.database));
      assert.deepEqual(current, before);
      assert.deepEqual(captureRestoreCandidate(f.path), before);
      assert.equal(
        f.app.platform.recoveryHold()?.snapshot_hash,
        before.snapshotHash,
      );
    });

test("native snapshot sees its own uncommitted business rows, while a separate reader sees the committed store", (t) => {
  const f = isolated(t),
    db = f.app.database;
  const before = captureRestoreCandidate(f.path);
  let own!: RestoreCandidate;
  assert.throws(
    () =>
      db.transaction(() => {
        db.owned("iam").run(
          "UPDATE iam_organizations SET name=? WHERE id=?",
          "Synthetic uncommitted organization",
          f.actor.orgId,
        );
        own = capture(db);
        assert.notEqual(own.logicalHash, before.logicalHash);
        assert.deepEqual(captureRestoreCandidate(f.path), before);
        throw new Error("synthetic rollback");
      }),
    /synthetic rollback/,
  );
  assert.deepEqual(captureRestoreCandidate(f.path), before);
  db.transaction(() => {
    db.owned("iam").run(
      "UPDATE iam_organizations SET name=? WHERE id=?",
      "Synthetic uncommitted organization",
      f.actor.orgId,
    );
    assert.deepEqual(capture(db), own);
  });
  assert.deepEqual(captureRestoreCandidate(f.path), own);
});

test("native snapshot binds uncommitted recovery generation", (t) => {
  const f = isolated(t),
    db = f.app.database;
  const before = captureRestoreCandidate(f.path);
  assert.throws(
    () =>
      db.transaction(() => {
        db.owned("platform").run(
          "UPDATE platform_recovery SET snapshot_hash=? WHERE id=1",
          "b".repeat(64),
        );
        const changed = capture(db);
        assert.equal(changed.snapshotHash, "b".repeat(64));
        assert.notEqual(changed.logicalHash, before.logicalHash);
        assert.deepEqual(captureRestoreCandidate(f.path), before);
        throw new Error("synthetic rollback");
      }),
    /synthetic rollback/,
  );
  assert.deepEqual(captureRestoreCandidate(f.path), before);
});

test("release row exclusion remains exact and does not exclude other platform rows", (t) => {
  const f = isolated(t),
    db = f.app.database;
  const before = captureRestoreCandidate(f.path);
  db.transaction(() => {
    db.owned("platform").run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      "synthetic-release",
      "prepared",
      1,
      "{}",
      "c".repeat(64),
    );
    assert.deepEqual(capture(db), before);
    db.owned("platform").run(
      "UPDATE platform_recovery SET source_completed_at=? WHERE id=1",
      "2026-10-02T00:00:00.000Z",
    );
    assert.notEqual(capture(db).logicalHash, before.logicalHash);
  });
});

test("native snapshot refuses absent writer transaction and owner-scope escape", (t) => {
  const f = isolated(t),
    db = f.app.database;
  assert.throws(() => capture(db), { code: "TRANSACTION" });
  db.transaction(() => {
    assert.throws(() => db.execute("iam", () => capture(db)), {
      code: "TRANSACTION",
    });
    assert.equal(capture(db).region, "CA");
  });
});

test("native snapshot refuses initialization and uninitialized connections", (t) => {
  const f = isolated(t);
  const path = f.path + ".empty",
    db = new Database(path);
  t.after(() => db.close());
  db.transaction(() =>
    assert.throws(() => capture(db), { code: "RESTORE_REVIEW" }),
  );
  assert.throws(() => db.initializeSchema("CA", false, () => capture(db)), {
    code: "RESTORE_REVIEW",
  });
});

test("native snapshot requires the raw recovery hold", (t) => {
  const f = fixture(t),
    db = f.app.database;
  db.transaction(() =>
    assert.throws(() => capture(db), { code: "RESTORE_REVIEW" }),
  );
});

test("native snapshot rejects schema drift without modifying rows", (t) => {
  const f = isolated(t),
    db = f.app.database;
  const before = captureRestoreCandidate(f.path);
  assert.throws(
    () =>
      db.transaction(() => {
        db.owned("platform").migrate(
          "CREATE TABLE platform_unapproved_snapshot_rows(id TEXT PRIMARY KEY) STRICT",
        );
        capture(db);
      }),
    { code: "SCHEMA_DRIFT" },
  );
  assert.deepEqual(captureRestoreCandidate(f.path), before);
});

test("native snapshot rejects malformed raw recovery fingerprints", (t) => {
  const f = isolated(t),
    db = f.app.database;
  const before = captureRestoreCandidate(f.path);
  assert.throws(
    () =>
      db.transaction(() => {
        db.owned("platform").run(
          "UPDATE platform_recovery SET snapshot_hash='not-a-fingerprint'",
        );
        capture(db);
      }),
    { code: "RESTORE_REVIEW" },
  );
  assert.deepEqual(captureRestoreCandidate(f.path), before);
});

test("native snapshot refuses a replaced pathname even if replacement contains identical bytes", (t) => {
  const f = isolated(t),
    saved = f.path + ".opened";
  fs.renameSync(f.path, saved);
  try {
    fs.copyFileSync(saved, f.path);
    assert.throws(
      () => f.app.database.transaction(() => capture(f.app.database)),
      { code: "RESTORE_REVIEW_CHANGED" },
    );
  } finally {
    fs.unlinkSync(f.path);
    fs.renameSync(saved, f.path);
  }
});

test("native snapshot refuses a mutable Database.path alias", (t) => {
  const f = isolated(t),
    alias = f.path + ".alias";
  fs.copyFileSync(f.path, alias);
  f.app.database.path = alias;
  try {
    assert.throws(
      () => f.app.database.transaction(() => capture(f.app.database)),
      { code: "RESTORE_REVIEW_CHANGED" },
    );
  } finally {
    f.app.database.path = f.path;
  }
});

test("native snapshot refuses a changed pathname even when it is a hard-link alias of the opened inode", (t) => {
  const f = isolated(t),
    alias = f.path + ".hard-link";
  fs.linkSync(f.path, alias);
  f.app.database.path = alias;
  try {
    assert.equal(fs.statSync(alias).ino, fs.statSync(f.path).ino);
    assert.throws(
      () => f.app.database.transaction(() => capture(f.app.database)),
      { code: "RESTORE_REVIEW_CHANGED" },
    );
  } finally {
    f.app.database.path = f.path;
    fs.unlinkSync(alias);
  }
});

test("native snapshot refuses linked sidecars before reading", (t) => {
  const f = isolated(t),
    wal = f.path + "-wal",
    saved = wal + ".saved";
  fs.renameSync(wal, saved);
  try {
    fs.symlinkSync(saved, wal);
    assert.throws(
      () => f.app.database.transaction(() => capture(f.app.database)),
      { code: "RESTORE_REVIEW" },
    );
  } finally {
    fs.unlinkSync(wal);
    fs.renameSync(saved, wal);
  }
});

test("native snapshot checks pinned file identity again after hashing", (t) => {
  const f = isolated(t),
    original = fs.lstatSync;
  let calls = 0;
  const hook = t.mock.method(fs, "lstatSync", ((
    path: fs.PathLike,
    options: unknown,
  ) => {
    if (path === f.path && ++calls === 2) fs.chmodSync(f.path, 0o640);
    return original(path, options as { bigint: true });
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => f.app.database.transaction(() => capture(f.app.database)),
      { code: "RESTORE_REVIEW_CHANGED" },
    );
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
    fs.chmodSync(f.path, 0o600);
  }
});
