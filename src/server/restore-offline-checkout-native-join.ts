import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { MultiFactor } from "./iam-mfa.ts";
import { FactorCipher } from "./totp.ts";
import { BillingOpening } from "./billing-opening.ts";
import { ProviderResidency } from "./iam-residency.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import { Integration } from "./integration.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import { BillingOfflineCheckoutReview } from "./billing-offline-checkout-review.ts";
import { isCapturedOfflineCheckoutComparison } from "./integration-offline-checkout-evidence.ts";

const purpose =
  "distributor-offline-first-unknown-checkout-paid-native-join-v1";
function intact(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_CHECKOUT_NATIVE_JOIN",
    "Captured checkout assertions do not match the current native review.",
  );
}
// Trusted composition must supply actual owners. Pin method identities at module
// load; reject proxies before any reflection and reject instance overrides. This
// is not a sandbox against arbitrary code modifying the module/runtime itself.
const prototypes = [
  Database,
  Store,
  Identity,
  ProviderResidency,
  MultiFactor,
  FactorCipher,
  BillingOpening,
  Billing,
  Platform,
  Integration,
  IntegrationCheckouts,
  IntegrationOfflineCheckoutReview,
  BillingOfflineCheckoutReview,
].map((c) => c.prototype);
const methods = new Map<object, PropertyDescriptorMap>(
  prototypes.map((p) => [p, Object.getOwnPropertyDescriptors(p)]),
);
function owner(value: unknown, prototype: object): asserts value is object {
  intact(value !== null && typeof value === "object" && !types.isProxy(value));
  intact(Object.getPrototypeOf(value) === prototype);
  const ownKeys = Reflect.ownKeys(value);
  intact(ownKeys.length <= 64);
  for (const key of ownKeys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    intact(d && "value" in d);
  }
  const pinned = methods.get(prototype)!;
  const current = Object.getOwnPropertyDescriptors(prototype);
  intact(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const [key, d] of Object.entries(pinned)) {
    const now = current[key];
    intact(
      now && now.value === d.value && now.get === d.get && now.set === d.set,
    );
    if (key !== "constructor")
      intact(!Object.getOwnPropertyDescriptor(value, key));
  }
}
function member(value: object, name: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, name);
  intact(d && "value" in d);
  return d.value;
}
function principal(input: unknown) {
  intact(input !== null && typeof input === "object" && !types.isProxy(input));
  intact(Object.getPrototypeOf(input) === Object.prototype);
  intact(Reflect.ownKeys(input).length === 2);
  const id = member(input, "id"),
    orgId = member(input, "orgId");
  for (const v of [id, orgId])
    intact(
      typeof v === "string" &&
        v.length > 0 &&
        v.length <= 128 &&
        v.trim() === v &&
        !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(v),
    );
  return { id: id as string, orgId: orgId as string };
}
function frozen<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
}
const issued = new WeakSet<object>();
export function isCapturedOfflineCheckoutNativeJoin(
  v: unknown,
): v is OfflineCheckoutNativeJoin {
  return v !== null && typeof v === "object" && issued.has(v);
}
/** Read-only, call-scoped current consistency. Always retains the missing
 * proposed-reference owning contracts and external/commit qualification checks.
 * It cannot authorize an import, release, retry or provider request. */
