import { isInternalCanadaPostOwnerCapture } from "./restore-offline-canada-post-private-evidence.ts";
import type { OfflineTaskEnvelopeV1 } from "./restore-offline-envelope.ts";
import type { CanadaPostNativeJoin } from "./restore-offline-canada-post-native-join.ts";
import { PlatformOfflineCarrierReviewReader } from "./platform-offline-carrier-review.ts";
import {
  assertCarrierConfiguration,
  captureCarrierConfiguration,
} from "./carrier-configuration.ts";
import { captureDhlReview } from "./dhl-shipping-review.ts";
import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Identity } from "./iam.ts";
import type { Fulfillment, Shipment } from "./fulfillment.ts";
import type { Warranty, ReplacementCarrierSnapshot } from "./warranty.ts";
import type {
  CanadaPostShipmentObservation,
  CanadaPostManifestReview,
  CanadaPostManifestObservation,
} from "./canada-post-test.ts";
import { CANADA_POST_INITIALIZE_DDL } from "./canada-post-schema.ts";
import type { QueueObservation } from "../shared/operations-health.ts";
import {
  carrierNames,
  type CarrierAddress,
  type CarrierBookingView,
  type CarrierName,
  type CarrierParcel,
  type CarrierPrepare,
  type CarrierReview,
  type CarrierConfiguration,
  type CanadaPostGroupView,
  type CanadaPostManifestIdentity,
  type CarrierClaimTarget,
  type CarrierClaimReview,
} from "../shared/carrier-booking.ts";

export type CarrierIntent = CarrierPrepare & {
  bookingId: string;
  reviewHash: string;
  nativeSnapshot: Shipment | ReplacementCarrierSnapshot;
  configuration?: CarrierConfiguration;
};
export type CarrierResult = {
  bookingId: string;
  reviewHash: string;
  reference: string;
  tracking: string;
  label: {
    mediaType: "application/pdf" | "image/png" | "image/gif";
    bytes: Buffer;
  };
};
// Trusted adapters must call beforeWrite immediately before their only provider write.
// A lookup is read-only. No adapter may retry a write after an uncertain response.
export interface CarrierAdapter {
  readonly configuration?: CarrierConfiguration;
  provider: CarrierName;
  sandbox: true;
  book(intent: CarrierIntent, beforeWrite: () => void): Promise<CarrierResult>;
  lookup(intent: CarrierIntent): Promise<CarrierResult | null>;
}
// Trusted injected clients only. The marker declares test credentials; it does
// not qualify an account. Creation has exactly one guarded write; lookup is read-only.
export interface CanadaPostCreationClient {
  readonly testApplication: true;
  readonly configurationHash: string;
  create(
    intent: CarrierIntent,
    groupId: string,
    beforeWrite: () => void,
  ): Promise<CanadaPostShipmentObservation>;
  lookup(
    intent: CarrierIntent,
    groupId: string,
  ): Promise<CanadaPostShipmentObservation | null>;
}
export type {
  CanadaPostGroupView,
  CanadaPostManifestIdentity,
} from "../shared/carrier-booking.ts";
// Application code must honor one guarded transmission and read-only recovery.
// Identity is computed synchronously without provider I/O by the captured client.
export interface CanadaPostManifestClient {
  readonly testApplication: true;
  readonly configurationHash: string;
  manifestIdentity(input: CanadaPostManifestReview): CanadaPostManifestIdentity;
  transmitManifest(
    input: CanadaPostManifestReview,
    beforeWrite: () => void,
  ): Promise<CanadaPostManifestObservation>;
  recoverManifest(
    input: CanadaPostManifestReview,
  ): Promise<CanadaPostManifestObservation | null>;
}
type ManifestClaim = {
  kind: "manifest-claim";
  groupReviewHash: string;
  memberHash: string;
  identity: CanadaPostManifestIdentity;
};
type ManifestConfirmation = Omit<ManifestClaim, "kind"> & {
  kind: "manifest-confirmed";
  result: Omit<CanadaPostManifestObservation, "document">;
  documentHash: string;
};
type Booking = {
  sequence: number;
  id: string;
  org_id: string;
  shipment_id: string;
  state: CarrierBookingView["state"];
  review_hash: string;
  intent: string;
  token: string | null;
  started_at: number | null;
  reference: string | null;
  tracking: string | null;
  label_bytes: Uint8Array | null;
  label_type: string | null;
  label_hash: string | null;
  error: string | null;
  created_at: string;
};

type CanadaPostGroup = {
  id: string;
  org_id: string;
  warehouse_id: string;
  configuration_hash: string;
  provider_group_id: string;
  review_hash: string;
  state: string;
  token: string | null;
  started_at: number | null;
  observation: string | null;
  manifest_bytes: Uint8Array | null;
  manifest_hash: string | null;
  created_at: string;
};
type CanadaPostMember = {
  group_id: string;
  booking_id: string;
  org_id: string;
  review_hash: string;
  active: number;
  state: string;
  token: string | null;
  started_at: number | null;
  provider_shipment_id: string | null;
  tracking: string | null;
  label_bytes: Uint8Array | null;
  label_hash: string | null;
};
export type CanadaPostGroupPrepare = {
  configurationHash: string;
  entries: readonly { bookingId: string; reviewHash: string }[];
};

