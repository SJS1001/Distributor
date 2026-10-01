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
import type {
  CanadaPostShipmentObservation,
  CanadaPostManifestReview,
  CanadaPostManifestObservation,
} from "./canada-post-test.ts";
import { CANADA_POST_INITIALIZE_DDL } from "./canada-post-schema.ts";
import {
  carrierNames,
  type CarrierAddress,
  type CarrierBookingView,
  type CarrierName,
  type CarrierParcel,
  type CarrierPrepare,
  type CarrierReview,
  type CanadaPostGroupView,
  type CanadaPostManifestIdentity,
} from "../shared/carrier-booking.ts";

export type CarrierIntent = CarrierPrepare & {
  bookingId: string;
  reviewHash: string;
  nativeSnapshot: Shipment;
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
  private shipment(actor: Actor, shipmentId: string) {
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
        intent.shipmentId === booking.shipment_id &&
        intent.nativeSnapshot.id === booking.shipment_id,
      "CARRIER_MISMATCH",
      "Carrier intent integrity check failed.",
    );
    return intent;
  }
  private view(booking: Booking): CarrierBookingView {
    const intent = this.intent(booking);
    return {
      id: booking.id,
      shipmentId: booking.shipment_id,
      provider: intent.provider,
      state: booking.state,
      reviewHash: booking.review_hash,
      service: intent.service,
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
    this.shipment(actor, shipmentId);
    const booking = this.latest(actor.orgId, shipmentId);
    return { shipmentId, booking: booking ? this.view(booking) : null };
  }
  providerForBooking(actor: Actor, bookingId: string): CarrierName {
    actor = this.principal(actor);
    return this.intent(this.booking(actor, bookingId)).provider;
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
                shipmentId: this.booking(actor, member.booking_id).shipment_id,
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
  private ready(actor: Actor, shipment: Shipment, provider: CarrierName) {
    this.platform.assertProviderAccess();
    check(
      shipment.state === "packed" && shipment.mode === "carrier",
      "STATE",
      "Carrier booking requires a packed carrier shipment.",
    );
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
  ): { id: string; reviewHash: string } {
    return this.platform.command(
      actor,
      "carrier.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.shipment(actor, input.shipmentId);
      },
      () => {
        const shipment = this.shipment(actor, input.shipmentId);
        check(
          carrierNames.includes(input.provider),
          "VALIDATION",
          "Choose a named carrier.",
          400,
        );
        this.ready(actor, shipment, input.provider);
        check(
          input.reviewedDestination === shipment.address,
          "CARRIER_MISMATCH",
          "Review the exact packed shipment destination.",
        );
        const previous = this.latest(actor.orgId, shipment.id);
        check(
          (previous?.id ?? null) === input.previousId &&
            (!previous || previous.state === "canceled"),
          "CARRIER_BOOKING_ACTIVE",
          "Review the current booking; only canceled unsent bookings may be replaced.",
        );
        const review = {
          shipmentId: shipment.id,
          previousId: input.previousId,
          provider: input.provider,
          service: clean(input.service, "Carrier service", 100),
          origin: address(input.origin),
          destination: address(input.destination),
          parcel: parcel(input.parcel),
          reviewedDestination: shipment.address,
          acknowledgment: clean(
            input.acknowledgment,
            "Origin and destination acknowledgment",
            1000,
          ),
          nativeSnapshot: shipment,
        };
        const bookingId = id(),
          reviewHash = digest(canonical(review));
        const intent: CarrierIntent = { ...review, bookingId, reviewHash };
        this.store.run(
          "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,created_at) VALUES(?,?,?,'pending',?,?,?)",
          bookingId,
          actor.orgId,
          shipment.id,
          reviewHash,
          canonical(intent),
          now(),
        );
        this.platform.event(actor, "carrier.booking.prepared", bookingId, {
          shipmentId: shipment.id,
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
          shipmentId: booking.shipment_id,
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
            shipmentId: booking.shipment_id,
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
