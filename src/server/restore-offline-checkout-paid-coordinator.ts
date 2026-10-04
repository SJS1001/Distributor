import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { MultiFactor } from "./iam-mfa.ts";
import { FactorCipher } from "./totp.ts";
import { ProviderResidency } from "./iam-residency.ts";
import { OrganizationResidency } from "./organization-residency.ts";
import { Billing } from "./billing.ts";
import { BillingOpening } from "./billing-opening.ts";
import { BillingPaymentHistory } from "./billing-payment-history.ts";
import { BillingRefunds } from "./billing-refunds.ts";
import { BillingDocuments } from "./billing-documents.ts";
import { BillingDelivery } from "./billing-delivery.ts";
import { Platform } from "./platform.ts";
import { Integration } from "./integration.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import {
  IntegrationOfflineCheckoutPaid,
  type OfflineCheckoutPaidResult,
} from "./integration-offline-checkout-paid.ts";
import { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import { BillingOfflineCheckoutReview } from "./billing-offline-checkout-review.ts";
import { BillingOfflineCheckoutReferenceReview } from "./billing-offline-checkout-reference-review.ts";
import { IntegrationOfflineCheckoutReferenceReview } from "./integration-offline-checkout-reference-review.ts";
import { RestoreOfflineCheckoutNativeJoin } from "./restore-offline-checkout-native-join.ts";
import {
  RestoreOfflineCheckoutReferenceJoin,
  isCapturedOfflineCheckoutReferenceJoin,
} from "./restore-offline-checkout-reference-join.ts";
import { isCapturedOfflineCheckoutComparison } from "./integration-offline-checkout-evidence.ts";
import {
  RestoreOfflineCheckoutPrivateEvidence,
  isCapturedCheckoutPrivateApplicationCapture,
  type CheckoutPrivateApplicationCapture,
  type CheckoutPrivateHandle,
} from "./restore-offline-checkout-private-evidence.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
import { RestoreActivation } from "./restore-activation.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import {
  RestoreOfflineCommitGuard,
  type OfflineCommitAdapter,
  type OfflineCommitRequest,
} from "./restore-offline-commit-guard.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";
import {
  offlineApprovalRosterFingerprint,
  verifyOfflineTaskApprovals,
  type OfflineApprovalRosterEntry,
  type OfflineApprovalAssociations,
} from "./restore-offline-approvals.ts";

/** Static trusted host only. Independent current trust/revocation, source,
 * evidence/provider truth and Stripe sandbox account/runtime binding must stay
 * qualified under the adapter's interlock through actual COMMIT return. No
 * caller assertions, archived hashes, sampled clocks or expiring lease alone
 * implement that guarantee. No provider transport, candidate writes, async work
 * or retained callbacks. No Application route/default host is installed here. */
export type OfflineCheckoutPaidQualification = Readonly<{
  purpose: "distributor-offline-current-checkout-paid-qualification-v1";
  envelopeBinding: string;
  now: string;
  trust: Readonly<{
    authorityId: string;
    revision: number;
    registryHash: string;
  }>;
  roster: readonly OfflineApprovalRosterEntry[];
  associations: OfflineApprovalAssociations;
  evidence: Readonly<{
    setHash: string;
    qualificationHash: string;
    payloadHash: string;
    referenceJoinHash: string;
    comparisonHash: string;
    provider: "stripe";
    mode: "test";
    stripeAccountId: string;
    runtimeBindingId: string;
    subjectId: string;
  }>;
}>;
export type OfflineCheckoutPaidHost = Readonly<{
  adapter: OfflineCommitAdapter;
  readCurrent(request: OfflineCommitRequest): OfflineCheckoutPaidQualification;
}>;
const code = "RESTORE_OFFLINE_CHECKOUT_PAID_COORDINATOR";
const constructors = [
  Database,
  Store,
  Identity,
  MultiFactor,
  FactorCipher,
  ProviderResidency,
  OrganizationResidency,
  Billing,
  BillingOpening,
  BillingPaymentHistory,
  BillingRefunds,
  BillingDocuments,
  BillingDelivery,
  Platform,
  Integration,
  IntegrationCheckouts,
  IntegrationOfflineCheckoutPaid,
  IntegrationOfflineCheckoutReview,
  BillingOfflineCheckoutReview,
  BillingOfflineCheckoutReferenceReview,
  IntegrationOfflineCheckoutReferenceReview,
  RestoreOfflineCheckoutNativeJoin,
  RestoreOfflineCheckoutReferenceJoin,
  RestoreOfflineCheckoutPrivateEvidence,
  RestoreOfflineStorage,
  RestoreActivation,
  RestoreOfflineNativePhase,
  RestoreOfflineCommitRecoveryReader,
  RestoreOfflineCommitGuard,
];
const descriptors = new Map<object, PropertyDescriptorMap>(
  constructors.map((c) => [
    c.prototype,
    Object.getOwnPropertyDescriptors(c.prototype),
  ]),
);
const capturedReceiptRecovery =
  RestoreOfflineCommitRecoveryReader.prototype.getCapturedCheckoutInTransaction;
