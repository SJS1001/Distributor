import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { StockJournalDelivery } from "./stock-journal-delivery.ts";
import { PlatformOfflineOriginalLeaseCommandReviewReader } from "./platform-offline-original-lease-command-review.ts";
import { Platform } from "./platform.ts";
import { IntegrationOfflineOriginalLeaseRetirement } from "./integration-offline-original-lease-retirement.ts";
import { IntegrationCosts } from "./integration-costs.ts";
import { CostCorrections } from "./cost-corrections.ts";
import { Inventory } from "./inventory.ts";
import { InventoryCosts } from "./inventory-costs.ts";
import { InventoryValuations } from "./inventory-valuations.ts";
import { InventoryQuantityCorrections } from "./inventory-quantity-corrections.ts";
import { Catalog } from "./catalog.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
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

/** Trusted static host composition only. This reader independently resolves
 * CURRENT authority, source interval, recovery instance, provider evidence and
 * roster/revocation for the exact binding under the adapter's commit interlock.
 * The adapter must additionally keep the signed lifetime and provider
 * qualification valid through actual COMMIT return; sampled clock checks or
 * an expiring lease alone cannot supply that independently qualified guarantee.
 * Returning caller assertions or archived qualification is not this contract.
 * No provider IO, candidate writes, async work or retained callbacks.
 * Infrastructure qualification remains external; there is no Application route. */
export type OfflineOriginalLeaseRetirementQualification = Readonly<{
  purpose: "distributor-offline-current-original-lease-retirement-qualification-v1";
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
    nativeReviewHash: string;
    commandReviewHash: string;
    priorClaimHash: string;
    claimStarted: number;
    claimStartEvidenceHash: string;
    provider: "quickbooks";
    mode: "sandbox";
    subjectId: string;
  }>;
}>;
export type OfflineOriginalLeaseRetirementHost = Readonly<{
  adapter: OfflineCommitAdapter;
  readCurrent(
    request: OfflineCommitRequest,
  ): OfflineOriginalLeaseRetirementQualification;
}>;
const code = "RESTORE_OFFLINE_ORIGINAL_LEASE_RETIREMENT_COORDINATOR";
const ownerDescriptors = new Map<object, PropertyDescriptorMap>(
  [
    Database,
    Store,
    Identity,
    Platform,
    StockJournalDelivery,
    IntegrationCosts,
    CostCorrections,
    Inventory,
    InventoryCosts,
    InventoryValuations,
    InventoryQuantityCorrections,
    Catalog,
    RestoreOfflineStorage,
  ].map((owner) => [
    owner.prototype,
    Object.getOwnPropertyDescriptors(owner.prototype),
  ]),
);
function insist(ok: unknown): asserts ok {
  check(
    ok,
    code,
    "Current offline original lease retirement qualification did not complete.",
  );
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
function captureHost(
  input: OfflineOriginalLeaseRetirementHost,
): OfflineOriginalLeaseRetirementHost {
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
  }) as OfflineOriginalLeaseRetirementHost;
}

