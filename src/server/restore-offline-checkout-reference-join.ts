import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import { isCapturedOfflineCheckoutComparison } from "./integration-offline-checkout-evidence.ts";
import {
  RestoreOfflineCheckoutNativeJoin,
  isCapturedOfflineCheckoutNativeJoin,
} from "./restore-offline-checkout-native-join.ts";
import {
  BillingOfflineCheckoutReferenceReview,
  isCapturedOfflineCheckoutPaymentReferenceReview,
} from "./billing-offline-checkout-reference-review.ts";
import {
  IntegrationOfflineCheckoutReferenceReview,
  isCapturedOfflineCheckoutSessionReferenceReview,
} from "./integration-offline-checkout-reference-review.ts";

const purpose = "distributor-offline-checkout-reference-join-v1" as const;
const domain = "distributor-offline-checkout-reference-join-receipt-v1";
const nativeCheck = "current-native-candidate-authority-and-raw-hold";
const paymentCheck =
  "billing-proposed-payment-reference-history-contract-required";
const sessionCheck =
  "integration-proposed-session-reference-history-contract-required";
function intact(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_REFERENCE_JOIN",
    "Current checkout reference receipts do not agree.",
  );
}
const prototypes = [
  RestoreOfflineCheckoutNativeJoin.prototype,
  BillingOfflineCheckoutReferenceReview.prototype,
  IntegrationOfflineCheckoutReferenceReview.prototype,
];
const descriptors = prototypes.map((p) => Object.getOwnPropertyDescriptors(p));
// Fixed actual implementations only. This guards substitutions, not arbitrary
// code execution capable of replacing the module/runtime before import.
function implementation(value: object, index: number) {
  intact(
    !types.isProxy(value) && Object.getPrototypeOf(value) === prototypes[index],
  );
  intact(Reflect.ownKeys(value).length === 0); // all three owners use private fields
  const current = Object.getOwnPropertyDescriptors(prototypes[index]!);
  const pinned = descriptors[index]!;
  intact(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const key of Reflect.ownKeys(pinned)) {
    const a = current[key as string],
      b = pinned[key as string]!;
    intact(
      a &&
        a.value === b.value &&
        a.get === b.get &&
        a.set === b.set &&
        a.writable === b.writable &&
        a.enumerable === b.enumerable &&
        a.configurable === b.configurable,
    );
  }
}
function principal(v: unknown) {
  intact(v !== null && typeof v === "object" && !types.isProxy(v));
  intact(
    Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).length === 2,
  );
  const id = Object.getOwnPropertyDescriptor(v, "id"),
    org = Object.getOwnPropertyDescriptor(v, "orgId");
  intact(id && org && "value" in id && "value" in org);
  for (const value of [id.value, org.value])
    intact(
      typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128 &&
        value === value.trim() &&
        !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(value),
    );
  return { id: id.value as string, orgId: org.value as string };
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
const issued = new WeakSet<object>();
export function isCapturedOfflineCheckoutReferenceJoin(
  v: unknown,
): v is OfflineCheckoutReferenceJoin {
  return v !== null && typeof v === "object" && issued.has(v);
}
const readNative = RestoreOfflineCheckoutNativeJoin.prototype.getInTransaction;
const readPayment =
  BillingOfflineCheckoutReferenceReview.prototype.getInTransaction;
const readSession =
  IntegrationOfflineCheckoutReferenceReview.prototype.getInTransaction;
const assertGraph =
  BillingOfflineCheckoutReferenceReview.prototype
    .assertOwningCompositionInTransaction;

/** Current, call-scoped native consistency only. No import/transport/release
 * permission or external qualification. The caller owns the outer writer. */
