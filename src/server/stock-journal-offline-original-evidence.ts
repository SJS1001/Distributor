import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import {
  StockJournalDelivery,
  type OfflineOriginalJournalReview,
} from "./stock-journal-delivery.ts";
import {
  originalCancellationEvidenceInput,
  type OriginalCancellationEvidenceInput,
} from "./stock-journal-original-cancellation.ts";

// This is a captured assertion profile, not a provider response/qualification API.
export type OfflineOriginalCancellationSnapshot = {
  version: 1;
  orgId: string;
  journalId: string;
  reviewHash: string;
  sourceId: string;
  sourceHash: string;
  postingDate: string;
  realm: string;
  bindingId: string;
  requestRef: string;
  region: "CA" | "US";
  currency: "CAD" | "USD";
  debit: number;
  credit: number;
  historyHash: string;
};
export type OfflineOriginalProviderClaim = {
  profile: "quickbooks-sandbox-original-final-cancellation-unposted-v1";
  outcome: "cancelled-unposted";
  request: OfflineOriginalCancellationSnapshot & { intentHash: string };
  attestation: OriginalCancellationEvidenceInput;
};
export type OfflineOriginalEvidenceInput = {
  version: 1;
  source: OfflineOriginalJournalReview;
  candidate: OfflineOriginalJournalReview;
  providerClaims: readonly [OfflineOriginalProviderClaim];
};
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
export type CapturedOfflineOriginalEvidence = Frozen<{
  version: 1;
  purpose: "distributor-stock-journal-offline-original-evidence-v1";
  profile: typeof bounds;
  native: OfflineOriginalJournalReview;
  sourceProjectionHash: string;
  candidateProjectionHash: string;
  claim: OfflineOriginalProviderClaim;
  cancellationSnapshot: OfflineOriginalCancellationSnapshot;
  hash: string;
}>;
const bounds = Object.freeze({
  // The actual owner projection allows 8MB, including repeated immutable plans.
  // Capture two full projections, plus a small fixed assertion, without a 64KiB
  // refund-specific ceiling. Deeper/denser native graphs conservatively refuse.
  actorBytes: 16_384,
  projectionBytes: 8_000_000,
  inputBytes: 16_016_384,
  outputBytes: 8_016_384,
  stringBytes: 2_000_000,
  nodes: 1_100_000,
  depth: 64,
  arrayItems: 8192,
  objectFields: 128,
});
const captures = new WeakSet<object>();
function requireFact(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_EVIDENCE",
    "Unsupported or inconsistent original journal assertions.",
  );
}
function limit(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_EVIDENCE_LIMIT",
    "Original journal assertions exceed the fixed capture profile.",
  );
}
function freeze<T>(v: T): Frozen<T> {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}
function primitiveId(v: unknown): asserts v is string {
  requireFact(
    !types.isProxy(v) &&
      typeof v === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(v),
  );
}
function actorLocator(value: Actor): Actor {
  requireFact(
    !types.isProxy(value) && value !== null && typeof value === "object",
  );
  requireFact([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  requireFact(keys.length <= 6);
  const fields = Object.getOwnPropertyDescriptors(value);
  for (const k of keys)
    requireFact(
      typeof k === "string" &&
        ["id", "orgId", "role", "accountId", "sites", "name"].includes(k) &&
        fields[k]!.enumerable &&
        "value" in fields[k]!,
    );
  // Even ignored caller grants must be inert bounded data.
  const inertActor = capture(value);
  limit(Buffer.byteLength(canonical(inertActor)) <= bounds.actorBytes);
  const id = fields.id?.value,
    orgId = fields.orgId?.value;
  primitiveId(id);
  primitiveId(orgId);
  return { id, orgId } as Actor; // Supplied grants are never used as authority.
}

// No property value is read until its own data descriptor has been checked.
// In particular isProxy precedes even Array.isArray on normal/revoked proxies.
function capture(value: unknown): unknown {
  let nodes = 0,
    bytes = 0;
  const active = new WeakSet<object>();
  const add = (n: number) => {
    bytes += n;
    limit(bytes <= bounds.inputBytes);
  };
  function visit(v: unknown, depth: number): unknown {
    requireFact(!types.isProxy(v));
    limit(++nodes <= bounds.nodes && depth <= bounds.depth);
    if (v === null || typeof v === "boolean") {
      add(5);
      return v;
    }
    if (typeof v === "number") {
      requireFact(Number.isSafeInteger(v) && !Object.is(v, -0));
      add(24);
      return v;
    }
    if (typeof v === "string") {
      limit(
        v.length <= bounds.stringBytes &&
          Buffer.byteLength(v) <= bounds.stringBytes,
      );
      requireFact(Buffer.from(v).toString() === v && !v.includes("\0"));
      // Account for JSON escaping without first allocating the expanded JSON.
      let encodedBytes = Buffer.byteLength(v) + 2;
      for (let i = 0; i < v.length; i++) {
        const code = v.charCodeAt(i);
        if (code === 34 || code === 92) encodedBytes++;
        else if (code < 32)
          encodedBytes += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
      }
      add(encodedBytes);
      return v;
    }
    requireFact(typeof v === "object" && v !== null && !active.has(v));
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    requireFact(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    const keys = Reflect.ownKeys(v);
    limit(keys.length <= (array ? bounds.arrayItems + 1 : bounds.objectFields));
    const fields = Object.getOwnPropertyDescriptors(v);
    active.add(v);
    add(2 + keys.length);
    let result: unknown;
    if (array) {
      const length = fields.length;
      requireFact(
        length &&
          "value" in length &&
          !length.enumerable &&
          Number.isSafeInteger(length.value),
      );
      limit(length.value >= 0 && length.value <= bounds.arrayItems);
      requireFact(keys.length === length.value + 1);
      const out: unknown[] = [];
      for (let i = 0; i < length.value; i++) {
        const d = fields[String(i)];
        requireFact(d && d.enumerable && "value" in d);
        out.push(visit(d.value, depth + 1));
      }
      // Every key must be length or a canonical in-range index (no symbols).
      requireFact(
        keys.every(
          (k) =>
            k === "length" ||
            (typeof k === "string" &&
              /^(0|[1-9][0-9]*)$/.test(k) &&
              Number(k) < length.value),
        ),
      );
      result = out;
    } else {
      const out: Record<string, unknown> = Object.create(null);
      for (const k of keys) {
        requireFact(typeof k === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(k));
        const d = fields[k]!;
        requireFact(d.enumerable && "value" in d);
        add(Buffer.byteLength(k) + 3);
        out[k] = visit(d.value, depth + 1);
      }
      result = out;
    }
    active.delete(v);
    return result;
  }
  return visit(value, 0);
}
function exact(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, unknown> {
  requireFact(v !== null && typeof v === "object" && !Array.isArray(v));
  requireFact(canonical(Object.keys(v).sort()) === canonical([...keys].sort()));
}
function hash(v: unknown): asserts v is string {
  requireFact(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function recompute(projection: unknown, native: OfflineOriginalJournalReview) {
  exact(projection, Object.keys(native));
  const { hash: suppliedHash, ...facts } = projection;
  hash(suppliedHash);
  const encoded = canonical(facts);
  limit(Buffer.byteLength(canonical(projection)) <= bounds.projectionBytes);
  requireFact(suppliedHash === digest(encoded));
  // Complete equality is deliberate: unknown/extra nested fields, permissions,
  // ordering, raw plan/source bytes and hold tuples cannot normalize away.
  requireFact(canonical(projection) === canonical(native));
  return suppliedHash;
}
/** Process-local capture identity ONLY; not freshness, authority or permission. */
export function assertCapturedOfflineOriginalEvidence(
  value: unknown,
): asserts value is CapturedOfflineOriginalEvidence {
  requireFact(
    !types.isProxy(value) &&
      value !== null &&
      typeof value === "object" &&
      captures.has(value),
  );
}

/** Trusted internal composition must supply the actual same Database/IAM/owner. */
export class StockJournalOfflineOriginalEvidence {
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly journals: StockJournalDelivery,
  ) {}

  captureInTransaction(
    actor: Actor,
    journalId: string,
    input: OfflineOriginalEvidenceInput,
  ): CapturedOfflineOriginalEvidence {
    this.database.requireTransaction();
    primitiveId(journalId);
    actor = this.identity.currentActor(actorLocator(actor));
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Organization finance authority is required.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before journal operations.",
      403,
    );
    const store = this.database.owned("integration"),
      changes = store.get("SELECT total_changes() AS n")!.n;
    const captured = capture(input);
    exact(captured, ["version", "source", "candidate", "providerClaims"]);
    requireFact(
      captured.version === 1 &&
        Array.isArray(captured.providerClaims) &&
        captured.providerClaims.length === 1,
    );
    // Re-read the actual bounded native owner, never a caller projection/port.
    const native = this.journals.readOfflineOriginalInTransaction(
      actor,
      journalId,
    );
    const { hash: nativeHash, ...nativeFacts } = native;
    requireFact(
      nativeHash === digest(canonical(nativeFacts)) &&
        native.orgId === actor.orgId &&
        native.journalId === journalId,
    );
    const sourceHash = recompute(captured.source, native),
      candidateHash = recompute(captured.candidate, native);
    const attempt = native.attempts.find((a) => a.row.id === journalId)!;
    requireFact(
      attempt &&
        attempt.row.state === "unknown" &&
        attempt.row.leg === "original" &&
        attempt.references.length === 1,
    );
    const date = native.dates.find(
      (d) => d.postingDate === attempt.row.posting_date,
    )!;
    requireFact(
      date &&
        date.debit === date.credit &&
        date.debit > 0 &&
        native.source.file.hash === digest(native.source.file.bytes),
    );
    const snapshot: OfflineOriginalCancellationSnapshot = {
      version: 1,
      orgId: native.orgId,
      journalId,
      reviewHash: attempt.row.review_hash,
      sourceId: attempt.row.source_id,
      sourceHash: native.source.file.hash,
      postingDate: attempt.row.posting_date,
      realm: attempt.row.realm,
      bindingId: attempt.row.binding_id,
      requestRef: `DJ-${digest(journalId).slice(0, 18)}`,
      region: native.region,
      currency: native.currency,
      debit: date.debit,
      credit: date.credit,
      historyHash: digest(canonical(attempt.observations.map((o) => o.hash))),
    };
    requireFact(attempt.references[0]!.request_ref === snapshot.requestRef);
    const claim = captured.providerClaims[0];
    exact(claim, ["profile", "outcome", "request", "attestation"]);
    requireFact(
      claim.profile ===
        "quickbooks-sandbox-original-final-cancellation-unposted-v1" &&
        claim.outcome === "cancelled-unposted",
    );
    const request = {
      ...snapshot,
      intentHash: digest(canonical(attempt.plan.intent)),
    };
    exact(claim.request, Object.keys(request));
    requireFact(canonical(claim.request) === canonical(request));
    exact(claim.attestation, [
      "journalId",
      "reviewHash",
      "requestRef",
      "externalRef",
      "evidence",
      "cancellationFinal",
      "nonPostingVerified",
      "noLaterPosting",
    ]);
    const a = claim.attestation;
    for (const [key, max] of [
      ["externalRef", 160],
      ["evidence", 2000],
    ] as const)
      requireFact(
        typeof a[key] === "string" &&
          a[key].length > 0 &&
          a[key].trim() === a[key] &&
          Buffer.byteLength(a[key]) <= max,
      );
    originalCancellationEvidenceInput(a as OriginalCancellationEvidenceInput);
    requireFact(
      a.journalId === journalId &&
        a.requestRef === snapshot.requestRef &&
        a.reviewHash === digest(canonical(snapshot)),
    );
    const facts = {
      version: 1 as const,
      purpose:
        "distributor-stock-journal-offline-original-evidence-v1" as const,
      profile: bounds,
      native,
      sourceProjectionHash: sourceHash,
      candidateProjectionHash: candidateHash,
      claim: claim as unknown as OfflineOriginalProviderClaim,
      cancellationSnapshot: snapshot,
    };
    const encoded = canonical(facts);
    limit(Buffer.byteLength(encoded) + 75 <= bounds.outputBytes);
    requireFact(store.get("SELECT total_changes() AS n")!.n === changes);
    const result = freeze(structuredClone({ ...facts, hash: digest(encoded) }));
    captures.add(result);
    return result;
  }
}
