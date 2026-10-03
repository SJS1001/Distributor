import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { types } from "node:util";
import { check, digest } from "./core.ts";
import {
  offlineTaskApprovalMessage,
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
  type OfflineEnvelopePolicy,
} from "./restore-offline-envelope.ts";

type Role = "finance" | "security";
export type OfflineApproval = Readonly<{
  signerId: string;
  role: Role;
  binding: string;
  signature: string;
}>;
export type OfflineApprovalRosterEntry = Readonly<{
  id: string;
  role: Role;
  personId: string;
  /** Canonical PEM of an Ed25519 SPKI PUBLIC KEY, including final newline. */
  publicKey: string;
}>;
type PersonAssociation = Readonly<{ id: string; personId: string }>;
export type OfflineApprovalAssociations = Readonly<{
  preparer: PersonAssociation;
  executor: PersonAssociation;
  operations: PersonAssociation;
}>;
type SignerSummary = Readonly<{
  signerId: string;
  role: Role;
  personId: string;
  keyFingerprint: string;
}>;
/** Describes supplied bytes only. Not current trust, authority or a permit. */
export type OfflineApprovalSummary = Readonly<{
  binding: string;
  rosterFingerprint: string;
  associationsFingerprint: string;
  signers: readonly [SignerSummary, SignerSummary];
}>;
export const OFFLINE_APPROVAL_ROSTER_LIMIT = 256;

function requireValue(ok: unknown): asserts ok {
  check(
    ok,
    "RESTORE_OFFLINE_APPROVAL",
    "Invalid offline approval evidence.",
    400,
  );
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
    const d = Object.getOwnPropertyDescriptor(value, key);
    requireValue(d && "value" in d && d.enumerable);
    result[key] = d.value;
  }
  return result;
}
function list(value: unknown, minimum: number, maximum: number): unknown[] {
  requireValue(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype,
  );
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  requireValue(
    Number.isSafeInteger(length) &&
      length >= minimum &&
      length <= maximum &&
      Reflect.ownKeys(value).length === length + 1,
  );
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    requireValue(d && "value" in d && d.enumerable);
    result.push(d.value);
  }
  return result;
}
function identity(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
  return value;
}
function role(value: unknown): Role {
  requireValue(value === "finance" || value === "security");
  return value;
}
function hash(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      value.length === 64 &&
      /^[a-f0-9]{64}$/.test(value),
  );
  return value;
}

