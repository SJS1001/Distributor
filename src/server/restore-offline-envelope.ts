import { types } from "node:util";
import { check, digest } from "./core.ts";

type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;
type SourcePoint = {
  logicalHash: string;
  durableCursor: string;
  auditSequence: number;
};

/** Structural data only: never an authorized task, verified evidence or permit. */
export type OfflineTaskEnvelopeV1 = Immutable<{
  version: 1;
  purpose: "distributor-restore-offline-task-v1";
  requestId: string;
  preparedBy: string;
  executorId: string;
  preparedAt: string;
  expiresAt: string;
  recovery: {
    instanceId: string;
    snapshotHash: string;
    restoredAt: string;
    sourceCompletedAt: string;
    schemaHash: string;
    region: "CA" | "US";
    organizations: { id: string; currency: "CAD" | "USD" }[];
  };
  session: { id: string; revision: number; lineageHash: string };
  candidate: { logicalHash: string; file: { dev: number; ino: number } };
  source: {
    identity: string;
    baseline: SourcePoint;
    end: SourcePoint;
    intervalEvidenceHash: string;
  };
  task: {
    name: string;
    version: number;
    owner: string;
    orgId: string;
    siteIds: string[];
    subjectId: string;
    expectedRevision: number;
    expectedStateHash: string;
    payloadHash: string;
    priorClaim: null | {
      operationId: string;
      tokenHash: string;
      revision: number;
      stateHash: string;
    };
  };
  evidence: {
    setHash: string;
    items: { reference: string; sha256: string; bytes: number }[];
    qualificationHash: string;
  };
  operations: {
    authorityId: string;
    revision: number;
    adapterIdentity: string;
    fenceTokenHash: string;
    observationHash: string;
  };
  trust: { authorityId: string; revision: number; registryHash: string };
}>;

/** Parser policy, not an approved operational freshness/expiry policy. */
export const OFFLINE_ENVELOPE_LIMITS = Object.freeze({
  organizations: 1000,
  sites: 1000,
  evidenceItems: 1000,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  maxApprovalWindowMs: 15 * 60 * 1000,
});
export type OfflineEnvelopePolicy = Readonly<{ maxApprovalWindowMs: number }>;
const defaultPolicy: OfflineEnvelopePolicy = Object.freeze({
  maxApprovalWindowMs: OFFLINE_ENVELOPE_LIMITS.maxApprovalWindowMs,
});

function requireValue(ok: unknown): asserts ok {
  // Do not echo caller values, evidence references or claims in errors.
  check(ok, "RESTORE_OFFLINE_ENVELOPE", "Invalid offline task envelope.", 400);
}

function record(value: unknown, keys: readonly string[]) {
  requireValue(
    value !== null && typeof value === "object" && !types.isProxy(value),
  );
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  const own = Reflect.ownKeys(value);
  requireValue(
    own.length === keys.length &&
      own.every((key) => typeof key === "string" && keys.includes(key)),
  );
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor && "value" in descriptor && descriptor.enumerable);
    result[key] = descriptor.value;
  }
  return result;
}

function list(value: unknown, maximum: number): unknown[] {
  requireValue(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype,
  );
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  requireValue(Number.isSafeInteger(length) && length <= maximum);
  requireValue(Reflect.ownKeys(value).length === length + 1);
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    requireValue(descriptor && "value" in descriptor && descriptor.enumerable);
    result.push(descriptor.value);
  }
  return result;
}

