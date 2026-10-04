import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { CarrierBookings } from "./carrier-bookings.ts";
import { PlatformOfflineCanadaPostCommandReviewReader } from "./platform-offline-canada-post-command-review.ts";
import { Platform } from "./platform.ts";
import { IntegrationOfflineCanadaPostMember } from "./integration-offline-canada-post-member.ts";
import { Fulfillment } from "./fulfillment.ts";
import { Inventory } from "./inventory.ts";
import { Orders } from "./orders.ts";
import { Billing } from "./billing.ts";
import { Warranty } from "./warranty.ts";
import { Catalog } from "./catalog.ts";
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
export type OfflineCanadaPostMemberQualification = Readonly<{
  purpose: "distributor-offline-current-canada-post-member-qualification-v1";
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
    inputHash: string;
    comparisonHash: string;
    nativeJoinHash: string;
    commandReviewHash: string;
    provider: "canada-post";
    mode: "test";
    subjectId: string;
    groupId: string;
  }>;
}>;
export type OfflineCanadaPostMemberHost = Readonly<{
  adapter: OfflineCommitAdapter;
  readCurrent(
    request: OfflineCommitRequest,
  ): OfflineCanadaPostMemberQualification;
}>;
const code = "RESTORE_OFFLINE_CANADA_POST_MEMBER_COORDINATOR";
const ownerDescriptors = new Map<object, PropertyDescriptorMap>(
  [
    Database,
    Store,
    Identity,
    Platform,
    Fulfillment,
    CarrierBookings,
    Inventory,
    Orders,
    Billing,
    Warranty,
    Catalog,
  ].map((owner) => [
    owner.prototype,
    Object.getOwnPropertyDescriptors(owner.prototype),
  ]),
);
function insist(ok: unknown): asserts ok {
  check(
    ok,
    code,
    "Current offline Canada Post member qualification did not complete.",
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
  input: OfflineCanadaPostMemberHost,
): OfflineCanadaPostMemberHost {
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
  }) as OfflineCanadaPostMemberHost;
}

