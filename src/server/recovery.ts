import { backup, DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Application } from "./application.ts";
import { check, DomainError } from "./core.ts";
import { inspectConnection } from "./schema.ts";
import { type Region } from "./iam.ts";

const magic = Buffer.from("DISTBKP1"),
  maxBytes = 2 * 1024 ** 3;
type Manifest = {
  version: 1;
  region: Region;
  completedAt: string;
  snapshotHash: string;
  schemaHash: string;
  bytes: number;
  iv: string;
};

async function regular(path: string, maximum = maxBytes) {
  const s = await lstat(path);
  check(
    s.isFile() && !s.isSymbolicLink(),
    "RECOVERY_PATH",
    "Source must be a regular file.",
  );
  check(
    s.size > 0 && s.size <= maximum,
    "RECOVERY_SIZE",
    "Recovery supports files up to 2 GiB; larger stores need qualification.",
  );
  return s;
}
async function destination(path: string, database = false) {
  const parent = dirname(resolve(path));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const s = await lstat(parent);
  check(
    s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o077) === 0,
    "RECOVERY_PATH",
    "Destination requires a private directory (mode 0700), without a directory symlink.",
  );
  for (const p of database
    ? [path, path + "-wal", path + "-shm", path + "-journal"]
    : [path]) {
    try {
      await lstat(p);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    check(
      false,
      "RECOVERY_EXISTS",
      "Recovery never overwrites a destination or database sidecar.",
    );
  }
  return parent;
}
async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function schema(db: DatabaseSync) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
          )
          .all(),
      ),
    )
    .digest("hex");
}
function inspect(path: string, region: Region, expectedSchema: string) {
  // Storage maintenance reads only schema, integrity and region; business mutations use their owners.
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA trusted_schema=OFF");
    check(
      schema(db) === expectedSchema,
      "RECOVERY_SCHEMA",
      "Snapshot schema differs from this application; use a separately tested upgrade procedure.",
    );
    // A matching DDL hash alone cannot validate altered version/profile metadata.
    // Preserve recovery's public error vocabulary instead of leaking SQLite text.
    try {
      check(
        inspectConnection(db).kind === "current",
        "RECOVERY_SCHEMA",
        "Snapshot requires a supported current schema receipt.",
      );
    } catch {
      throw new DomainError(
        "RECOVERY_SCHEMA",
        "Snapshot schema receipt is not supported by this application.",
      );
    }
    const integrity = db.prepare("PRAGMA integrity_check").all();
    check(
      integrity.length === 1 &&
        integrity[0]?.integrity_check === "ok" &&
        db.prepare("PRAGMA foreign_key_check").all().length === 0,
      "RECOVERY_INTEGRITY",
      "Snapshot integrity validation failed.",
    );
    const regions = db
      .prepare("SELECT DISTINCT region FROM iam_organizations")
      .all();
    check(
      regions.length === 1 && regions[0]?.region === region,
      "RECOVERY_REGION",
      "Snapshot and requested regional store must match and contain an organization.",
    );
  } finally {
    db.close();
  }
}
function currentSchema() {
  const app = new Application(":memory:");
  try {
    return app.database.execute("platform", schema);
  } finally {
    app.close();
  }
}
async function syncFile(path: string) {
  const f = await open(path, "r");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
async function publish(staged: string, target: string, database = false) {
  const parent = await destination(target, database);
  await chmod(staged, 0o600);
  await syncFile(staged);
  // Same-filesystem hard link creates the final name atomically, with no overwrite race.
  await link(staged, target);
  const directory = await open(parent, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
function inputs(key: Buffer, region: Region) {
  check(
    Buffer.isBuffer(key) && key.length === 32,
    "RECOVERY_KEY",
    "Supply a separately stored 32-byte recovery key.",
  );
  check(
    ["CA", "US"].includes(region),
    "RECOVERY_REGION",
    "Region must be CA or US.",
  );
}
export async function createBackup(
  source: string,
  target: string,
  region: Region,
  key: Buffer,
) {
  inputs(key, region);
  await regular(source);
  const parent = await destination(target),
    work = await mkdtemp(join(parent, ".recovery-"));
  const snapshot = join(work, "snapshot.db"),
    encrypted = join(work, "encrypted");
  const startedAt = new Date().toISOString();
  try {
    const sourceDb = new DatabaseSync(source, {
      readOnly: true,
      timeout: 5000,
    });
    try {
      await backup(sourceDb, snapshot);
    } finally {
      sourceDb.close();
    }
    await chmod(snapshot, 0o600);
    const bytes = (await regular(snapshot)).size,
      schemaHash = currentSchema();
    inspect(snapshot, region, schemaHash);
    const manifest: Manifest = {
      version: 1,
      region,
      completedAt: new Date().toISOString(),
      snapshotHash: await hashFile(snapshot),
      schemaHash,
      bytes,
      iv: randomBytes(12).toString("hex"),
    };
    const header = Buffer.from(JSON.stringify(manifest)),
      length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    const prefix = Buffer.concat([magic, length, header]);
    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(manifest.iv, "hex"),
    );
    cipher.setAAD(prefix);
    await writeFile(encrypted, prefix, { flag: "wx", mode: 0o600 });
    await pipeline(
      createReadStream(snapshot),
      cipher,
      createWriteStream(encrypted, { flags: "a" }),
    );
    await appendFile(encrypted, cipher.getAuthTag());
    await publish(encrypted, target);
    return { startedAt, ...manifest, path: resolve(target) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
export async function restoreBackup(
  source: string,
  target: string,
  region: Region,
  key: Buffer,
) {
  inputs(key, region);
  const size = (await regular(source, maxBytes + 4096 + 12 + 16)).size;
  const parent = await destination(target, true),
    work = await mkdtemp(join(parent, ".recovery-"));
  const snapshot = join(work, "snapshot.db");
  try {
    const file = await open(source, "r");
    let prefix: Buffer, manifest: Manifest, tag: Buffer;
    try {
      const fixed = Buffer.alloc(12);
      check(
        (await file.read(fixed, 0, 12, 0)).bytesRead === 12 &&
          fixed.subarray(0, 8).equals(magic),
        "RECOVERY_FORMAT",
        "Unsupported recovery file.",
      );
      const length = fixed.readUInt32BE(8);
      check(
        length > 0 && length <= 4096 && size > 12 + length + 16,
        "RECOVERY_FORMAT",
        "Invalid recovery header.",
      );
      const header = Buffer.alloc(length);
      check(
        (await file.read(header, 0, length, 12)).bytesRead === length,
        "RECOVERY_FORMAT",
        "Incomplete recovery header.",
      );
      manifest = JSON.parse(header.toString("utf8")) as Manifest;
      check(
        manifest.version === 1 &&
          ["CA", "US"].includes(manifest.region) &&
          /^\d{4}-\d{2}-\d{2}T/.test(manifest.completedAt) &&
          /^[a-f0-9]{64}$/.test(manifest.snapshotHash) &&
          /^[a-f0-9]{64}$/.test(manifest.schemaHash) &&
          /^[a-f0-9]{24}$/.test(manifest.iv) &&
          Number.isSafeInteger(manifest.bytes) &&
          manifest.bytes > 0 &&
          manifest.bytes === size - 12 - length - 16,
        "RECOVERY_FORMAT",
        "Invalid recovery manifest.",
      );
      prefix = Buffer.concat([fixed, header]);
      tag = Buffer.alloc(16);
      check(
        (await file.read(tag, 0, 16, size - 16)).bytesRead === 16,
        "RECOVERY_FORMAT",
        "Incomplete recovery tag.",
      );
    } finally {
      await file.close();
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(manifest.iv, "hex"),
    );
    decipher.setAAD(prefix);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { start: prefix.length, end: size - 17 }),
      decipher,
      createWriteStream(snapshot, { flags: "wx", mode: 0o600 }),
    );
    check(
      manifest.region === region,
      "RECOVERY_REGION",
      "Recovery cannot migrate data between regions.",
    );
    check(
      (await hashFile(snapshot)) === manifest.snapshotHash,
      "RECOVERY_INTEGRITY",
      "Snapshot hash differs from the authenticated manifest.",
    );
    const expectedSchema = currentSchema();
    check(
      manifest.schemaHash === expectedSchema,
      "RECOVERY_SCHEMA",
      "Snapshot schema differs from this application.",
    );
    inspect(snapshot, region, expectedSchema);
    const app = new Application(snapshot, region);
    let invalidatedSessions: number;
    try {
      invalidatedSessions = app.database.transaction(() => {
        app.platform.isolateRestore(
          manifest.snapshotHash,
          manifest.completedAt,
        );
        app.providerCredentials.invalidateRestoredCredentials();
        return app.identity.invalidateRestoredSessions();
      });
    } finally {
      app.close();
    }
    inspect(snapshot, region, expectedSchema);
    await publish(snapshot, target, true);
    return {
      path: resolve(target),
      region,
      snapshotHash: manifest.snapshotHash,
      sourceCompletedAt: manifest.completedAt,
      restoredAt: new Date().toISOString(),
      invalidatedSessions,
      providerHold: true,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
