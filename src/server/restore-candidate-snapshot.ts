import { createHash } from "node:crypto";
import { lstatSync, type BigIntStats } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { canonical, check } from "./core.ts";
import { checkIntegrity, inspectConnection } from "./schema.ts";
import type { Region } from "./iam.ts";

export type RestoreCandidate = {
  logicalHash: string;
  schemaHash: string;
  snapshotHash: string;
  sourceCompletedAt: string;
  restoredAt: string;
  region: Region;
  organizations: { id: string; currency: string }[];
};

/** Internal pathname/sidecar pin; this grants neither SQL nor recovery authority. */
export function pinRestoreCandidateFiles(
  path: string,
  openedIdentity?: { dev: bigint; ino: bigint },
) {
  const stat = lstatSync(path, { bigint: true });
  check(
    stat.isFile() && !stat.isSymbolicLink(),
    "RESTORE_REVIEW",
    "Candidate must be a regular database file.",
  );
  check(
    !openedIdentity ||
      (stat.dev === openedIdentity.dev && stat.ino === openedIdentity.ino),
    "RESTORE_REVIEW_CHANGED",
    "Candidate pathname no longer identifies the opened database.",
  );
  const files = new Map<string, BigIntStats | undefined>([["", stat]]);
  const inspectFile = (suffix: string) => {
    try {
      return lstatSync(path + suffix, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return undefined;
    }
  };
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = inspectFile(suffix);
    check(
      !sidecar || (sidecar.isFile() && !sidecar.isSymbolicLink()),
      "RESTORE_REVIEW",
      "Candidate sidecars must be regular files.",
    );
    files.set(suffix, sidecar);
  }
  return (allowReadSidecars = false) => {
    for (const [suffix, before] of files) {
      const after = inspectFile(suffix);
      // A read-only WAL connection may create its empty WAL and shared index.
      // Retain their identities once opened; a nonempty new WAL is a write.
      if (
        allowReadSidecars &&
        !before &&
        after?.isFile() &&
        (suffix === "-shm" || (suffix === "-wal" && after.size === 0n))
      ) {
        files.set(suffix, after);
        continue;
      }
      const identity = ["dev", "ino", "mode", "nlink", "uid", "gid"] as const;
      const content = ["size", "mtimeNs", "ctimeNs"] as const;
      check(
        (!before && !after) ||
          (before &&
            after &&
            after.isFile() &&
            identity.every((key) => before[key] === after[key]) &&
            // SQLite itself updates shared-index read marks. Its identity must
            // remain fixed, but only the main/WAL/journal bytes are content.
            (suffix === "-shm" ||
              content.every((key) => before[key] === after[key]))),
        "RESTORE_REVIEW_CHANGED",
        "Candidate files changed during inspection.",
      );
    }
  };
}

/** Fixed internal logical reader. Caller owns a pinned connection and transaction;
 * this neither starts/commits a transaction nor returns underlying row values. */
export function readRestoreCandidateSnapshot(
  db: DatabaseSync,
): RestoreCandidate {
  check(
    db.isTransaction,
    "TRANSACTION",
    "Candidate hashing requires an existing SQLite transaction.",
  );
  const schema = inspectConnection(db);
  check(
    schema.kind === "current" && schema.region,
    "RESTORE_REVIEW",
    "Review requires an exact current regional schema.",
  );
  checkIntegrity(db);
  const hold = db.prepare("SELECT * FROM platform_recovery WHERE id=1").get();
  check(hold, "RESTORE_REVIEW", "Candidate is not an isolated restored store.");
  const organizations = db
    .prepare("SELECT id,currency FROM iam_organizations ORDER BY id")
    .all() as { id: string; currency: string }[];
  check(
    organizations.length > 0,
    "RESTORE_REVIEW",
    "Candidate has no organizations to reconcile.",
  );
  const hash = createHash("sha256");
  hash.update("distributor-restore-candidate-v1\n" + schema.schemaHash + "\n");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
    )
    .all();
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  for (const table of tables) {
    // Release metadata changes during orchestration; business facts and the
    // original recovery generation remain bound. DDL is still schema-hashed.
    if (table.name === "platform_restore_releases") continue;
    const name = String(table.name),
      columns = db
        .prepare(`PRAGMA table_info(${quote(name)})`)
        .all()
        .map((c) => String(c.name));
    hash.update(canonical({ table: name, columns }) + "\n");
    const statement = db.prepare(
      `SELECT * FROM ${quote(name)} ORDER BY ${columns.map(quote).join(",")}`,
    );
    statement.setReadBigInts(true);
    for (const row of statement.iterate())
      hash.update(
        canonical(
          columns.map((column) => {
            const value = row[column];
            return value === null
              ? ["null"]
              : typeof value === "bigint"
                ? ["integer", value.toString()]
                : typeof value === "number"
                  ? ["real", value.toString()]
                  : value instanceof Uint8Array
                    ? ["blob", Buffer.from(value).toString("hex")]
                    : ["text", value];
          }),
        ) + "\n",
      );
  }
  return {
    logicalHash: hash.digest("hex"),
    schemaHash: schema.schemaHash,
    snapshotHash: candidateFingerprint(String(hold.snapshot_hash)),
    sourceCompletedAt: String(hold.source_completed_at),
    restoredAt: String(hold.restored_at),
    region: schema.region,
    organizations,
  };
}

function candidateFingerprint(value: string) {
  check(
    /^[a-f0-9]{64}$/.test(value),
    "RESTORE_REVIEW",
    "Evidence requires a lowercase SHA256 fingerprint.",
  );
  return value;
}
