import type { SQLInputValue } from "node:sqlite";
import type { SerialReceipt } from "../shared/serial-dossier.ts";
import type {
  SupplierChoice,
  SupplierPage,
} from "../shared/supplier-search.ts";
import {
  purchaseQueueStates,
  type PurchaseQueueState,
} from "../shared/purchase-queue.ts";
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
  type Role,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Catalog } from "./catalog.ts";
import { Inventory } from "./inventory.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import { SupplierFollowups } from "./supplier-followups.ts";
import {
  ReceiptDrafts,
  type DraftInput,
  type ReceiptInput,
} from "./receipt-drafts.ts";
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
  product_id: string;
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
  readonly drafts: ReceiptDrafts;
  readonly followups: SupplierFollowups;
  constructor(
    private database: Database,
    private platform: Platform,
    private catalog: Catalog,
    private inventory: Inventory,
    private identity: Identity,
  ) {
    this.store = database.owned("procurement");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS procurement_suppliers(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(org_id,name)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_orders(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,supplier_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,po_id TEXT NOT NULL,product_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),received INTEGER NOT NULL DEFAULT 0,unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),CHECK(received>=0 AND received<=quantity),UNIQUE(po_id,product_id)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_receipts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,po_id TEXT NOT NULL,line_id TEXT NOT NULL,delivery_ref TEXT NOT NULL,quantity INTEGER NOT NULL,unit_ids TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,po_id,delivery_ref,line_id)) STRICT;
    CREATE TABLE IF NOT EXISTS procurement_returns(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,receipt_id TEXT NOT NULL,po_id TEXT NOT NULL,supplier_id TEXT NOT NULL,unit_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),serial TEXT,return_ref TEXT NOT NULL,reason TEXT NOT NULL,handover_evidence TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(org_id,return_ref)) STRICT;
  `);
    this.followups = new SupplierFollowups(database, platform, identity);
    this.drafts = new ReceiptDrafts(database, platform, {
      currentActor: (actor) =>
        this.authorize(actor, ["warehouse", "commercial", "finance"]),
      authorize: (actor, poId) => {
        this.receiptOrder(actor, poId);
      },
      context: (actor, input, ready) => this.draftContext(actor, input, ready),
      receive: (actor, input) => this.receiveStock(actor, input),
    });
  }
  private authorize(actor: Actor, roles: Role[]) {
    const current = this.identity.currentActor(actor);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing purchasing.",
      403,
    );
    permit(current, roles);
    return current;
  }
  serialReceipt(actor: Actor, unitId: string): SerialReceipt | null {
    actor = this.authorize(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
    ]);
    const unit = this.inventory.unit(actor, unitId);
    check(unit.serial, "VALIDATION", "Receipt lineage requires a serial.", 400);
    if (actor.role === "warehouse") site(actor, unit.warehouse_id);
    const reference = this.inventory.serialReceiptReference(actor, unitId);
    if (reference === null) return null;
    const row = this.store.get<SerialReceipt & { unitIds: string }>(
      `SELECT r.id,r.po_id AS purchaseOrderId,p.warehouse_id AS warehouseId,p.supplier_id AS supplierId,
       r.delivery_ref AS deliveryReference,r.created_at AS receivedAt,r.unit_ids AS unitIds
       FROM procurement_receipts r JOIN procurement_orders p ON p.org_id=r.org_id AND p.id=r.po_id
       WHERE r.org_id=? AND r.id=?
       ${actor.role === "warehouse" ? `AND p.warehouse_id IN (${actor.sites.map(() => "?").join(",")})` : ""}
       `,
      actor.orgId,
      reference,
      ...(actor.role === "warehouse" ? actor.sites : []),
    );
    if (!row) return null;
    check(
      (JSON.parse(row.unitIds) as string[]).includes(unitId),
      "SERIAL_LINEAGE",
      "Serial and original purchase receipt differ.",
      409,
    );
    const { unitIds: _, ...receipt } = row;
    return receipt;
  }
  private receiptOrder(actor: Actor, poId: string) {
    permit(actor, ["warehouse"]);
    const po = this.store.get<PurchaseOrder>(
      "SELECT * FROM procurement_orders WHERE org_id=? AND id=?",
      actor.orgId,
      text(poId, "purchase order ID"),
    );
    check(po, "NOT_FOUND", "Purchase order not found.", 404);
    site(actor, po.warehouse_id);
    return po;
  }
  private draftContext(actor: Actor, input: DraftInput, ready: boolean) {
    const po = this.receiptOrder(actor, input.poId);
    const line = this.store.get(
      "SELECT * FROM procurement_lines WHERE org_id=? AND po_id=? AND id=?",
      actor.orgId,
      po.id,
      text(input.lineId, "purchase line ID"),
    );
    check(line, "NOT_FOUND", "Purchase line not found.", 404);
    const product = this.catalog.product(actor, String(line.product_id));
    check(
      text(input.observedSku, "observed SKU") === product.sku,
      "SKU",
      "Observed SKU must match the selected purchase line.",
    );
    const quantity = integer(
      input.quantity,
      "draft quantity",
      1,
      product.serialized ? 500 : 100000,
    );
    check(
      quantity <= Number(line.quantity) - Number(line.received),
      "OVER_RECEIPT",
      "Draft exceeds the purchase line's current remaining quantity.",
    );
    check(
      typeof input.quarantine === "boolean",
      "VALIDATION",
      "quarantine must be a boolean.",
      400,
    );
    text(input.bin, "bin");
    const deliveryRef = text(input.deliveryRef, "delivery reference");
    check(
      !this.store.get(
        "SELECT id FROM procurement_receipts WHERE org_id=? AND po_id=? AND line_id=? AND delivery_ref=?",
        actor.orgId,
        po.id,
        input.lineId,
        deliveryRef,
      ),
      "DELIVERY_RECEIVED",
      "This purchase line and delivery reference was already received.",
    );
    check(
      Array.isArray(input.serials) && input.serials.length <= 500,
      "VALIDATION",
      "Supply at most 500 serial scans.",
      400,
    );
    const serials = input.serials.map((s) => text(s, "serial"));
    check(
      product.serialized
        ? serials.length <= quantity &&
            new Set(serials).size === serials.length &&
            (!ready || serials.length === quantity)
        : serials.length === 0,
      "SERIAL",
      ready
        ? "Scan exactly one unique serial per serialized unit before receiving."
        : "Serials must be unique and within the draft quantity; bulk lines have no serials.",
    );
    this.inventory.assertNewSerials(actor, serials);
    return { warehouseId: po.warehouse_id };
  }
  suppliers(actor: Actor) {
    return this.supplierPage(actor).items;
  }
  supplierChoice(actor: Actor, supplierId: string): SupplierChoice {
    actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
    const row = this.store.get<SupplierChoice>(
      "SELECT id,name FROM procurement_suppliers WHERE org_id=? AND id=?",
      actor.orgId,
      text(supplierId, "Supplier ID", 128),
    );
    check(row, "NOT_FOUND", "Supplier not found.", 404);
    return row;
  }
  supplierPage(
    actor: Actor,
    input: { q?: string; after?: string } = {},
  ): SupplierPage {
    return this.database.transaction(() => {
      actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
      check(
        input.q === undefined ||
          (typeof input.q === "string" && input.q.length <= 120),
        "VALIDATION",
        "Supplier search must contain at most 120 characters.",
        400,
      );
      const q = (input.q ?? "")
        .trim()
        .replace(/[A-Z]/g, (c) => c.toLowerCase());
      let anchor: SupplierChoice | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Supplier cursor", 1024);
        let cursor: unknown;
        try {
          const decoded = Buffer.from(encoded, "base64url");
          check(
            decoded.toString("base64url") === encoded,
            "VALIDATION",
            "Invalid supplier cursor.",
            400,
          );
          cursor = JSON.parse(decoded.toString("utf8"));
        } catch {
          check(false, "VALIDATION", "Invalid supplier cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 4 &&
            cursor[0] === 1 &&
            cursor[1] === actor.orgId &&
            cursor[2] === q &&
            typeof cursor[3] === "string" &&
            cursor[3].length > 0 &&
            cursor[3].length <= 128,
          "VALIDATION",
          "Supplier cursor does not match this organization and search.",
          400,
        );
        anchor = this.supplierChoice(actor, cursor[3]);
        check(
          !q ||
            anchor.name.replace(/[A-Z]/g, (c) => c.toLowerCase()).includes(q),
          "CURSOR",
          "Supplier cursor is no longer part of this search.",
          400,
        );
      }
      const rows = this.store.all<SupplierChoice>(
        `SELECT id,name FROM procurement_suppliers WHERE org_id=? AND (?='' OR instr(lower(name),?)>0)
         ${anchor ? "AND (name>? OR (name=? AND id>?))" : ""} ORDER BY name,id LIMIT 21`,
        actor.orgId,
        q,
        q,
        ...(anchor ? [anchor.name, anchor.name, anchor.id] : []),
      );
      const items = rows.slice(0, 20);
      return {
        items,
        next:
          rows.length > 20
            ? Buffer.from(
                JSON.stringify([1, actor.orgId, q, items[19]!.id]),
              ).toString("base64url")
            : null,
      };
    });
  }
  supplier(actor: Actor, key: string, input: { name: string }) {
    return this.platform.command(
      actor,
      "supplier.create",
      key,
      input,
      () => {
        actor = this.authorize(actor, ["commercial"]);
      },
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
      () => {
        actor = this.authorize(actor, ["commercial"]);
      },
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
  private orderScope(actor: Actor) {
    const params: SQLInputValue[] = [actor.orgId];
    let where = "org_id=?";
    if (actor.role === "warehouse") {
      where += actor.sites.length
        ? ` AND warehouse_id IN(${actor.sites.map(() => "?").join(",")})`
        : " AND 0";
      params.push(...actor.sites);
    }
    return { where, params };
  }
  private orderRecord(actor: Actor, orderId: string) {
    const scope = this.orderScope(actor);
    const row = this.store.get<PurchaseOrder>(
      `SELECT * FROM procurement_orders WHERE ${scope.where} AND id=?`,
      ...scope.params,
      text(orderId, "Purchase order ID", 128),
    );
    check(
      row,
      "NOT_FOUND",
      "Purchase order is unavailable in your current scope.",
      404,
    );
    return row;
  }
  private orderView(actor: Actor, row: PurchaseOrder) {
    return {
      ...row,
      lines: this.store.all(
        "SELECT * FROM procurement_lines WHERE org_id=? AND po_id=? ORDER BY id",
        actor.orgId,
        row.id,
      ),
    };
  }
  order(actor: Actor, orderId: string) {
    return this.database.transaction(() => {
      actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
      return this.orderView(actor, this.orderRecord(actor, orderId));
    });
  }
  // Full projection retained for owning-module controls and local fixtures.
  // HTTP/operator queues use orderPage and explicit off-page order detail.
  orders(actor: Actor) {
    actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
    const scope = this.orderScope(actor);
    return this.store
      .all<PurchaseOrder>(
        `SELECT * FROM procurement_orders WHERE ${scope.where} ORDER BY created_at DESC,id DESC`,
        ...scope.params,
      )
      .map((row) => this.orderView(actor, row));
  }
  orderPage(
    actor: Actor,
    input: { after?: string; state?: PurchaseQueueState } = {},
  ) {
    return this.database.transaction(() => {
      actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
      const state = input.state ?? null;
      check(
        state === null || purchaseQueueStates.includes(state),
        "VALIDATION",
        "Choose a supported purchase order state.",
        400,
      );
      const scope = this.orderScope(actor);
      let anchor: PurchaseOrder | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Purchase cursor", 512);
        let cursor: unknown;
        try {
          const decoded = Buffer.from(encoded, "base64url");
          check(
            decoded.toString("base64url") === encoded,
            "VALIDATION",
            "Invalid purchase cursor.",
            400,
          );
          cursor = JSON.parse(decoded.toString("utf8"));
        } catch {
          check(false, "VALIDATION", "Invalid purchase cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 3 &&
            cursor[0] === 1 &&
            cursor[1] === state &&
            typeof cursor[2] === "string" &&
            cursor[2].length > 0 &&
            cursor[2].length <= 128,
          "VALIDATION",
          "Purchase cursor does not match this queue.",
          400,
        );
        // Reauthorize the anchor before filtering; completing it does not invalidate traversal.
        anchor = this.orderRecord(actor, cursor[2]);
      }
      if (state !== null) {
        scope.where += " AND state=?";
        scope.params.push(state);
      }
      if (anchor) {
        scope.where += " AND (created_at<? OR (created_at=? AND id<?))";
        scope.params.push(anchor.created_at, anchor.created_at, anchor.id);
      }
      const rows = this.store.all<PurchaseOrder>(
        `SELECT * FROM procurement_orders WHERE ${scope.where} ORDER BY created_at DESC,id DESC LIMIT 21`,
        ...scope.params,
      );
      const items = rows.slice(0, 20).map((row) => this.orderView(actor, row));
      return {
        items,
        next:
          rows.length > 20
            ? Buffer.from(JSON.stringify([1, state, items[19]!.id])).toString(
                "base64url",
              )
            : null,
      };
    });
  }
  receive(actor: Actor, key: string, input: ReceiptInput) {
    return this.platform.command(
      actor,
      "purchase.receive",
      key,
      input,
      () => {
        actor = this.authorize(actor, ["warehouse"]);
        this.receiptOrder(actor, input.poId);
      },
      () => this.receiveStock(actor, input),
    );
  }
  private receiveStock(actor: Actor, input: ReceiptInput) {
    this.receiptOrder(actor, input.poId);
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
  }
  receipts(actor: Actor) {
    actor = this.authorize(actor, ["warehouse", "commercial", "finance"]);
    const stock = this.inventory
      .stock(actor)
      .filter((u) => u.state === "stock" && u.quantity > u.reserved);
    const candidates = stock.map((u) => ({
      ...u,
      receiptId: this.inventory.purchaseOrigin(actor, u.id),
    }));
    return this.store
      .all<PurchaseReceipt>(
        "SELECT r.*,p.warehouse_id,p.supplier_id,l.product_id FROM procurement_receipts r JOIN procurement_orders p ON p.org_id=r.org_id AND p.id=r.po_id JOIN procurement_lines l ON l.org_id=r.org_id AND l.po_id=r.po_id AND l.id=r.line_id WHERE r.org_id=? ORDER BY r.created_at DESC,r.id",
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
    actor = this.followups.authorize(actor);
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
        followup: this.followups.summary(actor, r.id),
      }));
  }
  returnPage(actor: Actor, input: { after?: string; q?: string } = {}) {
    return this.database.transaction(() => {
      actor = this.followups.authorize(actor);
      check(
        input.q === undefined ||
          (typeof input.q === "string" && input.q.length <= 160),
        "VALIDATION",
        "Supplier return search must contain at most 160 characters.",
        400,
      );
      const q = (input.q ?? "")
        .trim()
        .replace(/[A-Z]/g, (c) => c.toLowerCase());
      const scope = this.orderScope(actor);
      let anchor: SupplierReturn | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Supplier return cursor", 512);
        let cursor: unknown;
        try {
          const decoded = Buffer.from(encoded, "base64url");
          check(
            decoded.toString("base64url") === encoded,
            "VALIDATION",
            "Invalid supplier return cursor.",
            400,
          );
          cursor = JSON.parse(decoded.toString("utf8"));
        } catch {
          check(false, "VALIDATION", "Invalid supplier return cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 3 &&
            cursor[0] === 1 &&
            cursor[1] === q &&
            typeof cursor[2] === "string" &&
            cursor[2].length > 0 &&
            cursor[2].length <= 128,
          "VALIDATION",
          "Supplier return cursor does not match this search.",
          400,
        );
        anchor = this.store.get<SupplierReturn>(
          `SELECT * FROM procurement_returns WHERE ${scope.where} AND id=?`,
          ...scope.params,
          cursor[2],
        );
        check(
          anchor,
          "NOT_FOUND",
          "Supplier return is unavailable in your current scope.",
          404,
        );
      }
      if (q) {
        scope.where +=
          " AND (instr(lower(return_ref),?)>0 OR instr(lower(COALESCE(serial,'')),?)>0 OR instr(lower(reason),?)>0)";
        scope.params.push(q, q, q);
      }
      if (anchor) {
        scope.where += " AND (created_at<? OR (created_at=? AND id<?))";
        scope.params.push(anchor.created_at, anchor.created_at, anchor.id);
      }
      const rows = this.store.all<SupplierReturn>(
        `SELECT * FROM procurement_returns WHERE ${scope.where} ORDER BY created_at DESC,id DESC LIMIT 21`,
        ...scope.params,
      );
      const items = rows.slice(0, 20).map(({ input_hash, result, ...r }) => ({
        ...r,
        result: JSON.parse(result) as SupplierReturnResult,
        followup: this.followups.summary(actor, r.id),
      }));
      return {
        items,
        next:
          rows.length > 20
            ? Buffer.from(JSON.stringify([1, q, items[19]!.id])).toString(
                "base64url",
              )
            : null,
      };
    });
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
        actor = this.authorize(actor, []);
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