export class RestoreOfflineCheckoutNativeJoin {
  readonly #database: Database;
  readonly #identity: Identity;
  readonly #billing: Billing;
  readonly #checkouts: IntegrationCheckouts;
  readonly #platform: Platform;
  readonly #integration: IntegrationOfflineCheckoutReview;
  readonly #billingReview: BillingOfflineCheckoutReview;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    this.#database = database;
    this.#identity = identity;
    this.#billing = billing;
    this.#checkouts = checkouts;
    owner(identity, Identity.prototype);
    const platform = member(identity, "platform");
    owner(platform, Platform.prototype);
    this.#platform = platform as Platform;
    this.#owners();
    this.#integration = new IntegrationOfflineCheckoutReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#billingReview = new BillingOfflineCheckoutReview(
      database,
      identity,
      billing,
    );
  }
  #owners() {
    const db = this.#database,
      iam = this.#identity,
      billing = this.#billing,
      checkouts = this.#checkouts,
      platform = this.#platform;
    owner(db, Database.prototype);
    owner(iam, Identity.prototype);
    owner(billing, Billing.prototype);
    owner(checkouts, IntegrationCheckouts.prototype);
    owner(platform, Platform.prototype);
    const path = member(db, "path");
    intact(
      typeof path === "string" &&
        path.length > 0 &&
        path.length <= 4096 &&
        !path.includes("\0"),
    );
    const region = member(iam, "region");
    intact(region === "CA" || region === "US");
    const opening = member(billing, "opening");
    owner(opening, BillingOpening.prototype);
    intact(
      member(opening, "identity") === iam &&
        member(opening, "platform") === platform &&
        member(opening, "store") === member(billing, "store"),
    );
    const mfa = member(iam, "mfa");
    owner(mfa, MultiFactor.prototype);
    intact(
      member(mfa, "database") === db && member(mfa, "platform") === platform,
    );
    const mfaStore = member(mfa, "store");
    owner(mfaStore, Store.prototype);
    intact(
      member(mfaStore, "database") === db &&
        member(mfaStore, "owner") === "iam",
    );
    owner(member(mfa, "cipher"), FactorCipher.prototype);
    const integration = member(checkouts, "integration");
    owner(integration, Integration.prototype);
    for (const o of [iam, billing, platform, integration])
      intact(member(o, "database") === db);
    for (const o of [billing, checkouts, integration])
      intact(member(o, "identity") === iam);
    for (const o of [iam, billing, checkouts, integration])
      intact(member(o, "platform") === platform);
    for (const o of [checkouts, integration])
      intact(member(o, "billing") === billing);
    intact(member(integration, "checkouts") === checkouts);
    const residency = member(iam, "residency");
    owner(residency, ProviderResidency.prototype);
    intact(member(residency, "platform") === platform);
    intact(member(residency, "region") === region);
    const roles = member(iam, "mfaRequiredRoles");
    intact(
      roles !== null &&
        typeof roles === "object" &&
        !types.isProxy(roles) &&
        Array.isArray(roles) &&
        Object.getPrototypeOf(roles) === Array.prototype,
    );
    const length = member(roles, "length");
    intact(
      typeof length === "number" &&
        length <= 16 &&
        Reflect.ownKeys(roles).length === length + 1,
    );
    for (let i = 0; i < length; i++)
      intact(typeof member(roles, String(i)) === "string");
    const residencyStore = member(residency, "store");
    owner(residencyStore, Store.prototype);
    intact(
      member(residencyStore, "database") === db &&
        member(residencyStore, "owner") === "iam",
    );
    for (const [o, name] of [
      [iam, "iam"],
      [billing, "billing"],
      [platform, "platform"],
      [integration, "integration"],
      [checkouts, "integration"],
    ] as const) {
      const s = member(o, "store");
      owner(s, Store.prototype);
      intact(member(s, "database") === db && member(s, "owner") === name);
    }
  }
  getInTransaction(actorInput: unknown, comparisonInput: unknown) {
    if (this.#busy) {
      this.#poison = true;
      intact(false);
    }
    this.#busy = true;
    this.#poison = false;
    try {
      this.#owners();
      owner(this.#integration, IntegrationOfflineCheckoutReview.prototype);
      owner(this.#billingReview, BillingOfflineCheckoutReview.prototype);
      this.#database.requireTransaction();
      // WeakSet lookup precedes traversal even for revoked proxies/lookalikes.
      intact(isCapturedOfflineCheckoutComparison(comparisonInput));
      const comparison = comparisonInput,
        locator = principal(actorInput);
      const store = this.#database.owned("integration"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      const authority = () => {
        const actor = this.#identity.workerActor(locator.orgId, locator.id);
        intact(actor.orgId === comparison.orgId);
        this.#identity.providerAllowed(actor, comparison.accountId, "stripe");
        return actor;
      };
      const actor = authority(),
        hold = this.#platform.rawRecoveryHoldInTransaction();
      check(
        hold,
        "OFFLINE_CHECKOUT_RAW_HOLD",
        "A current raw recovery hold is required.",
      );
      // Billing preflights its complete selected rows before the older
      // Integration reader calls ordinary invoice/totals operations.
      const billing = this.#billingReview.getInTransaction(
        actor,
        comparison.invoiceId,
      );
      const native = this.#integration.getInTransaction(
        actor,
        comparison.effectId,
      );
      intact(
        native.factsHash === comparison.nativeHash &&
          native.accountId === comparison.accountId &&
          native.invoice.id === comparison.invoiceId,
      );
      intact(
        billing.orgId === actor.orgId &&
          billing.accountId === comparison.accountId &&
          billing.currency === native.invoice.currency &&
          billing.invoice.total === native.invoice.total,
      );
      for (const rows of [
        billing.payments,
        billing.credits,
        billing.creditLines,
        billing.refunds,
        billing.providerMappings,
        billing.observations,
        billing.manualProofs,
        billing.notices,
        billing.noticeUpdates,
        billing.noticeReads,
        billing.openingDocuments,
        billing.openingLines,
      ])
        intact(rows.length === 0);
      intact(
        billing.capacity.balance === native.invoice.total &&
          billing.capacity.paid === 0 &&
          billing.capacity.credited === 0 &&
          billing.capacity.refunded === 0 &&
          billing.capacity.pendingReservations === 0 &&
          billing.capacity.payments.length === 0,
      );
      // Complete owning byte/count preflights precede candidate serialization.
      // The shared candidate reader remains the only whole-store identity API.
      const candidate = this.#database.captureRestoreCandidateInTransaction();
      intact(digest(canonical(candidate)) === comparison.candidateHash);
      this.#owners();
      authority();
      intact(
        canonical(this.#platform.rawRecoveryHoldInTransaction()) ===
          canonical(hold),
      );
      intact(
        canonical(this.#database.captureRestoreCandidateInTransaction()) ===
          canonical(candidate),
      );
      intact(
        store.get("SELECT total_changes() AS n")!.n === changes &&
          !this.#poison,
      );
      const body = {
        version: 1 as const,
        purpose,
        orgId: actor.orgId,
        actorId: actor.id,
        accountId: comparison.accountId,
        invoiceId: comparison.invoiceId,
        effectId: comparison.effectId,
        comparisonHash: comparison.hash,
        nativeHash: native.factsHash,
        billingHash: billing.factsHash,
        candidateHash: comparison.candidateHash,
        intentHash: comparison.intentHash,
        outcomeHash: digest(canonical(comparison.outcome)),
        requiredChecks: comparison.requiredChecks.filter(
          (v) => v !== "current-native-candidate-authority-and-raw-hold",
        ),
      };
      const result = frozen({ ...body, hash: digest(canonical(body)) });
      issued.add(result);
      return result;
    } finally {
      this.#busy = false;
    }
  }
}
export type OfflineCheckoutNativeJoin = ReturnType<
  RestoreOfflineCheckoutNativeJoin["getInTransaction"]
>;
