import { types } from "node:util";
import { canonical, check, digest, DomainError, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import { BillingOfflineCheckoutReview } from "./billing-offline-checkout-review.ts";
import { BillingOfflineCheckoutReferenceReview } from "./billing-offline-checkout-reference-review.ts";
import {
  RestoreOfflineCheckoutReferenceJoin,
  isCapturedOfflineCheckoutReferenceJoin,
} from "./restore-offline-checkout-reference-join.ts";
import {
  isCapturedOfflineCheckoutComparison,
  type OfflineCheckoutComparison,
} from "./integration-offline-checkout-evidence.ts";
import { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import { RestoreOfflineCheckoutNativeJoin } from "./restore-offline-checkout-native-join.ts";
import { RestoreActivation } from "./restore-activation.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
import { isCapturedCheckoutPrivateApplicationCapture } from "./restore-offline-checkout-private-evidence.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "./restore-offline-envelope.ts";

export const offlineCheckoutPaidTask = Object.freeze({
  owner: "integration",
  name: "integration.checkout-paid.import",
  version: 1,
});
const purpose = "integration-offline-checkout-paid-application-v1";
const capturedPhaseReview =
  RestoreOfflineNativePhase.prototype.reviewCapturedCheckoutInTransaction;
const code = "OFFLINE_CHECKOUT_PAID";
function need(v: unknown): asserts v {
  check(v, code, "Fixed native paid checkout application or recovery refused.");
}
function profile(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_PAID_PROFILE",
    "Paid checkout import requires the fixed isolated first-unknown profile.",
  );
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function member(v: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(v, key);
  need(d && "value" in d);
  return d.value;
}
function locator(v: unknown) {
  need(v && typeof v === "object" && !types.isProxy(v));
  need(
    Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).length === 2,
  );
  const id = member(v, "id"),
    orgId = member(v, "orgId");
  for (const s of [id, orgId])
    need(typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s));
  return { id: id as string, orgId: orgId as string };
}
// Fixed-data normalization only, never a parser/callback port. Walk before any
// recursive canonicalization/clone, rejecting proxies before reflection.
function data(input: unknown): any {
  const stack = [{ v: input, depth: 0 }];
  let nodes = 0,
    bytes = 0;
  while (stack.length) {
    const { v, depth } = stack.pop()!;
    need(++nodes <= 8192 && depth <= 24);
    if (typeof v === "string") {
      need(v.length <= 65536 && !/[\u0000\ud800-\udfff]/u.test(v));
      bytes += 6 * Buffer.byteLength(v);
    } else if (v === null || typeof v === "boolean") bytes += 5;
    else if (typeof v === "number") {
      need(Number.isSafeInteger(v) && !Object.is(v, -0));
      bytes += 24;
    } else {
      need(v && typeof v === "object" && !types.isProxy(v));
      const array = Array.isArray(v);
      need(
        Object.getPrototypeOf(v) ===
          (array ? Array.prototype : Object.prototype),
      );
      if (array) {
        const n = member(v, "length");
        need(typeof n === "number" && n <= 1000);
      }
      const keys = Reflect.ownKeys(v);
      need(keys.length <= (array ? 1001 : 64));
      for (const k of keys) {
        need(
          typeof k === "string" &&
            Buffer.byteLength(k) <= 64 &&
            !/[\u0000\ud800-\udfff]/u.test(k) &&
            ![
              "__proto__",
              "prototype",
              "constructor",
              "then",
              "toJSON",
            ].includes(k),
        );
        if (array && k === "length") continue;
        if (array)
          need(
            /^(0|[1-9][0-9]*)$/.test(k) &&
              Number(k) < Number(member(v, "length")),
          );
        const d = Object.getOwnPropertyDescriptor(v, k);
        need(d && "value" in d && d.enumerable);
        bytes += 6 * Buffer.byteLength(k) + 4;
        stack.push({ v: d.value, depth: depth + 1 });
      }
      if (array) need(keys.length === Number(member(v, "length")) + 1);
    }
    need(bytes <= 393216);
  }
  const raw = canonical(input);
  need(Buffer.byteLength(raw) <= 65536);
  return JSON.parse(raw);
}
function json(raw: unknown, hex: unknown) {
  need(
    typeof raw === "string" &&
      typeof hex === "string" &&
      Buffer.byteLength(raw) <= 65536,
  );
  const bytes = Buffer.from(hex, "hex");
  need(bytes.length <= 65536);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    need(false);
  }
  need(decoded! === raw && Buffer.from(raw).equals(bytes));
  // Bound nesting/nodes before JSON.parse, not after it. Quotes/escapes are inert.
  let depth = 0,
    nodes = 0,
    quoted = false,
    escape = false;
  for (const c of raw) {
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === "{" || c === "[") {
      need(++depth <= 24);
      need(++nodes <= 8192);
    }
    if (c === "}" || c === "]") need(--depth >= 0);
    if (c === "," || c === ":") need(++nodes <= 8192);
  }
  need(depth === 0 && !quoted);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    need(false);
  }
  const normalized = data(parsed);
  need(canonical(normalized) === raw);
  return normalized;
}
const prototypes = [
  BillingOfflineCheckoutReferenceReview.prototype,
  RestoreOfflineCheckoutReferenceJoin.prototype,
  BillingOfflineCheckoutReview.prototype,
  RestoreActivation.prototype,
  RestoreOfflineStorage.prototype,
  RestoreOfflineNativePhase.prototype,
  RestoreOfflineCommitRecoveryReader.prototype,
  IntegrationOfflineCheckoutReview.prototype,
  RestoreOfflineCheckoutNativeJoin.prototype,
];
const pins = prototypes.map((p) => Object.getOwnPropertyDescriptors(p));
function owner(v: unknown, index: number): asserts v is object {
  need(
    v &&
      typeof v === "object" &&
      !types.isProxy(v) &&
      Object.getPrototypeOf(v) === prototypes[index],
  );
  need(Reflect.ownKeys(v).length <= 64);
  for (const k of Reflect.ownKeys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    need(d && "value" in d);
  }
  const current = Object.getOwnPropertyDescriptors(prototypes[index]!);
  const pinned = pins[index]!;
  need(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const k of Reflect.ownKeys(pinned)) {
    const a = current[k as string],
      b = pinned[k as string]!;
    need(
      a &&
        a.value === b.value &&
        a.get === b.get &&
        a.set === b.set &&
        a.writable === b.writable &&
        a.configurable === b.configurable &&
        a.enumerable === b.enumerable,
    );
    if (k !== "constructor") need(!Object.getOwnPropertyDescriptor(v, k));
  }
}
const columns = {
  integration_effects:
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  integration_checkout_renewals:
    "successor_id org_id invoice_id predecessor_id reason review_version created_at",
  integration_checkout_observations:
    "sequence id org_id account_id invoice_id effect_id claim_token actor_id snapshot hash",
  integration_callbacks:
    "id org_id binding_id event_id session_id effect_id hash state attempts started_at retry_at error created_at",
  integration_inbox: "provider event_id hash created_at",
  integration_operation_leases: "effect_id org_id token started_at",
  integration_payment_allocations:
    "effect_id org_id invoice_id payment_id applied_amount",
  integration_refund_callbacks:
    "id org_id binding_id event_id effect_id provider_reference event_type hash state attempts started_at retry_at error created_at",
  integration_refund_polls: "effect_id org_id token started_at retry_at",
  integration_offline_failed_refunds:
    "effect_id org_id request_id binding record record_hash",
  integration_accounting_refunds:
    "effect_id org_id invoice_id refund_id credit_id amount",
  integration_credit_applications:
    "effect_id org_id invoice_id credit_id amount",
  integration_credit_cancellations:
    "effect_id org_id actor_id reason review_version amount created_at",
  integration_balance_reads:
    "id org_id effect_id command_key hash token started_at requested_at result error",
  integration_balance_observations: "sequence read_id org_id effect_id result",
  integration_offline_checkout_paid:
    "effect_id org_id request_id binding record record_hash",
} as const;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Joined = ReturnType<
  RestoreOfflineCheckoutReferenceJoin["getInTransaction"]
