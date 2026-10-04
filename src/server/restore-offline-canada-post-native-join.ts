import { lstatSync } from "node:fs";
import { types } from "node:util";
import { canonical, digest, DomainError, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { Fulfillment } from "./fulfillment.ts";
import { CarrierOfflineMemberReview } from "./carrier-offline-member-review.ts";
import { PlatformOfflineCarrierReviewReader } from "./platform-offline-carrier-review.ts";
import { compareCanadaPostOfflineMemberEvidence } from "./canada-post-offline-member-evidence.ts";
import {
  offlineTaskBinding,
  type OfflineTaskEnvelopeV1,
} from "./restore-offline-envelope.ts";
import { isInternalCanadaPostPrivateCapture } from "./restore-offline-canada-post-private-evidence.ts";

function need(v: unknown): asserts v {
  if (!v)
    throw new DomainError(
      "RESTORE_OFFLINE_CANADA_POST_NATIVE",
      "Private Canada Post evidence does not match the current native writer.",
    );
}
function field(v: object, key: string) {
  const d = Object.getOwnPropertyDescriptor(v, key);
  need(d && "value" in d);
  return d.value;
}
function actual(v: unknown, prototype: object): asserts v is object {
  need(
    v &&
      typeof v === "object" &&
      !types.isProxy(v) &&
      Object.getPrototypeOf(v) === prototype,
  );
  // Method overrides are not read ports. Host wiring supplies actual native owners.
  for (const [key, d] of Object.entries(
    Object.getOwnPropertyDescriptors(prototype),
  ))
    if (typeof d.value === "function") need(!Object.hasOwn(v, key));
}
function owner(v: object, prototype: object, database: Database, name: string) {
  actual(v, prototype);
  need(field(v, "database") === database);
  const s = field(v, "store");
  actual(s, Store.prototype);
  need(field(s, "database") === database && field(s, "owner") === name);
}
function locator(v: unknown): Actor {
  need(v && typeof v === "object" && !types.isProxy(v));
  need(
    Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null,
  );
  // Fixed locator ONLY. Supplied role/sites/name are neither accepted nor trusted.
  const keys = Reflect.ownKeys(v);
  need(keys.length === 2 && keys.every((k) => k === "id" || k === "orgId"));
  const out: Record<string, string> = {};
  for (const key of ["id", "orgId"]) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    need(
      d &&
        "value" in d &&
        d.enumerable &&
        typeof d.value === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(d.value),
    );
    out[key] = d.value;
  }
  return out as unknown as Actor;
}
function equal(a: unknown, b: unknown) {
  need(canonical(a) === canonical(b));
}
const captured = new WeakSet<object>();
export function isCapturedCanadaPostNativeJoin(
  v: unknown,
): v is CanadaPostNativeJoin {
  return v !== null && typeof v === "object" && captured.has(v);
}
export type CanadaPostNativeJoin = Readonly<{
  version: 1;
  purpose: "canada-post-private-native-consistency-v1";
  envelopeBinding: string;
  actor: Readonly<{ id: string; orgId: string }>;
  candidateHash: string;
  comparison: ReturnType<typeof compareCanadaPostOfflineMemberEvidence>;
  requiredChecks: readonly string[];
  hash: string;
}>;

/** Internal fixed native composition, not an importer or an authority port.
 * A borrowed/prototype-copied capture is refused before ANY input traversal. */
