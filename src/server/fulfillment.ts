import type { FulfillmentSalesEvidence } from "./sales-evidence.ts";
import {
  account,
  check,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import type { SQLInputValue } from "node:sqlite";
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import { Orders } from "./orders.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import { SHIPMENT_COVERAGE_INITIALIZE_DDL } from "./shipment-coverage-schema.ts";
import { coverageDate, coverageDays } from "./coverage-policy.ts";
import type { ShipmentCoverageSnapshot } from "../shared/warranty-coverage.ts";
export type Shipment = {
  id: string;
  org_id: string;
  order_id: string;
  account_id: string;
  warehouse_id: string;
  state: string;
  mode: string;
  address: string;
  tracking: string | null;
  carrier: string | null;
  lines: string;
  units: string;
  invoice_id: string | null;
  created_at: string;
  shipped_at: string | null;
};
type DeliveryState =
  "in_transit" | "delayed" | "lost" | "returned" | "delivered";
type DeliveryObservation = {
  id: string;
  org_id: string;
  shipment_id: string;
  revision: number;
  state: DeliveryState;
  reference: string;
  reference_key: string;
  evidence: string;
  observed_at: string;
  actor_id: string;
  created_at: string;
  source: string;
};
type PackedLine = { allocationId: string; quantity: number };
type ShipmentView = Shipment & {
  delivery_revision: number | null;
  delivery_state: string | null;
  delivery_observed_at: string | null;
};
type ShortPick = {
  id: string;
  org_id: string;
  order_id: string;
  allocation_id: string;
  held_unit_id: string;
  quantity: number;
  reason: string;
  actor_id: string;
  created_at: string;
};
export class Fulfillment {
  private store: Store;
  private carrierGuard?: (
    actor: Actor,
    shipment: Shipment,
    action: "commit" | "void",
    binding?: { carrier?: string; tracking?: string },
  ) => void;
  configureCarrierGuard(guard: NonNullable<Fulfillment["carrierGuard"]>) {
    this.carrierGuard = guard;
  }
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private orders: Orders,
    private billing: Billing,
  ) {
    this.store = database.owned("fulfillment");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS fulfillment_shipments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('packed','shipped','void')),mode TEXT NOT NULL CHECK(mode IN('carrier','collection')),address TEXT NOT NULL,tracking TEXT,carrier TEXT,lines TEXT NOT NULL,units TEXT NOT NULL DEFAULT '[]',invoice_id TEXT,created_at TEXT NOT NULL,shipped_at TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS fulfillment_delivery(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,reference TEXT NOT NULL,delivered_at TEXT NOT NULL,actor_id TEXT NOT NULL,UNIQUE(org_id,shipment_id)) STRICT;
    CREATE TABLE IF NOT EXISTS fulfillment_delivery_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),state TEXT NOT NULL CHECK(state IN('in_transit','delayed','lost','returned','delivered')),reference TEXT NOT NULL,reference_key TEXT NOT NULL,evidence TEXT NOT NULL,observed_at TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN('operator','legacy')),UNIQUE(org_id,shipment_id,revision),UNIQUE(org_id,shipment_id,reference_key)) STRICT;
    CREATE TABLE IF NOT EXISTS fulfillment_short_picks(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,allocation_id TEXT NOT NULL,held_unit_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS fulfillment_short_pick_history ON fulfillment_short_picks(org_id,order_id,created_at,id);
    CREATE INDEX IF NOT EXISTS fulfillment_shipment_history ON fulfillment_shipments(org_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS fulfillment_shipment_account_history ON fulfillment_shipments(org_id,account_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS fulfillment_shipment_site_history ON fulfillment_shipments(org_id,warehouse_id,created_at DESC,id DESC);
    ${SHIPMENT_COVERAGE_INITIALIZE_DDL};
  `);
    // Keep the compatibility receipt, importing its recorded fact only once.
    for (const legacy of this.store.all<{
      id: string;
      org_id: string;
      shipment_id: string;
      reference: string;
      delivered_at: string;
      actor_id: string;
    }>(
      "SELECT d.* FROM fulfillment_delivery d WHERE NOT EXISTS(SELECT 1 FROM fulfillment_delivery_history h WHERE h.org_id=d.org_id AND h.shipment_id=d.shipment_id)",
    ))
      this.store.run(
        "INSERT OR IGNORE INTO fulfillment_delivery_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        legacy.id,
        legacy.org_id,
        legacy.shipment_id,
        1,
        "delivered",
        legacy.reference,
        legacy.reference.trim().normalize("NFKC").toLowerCase(),
        "Imported legacy delivery reference",
        legacy.delivered_at,
        legacy.actor_id,
        now(),
        "legacy",
      );
  }
  // Internal sales controls; never project addresses, tracking or serials to the report.
  salesEvidence(actor: Actor): FulfillmentSalesEvidence {
    permit(actor, ["finance"]);
    return this.store.all(
      `SELECT id,order_id AS "order",account_id AS account,warehouse_id AS warehouse,
       state,invoice_id AS invoice,lines,units
       FROM fulfillment_shipments WHERE org_id=? ORDER BY rowid`,
      actor.orgId,
    );
  }
  shipment(actor: Actor, shipmentId: string): Shipment {
    const row = this.store.get<Shipment>(
      "SELECT * FROM fulfillment_shipments WHERE org_id=? AND id=?",
      actor.orgId,
      shipmentId,
    );
    check(row, "NOT_FOUND", "Shipment not found.", 404);
    account(actor, row.account_id);
    if (actor.role === "warehouse") site(actor, row.warehouse_id);
    return row;
  }
  // Packing owns the quantities; order descriptions and serials are read through
  // their owning operations. No prices or inferred customs values are returned.
  packedGoods(actor: Actor, shipmentId: string) {
    actor = this.shipmentReader(actor);
    permit(actor, ["warehouse"]);
    const shipment = this.shipment(actor, shipmentId);
    site(actor, shipment.warehouse_id);
    const allocations = this.inventory.allocations(actor, shipment.order_id),
      descriptions = this.orders.lines(actor, shipment.order_id);
    return (JSON.parse(shipment.lines) as PackedLine[]).map((line) => {
      const allocation = allocations.find((a) => a.id === line.allocationId);
      check(
        allocation,
        "CARRIER_MISMATCH",
        "Packed allocation is unavailable.",
      );
      const description = descriptions.find(
        (entry) => entry.product_id === allocation.product_id,
      );
      check(
        description,
        "CARRIER_MISMATCH",
        "Packed order description is unavailable.",
      );
      return {
        allocationId: line.allocationId,
        quantity: line.quantity,
        description: description.description,
        serial: this.inventory.unit(actor, allocation.unit_id).serial,
      };
    });
  }
  shipments(actor: Actor) {
    return this.shipmentRows(this.shipmentReader(actor)).map((s) =>
      this.shipmentView(s),
    );
  }
  shipmentPage(actor: Actor, after?: string) {
    actor = this.shipmentReader(actor);
    const scope = this.shipmentScope(actor);
    const cursor =
      after === undefined
        ? undefined
        : this.store.get<Shipment>(
            `SELECT s.* FROM fulfillment_shipments s WHERE ${scope.where} AND s.id=?`,
            ...scope.params,
            text(after, "Shipment cursor", 128),
          );
    check(
      after === undefined || cursor,
      "CURSOR",
      "Shipment cursor is unavailable in your current scope.",
      400,
    );
    const rows = this.shipmentRows(actor, cursor, 21);
    const items = rows.slice(0, 20).map((s) => this.shipmentView(s));
    return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
  }
  private shipmentReader(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing shipments.",
      403,
    );
    return actor;
  }
  private shipmentScope(actor: Actor) {
    const params: SQLInputValue[] = [actor.orgId];
    let where = "s.org_id=?";
    if (actor.role === "buyer") {
      where += " AND s.account_id=?";
      params.push(actor.accountId);
    }
    if (actor.role === "warehouse") {
      where += actor.sites.length
        ? ` AND s.warehouse_id IN(${actor.sites.map(() => "?").join(",")})`
        : " AND 0";
      params.push(...actor.sites);
    }
    return { where, params };
  }
  private shipmentRows(actor: Actor, cursor?: Shipment, limit?: number) {
    const scope = this.shipmentScope(actor);
    if (cursor) {
      scope.where += " AND (s.created_at<? OR (s.created_at=? AND s.id<?))";
      scope.params.push(cursor.created_at, cursor.created_at, cursor.id);
    }
    // The unique revision index selects at most one history row per shipment.
    return this.store.all<ShipmentView>(
      `SELECT s.*,h.revision AS delivery_revision,h.state AS delivery_state,h.observed_at AS delivery_observed_at FROM fulfillment_shipments s LEFT JOIN fulfillment_delivery_history h ON s.state='shipped' AND h.org_id=s.org_id AND h.shipment_id=s.id AND h.revision=(SELECT MAX(latest.revision) FROM fulfillment_delivery_history latest WHERE latest.org_id=s.org_id AND latest.shipment_id=s.id) WHERE ${scope.where} ORDER BY s.created_at DESC,s.id DESC${limit === undefined ? "" : " LIMIT ?"}`,
      ...scope.params,
      ...(limit === undefined ? [] : [limit]),
    );
  }
  private shipmentView(s: ShipmentView) {
    const { delivery_revision, delivery_state, delivery_observed_at, ...row } =
      s;
    return {
      ...row,
      lines: JSON.parse(s.lines),
      units: JSON.parse(s.units),
      delivery:
        s.state === "shipped"
          ? {
              revision: delivery_revision ?? 0,
              state:
                delivery_state ??
                (s.mode === "carrier" ? "handed_over" : "collected"),
              observedAt: delivery_observed_at ?? s.shipped_at,
            }
          : null,
    };
  }
  picks(actor: Actor, orderId: string) {
    permit(actor, ["warehouse", "commercial"]);
    this.orders.order(actor, orderId);
    const packed = this.packedQuantities(actor, orderId);
    return this.inventory.allocations(actor, orderId).map((a) => ({
      ...a,
      serial: this.inventory.unit(actor, a.unit_id).serial,
      bin: this.inventory.unit(actor, a.unit_id).bin,
      unitRevision: this.inventory.unit(actor, a.unit_id).revision,
      packed: packed.get(a.id) ?? 0,
      packable:
        a.stage === "picked"
          ? Math.max(
              0,
              a.quantity - a.consumed - a.released - (packed.get(a.id) ?? 0),
            )
          : 0,
    }));
  }
  shortPicks(actor: Actor, orderId: string, after?: string) {
    const current = this.identity.currentActor(actor);
    permit(current, ["warehouse", "commercial", "support"]);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reading shortages.",
      403,
    );
    this.orders.order(current, orderId);
    const cursor =
      after === undefined
        ? undefined
        : this.store.get<ShortPick>(
            "SELECT * FROM fulfillment_short_picks WHERE org_id=? AND order_id=? AND id=?",
            current.orgId,
            orderId,
            text(after, "Short-pick cursor", 128),
          );
    check(
      after === undefined || cursor,
      "CURSOR",
      "Short-pick cursor does not belong to this order.",
      400,
    );
    const rows = this.store.all<ShortPick>(
      "SELECT * FROM fulfillment_short_picks WHERE org_id=? AND order_id=? AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 21",
      current.orgId,
      orderId,
      cursor?.created_at ?? null,
      cursor?.created_at ?? null,
      cursor?.created_at ?? null,
      cursor?.id ?? null,
    );
    const items = rows.slice(0, 20);
    return { items, nextCursor: rows.length > 20 ? items.at(-1)!.id : null };
  }
  shortPick(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      revision: number;
      allocationId: string;
      unitRevision: number;
      quantity: number;
      reason: string;
    },
  ) {
    let current: Actor;
    return this.platform.command(
      actor,
      "fulfillment.short-pick",
      key,
      input,
      () => {
        current = this.identity.currentActor(actor);
        permit(current, ["warehouse"]);
        check(
          !this.identity.security(current).passwordChangeRequired,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before reporting a shortage.",
          403,
        );
        site(current, this.orders.order(current, input.orderId).warehouse_id);
      },
      () => {
        const quantity = integer(input.quantity, "short quantity", 1, 100000),
          reason = text(input.reason, "short-pick evidence", 1000),
          a = this.inventory
            .allocations(current, input.orderId)
            .find((a) => a.id === input.allocationId);
        check(a, "NOT_FOUND", "Allocation not found on this order.", 404);
        check(
          quantity <=
            a.quantity -
              a.consumed -
              a.released -
              (this.packedQuantities(current, input.orderId).get(a.id) ?? 0),
          "PACKED",
          "Short quantity overlaps packed or already supplied stock. Void conflicting packing first.",
        );
        const reportId = id(),
          result = this.orders.shortPick(
            current,
            { ...input, quantity, reason },
            reportId,
          );
        this.store.run(
          "INSERT INTO fulfillment_short_picks VALUES(?,?,?,?,?,?,?,?,?)",
          reportId,
          current.orgId,
          input.orderId,
          a.id,
          result.heldUnitId,
          quantity,
          reason,
          current.id,
          now(),
        );
        this.platform.event(current, "fulfillment.short-pick", reportId, {
          orderId: input.orderId,
          allocationId: a.id,
          ...result,
        });
        return { id: reportId, ...result };
      },
    );
  }
  private packedQuantities(actor: Actor, orderId: string) {
    const quantities = new Map<string, number>();
    for (const shipment of this.store.all<Shipment>(
      "SELECT * FROM fulfillment_shipments WHERE org_id=? AND order_id=? AND state='packed'",
      actor.orgId,
      orderId,
    ))
      for (const line of JSON.parse(shipment.lines) as PackedLine[])
        quantities.set(
          line.allocationId,
          (quantities.get(line.allocationId) ?? 0) + line.quantity,
        );
    return quantities;
  }
  pick(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      allocationId: string;
      serial: string | null;
      unpick?: boolean;
    },
  ) {
    return this.platform.command(
      actor,
      "fulfillment.pick",
      key,
      input,
      () => {
        actor = this.identity.currentActor(actor);
        check(
          !this.identity.security(actor).passwordChangeRequired,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before picking stock.",
          403,
        );
        permit(actor, ["warehouse"]);
        const o = this.orders.order(actor, input.orderId);
        site(actor, o.warehouse_id);
        check(
          this.inventory
            .allocations(actor, o.id)
            .some((a) => a.id === input.allocationId),
          "NOT_FOUND",
          "Allocation not found.",
          404,
        );
      },
      () => {
        check(
          input.unpick === undefined || typeof input.unpick === "boolean",
          "VALIDATION",
          "unpick must be a boolean.",
          400,
        );
        if (input.unpick)
          check(
            !this.packedQuantities(actor, input.orderId).get(
              input.allocationId,
            ),
            "PACKED",
            "Void active packing before unpicking this allocation.",
          );
        else if (
          this.inventory
            .allocations(actor, input.orderId)
            .find((a) => a.id === input.allocationId)?.stage === "reserved"
        )
          this.orders.assertReservationCurrent(actor, input.orderId);
        const a = input.unpick
          ? this.inventory.unpick(actor, input.allocationId)
          : this.inventory.pick(actor, input.allocationId, input.serial);
        return { id: a.id, stage: input.unpick ? "reserved" : "picked" };
      },
    );
  }
  pack(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      revision: number;
      mode: "carrier" | "collection";
      address: string;
      lines: { allocationId: string; quantity: number }[];
    },
  ) {
    return this.platform.command(
      actor,
      "fulfillment.pack",
      key,
      input,
      () => {
        permit(actor, ["warehouse"]);
        site(actor, this.orders.order(actor, input.orderId).warehouse_id);
      },
      () => {
        const order = this.orders.order(actor, input.orderId);
        check(
          order.revision === input.revision && order.state === "open",
          "STATE",
          "Order changed or is closed.",
        );
        check(
          ["carrier", "collection"].includes(input.mode),
          "VALIDATION",
          "Unknown shipping mode.",
          400,
        );
        text(input.address, "delivery/collection destination", 2000);
        check(
          Array.isArray(input.lines) &&
            input.lines.length > 0 &&
            input.lines.length <= 100,
          "VALIDATION",
          "Supply 1–100 shipment lines.",
          400,
        );
        const allocations = this.inventory.allocations(actor, order.id),
          packed = this.packedQuantities(actor, order.id),
          seen = new Set();
        for (const l of input.lines) {
          check(
            !seen.has(l.allocationId),
            "VALIDATION",
            "Duplicate allocation.",
            400,
          );
          seen.add(l.allocationId);
          const a = allocations.find((a) => a.id === l.allocationId);
          check(
            a &&
              a.stage === "picked" &&
              integer(l.quantity, "quantity", 1, 100000) <=
                a.quantity - a.consumed - a.released - (packed.get(a.id) ?? 0),
            "QUANTITY",
            "Pack requires picked stock not already in another active shipment. Refresh available quantities.",
          );
        }
        const shipmentId = id();
        this.store.run(
          "INSERT INTO fulfillment_shipments(id,org_id,order_id,account_id,warehouse_id,state,mode,address,lines,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          shipmentId,
          actor.orgId,
          order.id,
          order.account_id,
          order.warehouse_id,
          "packed",
          input.mode,
          input.address,
          JSON.stringify(input.lines),
          now(),
        );
        return { id: shipmentId };
      },
    );
  }
  commit(
    actor: Actor,
    key: string,
    input: {
      shipmentId: string;
      carrier?: string;
      tracking?: string;
      handoverEvidence: string;
    },
  ) {
    return this.platform.command(
      actor,
      "fulfillment.ship",
      key,
      input,
      () => {
        actor = this.identity.currentActor(actor);
        permit(actor, ["warehouse"]);
        check(
          !this.identity.security(actor).passwordChangeRequired,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before handover.",
          403,
        );
        site(actor, this.shipment(actor, input.shipmentId).warehouse_id);
      },
      () => {
        const shipment = this.shipment(actor, input.shipmentId);
        check(
          shipment.state === "packed",
          "STATE",
          "Shipment is already committed or void.",
        );
        check(
          !this.identity.customer(actor, shipment.account_id).held,
          "CREDIT_HOLD",
          "Account is on hold; shipment requires finance clearance.",
        );
        text(input.handoverEvidence, "handover/collection evidence", 1000);
        if (shipment.mode === "carrier") {
          text(input.carrier, "carrier");
          text(input.tracking, "tracking/reference");
        }
        this.carrierGuard?.(actor, shipment, "commit", input);
        // Same native command transaction as stock, invoice and custody. Policy
        // changes serialize with handover; retries retain the original snapshot.
        const policy = this.identity.shipmentCoveragePolicy(
          actor,
          shipment.warehouse_id,
        );
        const shippedAt = coverageDate(now());
        const coverageEnd = new Date(
          Date.parse(shippedAt) + policy.days * 86400000,
        );
        check(
          Number.isFinite(coverageEnd.getTime()),
          "COVERAGE_DATE",
          "Calculated coverage end is outside the supported date range.",
        );
        const packed = this.packedQuantities(actor, shipment.order_id);
        for (const a of this.inventory.allocations(actor, shipment.order_id))
          check(
            (packed.get(a.id) ?? 0) <= a.quantity - a.consumed - a.released,
            "PACKING_CONFLICT",
            "Active shipments overlap remaining stock. Void conflicting packing before handover.",
          );
        const units = this.inventory.ship(
            actor,
            shipment.order_id,
            JSON.parse(shipment.lines),
            shipment.id,
          ),
          quantities = new Map<string, number>();
        for (const u of units)
          quantities.set(
            u.productId,
            (quantities.get(u.productId) ?? 0) + u.quantity,
          );
        const lines = this.orders.completeShipment(
            actor,
            shipment.order_id,
            quantities,
          ),
          invoice = this.billing.issue(
            actor,
            shipment.account_id,
            shipment.order_id,
            shipment.id,
            lines,
          );
        this.store.run(
          "UPDATE fulfillment_shipments SET state='shipped',tracking=?,carrier=?,units=?,invoice_id=?,shipped_at=? WHERE id=?",
          input.tracking ?? null,
          input.carrier ?? null,
          JSON.stringify(units),
          invoice.id,
          shippedAt,
          shipment.id,
        );
        const snapshot: ShipmentCoverageSnapshot = {
          policy,
          shippedAt,
          coverageEnd: coverageEnd.toISOString(),
        };
        this.store.run(
          "INSERT INTO fulfillment_coverage VALUES(?,?,?)",
          shipment.id,
          actor.orgId,
          JSON.stringify(snapshot),
        );
        this.platform.audit(actor, "fulfillment.handover", shipment.id, {
          evidence: input.handoverEvidence,
        });
        this.platform.event(actor, "fulfillment.shipped", shipment.id, {
          orderId: shipment.order_id,
          invoiceId: invoice.id,
          units,
        });
        return { id: shipment.id, invoiceId: invoice.id };
      },
    );
  }
  void(
    actor: Actor,
    key: string,
    input: { shipmentId: string; reason: string },
  ) {
    return this.platform.command(
      actor,
      "fulfillment.void",
      key,
      input,
      () => {
        actor = this.identity.currentActor(actor);
        check(
          !this.identity.security(actor).passwordChangeRequired,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before voiding packing.",
          403,
        );
        permit(actor, ["warehouse"]);
        site(actor, this.shipment(actor, input.shipmentId).warehouse_id);
      },
      () => {
        const s = this.shipment(actor, input.shipmentId);
        check(
          s.state === "packed",
          "STATE",
          "Committed shipments cannot be voided.",
        );
        this.carrierGuard?.(actor, s, "void");
        text(input.reason, "void reason", 1000);
        this.store.run(
          "UPDATE fulfillment_shipments SET state='void' WHERE id=?",
          s.id,
        );
        this.platform.audit(actor, "fulfillment.void.reason", s.id, {
          reason: input.reason,
        });
        return { id: s.id };
      },
    );
  }
  private latestDelivery(orgId: string, shipmentId: string) {
    return this.store.get<DeliveryObservation>(
      "SELECT * FROM fulfillment_delivery_history WHERE org_id=? AND shipment_id=? ORDER BY revision DESC LIMIT 1",
      orgId,
      shipmentId,
    );
  }
  private deliveryAuthority(actor: Actor, shipmentId: string, write = false) {
    actor = this.identity.currentActor(actor);
    permit(
      actor,
      write
        ? ["warehouse", "commercial"]
        : [
            "warehouse",
            "commercial",
            "finance",
            "warranty",
            "support",
            "buyer",
          ],
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing delivery.",
      403,
    );
    const shipment = this.shipment(actor, shipmentId);
    if (write) site(actor, shipment.warehouse_id);
    return { actor, shipment };
  }
  deliveryHistory(actor: Actor, shipmentId: string, after?: number) {
    const authorized = this.deliveryAuthority(actor, shipmentId);
    actor = authorized.actor;
    check(
      authorized.shipment.state === "shipped",
      "STATE",
      "Only committed shipments have delivery history.",
    );
    const last = this.latestDelivery(actor.orgId, shipmentId);
    const cursor =
      after === undefined
        ? 0
        : integer(after, "delivery cursor", 1, last?.revision ?? 0);
    const rows = this.store.all<DeliveryObservation>(
      "SELECT * FROM fulfillment_delivery_history WHERE org_id=? AND shipment_id=? AND revision>? ORDER BY revision LIMIT 21",
      actor.orgId,
      shipmentId,
      cursor,
    );
    const items = rows.slice(0, 20).map((h) => ({
      revision: h.revision,
      state: h.state,
      observedAt: h.observed_at,
      createdAt: h.created_at,
      source: h.source,
      ...(actor.role === "buyer"
        ? {}
        : {
            reference: h.reference,
            evidence: h.evidence,
            actorId: h.actor_id,
          }),
    }));
    return { items, next: rows.length > 20 ? items.at(-1)!.revision : null };
  }
  updateDelivery(
    actor: Actor,
    key: string,
    input: {
      shipmentId: string;
      revision: number;
      state: DeliveryState;
      reference: string;
      evidence: string;
      observedAt: string;
    },
  ) {
    let current: Actor, shipment: Shipment;
    return this.platform.command(
      actor,
      "fulfillment.delivery.update",
      key,
      input,
      () => {
        ({ actor: current, shipment } = this.deliveryAuthority(
          actor,
          input.shipmentId,
          true,
        ));
      },
      () => {
        check(
          shipment.mode === "carrier",
          "MODE",
          "Carrier outcomes require a carrier shipment.",
        );
        return this.recordDelivery(current, shipment, input);
      },
    );
  }
  private recordDelivery(
    actor: Actor,
    shipment: Shipment,
    input: {
      revision: number;
      state: DeliveryState;
      reference: string;
      evidence: string;
      observedAt: string;
    },
  ) {
    check(
      shipment.state === "shipped",
      "STATE",
      "Only committed shipments can have delivery observations.",
    );
    const last = this.latestDelivery(actor.orgId, shipment.id);
    check(
      integer(input.revision, "delivery revision", 0, 999999998) ===
        (last?.revision ?? 0),
      "STALE_DELIVERY",
      "Shipment delivery changed; refresh and review the current observation.",
    );
    check(
      !last || !["delivered", "returned"].includes(last.state),
      "STATE",
      "Delivered or returned shipment observations are terminal; use a separately approved remedy.",
    );
    check(
      ["in_transit", "delayed", "lost", "returned", "delivered"].includes(
        input.state,
      ),
      "VALIDATION",
      "Select a supported delivery outcome.",
      400,
    );
    const reference = text(input.reference, "delivery evidence reference", 160),
      evidence = text(input.evidence, "delivery evidence", 2000),
      observedAt = text(input.observedAt, "observed time", 24);
    const date = new Date(observedAt);
    check(
      Number.isFinite(date.getTime()) &&
        date.toISOString() === observedAt &&
        observedAt >= (last?.observed_at ?? shipment.shipped_at!) &&
        observedAt <= now(),
      "VALIDATION",
      "Observed time must be an ISO UTC time after handover and the previous observation, and not in the future.",
      400,
    );
    const referenceKey = reference.normalize("NFKC").toLowerCase();
    check(
      !this.store.get(
        "SELECT id FROM fulfillment_delivery_history WHERE org_id=? AND shipment_id=? AND reference_key=?",
        actor.orgId,
        shipment.id,
        referenceKey,
      ),
      "DELIVERY_REFERENCE",
      "Delivery reference is already recorded; review the original observation.",
    );
    const observationId = id(),
      revision = input.revision + 1;
    this.store.run(
      "INSERT INTO fulfillment_delivery_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      observationId,
      actor.orgId,
      shipment.id,
      revision,
      input.state,
      reference,
      referenceKey,
      evidence,
      observedAt,
      actor.id,
      now(),
      "operator",
    );
    if (input.state === "delivered")
      this.store.run(
        "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
        observationId,
        actor.orgId,
        shipment.id,
        reference,
        observedAt,
        actor.id,
      );
    this.platform.event(actor, "fulfillment.delivery.observed", shipment.id, {
      revision,
      state: input.state,
      observedAt,
    });
    return { id: shipment.id, revision, state: input.state };
  }
  confirmDelivery(
    actor: Actor,
    key: string,
    input: { shipmentId: string; reference: string; deliveredAt: string },
  ) {
    let current: Actor, shipment: Shipment;
    return this.platform.command(
      actor,
      "fulfillment.delivery",
      key,
      input,
      () => {
        ({ actor: current, shipment } = this.deliveryAuthority(
          actor,
          input.shipmentId,
          true,
        ));
      },
      () => {
        const timestamp = Date.parse(input.deliveredAt);
        check(
          Number.isFinite(timestamp),
          "VALIDATION",
          "Delivery time must be a valid timestamp.",
          400,
        );
        const result = this.recordDelivery(current, shipment, {
          revision:
            this.latestDelivery(current.orgId, shipment.id)?.revision ?? 0,
          state: "delivered",
          reference: input.reference,
          evidence: input.reference,
          observedAt: new Date(timestamp).toISOString(),
        });
        return { id: result.id };
      },
    );
  }
  // Resolve a named custody receipt without walking the shipment collection.
  shipmentCoverage(
    actor: Actor,
    shipmentId: string,
  ): ShipmentCoverageSnapshot | null {
    actor = this.shipmentReader(actor);
    permit(actor, ["warehouse", "commercial", "warranty", "buyer"]);
    const shipment = this.shipment(actor, shipmentId);
    check(
      shipment.state === "shipped",
      "STATE",
      "Coverage requires a committed shipment.",
    );
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM fulfillment_coverage WHERE org_id=? AND shipment_id=?",
      actor.orgId,
      shipment.id,
    );
    if (!row) return null;
    const saved = JSON.parse(row.snapshot) as ShipmentCoverageSnapshot;
    check(
      saved &&
        typeof saved === "object" &&
        !Array.isArray(saved) &&
        saved.policy &&
        typeof saved.policy === "object" &&
        !Array.isArray(saved.policy),
      "COVERAGE_POLICY",
      "Retained shipment coverage is invalid.",
    );
    const policy = saved.policy;
    integer(policy.revision, "retained shipment policy revision", 1);
    coverageDays(policy.days);
    check(
      policy.revision === 1
        ? policy.configuredAt === null
        : typeof policy.configuredAt === "string",
      "COVERAGE_POLICY",
      "Retained shipment policy version is invalid.",
    );
    if (policy.configuredAt !== null) coverageDate(policy.configuredAt);
    const shippedAt = coverageDate(saved.shippedAt),
      coverageEnd = coverageDate(saved.coverageEnd);
    check(
      shippedAt === shipment.shipped_at &&
        Date.parse(shippedAt) + policy.days * 86400000 ===
          Date.parse(coverageEnd),
      "COVERAGE_POLICY",
      "Retained shipment coverage and custody dates differ.",
    );
    return {
      policy: {
        revision: policy.revision,
        days: policy.days,
        configuredAt: policy.configuredAt,
      },
      shippedAt,
      coverageEnd,
    };
  }
  soldSerial(actor: Actor, shipmentId: string, unitId: string) {
    actor = this.shipmentReader(actor);
    const shipment = this.store.get<Shipment>(
      `SELECT * FROM fulfillment_shipments WHERE org_id=? AND id=? AND state='shipped'
       ${actor.role === "buyer" ? "AND account_id=?" : ""}`,
      actor.orgId,
      shipmentId,
      ...(actor.role === "buyer" ? [actor.accountId!] : []),
    );
    if (!shipment) return null;
    const unit = (
      JSON.parse(shipment.units) as {
        unitId: string;
        productId: string;
        serial: string | null;
      }[]
    ).find((u) => u.unitId === unitId && u.serial);
    return unit ? { shipment, unit } : null;
  }
  soldUnit(
    actor: Actor,
    unitId: string,
    accountId: string,
    shipmentId?: string,
  ) {
    actor = this.shipmentReader(actor);
    this.identity.customer(actor, accountId);
    const reference =
      shipmentId ?? this.inventory.shipmentReference(actor, unitId);
    const sale =
      reference === null ? null : this.soldSerial(actor, reference, unitId);
    check(
      sale && sale.shipment.account_id === accountId,
      "NOT_FOUND",
      "No serialized sale for this account.",
      404,
    );
    return sale;
  }
}
