/** Private native historical-maintenance boundary. No IO, grant or release.
 * Strict Ed25519 public-data decoding is adapted from this repository's
 * restore-offline-approvals.ts. Native trust is separately loaded after observe.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { types } from "node:util";
import { canonical, check } from "./core.ts";
import type { Actor } from "./core.ts";
import type {
  RestoreNativeDispositionConfiguration,
  RestoreNativeMaintenanceAssociation,
  RestoreNativeMaintenanceMapping,
  RestoreNativeMaintenanceRequest,
} from "./restore-activation.ts";

const LIMIT = 256;
function requireValue(ok: unknown): asserts ok {
  check(
    ok,
    "RESTORE_MAINTENANCE_AUTHORITY",
    "Current native maintenance evidence is malformed or unavailable.",
  );
}
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
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
function list(value: unknown): unknown[] {
  requireValue(
    value !== null && typeof value === "object" && !types.isProxy(value),
  );
  requireValue(
    Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype,
  );
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  requireValue(Number.isSafeInteger(length) && length >= 0 && length <= LIMIT);
  requireValue(Reflect.ownKeys(value).length === length + 1);
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
      Buffer.byteLength(value, "utf8") <= 160 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
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
function timestamp(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      value.length === 24 &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
  return value;
}
function projection(
  value: unknown,
): RestoreNativeMaintenanceRequest["projection"] {
  requireValue(
    value === "canceled-unsent-credit-application" ||
      value === "superseded-unsent-checkout" ||
      value === "canceled-unused-membership",
  );
  return value;
}
function request(input: unknown): RestoreNativeMaintenanceRequest {
  const v = record(input, [
    "orgId",
    "projection",
    "recordId",
    "recordHash",
    "purpose",
    "challenge",
    "nativePrincipalId",
    "externalAuthorityId",
    "generation",
  ]);
  const g = record(v.generation, [
    "snapshotHash",
    "restoredAt",
    "sourceCompletedAt",
  ]);
  requireValue(v.purpose === "distributor-restore-native-history-v1");
  const challenge = identity(v.challenge);
  requireValue(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      challenge,
    ),
  );
  return {
    orgId: identity(v.orgId),
    projection: projection(v.projection),
    recordId: identity(v.recordId),
    recordHash: hash(v.recordHash),
    purpose: v.purpose,
    challenge,
    nativePrincipalId: identity(v.nativePrincipalId),
    externalAuthorityId: identity(v.externalAuthorityId),
    generation: {
      snapshotHash: hash(g.snapshotHash),
      restoredAt: timestamp(g.restoredAt),
      sourceCompletedAt: timestamp(g.sourceCompletedAt),
    },
  };
}
function principal(input: unknown): Actor {
  const v = record(input, [
    "id",
    "orgId",
    "accountId",
    "role",
    "sites",
    "name",
  ]);
  requireValue(
    v.accountId === null && (v.role === "finance" || v.role === "warehouse"),
  );
  const sites = list(v.sites).map(identity);
  requireValue(new Set(sites).size === sites.length);
  return {
    id: identity(v.id),
    orgId: identity(v.orgId),
    accountId: null,
    role: v.role,
    sites,
    name: identity(v.name),
  };
}
export function captureNativeMaintenanceConfiguration(
  input: unknown,
): RestoreNativeDispositionConfiguration {
  const v = record(input, ["mappings", "loadTrust", "observe"]);
  requireValue(
    typeof v.loadTrust === "function" &&
      !types.isProxy(v.loadTrust) &&
      typeof v.observe === "function" &&
      !types.isProxy(v.observe),
  );
  const loadTrust = v.loadTrust,
    observe = v.observe;
  const mappings = list(v.mappings).map(
    (value): RestoreNativeMaintenanceMapping => {
      const m = record(value, [
        "orgId",
        "projection",
        "principal",
        "externalAuthorityId",
      ]);
      return {
        orgId: identity(m.orgId),
        projection: projection(m.projection),
        principal: principal(m.principal),
        externalAuthorityId: identity(m.externalAuthorityId),
      };
    },
  );
  return {
    mappings,
    loadTrust: () => Reflect.apply(loadTrust, input, []),
    observe: (value) => Reflect.apply(observe, input, [value]),
  };
}
export function captureNativeMaintenanceAssociation(
  input: unknown,
  expected: RestoreNativeMaintenanceRequest,
): RestoreNativeMaintenanceAssociation {
  const v = record(input, [
    "request",
    "associationId",
    "evidenceHash",
    "observedAt",
    "validUntil",
    "signature",
  ]);
  const observed = request(v.request);
  // Capture expected too; canonical never sees callback-owned objects.
  requireValue(canonical(observed) === canonical(request(expected)));
  requireValue(
    Number.isSafeInteger(v.observedAt) && Number.isSafeInteger(v.validUntil),
  );
  requireValue(
    typeof v.signature === "string" &&
      v.signature.length === 88 &&
      /^[A-Za-z0-9+/]{86}==$/.test(v.signature),
  );
  return {
    request: observed,
    associationId: identity(v.associationId),
    evidenceHash: hash(v.evidenceHash),
    observedAt: v.observedAt as number,
    validUntil: v.validUntil as number,
    signature: v.signature,
  };
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

  // Explicit local strict policy: exclude all eight small-order points in A/R.
  // Three projective doublings (RFC 8032 section 5.1.4) compute [8]P;
  // reject the neutral point (0:Z:Z). No full signature equation is evaluated.
  let X = x,
    Y = y,
    Z = 1n;
  for (let i = 0; i < 3; i++) {
    const a = mod(X * X),
      b = mod(Y * Y),
      c = mod(2n * Z * Z);
    const h = mod(a + b),
      e = mod(h - (X + Y) * (X + Y));
    const g = mod(a - b),
      f = mod(c + g);
    X = mod(e * f);
    Y = mod(g * h);
    Z = mod(f * g);
  }
  requireValue(Z !== 0n && !(X === 0n && Y === Z));

  // Same RFC 8032 public-point arithmetic, with a fixed [L]P subgroup check.
  // The existing [8]P test excludes torsion-only points but not P+torsion.
  // RFC 8032 extended-coordinate addition below is used only with public
  // points and a fixed 253-bit scalar; never signing or the signature equation.
  type Point = readonly [bigint, bigint, bigint, bigint];
  function add(p: Point, q: Point): Point {
    const a = mod((p[1] - p[0]) * (q[1] - q[0]));
    const b = mod((p[1] + p[0]) * (q[1] + q[0]));
    const c = mod(2n * curveD * p[3] * q[3]);
    const d = mod(2n * p[2] * q[2]);
    const e = mod(b - a),
      f = mod(d - c),
      g = mod(d + c),
      h = mod(b + a);
    return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
  }
  let accumulated: Point = [0n, 1n, 1n, 0n];
  let multiple: Point = [x, y, 1n, mod(x * y)];
  for (let bit = 0; bit < 253; bit++) {
    if ((scalarOrder >> BigInt(bit)) & 1n)
      accumulated = add(accumulated, multiple);
    multiple = add(multiple, multiple);
  }
  requireValue(
    accumulated[2] !== 0n &&
      accumulated[0] === 0n &&
      accumulated[1] === accumulated[2],
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

/** Capture and preflight the COMPLETE roster before ANY key import or signature
 * work. All identities/keys are bounded and ambiguous IDs/key aliases refuse.
 * This parser does not load trust or grant native authority.
 */