export class RestoreOfflineCheckoutReferenceJoin {
  readonly #database: Database;
  readonly #native: RestoreOfflineCheckoutNativeJoin;
  readonly #payment: BillingOfflineCheckoutReferenceReview;
  readonly #session: IntegrationOfflineCheckoutReferenceReview;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    // The actual owner constructors validate their same-application graph,
    // descriptors, methods and Store identities without a caller adapter port.
    this.#native = new RestoreOfflineCheckoutNativeJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#payment = new BillingOfflineCheckoutReferenceReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#session = new IntegrationOfflineCheckoutReferenceReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#database = database;
    this.#implementations();
  }
  #implementations() {
    implementation(this.#native, 0);
    implementation(this.#payment, 1);
    implementation(this.#session, 2);
  }
  getInTransaction(actorInput: unknown, comparisonInput: unknown) {
    if (this.#busy) {
      this.#poison = true;
      intact(false);
    }
    this.#busy = true;
    this.#poison = false;
    try {
      // Branding before traversal, including revoked proxies. Copy only inert
      // principal fields; no caller permissions, hashes, ports or completeness.
      intact(isCapturedOfflineCheckoutComparison(comparisonInput));
      const comparison = comparisonInput,
        actor = principal(actorInput);
      this.#implementations();
      assertGraph.call(this.#payment); // current actual graph + writer + raw hold
      const store = this.#database.owned("integration");
      const changes = store.get("SELECT total_changes() AS n")!.n;
      const capture = () => {
        this.#implementations();
        // Global owning byte/count preflights precede candidate materialization.
        const session = readSession.call(this.#session, actor, comparison);
        const payment = readPayment.call(this.#payment, actor, comparison);
        const native = readNative.call(this.#native, actor, comparison);
        intact(
          isCapturedOfflineCheckoutSessionReferenceReview(session) &&
            isCapturedOfflineCheckoutPaymentReferenceReview(payment) &&
            isCapturedOfflineCheckoutNativeJoin(native),
        );
        for (const receipt of [session, payment, native])
          intact(
            receipt.orgId === comparison.orgId &&
              receipt.actorId === actor.id &&
              receipt.accountId === comparison.accountId &&
              receipt.invoiceId === comparison.invoiceId &&
              receipt.effectId === comparison.effectId &&
              receipt.comparisonHash === comparison.hash &&
              receipt.candidateHash === comparison.candidateHash,
          );
        const bindingHash = digest(canonical(comparison.binding));
        intact(
          payment.reference === comparison.outcome.settlement.paymentId &&
            session.reference === comparison.outcome.reference &&
            session.billingReferenceHash === payment.hash &&
            payment.bindingHash === bindingHash &&
            session.bindingHash === bindingHash &&
            native.nativeHash === comparison.nativeHash &&
            payment.nativeHash === comparison.nativeHash &&
            native.intentHash === comparison.intentHash &&
            native.outcomeHash === digest(canonical(comparison.outcome)),
        );
        // Exact discharge contracts: a future reader must not silently remove
        // another check merely because its receipt has a valid process brand.
        for (const [receipt, removed] of [
          [native, [nativeCheck]],
          [payment, [paymentCheck]],
          [session, [paymentCheck, sessionCheck]],
        ] as const)
          intact(
            canonical(receipt.requiredChecks) ===
              canonical(
                comparison.requiredChecks.filter(
                  (v) => !(removed as readonly string[]).includes(v),
                ),
              ),
          );
        return { native, payment, session };
      };
      const first = capture(),
        last = capture();
      intact(
        first.native.hash === last.native.hash &&
          first.payment.hash === last.payment.hash &&
          first.session.hash === last.session.hash,
      );
      this.#implementations();
      assertGraph.call(this.#payment);
      intact(
        store.get("SELECT total_changes() AS n")!.n === changes &&
          !this.#poison,
      );
      const body = {
        version: 1 as const,
        purpose,
        orgId: comparison.orgId,
        actorId: actor.id,
        accountId: comparison.accountId,
        invoiceId: comparison.invoiceId,
        effectId: comparison.effectId,
        paymentReference: last.payment.reference,
        sessionReference: last.session.reference,
        comparisonHash: comparison.hash,
        candidateHash: comparison.candidateHash,
        nativeHash: comparison.nativeHash,
        bindingHash: last.payment.bindingHash,
        intentHash: comparison.intentHash,
        outcomeHash: last.native.outcomeHash,
        nativeJoinHash: last.native.hash,
        paymentReferenceHash: last.payment.hash,
        sessionReferenceHash: last.session.hash,
        requiredChecks: comparison.requiredChecks.filter(
          (v) => ![nativeCheck, paymentCheck, sessionCheck].includes(v),
        ),
      };
      const result = freeze({
        ...body,
        hash: digest(canonical({ domain, body })),
      });
      issued.add(result);
      return result;
    } finally {
      this.#busy = false;
    }
  }
}
export type OfflineCheckoutReferenceJoin = ReturnType<
  RestoreOfflineCheckoutReferenceJoin["getInTransaction"]
>;