const fieldPrime = (1n << 255n) - 19n;
const scalarOrder = (1n << 252n) + 27742317777372353535851937790883648493n;
const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
function mod(value: bigint): bigint {
  return ((value % fieldPrime) + fieldPrime) % fieldPrime;
}
function power(value: bigint, exponent: bigint): bigint {
  // Only fixed public exponents below 2^255 are passed. No input-sized loops.
  let result = 1n;
  for (let bit = 0; bit < 255; bit++) {
    if ((exponent >> BigInt(bit)) & 1n) result = mod(result * value);
    value = mod(value * value);
  }
  return result;
}
const curveD = mod(-121665n * power(121666n, fieldPrime - 2n));
const sqrtMinusOne = power(2n, (fieldPrime - 1n) / 4n);
function littleEndian32(bytes: Uint8Array): bigint {
  requireValue(bytes.length === 32);
  let value = 0n;
  for (let i = 31; i >= 0; i--) value = (value << 8n) + BigInt(bytes[i]!);
  return value;
}
type ExtendedPoint = readonly [bigint, bigint, bigint, bigint];
function addPoints(p: ExtendedPoint, q: ExtendedPoint): ExtendedPoint {
  // Complete extended-coordinate addition, RFC 8032 section 5.1.4.
  const a = mod((p[1] - p[0]) * (q[1] - q[0])),
    b = mod((p[1] + p[0]) * (q[1] + q[0])),
    c = mod(2n * curveD * p[3] * q[3]),
    d = mod(2n * p[2] * q[2]);
  const e = mod(b - a),
    f = mod(d - c),
    g = mod(d + c),
    h = mod(b + a);
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}
function strictPoint(bytes: Uint8Array): void {
  // RFC 8032 sections 5.1.1/5.1.3: decode a canonical point on edwards25519.
  // This is public-data validation, not signing or a replacement verifier.
  const encoded = littleEndian32(bytes);
  const signBit = encoded >> 255n;
  const y = encoded & ((1n << 255n) - 1n);
  requireValue(y < fieldPrime);
  const ySquared = mod(y * y);
  const denominator = mod(curveD * ySquared + 1n);
  requireValue(denominator !== 0n);
  const xSquared = mod((ySquared - 1n) * power(denominator, fieldPrime - 2n));
  let x = power(xSquared, (fieldPrime + 3n) / 8n);
  if (mod(x * x) !== xSquared) x = mod(x * sqrtMinusOne);
  requireValue(mod(x * x) === xSquared && !(x === 0n && signBit === 1n));
  if ((x & 1n) !== signBit) x = fieldPrime - x;

  // Local recovery policy requires nonidentity prime-subgroup A/R, stricter
  // than just excluding small-order points. [8]P != identity still admits
  // a prime-subgroup point plus nonzero torsion. Require [L]P == identity.
  // This validates public data only; native crypto still verifies signatures.
  requireValue(!(x === 0n && y === 1n));
  let point: ExtendedPoint = [x, y, 1n, mod(x * y)];
  let product: ExtendedPoint = [0n, 1n, 1n, 0n];
  for (let bit = 0; bit < 253; bit++) {
    if ((scalarOrder >> BigInt(bit)) & 1n) product = addPoints(product, point);
    point = addPoints(point, point);
  }
  requireValue(
    product[2] !== 0n &&
      product[0] === 0n &&
      product[1] === product[2] &&
      product[3] === 0n,
  );
}
function signature(value: unknown): Buffer {
  requireValue(
    typeof value === "string" &&
      value.length === 88 &&
      /^[A-Za-z0-9+/]{86}==$/.test(value),
  );
  const bytes = Buffer.from(value, "base64");
  requireValue(bytes.length === 64 && bytes.toString("base64") === value);
  // The RFC scalar range is checked here, never delegated to host crypto.
  requireValue(littleEndian32(bytes.subarray(32)) < scalarOrder);
  strictPoint(bytes.subarray(0, 32));
  return bytes;
}
function publicKey(value: unknown): KeyObject {
  // Canonical Ed25519 SPKI has 44 DER bytes, encoded as one 60-character line.
  // A strict PUBLIC KEY header prevents createPublicKey accepting private keys.
  requireValue(
    typeof value === "string" &&
      value.length === 113 &&
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]{59}=\n-----END PUBLIC KEY-----\n$/.test(
        value,
      ),
  );
  let key: KeyObject;
  try {
    key = createPublicKey({ key: value, format: "pem", type: "spki" });
  } catch {
    requireValue(false);
  }
  requireValue(
    key.type === "public" &&
      key.asymmetricKeyType === "ed25519" &&
      key.export({ type: "spki", format: "pem" }) === value,
  );
  const der = key.export({ type: "spki", format: "der" });
  requireValue(der.length === 44 && der.subarray(0, 12).equals(spkiPrefix));
  strictPoint(der.subarray(12));
  return key;
}
type ParsedRosterEntry = {
  id: string;
  role: Role;
  personId: string;
  key: KeyObject;
  keyFingerprint: string;
};
function roster(input: unknown): ParsedRosterEntry[] {
  const ids = new Set<string>(),
    keys = new Set<string>();
  return list(input, 2, OFFLINE_APPROVAL_ROSTER_LIMIT).map((item) => {
    const v = record(item, ["id", "role", "personId", "publicKey"]);
    const id = identity(v.id),
      personId = identity(v.personId),
      r = role(v.role);
    const key = publicKey(v.publicKey);
    const keyFingerprint = digest(key.export({ type: "spki", format: "der" }));
    requireValue(!ids.has(id) && !keys.has(keyFingerprint));
    ids.add(id);
    keys.add(keyFingerprint);
    return { id, role: r, personId, key, keyFingerprint };
  });
}
function rosterFingerprint(entries: ParsedRosterEntry[]): string {
  // A local fingerprint domain, explicitly NOT envelope.trust.registryHash.
  const rows = entries
    .map(({ id, role, personId, keyFingerprint }) => ({
      id,
      role,
      personId,
      keyFingerprint,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return digest(
    JSON.stringify({
      purpose: "distributor-restore-offline-roster-v1",
      entries: rows,
    }),
  );
}
/** Fingerprint of complete supplied roster bytes after strict decoding; no trust
 * qualification, approval check, clock or registry lookup is performed. */
export function offlineApprovalRosterFingerprint(input: unknown): string {
  return rosterFingerprint(roster(input));
}
function associations(input: unknown): OfflineApprovalAssociations {
  const v = record(input, ["preparer", "executor", "operations"]);
  function person(value: unknown): PersonAssociation {
    const p = record(value, ["id", "personId"]);
    return { id: identity(p.id), personId: identity(p.personId) };
  }
  return {
    preparer: person(v.preparer),
    executor: person(v.executor),
    operations: person(v.operations),
  };
}

/** Pure verification of supplied signatures/identity assertions. Caller claims
 * are not independently authenticated by this function. Bundle order is exactly
 * [finance, security]; no authority, expiry or operations truth is established. */
export function verifyOfflineTaskApprovals(
  input: unknown,
  approvalInput: unknown,
  rosterInput: unknown,
  associationInput: unknown,
  policy?: OfflineEnvelopePolicy,
): OfflineApprovalSummary {
  const envelope = parseOfflineTaskEnvelope(input, policy);
  const binding = offlineTaskBinding(envelope, policy);
  const entries = roster(rosterInput);
  const people = associations(associationInput);
  requireValue(
    people.preparer.id === envelope.preparedBy &&
      people.executor.id === envelope.executorId &&
      people.operations.id === envelope.operations.authorityId,
  );
  const duties = [people.preparer, people.executor, people.operations];
  // Same preparer/executor is permitted only with a consistent person mapping.
  // Operations must remain separate from both, as required by the contract.
  requireValue(
    (people.preparer.id !== people.executor.id ||
      people.preparer.personId === people.executor.personId) &&
      [people.preparer, people.executor].every(
        (p) =>
          p.id !== people.operations.id &&
          p.personId !== people.operations.personId,
      ),
  );
  for (const entry of entries) {
    requireValue(
      duties.every((p) => p.id !== entry.id || p.personId === entry.personId),
    );
  }
  const approvals = list(approvalInput, 2, 2).map((item, i) => {
    const v = record(item, ["signerId", "role", "binding", "signature"]);
    const signerId = identity(v.signerId),
      r = role(v.role);
    requireValue(
      r === (i === 0 ? "finance" : "security") && hash(v.binding) === binding,
    );
    const bytes = signature(v.signature);
    const entry = entries.find((e) => e.id === signerId);
    requireValue(
      entry &&
        entry.role === r &&
        duties.every((p) => p.id !== signerId && p.personId !== entry.personId),
    );
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(
          offlineTaskApprovalMessage(envelope, signerId, r, policy),
          "utf8",
        ),
        entry.key,
        bytes,
      );
    } catch {
      requireValue(false);
    }
    requireValue(valid);
    return Object.freeze({
      signerId,
      role: r,
      personId: entry.personId,
      keyFingerprint: entry.keyFingerprint,
    });
  });
  const finance = approvals[0]!,
    security = approvals[1]!;
  requireValue(
    finance.signerId !== security.signerId &&
      finance.personId !== security.personId &&
      finance.keyFingerprint !== security.keyFingerprint,
  );
  return Object.freeze({
    binding,
    rosterFingerprint: rosterFingerprint(entries),
    associationsFingerprint: digest(
      JSON.stringify({
        purpose: "distributor-restore-offline-associations-v1",
        preparer: people.preparer,
        executor: people.executor,
        operations: people.operations,
      }),
    ),
    signers: Object.freeze([finance, security] as const),
  });
}
