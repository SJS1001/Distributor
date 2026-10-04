import { INTEGRATION_OFFLINE_CANADA_POST_DDL } from "./integration-offline-canada-post-schema.ts";
import { INTEGRATION_OFFLINE_ORIGINAL_DDL } from "./integration-offline-original-schema.ts";
import { INTEGRATION_OFFLINE_REFUND_DDL } from "./integration-offline-refund-schema.ts";
import { RESTORE_OFFLINE_DDL } from "./restore-offline-schema.ts";
import { RESTORE_ACTIVATION_DDL } from "./restore-activation-schema.ts";
import { INVENTORY_QUANTITY_DDL } from "./inventory-quantity-schema.ts";
import { INVENTORY_VALUATION_DDL } from "./inventory-valuation-schema.ts";
import { COST_CORRECTION_CHAIN_UPGRADE_DDL } from "./cost-correction-chain-schema.ts";
import { ORGANIZATION_REVOCATION_DDL } from "./organization-revocation-schema.ts";
import { ORGANIZATION_AUTHORIZATION_DDL } from "./organization-authorization-schema.ts";
import { STOCK_JOURNAL_DDL } from "./stock-journal-schema.ts";
import { ORGANIZATION_RESIDENCY_DDL } from "./organization-residency-schema.ts";
import { COST_CORRECTION_RETRY_DDL } from "./cost-correction-retry-schema.ts";
import { COST_CORRECTION_OUTCOME_DDL } from "./cost-correction-outcome-schema.ts";
import { COST_CORRECTION_DDL } from "./cost-correction-schema.ts";
import { SUPPLIER_AVAILABILITY_DDL } from "./supplier-availability-schema.ts";
import { SHIPMENT_COVERAGE_DDL } from "./shipment-coverage-schema.ts";
import { CLAIM_COVERAGE_DDL } from "./claim-coverage-schema.ts";
import { backup, DatabaseSync } from "node:sqlite";
import { lstatSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { check } from "./core.ts";
import type { Region } from "./iam.ts";
import { CANADA_POST_DDL } from "./canada-post-schema.ts";
import { QUICKBOOKS_REVOCATION_DDL } from "./quickbooks-revocation-schema.ts";
import { ACCOUNTING_CANCELLATION_DDL } from "./accounting-cancellation-schema.ts";
import {
  checkIntegrity,
  checkRegion,
  inspectConnection,
  SCHEMA_DDL,
  SCHEMA_VERSION,
  supportedSchemaHash,
  type SchemaInspection,
} from "./schema.ts";

function regularSource(path: string) {
  const stat = lstatSync(path);
  check(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0,
    "SCHEMA_PATH",
    "Source must be a nonempty regular database file.",
  );
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      const sidecar = lstatSync(path + suffix);
      check(
        sidecar.isFile() && !sidecar.isSymbolicLink(),
        "SCHEMA_PATH",
        "Source sidecars must be regular files.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return stat;
}

/** Read-only filesystem inspection. No application constructors or business data
 * projections run. SQLite's read transaction binds the receipt to one snapshot. */
export function inspectSchema(path: string): SchemaInspection {
  regularSource(path);
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    db.exec("PRAGMA trusted_schema=OFF; BEGIN");
    const inspection = inspectConnection(db);
    checkIntegrity(db);
    db.exec("COMMIT");
    return inspection;
  } finally {
    db.close();
  }
}

async function freshDestination(path: string) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  check(
    stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    "SCHEMA_PATH",
    "Destination requires a private directory (mode 0700) without a directory symlink.",
  );
  for (const name of [path, path + "-wal", path + "-shm", path + "-journal"]) {
    try {
      await lstat(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    check(
      false,
      "SCHEMA_EXISTS",
      "Upgrade never overwrites a destination or database sidecar.",
    );
  }
  return parent;
}
async function synchronize(path: string) {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export type SchemaUpgradeReceipt = {
  sourceSchemaHash: string;
  sourceVersion: number | null;
  schemaHash: string;
  version: number;
  eventReports: boolean;
  region: Region;
  startedAt: string;
  completedAt: string;
  destination: string;
  bytes: number;
};

/** Filesystem-authorized, explicit upgrade to a fresh file. Operators must stop
 * old writers and separately review activation. A consistent SQLite backup and
 * schema fingerprint are neither writer fencing nor business authority. */
export async function upgradeSchema(
  source: string,
  destination: string,
  expectedSourceSchemaHash: string,
  region: Region,
): Promise<SchemaUpgradeReceipt> {
  check(
    region === "CA" || region === "US",
    "SCHEMA_REGION",
    "Region must be CA or US.",
  );
  check(
    /^[a-f0-9]{64}$/.test(expectedSourceSchemaHash),
    "SCHEMA_FINGERPRINT",
    "Expected source schema must be a lowercase SHA256 fingerprint.",
  );
  source = resolve(source);
  destination = resolve(destination);
  const original = regularSource(source);
  const parent = await freshDestination(destination);
  const work = await mkdtemp(join(parent, ".schema-upgrade-"));
  const snapshot = join(work, "snapshot.db");
  const startedAt = new Date().toISOString();
  try {
    const sourceDb = new DatabaseSync(source, {
      readOnly: true,
      timeout: 5000,
    });
    try {
      sourceDb.exec("PRAGMA trusted_schema=OFF; BEGIN");
      const sourceInspection = inspectConnection(sourceDb);
      check(
        sourceInspection.kind !== "empty" &&
          sourceInspection.schemaHash === expectedSourceSchemaHash,
        "SCHEMA_FINGERPRINT",
        "Source schema does not match the reviewed fingerprint.",
      );
      checkIntegrity(sourceDb);
      checkRegion(sourceDb, region, true);
      check(
        sourceInspection.region === region,
        "SCHEMA_REGION",
        "Source and requested regions differ.",
      );
      // Native SQLite backup includes committed WAL pages. No file-copy fallback.
      await backup(sourceDb, snapshot);
      sourceDb.exec("COMMIT");
    } finally {
      sourceDb.close();
    }
    const stillSource = regularSource(source);
    check(
      original.dev === stillSource.dev && original.ino === stillSource.ino,
      "SCHEMA_PATH",
      "Source file identity changed during the copy.",
    );
    await chmod(snapshot, 0o600);
    const copied = new DatabaseSync(snapshot, { timeout: 5000 });
    let before: SchemaInspection, after: SchemaInspection;
    try {
      copied.exec(
        "PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE",
      );
      before = inspectConnection(copied);
      check(
        before.kind !== "empty" &&
          before.schemaHash === expectedSourceSchemaHash,
        "SCHEMA_FINGERPRINT",
        "Copied snapshot differs from the reviewed source schema.",
      );
      checkIntegrity(copied);
      checkRegion(copied, region, true);
      check(
        before.region === region,
        "SCHEMA_REGION",
        "Copied snapshot and requested regions differ.",
      );
      if (before.kind === "legacy") {
        // Exact frozen legacy shape only: retain every existing business row,
        // add empty group storage and a receipt. No constructors or backfills.
        copied.exec(SCHEMA_DDL);
        copied.exec(CANADA_POST_DDL);
        copied.exec(QUICKBOOKS_REVOCATION_DDL);
        copied.exec(ACCOUNTING_CANCELLATION_DDL);
        copied.exec(CLAIM_COVERAGE_DDL);
        copied.exec(SHIPMENT_COVERAGE_DDL);
        copied.exec(SUPPLIER_AVAILABILITY_DDL);
        copied.exec(COST_CORRECTION_DDL);
        copied.exec(COST_CORRECTION_OUTCOME_DDL);
        copied.exec(COST_CORRECTION_RETRY_DDL);
        copied.exec(ORGANIZATION_RESIDENCY_DDL);
        copied.exec(STOCK_JOURNAL_DDL);
        copied.exec(ORGANIZATION_AUTHORIZATION_DDL);
        copied.exec(ORGANIZATION_REVOCATION_DDL);
        copied.exec(COST_CORRECTION_CHAIN_UPGRADE_DDL);
        copied.exec(INVENTORY_VALUATION_DDL);
        copied.exec(INVENTORY_QUANTITY_DDL);
        copied.exec(RESTORE_ACTIVATION_DDL);
        copied.exec(RESTORE_OFFLINE_DDL);
        copied.exec(INTEGRATION_OFFLINE_REFUND_DDL);
        copied.exec(INTEGRATION_OFFLINE_ORIGINAL_DDL);
        copied.exec(INTEGRATION_OFFLINE_CANADA_POST_DDL);
        copied
          .prepare("INSERT INTO platform_schema_version VALUES(1,?,?,?,?,?)")
          .run(
            SCHEMA_VERSION,
            supportedSchemaHash(before.eventReports),
            Number(before.eventReports),
            region,
            new Date().toISOString(),
          );
      } else if (before.kind === "previous") {
        if (before.version === 1) copied.exec(CANADA_POST_DDL);
        if (before.version! <= 2) copied.exec(QUICKBOOKS_REVOCATION_DDL);
        if (before.version! <= 3) copied.exec(ACCOUNTING_CANCELLATION_DDL);
        if (before.version! <= 4) copied.exec(CLAIM_COVERAGE_DDL);
        if (before.version! <= 5) copied.exec(SHIPMENT_COVERAGE_DDL);
        if (before.version! <= 6) copied.exec(SUPPLIER_AVAILABILITY_DDL);
        if (before.version! <= 7) copied.exec(COST_CORRECTION_DDL);
        if (before.version! <= 8) copied.exec(COST_CORRECTION_OUTCOME_DDL);
        if (before.version! <= 9) copied.exec(COST_CORRECTION_RETRY_DDL);
        if (before.version! <= 10) copied.exec(ORGANIZATION_RESIDENCY_DDL);
        if (before.version! <= 11) copied.exec(STOCK_JOURNAL_DDL);
        if (before.version! <= 12) copied.exec(ORGANIZATION_AUTHORIZATION_DDL);
        if (before.version! <= 13) copied.exec(ORGANIZATION_REVOCATION_DDL);
        if (before.version! <= 14)
          copied.exec(COST_CORRECTION_CHAIN_UPGRADE_DDL);
        if (before.version! <= 15) copied.exec(INVENTORY_VALUATION_DDL);
        if (before.version! <= 16) copied.exec(INVENTORY_QUANTITY_DDL);
        if (before.version! <= 16) copied.exec(RESTORE_ACTIVATION_DDL);
        if (before.version! <= 17) copied.exec(RESTORE_OFFLINE_DDL);
        if (before.version! <= 18) copied.exec(INTEGRATION_OFFLINE_REFUND_DDL);
        if (before.version! <= 19)
          copied.exec(INTEGRATION_OFFLINE_ORIGINAL_DDL);
        if (before.version! <= 20)
          copied.exec(INTEGRATION_OFFLINE_CANADA_POST_DDL);
        copied
          .prepare(
            "UPDATE platform_schema_version SET version=?,schema_hash=? WHERE singleton=1",
          )
          .run(SCHEMA_VERSION, supportedSchemaHash(before.eventReports));
      }
      after = inspectConnection(copied);
      checkIntegrity(copied);
      checkRegion(copied, region, true);
      copied.exec("COMMIT");
    } catch (error) {
      if (copied.isTransaction) copied.exec("ROLLBACK");
      throw error;
    } finally {
      copied.close();
    }
    // Verify the closed, self-contained file, then synchronize before publishing.
    const publishedInspection = inspectSchema(snapshot);
    check(
      publishedInspection.schemaHash === after.schemaHash,
      "SCHEMA_DRIFT",
      "Completed upgrade schema differs from its receipt.",
    );
    const bytes = (await lstat(snapshot)).size;
    await chmod(snapshot, 0o600);
    await synchronize(snapshot);
    await freshDestination(destination);
    // Exclusive hard link: an existing destination can never be replaced.
    await link(snapshot, destination);
    await synchronize(parent);
    return {
      sourceSchemaHash: before.schemaHash,
      sourceVersion: before.version,
      schemaHash: after.schemaHash,
      version: SCHEMA_VERSION,
      eventReports: after.eventReports,
      region,
      startedAt,
      completedAt: new Date().toISOString(),
      destination,
      bytes,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
