import { canonical, check, integer, text, type Actor } from "./core.ts";
import type { Identity } from "./iam.ts";

export type ImportManifest = {
  version: 1;
  batchRef: string;
  sourceRef: string;
  sourceHash: string;
  cutoffAt: string;
  region: "CA" | "US";
  currency: "CAD" | "USD";
  expectedQuantity: number;
  expectedValue: number;
  acknowledgment: string;
  rows: unknown[];
};
export type MasterReview = {
  sourceId: string;
  targetId: string | null;
  targetHash: string | null;
  matchKey: string;
  name: string;
  value: number;
};
export type MasterMapping = {
  sourceId: string;
  targetId: string;
  action: "create" | "match";
  value: number;
};
export function importFields(raw: unknown, fields: string[]) {
  check(
    raw && typeof raw === "object" && !Array.isArray(raw),
    "VALIDATION",
    "Import row must be an object.",
    400,
  );
  const row = raw as Record<string, unknown>;
  check(
    Object.keys(row).length === fields.length &&
      fields.every((f) => Object.hasOwn(row, f)),
    "VALIDATION",
    "Import row fields must match the versioned format.",
    400,
  );
  return row;
}
export function normalizeManifest<T extends ImportManifest>(
  actor: Actor,
  input: T,
  identity: Identity,
  extraFields: string[] = [],
): T {
  importFields(input, [
    "version",
    "batchRef",
    "sourceRef",
    "sourceHash",
    "cutoffAt",
    "region",
    "currency",
    "expectedQuantity",
    "expectedValue",
    "acknowledgment",
    "rows",
    ...extraFields,
  ]);
  check(
    input.version === 1,
    "IMPORT_VERSION",
    "Import format must be version 1.",
    400,
  );
  check(
    Array.isArray(input.rows) &&
      input.rows.length > 0 &&
      input.rows.length <= 500,
    "VALIDATION",
    "Import must contain 1–500 rows.",
    400,
  );
  const org = identity.organization(actor);
  check(
    input.region === org.region && input.currency === org.currency,
    "REGION",
    "Import region/currency must match this store; no implicit conversion or migration is supported.",
  );
  check(
    typeof input.sourceHash === "string" &&
      /^[a-f0-9]{64}$/.test(input.sourceHash),
    "VALIDATION",
    "Source hash must be a lowercase SHA-256.",
    400,
  );
  check(
    typeof input.cutoffAt === "string" &&
      Number.isFinite(Date.parse(input.cutoffAt)) &&
      new Date(input.cutoffAt).toISOString() === input.cutoffAt &&
      Date.parse(input.cutoffAt) <= Date.now(),
    "VALIDATION",
    "Cutoff must be a canonical UTC timestamp in the past.",
    400,
  );
  check(
    canonical(input).length <= 700000,
    "IMPORT_SIZE",
    "Import exceeds the supported batch size.",
    400,
  );
  return {
    ...input,
    batchRef: text(input.batchRef, "batch reference"),
    sourceRef: text(input.sourceRef, "source reference"),
    acknowledgment: text(
      input.acknowledgment,
      "source rights and cutoff acknowledgment",
      2000,
    ),
    expectedQuantity: integer(
      input.expectedQuantity,
      "independent quantity",
      0,
      1e9,
    ),
    expectedValue: integer(input.expectedValue, "independent value", 0, 1e12),
  };
}