export class RestoreOfflineCanadaPostNativeJoin {
  readonly #db: Database;
  readonly #identity: Identity;
  readonly #platform: Platform;
  readonly #fulfillment: Fulfillment;
  readonly #carrier: CarrierOfflineMemberReview;
  readonly #provenance: PlatformOfflineCarrierReviewReader;
  #busy = false;
  #reentered = false;
  constructor(
    database: Database,
    identity: Identity,
    platform: Platform,
    fulfillment: Fulfillment,
  ) {
    actual(database, Database.prototype);
    owner(platform, Platform.prototype, database, "platform");
    owner(identity, Identity.prototype, database, "iam");
    owner(fulfillment, Fulfillment.prototype, database, "fulfillment");
    need(
      field(identity, "platform") === platform &&
        field(fulfillment, "platform") === platform &&
        field(fulfillment, "identity") === identity,
    );
    this.#db = database;
    this.#identity = identity;
    this.#platform = platform;
    this.#fulfillment = fulfillment;
    this.#carrier = new CarrierOfflineMemberReview(
      database,
      identity,
      platform,
    );
    this.#provenance = new PlatformOfflineCarrierReviewReader(
      database,
      identity,
    );
  }
  /** Called only by the fixed private handle during its one-shot join. The
   * private registry checks exact object identities, owning instance AND state;
   * no exported method can manufacture or retrieve its envelope/parsed object. */
  joinCapturedInTransaction(
    token: unknown,
    actorInput: unknown,
    envelope: OfflineTaskEnvelopeV1,
    input: any,
  ): CanadaPostNativeJoin {
    let entered = false;
    try {
      if (this.#busy) {
        this.#reentered = true;
        need(false);
      }
      need(isInternalCanadaPostPrivateCapture(token, this, envelope, input));
      this.#busy = true;
      this.#reentered = false;
      entered = true;
      actual(this.#db, Database.prototype);
      this.#db.requireTransaction();
      owner(this.#identity, Identity.prototype, this.#db, "iam");
      owner(this.#platform, Platform.prototype, this.#db, "platform");
      owner(this.#fulfillment, Fulfillment.prototype, this.#db, "fulfillment");
      need(
        field(this.#identity, "platform") === this.#platform &&
          field(this.#fulfillment, "platform") === this.#platform &&
          field(this.#fulfillment, "identity") === this.#identity,
      );
      const actor = this.#identity.currentActor(locator(actorInput));
      const comparison = compareCanadaPostOfflineMemberEvidence(input);
      need(actor.orgId === comparison.orgId);
      const before = this.#db.captureRestoreCandidateInTransaction();
      const stat = lstatSync(this.#db.path, { bigint: true });
      need(
        stat.dev >= 0n &&
          stat.ino >= 0n &&
          stat.dev <= BigInt(Number.MAX_SAFE_INTEGER) &&
          stat.ino <= BigInt(Number.MAX_SAFE_INTEGER),
      );
      need(
        envelope.candidate.file.dev === Number(stat.dev) &&
          envelope.candidate.file.ino === Number(stat.ino) &&
          envelope.candidate.logicalHash === before.logicalHash,
      );
      const hold = this.#platform.rawRecoveryHoldInTransaction();
      need(hold);
      need(
        envelope.recovery.snapshotHash === hold.snapshot_hash &&
          envelope.recovery.restoredAt === hold.restored_at &&
          envelope.recovery.sourceCompletedAt === hold.source_completed_at,
      );
      need(
        envelope.recovery.schemaHash === before.schemaHash &&
          envelope.recovery.region === before.region,
      );
      equal(envelope.recovery.organizations, before.organizations);
      need(
        envelope.task.orgId === comparison.orgId &&
          envelope.task.subjectId === comparison.bookingId &&
          envelope.task.expectedRevision === 0 &&
          envelope.task.expectedStateHash === comparison.nativeReviewHash &&
          envelope.task.priorClaim === null,
      );
      equal(envelope.task.siteIds, [input.native.groups[0].warehouse_id]);
      const native = this.#carrier.reviewUnknownMemberInTransaction(
        actor,
        comparison.groupId,
        comparison.bookingId,
      );
      const proposed = this.#carrier.reviewProposedReferencesInTransaction(
        actor,
        input.proposedReferences.proposed,
      );
      const platform = native.preparations.map((p) =>
        this.#provenance.getInTransaction(
          actor,
          comparison.groupId,
          p.bookingId as string,
        ),
      );
      const custody = native.preparations.map((p) =>
        this.#fulfillment.reviewPackedCarrierCustodyInTransaction(
          actor,
          p.intent.shipmentId,
        ),
      );
      // Whole bounded projections, including all siblings, scope hashes and
      // retained original receipts/audits/events. Never just selected scalars.
      equal(native, input.native);
      equal(proposed, input.proposedReferences);
      equal(platform, input.platform);
      equal(custody, input.custody);
      equal(this.#platform.rawRecoveryHoldInTransaction(), hold);
      equal(this.#db.captureRestoreCandidateInTransaction(), before);
      const after = lstatSync(this.#db.path, { bigint: true });
      need(after.dev === stat.dev && after.ino === stat.ino);
      const facts = {
        version: 1 as const,
        purpose: "canada-post-private-native-consistency-v1" as const,
        envelopeBinding: offlineTaskBinding(envelope),
        actor: Object.freeze({ id: actor.id, orgId: actor.orgId }),
        candidateHash: before.logicalHash,
        comparison,
        requiredChecks: Object.freeze([
          "current-open-session-and-release-history",
          "current-independent-signatures-trust-revocation",
          "qualified-source-candidate-fences-through-commit",
          "qualified-account-provider-evidence-and-source-interval",
          "original-command-payload-provenance",
          "static-owner-mutation-and-exact-durable-recovery",
        ]),
      };
      need(
        !this.#reentered &&
          isInternalCanadaPostPrivateCapture(token, this, envelope, input),
      );
      const result = Object.freeze({
        ...facts,
        hash: digest(canonical(facts)),
      });
      captured.add(result);
      return result;
    } catch {
      throw new DomainError(
        "RESTORE_OFFLINE_CANADA_POST_NATIVE",
        "Private Canada Post evidence does not match the current native writer.",
      );
    } finally {
      if (entered) this.#busy = false;
    }
  }
}
