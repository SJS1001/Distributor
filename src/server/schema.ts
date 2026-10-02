import { SHIPMENT_COVERAGE_SCHEMA } from "./shipment-coverage-schema.ts";
import { CLAIM_COVERAGE_SCHEMA } from "./claim-coverage-schema.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonical, digest, check } from "./core.ts";
import type { Region } from "./iam.ts";
import baseline from "./schema-baseline.json" with { type: "json" };
import { CANADA_POST_SCHEMA } from "./canada-post-schema.ts";
import { QUICKBOOKS_REVOCATION_SCHEMA } from "./quickbooks-revocation-schema.ts";
import { ACCOUNTING_CANCELLATION_SCHEMA } from "./accounting-cancellation-schema.ts";

export const SCHEMA_VERSION = 6;
export const SCHEMA_TABLE = "platform_schema_version";
// This DDL is part of the frozen v1 schema identity. Changing it requires a new version.
export const SCHEMA_DDL =
  "CREATE TABLE platform_schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,schema_hash TEXT NOT NULL,event_reports INTEGER NOT NULL CHECK(event_reports IN(0,1)),region TEXT NOT NULL CHECK(region IN('CA','US')),initialized_at TEXT NOT NULL) STRICT";

type SchemaObject = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};
export type SchemaInspection = {
  kind: "empty" | "legacy" | "previous" | "current";
  version: number | null;
  schemaHash: string;
  eventReports: boolean;
  region: Region | null;
  initializedAt: string | null;
};

function fingerprint(objects: SchemaObject[]) {
  return createHash("sha256").update(JSON.stringify(objects)).digest("hex");
}
function objects(db: DatabaseSync): SchemaObject[] {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .all() as SchemaObject[];
}
export function schemaFingerprint(db: DatabaseSync) {
  return fingerprint(objects(db));
}
const profiles = baseline.schemas.map((profile) => {
  check(
    digest(canonical(profile.schema)) === profile.hash,
    "SCHEMA_BASELINE",
    "Frozen schema manifest is inconsistent.",
  );
  const previous = [
    ...profile.schema,
    {
      type: "table",
      name: SCHEMA_TABLE,
      tbl_name: SCHEMA_TABLE,
      sql: SCHEMA_DDL,
    },
  ].sort((a, b) =>
    a.type < b.type
      ? -1
      : a.type > b.type
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
  return {
    eventReports: profile.eventReports,
    legacyHash: fingerprint(profile.schema),
    previousHash: fingerprint(previous),
    versionTwoHash: fingerprint(
      [...previous, ...CANADA_POST_SCHEMA].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionThreeHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFourHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFiveHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    currentHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
  };
});
export function supportedSchemaHash(eventReports: boolean) {
  return profiles.find((p) => p.eventReports === eventReports)!.currentHash;
}

// Storage maintenance only. Callers must establish a single SQLite snapshot and
// must not run application constructors until this exact-schema check succeeds.
export function inspectConnection(db: DatabaseSync): SchemaInspection {
  const entries = objects(db),
    schemaHash = fingerprint(entries);
  if (entries.length === 0)
    return {
      kind: "empty",
      version: null,
      schemaHash,
      eventReports: false,
      region: null,
      initializedAt: null,
    };
  const current = profiles.find((p) => p.currentHash === schemaHash);
  const versionFive = profiles.find((p) => p.versionFiveHash === schemaHash);
  const versionFour = profiles.find((p) => p.versionFourHash === schemaHash);
  const versionThree = profiles.find((p) => p.versionThreeHash === schemaHash);
  const versionTwo = profiles.find((p) => p.versionTwoHash === schemaHash);
  const previous =
    versionFive ??
    versionFour ??
    versionThree ??
    versionTwo ??
    profiles.find((p) => p.previousHash === schemaHash);
  const legacy = profiles.find((p) => p.legacyHash === schemaHash);
  check(
    current || previous || legacy,
    "SCHEMA_DRIFT",
    "Store schema is not an exact supported application schema.",
  );
  const regions = db
    .prepare("SELECT DISTINCT region FROM iam_organizations")
    .all();
  check(
    regions.length <= 1 &&
      regions.every((r) => r.region === "CA" || r.region === "US"),
    "SCHEMA_REGION",
    "Store organizations must belong to one supported region.",
  );
  const region = (regions[0]?.region ?? null) as Region | null;
  if (legacy)
    return {
      kind: "legacy",
      version: null,
      schemaHash,
      eventReports: legacy.eventReports,
      region,
      initializedAt: null,
    };
  const rows = db
    .prepare(
      "SELECT singleton,version,schema_hash,event_reports,region,initialized_at FROM platform_schema_version",
    )
    .all();
  check(
    rows.length === 1 && rows[0]?.singleton === 1,
    "SCHEMA_VERSION",
    "Store requires exactly one schema version receipt.",
  );
  const row = rows[0]!;
  check(
    row.version ===
      (current
        ? SCHEMA_VERSION
        : versionFive
          ? 5
          : versionFour
            ? 4
            : versionThree
              ? 3
              : versionTwo
                ? 2
                : 1),
    "SCHEMA_VERSION",
    "Unsupported schema version; upgrades and downgrades require an explicitly supported procedure.",
  );
  check(
    row.schema_hash === schemaHash &&
      row.event_reports === Number((current ?? previous)!.eventReports),
    "SCHEMA_DRIFT",
    "Schema receipt does not match the exact stored profile.",
  );
  check(
    (row.region === "CA" || row.region === "US") &&
      (region === null || region === row.region),
    "SCHEMA_REGION",
    "Schema receipt and organization regions differ.",
  );
  check(
    typeof row.initialized_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        row.initialized_at,
      ) &&
      Number.isFinite(Date.parse(row.initialized_at)) &&
      new Date(row.initialized_at).toISOString() === row.initialized_at,
    "SCHEMA_VERSION",
    "Schema receipt timestamp is invalid.",
  );
  return {
    kind: current ? "current" : "previous",
    version: current
      ? SCHEMA_VERSION
      : versionFive
        ? 5
        : versionFour
          ? 4
          : versionThree
            ? 3
            : versionTwo
              ? 2
              : 1,
    schemaHash,
    eventReports: (current ?? previous)!.eventReports,
    region: row.region,
    initializedAt: row.initialized_at,
  };
}

export function checkIntegrity(db: DatabaseSync) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  check(
    rows.length === 1 &&
      rows[0]?.integrity_check === "ok" &&
      db.prepare("PRAGMA foreign_key_check").all().length === 0,
    "SCHEMA_INTEGRITY",
    "Store integrity validation failed.",
  );
}

export function checkRegion(
  db: DatabaseSync,
  region: Region,
  requireOrganization: boolean,
) {
  check(
    region === "CA" || region === "US",
    "SCHEMA_REGION",
    "Region must be CA or US.",
  );
  const regions = db
    .prepare("SELECT DISTINCT region FROM iam_organizations")
    .all();
  check(
    regions.length <= 1 &&
      (!requireOrganization || regions.length === 1) &&
      regions.every((r) => r.region === region),
    "SCHEMA_REGION",
    "Store organizations must match the requested runtime region.",
  );
}
