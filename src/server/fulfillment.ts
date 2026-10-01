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
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import { Orders } from "./orders.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
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
type PackedLine = { allocationId: string; quantity: number };
export class Fulfillment {
  private store: Store;
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
  `);
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
  shipments(actor: Actor) {
    return this.store
      .all<Shipment>(
        "SELECT * FROM fulfillment_shipments WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (s) =>
          (actor.role !== "buyer" || s.account_id === actor.accountId) &&
          (actor.role !== "warehouse" || actor.sites.includes(s.warehouse_id)),
      )
      .map((s) => ({
        ...s,
        lines: JSON.parse(s.lines),
        units: JSON.parse(s.units),
      }));
  }
  picks(actor: Actor, orderId: string) {
    permit(actor, ["warehouse", "commercial"]);
    this.orders.order(actor, orderId);
    const packed = this.packedQuantities(actor, orderId);
    return this.inventory.allocations(actor, orderId).map((a) => ({
      ...a,
      serial: this.inventory.unit(actor, a.unit_id).serial,
      bin: this.inventory.unit(actor, a.unit_id).bin,
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
        permit(actor, ["warehouse"]);
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
          now(),
          shipment.id,
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
  confirmDelivery(
    actor: Actor,
    key: string,
    input: { shipmentId: string; reference: string; deliveredAt: string },
  ) {
    return this.platform.command(
      actor,
      "fulfillment.delivery",
      key,
      input,
      () => {
        permit(actor, ["warehouse", "commercial"]);
        this.shipment(actor, input.shipmentId);
      },
      () => {
        const s = this.shipment(actor, input.shipmentId);
        check(
          s.state === "shipped",
          "STATE",
          "Only committed shipments can be delivered.",
        );
        const timestamp = Date.parse(input.deliveredAt);
        check(
          Number.isFinite(timestamp) &&
            timestamp <= Date.now() &&
            timestamp >= Date.parse(s.shipped_at!),
          "VALIDATION",
          "Delivery time must follow shipment and not be in the future.",
          400,
        );
        this.store.run(
          "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
          id(),
          actor.orgId,
          s.id,
          text(input.reference, "proof of delivery"),
          new Date(timestamp).toISOString(),
          actor.id,
        );
        return { id: s.id };
      },
    );
  }
  soldUnit(actor: Actor, unitId: string, accountId: string) {
    this.identity.customer(actor, accountId);
    const rows = this.store.all<Shipment>(
      "SELECT * FROM fulfillment_shipments WHERE org_id=? AND state='shipped' ORDER BY shipped_at DESC,rowid DESC",
      actor.orgId,
    );
    for (const s of rows) {
      const u = (
        JSON.parse(s.units) as {
          unitId: string;
          productId: string;
          serial: string | null;
        }[]
      ).find((u) => u.unitId === unitId && u.serial);
      if (u) {
        check(
          s.account_id === accountId,
          "NOT_FOUND",
          "No current serialized sale for this account.",
          404,
        );
        return { shipment: s, unit: u };
      }
    }
    check(false, "NOT_FOUND", "No serialized sale for this account.", 404);
  }
}