function string(value: unknown, maximum: number): string {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      // Unicode mode treats a valid surrogate pair as one supplementary code
      // point; only lone surrogates match. Compatible with the ES2023 target.
      !/[\ud800-\udfff]/u.test(value),
  );
  return value;
}
function identity(value: unknown, maximum = 160): string {
  const result = string(value, maximum);
  requireValue(
    result === result.trim() && !/[\u0000-\u001f\u007f]/u.test(result),
  );
  return result;
}
function hash(value: unknown): string {
  requireValue(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  return value;
}
function integer(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  requireValue(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      !Object.is(value, -0) &&
      value >= minimum &&
      value <= maximum,
  );
  return value;
}
function choice<T extends string | number>(
  value: unknown,
  choices: readonly T[],
): T {
  requireValue(choices.some((item) => item === value));
  return value as T;
}
function date(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
  );
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString() === value);
  return value;
}
function ordered<T>(values: T[], key: (value: T) => string): T[] {
  // UTF-16 code-unit order, independent of locale. Never sort signed input.
  for (let i = 1; i < values.length; i++) {
    requireValue(key(values[i - 1]!) < key(values[i]!));
  }
  return values;
}
function sourcePoint(value: unknown): SourcePoint {
  const v = record(value, ["logicalHash", "durableCursor", "auditSequence"]);
  return {
    logicalHash: hash(v.logicalHash),
    // Opaque: retain every character, including whitespace; no ordering claims.
    durableCursor: string(v.durableCursor, 2000),
    auditSequence: integer(v.auditSequence),
  };
}
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Parse in-memory data without invoking accessors, proxies or coercions.
 * No current clock, registry, IAM, filesystem, database or operations checks. */
