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
import { Catalog } from "./catalog.ts";
import { Inventory } from "./inventory.ts";
import { Platform } from "./platform.ts";
type PurchaseOrder = {
  id: string;
  org_id: string;
  supplier_id: string;
  warehouse_id: string;
  state: string;
  created_at: string;
};
type PurchaseReceipt = {
  id: string;
  org_id: string;
  po_id: string;
  line_id: string;
  delivery_ref: string;
  quantity: number;
  unit_ids: string;
  created_at: string;
  warehouse_id: string;
  supplier_id: string;
};
type SupplierReturnResult = {
  id: string;
  unitId: string;
  warehouseId: string;
  productId: string;
  serial: string | null;
  quantity: number;
  unitCost: number;
  value: number;
  revision: number;
};
type SupplierReturn = {
  id: string;
  org_id: string;
  receipt_id: string;
  po_id: string;
  supplier_id: string;
  unit_id: string;
  warehouse_id: string;
  quantity: number;
  unit_cost: number;
  serial: string | null;
  return_ref: string;
  reason: string;
  handover_evidence: string;
  actor_id: string;
  created_at: string;
  input_hash: string;
  result: string;
};
export class Procurement {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private catalog: Catalog,
    private inventory: Inventory,
  ) {
    this.store = database.owned("procurement");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS procurement_suppliers(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(org_id,name)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_orders(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,supplier_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,po_id TEXT NOT NULL,product_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),received INTEGER NOT NULL DEFAULT 0,unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),CHECK(received>=0 AND received<=quantity),UNIQUE(po_id,product_id)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_receipts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,po_id TEXT NOT NULL,line_id TEXT NOT NULL,delivery_ref TEXT NOT NULL,quantity INTEGER NOT NULL,unit_ids TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,po_id,delivery_ref,line_id)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_returns(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,receipt_id TEXT NOT NULL,po_id TEXT NOT NULL,supplier_id TEXT NOT NULL,unit_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),serial TEXT,return_ref TEXT NOT NULL,reason TEXT NOT NULL,handover_evidence TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(org_id,return_ref)) STRICT;
  `);
  }
  suppliers(actor: Actor) {
    permit(actor, ["warehouse", "commercial", "finance"]);
    return this.store.all(
      "SELECT * FROM procurement_suppliers WHERE org_id=?",
      actor.orgId,
    );
  }
  supplier(actor: Actor, key: string, input: { name: string }) {
    return this.platform.command(
      actor,
      "supplier.create",
      key,
      input,
      () => permit(actor, ["commercial"]),
      () => {
        const supplierId = id();
        this.store.run(
          "INSERT INTO procurement_suppliers VALUES(?,?,?)",
          supplierId,
          actor.orgId,
          text(input.name, "supplier"),
        );
        return { id: supplierId };
      },
    );
  }
  create(
    actor: Actor,
    key: string,
    input: {
      supplierId: string;
      warehouseId: string;
      lines: { productId: string; quantity: number; unitCost: number }[];
    },
  ) {
    return this.platform.command(
      actor,
      "purchase.create",
      key,
      input,
      () => permit(actor, ["commercial"]),
      () => {
        check(
          this.store.get(
            "SELECT id FROM procurement_suppliers WHERE org_id=? AND id=?",
            actor.orgId,
            input.supplierId,
          ),
          "NOT_FOUND",
          "Supplier not found.",
          404,
        );
        this.inventory.warehouse(actor, input.warehouseId);
        check(
          Array.isArray(input.lines) &&
            input.lines.length > 0 &&
            input.lines.length <= 100,
          "VALIDATION",
          "Supply 1–100 purchase lines.",
          400,
        );
        const poId = id();
        this.store.run(
          "INSERT INTO procurement_orders(id,org_id,supplier_id,warehouse_id,created_at) VALUES(?,?,?,?,?)",
          poId,
          actor.orgId,
          input.supplierId,
          input.warehouseId,
          now(),
        );
        const seen = new Set();
        for (const line of input.lines) {
          check(
            !seen.has(line.productId),
            "VALIDATION",
            "Duplicate product line.",
            400,
          );
          seen.add(line.productId);
          this.catalog.product(actor, line.productId);
          this.store.run(
            "INSERT INTO procurement_lines(id,org_id,po_id,product_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)",
            id(),
            actor.orgId,
            poId,
            line.productId,
            integer(line.quantity, "quantity", 1, 100000),
            integer(line.unitCost, "unit cost", 0, 1e9),
          );
        }
        return { id: poId };
      },
    );
  }
  orders(actor: Actor) {
    permit(actor, ["warehouse", "commercial", "finance"]);
    return this.store
      .all<PurchaseOrder>(
        "SELECT * FROM procurement_orders WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (po) =>
          actor.role !== "warehouse" || actor.sites.includes(po.warehouse_id),
      )
      .map((po) => ({
        ...po,
        lines: this.store.all(
          "SELECT * FROM procurement_lines WHERE org_id=? AND po_id=?",
          actor.orgId,
          po.id,
        ),
      }));
  }
  receive(
    actor: Actor,
    key: string,
    input: {
      poId: string;
      lineId: string;
      deliveryRef: string;
      quantity: number;
      serials: string[];
      bin: string;
      quarantine: boolean;
    },
  ) {
    return this.platform.command(
      actor,
      "purchase.receive",
      key,
      input,
      () => {
        permit(actor, ["warehouse"]);
        const po = this.store.get(
          "SELECT * FROM procurement_orders WHERE org_id=? AND id=?",
          actor.orgId,
          input.poId,
        );
        check(po, "NOT_FOUND", "Purchase order not found.", 404);
        site(actor, String(po.warehouse_id));
      },
      () => {
        const po = this.store.get(
          "SELECT * FROM procurement_orders WHERE org_id=? AND id=?",
          actor.orgId,
          input.poId,
        )!;
        const line = this.store.get(
          "SELECT * FROM procurement_lines WHERE org_id=? AND po_id=? AND id=?",
          actor.orgId,
          input.poId,
          input.lineId,
        );
        check(line, "NOT_FOUND", "Purchase line not found.", 404);
        const qty = integer(input.quantity, "quantity", 1, 100000),
          delivery = text(input.deliveryRef, "delivery reference");
        check(
          !this.store.get(
            "SELECT id FROM procurement_receipts WHERE org_id=? AND po_id=? AND delivery_ref=? AND line_id=?",
            actor.orgId,
            input.poId,
            delivery,
            input.lineId,
          ),
          "DUPLICATE_DELIVERY",
          "This delivery line was already received.",
        );
        check(
          po.state === "open" &&
            Number(line.received) + qty <= Number(line.quantity),
          "QUANTITY",
          "Receipt exceeds the remaining purchase quantity.",
        );
        const receiptId = id(),
          units = this.inventory.receive(
            actor,
            {
              productId: String(line.product_id),
              warehouseId: String(po.warehouse_id),
              bin: input.bin,
              quantity: qty,
              unitCost: Number(line.unit_cost),
              serials: input.serials,
              quarantine: input.quarantine,
            },
            receiptId,
          );
        this.store.run(
          "INSERT INTO procurement_receipts VALUES(?,?,?,?,?,?,?,?)",
          receiptId,
          actor.orgId,
          input.poId,
          input.lineId,
          delivery,
          qty,
          JSON.stringify(units),
          now(),
        );
        this.store.run(
          "UPDATE procurement_lines SET received=received+? WHERE id=?",
          qty,
          input.lineId,
        );
        if (
          !this.store.get(
            "SELECT id FROM procurement_lines WHERE po_id=? AND received<quantity",
            input.poId,
          )
        )
          this.store.run(
            "UPDATE procurement_orders SET state='received' WHERE id=?",
            input.poId,
          );
        return { id: receiptId, unitIds: units };
      },
    );
  }
  receipts(actor: Actor) {
    permit(actor, ["warehouse", "commercial", "finance"]);
    const stock = this.inventory
      .stock(actor)
      .filter((u) => u.state === "stock" && u.quantity > u.reserved);
    const candidates = stock.map((u) => ({
      ...u,
      receiptId: this.inventory.purchaseOrigin(actor, u.id),
    }));
    return this.store
      .all<PurchaseReceipt>(
        "SELECT r.*,p.warehouse_id,p.supplier_id FROM procurement_receipts r JOIN procurement_orders p ON p.org_id=r.org_id AND p.id=r.po_id WHERE r.org_id=? ORDER BY r.created_at DESC,r.id",
        actor.orgId,
      )
      .filter(
        (r) =>
          actor.role !== "warehouse" ||
          actor.sites.includes(r.warehouse_id) ||
          candidates.some((u) => u.receiptId === r.id),
      )
      .map(({ unit_ids, ...r }) => ({
        ...r,
        candidates: candidates.filter((u) => u.receiptId === r.id),
        returnedQuantity: Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM procurement_returns WHERE org_id=? AND receipt_id=?",
            actor.orgId,
            r.id,
          )!.qty,
        ),
      }));
  }
  returns(actor: Actor) {
    permit(actor, ["warehouse", "commercial", "finance"]);
    return this.store
      .all<SupplierReturn>(
        "SELECT * FROM procurement_returns WHERE org_id=? ORDER BY created_at DESC,id",
        actor.orgId,
      )
      .filter(
        (r) =>
          actor.role !== "warehouse" || actor.sites.includes(r.warehouse_id),
      )
      .map(({ input_hash, result, ...r }) => ({
        ...r,
        result: JSON.parse(result) as SupplierReturnResult,
      }));
  }
  returnStock(
    actor: Actor,
    key: string,
    input: {
      receiptId: string;
      unitId: string;
      revision: number;
      quantity: number;
      serial: string | null;
      returnRef: string;
      reason: string;
      handoverEvidence: string;
    },
  ) {
    return this.platform.command(
      actor,
      "purchase.return",
      key,
      input,
      () => {
        permit(actor, []);
        check(
          this.store.get(
            "SELECT id FROM procurement_receipts WHERE org_id=? AND id=?",
            actor.orgId,
            input.receiptId,
          ),
          "NOT_FOUND",
          "Purchase receipt not found.",
          404,
        );
      },
      () => {
        const payload = {
          ...input,
          revision: integer(input.revision, "stock revision", 1),
          quantity: integer(input.quantity, "return quantity", 1, 100000),
          returnRef: text(input.returnRef, "supplier return reference"),
          reason: text(input.reason, "reason", 1000),
          handoverEvidence: text(
            input.handoverEvidence,
            "handover evidence",
            1000,
          ),
          serial: input.serial === null ? null : text(input.serial, "serial"),
        };
        const hash = digest(canonical(payload));
        const old = this.store.get(
          "SELECT * FROM procurement_returns WHERE org_id=? AND return_ref=?",
          actor.orgId,
          payload.returnRef,
        );
        if (old) {
          check(
            old.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Supplier return reference was already used with different details.",
          );
          return JSON.parse(String(old.result)) as SupplierReturnResult;
        }
        const receipt = this.store.get(
          "SELECT r.*,p.supplier_id FROM procurement_receipts r JOIN procurement_orders p ON p.org_id=r.org_id AND p.id=r.po_id WHERE r.org_id=? AND r.id=?",
          actor.orgId,
          input.receiptId,
        )!;
        const returned = Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM procurement_returns WHERE org_id=? AND receipt_id=?",
            actor.orgId,
            input.receiptId,
          )!.qty,
        );
        check(
          returned + payload.quantity <= Number(receipt.quantity),
          "QUANTITY",
          "Return exceeds the original purchased quantity still eligible for supplier return.",
        );
        const returnId = id(),
          result = {
            id: returnId,
            ...this.inventory.returnToSupplier(actor, payload, returnId),
          };
        this.store.run(
          "INSERT INTO procurement_returns VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          returnId,
          actor.orgId,
          input.receiptId,
          String(receipt.po_id),
          String(receipt.supplier_id),
          input.unitId,
          result.warehouseId,
          result.quantity,
          result.unitCost,
          result.serial,
          payload.returnRef,
          payload.reason,
          payload.handoverEvidence,
          actor.id,
          now(),
          hash,
          JSON.stringify(result),
        );
        this.platform.event(actor, "SupplierStockReturned", returnId, {
          receiptId: input.receiptId,
          quantity: result.quantity,
          value: result.value,
        });
        return result;
      },
    );
  }
}