const capturedCheckoutCommit =
  RestoreOfflineCommitGuard.prototype.executeCapturedCheckout;
// Poison all attempts on the same native Database, even an early nested refusal
// swallowed before it could reach the shared commit guard.
const active = new WeakMap<Database, () => void>();
function insist(ok: unknown): asserts ok {
  check(ok, code, "Current signed checkout qualification did not complete.");
}

// Detach every untrusted input before trusted host code can mutate its source.
// Proxies are refused before reflection; arrays are bounded before enumeration.
function detach(input: unknown): any {
  let nodes = 0,
    bytes = 0;
  function visit(value: unknown, depth: number): any {
    insist(++nodes <= 20000 && depth <= 16);
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value);
      insist(
        value.length <= 8192 &&
          bytes <= 1024 * 1024 &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            value,
          ),
      );
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      insist(Number.isSafeInteger(value) && !Object.is(value, -0));
      return value;
    }
    insist(value && typeof value === "object" && !types.isProxy(value));
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    insist(
      array
        ? prototype === Array.prototype
        : prototype === Object.prototype || prototype === null,
    );
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      insist(Number.isSafeInteger(length) && length >= 0 && length <= 1000);
      insist(Reflect.ownKeys(value).length === length + 1);
      const result = [];
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        insist(d && "value" in d && d.enumerable);
        result.push(visit(d.value, depth + 1));
      }
      return Object.freeze(result);
    }
    let count = 0;
    for (const key in value) insist(++count <= 64 && Object.hasOwn(value, key));
    const keys = Reflect.ownKeys(value);
    insist(keys.length === count);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      insist(
        typeof key === "string" &&
          key.length <= 160 &&
          !["__proto__", "constructor", "prototype"].includes(key),
      );
      // Property names consume the same UTF-8 budget and Unicode validation
      // as values; bounded node/key counts alone do not bound their bytes.
      visit(key, depth + 1);
      const d = Object.getOwnPropertyDescriptor(value, key);
      insist(d && "value" in d && d.enumerable);
      result[key] = visit(d.value, depth + 1);
    }
    return Object.freeze(result);
  }
  return visit(input, 0);
}
function record(input: unknown, keys: string[]) {
  insist(
    input &&
      typeof input === "object" &&
      !types.isProxy(input) &&
      !Array.isArray(input),
  );
  const prototype = Object.getPrototypeOf(input);
  insist(prototype === Object.prototype || prototype === null);
  const own = Reflect.ownKeys(input);
  insist(
    own.length === keys.length &&
      own.every((k) => typeof k === "string" && keys.includes(k)),
  );
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(d && "value" in d && d.enumerable);
    result[key] = d.value;
  }
  return result;
}
function sync(value: unknown): asserts value is (...args: any[]) => any {
  insist(
    typeof value === "function" &&
      !types.isProxy(value) &&
      !types.isAsyncFunction(value) &&
      !types.isGeneratorFunction(value),
  );
}
function captureHost(input: OfflineCheckoutPaidHost): OfflineCheckoutPaidHost {
  const host = record(input, ["adapter", "readCurrent"]),
    adapter = record(host.adapter, ["identity", "hold", "assertHeld"]);
  sync(host.readCurrent);
  sync(adapter.hold);
  sync(adapter.assertHeld);
  insist(
    typeof adapter.identity === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(adapter.identity),
  );
  return Object.freeze({
    adapter: Object.freeze({
      identity: adapter.identity,
      hold: adapter.hold,
      assertHeld: adapter.assertHeld,
    }),
    readCurrent: host.readCurrent,
  }) as OfflineCheckoutPaidHost;
}