export function parseOfflineTaskEnvelope(
  input: unknown,
  policy: OfflineEnvelopePolicy = defaultPolicy,
): OfflineTaskEnvelopeV1 {
  const p = record(policy, ["maxApprovalWindowMs"]);
  const maximumWindow = integer(
    p.maxApprovalWindowMs,
    1,
    OFFLINE_ENVELOPE_LIMITS.maxApprovalWindowMs,
  );
  const v = record(input, [
    "version",
    "purpose",
    "requestId",
    "preparedBy",
    "executorId",
    "preparedAt",
    "expiresAt",
    "recovery",
    "session",
    "candidate",
    "source",
    "task",
    "evidence",
    "operations",
    "trust",
  ]);
  const preparedAt = date(v.preparedAt);
  const expiresAt = date(v.expiresAt);
  const window = Date.parse(expiresAt) - Date.parse(preparedAt);
  requireValue(window > 0 && window <= maximumWindow);
  const r = record(v.recovery, [
    "instanceId",
    "snapshotHash",
    "restoredAt",
    "sourceCompletedAt",
    "schemaHash",
    "region",
    "organizations",
  ]);
  const organizations = ordered(
    list(r.organizations, OFFLINE_ENVELOPE_LIMITS.organizations).map((item) => {
      const o = record(item, ["id", "currency"]);
      return {
        id: identity(o.id),
        currency: choice(o.currency, ["CAD", "USD"] as const),
      };
    }),
    (o) => o.id,
  );
  requireValue(organizations.length > 0);
  const s = record(v.session, ["id", "revision", "lineageHash"]);
  const c = record(v.candidate, ["logicalHash", "file"]);
  const file = record(c.file, ["dev", "ino"]);
  const source = record(v.source, [
    "identity",
    "baseline",
    "end",
    "intervalEvidenceHash",
  ]);
  const t = record(v.task, [
    "name",
    "version",
    "owner",
    "orgId",
    "siteIds",
    "subjectId",
    "expectedRevision",
    "expectedStateHash",
    "payloadHash",
    "priorClaim",
  ]);
  const orgId = identity(t.orgId);
  requireValue(organizations.some((o) => o.id === orgId));
  const claim =
    t.priorClaim === null
      ? null
      : record(t.priorClaim, [
          "operationId",
          "tokenHash",
          "revision",
          "stateHash",
        ]);
  const e = record(v.evidence, ["setHash", "items", "qualificationHash"]);
  const items = ordered(
    list(e.items, OFFLINE_ENVELOPE_LIMITS.evidenceItems).map((item) => {
      const entry = record(item, ["reference", "sha256", "bytes"]);
      return {
        reference: identity(entry.reference, 2000),
        sha256: hash(entry.sha256),
        bytes: integer(entry.bytes, 1, OFFLINE_ENVELOPE_LIMITS.fileBytes),
      };
    }),
    (item) => item.reference,
  );
  requireValue(
    items.reduce((sum, item) => sum + item.bytes, 0) <=
      OFFLINE_ENVELOPE_LIMITS.totalBytes,
  );
  const o = record(v.operations, [
    "authorityId",
    "revision",
    "adapterIdentity",
    "fenceTokenHash",
    "observationHash",
  ]);
  const trust = record(v.trust, ["authorityId", "revision", "registryHash"]);
  return freeze({
    version: choice(v.version, [1] as const),
    purpose: choice(v.purpose, [
      "distributor-restore-offline-task-v1",
    ] as const),
    requestId: identity(v.requestId),
    preparedBy: identity(v.preparedBy),
    executorId: identity(v.executorId),
    preparedAt,
    expiresAt,
    recovery: {
      instanceId: identity(r.instanceId),
      snapshotHash: hash(r.snapshotHash),
      restoredAt: date(r.restoredAt),
      sourceCompletedAt: date(r.sourceCompletedAt),
      schemaHash: hash(r.schemaHash),
      region: choice(r.region, ["CA", "US"] as const),
      organizations,
    },
    session: {
      id: identity(s.id),
      revision: integer(s.revision),
      lineageHash: hash(s.lineageHash),
    },
    candidate: {
      logicalHash: hash(c.logicalHash),
      file: { dev: integer(file.dev), ino: integer(file.ino) },
    },
    source: {
      identity: identity(source.identity),
      baseline: sourcePoint(source.baseline),
      end: sourcePoint(source.end),
      intervalEvidenceHash: hash(source.intervalEvidenceHash),
    },
    task: {
      name: identity(t.name),
      version: integer(t.version, 1),
      owner: identity(t.owner),
      orgId,
      siteIds: ordered(
        list(t.siteIds, OFFLINE_ENVELOPE_LIMITS.sites).map((item) =>
          identity(item),
        ),
        (item) => item,
      ),
      subjectId: identity(t.subjectId),
      expectedRevision: integer(t.expectedRevision),
      expectedStateHash: hash(t.expectedStateHash),
      payloadHash: hash(t.payloadHash),
      priorClaim:
        claim === null
          ? null
          : {
              operationId: identity(claim.operationId),
              tokenHash: hash(claim.tokenHash),
              revision: integer(claim.revision),
              stateHash: hash(claim.stateHash),
            },
    },
    evidence: {
      setHash: hash(e.setHash),
      items,
      qualificationHash: hash(e.qualificationHash),
    },
    operations: {
      authorityId: identity(o.authorityId),
      revision: integer(o.revision),
      adapterIdentity: identity(o.adapterIdentity),
      fenceTokenHash: hash(o.fenceTokenHash),
      observationHash: hash(o.observationHash),
    },
    trust: {
      authorityId: identity(trust.authorityId),
      revision: integer(trust.revision),
      registryHash: hash(trust.registryHash),
    },
  });
}

// Called only on detached, validated data (fixed keys and primitive leaves).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical UTF-8 JSON, with object keys in code-unit order and no whitespace. */
export function canonicalOfflineTaskEnvelope(
  input: unknown,
  policy?: OfflineEnvelopePolicy,
): string {
  return canonical(parseOfflineTaskEnvelope(input, policy));
}
export function offlineTaskBinding(
  input: unknown,
  policy?: OfflineEnvelopePolicy,
): string {
  return digest(canonicalOfflineTaskEnvelope(input, policy));
}

/** Constructs signing bytes only. No signatures, independence, quorum or current
 * trust are verified; neither this string nor its binding grants authority. */
export function offlineTaskApprovalMessage(
  input: unknown,
  signerId: string,
  role: "finance" | "security",
  policy?: OfflineEnvelopePolicy,
): string {
  const envelope = parseOfflineTaskEnvelope(input, policy);
  const signer = identity(signerId);
  requireValue(
    signer !== envelope.preparedBy && signer !== envelope.executorId,
  );
  return canonical({
    purpose: "distributor-restore-offline-approval-v1",
    binding: digest(canonical(envelope)),
    signerId: signer,
    role: choice(role, ["finance", "security"] as const),
  });
}