export function captureNativeMaintenanceTrust(
  input: unknown,
): readonly { id: string; key: KeyObject }[] {
  const ids = new Set<string>(),
    keys = new Set<string>();
  const captured = list(input).map((item) => {
    const v = record(item, ["id", "publicKey"]);
    const id = identity(v.id);
    requireValue(
      typeof v.publicKey === "string" &&
        v.publicKey.length === 113 &&
        Buffer.byteLength(v.publicKey, "utf8") === 113 &&
        /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]{59}=\n-----END PUBLIC KEY-----\n$/.test(
          v.publicKey,
        ),
    );
    requireValue(!ids.has(id) && !keys.has(v.publicKey));
    ids.add(id);
    keys.add(v.publicKey);
    return { id, publicKey: v.publicKey };
  });
  // No key import happens until the complete roster passes descriptor, identity,
  // UTF-8, PEM and ambiguity preflight. Validate even unrelated roster keys.
  return captured.map((entry) => ({
    id: entry.id,
    key: publicKey(entry.publicKey),
  }));
}
export function verifyNativeMaintenanceSignature(
  body: Omit<RestoreNativeMaintenanceAssociation, "signature">,
  encodedSignature: string,
  key: KeyObject,
): void {
  // All plain shape/count/byte capture has already completed. Point/scalar
  // validation is host-independent; OpenSSL only evaluates the final signature.
  const bytes = signature(encodedSignature);
  requireValue(verify(null, Buffer.from(canonical(body)), key, bytes));
}