>;
type Candidate = ReturnType<Database["captureRestoreCandidateInTransaction"]>;
function nativeIntent(
  comparison: OfflineCheckoutComparison,
  joined: Joined,
  beforeCandidate: Candidate,
  executor: { id: string; orgId: string },
  preparer: { id: string; orgId: string },
) {
  return freeze({
    version: 1 as const,
    purpose: "integration-checkout-paid-native-intent-v1" as const,
    orgId: comparison.orgId,
    accountId: comparison.accountId,
    invoiceId: comparison.invoiceId,
    effectId: comparison.effectId,
    preparerId: preparer.id,
    executorId: executor.id,
    comparisonHash: comparison.hash,
    comparisonInputHash: comparison.inputHash,
    referenceJoinHash: joined.hash,
    nativeJoinHash: joined.nativeJoinHash,
    paymentReferenceHash: joined.paymentReferenceHash,
    sessionReferenceHash: joined.sessionReferenceHash,
    intentHash: comparison.intentHash,
    outcomeHash: joined.outcomeHash,
    bindingHash: joined.bindingHash,
    sessionReference: comparison.outcome.reference,
    paymentReference: comparison.outcome.settlement.paymentId,
    settlement: { ...comparison.outcome.settlement },
    beforeCandidate: {
      ...beforeCandidate,
      organizations: beforeCandidate.organizations.map((o) => ({ ...o })),
    },
  });
}
export type OfflineCheckoutPaidNativeIntent = ReturnType<typeof nativeIntent>;
/** Internal owner operation only. No runtime route or execution permit. Every
 * error MUST escape the caller's outer writer so all owner writes roll back. */