const task = Object.freeze({
  owner: "integration",
  name: "integration.canada-post-member.import",
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
/** Fixed signed Canada Post member under the actual outer COMMIT. Missing
 * trusted host stays closed; historical consistency alone grants no authority. */
export class RestoreOfflineCanadaPostMemberCoordinator {
  readonly #operation: IntegrationOfflineCanadaPostMember;
  readonly #commands: PlatformOfflineCanadaPostCommandReviewReader;
  readonly #host: OfflineCanadaPostMemberHost | undefined;
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
    fulfillment: Fulfillment,
    carrier: CarrierBookings,
    host?: OfflineCanadaPostMemberHost,
  ) {
    const child = (owner: object, key: string) => {
      insist(owner && !types.isProxy(owner));
      const d = Object.getOwnPropertyDescriptor(owner, key);
      insist(d && "value" in d && d.value && typeof d.value === "object");
      return d.value as object;
    };
    const inventory = child(fulfillment, "inventory"),
      orders = child(fulfillment, "orders"),
      billing = child(fulfillment, "billing"),
      warranty = child(carrier, "warranty"),
      catalog = child(inventory, "catalog");
    const nativeOwners = [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [fulfillment, Fulfillment.prototype],
      [carrier, CarrierBookings.prototype],
      [platform, Platform.prototype],
      [inventory, Inventory.prototype],
      [orders, Orders.prototype],
      [billing, Billing.prototype],
      [warranty, Warranty.prototype],
      [catalog, Catalog.prototype],
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
      Object.freeze([identity, "database", database] as const),
      Object.freeze([fulfillment, "database", database] as const),
      Object.freeze([carrier, "database", database] as const),
      Object.freeze([platform, "database", database] as const),
      Object.freeze([identity, "platform", platform] as const),
      Object.freeze([fulfillment, "identity", identity] as const),
      Object.freeze([fulfillment, "platform", platform] as const),
      Object.freeze([carrier, "identity", identity] as const),
      Object.freeze([carrier, "platform", platform] as const),
      Object.freeze([carrier, "fulfillment", fulfillment] as const),
      Object.freeze([fulfillment, "inventory", inventory] as const),
      Object.freeze([fulfillment, "orders", orders] as const),
      Object.freeze([fulfillment, "billing", billing] as const),
      Object.freeze([carrier, "warranty", warranty] as const),
      Object.freeze([orders, "inventory", inventory] as const),
      Object.freeze([orders, "billing", billing] as const),
      Object.freeze([orders, "catalog", catalog] as const),
      Object.freeze([inventory, "catalog", catalog] as const),
      Object.freeze([warranty, "inventory", inventory] as const),
      Object.freeze([warranty, "fulfillment", fulfillment] as const),
      Object.freeze([warranty, "billing", billing] as const),
      ...[inventory, orders, billing, warranty, catalog].flatMap((owner) => [
        Object.freeze([owner, "database", database] as const),
        Object.freeze([owner, "platform", platform] as const),
      ]),
      ...[inventory, orders, billing, warranty].map((owner) =>
        Object.freeze([owner, "identity", identity] as const),
      ),
      Object.freeze([catalog, "identity", identity] as const),
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
      ...stores.flatMap(([store]) => {
        const name = Object.getOwnPropertyDescriptor(store!, "owner");
        insist(name && "value" in name && typeof name.value === "string");
        return [
          Object.freeze([store!, "database", database] as const),
          Object.freeze([store!, "owner", name.value] as const),
        ];
      }),
    ]);
    this.owners();
    this.#operation = new IntegrationOfflineCanadaPostMember(
      database,
      identity,
      platform,
      fulfillment,
      carrier,
    );
    this.#commands = new PlatformOfflineCanadaPostCommandReviewReader(
      database,
      identity,
      platform,
      fulfillment,
      carrier,
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
    manifestInput: unknown,
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
      manifest = detach(manifestInput);
    insist(envelope.evidence.items.length === 1);
    insist(
      envelope.preparedBy === evidenceActor.id &&
        envelope.executorId === executor.id &&
        envelope.task.orgId === evidenceActor.orgId,
    );
    insist(
      envelope.task.owner === task.owner &&
        envelope.task.name === task.name &&
        envelope.task.version === task.version &&
        envelope.task.siteIds.length === 1 &&
        envelope.task.priorClaim === null,
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
      const q = detach(captured) as OfflineCanadaPostMemberQualification;
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
        "inputHash",
        "comparisonHash",
        "nativeJoinHash",
        "commandReviewHash",
        "provider",
        "mode",
        "subjectId",
        "groupId",
      ]);
      insist(
        q.purpose ===
          "distributor-offline-current-canada-post-member-qualification-v1" &&
          q.envelopeBinding === offlineTaskBinding(envelope),
      );
      insist(
        typeof q.now === "string" &&
          typeof q.evidence.groupId === "string" &&
          /^[A-Za-z0-9_-]{1,128}$/.test(q.evidence.groupId),
      );
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
      verifyOfflineTaskApprovals(envelope, approvals, q.roster, q.associations);
      for (const key of [
        "payloadHash",
        "inputHash",
        "comparisonHash",
        "nativeJoinHash",
        "commandReviewHash",
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
          q.evidence.provider === "canada-post" &&
          q.evidence.mode === "test" &&
          q.evidence.subjectId === envelope.task.subjectId,
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
        if (locator === executor) permit(actor, ["warehouse"]);
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
        qualified(request);
        // The exact ordinary request preimages must be proven before effects.
        // Provider/source truth is supplied only by the independently qualified
        // trusted host; historical native facts do not establish that truth.
        const q = qualified(request);
        const commands = this.#commands.getInTransaction(
          evidenceActor as Actor,
          q.evidence.groupId,
          actual.task.subjectId,
        );
        insist(
          commands.nativeReviewHash === actual.task.expectedStateHash &&
            commands.factsHash === q.evidence.commandReviewHash &&
            commands.blockers.every(
              (b: string) =>
                b === "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
            ),
        );
        const handle = this.#operation.read(actual, manifest);
        try {
          handle.complete();
          qualified(request);
          // One-shot private handle owns its join AND native application. A
          // separate review would consume it; check the actual returned bindings
          // before COMMIT and let any mismatch roll the whole writer back.
          const applied = this.#operation.applyInTransaction(executor, handle);
          this.owners();
          insist(
            applied.record.inputHash === q.evidence.inputHash &&
              applied.record.comparisonHash === q.evidence.comparisonHash &&
              applied.record.nativeJoinHash === q.evidence.nativeJoinHash &&
              applied.record.result.groupId === q.evidence.groupId &&
              applied.record.result.bookingId === actual.task.subjectId,
          );
          qualified(request);
        } finally {
          handle.dispose();
        }
      },
    });
    return guard.execute(envelope);
  }
  /** Read only, exact native/Platform receipt proof, never repeat an uncertain write. */
  recoverInTransaction(executor: unknown, envelope: unknown, record: unknown) {
    this.owners();
    return this.#operation.recoverInTransaction(
      principal(executor),
      envelope,
      record,
    );
  }
  /** Recover the unchanged Integration-owned preimage after restart. No host or
   * caller-supplied result record is needed; current native authority remains. */
  recoverRetainedInTransaction(executor: unknown, envelope: unknown) {
    this.owners();
    const result = this.#operation.recoverRetainedInTransaction(
      principal(executor),
      envelope,
    );
    this.owners();
    return result;
  }
}
