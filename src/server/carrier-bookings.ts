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
import { CANADA_POST_INITIALIZE_DDL } from "./canada-post-schema.ts";
import {
  carrierNames,
  type CarrierAddress,
  type CarrierBookingView,
  type CarrierName,
  type CarrierParcel,
  type CarrierPrepare,
  type CarrierReview,
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
export type CanadaPostGroupView = {
  id: string;
  warehouseId: string;
  configurationHash: string;
  providerGroupId: string;
  reviewHash: string;
  state: string;
  entries: { bookingId: string; reviewHash: string; state: string }[];
  createdAt: string;
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