export class IntegrationOfflineCheckoutPaid {
  readonly #db: Database;
  readonly #iam: Identity;
  readonly #billing: Billing;
  readonly #platform: Platform;
  readonly #guard: BillingOfflineCheckoutReferenceReview;
  readonly #join: RestoreOfflineCheckoutReferenceJoin;
  readonly #billingReview: BillingOfflineCheckoutReview;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #recovery: RestoreOfflineCommitRecoveryReader;
  readonly #nativeReview: IntegrationOfflineCheckoutReview;
  readonly #nativeJoin: RestoreOfflineCheckoutNativeJoin;
  readonly #store: Store;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    this.#guard = new BillingOfflineCheckoutReferenceReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#join = new RestoreOfflineCheckoutReferenceJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#db = database;
    this.#iam = identity;
    this.#billing = billing;
    this.#platform = member(identity, "platform") as Platform;
    this.#billingReview = new BillingOfflineCheckoutReview(
      database,
      identity,
      billing,
    );
    this.#phase = new RestoreOfflineNativePhase(database, this.#platform);
    this.#recovery = new RestoreOfflineCommitRecoveryReader(
      database,
      this.#platform,
      identity,
    );
    this.#nativeReview = new IntegrationOfflineCheckoutReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#nativeJoin = new RestoreOfflineCheckoutNativeJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#store = database.owned("integration");
    this.#implementations();
  }
  #enter() {
    if (this.#busy) {
      this.#poison = true;
      need(false);
    }
    this.#busy = true;
    this.#poison = false;
  }
  #implementations() {
    owner(this.#guard, 0);
    owner(this.#join, 1);
    owner(this.#billingReview, 2);
    owner(this.#phase, 5);
    owner(this.#recovery, 6);
    owner(this.#nativeReview, 7);
    owner(this.#nativeJoin, 8);
    const restore = member(this.#platform, "restore"),
      offline = member(this.#platform, "offline");
    owner(restore, 3);
    owner(offline, 4);
    need(
      member(restore, "database") === this.#db &&
        member(offline, "database") === this.#db,
    );
    const accessor = pins[3]!.offlineStorage!.get!;
    need(accessor.call(restore) === offline);
    for (const o of [restore, offline]) {
      const s = member(o, "store");
      need(
        s && !types.isProxy(s) && Object.getPrototypeOf(s) === Store.prototype,
      );
      need(
        member(s as object, "database") === this.#db &&
          member(s as object, "owner") === "platform",
      );
      for (const k of Reflect.ownKeys(s as object)) {
        const d = Object.getOwnPropertyDescriptor(s, k);
        need(d && "value" in d);
      }
      for (const k of Reflect.ownKeys(Store.prototype))
        if (k !== "constructor") need(!Object.getOwnPropertyDescriptor(s, k));
    }
  }
  #authority(input: unknown) {
    const a = locator(input);
    this.#implementations();
    this.#guard.assertOwningCompositionInTransaction();
    return this.#iam.workerActor(a.orgId, a.id);
  }
  #pair(executorInput: unknown, preparerInput: unknown) {
    const executor = this.#authority(executorInput),
      preparer = this.#authority(preparerInput);
    need(executor.orgId === preparer.orgId && executor.id !== preparer.id);
    return { executor, preparer };
  }
  #scan(expected: 0 | 1) {
    let total = 0,
      bytes = 0;
    for (const [table, names] of Object.entries(columns)) {
      const count = this.#store.get(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT 65)`,
      )!.n;
      need(typeof count === "number" && count <= 64 && (total += count) <= 512);
      const fields = names.split(" "),
        sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`);
      const invalid = fields
        .map(
          (c) =>
            `(typeof(${c}) NOT IN ('null','text','integer') OR (typeof(${c})='integer' AND (${c}>9007199254740991 OR ${c} < -9007199254740991)) OR instr(CAST(${c} AS BLOB),x'00')>0)`,
        )
        .join(" OR ");
      const m = this.#store.get(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sizes.join("+")}),0) AS row,COALESCE(SUM(${sizes.join("+")}),0) AS total,COALESCE(SUM(CASE WHEN ${invalid} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      need(
        [m.field, m.row, m.total].every(
          (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
        ),
      );
      need(
        Number(m.field) <= 65536 &&
          Number(m.row) <= 131072 &&
          (bytes += 6 * Number(m.total) + count * fields.length * 80) <=
            2097152 &&
          m.bad === 0,
      );
      profile(
        count ===
          (table === "integration_effects" ||
          table === "integration_operation_leases"
            ? 1
            : table === "integration_offline_checkout_paid"
              ? expected
              : 0),
      );
    }
    const rows: Record<string, Record<string, any>[]> = {};
    for (const [table, names] of Object.entries(columns)) {
      const fields = names.split(" ");
      rows[table] = this.#store
        .all(
          `SELECT ${fields.join(",")},${fields.map((c, i) => `CASE WHEN typeof(${c})='text' THEN hex(CAST(${c} AS BLOB)) END AS h${i}`).join(",")} FROM ${table} ORDER BY rowid`,
        )
        .map((r) => {
          const out: Record<string, any> = {};
          fields.forEach((c, i) => {
            const v = r[c];
            if (typeof v === "string") {
              const b = Buffer.from(String(r[`h${i}`]), "hex");
              let decoded: string;
              try {
                decoded = utf8.decode(b);
              } catch {
                need(false);
              }
              need(decoded! === v && Buffer.from(v).equals(b));
            }
            out[c] = v;
          });
          return out;
        });
    }
    const e = rows.integration_effects![0]!,
      lease = rows.integration_operation_leases![0]!;
    profile(
      e.provider === "stripe" &&
        e.kind === "checkout" &&
        lease.effect_id === e.id &&
        lease.org_id === e.org_id &&
        lease.token === null &&
        lease.started_at === null,
    );
    json(e.payload, Buffer.from(e.payload).toString("hex"));
    if (e.result !== null)
      json(e.result, Buffer.from(e.result).toString("hex"));
    return rows;
  }
  #envelope(input: unknown, orgId: string) {
    // Bound whole envelope before the shared fixed parser allocates collections.
    const e = parseOfflineTaskEnvelope(data(input));
    need(
      e.task.owner === offlineCheckoutPaidTask.owner &&
        e.task.name === offlineCheckoutPaidTask.name &&
        e.task.version === 1 &&
        e.task.orgId === orgId &&
        e.task.siteIds.length === 0 &&
        e.task.expectedRevision === 0 &&
        e.task.priorClaim === null,
    );
    return e;
  }
  #review(
    executorInput: unknown,
    preparerInput: unknown,
    comparisonInput: unknown,
  ) {
    need(isCapturedOfflineCheckoutComparison(comparisonInput));
    const pair = this.#pair(executorInput, preparerInput),
      c = comparisonInput;
    need(pair.executor.orgId === c.orgId);
    this.#iam.providerAllowed(pair.preparer, c.accountId, "stripe");
    const changes = this.#store.get("SELECT total_changes() AS n")!.n;
    const rows = this.#scan(0),
      joined = this.#join.getInTransaction(locator(executorInput), c);
    need(isCapturedOfflineCheckoutReferenceJoin(joined));
    const beforeCandidate = this.#db.captureRestoreCandidateInTransaction();
    this.#pair(executorInput, preparerInput);
    need(
      digest(canonical(beforeCandidate)) === c.candidateHash && !this.#poison,
    );
    const native = this.#nativeReview.getInTransaction(
      pair.executor,
      c.effectId,
    );
    const nativeJoined = this.#nativeJoin.getInTransaction(
      locator(executorInput),
      c,
    );
    need(
      native.factsHash === c.nativeHash &&
        nativeJoined.hash === joined.nativeJoinHash &&
        this.#store.get("SELECT total_changes() AS n")!.n === changes,
    );
    return {
      changes,
      native,
      nativeJoined,
      ...pair,
      c,
      rows,
      joined,
      intent: nativeIntent(
        c,
        joined,
        beforeCandidate,
        pair.executor,
        pair.preparer,
      ),
    };
  }
  prepareInTransaction(
    executorInput: unknown,
    preparerInput: unknown,
    comparisonInput: unknown,
  ) {
    this.#enter();
    try {
      this.#authority(executorInput);
      const changes = this.#store.get("SELECT total_changes() AS n")!.n;
      const r = this.#review(executorInput, preparerInput, comparisonInput);
      need(
        this.#store.get("SELECT total_changes() AS n")!.n === changes &&
          !this.#poison,
      );
      return freeze({
        version: 1 as const,
        status: "native-payload-consistency-only" as const,
        nativeIntent: r.intent,
        expectedStateHash: r.joined.hash,
        referenceJoinHash: r.joined.hash,
        requiredChecks: [...r.joined.requiredChecks],
      });
    } finally {
      this.#busy = false;
    }
  }
  applyInTransaction(
    executorInput: unknown,
    preparerInput: unknown,
    envelopeInput: unknown,
    captureInput: unknown,
  ) {
    this.#enter();
    try {
      // The private owner's WeakSet check precedes all traversal, even for a
      // revoked Proxy. No supplied comparison/hash/shape stands in for capture.
      need(isCapturedCheckoutPrivateApplicationCapture(captureInput));
      const capture = captureInput;
      const r = this.#review(executorInput, preparerInput, capture.comparison);
      const envelope = this.#envelope(envelopeInput, r.executor.orgId);
      need(
        capture.version === 1 &&
          capture.purpose ===
            "native-private-checkout-application-consistency-only" &&
          envelope.task.subjectId === r.c.effectId &&
          envelope.task.payloadHash === capture.payloadHash &&
          envelope.evidence.setHash === capture.setHash &&
          offlineTaskBinding(envelope) === capture.envelopeBinding &&
          canonical(capture.referenceJoin) === canonical(r.joined) &&
          canonical(capture.native) === canonical(r.nativeJoined) &&
          envelope.task.expectedStateHash === r.joined.hash &&
          envelope.candidate.logicalHash ===
            r.intent.beforeCandidate.logicalHash,
      );
      const phase = capturedPhaseReview.call(this.#phase, envelope),
        binding = offlineTaskBinding(envelope);
      need(canonical(phase) === canonical(capture.phase));
      const { captureHash, ...captureBody } = capture;
      need(
        captureHash ===
          digest(
            canonical({
              domain:
                "distributor-offline-checkout-private-application-capture-v1",
              body: captureBody,
            }),
          ),
      );
      const retained = this.#platform.offline.readInTransaction();
      need(retained);
      profile(
        retained.state.sessions
          .flatMap((s) => s.history)
          .every((h) => h.receipt?.taskName !== offlineCheckoutPaidTask.name),
      );
      const effect = r.rows.integration_effects![0]!;
      need(
        effect.id === r.c.effectId &&
          effect.org_id === r.executor.orgId &&
          effect.account_id === r.c.accountId &&
          effect.reference === r.c.invoiceId &&
          effect.state === "unknown" &&
          effect.external_ref === null &&
          effect.result === null &&
          digest(effect.payload) === r.c.intentHash,
      );
      const beforeBilling = this.#billingReview.getInTransaction(
        r.executor,
        r.c.invoiceId,
      );
      need(
        beforeBilling.factsHash === r.nativeJoined.billingHash &&
          beforeBilling.payments.length === 0 &&
          beforeBilling.capacity.balance === r.c.outcome.settlement.amount,
      );
      const afterEffect = {
        ...effect,
        state: "completed",
        external_ref: r.c.outcome.reference,
        result: canonical(r.c.outcome.result),
        started_at: null,
        error: null,
      };
      const base = {
        version: 1,
        purpose,
        envelope,
        intent: r.intent,
        capture: {
          version: capture.version,
          purpose: capture.purpose,
          envelopeBinding: capture.envelopeBinding,
          setHash: capture.setHash,
          payloadHash: capture.payloadHash,
          captureHash,
        },
        comparison: r.c,
        joined: r.joined,
        native: r.native,
        nativeJoined: r.nativeJoined,
        binding,
        phase,
        beforeEffect: effect,
        afterEffect,
        beforeBilling,
      };
      need(Buffer.byteLength(canonical(base)) <= 45000); // room for receipt + resulting complete Billing facts
      this.#pair(executorInput, preparerInput);
      const finalCandidate = this.#db.captureRestoreCandidateInTransaction();
      // Candidate hashing crosses filesystem callbacks. Check the actual graph
      // again before touching any owning port, even when a wrapper would remove
      // itself on its first invocation and leave all rows unchanged.
      this.#pair(executorInput, preparerInput);
      need(
        canonical(finalCandidate) === canonical(r.intent.beforeCandidate) &&
          this.#store.get("SELECT total_changes() AS n")!.n === r.changes &&
          !this.#poison,
      );
      const payment = this.#billing.verifiedPayment(
        r.executor,
        r.c.invoiceId,
        r.c.outcome.settlement.amount,
        "stripe",
        r.c.outcome.settlement.paymentId,
      );
      const updated = this.#store.run(
        "UPDATE integration_effects SET state='completed',external_ref=?,result=?,started_at=NULL,error=NULL WHERE id=? AND org_id=? AND state='unknown' AND external_ref IS NULL AND result IS NULL AND payload=?",
        afterEffect.external_ref,
        afterEffect.result,
        r.c.effectId,
        r.executor.orgId,
        effect.payload,
      );
      need(updated.changes === 1);
      const afterBilling = this.#billingReview.getInTransaction(
        r.executor,
        r.c.invoiceId,
      );
      need(
        afterBilling.payments.length === 1 &&
          afterBilling.payments[0]!.id === payment.id &&
          afterBilling.capacity.balance === 0 &&
          afterBilling.capacity.paid === r.c.outcome.settlement.amount,
      );
      const result = {
        version: 1 as const,
        status: "native-owner-application-only" as const,
        effectId: r.c.effectId,
        invoiceId: r.c.invoiceId,
        accountId: r.c.accountId,
        orgId: r.c.orgId,
        paymentId: payment.id,
        paymentReference: r.c.outcome.settlement.paymentId,
        sessionReference: r.c.outcome.reference,
        amount: r.c.outcome.settlement.amount,
        currency: r.c.outcome.settlement.currency,
        binding,
        referenceJoinHash: r.joined.hash,
        captureHash,
      };
      const record = canonical({ ...base, afterBilling, result });
      need(Buffer.byteLength(record) <= 65536);
      const resultHash = digest(record);
      this.#store.run(
        "INSERT INTO integration_offline_checkout_paid(effect_id,org_id,request_id,binding,record,record_hash) VALUES(?,?,?,?,?,?)",
        r.c.effectId,
        r.executor.orgId,
        envelope.requestId,
        binding,
        record,
        resultHash,
      );
      this.#platform.audit(
        r.executor,
        offlineCheckoutPaidTask.name,
        envelope.requestId,
        { binding, resultHash, preparerId: r.preparer.id },
      );
      this.#pair(executorInput, preparerInput);
      need(!this.#poison);
      // Exactly one native record-task transition; no ordinary command receipt,
      // webhook event, provider observation/claim or QuickBooks allocation.
      this.#platform.offline.transitionInTransaction(
        retained.state.generation,
        retained.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: offlineCheckoutPaidTask.owner,
            orgId: r.executor.orgId,
            taskName: offlineCheckoutPaidTask.name,
            requestId: envelope.requestId,
            binding,
            payloadHash: envelope.task.payloadHash,
            beforeCandidateHash: envelope.candidate.logicalHash,
            resultHash,
          },
        },
        [],
      );
      this.#pair(executorInput, preparerInput);
      need(!this.#poison);
      return freeze({ ...result, resultHash });
    } finally {
      this.#busy = false;
    }
  }
  recoverRetainedInTransaction(
    executorInput: unknown,
    preparerInput: unknown,
    envelopeInput: unknown,
  ) {
    this.#enter();
    try {
      const currentPair = this.#pair(executorInput, preparerInput),
        actor = currentPair.executor,
        envelope = this.#envelope(envelopeInput, actor.orgId);
      const changes = this.#store.get("SELECT total_changes() AS n")!.n;
      const rows = this.#scan(1),
        stored = rows.integration_offline_checkout_paid![0]!;
      need(
        stored.org_id === actor.orgId &&
          stored.effect_id === envelope.task.subjectId &&
          stored.request_id === envelope.requestId &&
          stored.binding === offlineTaskBinding(envelope) &&
          stored.record_hash === digest(stored.record),
      );
      const rec = json(
        stored.record,
        Buffer.from(stored.record).toString("hex"),
      );
      need(
        Object.keys(rec).sort().join() ===
          "afterBilling,afterEffect,beforeBilling,beforeEffect,binding,capture,comparison,envelope,intent,joined,native,nativeJoined,phase,purpose,result,version",
      );
      need(
        rec.version === 1 &&
          rec.purpose === purpose &&
          canonical(this.#envelope(rec.envelope, actor.orgId)) ===
            canonical(envelope) &&
          rec.binding === stored.binding,
      );
      const { hash: comparisonHash, ...comparisonBody } = rec.comparison;
      need(
        comparisonHash === digest(canonical(comparisonBody)) &&
          comparisonHash === rec.intent.comparisonHash,
      );
      const { hash: oldJoinHash, ...oldJoinBody } = rec.nativeJoined;
      need(
        oldJoinHash === digest(canonical(oldJoinBody)) &&
          oldJoinHash === rec.joined.nativeJoinHash,
      );
      const { factsHash: nativeHash, ...nativeBody } = rec.native;
      need(
        nativeHash === digest(canonical(nativeBody)) &&
          nativeHash === rec.comparison.nativeHash &&
          nativeHash === rec.nativeJoined.nativeHash,
      );
      need(
        rec.native.effects.length === 1 &&
          canonical(rec.native.effects[0]) === canonical(rec.beforeEffect),
      );
      need(rec.nativeJoined.billingHash === rec.beforeBilling.factsHash);
      const { hash: joinedHash, ...joinedBody } = rec.joined;
      need(
        joinedHash ===
          digest(
            canonical({
              domain: "distributor-offline-checkout-reference-join-receipt-v1",
              body: joinedBody,
            }),
          ) && joinedHash === envelope.task.expectedStateHash,
      );
      need(
        rec.intent.executorId === currentPair.executor.id &&
          rec.intent.preparerId === currentPair.preparer.id,
      );
      const pair = currentPair;
      need(
        Object.keys(rec.capture).sort().join() ===
          "captureHash,envelopeBinding,payloadHash,purpose,setHash,version",
      );
      const { captureHash, ...captureMetadata } = rec.capture;
      need(
        captureMetadata.version === 1 &&
          captureMetadata.purpose ===
            "native-private-checkout-application-consistency-only" &&
          captureMetadata.envelopeBinding === stored.binding &&
          captureMetadata.setHash === envelope.evidence.setHash &&
          captureMetadata.payloadHash === envelope.task.payloadHash &&
          captureHash ===
            digest(
              canonical({
                domain:
                  "distributor-offline-checkout-private-application-capture-v1",
                body: {
                  ...captureMetadata,
                  comparison: rec.comparison,
                  referenceJoin: rec.joined,
                  native: rec.nativeJoined,
                  phase: rec.phase,
                },
              }),
            ),
      );
      this.#iam.providerAllowed(actor, rec.intent.accountId, "stripe");
      this.#iam.providerAllowed(pair.preparer, rec.intent.accountId, "stripe");
      this.#iam.providerAllowed(pair.executor, rec.intent.accountId, "stripe");
      need(
        canonical(rec.intent) ===
          canonical(
            nativeIntent(
              rec.comparison,
              rec.joined,
              rec.intent.beforeCandidate,
              pair.executor,
              pair.preparer,
            ),
          ),
      );
      need(
        rec.intent.beforeCandidate.logicalHash ===
          envelope.candidate.logicalHash &&
          digest(canonical(rec.intent.beforeCandidate)) ===
            rec.comparison.candidateHash,
      );
      need(
        rec.joined.actorId === pair.executor.id &&
          rec.joined.orgId === actor.orgId &&
          rec.joined.effectId === envelope.task.subjectId &&
          rec.joined.comparisonHash === comparisonHash &&
          rec.joined.candidateHash === rec.comparison.candidateHash &&
          rec.joined.nativeHash === rec.comparison.nativeHash &&
          rec.joined.accountId === rec.comparison.accountId &&
          rec.joined.invoiceId === rec.comparison.invoiceId &&
          rec.joined.intentHash === rec.comparison.intentHash &&
          rec.joined.paymentReference ===
            rec.comparison.outcome.settlement.paymentId &&
          rec.joined.sessionReference === rec.comparison.outcome.reference,
      );
      need(
        rec.phase.version === 1 &&
          rec.phase.status === "native-phase-consistency-only" &&
          rec.phase.envelopeBinding === stored.binding &&
          rec.phase.candidateHash === envelope.candidate.logicalHash &&
          rec.phase.session.revision === envelope.session.revision &&
          rec.phase.session.lineageHash === envelope.session.lineageHash,
      );
      need(
        rec.beforeEffect.id === rec.comparison.effectId &&
          rec.beforeEffect.org_id === actor.orgId &&
          rec.beforeEffect.account_id === rec.comparison.accountId &&
          rec.beforeEffect.reference === rec.comparison.invoiceId &&
          rec.beforeEffect.state === "unknown" &&
          rec.beforeEffect.external_ref === null &&
          rec.beforeEffect.result === null &&
          digest(rec.beforeEffect.payload) === rec.comparison.intentHash,
      );
      const intent = json(
        rec.beforeEffect.payload,
        Buffer.from(rec.beforeEffect.payload).toString("hex"),
      );
      need(
        intent.invoiceId === rec.intent.invoiceId &&
          intent.amount === rec.intent.settlement.amount &&
          intent.currency === rec.intent.settlement.currency &&
          rec.intent.settlement.paid === true &&
          rec.intent.settlement.livemode === false &&
          rec.intent.settlement.effectId === rec.intent.effectId,
      );
      need(
        rec.comparison.outcome.result.amount === intent.amount &&
          rec.comparison.outcome.result.currency === intent.currency &&
          rec.comparison.outcome.result.status === "complete" &&
          rec.comparison.outcome.result.paymentStatus === "paid",
      );
      need(
        canonical(rec.afterEffect) ===
          canonical({
            ...rec.beforeEffect,
            state: "completed",
            external_ref: rec.intent.sessionReference,
            result: canonical(rec.comparison.outcome.result),
            started_at: null,
            error: null,
          }) &&
          canonical(rows.integration_effects![0]) ===
            canonical(rec.afterEffect),
      );
      const current = this.#billingReview.getInTransaction(
        actor,
        rec.intent.invoiceId,
      );
      need(canonical(current) === canonical(rec.afterBilling));
      const { factsHash: beforeHash, ...beforeBody } = rec.beforeBilling;
      need(
        beforeHash === digest(canonical(beforeBody)) &&
          rec.beforeBilling.factsHash === rec.nativeJoined.billingHash &&
          rec.beforeBilling.payments.length === 0 &&
          rec.beforeBilling.capacity.paid === 0 &&
          rec.beforeBilling.capacity.balance === intent.amount,
      );
      need(
        current.payments.length === 1 &&
          current.capacity.paid === intent.amount &&
          current.capacity.balance === 0,
      );
      const p = current.payments[0]!;
      need(
        p.id === rec.result.paymentId &&
          p.invoice_id === rec.intent.invoiceId &&
          p.org_id === actor.orgId &&
          p.provider === "stripe" &&
          p.external_ref === rec.intent.paymentReference &&
          p.amount === intent.amount,
      );
      const {
        factsHash: _afterHash,
        payments: _payments,
        capacity: _capacity,
        ...unchanged
      } = current;
      const {
        factsHash: _beforeHash,
        payments: _beforePayments,
        capacity: _beforeCapacity,
        ...original
      } = rec.beforeBilling;
      need(canonical(unchanged) === canonical(original));
      const result = {
        version: 1,
        status: "native-owner-application-only",
        effectId: rec.intent.effectId,
        invoiceId: rec.intent.invoiceId,
        accountId: rec.intent.accountId,
        orgId: actor.orgId,
        paymentId: p.id,
        paymentReference: rec.intent.paymentReference,
        sessionReference: rec.intent.sessionReference,
        amount: intent.amount,
        currency: intent.currency,
        binding: stored.binding,
        referenceJoinHash: joinedHash,
        captureHash,
      };
      need(canonical(result) === canonical(rec.result));
      const recovery = this.#recovery.getInTransaction(actor, envelope),
        retained = this.#platform.offline.readInTransaction();
      need(
        retained &&
          recovery.receipt &&
          recovery.receipt.resultHash === stored.record_hash,
      );
      const receipts = retained.state.sessions.flatMap((s) =>
        s.history.flatMap((h) =>
          h.receipt?.taskName === offlineCheckoutPaidTask.name
            ? [h.receipt]
            : [],
        ),
      );
      // Global singleton profile: every retained owner row and every paid task
      // receipt in this generation has exactly one counterpart, both directions.
      need(
        receipts.length === 1 &&
          receipts[0]!.owner === "integration" &&
          canonical(receipts[0]) === canonical(recovery.receipt),
      );
      const candidate = this.#db.captureRestoreCandidateInTransaction();
      this.#authority(executorInput);
      this.#pair(
        { id: pair.executor.id, orgId: actor.orgId },
        { id: pair.preparer.id, orgId: actor.orgId },
      );
      const finalRows = this.#scan(1),
        finalRetained = this.#platform.offline.readInTransaction(),
        finalCandidate = this.#db.captureRestoreCandidateInTransaction();
      this.#pair(executorInput, preparerInput);
      need(
        canonical(finalRows) === canonical(rows) &&
          canonical(finalRetained) === canonical(retained) &&
          canonical(finalCandidate) === canonical(candidate) &&
          this.#store.get("SELECT total_changes() AS n")!.n === changes &&
          !this.#poison,
      );
      return freeze({ ...result, resultHash: stored.record_hash as string });
    } catch (e) {
      if (
        e instanceof DomainError &&
        [
          "TRANSACTION",
          "FORBIDDEN",
          "PASSWORD_CHANGE_REQUIRED",
          "SCHEMA_DRIFT",
        ].includes(e.code)
      )
        throw e;
      throw new DomainError(
        code,
        "Fixed native paid checkout application or recovery refused.",
      );
    } finally {
      this.#busy = false;
    }
  }
}
export type OfflineCheckoutPaidResult = ReturnType<
  IntegrationOfflineCheckoutPaid["applyInTransaction"]
>;