const task = Object.freeze({
  owner: "integration",
  name: "integration.checkout-paid.import",
  version: 1,
});
function principal(input: unknown): Actor {
  insist(input && typeof input === "object" && !types.isProxy(input));
  const prototype = Object.getPrototypeOf(input);
  insist(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(input);
  insist(
    keys.length === 2 && keys.every((key) => key === "id" || key === "orgId"),
  );
  const out: Record<string, string> = {};
  for (const key of ["id", "orgId"]) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(
      d &&
        "value" in d &&
        d.enumerable &&
        typeof d.value === "string" &&
        /^[A-Za-z0-9_-]{1,160}$/.test(d.value),
    );
    out[key] = d.value;
  }
  return Object.freeze({ id: out.id!, orgId: out.orgId! }) as Actor;
}

function member(owner: object, key: string): any {
  insist(owner && !types.isProxy(owner));
  const d = Object.getOwnPropertyDescriptor(owner, key);
  insist(d && "value" in d);
  return d.value;
}
function sameDescriptor(
  a: PropertyDescriptor | undefined,
  b: PropertyDescriptor,
) {
  return (
    a &&
    a.value === b.value &&
    a.get === b.get &&
    a.set === b.set &&
    a.enumerable === b.enumerable &&
    a.configurable === b.configurable &&
    a.writable === b.writable
  );
}
/** Fixed signed checkout only. No supplied capture, owning operation or port.
 * Call outside a writer: the guard owns the actual outer transaction/COMMIT. */
