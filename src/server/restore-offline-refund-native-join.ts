import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { IntegrationOfflineRefundReview } from "./integration-offline-refund-review.ts";
import { IntegrationOfflineRefundNegativeHistory } from "./integration-offline-refund-negative-history.ts";
import { PlatformOfflineRefundReviewReader } from "./platform-offline-refund-review.ts";
import {
  isCapturedOfflineFailedRefundComparison,
  type OfflineRefundNative,
  type OfflineRefundEmptyHistory,
} from "./integration-offline-refund-evidence.ts";

const purpose = "distributor-offline-failed-refund-native-join-v1";
function consistent(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_REFUND_NATIVE_JOIN",
    "Captured assertions do not match complete native refund history.",
  );
}
function principal(input: Actor): Actor {
  consistent(
    input !== null && typeof input === "object" && !types.isProxy(input),
  );
  // Use only detached identities. Never read captured role/site/account grants
  // or invoke a caller accessor before fresh IAM resolves the native principal.
  const values: Record<string, string> = {};
  for (const name of ["orgId", "id"]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    consistent(descriptor && "value" in descriptor);
    const value: unknown = descriptor.value;
    consistent(
      typeof value === "string" &&
        value.length > 0 &&
        value.length <= 160 &&
        value.trim() === value &&
        !/[\u0000-\u001f\u007f]/.test(value),
    );
    values[name] = value;
  }
  return values as unknown as Actor;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Fixed same-writer native join. No files, callback, caller owner facts, SQL
 * ports, writes or authority are accepted. Trusted composition supplies the
 * exact Database/IAM/Billing instances from one Application. */
export class RestoreOfflineRefundNativeJoin {
  readonly #database: Database;
  readonly #identity: Identity;
  readonly #billing: Billing;
  readonly #integration: IntegrationOfflineRefundReview;
  readonly #negative: IntegrationOfflineRefundNegativeHistory;
  readonly #platform: PlatformOfflineRefundReviewReader;
  constructor(database: Database, identity: Identity, billing: Billing) {
    for (const [value, prototype] of [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [billing, Billing.prototype],
    ] as const)
      consistent(
        value !== null &&
          typeof value === "object" &&
          !types.isProxy(value) &&
          Object.getPrototypeOf(value) === prototype,
      );
    this.#database = database;
    this.#identity = identity;
    this.#billing = billing;
    this.#integration = new IntegrationOfflineRefundReview(
      database,
      identity,
      billing,
    );
    this.#negative = new IntegrationOfflineRefundNegativeHistory(
      database,
      identity,
      billing,
    );
    this.#platform = new PlatformOfflineRefundReviewReader(database, identity);
  }
  getInTransaction(actorInput: Actor, comparisonInput: unknown) {
    this.#database.requireTransaction();
    // WeakSet lookup invokes no reflection/getters/proxy traps, even for a
    // revoked proxy. Frozen comparator values cannot change during native reads.
    consistent(isCapturedOfflineFailedRefundComparison(comparisonInput));
    const comparison = comparisonInput;
    const actor = this.#identity.currentActor(principal(actorInput));
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Current organization finance staff is required.",
      403,
    );
    check(
      !this.#identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing refund history.",
      403,
    );
    consistent(comparison.native.organization.id === actor.orgId);
    const store = this.#database.owned("integration");
    const unchanged = store.get("SELECT total_changes() AS n")!.n;
    const { effect: capturedEffect, refund: capturedRefund } =
      comparison.native;
    // Run the global fixed-set byte/node preflight before the older scoped
    // Integration reader can materialize its selected JSON/history rows.
    const negative = this.#negative.getInTransaction(
      actor,
      capturedEffect.id,
      comparison.outcome.reference,
    );
    const billing =
      this.#billing.refunds.reviewOfflineFailedRefundInTransaction(
        actor,
        capturedRefund.id,
      );
    const integration = this.#integration.getInTransaction(
      actor,
      capturedEffect.id,
    );
    const platform = this.#platform.getInTransaction(
      actor,
      capturedRefund.id,
      capturedEffect.id,
    );
    consistent(negative.billingReviewHash === billing.factsHash);
    const org = this.#identity.organization(actor);
    const account = this.#identity.customer(actor, integration.accountId);
    const { invoice, originalPayment: payment, refund } = billing;
    consistent(
      account.currency === billing.currency &&
        org.currency === billing.currency,
    );
    consistent(
      refund.state === "unknown" &&
        payment.provider === "stripe" &&
        integration.effect.state === "unknown" &&
        integration.effect.provider === "stripe" &&
        integration.effect.kind === "refund" &&
        integration.effect.external_ref === null &&
        integration.effect.result === null,
    );
    const native: OfflineRefundNative = {
      organization: { id: org.id, region: org.region, currency: org.currency },
      account: {
        id: account.id,
        org_id: account.org_id,
        currency: billing.currency,
      },
      invoice: {
        id: invoice.id,
        org_id: invoice.org_id,
        account_id: invoice.account_id,
        currency: billing.currency,
        total: invoice.total,
      },
      payment: {
        id: payment.id,
        org_id: payment.org_id,
        invoice_id: payment.invoice_id,
        provider: "stripe",
        external_ref: payment.external_ref,
        amount: payment.amount,
      },
      refund: {
        id: refund.id,
        org_id: refund.org_id,
        invoice_id: refund.invoice_id,
        payment_id: refund.payment_id,
        amount: refund.amount,
        reference: refund.reference,
        state: "unknown",
      },
      effect: {
        ...integration.effect,
        provider: "stripe",
        kind: "refund",
        state: "unknown",
        external_ref: null,
        result: null,
      },
    };
    consistent(canonical(native) === canonical(comparison.native));
    // Completeness comes from actual owners, not deletion/filtering of the
    // older reader's three deliberately retained inherent blocker strings.
    for (const rows of [
      billing.providerMappings,
      billing.observations,
      billing.manualProofs,
      billing.notices,
      billing.noticeUpdates,
      billing.noticeReads,
      integration.offlineImports,
      integration.leases,
      integration.refundCallbacks,
      integration.checkoutCallbacks,
      integration.inbox,
      integration.paymentAllocations,
      integration.refundMappings,
      integration.creditApplications,
      integration.cancellations,
      integration.renewals,
      integration.checkoutObservations,
      integration.balanceReads,
      integration.balanceObservations,
    ])
      consistent(rows.length === 0);
    consistent(
      !integration.effects.some((effect) => effect.provider === "quickbooks"),
    );
    consistent(integration.polls.length === 1);
    const poll = integration.polls[0]!;
    consistent(
      poll.effect_id === native.effect.id &&
        poll.org_id === actor.orgId &&
        poll.token === null &&
        poll.started_at === null,
    );
    consistent(platform.requests.length === 1 && platform.queues.length === 1);
    const original = platform.requests[0]!,
      queued = platform.queues[0]!;
    consistent(
      original.result.state === "pending" &&
        queued.result.state === "pending" &&
        original.requestHash === digest(canonical(comparison.refundRequest)) &&
        queued.requestHash === digest(canonical({ refundId: refund.id })) &&
        original.audit.sequence < queued.audit.sequence &&
        Date.parse(original.createdAt) <= Date.parse(queued.createdAt) &&
        Date.parse(original.audit.createdAt) <=
          Date.parse(queued.audit.createdAt),
    );
    const receipt = (value: typeof original) => ({
      orgId: value.orgId,
      actorId: value.actorId,
      command: value.command,
      key: value.key,
      requestHash: value.requestHash,
      result: { id: value.result.id, state: "pending" as const },
      createdAt: value.createdAt,
    });
    const history: OfflineRefundEmptyHistory = {
      orgId: actor.orgId,
      effectId: native.effect.id,
      refundId: refund.id,
      coverage: "complete-for-subject",
      poll: {
        effect_id: native.effect.id,
        org_id: actor.orgId,
        token: null,
        started_at: null,
        retry_at: Number(poll.retry_at),
      },
      providerMappings: [],
      observations: [],
      callbacks: [],
      manualProofs: [],
      notices: [],
      noticeUpdates: [],
      noticeReads: [],
      accountingDescendants: [],
      genericLeases: [],
      receipts: [receipt(original), receipt(queued)],
    };
    consistent(canonical(history) === canonical(comparison.candidateHistory));
    consistent(
      comparison.binding.orgId === actor.orgId &&
        comparison.binding.accountId === account.id,
    );
    const body = {
      version: 1 as const,
      purpose,
      status: "native-consistency-only" as const,
      orgId: actor.orgId,
      effectId: native.effect.id,
      refundId: refund.id,
      comparisonInputHash: comparison.inputHash,
      proposedReference: comparison.outcome.reference,
      nativeReviewHashes: {
        billing: billing.factsHash,
        integration: integration.hash,
        platform: platform.factsHash,
        negativeHistory: negative.hash,
      },
      native,
      history,
    };
    consistent(store.get("SELECT total_changes() AS n")!.n === unchanged);
    return freeze({
      ...body,
      hash: digest(canonical(body)),
      reviews: { billing, integration, platform, negativeHistory: negative },
      requiredChecks: [
        "current-signatures-clock-trust-and-revocation",
        "independent-external-authority-and-instance-anchor",
        "qualified-source-and-candidate-fencing-through-commit",
        "qualified-evidence-and-provider-binding",
        "static-owner-writes-and-exact-commit-recovery",
      ] as const,
    });
  }
}
export type OfflineRefundNativeJoin = ReturnType<
  RestoreOfflineRefundNativeJoin["getInTransaction"]
>;