const task = Object.freeze({
  owner: "integration",
  name: "integration.original-lease.retire",
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
/** Fixed signed original lease retirement under the actual outer COMMIT. Missing
 * trusted host stays closed; historical consistency alone grants no authority. */
export class RestoreOfflineOriginalLeaseRetirementCoordinator {
  readonly #operation: IntegrationOfflineOriginalLeaseRetirement;
  readonly #commands: PlatformOfflineOriginalLeaseCommandReviewReader;
  readonly #host: OfflineOriginalLeaseRetirementHost | undefined;
  readonly #ownerMethods: readonly Readonly<{
    owner: object;
    prototype: object;
    methods: readonly (readonly [string, unknown])[];
  }>[];
  readonly #ownerLinks: readonly (readonly [object, string, unknown])[];
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
    journals: StockJournalDelivery,
    host?: OfflineOriginalLeaseRetirementHost,
  ) {
    const child = (owner: object, key: string) => {
      insist(owner && !types.isProxy(owner));
      const d = Object.getOwnPropertyDescriptor(owner, key);
      insist(d && "value" in d && d.value && typeof d.value === "object");
      return d.value as object;
    };
    const costs = child(journals, "costs"),
      corrections = child(costs, "corrections"),
      inventory = child(costs, "inventory"),
      inventoryCosts = child(inventory, "costs"),
      valuations = child(inventoryCosts, "valuations"),
      quantityCorrections = child(inventoryCosts, "quantityCorrections"),
      catalog = child(inventory, "catalog"),
      offline = child(platform, "offline");
    const nativeOwners = [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [platform, Platform.prototype],
      [journals, StockJournalDelivery.prototype],
      [costs, IntegrationCosts.prototype],
      [corrections, CostCorrections.prototype],
      [inventory, Inventory.prototype],
      [inventoryCosts, InventoryCosts.prototype],
      [valuations, InventoryValuations.prototype],
      [quantityCorrections, InventoryQuantityCorrections.prototype],
      [catalog, Catalog.prototype],
      [offline, RestoreOfflineStorage.prototype],
    ];
    const stores = nativeOwners
      .filter(([owner]) => owner !== database)
      .map(([owner]) => [child(owner!, "store"), Store.prototype]);
    this.#ownerMethods = [...nativeOwners, ...stores].map(
      ([owner, prototype]) => {
        insist(
          owner &&
            !types.isProxy(owner) &&
            Object.getPrototypeOf(owner) === prototype,
        );
        const pinned = ownerDescriptors.get(prototype!)!;
        insist(pinned);
        const current = Object.getOwnPropertyDescriptors(prototype!);
        insist(
          Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length,
        );
        for (const [key, d] of Object.entries(pinned))
          insist(
            current[key]?.value === d.value &&
              current[key]?.get === d.get &&
              current[key]?.set === d.set,
          );
        const methods = Object.getOwnPropertyNames(prototype!)
          .filter((key) => key !== "constructor")
          .map(
            (key) =>
              [
                key,
                Object.getOwnPropertyDescriptor(prototype!, key)?.value,
              ] as const,
          );
        return Object.freeze({
          owner: owner!,
          prototype: prototype!,
          methods: Object.freeze(methods),
        });
      },
    );
    this.#ownerLinks = Object.freeze([
      ...nativeOwners
        .filter(([owner]) => owner !== database && owner !== inventoryCosts)
        .map(([owner]) =>
          Object.freeze([owner!, "database", database] as const),
        ),
      ...[
        identity,
        journals,
        costs,
        corrections,
        inventory,
        valuations,
        quantityCorrections,
        catalog,
      ].map((owner) => Object.freeze([owner, "platform", platform] as const)),
      ...[
        journals,
        costs,
        corrections,
        inventory,
        valuations,
        quantityCorrections,
        catalog,
      ].map((owner) => Object.freeze([owner, "identity", identity] as const)),
      Object.freeze([journals, "costs", costs] as const),
      Object.freeze([costs, "journals", journals] as const),
      Object.freeze([costs, "corrections", corrections] as const),
      Object.freeze([costs, "inventory", inventory] as const),
      Object.freeze([inventory, "costs", inventoryCosts] as const),
      Object.freeze([inventory, "catalog", catalog] as const),
      Object.freeze([inventoryCosts, "valuations", valuations] as const),
      Object.freeze([
        inventoryCosts,
        "quantityCorrections",
        quantityCorrections,
      ] as const),
      Object.freeze([inventory, "valuations", valuations] as const),
      Object.freeze([
        inventory,
        "quantityCorrections",
        quantityCorrections,
      ] as const),
      Object.freeze([platform, "offline", offline] as const),
      ...nativeOwners.flatMap(([owner]) =>
        Object.entries(Object.getOwnPropertyDescriptors(owner!)).flatMap(
          ([key, d]) => {
            insist("value" in d);
            return d.value &&
              (typeof d.value === "object" || typeof d.value === "function")
              ? [Object.freeze([owner!, key, d.value] as const)]
              : [];
          },
        ),
      ),
      ...stores.flatMap(([store], i) => {
        const name = Object.getOwnPropertyDescriptor(store!, "owner");
        const expected = [
          "iam",
          "platform",
          "integration",
          "integration",
          "integration",
          "inventory",
          "inventory",
          "inventory",
          "inventory",
          "catalog",
          "platform",
        ][i];
        insist(name && "value" in name && name.value === expected);
        return [
          Object.freeze([store!, "database", database] as const),
          Object.freeze([store!, "owner", name.value] as const),
        ];
      }),
    ]);
    this.owners();
    this.#operation = new IntegrationOfflineOriginalLeaseRetirement(
      database,
      identity,
      platform,
      journals,
    );
    this.#commands = new PlatformOfflineOriginalLeaseCommandReviewReader(
      database,
      identity,
      journals,
    );
    this.#host = host === undefined ? undefined : captureHost(host);
  }
  private owners() {
    for (const { owner, prototype, methods } of this.#ownerMethods) {
      insist(
        !types.isProxy(owner) && Object.getPrototypeOf(owner) === prototype,
      );
      const pinned = ownerDescriptors.get(prototype)!;
      const current = Object.getOwnPropertyDescriptors(prototype);
      insist(
        Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length,
      );
      for (const [key, d] of Object.entries(pinned))
        insist(
          current[key]?.value === d.value &&
            current[key]?.get === d.get &&
            current[key]?.set === d.set,
        );
      for (const [key, method] of methods)
        insist(
          !Object.hasOwn(owner, key) &&
            Object.getOwnPropertyDescriptor(prototype, key)?.value === method,
        );
    }
    for (const [owner, key, expected] of this.#ownerLinks) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      insist(
        descriptor && "value" in descriptor && descriptor.value === expected,
      );
    }
  }
  execute(
    evidenceActorInput: unknown,
    executorInput: unknown,
    envelopeInput: unknown,
    approvalInput: unknown,
    payloadInput: unknown,
  ) {
    this.owners();
    const host = this.#host;
    insist(host);
    // BOTH locators are inert before any trusted host or native owner callback.
    const evidenceActor = principal(evidenceActorInput),
      executor = principal(executorInput);
    insist(
      evidenceActor.id !== executor.id &&
        evidenceActor.orgId === executor.orgId,
    );
    const envelope = parseOfflineTaskEnvelope(detach(envelopeInput)),
      approvals = detach(approvalInput),
      payload = detach(payloadInput);
    insist(envelope.task.payloadHash === digest(canonical(payload)));
    insist(
      envelope.preparedBy === evidenceActor.id &&
        envelope.executorId === executor.id &&
        envelope.task.orgId === evidenceActor.orgId,
    );
    insist(
      envelope.task.owner === task.owner &&
        envelope.task.name === task.name &&
        envelope.task.version === task.version &&
        envelope.task.siteIds.length === 0 &&
        envelope.task.priorClaim !== null,
    );
    let previousNow: number | undefined,
      qualificationEvidence: string | undefined;
    const qualified = (request: OfflineCommitRequest) => {
      this.owners();
      this.database.requireTransaction();
      const store = this.database.owned("integration"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      insist(host.adapter.assertHeld(request) === undefined);
      const captured = host.readCurrent(request);
      this.owners();
      insist(store.get("SELECT total_changes() AS n")!.n === changes);
      const q = detach(captured) as OfflineOriginalLeaseRetirementQualification;
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
        "nativeReviewHash",
        "commandReviewHash",
        "priorClaimHash",
        "claimStarted",
        "claimStartEvidenceHash",
        "provider",
        "mode",
        "subjectId",
      ]);
      insist(
        q.purpose ===
          "distributor-offline-current-original-lease-retirement-qualification-v1" &&
          q.envelopeBinding === offlineTaskBinding(envelope),
      );
      insist(
        typeof q.now === "string" &&
          Number.isSafeInteger(q.evidence.claimStarted) &&
          q.evidence.claimStarted >= 0,
      );
      const now = Date.parse(q.now);
      insist(
        Number.isFinite(now) &&
          new Date(now).toISOString() === q.now &&
          now >= Date.parse(envelope.preparedAt) &&
          q.evidence.claimStarted <= Date.parse(envelope.preparedAt) &&
          now < Date.parse(envelope.expiresAt) &&
          (previousNow === undefined || now >= previousNow),
      );
      previousNow = now;
      insist(
        canonical(q.trust) === canonical(envelope.trust) &&
          offlineApprovalRosterFingerprint(q.roster) ===
            envelope.trust.registryHash,
      );
      verifyOfflineTaskApprovals(envelope, approvals, q.roster, q.associations);
      for (const key of [
        "payloadHash",
        "nativeReviewHash",
        "commandReviewHash",
        "priorClaimHash",
        "claimStartEvidenceHash",
      ] as const)
        insist(
          typeof q.evidence[key] === "string" &&
            /^[a-f0-9]{64}$/.test(q.evidence[key]),
        );
      insist(
        q.evidence.setHash === envelope.evidence.setHash &&
          q.evidence.qualificationHash ===
            envelope.evidence.qualificationHash &&
          q.evidence.payloadHash === envelope.task.payloadHash &&
          q.evidence.provider === "quickbooks" &&
          q.evidence.mode === "sandbox" &&
          q.evidence.subjectId === envelope.task.subjectId &&
          q.evidence.nativeReviewHash === envelope.task.expectedStateHash &&
          q.evidence.priorClaimHash ===
            digest(canonical(envelope.task.priorClaim)) &&
          q.evidence.claimStarted === payload.leaseStarted,
      );
      const evidenceHash = canonical(q.evidence);
      insist(
        qualificationEvidence === undefined ||
          qualificationEvidence === evidenceHash,
      );
      qualificationEvidence = evidenceHash;
      for (const locator of [evidenceActor, executor]) {
        const actor = this.identity.currentActor(locator);
        permit(actor, ["finance"]);
        insist(
          !actor.accountId &&
            !this.identity.security(actor).passwordChangeRequired,
        );
      }
      return q;
    };
    const guard = new RestoreOfflineCommitGuard(this.database, this.platform, {
      adapter: {
        identity: host.adapter.identity,
        hold: (request, commit) => host.adapter.hold(request, commit),
        assertHeld: (request) => {
          qualified(request);
        },
      },
      task,
      operation: (actual) => {
        const request: OfflineCommitRequest = Object.freeze({
          purpose: "distributor-offline-commit-v1",
          envelopeBinding: offlineTaskBinding(actual),
          envelope: actual,
        });
        const q = qualified(request);
        const commands = this.#commands.getInTransaction(
          evidenceActor,
          actual.task.subjectId,
        );
        insist(
          commands.nativeReviewHash === actual.task.expectedStateHash &&
            commands.factsHash === q.evidence.commandReviewHash,
        );
        // The independent host qualifies the missing historical claim-start,
        // source/provider interval and current authority. The reader's historical
        // blockers remain in the retained task result; no audit is invented.
        qualified(request);
        const applied = this.#operation.applyInTransaction(
          evidenceActor,
          executor,
          actual,
          payload,
        );
        this.owners();
        insist(
          applied.record.nativeBeforeHash === q.evidence.nativeReviewHash &&
            applied.record.commandBeforeHash === q.evidence.commandReviewHash &&
            applied.record.payloadHash === q.evidence.payloadHash &&
            applied.record.journalId === actual.task.subjectId,
        );
        qualified(request);
      },
    });
    return guard.execute(envelope);
  }
  /** Read-only retained consistency after restart; never reapply an uncertain write. */
  recoverRetainedInTransaction(
    preparer: unknown,
    executor: unknown,
    envelope: unknown,
  ) {
    this.owners();
    const result = this.#operation.recoverRetainedInTransaction(
      principal(preparer),
      principal(executor),
      parseOfflineTaskEnvelope(detach(envelope)),
    );
    this.owners();
    return result;
  }
}