export class CarrierBookings {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private fulfillment: Fulfillment,
    private warranty: Warranty,
  ) {
    this.store = database.owned("integration");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS integration_carrier_bookings(
        sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN('pending','running','unknown','booked','canceled')),
        review_hash TEXT NOT NULL,intent TEXT NOT NULL,token TEXT,started_at INTEGER,
        reference TEXT,tracking TEXT,label_bytes BLOB,label_type TEXT,label_hash TEXT,error TEXT,created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS integration_carrier_active ON integration_carrier_bookings(org_id,shipment_id) WHERE state!='canceled';
      CREATE INDEX IF NOT EXISTS integration_carrier_history ON integration_carrier_bookings(org_id,shipment_id,sequence);
    `);
    this.store.migrate(CANADA_POST_INITIALIZE_DDL);
    fulfillment.configureCarrierGuard((actor, shipment, action, binding) => {
      const booking = this.latest(actor.orgId, shipment.id);
      if (!booking || booking.state === "canceled") return;
      check(
        booking.state === "booked",
        "CARRIER_BOOKING_ACTIVE",
        "Resolve or cancel the carrier booking before manual handover or voiding packing.",
      );
      check(
        action === "commit",
        "CARRIER_BOOKING_ACTIVE",
        "Booked packing cannot be voided until carrier voiding is qualified.",
      );
      const intent = this.intent(booking);
      if (intent.provider === "canada-post")
        this.assertCanadaPostHandover(actor, booking);
      check(
        canonical(shipment) === canonical(intent.nativeSnapshot),
        "CARRIER_MISMATCH",
        "Packed shipment changed after carrier review.",
      );
      check(
        binding?.carrier === intent.provider &&
          binding?.tracking === booking.tracking,
        "CARRIER_MISMATCH",
        "Handover must use the booked carrier identifier and exact tracking reference.",
      );
    });
    warranty.configureCarrierGuard((actor, replacementId, action, binding) => {
      const booking = this.latest(
        actor.orgId,
        this.replacementKey(replacementId),
      );
      if (!booking || booking.state === "canceled") return;
      check(
        booking.state === "booked" && action === "dispatch",
        "CARRIER_BOOKING_ACTIVE",
        "Resolve or cancel an unsent booking before cancellation or collection; a booked replacement requires carrier dispatch.",
      );
      const intent = this.intent(booking);
      if (intent.provider === "canada-post")
        this.assertCanadaPostHandover(actor, booking);
      const snapshot = this.warranty.carrierSnapshot(actor, replacementId);
      check(
        intent.replacementId === replacementId &&
          canonical(snapshot) === canonical(intent.nativeSnapshot) &&
          snapshot.ready &&
          binding?.carrier === intent.provider &&
          binding?.tracking === booking.tracking &&
          binding?.recipient === intent.destination.name &&
          binding?.address === intent.reviewedDestination,
        "CARRIER_MISMATCH",
        "Dispatch requires the unchanged replacement, reviewed recipient/address and exact booked carrier/tracking reference.",
      );
    });
  }
  health(actor: Actor): QueueObservation[] {
    actor = this.identity.currentActor(actor);
    permit(actor, ["support"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before continuing.",
      403,
    );
    const queues = [
      {
        id: "carrier-bookings",
        label: "Carrier bookings",
        table: "integration_carrier_bookings",
      },
      {
        id: "canada-post-groups",
        label: "Canada Post groups",
        table: "integration_canada_post_groups",
      },
    ].map(({ id, label, table }) => ({
      id,
      label,
      states: this.store.all<QueueObservation["states"][number]>(
        `SELECT state,COUNT(*) AS count,MIN(created_at) AS oldestCreatedAt FROM ${table} WHERE org_id=? GROUP BY state ORDER BY state`,
        actor.orgId,
      ),
    }));
    return [
      ...queues,
      {
        id: "canada-post-members",
        label: "Active Canada Post shipments",
        states: this.store.all<QueueObservation["states"][number]>(
          `SELECT m.state,COUNT(*) AS count,MIN(g.created_at) AS oldestCreatedAt
         FROM integration_canada_post_members m JOIN integration_canada_post_groups g ON g.id=m.group_id AND g.org_id=m.org_id
         WHERE m.org_id=? AND m.active=1 GROUP BY m.state ORDER BY m.state`,
          actor.orgId,
        ),
      },
    ];
  }
  #offlineCanadaPost = false;
  /** Static host wiring identity check. Private field defeats prototype copies. */
  assertOfflineCanadaPostOwner(
    database: unknown,
    identity: unknown,
    platform: unknown,
    fulfillment: unknown,
  ) {
    check(
      !this.#offlineCanadaPost &&
        this.database === database &&
        this.identity === identity &&
        this.platform === platform &&
        this.fulfillment === fulfillment,
      "OFFLINE_CANADA_POST",
      "The fixed native carrier owner does not match.",
    );
  }
  /** Only the fixed single-read private capture can enter this native writer. */
  applyOfflineCanadaPostMemberInTransaction(
    token: unknown,
    envelope: OfflineTaskEnvelopeV1,
    input: any,
    joined: CanadaPostNativeJoin,
  ) {
    check(
      isInternalCanadaPostOwnerCapture(token, this, envelope, input, joined),
      "OFFLINE_CANADA_POST",
      "A current private native capture is required.",
    );
    this.database.requireTransaction();
    check(
      !this.#offlineCanadaPost,
      "OFFLINE_CANADA_POST",
      "Native import reentry refused.",
    );
    this.#offlineCanadaPost = true;
    let bytes: Buffer | undefined,
      qualified: CanadaPostShipmentObservation | undefined;
    let retainedMembers: CanadaPostMember[] = [];
    try {
      const actor = this.principal(joined.actor as Actor);
      permit(actor, ["finance"]);
      check(
        !actor.accountId && this.platform.rawRecoveryHoldInTransaction(),
        "OFFLINE_CANADA_POST",
        "A current scoped finance executor and raw hold are required.",
      );
      const comparison = joined.comparison;
      check(
        envelope.task.orgId === actor.orgId &&
          comparison.orgId === actor.orgId &&
          envelope.task.subjectId === comparison.bookingId &&
          envelope.task.expectedRevision === 0 &&
          envelope.task.priorClaim === null,
        "OFFLINE_CANADA_POST",
        "Original task identity changed.",
      );
      this.offlineCanadaPostScope();
      const { group, members } = this.canadaPostGroup(
        actor,
        comparison.groupId,
      );
      retainedMembers = members;
      const member = members.find((m) => m.booking_id === comparison.bookingId);
      check(
        member &&
          group.state === "unknown" &&
          members.every(
            (m) => m.state === (m === member ? "unknown" : "created"),
          ) &&
          members.every((m) => m.token === null && m.started_at === null),
        "OFFLINE_CANADA_POST",
        "The original member state changed.",
      );
      this.assertOfflineCanadaPostNative(actor, group, members);
      const captured = input.members.find(
        (m: any) => m.bookingId === member.booking_id,
      );
      bytes = Buffer.from(captured.label.data, "base64");
      const { details: _details, label: _label, ...observation } = captured;
      qualified = validateCanadaPostCreation(
        { ...observation, label: { mediaType: "application/pdf", bytes } },
        group,
        member,
      );
      check(
        !this.store.get(
          "SELECT 1 FROM integration_canada_post_members m JOIN integration_canada_post_groups g ON g.id=m.group_id WHERE m.org_id=? AND g.configuration_hash=? AND m.booking_id<>? AND (m.provider_shipment_id=? OR m.tracking=?) LIMIT 1",
          actor.orgId,
          group.configuration_hash,
          member.booking_id,
          qualified.shipmentId,
          qualified.tracking,
        ),
        "OFFLINE_CANADA_POST",
        "Provider references are already retained.",
      );
      // Ordinary/promoted booking references were checked conservatively by the
      // fresh complete proposed-reference owner read in this very writer.
      check(
        isInternalCanadaPostOwnerCapture(token, this, envelope, input, joined),
        "OFFLINE_CANADA_POST",
        "Capture lifetime ended.",
      );
      this.platform.audit(
        actor,
        "carrier.canada-post.member.claimed",
        group.id,
        {
          bookingId: member.booking_id,
          reviewHash: member.review_hash,
          send: false,
        },
      );
      const changed = this.store.run(
        "UPDATE integration_canada_post_members SET state='created',token=NULL,started_at=NULL,provider_shipment_id=?,tracking=?,label_bytes=?,label_hash=? WHERE group_id=? AND booking_id=? AND org_id=? AND state='unknown' AND active=1 AND token IS NULL AND started_at IS NULL AND provider_shipment_id IS NULL AND tracking IS NULL AND label_bytes IS NULL AND label_hash IS NULL",
        qualified.shipmentId,
        qualified.tracking,
        qualified.label.bytes,
        digest(qualified.label.bytes),
        group.id,
        member.booking_id,
        actor.orgId,
      );
      check(
        changed.changes === 1,
        "OFFLINE_CANADA_POST",
        "Member compare-and-swap failed.",
      );
      this.platform.event(
        actor,
        "carrier.canada-post.member.created",
        group.id,
        {
          bookingId: member.booking_id,
          reviewHash: member.review_hash,
          shipmentId: qualified.shipmentId,
        },
      );
      const states = this.store.all<{ state: string }>(
        "SELECT state FROM integration_canada_post_members WHERE group_id=?",
        group.id,
      );
      const state = states.every((m) => m.state === "created")
        ? "closed"
        : states.some((m) => m.state === "unknown")
          ? "unknown"
          : "creating";
      check(
        state === "closed" &&
          this.store.run(
            "UPDATE integration_canada_post_groups SET state=? WHERE id=? AND org_id=? AND state='unknown' AND token IS NULL AND started_at IS NULL AND observation IS NULL AND manifest_bytes IS NULL AND manifest_hash IS NULL",
            state,
            group.id,
            actor.orgId,
          ).changes === 1,
        "OFFLINE_CANADA_POST",
        "Group compare-and-swap failed.",
      );
      this.platform.audit(
        actor,
        "carrier.canada-post.member.created",
        group.id,
        {
          bookingId: member.booking_id,
          reviewHash: member.review_hash,
          reconciled: true,
          groupState: state,
          labelHash: digest(qualified.label.bytes),
        },
      );
      check(
        isInternalCanadaPostOwnerCapture(token, this, envelope, input, joined),
        "OFFLINE_CANADA_POST",
        "Capture lifetime ended.",
      );
      // Exact expected row delta, including every retained sibling and booking.
      const after = this.canadaPostGroup(actor, group.id);
      try {
        check(
          canonical(after.group) ===
            canonical({ ...input.native.groups[0], state }),
          "OFFLINE_CANADA_POST",
          "Unexpected group mutation.",
        );
        const descriptor = (v: Uint8Array | null) =>
          v === null
            ? null
            : {
                encoding: "base64",
                bytes: v.byteLength,
                sha256: digest(v),
                data: Buffer.from(
                  v.buffer,
                  v.byteOffset,
                  v.byteLength,
                ).toString("base64"),
              };
        const expected = input.native.members.map((m: any) =>
          m.booking_id === member.booking_id
            ? {
                ...m,
                state: "created",
                provider_shipment_id: qualified!.shipmentId,
                tracking: qualified!.tracking,
                label_bytes: captured.label,
                label_hash: digest(qualified!.label.bytes),
              }
            : m,
        );
        check(
          canonical(
            after.members.map((m) => ({
              ...m,
              label_bytes: descriptor(m.label_bytes),
            })),
          ) === canonical(expected),
          "OFFLINE_CANADA_POST",
          "Unexpected member mutation.",
        );
        const bookings = after.members.map((m) =>
          this.booking(actor, m.booking_id),
        );
        check(
          canonical(bookings.sort((a, b) => a.sequence - b.sequence)) ===
            canonical(input.native.bookingHistory),
          "OFFLINE_CANADA_POST",
          "Original pending bookings changed.",
        );
      } finally {
        for (const m of after.members) m.label_bytes?.fill(0);
      }
      const result = this.offlineCanadaPostResult(
        actor,
        group.id,
        member.booking_id,
      );
      check(
        canonical(result.custody) ===
          canonical(
            input.native.members.map((m: any) => ({
              bookingId: m.booking_id,
              custodyHash: input.custody.find(
                (c: any) =>
                  c.shipment.id ===
                  input.native.preparations.find(
                    (p: any) => p.bookingId === m.booking_id,
                  ).intent.shipmentId,
              ).custodyHash,
            })),
          ),
        "OFFLINE_CANADA_POST",
        "Original custody changed.",
      );
      return result;
    } finally {
      bytes?.fill(0);
      qualified?.label.bytes.fill(0);
      for (const member of retainedMembers) member.label_bytes?.fill(0);
      this.#offlineCanadaPost = false;
    }
  }
  /** Bounded complete owning-table fingerprint, no foreign SQL or returned rows. */
  private offlineCanadaPostScope() {
    let rows = 0,
      total = 0;
    const values: unknown[] = [];
    for (const [table, columns, order] of [
      [
        "integration_carrier_bookings",
        "sequence id org_id shipment_id state review_hash intent token started_at reference tracking label_bytes label_type label_hash error created_at",
        "sequence",
      ],
      [
        "integration_canada_post_groups",
        "id org_id warehouse_id configuration_hash provider_group_id review_hash state token started_at observation manifest_bytes manifest_hash created_at",
        "id",
      ],
      [
        "integration_canada_post_members",
        "group_id booking_id org_id review_hash active state token started_at provider_shipment_id tracking label_bytes label_hash",
        "group_id,booking_id",
      ],
    ]) {
      const n = Number(
        this.store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT 513)`,
        )!.n,
      );
      check(
        n <= 512 && (rows += n) <= 1024,
        "OFFLINE_CANADA_POST",
        "Retained carrier scope exceeds supported bounds.",
      );
      const cols = columns!.split(" "),
        sizes = cols.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`);
      const bad = cols
        .map((c) =>
          c.endsWith("_bytes")
            ? `(typeof(${c}) NOT IN ('null','blob') OR length(${c})>1048576)`
            : `(typeof(${c}) NOT IN ('null','integer','text') OR (typeof(${c})='integer' AND (${c}>9007199254740991 OR ${c} < -9007199254740991)) OR length(CAST(${c} AS BLOB))>65536 OR instr(CAST(${c} AS BLOB),x'00')>0)`,
        )
        .join(" OR ");
      const meta = this.store.get(
        `SELECT COALESCE(SUM(${sizes.join("+")}),0) AS bytes, COALESCE(SUM(CASE WHEN ${bad} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      check(
        meta.bad === 0 &&
          Number.isSafeInteger(meta.bytes) &&
          (total += Number(meta.bytes)) <= 16 * 1024 * 1024,
        "OFFLINE_CANADA_POST",
        "Retained carrier bytes exceed supported bounds.",
      );
      const textColumns = cols.filter((c) => !c.endsWith("_bytes"));
      const records = this.store.all(
        `SELECT *,${textColumns.map((c) => `hex(CAST(${c} AS BLOB)) AS __raw_${c}`).join(",")} FROM ${table} ORDER BY ${order}`,
      );
      try {
        for (const row of records)
          for (const c of textColumns) {
            const v = row[c],
              raw = row[`__raw_${c}`];
            check(
              (v === null
                ? ""
                : Buffer.from(String(v)).toString("hex").toUpperCase()) === raw,
              "OFFLINE_CANADA_POST",
              "Retained carrier encoding changed.",
            );
            delete row[`__raw_${c}`];
          }
        values.push(
          records.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [
                k,
                v instanceof Uint8Array
                  ? { bytes: v.byteLength, hash: digest(v) }
                  : v,
              ]),
            ),
          ),
        );
      } finally {
        for (const row of records)
          for (const v of Object.values(row))
            if (v instanceof Uint8Array) v.fill(0);
      }
    }
    return digest(canonical(values));
  }
  private assertOfflineCanadaPostNative(
    actor: Actor,
    group: CanadaPostGroup,
    members: CanadaPostMember[],
  ) {
    check(
      this.platform.rawRecoveryHoldInTransaction() &&
        group.token === null &&
        group.started_at === null &&
        group.observation === null &&
        group.manifest_bytes === null &&
        group.manifest_hash === null,
      "OFFLINE_CANADA_POST",
      "Raw isolation and untransmitted group required.",
    );
    for (const member of members) {
      const booking = this.booking(actor, member.booking_id),
        intent = this.intent(booking);
      check(
        booking.state === "pending" &&
          booking.token === null &&
          booking.started_at === null &&
          booking.reference === null &&
          booking.tracking === null &&
          booking.label_bytes === null &&
          booking.label_type === null &&
          booking.label_hash === null &&
          booking.error === null &&
          !booking.shipment_id.startsWith("replacement:"),
        "OFFLINE_CANADA_POST",
        "Original ordinary pending booking required.",
      );
      const custody = this.fulfillment.reviewPackedCarrierCustodyInTransaction(
        actor,
        booking.shipment_id,
      );
      check(
        canonical(custody.shipment) === canonical(intent.nativeSnapshot) &&
          custody.shipment.state === "packed" &&
          custody.shipment.mode === "carrier" &&
          !this.identity.customer(actor, custody.shipment.account_id).held,
        "OFFLINE_CANADA_POST",
        "Original packed custody and finance status required.",
      );
      this.identity.providerAllowed(
        actor,
        custody.shipment.account_id,
        "canada-post",
      );
    }
  }
  private offlineCanadaPostResult(
    actor: Actor,
    groupId: string,
    bookingId: string,
  ) {
    actor = this.principal(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId && this.platform.rawRecoveryHoldInTransaction(),
      "OFFLINE_CANADA_POST",
      "Current recovery authority required.",
    );
    const scopeHash = this.offlineCanadaPostScope();
    const { group, members } = this.canadaPostGroup(actor, groupId);
    try {
      check(
        group.state === "closed" &&
          members.some((m) => m.booking_id === bookingId) &&
          members.every(
            (m) =>
              m.state === "created" &&
              m.token === null &&
              m.started_at === null &&
              m.label_bytes &&
              m.label_hash === digest(m.label_bytes),
          ),
        "OFFLINE_CANADA_POST",
        "Current native member result differs.",
      );
      this.assertOfflineCanadaPostNative(actor, group, members);
      const custody = members.map((m) => {
        const intent = this.intent(this.booking(actor, m.booking_id));
        return {
          bookingId: m.booking_id,
          custodyHash: this.fulfillment.reviewPackedCarrierCustodyInTransaction(
            actor,
            intent.shipmentId,
          ).custodyHash,
        };
      });
      const provenance = new PlatformOfflineCarrierReviewReader(
        this.database,
        this.identity,
      );
      const platform = members.map((m) => ({
        bookingId: m.booking_id,
        factsHash: provenance.getInTransaction(actor, groupId, m.booking_id)
          .factsHash,
      }));
      return immutable({
        version: 1 as const,
        purpose: "canada-post-native-import-result-v1" as const,
        orgId: actor.orgId,
        groupId,
        bookingId,
        warehouseId: group.warehouse_id,
        scopeHash,
        custody,
        platform,
      });
    } finally {
      for (const m of members) m.label_bytes?.fill(0);
    }
  }
  /** Fresh consistency result only; original receipt/hash remains caller-held. */
  recoverOfflineCanadaPostMemberInTransaction(
    actorInput: Actor,
    groupId: string,
    bookingId: string,
  ) {
    this.database.requireTransaction();
    check(
      typeof groupId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(groupId) &&
        typeof bookingId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(bookingId),
      "OFFLINE_CANADA_POST",
      "Exact native identity required.",
    );
    return this.offlineCanadaPostResult(actorInput, groupId, bookingId);
  }

  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["warehouse"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before using carrier bookings.",
      403,
    );
    return actor;
  }
  private replacementKey(replacementId: string) {
    replacementId = text(replacementId, "Replacement", 128);
    check(
      !replacementId.startsWith("replacement:"),
      "VALIDATION",
      "Supply the native replacement ID.",
      400,
    );
    return `replacement:${replacementId}`;
  }
  private inputTarget(input: CarrierPrepare) {
    const shipmentId = text(input.shipmentId, "Shipment", 128);
    check(
      !shipmentId.startsWith("replacement:"),
      "VALIDATION",
      "Supply a native shipment or replacement ID.",
      400,
    );
    if (Object.hasOwn(input, "replacementId")) {
      check(
        input.replacementId === shipmentId,
        "CARRIER_MISMATCH",
        "Replacement and carrier shipment references must agree.",
        400,
      );
      return this.replacementKey(input.replacementId!);
    }
    return shipmentId;
  }
  private shipment(
    actor: Actor,
    shipmentId: string,
  ): Shipment | ReplacementCarrierSnapshot {
    if (shipmentId.startsWith("replacement:"))
      return this.warranty.carrierSnapshot(
        actor,
        shipmentId.slice("replacement:".length),
      );
    const shipment = this.fulfillment.shipment(
      actor,
      text(shipmentId, "Shipment", 128),
    );
    site(actor, shipment.warehouse_id);
    return shipment;
  }
  private booking(actor: Actor, bookingId: string) {
    const booking = this.store.get<Booking>(
      "SELECT * FROM integration_carrier_bookings WHERE org_id=? AND id=?",
      actor.orgId,
      text(bookingId, "Booking", 128),
    );
    check(booking, "NOT_FOUND", "Carrier booking not found.", 404);
    this.intent(booking);
    this.shipment(actor, booking.shipment_id);
    return booking;
  }
  private latest(orgId: string, shipmentId: string) {
    return this.store.get<Booking>(
      "SELECT * FROM integration_carrier_bookings WHERE org_id=? AND shipment_id=? ORDER BY sequence DESC LIMIT 1",
      orgId,
      shipmentId,
    );
  }
  private intent(booking: Booking): CarrierIntent {
    const intent = JSON.parse(booking.intent) as CarrierIntent;
    const { bookingId, reviewHash, ...review } = intent;
    check(
      bookingId === booking.id &&
        reviewHash === booking.review_hash &&
        digest(canonical(review)) === reviewHash &&
        intent.nativeSnapshot.org_id === booking.org_id &&
        this.inputTarget(intent) === booking.shipment_id &&
        intent.nativeSnapshot.id === intent.shipmentId &&
        (intent.replacementId !== undefined
          ? "kind" in intent.nativeSnapshot &&
            intent.nativeSnapshot.kind === "replacement"
          : !("kind" in intent.nativeSnapshot)),
      "CARRIER_MISMATCH",
      "Carrier intent integrity check failed.",
    );
    return intent;
  }
  private targetReference(booking: Booking) {
    const intent = this.intent(booking);
    return {
      shipmentId: intent.shipmentId,
      ...(intent.replacementId ? { replacementId: intent.replacementId } : {}),
    };
  }
  private view(booking: Booking): CarrierBookingView {
    const intent = this.intent(booking);
    return {
      id: booking.id,
      shipmentId: intent.shipmentId,
      ...(intent.replacementId
        ? {
            replacementId: intent.replacementId,
            reviewedDestination: intent.reviewedDestination,
          }
        : {}),
      provider: intent.provider,
      state: booking.state,
      reviewHash: booking.review_hash,
      service: intent.service,
      ...(intent.configuration ? { configuration: intent.configuration } : {}),
      ...(intent.dhl ? { dhl: intent.dhl } : {}),
      origin: intent.origin,
      destination: intent.destination,
      parcel: intent.parcel,
      reference: booking.reference,
      tracking: booking.tracking,
      hasLabel: booking.state === "booked" && booking.label_bytes !== null,
      error: booking.error,
      createdAt: booking.created_at,
    };
  }
  review(actor: Actor, shipmentId: string): CarrierReview {
    actor = this.principal(actor);
    check(
      !shipmentId.startsWith("replacement:"),
      "NOT_FOUND",
      "Shipment not found.",
      404,
    );
    const shipment = this.shipment(actor, shipmentId);
    const booking = this.latest(actor.orgId, shipmentId);
    return {
      shipmentId,
      warehouseId: shipment.warehouse_id,
      packedGoods: this.fulfillment.packedGoods(actor, shipmentId),
      booking: booking ? this.view(booking) : null,
    };
  }
  reviewReplacement(actor: Actor, replacementId: string): CarrierReview {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const snapshot = this.warranty.carrierSnapshot(actor, replacementId);
      const booking = this.latest(
        actor.orgId,
        this.replacementKey(replacementId),
      );
      return {
        shipmentId: replacementId,
        replacementId,
        warehouseId: snapshot.warehouse_id,
        packedGoods: [
          {
            allocationId: replacementId,
            quantity: 1,
            description: snapshot.custody.description,
            serial: snapshot.custody.unit.serial,
          },
        ],
        booking: booking ? this.view(booking) : null,
      };
    });
  }
  providerForBooking(actor: Actor, bookingId: string): CarrierName {
    actor = this.principal(actor);
    return this.intent(this.booking(actor, bookingId)).provider;
  }
  warehouseForPreparation(actor: Actor, input: CarrierPrepare): string {
    actor = this.principal(actor);
    return this.shipment(actor, this.inputTarget(input)).warehouse_id;
  }
  warehouseForBooking(actor: Actor, bookingId: string): string {
    actor = this.principal(actor);
    return this.intent(this.booking(actor, bookingId)).nativeSnapshot
      .warehouse_id;
  }
  // A group owns a fixed native booking allowlist from preparation onward.
  // Membership cannot be appended, reused or released after provider I/O.
  // This is local ownership only; an external account writer is not fenced.
  prepareCanadaPostGroup(
    actor: Actor,
    key: string,
    input: CanadaPostGroupPrepare,
  ): { id: string; reviewHash: string } {
    return this.platform.command(
      actor,
      "carrier.canada-post.group.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        check(
          input &&
            typeof input.configurationHash === "string" &&
            /^[a-f0-9]{64}$/.test(input.configurationHash) &&
            Array.isArray(input.entries) &&
            input.entries.length >= 1 &&
            input.entries.length <= 100,
          "VALIDATION",
          "Supply an exact configuration hash and 1–100 reviewed bookings.",
          400,
        );
        for (const entry of input.entries) {
          check(
            entry && typeof entry === "object",
            "VALIDATION",
            "Supply a reviewed booking.",
            400,
          );
          this.booking(actor, entry.bookingId);
        }
      },
      () => {
        const entries = input.entries
          .map((entry) => {
            const booking = this.booking(actor, entry.bookingId);
            const intent = this.intent(booking);
            check(
              booking.review_hash === entry.reviewHash &&
                intent.provider === "canada-post" &&
                booking.state === "pending" &&
                booking.token === null &&
                booking.started_at === null &&
                booking.reference === null &&
                booking.tracking === null &&
                booking.label_bytes === null &&
                booking.label_type === null &&
                booking.label_hash === null &&
                booking.error === null,
              "CARRIER_MISMATCH",
              "Each group member must be the exact unclaimed Canada Post booking.",
            );
            this.assertNative(actor, booking);
            this.assertNoCanadaPostGroup(booking.id);
            return {
              bookingId: booking.id,
              reviewHash: booking.review_hash,
              intent,
            };
          })
          .sort((a, b) =>
            a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0,
          );
        check(
          new Set(entries.map((entry) => entry.bookingId)).size ===
            entries.length,
          "VALIDATION",
          "Group members must be unique.",
          400,
        );
        const first = entries[0]!.intent;
        check(
          entries.every(
            (entry) =>
              entry.intent.nativeSnapshot.warehouse_id ===
                first.nativeSnapshot.warehouse_id &&
              canonical(entry.intent.origin) === canonical(first.origin) &&
              entry.intent.origin.country === "CA" &&
              entry.intent.destination.country === "CA",
          ),
          "CARRIER_MISMATCH",
          "Canada Post group members require one exact Canadian origin and warehouse.",
        );
        const groupId = id(),
          providerGroupId = groupId.replaceAll("-", "");
        const reviewHash = digest(
          canonical({
            configurationHash: input.configurationHash,
            providerGroupId,
            warehouseId: first.nativeSnapshot.warehouse_id,
            entries: entries.map(({ bookingId, reviewHash }) => ({
              bookingId,
              reviewHash,
            })),
          }),
        );
        this.store.run(
          "INSERT INTO integration_canada_post_groups(id,org_id,warehouse_id,configuration_hash,provider_group_id,review_hash,state,created_at) VALUES(?,?,?,?,?,?,'prepared',?)",
          groupId,
          actor.orgId,
          first.nativeSnapshot.warehouse_id,
          input.configurationHash,
          providerGroupId,
          reviewHash,
          now(),
        );
        for (const entry of entries)
          this.store.run(
            "INSERT INTO integration_canada_post_members(group_id,booking_id,org_id,review_hash,active,state) VALUES(?,?,?,?,1,'pending')",
            groupId,
            entry.bookingId,
            actor.orgId,
            entry.reviewHash,
          );
        this.platform.event(
          actor,
          "carrier.canada-post.group.prepared",
          groupId,
          {
            reviewHash,
            warehouseId: first.nativeSnapshot.warehouse_id,
            count: entries.length,
          },
        );
        return { id: groupId, reviewHash };
      },
    );
  }
  private canadaPostGroup(actor: Actor, groupId: string) {
    const group = this.store.get<CanadaPostGroup>(
      "SELECT * FROM integration_canada_post_groups WHERE org_id=? AND id=?",
      actor.orgId,
      text(groupId, "Canada Post group", 128),
    );
    check(group, "NOT_FOUND", "Canada Post group not found.", 404);
    site(actor, group.warehouse_id);
    const members = this.store.all<CanadaPostMember>(
      "SELECT * FROM integration_canada_post_members WHERE group_id=? ORDER BY booking_id",
      group.id,
    );
    check(
      members.length >= 1 &&
        members.length <= 100 &&
        members.every(
          (member) =>
            member.org_id === actor.orgId &&
            member.active === Number(group.state !== "canceled"),
        ),
      "CARRIER_MISMATCH",
      "Canada Post group membership integrity failed.",
    );
    for (const member of members) {
      const booking = this.booking(actor, member.booking_id),
        intent = this.intent(booking);
      check(
        intent.provider === "canada-post" &&
          booking.review_hash === member.review_hash &&
          intent.nativeSnapshot.warehouse_id === group.warehouse_id,
        "CARRIER_MISMATCH",
        "Canada Post group booking integrity failed.",
      );
    }
    check(
      group.review_hash ===
        digest(
          canonical({
            configurationHash: group.configuration_hash,
            providerGroupId: group.provider_group_id,
            warehouseId: group.warehouse_id,
            entries: members.map((member) => ({
              bookingId: member.booking_id,
              reviewHash: member.review_hash,
            })),
          }),
        ),
      "CARRIER_MISMATCH",
      "Canada Post group review integrity failed.",
    );
    return { group, members };
  }
  reviewCanadaPostGroup(actor: Actor, groupId: string): CanadaPostGroupView {
    actor = this.principal(actor);
    const { group, members } = this.canadaPostGroup(actor, groupId);
    return {
      id: group.id,
      warehouseId: group.warehouse_id,
      configurationHash: group.configuration_hash,
      providerGroupId: group.provider_group_id,
      reviewHash: group.review_hash,
      state: group.state,
      entries: members.map((member) => ({
        bookingId: member.booking_id,
        reviewHash: member.review_hash,
        state: member.state,
      })),
      createdAt: group.created_at,
    };
  }
  /** Read-only native history, not provider non-posting or restore-release authority. */
  reviewCanceledCanadaPostMember(
    actor: Actor,
    groupId: string,
    bookingId: string,
  ) {
    return this.database.transaction(() =>
      this.canceledCanadaPostMemberDispositionInTransaction(
        actor,
        groupId,
        bookingId,
      ),
    );
  }
  // A maintenance consumer must retain its native writer transaction and supply
  // current scoped authority. No coordinator or hold exception is installed here.
  canceledCanadaPostMemberDispositionInTransaction(
    actor: Actor,
    groupId: string,
    bookingId: string,
  ) {
    this.database.requireTransaction();
    actor = this.principal(actor);
    text(groupId, "Canada Post group", 128);
    text(bookingId, "Canada Post member", 128);
    const assert = (condition: unknown) =>
      check(
        condition,
        "CARRIER_DISPOSITION_UNRESOLVED",
        "Complete retained unused Canada Post cancellation evidence is required.",
      );
    // Bound malformed membership before invoking the ordinary integrity reader.
    assert(
      this.store.all(
        "SELECT booking_id FROM integration_canada_post_members WHERE group_id=? LIMIT 101",
        groupId,
      ).length <= 100,
    );
    const { group, members } = this.canadaPostGroup(actor, groupId);
    assert(
      group.state === "canceled" &&
        group.token === null &&
        group.started_at === null &&
        group.observation === null &&
        group.manifest_bytes === null &&
        group.manifest_hash === null &&
        group.provider_group_id === group.id.replaceAll("-", "") &&
        /^[a-f0-9]{64}$/.test(group.configuration_hash) &&
        members.some((m) => m.booking_id === bookingId),
    );

    // Narrow maintenance reads of platform-owned immutable command/audit/event
    // receipts. No platform writes, arbitrary queries or business repair proxy.
    const history = this.database.owned("platform");
    const parse = (value: unknown): unknown => {
      assert(typeof value === "string" && value.length <= 262144);
      try {
        return JSON.parse(String(value));
      } catch {
        assert(false);
      }
    };
    const equal = (actual: unknown, expected: unknown) =>
      assert(canonical(actual) === canonical(expected));
    const command = (
      name: string,
      result: { id: string; reviewHash?: string },
      payload?: unknown,
    ) => {
      const rows = history.all(
        "SELECT * FROM platform_commands WHERE org_id=? AND name=? AND CASE WHEN json_valid(result) THEN json_extract(result,'$.id') END=? LIMIT 2",
        actor.orgId,
        name,
        result.id,
      );
      assert(rows.length === 1);
      const row = rows[0]!;
      assert(
        typeof row.actor_id === "string" &&
          row.actor_id.length <= 128 &&
          typeof row.key === "string" &&
          row.key.length <= 128,
      );
      text(String(row.actor_id), "Historical carrier actor", 128);
      text(String(row.key), "Historical carrier command key", 128);
      equal(parse(row.result), result);
      assert(typeof row.hash === "string" && /^[a-f0-9]{64}$/.test(row.hash));
      if (payload !== undefined)
        assert(row.hash === digest(canonical(payload)));
      const audits = history.all(
        "SELECT a.*,o.sequence FROM platform_audit a JOIN platform_audit_order o ON o.audit_id=a.id AND o.org_id=a.org_id WHERE a.org_id=? AND a.actor_id=? AND a.action=? AND a.reference=? LIMIT 2",
        actor.orgId,
        String(row.actor_id),
        name,
        String(row.key),
      );
      assert(audits.length === 1);
      const audit = audits[0]!;
      equal(parse(audit.detail), { requestHash: row.hash });
      assert(
        Number.isSafeInteger(audit.sequence) && Number(audit.sequence) > 0,
      );
      return {
        actorId: String(row.actor_id),
        key: String(row.key),
        requestHash: String(row.hash),
        receiptHash: digest(canonical(row)),
        auditHash: digest(canonical(audit)),
        sequence: Number(audit.sequence),
      };
    };
    const entityAudit = (reference: string, action: string) => {
      // Any extra dispatch, unknown or claim history makes this narrow subtype
      // unresolved, even if its mutable row was later made to look unused.
      const rows = history.all(
        "SELECT a.*,o.sequence FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id AND o.org_id=a.org_id WHERE a.org_id=? AND a.reference=? AND a.action LIKE 'carrier.%' AND a.action NOT IN('carrier.prepare','carrier.cancel','carrier.canada-post.group.prepare','carrier.canada-post.group.cancel') LIMIT 2",
        actor.orgId,
        reference,
      );
      assert(rows.length === 1 && rows[0]!.action === action);
      const row = rows[0]!;
      assert(Number.isSafeInteger(row.sequence) && Number(row.sequence) > 0);
      return row;
    };
    const events = (
      reference: string,
      expected: { type: string; payload: unknown }[],
    ) => {
      const rows = history.all(
        "SELECT * FROM platform_events WHERE org_id=? AND reference=? AND type LIKE 'carrier.%' ORDER BY type,id LIMIT 3",
        actor.orgId,
        reference,
      );
      assert(rows.length === expected.length);
      for (const item of expected) {
        const matches = rows.filter((r) => r.type === item.type);
        assert(matches.length === 1 && matches[0]!.version === 1);
        equal(parse(matches[0]!.payload), item.payload);
      }
      return digest(canonical(rows));
    };
    const prepared = command("carrier.canada-post.group.prepare", {
      id: group.id,
      reviewHash: group.review_hash,
    });
    const audit = entityAudit(group.id, "carrier.canada-post.group.canceled");
    const detail = parse(audit.detail) as {
      reviewHash?: unknown;
      reason?: unknown;
    };
    assert(detail && typeof detail.reason === "string");
    const reason = clean(detail.reason, "Cancellation reason", 1000);
    equal(detail, { reviewHash: group.review_hash, reason });
    const canceled = command(
      "carrier.canada-post.group.cancel",
      { id: group.id },
      { groupId: group.id, reviewHash: group.review_hash, reason },
    );
    assert(
      audit.actor_id === canceled.actorId &&
        prepared.sequence < Number(audit.sequence) &&
        Number(audit.sequence) < canceled.sequence,
    );
    const groupEventsHash = events(group.id, [
      {
        type: "carrier.canada-post.group.prepared",
        payload: {
          reviewHash: group.review_hash,
          warehouseId: group.warehouse_id,
          count: members.length,
        },
      },
      {
        type: "carrier.canada-post.group.canceled",
        payload: { reviewHash: group.review_hash },
      },
    ]);
    let firstOrigin: string | undefined;
    let firstConfiguration: string | undefined;
    const qualified = members.map((member) => {
      assert(
        member.active === 0 &&
          member.state === "pending" &&
          member.token === null &&
          member.started_at === null &&
          member.provider_shipment_id === null &&
          member.tracking === null &&
          member.label_bytes === null &&
          member.label_hash === null,
      );
      const booking = this.booking(actor, member.booking_id),
        intent = this.intent(booking);
      assert(
        ["pending", "canceled"].includes(booking.state) &&
          booking.token === null &&
          booking.started_at === null &&
          booking.reference === null &&
          booking.tracking === null &&
          booking.label_bytes === null &&
          booking.label_type === null &&
          booking.label_hash === null &&
          booking.error === null,
      );
      // Legacy opaque group hashes alone do not establish a carrier account.
      assert(
        intent.configuration &&
          intent.configurationHash === group.configuration_hash,
      );
      const configuration = captureCarrierConfiguration(
        intent.configuration!,
        "canada-post",
      );
      assertCarrierConfiguration(intent, configuration);
      const configurationBytes = canonical(configuration);
      firstConfiguration ??= configurationBytes;
      assert(configurationBytes === firstConfiguration);
      assert(
        configuration.hash === group.configuration_hash &&
          configuration.services.some((s) => s.service === intent.service),
      );
      const snapshot = this.shipment(actor, booking.shipment_id);
      assert(
        snapshot.org_id === actor.orgId &&
          snapshot.account_id === intent.nativeSnapshot.account_id &&
          snapshot.warehouse_id === group.warehouse_id,
      );
      text(snapshot.account_id, "Native customer identity", 128);
      // Physical handover may advance mutable status after cancellation; the
      // originally reviewed immutable shipment contents must still agree.
      if (!("kind" in snapshot) && !("kind" in intent.nativeSnapshot)) {
        const immutableShipment = (s: Shipment) => ({
          id: s.id,
          org_id: s.org_id,
          order_id: s.order_id,
          account_id: s.account_id,
          warehouse_id: s.warehouse_id,
          mode: s.mode,
          address: s.address,
          lines: s.lines,
          units: s.units,
          created_at: s.created_at,
        });
        equal(
          immutableShipment(snapshot),
          immutableShipment(intent.nativeSnapshot),
        );
      } else equal(snapshot, intent.nativeSnapshot);
      const previous = this.store.get<Booking>(
        "SELECT * FROM integration_carrier_bookings WHERE org_id=? AND shipment_id=? AND sequence<? ORDER BY sequence DESC LIMIT 1",
        actor.orgId,
        booking.shipment_id,
        booking.sequence,
      );
      assert((previous?.id ?? null) === intent.previousId);
      if (previous) {
        this.intent(previous);
        assert(previous.state === "canceled");
      }
      const normalizedOrigin = address(intent.origin),
        normalizedDestination = address(intent.destination);
      equal(normalizedOrigin, intent.origin);
      equal(normalizedDestination, intent.destination);
      equal(parcel(intent.parcel), intent.parcel);
      assert(
        normalizedOrigin.country === "CA" &&
          normalizedDestination.country === "CA",
      );
      const originHash = digest(canonical(normalizedOrigin));
      firstOrigin ??= originHash;
      assert(originHash === firstOrigin);
      const bookingPrepared = command("carrier.prepare", {
        id: booking.id,
        reviewHash: booking.review_hash,
      });
      assert(bookingPrepared.sequence < prepared.sequence);
      const target = this.targetReference(booking);
      const expectedEvents = [
        {
          type: "carrier.booking.prepared",
          payload: {
            ...target,
            reviewHash: booking.review_hash,
            provider: "canada-post",
          } as unknown,
        },
      ];
      let bookingCanceled: ReturnType<typeof command> | null = null;
      if (booking.state === "canceled") {
        const a = entityAudit(booking.id, "carrier.booking.canceled"),
          d = parse(a.detail) as { reason?: unknown };
        assert(d && typeof d.reason === "string");
        const bookingReason = clean(d.reason, "Cancellation reason", 1000);
        equal(d, { reviewHash: booking.review_hash, reason: bookingReason });
        bookingCanceled = command(
          "carrier.cancel",
          { id: booking.id },
          {
            bookingId: booking.id,
            reviewHash: booking.review_hash,
            reason: bookingReason,
          },
        );
        assert(
          a.actor_id === bookingCanceled.actorId &&
            canceled.sequence < Number(a.sequence) &&
            Number(a.sequence) < bookingCanceled.sequence,
        );
        expectedEvents.push({
          type: "carrier.booking.canceled",
          payload: target,
        });
      } else {
        assert(
          !history.get(
            "SELECT 1 FROM platform_audit WHERE org_id=? AND reference=? AND action LIKE 'carrier.%' AND action NOT IN('carrier.prepare','carrier.cancel','carrier.canada-post.group.prepare','carrier.canada-post.group.cancel') LIMIT 1",
            actor.orgId,
            booking.id,
          ),
        );
      }
      return {
        bookingId: booking.id,
        reviewHash: booking.review_hash,
        accountId: snapshot.account_id,
        nativeSnapshotHash: digest(canonical(intent.nativeSnapshot)),
        intentHash: digest(booking.intent),
        configurationHash: configuration.hash,
        configurationSnapshotHash: digest(canonical(configuration)),
        memberHash: digest(canonical(member)),
        bookingHash: digest(canonical(booking)),
        prepared: bookingPrepared,
        canceled: bookingCanceled,
        eventsHash: events(booking.id, expectedEvents),
      };
    });
    const body = {
      version: 1 as const,
      disposition: "canceled-unused-membership" as const,
      orgId: actor.orgId,
      groupId: group.id,
      bookingId,
      warehouseId: group.warehouse_id,
      configurationHash: group.configuration_hash,
      providerGroupId: group.provider_group_id,
      reviewHash: group.review_hash,
      groupHash: digest(canonical(group)),
      memberSetHash: digest(canonical(qualified)),
      members: qualified,
      prepared,
      canceled,
      cancellationAuditHash: digest(canonical(audit)),
      groupEventsHash,
    };
    return immutable({ ...body, evidenceHash: digest(canonical(body)) });
  }
  canadaPostGroupBookings(actor: Actor, groupId: string) {
    actor = this.principal(actor);
    const { members } = this.canadaPostGroup(actor, groupId);
    return members.map((member) =>
      this.view(this.booking(actor, member.booking_id)),
    );
  }
  canadaPostBookingWarehouse(actor: Actor, bookingId: string) {
    actor = this.principal(actor);
    const booking = this.booking(actor, bookingId),
      intent = this.intent(booking);
    check(
      intent.provider === "canada-post",
      "CARRIER_MISMATCH",
      "Select a reviewed Canada Post booking.",
    );
    return intent.nativeSnapshot.warehouse_id;
  }
  canadaPostGroupForBooking(actor: Actor, bookingId: string) {
    actor = this.principal(actor);
    this.canadaPostBookingWarehouse(actor, bookingId);
    const member = this.store.get<{ group_id: string }>(
      "SELECT group_id FROM integration_canada_post_members WHERE org_id=? AND booking_id=? AND active=1",
      actor.orgId,
      bookingId,
    );
    return member ? this.reviewCanadaPostGroup(actor, member.group_id) : null;
  }
  canadaPostCandidates(actor: Actor, warehouseId: string, after?: string) {
    actor = this.principal(actor);
    warehouseId = text(warehouseId, "Warehouse", 128);
    site(actor, warehouseId);
    const cursor = after === undefined ? undefined : this.booking(actor, after);
    if (cursor) {
      check(
        this.canadaPostBookingWarehouse(actor, cursor.id) === warehouseId,
        "CURSOR",
        "The booking cursor belongs to a different warehouse.",
        400,
      );
    }
    const rows = this.store.all<Booking>(
      `SELECT b.* FROM integration_carrier_bookings b
       WHERE b.org_id=? AND b.state='pending' AND b.sequence>?
       AND json_extract(b.intent,'$.provider')='canada-post'
       AND json_extract(b.intent,'$.nativeSnapshot.warehouse_id')=?
       AND NOT EXISTS(SELECT 1 FROM integration_canada_post_members m
         WHERE m.org_id=b.org_id AND m.booking_id=b.id AND m.active=1)
       ORDER BY b.sequence LIMIT 21`,
      actor.orgId,
      cursor?.sequence ?? 0,
      warehouseId,
    );
    const items = rows.slice(0, 20).map((row) => {
      this.booking(actor, row.id);
      return this.view(row);
    });
    return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
  }
  canadaPostGroups(actor: Actor, warehouseId: string, after?: string) {
    actor = this.principal(actor);
    warehouseId = text(warehouseId, "Warehouse", 128);
    site(actor, warehouseId);
    if (after !== undefined) {
      const cursor = this.canadaPostGroup(actor, after).group;
      check(
        cursor.warehouse_id === warehouseId,
        "CARRIER_MISMATCH",
        "The group cursor belongs to a different warehouse.",
      );
    }
    const rows = this.store.all<{ id: string }>(
      "SELECT id FROM integration_canada_post_groups WHERE org_id=? AND warehouse_id=? AND id>? ORDER BY id LIMIT 21",
      actor.orgId,
      warehouseId,
      after ?? "",
    );
    return {
      items: rows
        .slice(0, 20)
        .map((row) => this.reviewCanadaPostGroup(actor, row.id)),
      next: rows.length > 20 ? rows[19]!.id : null,
    };
  }
  cancelCanadaPostGroup(
    actor: Actor,
    key: string,
    input: { groupId: string; reviewHash: string; reason: string },
  ): { id: string } {
    return this.platform.command(
      actor,
      "carrier.canada-post.group.cancel",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.canadaPostGroup(actor, input.groupId);
      },
      () => {
        const { group, members } = this.canadaPostGroup(actor, input.groupId);
        check(
          group.review_hash === input.reviewHash,
          "CARRIER_MISMATCH",
          "Review the exact group before cancellation.",
        );
        check(
          group.state === "prepared" &&
            !group.token &&
            group.started_at === null &&
            !group.observation &&
            !group.manifest_bytes &&
            !group.manifest_hash &&
            members.every((member) => {
              const booking = this.booking(actor, member.booking_id);
              return (
                member.state === "pending" &&
                !member.token &&
                member.started_at === null &&
                !member.provider_shipment_id &&
                !member.tracking &&
                !member.label_bytes &&
                !member.label_hash &&
                booking.state === "pending" &&
                booking.token === null &&
                booking.started_at === null &&
                booking.reference === null &&
                booking.tracking === null &&
                booking.label_bytes === null &&
                booking.label_type === null &&
                booking.label_hash === null &&
                booking.error === null
              );
            }),
          "STATE",
          "Only a wholly unsent, unclaimed group may be canceled.",
        );
        const reason = clean(input.reason, "Group cancellation reason", 1000);
        this.store.run(
          "UPDATE integration_canada_post_groups SET state='canceled' WHERE id=?",
          group.id,
        );
        this.store.run(
          "UPDATE integration_canada_post_members SET active=0 WHERE group_id=?",
          group.id,
        );
        this.platform.audit(
          actor,
          "carrier.canada-post.group.canceled",
          group.id,
          { reviewHash: group.review_hash, reason },
        );
        this.platform.event(
          actor,
          "carrier.canada-post.group.canceled",
          group.id,
          { reviewHash: group.review_hash },
        );
        return { id: group.id };
      },
    );
  }
  createCanadaPostMember(
    actor: Actor,
    groupId: string,
    bookingId: string,
    client: CanadaPostCreationClient,
  ) {
    return this.runCanadaPostMember(actor, groupId, bookingId, client, true);
  }
  reconcileCanadaPostMember(
    actor: Actor,
    groupId: string,
    bookingId: string,
    client: CanadaPostCreationClient,
  ) {
    return this.runCanadaPostMember(actor, groupId, bookingId, client, false);
  }
  private assertCanadaPostNative(
    actor: Actor,
    group: CanadaPostGroup,
    members: CanadaPostMember[],
  ) {
    check(
      group.token === null &&
        group.started_at === null &&
        group.observation === null &&
        group.manifest_bytes === null &&
        group.manifest_hash === null,
      "STATE",
      "Resolve the manifest claim before creating or reconciling members.",
    );
    for (const member of members) {
      const booking = this.booking(actor, member.booking_id);
      check(
        booking.state === "pending" &&
          booking.token === null &&
          booking.started_at === null &&
          booking.reference === null &&
          booking.tracking === null &&
          booking.label_bytes === null &&
          booking.label_type === null &&
          booking.label_hash === null &&
          booking.error === null,
        "CARRIER_MISMATCH",
        "Group creation requires the exact unclaimed native bookings.",
      );
      this.assertNative(actor, booking);
    }
  }
  private assertCanadaPostMemberClaim(
    group: CanadaPostGroup,
    member: CanadaPostMember | undefined,
    original: CanadaPostGroup,
    originalMember: CanadaPostMember,
    token: string,
    send: boolean,
  ) {
    check(
      group.review_hash === original.review_hash &&
        group.configuration_hash === original.configuration_hash &&
        group.provider_group_id === original.provider_group_id &&
        ["creating", "unknown"].includes(group.state) &&
        group.token === null &&
        group.observation === null &&
        group.manifest_bytes === null &&
        group.manifest_hash === null &&
        member &&
        member.active === 1 &&
        member.review_hash === originalMember.review_hash &&
        member.token === token &&
        member.state === (send ? "creating" : "unknown") &&
        member.provider_shipment_id === null &&
        member.tracking === null &&
        member.label_bytes === null &&
        member.label_hash === null,
      "STATE",
      "Canada Post member claim changed; reconcile the outcome without resending.",
    );
  }
  private async runCanadaPostMember(
    actor: Actor,
    groupId: string,
    bookingId: string,
    client: CanadaPostCreationClient,
    send: boolean,
  ): Promise<CanadaPostGroupView> {
    actor = this.principal(actor);
    check(
      client &&
        client.testApplication === true &&
        typeof client.configurationHash === "string" &&
        /^[a-f0-9]{64}$/.test(client.configurationHash) &&
        typeof client.create === "function" &&
        typeof client.lookup === "function",
      "CARRIER_DISABLED",
      "An explicitly injected Canada Post test client is required.",
      503,
    );
    // Capture the trusted methods and binding before the first await.
    const configurationHash = client.configurationHash,
      create = client.create.bind(client),
      lookup = client.lookup.bind(client),
      token = id();
    const original = this.database.transaction(() => {
      actor = this.principal(actor);
      const { group, members } = this.canadaPostGroup(actor, groupId),
        member = members.find((m) => m.booking_id === bookingId);
      check(
        group.configuration_hash === configurationHash,
        "CARRIER_CONFIG",
        "The reviewed Canada Post configuration changed.",
      );
      check(member, "NOT_FOUND", "Booking is not a member of this group.", 404);
      check(
        (send ? ["prepared", "creating"] : ["creating", "unknown"]).includes(
          group.state,
        ) &&
          member.state === (send ? "pending" : "unknown") &&
          member.token === null &&
          member.started_at === null &&
          member.provider_shipment_id === null &&
          member.tracking === null &&
          member.label_bytes === null &&
          member.label_hash === null &&
          (!send || !members.some((m) => m.state === "unknown")),
        "STATE",
        "Reconcile uncertain members before creating another; never resend an uncertain member.",
      );
      this.assertCanadaPostNative(actor, group, members);
      this.store.run(
        "UPDATE integration_canada_post_members SET state=?,token=?,started_at=? WHERE group_id=? AND booking_id=?",
        send ? "creating" : "unknown",
        token,
        Date.now(),
        group.id,
        bookingId,
      );
      if (send)
        this.store.run(
          "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
          group.id,
        );
      this.platform.audit(
        actor,
        "carrier.canada-post.member.claimed",
        group.id,
        { bookingId, reviewHash: member.review_hash, send },
      );
      return {
        group,
        member,
        intent: immutable(this.intent(this.booking(actor, bookingId))),
      };
    });
    let guarded = false;
    try {
      const result = send
        ? await create(
            original.intent,
            original.group.provider_group_id,
            () => {
              this.database.transaction(() => {
                actor = this.principal(actor);
                const { group, members } = this.canadaPostGroup(actor, groupId);
                this.assertCanadaPostMemberClaim(
                  group,
                  members.find((m) => m.booking_id === bookingId),
                  original.group,
                  original.member,
                  token,
                  send,
                );
                check(
                  !guarded && !members.some((m) => m.state === "unknown"),
                  "STATE",
                  "The creation guard can authorize only one write in a resolved group.",
                );
                this.assertCanadaPostNative(actor, group, members);
                guarded = true;
              });
            },
          )
        : await lookup(original.intent, original.group.provider_group_id);
      check(
        !send || guarded,
        "CARRIER_RESULT",
        "Canada Post client did not invoke the write guard.",
      );
      // Copy and qualify the observation before persistence; never promote a
      // created label to a native booking until manifest transmission is qualified.
      const qualified =
        result === null && !send
          ? null
          : validateCanadaPostCreation(result, original.group, original.member);
      return this.database.transaction(() => {
        actor = this.principal(actor);
        const { group, members } = this.canadaPostGroup(actor, groupId);
        this.assertCanadaPostMemberClaim(
          group,
          members.find((m) => m.booking_id === bookingId),
          original.group,
          original.member,
          token,
          send,
        );
        if (qualified) {
          check(
            !this.store.get(
              "SELECT 1 FROM integration_canada_post_members m JOIN integration_canada_post_groups g ON g.id=m.group_id WHERE m.org_id=? AND g.configuration_hash=? AND m.booking_id!=? AND (m.provider_shipment_id=? OR m.tracking=?)",
              actor.orgId,
              group.configuration_hash,
              bookingId,
              qualified.shipmentId,
              qualified.tracking,
            ),
            "CARRIER_RESULT",
            "A provider shipment or tracking reference is already bound to another booking.",
          );
          this.store.run(
            "UPDATE integration_canada_post_members SET state='created',token=NULL,started_at=NULL,provider_shipment_id=?,tracking=?,label_bytes=?,label_hash=? WHERE group_id=? AND booking_id=?",
            qualified.shipmentId,
            qualified.tracking,
            qualified.label.bytes,
            digest(qualified.label.bytes),
            group.id,
            bookingId,
          );
          this.platform.event(
            actor,
            "carrier.canada-post.member.created",
            group.id,
            {
              bookingId,
              reviewHash: original.member.review_hash,
              shipmentId: qualified.shipmentId,
            },
          );
        } else {
          this.store.run(
            "UPDATE integration_canada_post_members SET token=NULL,started_at=NULL WHERE group_id=? AND booking_id=?",
            group.id,
            bookingId,
          );
        }
        const states = this.store.all<{ state: string }>(
          "SELECT state FROM integration_canada_post_members WHERE group_id=?",
          group.id,
        );
        const state = states.every((m) => m.state === "created")
          ? "closed"
          : states.some((m) => m.state === "unknown")
            ? "unknown"
            : "creating";
        this.store.run(
          "UPDATE integration_canada_post_groups SET state=? WHERE id=?",
          state,
          group.id,
        );
        this.platform.audit(
          actor,
          qualified
            ? "carrier.canada-post.member.created"
            : "carrier.canada-post.member.unconfirmed",
          group.id,
          {
            bookingId,
            reviewHash: original.member.review_hash,
            reconciled: !send,
            groupState: state,
            ...(qualified ? { labelHash: digest(qualified.label.bytes) } : {}),
          },
        );
        return this.reviewCanadaPostGroup(actor, group.id);
      });
    } catch (error) {
      this.database.transaction(() => {
        const changed = this.store.run(
          "UPDATE integration_canada_post_members SET state='unknown',token=NULL,started_at=NULL WHERE org_id=? AND group_id=? AND booking_id=? AND token=?",
          original.group.org_id,
          groupId,
          bookingId,
          token,
        );
        if (changed.changes) {
          this.store.run(
            "UPDATE integration_canada_post_groups SET state='unknown' WHERE id=?",
            groupId,
          );
          this.platform.audit(
            actor,
            "carrier.canada-post.member.unknown",
            groupId,
            { bookingId, reviewHash: original.member.review_hash },
          );
        }
      });
      throw error;
    }
  }
  recoverStaleCanadaPostMembers(ageMs = 120000, orgId?: string) {
    integer(ageMs, "Canada Post claim age", 0, 86_400_000);
    if (orgId !== undefined) text(orgId, "Organization", 128);
    return this.database.transaction(() => {
      const expired = this.store.all<{ group_id: string; booking_id: string }>(
        "SELECT group_id,booking_id FROM integration_canada_post_members WHERE token IS NOT NULL AND started_at<=? AND (? IS NULL OR org_id=?)",
        Date.now() - ageMs,
        orgId ?? null,
        orgId ?? null,
      );
      for (const member of expired) {
        this.store.run(
          "UPDATE integration_canada_post_members SET state='unknown',token=NULL,started_at=NULL WHERE group_id=? AND booking_id=?",
          member.group_id,
          member.booking_id,
        );
        this.store.run(
          "UPDATE integration_canada_post_groups SET state='unknown' WHERE id=?",
          member.group_id,
        );
      }
      return expired.length;
    });
  }
  private manifestClient(client: CanadaPostManifestClient) {
    check(
      client &&
        client.testApplication === true &&
        typeof client.configurationHash === "string" &&
        /^[a-f0-9]{64}$/.test(client.configurationHash) &&
        typeof client.manifestIdentity === "function" &&
        typeof client.transmitManifest === "function" &&
        typeof client.recoverManifest === "function",
      "CARRIER_DISABLED",
      "An explicitly injected Canada Post test manifest client is required.",
      503,
    );
    return {
      configurationHash: client.configurationHash,
      identity: client.manifestIdentity.bind(client),
      transmit: client.transmitManifest.bind(client),
      recover: client.recoverManifest.bind(client),
    };
  }
  private manifestInput(
    actor: Actor,
    group: CanadaPostGroup,
    members: CanadaPostMember[],
    ready: boolean,
  ) {
    const entries = members.map((member) => {
      check(
        member.state === "created" &&
          member.token === null &&
          member.started_at === null &&
          typeof member.provider_shipment_id === "string" &&
          /^[A-Za-z0-9_-]{1,32}$/.test(member.provider_shipment_id) &&
          typeof member.tracking === "string" &&
          /^\d{11,16}$/.test(member.tracking) &&
          member.label_bytes !== null &&
          member.label_hash === digest(Buffer.from(member.label_bytes)),
        "CARRIER_MISMATCH",
        "Manifest requires every exact created member and retained label without an active claim.",
      );
      validateCarrierLabel({
        mediaType: "application/pdf",
        bytes: Buffer.from(member.label_bytes!),
      });
      const booking = this.booking(actor, member.booking_id);
      check(
        booking.state === "pending" &&
          booking.token === null &&
          booking.started_at === null &&
          booking.reference === null &&
          booking.tracking === null &&
          booking.label_bytes === null &&
          booking.label_type === null &&
          booking.label_hash === null &&
          booking.error === null,
        "CARRIER_MISMATCH",
        "Manifest requires unchanged pending native bookings without another effect.",
      );
      if (ready) this.assertNative(actor, booking);
      return {
        intent: this.intent(booking),
        shipmentId: member.provider_shipment_id!,
        tracking: member.tracking!,
      };
    });
    for (const field of ["shipmentId", "tracking"] as const)
      check(
        new Set(entries.map((entry) => entry[field])).size === entries.length,
        "CARRIER_MISMATCH",
        "Manifest provider shipment and tracking identities must be unique.",
      );
    return {
      input: immutable({
        manifestId: group.id,
        groupId: group.provider_group_id,
        entries,
      }),
      memberHash: digest(
        canonical(
          members.map((member) => ({
            bookingId: member.booking_id,
            reviewHash: member.review_hash,
            shipmentId: member.provider_shipment_id,
            tracking: member.tracking,
            labelHash: member.label_hash,
          })),
        ),
      ),
    };
  }
  reviewCanadaPostManifest(
    actor: Actor,
    groupId: string,
    client: CanadaPostManifestClient,
  ): CanadaPostManifestIdentity {
    actor = this.principal(actor);
    const binding = this.manifestClient(client),
      { group, members } = this.canadaPostGroup(actor, groupId);
    check(
      ["closed", "transmitting", "unknown"].includes(group.state),
      "STATE",
      "Review a closed group or retained manifest uncertainty.",
    );
    check(
      group.configuration_hash === binding.configurationHash,
      "CARRIER_CONFIG",
      "The reviewed configuration changed.",
    );
    const snapshot = this.manifestInput(actor, group, members, false),
      identity = validateManifestIdentity(
        binding.identity(snapshot.input),
        snapshot.input,
        group.configuration_hash,
      );
    if (group.state !== "closed")
      this.manifestClaim(group, snapshot.memberHash, identity);
    return identity;
  }
  transmitCanadaPostManifest(
    actor: Actor,
    groupId: string,
    reviewHash: string,
    client: CanadaPostManifestClient,
  ) {
    return this.runCanadaPostManifest(actor, groupId, reviewHash, client, true);
  }
  reconcileCanadaPostManifest(
    actor: Actor,
    groupId: string,
    reviewHash: string,
    client: CanadaPostManifestClient,
  ) {
    return this.runCanadaPostManifest(
      actor,
      groupId,
      reviewHash,
      client,
      false,
    );
  }
  private manifestClaim(
    group: CanadaPostGroup,
    memberHash: string,
    identity: CanadaPostManifestIdentity,
  ): ManifestClaim {
    check(
      group.observation !== null &&
        group.manifest_bytes === null &&
        group.manifest_hash === null,
      "CARRIER_MISMATCH",
      "Manifest uncertainty must retain its exact claimed identity without confirmation.",
    );
    const claim = JSON.parse(group.observation!) as ManifestClaim;
    exactFields(claim, ["kind", "groupReviewHash", "memberHash", "identity"]);
    check(
      claim.kind === "manifest-claim" &&
        claim.groupReviewHash === group.review_hash &&
        claim.memberHash === memberHash &&
        canonical(claim.identity) === canonical(identity),
      "CARRIER_MISMATCH",
      "Manifest claim identity or created membership changed.",
    );
    return claim;
  }
  private async runCanadaPostManifest(
    actor: Actor,
    groupId: string,
    reviewHash: string,
    client: CanadaPostManifestClient,
    send: boolean,
  ): Promise<CanadaPostGroupView> {
    actor = this.principal(actor);
    const binding = this.manifestClient(client),
      token = id();
    const original = this.database.transaction(() => {
      actor = this.principal(actor);
      const { group, members } = this.canadaPostGroup(actor, groupId);
      check(
        group.configuration_hash === binding.configurationHash,
        "CARRIER_CONFIG",
        "The reviewed configuration changed.",
      );
      check(
        group.state === (send ? "closed" : "unknown") &&
          group.token === null &&
          group.started_at === null &&
          group.manifest_bytes === null &&
          group.manifest_hash === null &&
          (!send || group.observation === null),
        "STATE",
        "Transmit a closed unclaimed group once; uncertain outcomes require read-only recovery.",
      );
      const snapshot = this.manifestInput(actor, group, members, true),
        identity = validateManifestIdentity(
          binding.identity(snapshot.input),
          snapshot.input,
          group.configuration_hash,
        );
      check(
        identity.reviewHash === reviewHash,
        "CARRIER_MISMATCH",
        "Review the exact manifest before claiming transmission or recovery.",
      );
      const claim: ManifestClaim = send
        ? {
            kind: "manifest-claim",
            groupReviewHash: group.review_hash,
            memberHash: snapshot.memberHash,
            identity,
          }
        : this.manifestClaim(group, snapshot.memberHash, identity);
      this.store.run(
        "UPDATE integration_canada_post_groups SET state=?,token=?,started_at=?,observation=? WHERE id=?",
        send ? "transmitting" : "unknown",
        token,
        Date.now(),
        canonical(claim),
        group.id,
      );
      this.platform.audit(
        actor,
        "carrier.canada-post.manifest.claimed",
        group.id,
        { reviewHash, send, memberHash: snapshot.memberHash },
      );
      return { group, snapshot, identity, claim };
    });
    let guarded = false;
    const owned = (ready: boolean) => {
      actor = this.principal(actor);
      const { group, members } = this.canadaPostGroup(actor, groupId);
      check(
        group.state === (send ? "transmitting" : "unknown") &&
          group.token === token &&
          group.started_at !== null &&
          group.review_hash === original.group.review_hash &&
          group.configuration_hash === original.group.configuration_hash &&
          group.provider_group_id === original.group.provider_group_id,
        "STATE",
        "Manifest claim ownership changed; recover without retransmitting.",
      );
      const snapshot = this.manifestInput(actor, group, members, ready);
      check(
        canonical(snapshot) === canonical(original.snapshot),
        "CARRIER_MISMATCH",
        "Claimed manifest members changed.",
      );
      this.manifestClaim(group, snapshot.memberHash, original.identity);
      return { group, members };
    };
    try {
      const result = send
        ? await binding.transmit(original.snapshot.input, () => {
            this.database.transaction(() => {
              check(
                !guarded,
                "STATE",
                "The manifest guard authorizes exactly one transmission.",
              );
              owned(true);
              guarded = true;
            });
          })
        : await binding.recover(original.snapshot.input);
      check(
        !send || guarded,
        "CARRIER_RESULT",
        "Manifest client did not invoke the write guard.",
      );
      const qualified =
        result === null && !send
          ? null
          : validateManifestObservation(result, original.identity);
      return this.database.transaction(() => {
        const { group, members } = owned(false);
        if (qualified) {
          check(
            !this.store.get(
              "SELECT 1 FROM integration_canada_post_groups WHERE org_id=? AND configuration_hash=? AND id!=? AND state='transmitted' AND json_extract(observation,'$.result.poNumber')=?",
              group.org_id,
              group.configuration_hash,
              group.id,
              qualified.poNumber,
            ),
            "CARRIER_RESULT",
            "Manifest purchase order is already bound to another group.",
          );
          const { document, ...metadata } = qualified,
            documentHash = digest(document.bytes);
          const confirmation: ManifestConfirmation = {
            ...original.claim,
            kind: "manifest-confirmed",
            result: metadata,
            documentHash,
          };
          this.store.run(
            "UPDATE integration_canada_post_groups SET state='transmitted',token=NULL,started_at=NULL,observation=?,manifest_bytes=?,manifest_hash=? WHERE id=?",
            canonical(confirmation),
            document.bytes,
            documentHash,
            group.id,
          );
          for (const member of members) {
            this.store.run(
              "UPDATE integration_carrier_bookings SET state='booked',reference=?,tracking=?,label_bytes=?,label_type='application/pdf',label_hash=? WHERE id=?",
              member.provider_shipment_id,
              member.tracking,
              member.label_bytes,
              member.label_hash,
              member.booking_id,
            );
            this.platform.event(
              actor,
              "carrier.booking.booked",
              member.booking_id,
              {
                ...this.targetReference(this.booking(actor, member.booking_id)),
                provider: "canada-post",
                manifestId: group.id,
                reviewHash: member.review_hash,
              },
            );
          }
          this.platform.event(
            actor,
            "carrier.canada-post.manifest.transmitted",
            group.id,
            { reviewHash, poNumber: qualified.poNumber, documentHash },
          );
        } else
          this.store.run(
            "UPDATE integration_canada_post_groups SET token=NULL,started_at=NULL WHERE id=?",
            group.id,
          );
        this.platform.audit(
          actor,
          qualified
            ? "carrier.canada-post.manifest.transmitted"
            : "carrier.canada-post.manifest.unconfirmed",
          group.id,
          {
            reviewHash,
            reconciled: !send,
            ...(qualified
              ? {
                  documentHash: digest(qualified.document.bytes),
                  poNumber: qualified.poNumber,
                }
              : {}),
          },
        );
        return this.reviewCanadaPostGroup(actor, group.id);
      });
    } catch (error) {
      this.database.transaction(() => {
        const changed = this.store.run(
          "UPDATE integration_canada_post_groups SET state='unknown',token=NULL,started_at=NULL WHERE org_id=? AND id=? AND token=?",
          original.group.org_id,
          groupId,
          token,
        );
        if (changed.changes)
          this.platform.audit(
            actor,
            "carrier.canada-post.manifest.unknown",
            groupId,
            { reviewHash },
          );
      });
      throw error;
    }
  }
  recoverStaleCanadaPostManifests(ageMs = 120000, orgId?: string) {
    integer(ageMs, "Canada Post manifest claim age", 0, 86_400_000);
    if (orgId !== undefined) text(orgId, "Organization", 128);
    return this.database.transaction(
      () =>
        this.store.run(
          "UPDATE integration_canada_post_groups SET state='unknown',token=NULL,started_at=NULL WHERE state IN('transmitting','unknown') AND token IS NOT NULL AND started_at<=? AND (? IS NULL OR org_id=?)",
          Date.now() - ageMs,
          orgId ?? null,
          orgId ?? null,
        ).changes,
    );
  }
  private claimTarget(actor: Actor, target: CarrierClaimTarget) {
    actor = this.principal(actor);
    permit(actor, ["admin"]);
    check(
      target && typeof target === "object",
      "VALIDATION",
      "Supply a carrier claim target.",
      400,
    );
    if (target.kind === "booking") {
      exactFields(target, ["kind", "bookingId"]);
      const booking = this.booking(actor, target.bookingId);
      const intent = this.intent(booking);
      check(
        intent.provider !== "canada-post",
        "CARRIER_MISMATCH",
        "Canada Post claims belong to their group.",
      );
      return {
        actor,
        row: booking,
        claimPhaseValid: true,
        identity: { bookingId: booking.id, reviewHash: booking.review_hash },
      };
    }
    check(
      target.kind === "member" || target.kind === "manifest",
      "VALIDATION",
      "Unsupported carrier claim target.",
      400,
    );
    exactFields(
      target,
      target.kind === "member"
        ? ["kind", "groupId", "bookingId"]
        : ["kind", "groupId"],
    );
    const { group, members } = this.canadaPostGroup(actor, target.groupId);
    const member =
      target.kind === "member"
        ? members.find((m) => m.booking_id === target.bookingId)
        : undefined;
    if (target.kind === "member")
      check(member, "NOT_FOUND", "Canada Post member not found.", 404);
    return {
      actor,
      row: member ?? group,
      claimPhaseValid: member
        ? ["creating", "unknown"].includes(group.state) &&
          group.token === null &&
          group.started_at === null &&
          group.observation === null
        : members.every((m) => m.state === "created" && m.token === null) &&
          group.observation !== null,
      identity: {
        groupId: group.id,
        groupReviewHash: group.review_hash,
        groupState: group.state,
        configurationHash: group.configuration_hash,
        ...(member
          ? { bookingId: member.booking_id, reviewHash: member.review_hash }
          : { observation: group.observation }),
      },
    };
  }
  reviewClaim(
    actor: Actor,
    target: CarrierClaimTarget,
    minimumAgeMs: number,
  ): CarrierClaimReview {
    integer(minimumAgeMs, "Minimum claim age", 1, 86_400_000);
    const { row, identity, claimPhaseValid } = this.claimTarget(actor, target);
    const states =
      target.kind === "booking"
        ? ["running", "unknown"]
        : target.kind === "member"
          ? ["creating", "unknown"]
          : ["transmitting", "unknown"];
    check(
      claimPhaseValid &&
        states.includes(row.state) &&
        typeof row.token === "string" &&
        row.token.length > 0 &&
        Number.isSafeInteger(row.started_at) &&
        row.started_at! >= 0 &&
        row.started_at! <= Number.MAX_SAFE_INTEGER - minimumAgeMs,
      "STATE",
      "This record has no active claim to release.",
    );
    return {
      target,
      state: row.state,
      startedAt: row.started_at!,
      minimumAgeMs,
      eligibleAt: row.started_at! + minimumAgeMs,
      claimHash: digest(
        canonical({
          target,
          identity,
          state: row.state,
          token: row.token,
          startedAt: row.started_at,
          minimumAgeMs,
        }),
      ),
    };
  }
  releaseClaim(
    actor: Actor,
    key: string,
    input: {
      target: CarrierClaimTarget;
      minimumAgeMs: number;
      claimHash: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "carrier.claim.release",
      key,
      input,
      () => {
        exactFields(input, ["target", "minimumAgeMs", "claimHash", "reason"]);
        integer(input.minimumAgeMs, "Minimum claim age", 1, 86_400_000);
        text(input.reason, "Claim release reason", 160);
        check(
          typeof input.claimHash === "string" &&
            /^[a-f0-9]{64}$/.test(input.claimHash),
          "VALIDATION",
          "Supply the exact claim review hash.",
          400,
        );
        actor = this.claimTarget(actor, input.target).actor;
      },
      () => {
        const review = this.reviewClaim(
          actor,
          input.target,
          input.minimumAgeMs,
        );
        check(
          review.claimHash === input.claimHash,
          "STALE_REVIEW",
          "Carrier claim changed. Review its current outcome before release.",
        );
        check(
          Date.now() >= review.eligibleAt,
          "CLAIM_ACTIVE",
          "The reviewed minimum claim age has not elapsed.",
        );
        const target = input.target;
        if (target.kind === "booking")
          this.store.run(
            "UPDATE integration_carrier_bookings SET state='unknown',token=NULL,started_at=NULL,error=? WHERE org_id=? AND id=?",
            "Reviewed claim released. Reconcile by lookup; never resend.",
            actor.orgId,
            target.bookingId,
          );
        else if (target.kind === "manifest")
          this.store.run(
            "UPDATE integration_canada_post_groups SET state='unknown',token=NULL,started_at=NULL WHERE org_id=? AND id=?",
            actor.orgId,
            target.groupId,
          );
        else {
          this.store.run(
            "UPDATE integration_canada_post_members SET state='unknown',token=NULL,started_at=NULL WHERE org_id=? AND group_id=? AND booking_id=?",
            actor.orgId,
            target.groupId,
            target.bookingId,
          );
          this.store.run(
            "UPDATE integration_canada_post_groups SET state='unknown' WHERE org_id=? AND id=?",
            actor.orgId,
            target.groupId,
          );
        }
        this.platform.audit(
          actor,
          "carrier.claim.released",
          target.kind === "booking" ? target.bookingId : target.groupId,
          {
            target,
            minimumAgeMs: input.minimumAgeMs,
            startedAt: review.startedAt,
            claimHash: review.claimHash,
            reason: input.reason.trim(),
          },
        );
        return {
          target,
          state: "unknown" as const,
          claimHash: review.claimHash,
        };
      },
    );
  }
  private confirmedManifest(actor: Actor, groupId: string) {
    const { group, members } = this.canadaPostGroup(actor, groupId);
    check(
      group.state === "transmitted" &&
        group.token === null &&
        group.started_at === null &&
        group.observation !== null &&
        group.manifest_bytes !== null &&
        group.manifest_hash === digest(Buffer.from(group.manifest_bytes)),
      "CARRIER_MISMATCH",
      "Manifest confirmation and retained document integrity are required.",
    );
    const confirmation = JSON.parse(group.observation!) as ManifestConfirmation;
    exactFields(confirmation, [
      "kind",
      "groupReviewHash",
      "memberHash",
      "identity",
      "result",
      "documentHash",
    ]);
    const input = {
      manifestId: group.id,
      groupId: group.provider_group_id,
      entries: members.map((member) => ({
        intent: this.intent(this.booking(actor, member.booking_id)),
        shipmentId: member.provider_shipment_id!,
        tracking: member.tracking!,
      })),
    };
    validateManifestIdentity(
      confirmation.identity,
      input,
      group.configuration_hash,
    );
    check(
      confirmation.kind === "manifest-confirmed" &&
        confirmation.groupReviewHash === group.review_hash &&
        confirmation.documentHash === group.manifest_hash &&
        confirmation.memberHash ===
          digest(
            canonical(
              members.map((member) => ({
                bookingId: member.booking_id,
                reviewHash: member.review_hash,
                shipmentId: member.provider_shipment_id,
                tracking: member.tracking,
                labelHash: member.label_hash,
              })),
            ),
          ) &&
        members.every(
          (member) =>
            member.state === "created" &&
            member.token === null &&
            member.started_at === null &&
            member.label_bytes !== null &&
            member.label_hash === digest(Buffer.from(member.label_bytes)),
        ),
      "CARRIER_MISMATCH",
      "Confirmed manifest identity or created observations changed.",
    );
    const result = validateManifestObservation(
      {
        ...confirmation.result,
        document: {
          mediaType: "application/pdf",
          bytes: Buffer.from(group.manifest_bytes!),
        },
      },
      confirmation.identity,
    );
    return { group, members, result };
  }
  canadaPostManifestDocument(actor: Actor, groupId: string) {
    actor = this.principal(actor);
    const { group, result } = this.confirmedManifest(actor, groupId);
    return {
      mediaType: "application/pdf" as const,
      bytes: result.document.bytes,
      hash: group.manifest_hash!,
      poNumber: result.poNumber,
    };
  }
  private assertCanadaPostHandover(actor: Actor, booking: Booking) {
    const member = this.store.get<CanadaPostMember>(
      "SELECT * FROM integration_canada_post_members WHERE booking_id=? AND active=1",
      booking.id,
    );
    check(
      member,
      "CARRIER_MISMATCH",
      "Canada Post handover requires retained confirmed manifest membership.",
    );
    this.confirmedManifest(actor, member.group_id);
    check(
      booking.reference === member.provider_shipment_id &&
        booking.tracking === member.tracking &&
        booking.label_type === "application/pdf" &&
        booking.label_bytes !== null &&
        booking.label_hash === member.label_hash &&
        digest(Buffer.from(booking.label_bytes)) === member.label_hash,
      "CARRIER_MISMATCH",
      "Native booking differs from the confirmed Canada Post member.",
    );
  }
  private assertNoCanadaPostGroup(bookingId: string) {
    check(
      !this.store.get(
        "SELECT 1 FROM integration_canada_post_members WHERE booking_id=? AND active=1",
        bookingId,
      ),
      "CARRIER_GROUP_ACTIVE",
      "The Canada Post group owns this booking; resolve the group first.",
    );
  }
  history(
    actor: Actor,
    shipmentId: string,
    after?: string,
  ): { items: CarrierBookingView[]; next: string | null } {
    check(
      !shipmentId.startsWith("replacement:"),
      "NOT_FOUND",
      "Shipment not found.",
      404,
    );
    return this.targetHistory(actor, shipmentId, after);
  }
  historyReplacement(actor: Actor, replacementId: string, after?: string) {
    return this.database.transaction(() =>
      this.targetHistory(actor, this.replacementKey(replacementId), after),
    );
  }
  private targetHistory(
    actor: Actor,
    shipmentId: string,
    after?: string,
  ): { items: CarrierBookingView[]; next: string | null } {
    actor = this.principal(actor);
    this.shipment(actor, shipmentId);
    const cursor =
      after === undefined
        ? undefined
        : this.store.get<Booking>(
            "SELECT * FROM integration_carrier_bookings WHERE org_id=? AND shipment_id=? AND id=?",
            actor.orgId,
            shipmentId,
            text(after, "History cursor", 128),
          );
    check(
      after === undefined || cursor,
      "CURSOR",
      "Carrier history cursor is not available for this shipment.",
      400,
    );
    const rows = this.store.all<Booking>(
      "SELECT * FROM integration_carrier_bookings WHERE org_id=? AND shipment_id=? AND sequence>? ORDER BY sequence LIMIT 21",
      actor.orgId,
      shipmentId,
      cursor?.sequence ?? 0,
    );
    const items = rows.slice(0, 20).map((row) => this.view(row));
    return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
  }
  private ready(
    actor: Actor,
    shipment: Shipment | ReplacementCarrierSnapshot,
    provider: CarrierName,
  ) {
    this.platform.assertProviderAccess();
    check(
      "kind" in shipment
        ? shipment.ready
        : shipment.state === "packed" && shipment.mode === "carrier",
      "STATE",
      "Carrier booking requires packed carrier stock or a reserved ready warranty replacement.",
    );
    if (!("kind" in shipment))
      check(
        !this.identity.customer(actor, shipment.account_id).held,
        "CREDIT_HOLD",
        "Account is on hold; carrier booking requires finance clearance.",
      );
    this.identity.providerAllowed(actor, shipment.account_id, provider);
  }
  prepare(
    actor: Actor,
    key: string,
    input: CarrierPrepare,
    configuration?: CarrierConfiguration,
  ): { id: string; reviewHash: string } {
    return this.platform.command(
      actor,
      "carrier.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.shipment(actor, this.inputTarget(input));
        check(
          configuration
            ? configuration.provider === input.provider &&
                /^[a-f0-9]{64}$/.test(configuration.hash) &&
                input.configurationHash === configuration.hash &&
                configuration.services.some(
                  (entry) => entry.service === input.service,
                )
            : input.configurationHash === undefined,
          "CARRIER_CONFIG_CHANGED",
          "Refresh and review the configured carrier account and exact service before preparation.",
        );
      },
      () => {
        const targetKey = this.inputTarget(input);
        const shipment = this.shipment(actor, targetKey);
        check(
          carrierNames.includes(input.provider),
          "VALIDATION",
          "Choose a named carrier.",
          400,
        );
        this.ready(actor, shipment, input.provider);
        const reviewedDestination =
          "kind" in shipment
            ? text(
                input.reviewedDestination,
                "Replacement delivery address",
                2000,
              )
            : shipment.address;
        check(
          input.reviewedDestination === reviewedDestination,
          "CARRIER_MISMATCH",
          "Review the exact delivery address for this shipment or replacement.",
        );
        const previous = this.latest(actor.orgId, targetKey);
        check(
          (previous?.id ?? null) === input.previousId &&
            (!previous || previous.state === "canceled"),
          "CARRIER_BOOKING_ACTIVE",
          "Review the current booking; only canceled unsent bookings may be replaced.",
        );
        check(
          input.provider === "dhl-express" || !Object.hasOwn(input, "dhl"),
          "VALIDATION",
          "DHL review fields apply only to DHL Express.",
          400,
        );
        const origin = address(input.origin),
          destination = address(input.destination),
          reviewedParcel = parcel(input.parcel);
        const review = {
          shipmentId: shipment.id,
          ...("kind" in shipment ? { replacementId: shipment.id } : {}),
          previousId: input.previousId,
          provider: input.provider,
          service: clean(input.service, "Carrier service", 100),
          origin,
          destination,
          parcel: reviewedParcel,
          ...(input.provider === "dhl-express"
            ? {
                dhl: captureDhlReview(
                  input.dhl,
                  shipment,
                  origin,
                  destination,
                  reviewedParcel,
                ),
              }
            : {}),
          reviewedDestination,
          acknowledgment: clean(
            input.acknowledgment,
            "Origin and destination acknowledgment",
            1000,
          ),
          nativeSnapshot: shipment,
          ...(configuration
            ? {
                configurationHash: configuration.hash,
                configuration: JSON.parse(
                  canonical(configuration),
                ) as CarrierConfiguration,
              }
            : {}),
        };
        const bookingId = id(),
          reviewHash = digest(canonical(review));
        const intent: CarrierIntent = { ...review, bookingId, reviewHash };
        this.store.run(
          "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,created_at) VALUES(?,?,?,'pending',?,?,?)",
          bookingId,
          actor.orgId,
          targetKey,
          reviewHash,
          canonical(intent),
          now(),
        );
        this.platform.event(actor, "carrier.booking.prepared", bookingId, {
          shipmentId: shipment.id,
          ...("kind" in shipment ? { replacementId: shipment.id } : {}),
          reviewHash,
          provider: input.provider,
        });
        return { id: bookingId, reviewHash };
      },
    );
  }
  cancel(
    actor: Actor,
    key: string,
    input: { bookingId: string; reviewHash: string; reason: string },
  ): { id: string } {
    return this.platform.command(
      actor,
      "carrier.cancel",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.booking(actor, input.bookingId);
      },
      () => {
        const booking = this.booking(actor, input.bookingId);
        this.assertNoCanadaPostGroup(booking.id);
        check(
          booking.review_hash === input.reviewHash,
          "CARRIER_MISMATCH",
          "Review the exact carrier booking before cancellation.",
        );
        check(
          booking.state === "pending" && !booking.token,
          "STATE",
          "Only an unsent, unclaimed pending booking can be canceled.",
        );
        const reason = clean(input.reason, "Cancellation reason", 1000);
        this.store.run(
          "UPDATE integration_carrier_bookings SET state='canceled' WHERE id=?",
          booking.id,
        );
        this.platform.audit(actor, "carrier.booking.canceled", booking.id, {
          reviewHash: booking.review_hash,
          reason,
        });
        this.platform.event(actor, "carrier.booking.canceled", booking.id, {
          ...this.targetReference(booking),
        });
        return { id: booking.id };
      },
    );
  }
  execute(actor: Actor, bookingId: string, adapter: CarrierAdapter) {
    return this.run(actor, bookingId, adapter, true);
  }
  reconcile(actor: Actor, bookingId: string, adapter: CarrierAdapter) {
    return this.run(actor, bookingId, adapter, false);
  }
  private async run(
    actor: Actor,
    bookingId: string,
    adapter: CarrierAdapter,
    send: boolean,
  ): Promise<CarrierBookingView> {
    actor = this.principal(actor);
    const token = id();
    const booking = this.database.transaction(() => {
      actor = this.principal(actor);
      const booking = this.booking(actor, bookingId),
        intent = this.intent(booking);
      this.assertNoCanadaPostGroup(booking.id);
      check(
        adapter &&
          adapter.provider === intent.provider &&
          adapter.sandbox === true &&
          typeof adapter.book === "function" &&
          typeof adapter.lookup === "function",
        "CARRIER_DISABLED",
        "A matching explicitly enabled sandbox carrier adapter is required.",
        503,
      );
      assertCarrierConfiguration(intent, adapter.configuration);
      check(
        booking.state === (send ? "pending" : "unknown") && !booking.token,
        "STATE",
        "Carrier booking is not available for this action; never resend an uncertain booking.",
      );
      this.assertNative(actor, booking);
      this.store.run(
        "UPDATE integration_carrier_bookings SET state=?,token=?,started_at=?,error=NULL WHERE id=?",
        send ? "running" : "unknown",
        token,
        Date.now(),
        booking.id,
      );
      return booking;
    });
    let guarded = false;
    try {
      const result = send
        ? await adapter.book(immutable(this.intent(booking)), () => {
            this.database.transaction(() => {
              actor = this.principal(actor);
              const current = this.booking(actor, bookingId);
              this.assertClaim(current, booking, token, true);
              check(
                !guarded,
                "STATE",
                "The carrier write guard may only authorize one write.",
              );
              this.assertNative(actor, current);
              guarded = true;
            });
          })
        : await adapter.lookup(immutable(this.intent(booking)));
      check(
        !send || guarded,
        "CARRIER_RESULT",
        "Carrier adapter did not invoke the required write guard.",
      );
      return this.database.transaction(() => {
        actor = this.principal(actor);
        const current = this.booking(actor, bookingId);
        this.assertClaim(current, booking, token, send);
        // Consent is enforced before I/O. Retain a qualified observation even if
        // consent/credit changes during the authorized provider operation.
        if (result === null && !send) {
          this.store.run(
            "UPDATE integration_carrier_bookings SET token=NULL,started_at=NULL,error=? WHERE id=?",
            "No confirmed booking found. Reconcile again; do not resend.",
            bookingId,
          );
        } else {
          const qualified = validateResult(result, booking);
          this.store.run(
            "UPDATE integration_carrier_bookings SET state='booked',token=NULL,started_at=NULL,reference=?,tracking=?,label_bytes=?,label_type=?,label_hash=?,error=NULL WHERE id=?",
            qualified.reference,
            qualified.tracking,
            qualified.label.bytes,
            qualified.label.mediaType,
            digest(qualified.label.bytes),
            bookingId,
          );
          this.platform.event(actor, "carrier.booking.booked", bookingId, {
            ...this.targetReference(booking),
            reviewHash: booking.review_hash,
            reference: qualified.reference,
            tracking: qualified.tracking,
          });
          this.platform.audit(actor, "carrier.booking.booked", bookingId, {
            reviewHash: booking.review_hash,
            labelHash: digest(qualified.label.bytes),
            reconciled: !send,
          });
        }
        return this.view(this.booking(actor, bookingId));
      });
    } catch (error) {
      this.database.transaction(() => {
        const changed = this.store.run(
          "UPDATE integration_carrier_bookings SET state='unknown',token=NULL,started_at=NULL,error=? WHERE org_id=? AND id=? AND token=?",
          "Carrier outcome is uncertain. Reconcile by lookup; do not resend.",
          booking.org_id,
          bookingId,
          token,
        );
        if (changed.changes)
          this.platform.audit(actor, "carrier.booking.unknown", bookingId, {
            reviewHash: booking.review_hash,
          });
      });
      throw error;
    }
  }
  private assertNative(actor: Actor, booking: Booking) {
    const intent = this.intent(booking),
      shipment = this.shipment(actor, booking.shipment_id);
    check(
      canonical(shipment) === canonical(intent.nativeSnapshot),
      "CARRIER_MISMATCH",
      "Native packed shipment changed after carrier review.",
    );
    this.ready(actor, shipment, intent.provider);
  }
  private assertClaim(
    current: Booking,
    original: Booking,
    token: string,
    send: boolean,
  ) {
    check(
      current.token === token &&
        current.state === (send ? "running" : "unknown") &&
        current.intent === original.intent &&
        current.review_hash === original.review_hash &&
        !current.reference &&
        !current.tracking &&
        !current.label_bytes,
      "STATE",
      "Carrier claim changed. Read the provider outcome again; do not send.",
    );
  }
  recoverStale(ageMs = 120000, orgId?: string) {
    integer(ageMs, "Carrier claim age", 0, 86_400_000);
    if (orgId !== undefined) text(orgId, "Organization", 128);
    return this.database.transaction(() =>
      Number(
        this.store.run(
          "UPDATE integration_carrier_bookings SET state='unknown',token=NULL,started_at=NULL,error=? WHERE token IS NOT NULL AND started_at<=? AND (? IS NULL OR org_id=?)",
          "Carrier claim expired. Reconcile by lookup; never resend.",
          Date.now() - ageMs,
          orgId ?? null,
          orgId ?? null,
        ).changes,
      ),
    );
  }
  label(
    actor: Actor,
    bookingId: string,
  ): { bytes: Buffer; mediaType: string; hash: string } {
    actor = this.principal(actor);
    const booking = this.booking(actor, bookingId);
    this.intent(booking);
    check(
      booking.state === "booked" &&
        booking.label_bytes &&
        booking.label_type &&
        booking.label_hash,
      "STATE",
      "No confirmed carrier label is available.",
    );
    const bytes = Buffer.from(booking.label_bytes);
    validateCarrierLabel({ mediaType: booking.label_type, bytes });
    check(
      digest(bytes) === booking.label_hash,
      "CARRIER_RESULT",
      "Carrier label integrity check failed.",
    );
    return { bytes, mediaType: booking.label_type, hash: booking.label_hash };
  }
}
function clean(value: unknown, name: string, maximum = 160) {
  const result = text(value, name, maximum).normalize("NFC");
  check(
    !/[\u0000-\u001f\u007f]/u.test(result),
    "VALIDATION",
    `${name} cannot contain control characters.`,
    400,
  );
  return result;
}
function address(value: CarrierAddress): CarrierAddress {
  check(
    value && typeof value === "object",
    "VALIDATION",
    "Supply a structured carrier address.",
    400,
  );
  check(
    value.country === "US" || value.country === "CA",
    "VALIDATION",
    "Carrier country must be US or CA.",
    400,
  );
  const province = clean(value.province, "State/province", 2).toUpperCase();
  const provinces =
    value.country === "CA"
      ? "AB BC MB NB NL NS NT NU ON PE QC SK YT"
      : "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI";
  check(
    provinces.split(" ").includes(province),
    "VALIDATION",
    "Use a recognized state/province abbreviation.",
    400,
  );
  let postalCode = clean(value.postalCode, "Postal code", 12).toUpperCase();
  if (value.country === "CA") {
    postalCode = postalCode.replace(/ /g, "");
    check(
      /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
        postalCode,
      ),
      "VALIDATION",
      "Supply a valid Canadian postal code.",
      400,
    );
    postalCode = `${postalCode.slice(0, 3)} ${postalCode.slice(3)}`;
  } else
    check(
      /^\d{5}(-\d{4})?$/.test(postalCode),
      "VALIDATION",
      "Supply a valid US ZIP code.",
      400,
    );
  const phone = clean(value.phone, "Contact phone", 32);
  check(
    /^\+?[0-9 () .-]+$/.test(phone) &&
      phone.replace(/\D/g, "").length >= 10 &&
      phone.replace(/\D/g, "").length <= 15,
    "VALIDATION",
    "Supply a valid contact phone number.",
    400,
  );
  check(
    typeof value.line2 === "string" && value.line2.length <= 160,
    "VALIDATION",
    "Address line 2 must be text, optionally blank.",
    400,
  );
  return {
    name: clean(value.name, "Contact name"),
    line1: clean(value.line1, "Address line 1"),
    line2: value.line2.trim() ? clean(value.line2, "Address line 2") : "",
    city: clean(value.city, "City"),
    province,
    postalCode,
    country: value.country,
    phone,
  };
}
function parcel(value: CarrierParcel): CarrierParcel {
  check(
    value && typeof value === "object",
    "VALIDATION",
    "Supply a parcel.",
    400,
  );
  return {
    weightGrams: integer(value.weightGrams, "Weight grams", 1, 1_000_000),
    lengthMm: integer(value.lengthMm, "Length mm", 1, 100_000),
    widthMm: integer(value.widthMm, "Width mm", 1, 100_000),
    heightMm: integer(value.heightMm, "Height mm", 1, 100_000),
  };
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function exactFields(value: unknown, fields: string[]) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      Object.keys(value).every((key) => fields.includes(key)),
    "CARRIER_RESULT",
    "Carrier result has missing or unsupported fields.",
  );
}
export function validateCarrierLabel(label: {
  mediaType: string;
  bytes: Buffer;
}) {
  exactFields(label, ["mediaType", "bytes"]);
  check(
    label &&
      Buffer.isBuffer(label.bytes) &&
      label.bytes.length > 0 &&
      label.bytes.length <= 1_048_576,
    "CARRIER_RESULT",
    "Carrier label must contain at most 1 MiB of bytes.",
  );
  check(
    (label.mediaType === "application/pdf" &&
      label.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) ||
      (label.mediaType === "image/png" &&
        label.bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (label.mediaType === "image/gif" &&
        label.bytes.length >= 14 &&
        ["GIF87a", "GIF89a"].includes(
          label.bytes.subarray(0, 6).toString("ascii"),
        ) &&
        label.bytes.readUInt16LE(6) > 0 &&
        label.bytes.readUInt16LE(8) > 0 &&
        label.bytes.at(-1) === 0x3b),
    "CARRIER_RESULT",
    "Carrier label type and file signature must agree.",
  );
}
function validateManifestIdentity(
  value: CanadaPostManifestIdentity,
  input: CanadaPostManifestReview,
  configurationHash: string,
): CanadaPostManifestIdentity {
  exactFields(value, [
    "manifestId",
    "groupId",
    "reviewHash",
    "configurationHash",
    "customerReference",
    "shipmentIds",
  ]);
  const shipmentIds = input.entries.map((entry) => entry.shipmentId).sort();
  check(
    value.manifestId === input.manifestId &&
      value.groupId === input.groupId &&
      value.configurationHash === configurationHash &&
      typeof value.reviewHash === "string" &&
      /^[a-f0-9]{64}$/.test(value.reviewHash) &&
      value.customerReference ===
        "D" + value.reviewHash.slice(0, 11).toUpperCase() &&
      Array.isArray(value.shipmentIds) &&
      canonical(value.shipmentIds) === canonical(shipmentIds) &&
      new Set(shipmentIds).size === shipmentIds.length &&
      shipmentIds.every(
        (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(id),
      ),
    "CARRIER_RESULT",
    "Manifest identity must bind the exact configuration, native group and sorted created shipments.",
  );
  return immutable({ ...value, shipmentIds: [...value.shipmentIds] });
}
function validateManifestObservation(
  value: CanadaPostManifestObservation | null,
  identity: CanadaPostManifestIdentity,
): CanadaPostManifestObservation {
  exactFields(value, [
    "manifestId",
    "groupId",
    "reviewHash",
    "configurationHash",
    "customerReference",
    "shipmentIds",
    "poNumber",
    "manifestDate",
    "totalCents",
    "document",
  ]);
  check(
    value &&
      Object.entries(identity).every(
        ([key, expected]) =>
          canonical(value[key as keyof CanadaPostManifestIdentity]) ===
          canonical(expected),
      ) &&
      typeof value.poNumber === "string" &&
      /^[A-Za-z0-9]{1,10}$/.test(value.poNumber) &&
      typeof value.manifestDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.manifestDate) &&
      Number.isFinite(Date.parse(value.manifestDate)) &&
      new Date(value.manifestDate).toISOString().slice(0, 10) ===
        value.manifestDate &&
      Number.isSafeInteger(value.totalCents) &&
      value.totalCents >= 0 &&
      value.totalCents <= 100_000_000 &&
      value.document?.mediaType === "application/pdf",
    "CARRIER_RESULT",
    "Manifest observation must match its claimed identity, purchase order, bounded date/pricing and private PDF.",
  );
  validateCarrierLabel(value.document);
  return {
    ...value,
    shipmentIds: [...value.shipmentIds],
    document: {
      mediaType: "application/pdf",
      bytes: Buffer.from(value.document.bytes),
    },
  };
}
function validateCanadaPostCreation(
  result: CanadaPostShipmentObservation | null,
  group: CanadaPostGroup,
  member: CanadaPostMember,
): CanadaPostShipmentObservation {
  exactFields(result, [
    "bookingId",
    "reviewHash",
    "configurationHash",
    "groupId",
    "customerRequestId",
    "shipmentId",
    "tracking",
    "status",
    "label",
  ]);
  const customerRequestId =
    "D" +
    digest(
      canonical({
        configurationHash: group.configuration_hash,
        bookingId: member.booking_id,
        reviewHash: member.review_hash,
        groupId: group.provider_group_id,
      }),
    )
      .slice(0, 31)
      .toUpperCase();
  check(
    result &&
      result.bookingId === member.booking_id &&
      result.reviewHash === member.review_hash &&
      result.configurationHash === group.configuration_hash &&
      result.groupId === group.provider_group_id &&
      result.customerRequestId === customerRequestId &&
      typeof result.shipmentId === "string" &&
      /^[A-Za-z0-9_-]{1,32}$/.test(result.shipmentId) &&
      typeof result.tracking === "string" &&
      /^\d{11,16}$/.test(result.tracking) &&
      result.status === "created" &&
      result.label?.mediaType === "application/pdf",
    "CARRIER_RESULT",
    "Canada Post observation must match the exact created group member; unexpected transmission requires separate recovery.",
  );
  validateCarrierLabel(result.label);
  return {
    ...result,
    label: {
      mediaType: "application/pdf",
      bytes: Buffer.from(result.label.bytes),
    },
  };
}
function validateResult(
  result: CarrierResult | null,
  booking: Booking,
): CarrierResult {
  exactFields(result, [
    "bookingId",
    "reviewHash",
    "reference",
    "tracking",
    "label",
  ]);
  check(
    result &&
      typeof result === "object" &&
      result.bookingId === booking.id &&
      result.reviewHash === booking.review_hash,
    "CARRIER_RESULT",
    "Provider result must identify this exact reviewed booking.",
  );
  const reference = clean(result.reference, "Carrier booking reference", 200),
    tracking = clean(result.tracking, "Carrier tracking", 200);
  check(
    reference === result.reference &&
      tracking === result.tracking &&
      !/https?:\/\//i.test(reference + tracking),
    "CARRIER_RESULT",
    "Provider references must be canonical identifiers, not URLs.",
  );
  validateCarrierLabel(result.label);
  return {
    bookingId: result.bookingId,
    reviewHash: result.reviewHash,
    reference,
    tracking,
    label: {
      mediaType: result.label.mediaType,
      bytes: Buffer.from(result.label.bytes),
    },
  };
}