export class RestoreOfflineCheckoutPaidCoordinator {
  readonly #database: Database;
  readonly #counter: Store;
  readonly #identity: Identity;
  readonly #platform: Platform;
  readonly #operation: IntegrationOfflineCheckoutPaid;
  readonly #reader: RestoreOfflineCheckoutPrivateEvidence;
  readonly #references: RestoreOfflineCheckoutReferenceJoin;
  readonly #receipt: RestoreOfflineCommitRecoveryReader;
  readonly #graph: readonly {
    owner: object;
    prototype: object;
    properties: PropertyDescriptorMap;
  }[];
  readonly #host: OfflineCheckoutPaidHost | undefined;
  constructor(
    database: Database,
    identity: Identity,
    platform: Platform,
    billing: Billing,
    checkouts: IntegrationCheckouts,
    host?: OfflineCheckoutPaidHost,
  ) {
    // Constructor validates actual complete graph without invoking host code.
    // Instance slots and all transitive callable helper prototypes are pinned.
    this.#database = database;
    this.#identity = identity;
    this.#platform = platform;
    this.#reader = new RestoreOfflineCheckoutPrivateEvidence(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#references = new RestoreOfflineCheckoutReferenceJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#receipt = new RestoreOfflineCommitRecoveryReader(
      database,
      platform,
      identity,
    );
    const integration = member(checkouts, "integration");
    insist(
      member(identity, "platform") === platform &&
        member(platform, "database") === database,
    );
    const list: [object, object][] = [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [platform, Platform.prototype],
      [billing, Billing.prototype],
      [checkouts, IntegrationCheckouts.prototype],
      [integration, Integration.prototype],
      [member(identity, "mfa"), MultiFactor.prototype],
      [member(member(identity, "mfa"), "cipher"), FactorCipher.prototype],
      [member(identity, "residency"), ProviderResidency.prototype],
      [
        member(identity, "organizationResidency"),
        OrganizationResidency.prototype,
      ],
      [member(billing, "opening"), BillingOpening.prototype],
      [member(billing, "paymentHistory"), BillingPaymentHistory.prototype],
      [member(billing, "refunds"), BillingRefunds.prototype],
      [member(billing, "documents"), BillingDocuments.prototype],
      [member(billing, "delivery"), BillingDelivery.prototype],
      [member(platform, "offline"), RestoreOfflineStorage.prototype],
      [member(platform, "restore"), RestoreActivation.prototype],
    ];
    for (const [owner, prototype] of [...list]) {
      insist(
        owner &&
          typeof owner === "object" &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
      const db = Object.getOwnPropertyDescriptor(owner, "database");
      if (db) insist("value" in db && db.value === database);
      const s = Object.getOwnPropertyDescriptor(owner, "store");
      if (s) {
        insist("value" in s && s.value && !types.isProxy(s.value));
        insist(
          Object.getPrototypeOf(s.value) === Store.prototype &&
            member(s.value, "database") === database,
        );
        const expected = [
          Identity.prototype,
          MultiFactor.prototype,
          ProviderResidency.prototype,
          OrganizationResidency.prototype,
        ].includes(prototype as any)
          ? "iam"
          : [
                Platform.prototype,
                RestoreOfflineStorage.prototype,
                RestoreActivation.prototype,
              ].includes(prototype as any)
            ? "platform"
            : [Integration.prototype, IntegrationCheckouts.prototype].includes(
                  prototype as any,
                )
              ? "integration"
              : "billing";
        insist(member(s.value, "owner") === expected);
        list.push([s.value, Store.prototype]);
      }
    }
    this.#graph = Object.freeze(
      list.map(([owner, prototype]) => {
        insist(
          owner &&
            !types.isProxy(owner) &&
            Object.getPrototypeOf(owner) === prototype,
        );
        const properties = Object.getOwnPropertyDescriptors(owner);
        for (const d of Object.values(properties)) insist("value" in d);
        return { owner, prototype, properties };
      }),
    );
    this.#counter = member(identity, "store") as Store;
    this.#owners();
    this.#operation = new IntegrationOfflineCheckoutPaid(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#host = host === undefined ? undefined : captureHost(host);
  }
  #owners() {
    for (const [prototype, pinned] of descriptors) {
      const now = Object.getOwnPropertyDescriptors(prototype);
      insist(Reflect.ownKeys(now).length === Reflect.ownKeys(pinned).length);
      for (const k of Reflect.ownKeys(pinned))
        insist(sameDescriptor(now[k as string], pinned[k as string]!));
    }
    for (const { owner, prototype, properties } of this.#graph) {
      insist(
        !types.isProxy(owner) && Object.getPrototypeOf(owner) === prototype,
      );
      const now = Object.getOwnPropertyDescriptors(owner);
      insist(
        Reflect.ownKeys(now).length === Reflect.ownKeys(properties).length,
      );
      for (const k of Reflect.ownKeys(properties))
        insist(sameDescriptor(now[k as string], properties[k as string]!));
      for (const k of Reflect.ownKeys(descriptors.get(prototype)!))
        if (k !== "constructor") insist(!Object.hasOwn(owner, k));
    }
    // Native Database private slots, not prototype resemblance, back this
    // fixed read. Forged owner graphs cannot reach a host hook.
    const count = Store.prototype.get.call(
      this.#counter,
      "SELECT total_changes() AS n",
    )?.n;
    insist(
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    );
  }
  #principals(preparer: Actor, executor: Actor) {
    this.#owners();
    this.#database.requireTransaction();
    insist(this.#platform.rawRecoveryHoldInTransaction());
    insist(preparer.id !== executor.id && preparer.orgId === executor.orgId);
    for (const locator of [preparer, executor]) {
      const a = this.#identity.currentActor(locator);
      permit(a, ["finance"]);
      insist(
        !a.accountId && !this.#identity.security(a).passwordChangeRequired,
      );
    }
  }
  execute(
    preparerInput: unknown,
    executorInput: unknown,
    envelopeInput: unknown,
    approvalInput: unknown,
    manifestInput: unknown,
  ) {
    const busy = active.get(this.#database);
    if (busy) {
      busy();
      insist(false);
    }
    let poisoned = false;
    active.set(this.#database, () => {
      poisoned = true;
    });
    let handle: CheckoutPrivateHandle | undefined;
    try {
      this.#owners();
      const host = this.#host;
      insist(host);
      const preparer = principal(preparerInput),
        executor = principal(executorInput),
        envelope = parseOfflineTaskEnvelope(detach(envelopeInput)),
        approvals = detach(approvalInput),
        manifest = detach(manifestInput);
      insist(
        preparer.id !== executor.id &&
          preparer.orgId === executor.orgId &&
          envelope.preparedBy === preparer.id &&
          envelope.executorId === executor.id &&
          envelope.task.orgId === preparer.orgId &&
          envelope.task.owner === task.owner &&
          envelope.task.name === task.name &&
          envelope.task.version === task.version &&
          envelope.task.expectedRevision === 0 &&
          envelope.task.priorClaim === null &&
          envelope.task.siteIds.length === 0,
      );
      // Strict manifest shape/bounds before any host hook. File bytes are opened,
      // completed and consumed only within the guarded actual native writer.
      record(manifest, ["version", "root", "files"]);
      insist(
        manifest.version === 1 &&
          typeof manifest.root === "string" &&
          Array.isArray(manifest.files) &&
          manifest.files.length === 1,
      );
      record(manifest.files[0], ["reference", "path"]);
      insist(
        envelope.evidence.items.length === 1 &&
          manifest.files[0].reference ===
            envelope.evidence.items[0]!.reference &&
          typeof manifest.files[0].path === "string",
      );
      let previousNow: number | undefined,
        qualifiedEvidence: string | undefined,
        associationsFingerprint: string | undefined;
      let captured: CheckoutPrivateApplicationCapture | undefined;
      const qualified = (request: OfflineCommitRequest) => {
        this.#principals(preparer, executor);
        insist(!poisoned);
        const store = this.#database.owned("integration"),
          changes = store.get("SELECT total_changes() AS n")!.n;
        insist(host.adapter.assertHeld(request) === undefined);
        this.#principals(preparer, executor);
        const raw = host.readCurrent(request);
        this.#principals(preparer, executor);
        insist(
          !poisoned && store.get("SELECT total_changes() AS n")!.n === changes,
        );
        const q = detach(raw) as OfflineCheckoutPaidQualification;
        record(q, [
          "purpose",
          "envelopeBinding",
          "now",
          "trust",
          "roster",
          "associations",
          "evidence",
        ]);
        record(q.evidence, [
          "setHash",
          "qualificationHash",
          "payloadHash",
          "referenceJoinHash",
          "comparisonHash",
          "provider",
          "mode",
          "stripeAccountId",
          "runtimeBindingId",
          "subjectId",
        ]);
        insist(
          q.purpose ===
            "distributor-offline-current-checkout-paid-qualification-v1" &&
            q.envelopeBinding === offlineTaskBinding(envelope),
        );
        insist(typeof q.now === "string");
        const now = Date.parse(q.now);
        insist(
          Number.isFinite(now) &&
            new Date(now).toISOString() === q.now &&
            now >= Date.parse(envelope.preparedAt) &&
            now < Date.parse(envelope.expiresAt) &&
            (previousNow === undefined || now >= previousNow),
        );
        previousNow = now;
        insist(
          canonical(q.trust) === canonical(envelope.trust) &&
            offlineApprovalRosterFingerprint(q.roster) ===
              envelope.trust.registryHash,
        );
        const signed = verifyOfflineTaskApprovals(
          envelope,
          approvals,
          q.roster,
          q.associations,
        );
        insist(
          associationsFingerprint === undefined ||
            associationsFingerprint === signed.associationsFingerprint,
        );
        associationsFingerprint = signed.associationsFingerprint;
        // Native preparer and executor are distinct people as well as accounts.
        insist(
          q.associations.preparer.personId !== q.associations.executor.personId,
        );
        for (const value of [
          q.evidence.setHash,
          q.evidence.qualificationHash,
          q.evidence.payloadHash,
          q.evidence.referenceJoinHash,
          q.evidence.comparisonHash,
        ])
          insist(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
        insist(
          q.evidence.setHash === envelope.evidence.setHash &&
            q.evidence.qualificationHash ===
              envelope.evidence.qualificationHash &&
            q.evidence.payloadHash === envelope.task.payloadHash &&
            q.evidence.referenceJoinHash === envelope.task.expectedStateHash &&
            q.evidence.provider === "stripe" &&
            q.evidence.mode === "test" &&
            q.evidence.subjectId === envelope.task.subjectId &&
            typeof q.evidence.stripeAccountId === "string" &&
            /^acct_[A-Za-z0-9_]+$/.test(q.evidence.stripeAccountId) &&
            typeof q.evidence.runtimeBindingId === "string" &&
            /^[A-Za-z0-9_-]{1,160}$/.test(q.evidence.runtimeBindingId),
        );
        const e = canonical(q.evidence);
        insist(qualifiedEvidence === undefined || qualifiedEvidence === e);
        qualifiedEvidence = e;
        if (captured)
          insist(
            q.evidence.comparisonHash === captured.comparison.hash &&
              q.evidence.stripeAccountId ===
                captured.comparison.binding.stripeAccountId &&
              q.evidence.runtimeBindingId ===
                captured.comparison.binding.runtimeBindingId,
          );
        return q;
      };
      const guard = new RestoreOfflineCommitGuard(
        this.#database,
        this.#platform,
        {
          task,
          adapter: {
            identity: host.adapter.identity,
            hold: (r, commit) => {
              this.#owners();
              insist(!poisoned);
              const returned = host.adapter.hold(r, commit);
              this.#owners();
              insist(!poisoned);
              return returned;
            },
            assertHeld: (r) => {
              qualified(r);
            },
          },
          operation: (actual) => {
            const request: OfflineCommitRequest = Object.freeze({
              purpose: "distributor-offline-commit-v1",
              envelopeBinding: offlineTaskBinding(actual),
              envelope: actual,
            });
            qualified(request);
            handle = this.#reader.read(actual, manifest);
            handle.complete();
            const capture = handle.captureForApplicationInTransaction(executor);
            insist(isCapturedCheckoutPrivateApplicationCapture(capture));
            captured = capture;
            insist(
              isCapturedOfflineCheckoutComparison(capture.comparison) &&
                isCapturedOfflineCheckoutReferenceJoin(capture.referenceJoin) &&
                capture.envelopeBinding === request.envelopeBinding &&
                capture.setHash === actual.evidence.setHash &&
                capture.payloadHash === actual.task.payloadHash &&
                capture.referenceJoin.hash === actual.task.expectedStateHash &&
                capture.referenceJoin.actorId === executor.id,
            );
            qualified(request);
            const fresh = this.#references.getInTransaction(
              executor,
              capture.comparison,
            );
            insist(
              isCapturedOfflineCheckoutReferenceJoin(fresh) &&
                canonical(fresh) === canonical(capture.referenceJoin),
            );
            this.#principals(preparer, executor);
            const applied = this.#operation.applyInTransaction(
              executor,
              preparer,
              actual,
              capture,
            );
            this.#owners();
            // Validate the actual retained owner result and exact durable receipt.
            this.#validateApplied(applied, executor, preparer, actual, capture);
            qualified(request);
          },
        },
      );
      return capturedCheckoutCommit.call(guard, envelope);
    } finally {
      handle?.dispose();
      active.delete(this.#database);
    }
  }
  #result(
    input: unknown,
    envelope: ReturnType<typeof parseOfflineTaskEnvelope>,
  ) {
    const r = detach(input);
    record(r, [
      "version",
      "status",
      "orgId",
      "accountId",
      "invoiceId",
      "effectId",
      "paymentId",
      "paymentReference",
      "sessionReference",
      "amount",
      "currency",
      "binding",
      "referenceJoinHash",
      "captureHash",
      "resultHash",
    ]);
    insist(
      r.version === 1 &&
        r.status === "native-owner-application-only" &&
        r.orgId === envelope.task.orgId &&
        r.effectId === envelope.task.subjectId &&
        r.binding === offlineTaskBinding(envelope) &&
        r.referenceJoinHash === envelope.task.expectedStateHash,
    );
    for (const key of [
      "orgId",
      "accountId",
      "invoiceId",
      "effectId",
      "paymentId",
    ])
      insist(
        typeof r[key] === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(r[key]),
      );
    for (const key of [
      "binding",
      "referenceJoinHash",
      "captureHash",
      "resultHash",
    ])
      insist(typeof r[key] === "string" && /^[a-f0-9]{64}$/.test(r[key]));
    insist(
      typeof r.paymentReference === "string" &&
        r.paymentReference.length <= 160 &&
        /^pi_[A-Za-z0-9_]+$/.test(r.paymentReference) &&
        typeof r.sessionReference === "string" &&
        r.sessionReference.length <= 160 &&
        /^cs_test_[A-Za-z0-9_]+$/.test(r.sessionReference) &&
        Number.isSafeInteger(r.amount) &&
        r.amount > 0 &&
        r.amount <= 1e12 &&
        ["cad", "usd"].includes(r.currency),
    );
    return r as OfflineCheckoutPaidResult;
  }
  #validateApplied(
    applied: unknown,
    executor: Actor,
    preparer: Actor,
    envelope: ReturnType<typeof parseOfflineTaskEnvelope>,
    capture: CheckoutPrivateApplicationCapture,
  ) {
    const r = this.#result(applied, envelope),
      comparison = capture.comparison;
    insist(
      r.accountId === comparison.accountId &&
        r.invoiceId === comparison.invoiceId &&
        r.paymentReference === comparison.outcome.settlement.paymentId &&
        r.sessionReference === comparison.outcome.reference &&
        r.amount === comparison.outcome.settlement.amount &&
        r.currency === comparison.outcome.settlement.currency &&
        r.captureHash === capture.captureHash,
    );
    // The return's hash cannot independently establish the private record's
    // contents. Re-read the actual bounded retained owner provenance and the
    // complete Platform receipt journal, without importing evidence twice.
    const changes = this.#database
      .owned("integration")
      .get("SELECT total_changes() AS n")!.n;
    const recovered = this.#result(
      this.#operation.recoverRetainedInTransaction(
        executor,
        preparer,
        envelope,
      ),
      envelope,
    );
    insist(canonical(recovered) === canonical(r));
    const receipt = capturedReceiptRecovery.call(
      this.#receipt,
      executor,
      envelope,
    );
    insist(
      receipt.status === "retained-task-receipt-consistency-only" &&
        receipt.receipt &&
        receipt.receipt.resultHash === r.resultHash &&
        receipt.receipt.binding === r.binding &&
        receipt.receipt.payloadHash === envelope.task.payloadHash,
    );
    this.#principals(preparer, executor);
    insist(
      this.#database.owned("integration").get("SELECT total_changes() AS n")!
        .n === changes,
    );
  }
  recoverRetainedInTransaction(
    executorInput: unknown,
    preparerInput: unknown,
    envelopeInput: unknown,
  ) {
    this.#owners();
    const executor = principal(executorInput),
      preparer = principal(preparerInput),
      envelope = parseOfflineTaskEnvelope(detach(envelopeInput));
    this.#principals(preparer, executor);
    const changes = this.#database
      .owned("integration")
      .get("SELECT total_changes() AS n")!.n;
    const result = this.#result(
      this.#operation.recoverRetainedInTransaction(
        executor,
        preparer,
        envelope,
      ),
      envelope,
    );
    const receipt = capturedReceiptRecovery.call(
      this.#receipt,
      executor,
      envelope,
    );
    insist(
      receipt.status === "retained-task-receipt-consistency-only" &&
        receipt.receipt &&
        receipt.receipt.resultHash === result.resultHash &&
        receipt.receipt.binding === result.binding,
    );
    this.#principals(preparer, executor);
    insist(
      this.#database.owned("integration").get("SELECT total_changes() AS n")!
        .n === changes,
    );
    return result;
  }
}
