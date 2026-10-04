import { InventoryQuantityCorrections } from "./inventory-quantity-corrections.ts";
import { InventoryValuations } from "./inventory-valuations.ts";
import {
  countQueueStates,
  type CountQueueInput,
} from "../shared/count-queue.ts";
import {
  transferQueueStates,
  type TransferQueueInput,
} from "../shared/transfer-queue.ts";
import type { InventorySalesEvidence } from "./sales-evidence.ts";
import {
  stockQueueViews,
  type StockQueueInput,
} from "../shared/stock-queue.ts";
import type { SQLInputValue } from "node:sqlite";
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
import { Platform } from "./platform.ts";
import { stockControls } from "./inventory-controls.ts";
import { InventoryCosts } from "./inventory-costs.ts";
import { Identity } from "./iam.ts";
import type { CountReviewPolicy } from "./count-policy.ts";
import type {
  StockHistoryInput,
  StockHistoryPage,
  StockMovement,
} from "../shared/stock-history.ts";
export type Unit = {
  id: string;
  org_id: string;
  product_id: string;
  warehouse_id: string;
  bin: string;
  serial: string | null;
  quantity: number;
  cost: number;
  condition: string;
  state: string;
  revision: number;
};
export type Allocation = {
  id: string;
  unit_id: string;
  order_id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  consumed: number;
  released: number;
  stage: string;
};
export type OpeningRow = {
  sourceId: string;
  productId: string;
  warehouseId: string;
  bin: string;
  serial: string | null;
  quantity: number;
  unitCost: number;
  condition: "usable" | "quarantine" | "damaged";
};
type Transfer = {
  id: string;
  org_id: string;
  source_id: string;
  destination_id: string;
  state: "transit" | "received";
  created_at: string;
};
type TransferManifest = {
  line_id: string;
  org_id: string;
  transfer_id: string;
  unit_id: string;
  product_id: string;
  serial: string | null;
  quantity: number;
  unit_cost: number;
  received: number;
};
type TransferLoss = {
  id: string;
  org_id: string;
  transfer_id: string;
  line_id: string;
  quantity: number;
  unit_cost: number;
};
type Count = {
  id: string;
  org_id: string;
  unit_id: string;
  warehouse_id: string;
  product_id: string;
  bin: string;
  condition: string;
  stock_revision: number;
  expected_quantity: number;
  unit_cost: number;
  count_ref: string;
  state: "draft" | "submitted" | "approved" | "rejected";
  observed_quantity: number | null;
  observation_reason: string | null;
  observed_by: string | null;
  observed_at: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_by: string;
  created_at: string;
  start_hash: string;
  decision_result: string | null;
};
type SerialReview = {
  id: string;
  org_id: string;
  unit_id: string;
  warehouse_id: string;
  product_id: string;
  serial: string;
  bin: string;
  stock_revision: number;
  unit_cost: number;
  review_ref: string;
  reason: string;
  observed_by: string;
  created_at: string;
  input_hash: string;
  state: "submitted" | "approved" | "rejected" | "recovered";
  decision: "approve" | "reject" | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_result: string | null;
  recovery_ref: string | null;
  recovery_reason: string | null;
  recovery_bin: string | null;
  recovered_by: string | null;
  recovered_at: string | null;
  recovery_hash: string | null;
  recovery_result: string | null;
};
export class Inventory {
  private store: Store;
  readonly costs: InventoryCosts;
  readonly valuations: InventoryValuations;
  readonly quantityCorrections: InventoryQuantityCorrections;
  constructor(
    private database: Database,
    private platform: Platform,
    private catalog: Catalog,
    private identity: Identity,
    startupMaintenance = true,
  ) {
    this.store = database.owned("inventory");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS inventory_warehouses(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(org_id,name)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_units(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,bin TEXT NOT NULL,serial TEXT,quantity INTEGER NOT NULL CHECK(quantity>=0),cost INTEGER NOT NULL CHECK(cost>=0),condition TEXT NOT NULL CHECK(condition IN('usable','quarantine','damaged')),state TEXT NOT NULL CHECK(state IN('stock','transit','sold','scrapped')),revision INTEGER NOT NULL DEFAULT 1,UNIQUE(org_id,serial)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_allocations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,unit_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),consumed INTEGER NOT NULL DEFAULT 0,released INTEGER NOT NULL DEFAULT 0,stage TEXT NOT NULL DEFAULT 'reserved' CHECK(stage IN('reserved','picked')),CHECK(consumed>=0 AND released>=0 AND consumed+released<=quantity)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_replacements(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('reserved','cancelled','handed_over'))) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_short_picks(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,allocation_id TEXT NOT NULL,source_unit_id TEXT NOT NULL,held_unit_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_replacement_reserved ON inventory_replacements(org_id,unit_id) WHERE state='reserved';
      CREATE TABLE IF NOT EXISTS inventory_movements(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,type TEXT NOT NULL,quantity INTEGER NOT NULL,unit_cost INTEGER NOT NULL,reference TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_cost_sequences(sequence INTEGER PRIMARY KEY,org_id TEXT NOT NULL,movement_id TEXT NOT NULL UNIQUE) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_cost_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_sequence INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS inventory_cost_sequence_org ON inventory_cost_sequences(org_id,sequence);
      CREATE TABLE IF NOT EXISTS inventory_transfers(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,source_id TEXT NOT NULL,destination_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('transit','received')),created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,transfer_id TEXT NOT NULL,unit_id TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,UNIQUE(transfer_id,unit_id)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_origins(line_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,source_unit_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_manifest(line_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,transfer_id TEXT NOT NULL,unit_id TEXT NOT NULL,product_id TEXT NOT NULL,serial TEXT,quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_receipts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,transfer_id TEXT NOT NULL,line_id TEXT NOT NULL,unit_id TEXT NOT NULL,receipt_ref TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),condition TEXT NOT NULL CHECK(condition IN('usable','quarantine','damaged')),bin TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(org_id,line_id,receipt_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_losses(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,transfer_id TEXT NOT NULL,line_id TEXT NOT NULL,loss_ref TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(org_id,line_id,loss_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_transfer_recoveries(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,loss_id TEXT NOT NULL,unit_id TEXT NOT NULL,receipt_ref TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),condition TEXT NOT NULL CHECK(condition IN('usable','quarantine','damaged')),bin TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(org_id,loss_id,receipt_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_serial_reviews(
        id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,
        product_id TEXT NOT NULL,serial TEXT NOT NULL,bin TEXT NOT NULL,stock_revision INTEGER NOT NULL,
        unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),review_ref TEXT NOT NULL,reason TEXT NOT NULL,
        observed_by TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN('submitted','approved','rejected','recovered')),
        decision TEXT CHECK(decision IN('approve','reject')),decision_reason TEXT,decided_by TEXT,decided_at TEXT,decision_result TEXT,
        recovery_ref TEXT,recovery_reason TEXT,recovery_bin TEXT,recovered_by TEXT,recovered_at TEXT,recovery_hash TEXT,recovery_result TEXT,
        UNIQUE(org_id,review_ref)) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_serial_review_pending ON inventory_serial_reviews(org_id,unit_id) WHERE state='submitted';
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_serial_review_missing ON inventory_serial_reviews(org_id,unit_id) WHERE state='approved';
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_serial_recovery_reference ON inventory_serial_reviews(org_id,recovery_ref) WHERE recovery_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS inventory_serial_review_history ON inventory_serial_reviews(org_id,created_at,id);
      CREATE TABLE IF NOT EXISTS inventory_counts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,product_id TEXT NOT NULL,bin TEXT NOT NULL,condition TEXT NOT NULL,stock_revision INTEGER NOT NULL,expected_quantity INTEGER NOT NULL,unit_cost INTEGER NOT NULL,count_ref TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('draft','submitted','approved','rejected')),observed_quantity INTEGER CHECK(observed_quantity>=0),observation_reason TEXT,observed_by TEXT,observed_at TEXT,decision_reason TEXT,decided_by TEXT,decided_at TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,start_hash TEXT NOT NULL,decision_result TEXT,UNIQUE(org_id,count_ref)) STRICT;
      ${
        startupMaintenance
          ? `INSERT OR IGNORE INTO inventory_transfer_manifest
        SELECT l.id,l.org_id,l.transfer_id,l.unit_id,u.product_id,u.serial,-m.quantity,m.unit_cost
        FROM inventory_transfer_lines l JOIN inventory_units u ON u.id=l.unit_id AND u.org_id=l.org_id
        JOIN inventory_movements m ON m.org_id=l.org_id AND m.unit_id=l.unit_id AND m.reference=l.transfer_id AND m.type='transfer.dispatch' AND m.quantity<0;`
          : ""
      }
    `);
    database.transaction(() => {
      if (
        startupMaintenance &&
        !this.store.get("SELECT id FROM inventory_cost_clock WHERE id=1")
      ) {
        this.store.run(
          "INSERT INTO inventory_cost_sequences(org_id,movement_id) SELECT org_id,id FROM inventory_movements ORDER BY rowid",
        );
        this.store.run(
          "INSERT INTO inventory_cost_clock VALUES(1,(SELECT COALESCE(MAX(sequence),0) FROM inventory_cost_sequences))",
        );
      }
    });
    this.valuations = new InventoryValuations(
      database,
      this.store,
      platform,
      identity,
      (actor, unit, type, quantity, reference, reason) =>
        this.movement(actor, unit, type, quantity, reference, reason),
      (actor) => {
        this.costs.window(actor, 0);
      },
    );
    this.quantityCorrections = new InventoryQuantityCorrections(
      database,
      this.store,
      platform,
      identity,
      this.valuations,
      (actor, input, reference) =>
        this.applyCount(actor, input, reference, "quantity.correction"),
      (actor) => {
        this.costs.window(actor, 0);
      },
    );
    this.costs = new InventoryCosts(
      this.store,
      this.valuations,
      this.quantityCorrections,
    );
  }
  warehouses(actor: Actor) {
    actor = this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ]);
    return this.store
      .all(
        "SELECT * FROM inventory_warehouses WHERE org_id=? ORDER BY name",
        actor.orgId,
      )
      .filter(
        (row) =>
          actor.role === "admin" ||
          actor.sites.includes(String(row.id)) ||
          actor.role === "buyer" ||
          actor.role === "commercial",
      );
  }
  warehouse(actor: Actor, warehouseId: string) {
    actor = this.custodyReader(actor);
    return this.configurationWarehouse(actor.orgId, warehouseId);
  }
  // Trusted startup validation; no invented user principal or provider I/O.
  configurationWarehouse(orgId: string, warehouseId: string) {
    const row = this.store.get(
      "SELECT * FROM inventory_warehouses WHERE org_id=? AND id=?",
      orgId,
      warehouseId,
    );
    check(row, "NOT_FOUND", "Warehouse not found.", 404);
    return row;
  }
  transferDestinations(actor: Actor) {
    actor = this.custodyActor(actor, ["warehouse", "support"]);
    return this.store.all<{ id: string; name: string }>(
      "SELECT id,name FROM inventory_warehouses WHERE org_id=? ORDER BY name",
      actor.orgId,
    );
  }
  warehouseByName(actor: Actor, name: string) {
    actor = this.custodyActor(actor, []);
    const warehouse = this.store.get(
      "SELECT * FROM inventory_warehouses WHERE org_id=? AND name=?",
      actor.orgId,
      text(name, "warehouse name"),
    );
    check(
      warehouse,
      "NOT_FOUND",
      "Mapped warehouse not found in this organization.",
      404,
    );
    return warehouse;
  }
  createWarehouse(actor: Actor, key: string, input: { name: string }) {
    return this.platform.command(
      actor,
      "warehouse.create",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
      },
      () => {
        const warehouseId = id();
        this.store.run(
          "INSERT INTO inventory_warehouses VALUES(?,?,?)",
          warehouseId,
          actor.orgId,
          text(input.name, "warehouse"),
        );
        return { id: warehouseId };
      },
    );
  }
  unit(actor: Actor, unitId: string) {
    actor = this.custodyReader(actor);
    const row = this.store.get<Unit>(
      "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
      actor.orgId,
      unitId,
    );
    check(row, "NOT_FOUND", "Stock record not found.", 404);
    return row;
  }
  private reserved(unitId: string) {
    return Number(
      this.store.get(
        "SELECT (SELECT COALESCE(SUM(quantity-consumed-released),0) FROM inventory_allocations WHERE unit_id=?)+(SELECT COUNT(*) FROM inventory_replacements WHERE unit_id=? AND state='reserved') AS qty",
        unitId,
        unitId,
      )?.qty ?? 0,
    );
  }
  stock(actor: Actor) {
    actor = this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
    ]);
    return this.store
      .all<Unit>(
        "SELECT * FROM inventory_units WHERE org_id=? ORDER BY product_id,warehouse_id,serial",
        actor.orgId,
      )
      .filter(
        (u) =>
          actor.role === "admin" ||
          actor.role !== "warehouse" ||
          actor.sites.includes(u.warehouse_id),
      )
      .map((u) => ({
        ...u,
        reserved: this.reserved(u.id),
        available:
          u.state === "stock" && u.condition === "usable"
            ? u.quantity - this.reserved(u.id)
            : 0,
      }));
  }
  private stockScope(actor: Actor, restrictSites = false) {
    const parameters: SQLInputValue[] = [actor.orgId];
    let where = "u.org_id=?";
    if (
      actor.role === "warehouse" ||
      (restrictSites && actor.role !== "admin")
    ) {
      where += actor.sites.length
        ? ` AND u.warehouse_id IN (${actor.sites.map(() => "?").join(",")})`
        : " AND 0=1";
      parameters.push(...actor.sites);
    }
    return { where, parameters };
  }
  private stockBalances(where: string) {
    return `WITH held AS (
      SELECT u.*,
        COALESCE((SELECT SUM(a.quantity-a.consumed-a.released) FROM inventory_allocations a WHERE a.org_id=u.org_id AND a.unit_id=u.id),0)
        +(SELECT COUNT(*) FROM inventory_replacements r WHERE r.org_id=u.org_id AND r.unit_id=u.id AND r.state='reserved') AS reserved
      FROM inventory_units u WHERE ${where}
    ), balances AS (
      SELECT *,CASE WHEN state='stock' AND condition='usable' THEN quantity-reserved ELSE 0 END AS available FROM held
    )`;
  }
  stockPage(actor: Actor, input: StockQueueInput = {}) {
    return this.database.transaction(() => {
      actor = this.custodyActor(actor, [
        "warehouse",
        "commercial",
        "finance",
        "warranty",
        "support",
      ]);
      return this.stockRecords(actor, input, "stock");
    });
  }
  stockSummary(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.custodyActor(actor, [
        "warehouse",
        "commercial",
        "finance",
        "warranty",
        "support",
      ]);
      const scope = this.stockScope(actor);
      const row = this.store.get(
        `${this.stockBalances(scope.where)} SELECT COALESCE(SUM(MAX(0,available)),0) AS available FROM balances`,
        ...scope.parameters,
      )!;
      return { available: Number(row.available) };
    });
  }
  // Called by warranty inside its claim review transaction. Inventory resolves
  // product/custody and eligible stock; warranty owns the claim/remedy decision.
  replacementCandidates(
    actor: Actor,
    oldUnitId: string,
    input: { after?: string; query?: string } = {},
  ) {
    actor = this.custodyActor(actor, ["warranty"]);
    const old = this.unit(actor, text(oldUnitId, "Returned unit", 128));
    site(actor, old.warehouse_id);
    check(
      old.state === "stock" &&
        old.condition === "quarantine" &&
        old.serial &&
        old.quantity === 1,
      "STATE",
      "Returned serial must remain in quarantine.",
    );
    return this.stockRecords(
      actor,
      { ...input, productId: old.product_id },
      `replacement:${old.id}`,
    );
  }
  private stockRecords(actor: Actor, input: StockQueueInput, purpose: string) {
    const query =
      input.query === undefined || input.query.trim() === ""
        ? ""
        : text(input.query, "Stock search", 100);
    const productId =
      input.productId === undefined
        ? null
        : text(input.productId, "Product", 128);
    const warehouseId =
      input.warehouseId === undefined
        ? null
        : text(input.warehouseId, "Warehouse", 128);
    const view = input.view ?? null;
    check(
      view === null || stockQueueViews.includes(view),
      "VALIDATION",
      "Choose a supported stock view.",
      400,
    );
    if (productId) this.catalog.product(actor, productId);
    if (warehouseId) {
      this.warehouse(actor, warehouseId);
      if (actor.role === "warehouse" || purpose !== "stock")
        site(actor, warehouseId);
    }
    const binding = [1, purpose, query, productId, warehouseId, view];
    let anchor: Unit | undefined;
    if (input.after !== undefined) {
      const encoded = text(input.after, "Stock cursor", 4096);
      let cursor: unknown;
      try {
        const decoded = Buffer.from(encoded, "base64url");
        check(
          decoded.toString("base64url") === encoded,
          "VALIDATION",
          "Invalid stock cursor.",
          400,
        );
        cursor = JSON.parse(decoded.toString("utf8"));
      } catch {
        check(false, "VALIDATION", "Invalid stock cursor.", 400);
      }
      check(
        Array.isArray(cursor) &&
          cursor.length === 7 &&
          JSON.stringify(cursor.slice(0, 6)) === JSON.stringify(binding) &&
          typeof cursor[6] === "string" &&
          cursor[6].length > 0 &&
          cursor[6].length <= 128,
        "VALIDATION",
        "Stock cursor does not match this search.",
        400,
      );
      anchor = this.unit(actor, cursor[6]);
      // A live change may remove the anchor from this filter. Recheck current
      // custody before allowing continuation, independently of its condition.
      if (actor.role === "warehouse" || purpose !== "stock")
        site(actor, anchor.warehouse_id);
    }
    const scope = this.stockScope(actor, purpose !== "stock");
    if (productId) {
      scope.where += " AND u.product_id=?";
      scope.parameters.push(productId);
    }
    if (warehouseId) {
      scope.where += " AND u.warehouse_id=?";
      scope.parameters.push(warehouseId);
    }
    if (query) {
      scope.where +=
        " AND (instr(lower(COALESCE(u.serial,'')),lower(?))>0 OR instr(lower(u.bin),lower(?))>0)";
      scope.parameters.push(query, query);
    }
    let where =
      view === "available"
        ? "available>0"
        : view === "quarantine" || view === "damaged"
          ? `state='stock' AND condition='${view}'`
          : view
            ? `state='${view}'`
            : "1=1";
    if (purpose !== "stock")
      where +=
        " AND serial IS NOT NULL AND state='stock' AND condition='usable' AND quantity=1 AND reserved=0";
    if (anchor) {
      where += " AND id>?";
      scope.parameters.push(anchor.id);
    }
    const rows = this.store.all<Unit & { reserved: number; available: number }>(
      `${this.stockBalances(scope.where)} SELECT * FROM balances WHERE ${where} ORDER BY id LIMIT 21`,
      ...scope.parameters,
    );
    const items = rows.slice(0, 20).map((row) => ({ ...row }));
    return {
      items,
      next:
        rows.length > 20
          ? Buffer.from(JSON.stringify([...binding, items[19]!.id])).toString(
              "base64url",
            )
          : null,
    };
  }
  availability(actor: Actor, productId: string, warehouseId: string) {
    actor = this.custodyReader(actor);
    this.catalog.product(actor, productId);
    this.warehouse(actor, warehouseId);
    return this.store
      .all<Unit>(
        "SELECT * FROM inventory_units WHERE org_id=? AND product_id=? AND warehouse_id=? AND state='stock' AND condition='usable'",
        actor.orgId,
        productId,
        warehouseId,
      )
      .reduce((sum, u) => sum + u.quantity - this.reserved(u.id), 0);
  }
  purchaseOrigin(actor: Actor, unitId: string): string | null {
    actor = this.custodyActor(actor, ["warehouse", "commercial", "finance"]);
    const u = this.unit(actor, unitId);
    if (actor.role === "warehouse") site(actor, u.warehouse_id);
    // Follow owned custody evidence rather than assuming a split lot kept its ID.
    const origins = this.store.all<{ reference: string }>(
      `WITH RECURSIVE edges(child,parent) AS (
        SELECT l.unit_id,o.source_unit_id FROM inventory_transfer_lines l
        JOIN inventory_transfer_origins o ON o.org_id=l.org_id AND o.line_id=l.id
        WHERE l.org_id=?
        UNION SELECT r.unit_id,l.unit_id FROM inventory_transfer_receipts r
        JOIN inventory_transfer_lines l ON l.org_id=r.org_id AND l.id=r.line_id WHERE r.org_id=?
        UNION SELECT held_unit_id,source_unit_id FROM inventory_short_picks WHERE org_id=?
        UNION SELECT r.unit_id,l.unit_id FROM inventory_transfer_recoveries r
        JOIN inventory_transfer_losses x ON x.org_id=r.org_id AND x.id=r.loss_id
        JOIN inventory_transfer_lines l ON l.org_id=x.org_id AND l.id=x.line_id WHERE r.org_id=?
        UNION SELECT incoming.unit_id,outgoing.unit_id FROM inventory_movements incoming
        JOIN inventory_movements outgoing ON outgoing.org_id=incoming.org_id AND outgoing.reference=incoming.reference
        WHERE incoming.org_id=? AND incoming.type='relocation.split.in' AND outgoing.type='relocation.split.out'
      ), lineage(unit_id) AS (
        SELECT ? UNION SELECT e.parent FROM edges e JOIN lineage a ON e.child=a.unit_id
      ) SELECT DISTINCT m.reference FROM lineage a JOIN inventory_movements m ON m.unit_id=a.unit_id
      WHERE m.org_id=? AND m.type='receipt'`,
      actor.orgId,
      actor.orgId,
      actor.orgId,
      actor.orgId,
      actor.orgId,
      unitId,
      actor.orgId,
    );
    check(
      origins.length <= 1,
      "PROVENANCE",
      "Stock has ambiguous purchase origin; reconcile custody before returning it.",
    );
    return origins[0]?.reference ?? null;
  }
  serialReceiptReference(actor: Actor, unitId: string): string | null {
    actor = this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
    ]);
    const unit = this.unit(actor, unitId);
    check(unit.serial, "VALIDATION", "Receipt lineage requires a serial.", 400);
    if (actor.role === "warehouse") site(actor, unit.warehouse_id);
    const rows = this.store.all<{ reference: string }>(
      "SELECT reference FROM inventory_movements WHERE org_id=? AND unit_id=? AND type='receipt' ORDER BY rowid LIMIT 2",
      actor.orgId,
      unitId,
    );
    check(
      rows.length <= 1,
      "SERIAL_LINEAGE",
      "Serial has conflicting original receipt evidence.",
      409,
    );
    return rows[0]?.reference ?? null;
  }
  returnToSupplier(
    actor: Actor,
    input: {
      unitId: string;
      receiptId: string;
      revision: number;
      quantity: number;
      serial: string | null;
      reason: string;
    },
    reference: string,
  ) {
    actor = this.custodyActor(actor, []);
    const u = this.unit(actor, input.unitId);
    site(actor, u.warehouse_id);
    check(
      this.purchaseOrigin(actor, u.id) === input.receiptId,
      "PROVENANCE",
      "Stock does not originate from the selected purchase receipt.",
    );
    const quantity = integer(input.quantity, "return quantity", 1, 100000);
    check(
      u.revision === integer(input.revision, "stock revision", 1),
      "REVISION",
      "Stock changed before supplier handover; review the current quantity.",
    );
    check(
      u.state === "stock",
      "STATE",
      "Only physically held stock can be returned to a supplier.",
    );
    check(
      u.serial
        ? input.serial === u.serial && quantity === 1
        : input.serial === null,
      "SERIAL",
      "Scan the original serial; leave the scan blank for bulk stock.",
    );
    check(
      quantity <= u.quantity - this.reserved(u.id),
      "STOCK",
      "Supplier return cannot consume missing or reserved stock.",
    );
    this.store.run(
      "UPDATE inventory_units SET quantity=quantity-?,revision=revision+1 WHERE id=?",
      quantity,
      u.id,
    );
    this.movement(
      actor,
      u,
      "supplier.return",
      -quantity,
      reference,
      text(input.reason, "reason", 1000),
    );
    return {
      unitId: u.id,
      warehouseId: u.warehouse_id,
      productId: u.product_id,
      serial: u.serial,
      quantity,
      unitCost: u.cost,
      value: quantity * u.cost,
      revision: u.revision + 1,
    };
  }
  movementPage(actor: Actor, input: StockHistoryInput): StockHistoryPage {
    return this.database.transaction(() =>
      this.stockHistoryEvidence(actor, input),
    );
  }
  // Task-shaped read for composition inside the application's snapshot transaction.
  stockHistoryEvidence(
    actor: Actor,
    input: StockHistoryInput,
  ): StockHistoryPage {
    actor = this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
    ]);
    check(
      (input.unitId !== undefined) !== (input.serial !== undefined),
      "VALIDATION",
      "Select exactly one stock record or serial.",
      400,
    );
    const selected =
      input.unitId !== undefined
        ? text(input.unitId, "Stock record", 128)
        : text(input.serial, "Serial");
    const unit = this.store.get<Unit>(
      `SELECT * FROM inventory_units WHERE org_id=? AND ${input.unitId !== undefined ? "id" : "serial"}=?`,
      actor.orgId,
      selected,
    );
    check(unit, "NOT_FOUND", "Stock record not found.", 404);
    if (actor.role === "warehouse") site(actor, unit.warehouse_id);
    let where = "org_id=? AND unit_id=?";
    const parameters: SQLInputValue[] = [actor.orgId, unit.id];
    if (actor.role === "warehouse") {
      where += ` AND warehouse_id IN (${actor.sites.map(() => "?").join(",")})`;
      parameters.push(...actor.sites);
    }
    const binding = [
      1,
      actor.orgId,
      unit.id,
      actor.role === "warehouse" ? [...actor.sites].sort() : null,
    ];
    let anchor = Number.MAX_SAFE_INTEGER;
    if (input.after !== undefined) {
      const encoded = text(input.after, "Stock movement cursor", 4096);
      let cursor: unknown;
      try {
        const decoded = Buffer.from(encoded, "base64url");
        check(
          decoded.toString("base64url") === encoded,
          "VALIDATION",
          "Invalid stock movement cursor.",
          400,
        );
        cursor = JSON.parse(decoded.toString("utf8"));
      } catch {
        check(false, "VALIDATION", "Invalid stock movement cursor.", 400);
      }
      check(
        Array.isArray(cursor) &&
          cursor.length === 5 &&
          canonical(cursor.slice(0, 4)) === canonical(binding) &&
          typeof cursor[4] === "string" &&
          cursor[4].length > 0 &&
          cursor[4].length <= 128,
        "VALIDATION",
        "Stock movement cursor does not match this view.",
        400,
      );
      const row = this.store.get<{ position: number }>(
        `SELECT rowid AS position FROM inventory_movements WHERE ${where} AND id=?`,
        ...parameters,
        cursor[4],
      );
      check(
        row,
        "VALIDATION",
        "Stock movement cursor is unavailable. Refresh history.",
        400,
      );
      anchor = row.position;
    }
    const rows = this.store.all<StockMovement>(
      `SELECT id,warehouse_id,type,quantity,unit_cost,reference,reason,actor_id,created_at
         FROM inventory_movements WHERE ${where} AND rowid<? ORDER BY rowid DESC LIMIT 21`,
      ...parameters,
      anchor,
    );
    const items = rows.slice(0, 20);
    const { org_id: _org, ...position } = unit;
    return {
      unit: position,
      items,
      next:
        rows.length > 20
          ? Buffer.from(JSON.stringify([...binding, items[19]!.id])).toString(
              "base64url",
            )
          : null,
    };
  }
  trace(actor: Actor, serial: string) {
    actor = this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "warranty",
      "support",
    ]);
    const unit = this.store.get<Unit>(
      "SELECT * FROM inventory_units WHERE org_id=? AND serial=?",
      actor.orgId,
      text(serial, "serial"),
    );
    check(unit, "NOT_FOUND", "Serial not found.", 404);
    if (actor.role === "warehouse") site(actor, unit.warehouse_id);
    return {
      unit,
      movements: this.store.all(
        "SELECT * FROM inventory_movements WHERE org_id=? AND unit_id=? ORDER BY created_at,rowid",
        actor.orgId,
        unit.id,
      ),
    };
  }
  // Internal sales controls from inventory-owned allocations and shipment deductions.
  salesEvidence(actor: Actor): InventorySalesEvidence {
    actor = this.custodyActor(actor, ["finance"]);
    return {
      allocations: this.store.all(
        `SELECT a.id,a.order_id AS "order",a.product_id AS product,a.warehouse_id AS warehouse,
         a.unit_id AS unit,CAST(a.quantity AS TEXT) AS quantity,CAST(a.consumed AS TEXT) AS consumed,
         CAST(a.released AS TEXT) AS released,a.stage,u.product_id AS unitProduct
         FROM inventory_allocations a LEFT JOIN inventory_units u ON u.org_id=a.org_id AND u.id=a.unit_id
         WHERE a.org_id=? ORDER BY a.rowid`,
        actor.orgId,
      ),
      units: this.store.all(
        `SELECT id,warehouse_id AS warehouse,CAST(quantity AS TEXT) AS quantity,state,condition,
         CASE WHEN serial IS NULL THEN 0 ELSE 1 END AS hasSerial
         FROM inventory_units WHERE org_id=? ORDER BY rowid`,
        actor.orgId,
      ),
      replacementHolds: this.store.all(
        `SELECT id,unit_id AS unit FROM inventory_replacements WHERE org_id=? AND state='reserved' ORDER BY rowid`,
        actor.orgId,
      ),
      movements: this.store.all(
        `SELECT m.id,m.reference AS shipment,m.unit_id AS unit,u.product_id AS product,
         m.warehouse_id AS warehouse,CAST(m.quantity AS TEXT) AS quantity,CAST(m.unit_cost AS TEXT) AS cost
         FROM inventory_movements m LEFT JOIN inventory_units u ON u.org_id=m.org_id AND u.id=m.unit_id
         WHERE m.org_id=? AND m.type='shipment' ORDER BY m.rowid`,
        actor.orgId,
      ),
    };
  }
  // Internal owning operation: Application.reconciliation supplies the snapshot; recheck finance authority here.
  controlTotals(actor: Actor) {
    actor = this.custodyActor(actor, ["finance"]);
    return stockControls(this.store, actor);
  }
  private movement(
    actor: Actor,
    unit: Unit,
    type: string,
    quantity: number,
    reference: string,
    reason: string,
  ) {
    const movementId = id();
    this.store.run(
      "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      movementId,
      actor.orgId,
      unit.id,
      unit.warehouse_id,
      type,
      quantity,
      unit.cost,
      reference,
      reason,
      actor.id,
      now(),
    );
    const clock = this.store.get<{ last_sequence: number }>(
      "UPDATE inventory_cost_clock SET last_sequence=last_sequence+1 WHERE id=1 RETURNING last_sequence",
    );
    check(
      clock && Number.isSafeInteger(clock.last_sequence),
      "COST_RANGE",
      "Stock movement sequence exceeds the exact supported range.",
    );
    this.store.run(
      "INSERT INTO inventory_cost_sequences VALUES(?,?,?)",
      clock.last_sequence,
      actor.orgId,
      movementId,
    );
    this.valuations.record(actor.orgId, movementId);
    this.platform.event(actor, `inventory.${type}`, reference, {
      unitId: unit.id,
      warehouseId: unit.warehouse_id,
      quantity,
    });
    return movementId;
  }
  assertNewSerials(actor: Actor, serials: string[]) {
    actor = this.custodyActor(actor, ["warehouse"]);
    for (const serial of serials)
      check(
        !this.store.get(
          "SELECT id FROM inventory_units WHERE org_id=? AND serial=?",
          actor.orgId,
          text(serial, "serial"),
        ),
        "DUPLICATE_SERIAL",
        "Serial already has a custody record.",
      );
  }
  receive(
    actor: Actor,
    input: {
      productId: string;
      warehouseId: string;
      bin: string;
      quantity: number;
      unitCost: number;
      serials: string[];
      quarantine: boolean;
    },
    reference: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse"]);
    site(actor, input.warehouseId);
    this.warehouse(actor, input.warehouseId);
    const product = this.catalog.product(actor, input.productId);
    const quantity = integer(input.quantity, "quantity", 1, 100000),
      cost = integer(input.unitCost, "unit cost", 0, 1e9),
      bin = text(input.bin, "bin");
    check(
      Array.isArray(input.serials),
      "VALIDATION",
      "serials must be an array.",
      400,
    );
    check(
      typeof input.quarantine === "boolean",
      "VALIDATION",
      "quarantine must be a boolean.",
      400,
    );
    const serials = input.serials.map((s) => text(s, "serial"));
    check(
      product.serialized
        ? serials.length === quantity && new Set(serials).size === quantity
        : serials.length === 0,
      "SERIAL",
      "Serialized quantity requires exactly one unique serial per unit.",
    );
    const unitIds: string[] = [];
    for (const serial of product.serialized ? serials : [null]) {
      if (serial)
        check(
          !this.store.get(
            "SELECT id FROM inventory_units WHERE org_id=? AND serial=?",
            actor.orgId,
            serial,
          ),
          "DUPLICATE_SERIAL",
          "Serial already has a custody record.",
        );
      const unitId = id();
      this.store.run(
        "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,serial,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?,?)",
        unitId,
        actor.orgId,
        product.id,
        input.warehouseId,
        bin,
        serial,
        product.serialized ? 1 : quantity,
        cost,
        input.quarantine ? "quarantine" : "usable",
        "stock",
      );
      const unit = this.unit(actor, unitId);
      this.movement(
        actor,
        unit,
        "receipt",
        unit.quantity,
        reference,
        "Purchase receipt",
      );
      unitIds.push(unitId);
    }
    return unitIds;
  }
  validateOpening(actor: Actor, input: unknown): OpeningRow {
    actor = this.custodyActor(actor, []);
    check(
      input && typeof input === "object" && !Array.isArray(input),
      "VALIDATION",
      "Opening row must be an object.",
      400,
    );
    const row = input as Record<string, unknown>;
    const fields = [
      "sourceId",
      "productId",
      "warehouseId",
      "bin",
      "serial",
      "quantity",
      "unitCost",
      "condition",
    ];
    check(
      Object.keys(row).length === fields.length &&
        fields.every((f) => Object.hasOwn(row, f)),
      "VALIDATION",
      "Opening row fields must match the versioned format.",
      400,
    );
    const productId = text(row.productId, "product"),
      warehouseId = text(row.warehouseId, "warehouse");
    site(actor, warehouseId);
    this.warehouse(actor, warehouseId);
    const product = this.catalog.product(actor, productId),
      quantity = integer(row.quantity, "opening quantity", 1, 100000),
      unitCost = integer(row.unitCost, "opening unit cost", 0, 1e9);
    check(
      product.active === 1,
      "STATE",
      "Opening stock requires an active product.",
    );
    check(
      quantity * unitCost <= 1e12,
      "VALUATION_LIMIT",
      "Opening row value exceeds the supported limit.",
    );
    const serial = row.serial === null ? null : text(row.serial, "serial");
    check(
      product.serialized ? serial !== null && quantity === 1 : serial === null,
      "SERIAL",
      "Serialized opening stock requires one serial and quantity one; bulk stock requires a null serial.",
    );
    check(
      typeof row.condition === "string" &&
        ["usable", "quarantine", "damaged"].includes(row.condition),
      "VALIDATION",
      "Opening condition is invalid.",
      400,
    );
    check(
      !this.store.get(
        "SELECT id FROM inventory_units WHERE org_id=? AND product_id=? AND warehouse_id=? LIMIT 1",
        actor.orgId,
        productId,
        warehouseId,
      ),
      "OPENING_EXISTS",
      "Product/site already has custody records. Reconcile them rather than adding another opening balance.",
    );
    if (serial)
      check(
        !this.store.get(
          "SELECT id FROM inventory_units WHERE org_id=? AND serial=?",
          actor.orgId,
          serial,
        ),
        "DUPLICATE_SERIAL",
        "Serial already has a custody record.",
      );
    return {
      sourceId: text(row.sourceId, "source row"),
      productId,
      warehouseId,
      bin: text(row.bin, "bin"),
      serial,
      quantity,
      unitCost,
      condition: row.condition as OpeningRow["condition"],
    };
  }
  applyOpening(
    actor: Actor,
    rows: OpeningRow[],
    reference: string,
    reason: string,
  ) {
    actor = this.custodyActor(actor, []);
    // The migration owner invokes this in its reviewed batch transaction. Recheck all rows before any insertion.
    const checked = rows.map((row) => this.validateOpening(actor, row));
    return checked.map((row) => {
      const unitId = id();
      this.store.run(
        "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,serial,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?,'stock')",
        unitId,
        actor.orgId,
        row.productId,
        row.warehouseId,
        row.bin,
        row.serial,
        row.quantity,
        row.unitCost,
        row.condition,
      );
      const unit = this.unit(actor, unitId);
      this.movement(actor, unit, "opening", row.quantity, reference, reason);
      return {
        sourceId: row.sourceId,
        unitId,
        quantity: row.quantity,
        value: row.quantity * row.unitCost,
      };
    });
  }
  relocate(
    actor: Actor,
    key: string,
    input: {
      unitId: string;
      revision: number;
      sourceBin: string;
      bin: string;
      serial: string | null;
      reason: string;
      quantity?: number;
    },
  ) {
    return this.platform.command(
      actor,
      "stock.relocate",
      key,
      input,
      (cached) => {
        actor = this.custodyActor(actor, ["warehouse"]);
        site(
          actor,
          cached?.warehouseId ?? this.unit(actor, input.unitId).warehouse_id,
        );
      },
      () => {
        const u = this.unit(actor, text(input.unitId, "stock record")),
          sourceBin = text(input.sourceBin, "source bin"),
          bin = text(input.bin, "destination bin"),
          serial = input.serial === null ? null : text(input.serial, "serial"),
          reason = text(input.reason, "relocation reason", 1000);
        integer(input.revision, "stock revision", 0);
        const quantity =
          input.quantity === undefined
            ? u.quantity
            : integer(input.quantity, "bin move quantity", 1, 100000);
        check(
          quantity > 0 &&
            quantity <= u.quantity &&
            (!u.serial || quantity === 1),
          "STOCK",
          "Move a positive quantity within this stock record; serialized equipment moves as one unit.",
        );
        check(
          u.revision === input.revision && u.bin === sourceBin,
          "REVISION",
          "Stock or source bin changed; refresh before moving it.",
        );
        check(
          u.state === "stock" && u.quantity > 0 && this.reserved(u.id) === 0,
          "STATE",
          "Only present, unallocated stock can move between bins.",
        );
        check(
          serial === u.serial,
          "SERIAL",
          "Scan the exact stock serial; bulk stock requires a blank serial.",
        );
        check(
          bin !== sourceBin,
          "VALIDATION",
          "Select another bin in this warehouse.",
          400,
        );
        check(
          !this.store.get(
            "SELECT id FROM inventory_serial_reviews WHERE org_id=? AND unit_id=? AND state='submitted' LIMIT 1",
            actor.orgId,
            u.id,
          ),
          "STATE",
          "Resolve the pending missing-serial review before moving this stock.",
        );
        const relocationId = id(),
          partial = quantity < u.quantity;
        let moved = u;
        if (partial) {
          this.store.run(
            "UPDATE inventory_units SET quantity=quantity-?,revision=revision+1 WHERE org_id=? AND id=?",
            quantity,
            actor.orgId,
            u.id,
          );
          const movedId = id();
          this.store.run(
            "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?)",
            movedId,
            actor.orgId,
            u.product_id,
            u.warehouse_id,
            bin,
            quantity,
            u.cost,
            u.condition,
            "stock",
          );
          this.valuations.split(actor.orgId, u.id, movedId, quantity);
          moved = this.unit(actor, movedId);
          const evidence = `${JSON.stringify(sourceBin)} → ${JSON.stringify(bin)}: ${reason}`;
          this.movement(
            actor,
            u,
            "relocation.split.out",
            -quantity,
            relocationId,
            evidence,
          );
          this.movement(
            actor,
            moved,
            "relocation.split.in",
            quantity,
            relocationId,
            evidence,
          );
        } else {
          this.store.run(
            "UPDATE inventory_units SET bin=?,revision=revision+1 WHERE org_id=? AND id=?",
            bin,
            actor.orgId,
            u.id,
          );
          this.movement(
            actor,
            u,
            "relocation",
            0,
            relocationId,
            `${JSON.stringify(sourceBin)} → ${JSON.stringify(bin)}: ${reason}`,
          );
        }
        const result = {
          id: moved.id,
          relocationId,
          warehouseId: u.warehouse_id,
          fromBin: sourceBin,
          bin,
          serial,
          quantity,
          unitCost: u.cost,
          condition: u.condition,
          revision: partial ? moved.revision : u.revision + 1,
          ...(partial
            ? {
                sourceUnitId: u.id,
                sourceQuantity: u.quantity - quantity,
                sourceRevision: u.revision + 1,
              }
            : {}),
        };
        this.platform.audit(actor, "stock.relocated", relocationId, {
          ...result,
          beforeRevision: u.revision,
          reason,
        });
        return result;
      },
    );
  }
  inspect(
    actor: Actor,
    key: string,
    input: {
      unitId: string;
      revision: number;
      condition: "usable" | "quarantine" | "damaged";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "stock.inspect",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, ["warehouse"]);
        site(actor, this.unit(actor, input.unitId).warehouse_id);
      },
      () => {
        const u = this.unit(actor, input.unitId);
        check(
          u.revision === input.revision,
          "REVISION",
          "Stock changed; refresh before inspecting.",
        );
        check(
          u.state === "stock" && u.quantity > 0 && this.reserved(u.id) === 0,
          "STATE",
          "Only present, unallocated stock can be inspected.",
        );
        check(
          ["usable", "quarantine", "damaged"].includes(input.condition),
          "VALIDATION",
          "Unknown condition.",
          400,
        );
        text(input.reason, "inspection reason", 1000);
        this.store.run(
          "UPDATE inventory_units SET condition=?,revision=revision+1 WHERE id=?",
          input.condition,
          u.id,
        );
        this.movement(actor, u, "inspection", 0, u.id, input.reason);
        return { id: u.id, revision: u.revision + 1 };
      },
    );
  }
  adjustCount(
    actor: Actor,
    key: string,
    input: { unitId: string; revision: number; count: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "stock.count",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
        site(actor, this.unit(actor, input.unitId).warehouse_id);
        check(
          this.identity.countReviewPolicy(actor).mode !== "independent",
          "COUNT_REVIEW_REQUIRED",
          "Independent count review requires a saved observation and a separate administrator; direct corrections are disabled.",
          403,
        );
      },
      () => this.applyCount(actor, input, input.unitId),
    );
  }
  private applyCount(
    actor: Actor,
    input: { unitId: string; revision: number; count: number; reason: string },
    reference: string,
    movementType: "count" | "quantity.correction" = "count",
  ) {
    const u = this.unit(actor, input.unitId),
      count = integer(input.count, "count", 0, 100000),
      reason = text(input.reason, "count reason", 1000);
    integer(input.revision, "stock revision", 1);
    check(
      u.revision === input.revision,
      "REVISION",
      "Stock changed after the count cutoff; reject this count and start a fresh count.",
    );
    check(
      u.state === "stock" && !u.serial,
      "STATE",
      "This count command is for bulk stock; serialized discrepancies require custody review.",
    );
    check(
      count >= this.reserved(u.id),
      "ALLOCATION",
      "Count cannot remove allocated stock; reconcile the affected orders before approval.",
    );
    this.store.run(
      "UPDATE inventory_units SET quantity=?,revision=revision+1 WHERE id=?",
      count,
      u.id,
    );
    this.movement(
      actor,
      u,
      movementType,
      count - u.quantity,
      reference,
      reason,
    );
    return {
      id: u.id,
      revision: u.revision + 1,
      previousQuantity: u.quantity,
      quantity: count,
      delta: count - u.quantity,
      unitCost: u.cost,
      valueDelta: (count - u.quantity) * u.cost,
    };
  }
  private countRecord(actor: Actor, countId: string) {
    const row = this.store.get<Count>(
      "SELECT * FROM inventory_counts WHERE org_id=? AND id=?",
      actor.orgId,
      countId,
    );
    check(row, "NOT_FOUND", "Count not found.", 404);
    site(actor, row.warehouse_id);
    return row;
  }
  counts(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.custodyActor(actor, ["warehouse", "support"]);
      const reviewPolicy = this.identity.countReviewPolicy(actor);
      const { where, parameters } = this.countScope(actor);
      return this.store
        .all<Count>(
          `SELECT * FROM inventory_counts WHERE ${where} ORDER BY created_at DESC,id`,
          ...parameters,
        )
        .map((c) => this.countDetails(actor, c, reviewPolicy));
    });
  }
  private countScope(actor: Actor) {
    const scope =
      actor.role === "admin" ? null : [...new Set(actor.sites)].sort();
    const parameters: SQLInputValue[] = [actor.orgId];
    let where = "org_id=?";
    if (scope) {
      where += scope.length
        ? ` AND warehouse_id IN (${scope.map(() => "?").join(",")})`
        : " AND 0=1";
      parameters.push(...scope);
    }
    return { scope, where, parameters };
  }
  countPage(actor: Actor, input: CountQueueInput = {}) {
    return this.database.transaction(() => {
      actor = this.custodyActor(actor, ["warehouse", "support"]);
      const reviewPolicy = this.identity.countReviewPolicy(actor);
      const state = input.state ?? null;
      check(
        state === null || countQueueStates.includes(state),
        "VALIDATION",
        "Choose a supported count state.",
        400,
      );
      const { scope, where, parameters } = this.countScope(actor);
      const binding = ["count-queue", 1, actor.orgId, scope, state];
      let anchor: (Count & { position: number }) | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Count cursor", 4096);
        let cursor: unknown;
        try {
          const bytes = Buffer.from(encoded, "base64url");
          cursor = JSON.parse(bytes.toString("utf8"));
          check(
            encoded === input.after &&
              bytes.toString("base64url") === encoded &&
              JSON.stringify(cursor) === bytes.toString("utf8"),
            "VALIDATION",
            "Invalid count cursor.",
            400,
          );
        } catch {
          check(false, "VALIDATION", "Invalid count cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 6 &&
            JSON.stringify(cursor.slice(0, 5)) === JSON.stringify(binding) &&
            typeof cursor[5] === "string" &&
            cursor[5].length > 0 &&
            cursor[5].length <= 128,
          "VALIDATION",
          "Count cursor does not match this organization, sites and state.",
          400,
        );
        // Resolve within current custody scope, independently of mutable state.
        anchor = this.store.get<Count & { position: number }>(
          `SELECT *,rowid AS position FROM inventory_counts WHERE ${where} AND id=?`,
          ...parameters,
          cursor[5],
        );
        check(anchor, "CURSOR", "Count cursor is no longer available.", 400);
      }
      const rows = this.store.all<Count & { position: number }>(
        `SELECT *,rowid AS position FROM inventory_counts WHERE ${where}
        ${state ? "AND state=?" : ""}
        ${anchor ? "AND (created_at<? OR (created_at=? AND rowid<?))" : ""}
        ORDER BY created_at DESC,rowid DESC LIMIT 21`,
        ...parameters,
        ...(state ? [state] : []),
        ...(anchor
          ? [anchor.created_at, anchor.created_at, anchor.position]
          : []),
      );
      const headers = rows.slice(0, 20);
      return {
        items: headers.map(({ position: _, ...c }) =>
          this.countDetails(actor, c, reviewPolicy),
        ),
        next:
          rows.length > 20
            ? Buffer.from(
                JSON.stringify([...binding, headers[19]!.id]),
              ).toString("base64url")
            : null,
      };
    });
  }
  private countDetails(
    actor: Actor,
    { start_hash, decision_result, ...c }: Count,
    reviewPolicy: CountReviewPolicy,
  ) {
    return {
      ...c,
      reviewPolicy,
      canApprove:
        actor.role === "admin" &&
        c.state === "submitted" &&
        (reviewPolicy.mode !== "independent" ||
          (actor.id !== c.created_by && actor.id !== c.observed_by)),
      delta:
        c.observed_quantity === null
          ? null
          : c.observed_quantity - c.expected_quantity,
      valueDelta:
        c.observed_quantity === null
          ? null
          : (c.observed_quantity - c.expected_quantity) * c.unit_cost,
      result: decision_result ? JSON.parse(decision_result) : null,
    };
  }
  // Internal projections feed owning modules, which resolve customer entitlement
  // and business/site context before exposing them. Destination-only transfer
  // receivers must still resolve a unit whose recorded warehouse is the source.
  private custodyReader(actor: Actor) {
    return this.custodyActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "buyer",
      "support",
    ]);
  }
  private custodyActor(actor: Actor, roles: Actor["role"][]) {
    const current = this.identity.currentActor(actor);
    permit(current, roles);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing stock custody.",
      403,
    );
    return current;
  }
  private serialReview(actor: Actor, reviewId: string) {
    const row = this.store.get<SerialReview>(
      "SELECT * FROM inventory_serial_reviews WHERE org_id=? AND id=?",
      actor.orgId,
      text(reviewId, "Serial review ID"),
    );
    check(row, "NOT_FOUND", "Serial custody review not found.", 404);
    site(actor, row.warehouse_id);
    return row;
  }
  serialReviews(actor: Actor, after?: string) {
    actor = this.custodyActor(actor, ["warehouse", "finance", "support"]);
    const cursor =
      after === undefined ? undefined : this.serialReview(actor, after);
    const rows = this.store.all<SerialReview>(
      `SELECT * FROM inventory_serial_reviews WHERE org_id=?
       ${actor.role === "admin" ? "" : `AND warehouse_id IN (${actor.sites.map(() => "?").join(",") || "NULL"})`}
       AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 21`,
      actor.orgId,
      ...(actor.role === "admin" ? [] : actor.sites),
      cursor?.created_at ?? null,
      cursor?.created_at ?? null,
      cursor?.created_at ?? null,
      cursor?.id ?? null,
    );
    const items = rows
      .slice(0, 20)
      .map(
        ({
          input_hash,
          recovery_hash,
          decision_result,
          recovery_result,
          ...r
        }) => {
          const u = this.unit(actor, r.unit_id);
          return {
            ...r,
            currentRevision: u.revision,
            currentQuantity: u.quantity,
            decisionResult: decision_result
              ? JSON.parse(decision_result)
              : null,
            recoveryResult: recovery_result
              ? JSON.parse(recovery_result)
              : null,
          };
        },
      );
    return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
  }
  reportSerialMissing(
    actor: Actor,
    key: string,
    input: {
      unitId: string;
      revision: number;
      serial: string;
      reviewRef: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "serial.missing.report",
      key,
      input,
      (cached) => {
        actor = this.custodyActor(actor, ["warehouse"]);
        if (cached) this.serialReview(actor, cached.id);
        site(actor, this.unit(actor, input.unitId).warehouse_id);
      },
      () => {
        const normalized = {
          unitId: text(input.unitId, "Stock ID"),
          revision: integer(input.revision, "Stock revision", 1),
          serial: text(input.serial, "Expected serial"),
          reviewRef: text(input.reviewRef, "Review reference"),
          reason: text(input.reason, "Missing serial evidence", 1000),
        };
        const hash = digest(canonical(normalized)),
          old = this.store.get<SerialReview>(
            "SELECT * FROM inventory_serial_reviews WHERE org_id=? AND review_ref=?",
            actor.orgId,
            normalized.reviewRef,
          );
        if (old) {
          site(actor, old.warehouse_id);
          check(
            old.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Review reference already records different evidence.",
          );
          return { id: old.id };
        }
        const u = this.unit(actor, normalized.unitId);
        check(
          u.revision === normalized.revision,
          "REVISION",
          "Stock changed; refresh before recording custody evidence.",
        );
        check(
          u.state === "stock" &&
            u.quantity === 1 &&
            u.serial !== null &&
            u.condition === "quarantine",
          "STATE",
          "Quarantine a present serialized stock record before reporting it missing.",
        );
        check(
          u.serial === normalized.serial,
          "SERIAL",
          "Expected serial does not match the held stock record.",
        );
        check(
          this.reserved(u.id) === 0,
          "ALLOCATION",
          "Reconcile order and replacement reservations before custody review.",
        );
        check(
          !this.store.get(
            "SELECT id FROM inventory_serial_reviews WHERE org_id=? AND unit_id=? AND state='submitted'",
            actor.orgId,
            u.id,
          ),
          "REVIEW_PENDING",
          "This serial already has an unresolved custody review.",
        );
        const reviewId = id();
        this.store.run(
          `INSERT INTO inventory_serial_reviews(id,org_id,unit_id,warehouse_id,product_id,serial,bin,stock_revision,unit_cost,review_ref,reason,observed_by,created_at,input_hash,state)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted')`,
          reviewId,
          actor.orgId,
          u.id,
          u.warehouse_id,
          u.product_id,
          u.serial,
          u.bin,
          u.revision,
          u.cost,
          normalized.reviewRef,
          normalized.reason,
          actor.id,
          now(),
          hash,
        );
        this.platform.event(actor, "SerialMissingReported", reviewId, {
          unitId: u.id,
          serial: u.serial,
          stockRevision: u.revision,
          unitCost: u.cost,
        });
        return { id: reviewId };
      },
    );
  }
  decideSerialMissing(
    actor: Actor,
    key: string,
    input: { reviewId: string; decision: "approve" | "reject"; reason: string },
  ) {
    return this.platform.command(
      actor,
      "serial.missing.decide",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
        this.serialReview(actor, input.reviewId);
      },
      () => {
        const r = this.serialReview(actor, input.reviewId),
          reason = text(input.reason, "Custody review decision", 1000);
        check(
          ["approve", "reject"].includes(input.decision),
          "VALIDATION",
          "Unknown custody decision.",
          400,
        );
        if (r.decision !== null) {
          check(
            r.decision === input.decision && r.decision_reason === reason,
            "RECEIPT_CONFLICT",
            "Custody review already has a different decision.",
          );
          return JSON.parse(r.decision_result!) as {
            id: string;
            state: string;
            unitId: string;
            revision: number;
            valueDelta: number;
          };
        }
        check(
          r.state === "submitted",
          "STATE",
          "Custody review is not awaiting a decision.",
        );
        const u = this.unit(actor, r.unit_id);
        let revision = u.revision;
        if (input.decision === "approve") {
          check(
            u.revision === r.stock_revision,
            "REVISION",
            "Stock changed after observation; reject this review and record fresh evidence.",
          );
          check(
            u.state === "stock" &&
              u.condition === "quarantine" &&
              u.quantity === 1 &&
              u.serial === r.serial &&
              u.cost === r.unit_cost &&
              u.warehouse_id === r.warehouse_id &&
              u.bin === r.bin &&
              u.product_id === r.product_id,
            "STATE",
            "Original held stock no longer matches custody evidence.",
          );
          check(
            this.reserved(u.id) === 0,
            "ALLOCATION",
            "Reconcile reservations before approving a serial loss.",
          );
          this.store.run(
            "UPDATE inventory_units SET quantity=0,revision=revision+1 WHERE org_id=? AND id=?",
            actor.orgId,
            u.id,
          );
          this.movement(actor, u, "serial.loss", -1, r.id, reason);
          revision++;
        }
        const state = input.decision === "approve" ? "approved" : "rejected";
        const result = {
          id: r.id,
          state,
          unitId: u.id,
          revision,
          valueDelta: state === "approved" ? -r.unit_cost : 0,
        };
        this.store.run(
          "UPDATE inventory_serial_reviews SET state=?,decision=?,decision_reason=?,decided_by=?,decided_at=?,decision_result=? WHERE org_id=? AND id=?",
          state,
          input.decision,
          reason,
          actor.id,
          now(),
          canonical(result),
          actor.orgId,
          r.id,
        );
        this.platform.event(actor, "SerialMissingReviewed", r.id, result);
        return result;
      },
    );
  }
  recoverSerialMissing(
    actor: Actor,
    key: string,
    input: {
      reviewId: string;
      revision: number;
      serial: string;
      receiptRef: string;
      bin: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "serial.missing.recover",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, ["warehouse"]);
        this.serialReview(actor, input.reviewId);
      },
      () => {
        const r = this.serialReview(actor, input.reviewId),
          normalized = {
            reviewId: r.id,
            revision: integer(input.revision, "Stock revision", 1),
            serial: text(input.serial, "Scanned serial"),
            receiptRef: text(input.receiptRef, "Recovery receipt reference"),
            bin: text(input.bin, "Recovery bin"),
            reason: text(input.reason, "Recovery evidence", 1000),
          };
        const hash = digest(canonical(normalized));
        if (r.state === "recovered") {
          check(
            r.recovery_hash === hash,
            "RECEIPT_CONFLICT",
            "This loss already has different recovery evidence.",
          );
          return JSON.parse(r.recovery_result!) as {
            id: string;
            unitId: string;
            revision: number;
            valueDelta: number;
          };
        }
        check(
          r.state === "approved" && r.decision === "approve",
          "STATE",
          "Only an approved unrecovered serial loss can be recovered.",
        );
        check(
          normalized.serial === r.serial,
          "SERIAL",
          "Scan the exact originally lost serial before recovery.",
        );
        check(
          !this.store.get(
            "SELECT id FROM inventory_serial_reviews WHERE org_id=? AND recovery_ref=?",
            actor.orgId,
            normalized.receiptRef,
          ),
          "RECEIPT_CONFLICT",
          "Recovery receipt reference already belongs to another loss.",
        );
        const u = this.unit(actor, r.unit_id);
        check(
          u.revision === normalized.revision,
          "REVISION",
          "Stock changed; refresh before recovering the serial.",
        );
        check(
          u.state === "stock" &&
            u.quantity === 0 &&
            u.condition === "quarantine" &&
            u.serial === r.serial &&
            u.cost === r.unit_cost &&
            u.product_id === r.product_id &&
            u.warehouse_id === r.warehouse_id,
          "STATE",
          "Original missing serial record no longer matches the approved loss.",
        );
        check(
          this.reserved(u.id) === 0,
          "ALLOCATION",
          "Missing serial unexpectedly has a reservation; reconcile before recovery.",
        );
        this.store.run(
          "UPDATE inventory_units SET quantity=1,condition='quarantine',bin=?,revision=revision+1 WHERE org_id=? AND id=?",
          normalized.bin,
          actor.orgId,
          u.id,
        );
        this.movement(actor, u, "serial.recovery", 1, r.id, normalized.reason);
        const result = {
          id: r.id,
          unitId: u.id,
          revision: u.revision + 1,
          valueDelta: r.unit_cost,
        };
        this.store.run(
          "UPDATE inventory_serial_reviews SET state='recovered',recovery_ref=?,recovery_reason=?,recovery_bin=?,recovered_by=?,recovered_at=?,recovery_hash=?,recovery_result=? WHERE org_id=? AND id=?",
          normalized.receiptRef,
          normalized.reason,
          normalized.bin,
          actor.id,
          now(),
          hash,
          canonical(result),
          actor.orgId,
          r.id,
        );
        this.platform.event(actor, "SerialMissingRecovered", r.id, result);
        return result;
      },
    );
  }
  startCount(
    actor: Actor,
    key: string,
    input: { unitId: string; revision: number; countRef: string },
  ) {
    return this.platform.command(
      actor,
      "count.start",
      key,
      input,
      (cached) => {
        actor = this.custodyActor(actor, ["warehouse"]);
        if (cached) this.countRecord(actor, cached.id);
        else {
          const old = this.store.get<Count>(
            "SELECT * FROM inventory_counts WHERE org_id=? AND count_ref=?",
            actor.orgId,
            text(input.countRef, "count reference"),
          );
          if (old) site(actor, old.warehouse_id);
          else site(actor, this.unit(actor, input.unitId).warehouse_id);
        }
      },
      () => {
        const normalized = {
            unitId: text(input.unitId, "stock ID"),
            revision: integer(input.revision, "stock revision", 1),
            countRef: text(input.countRef, "count reference"),
          },
          hash = digest(canonical(normalized)),
          old = this.store.get<Count>(
            "SELECT * FROM inventory_counts WHERE org_id=? AND count_ref=?",
            actor.orgId,
            normalized.countRef,
          );
        if (old) {
          site(actor, old.warehouse_id);
          check(
            old.start_hash === hash,
            "RECEIPT_CONFLICT",
            "Count reference already identifies a different stock snapshot.",
          );
          return { id: old.id };
        }
        const u = this.unit(actor, normalized.unitId);
        check(
          u.revision === normalized.revision,
          "REVISION",
          "Stock changed; refresh before starting the count.",
        );
        check(
          u.state === "stock" && !u.serial,
          "STATE",
          "Start a count on a bulk stock lot; serialized discrepancies require custody review.",
        );
        const countId = id();
        this.store.run(
          "INSERT INTO inventory_counts(id,org_id,unit_id,warehouse_id,product_id,bin,condition,stock_revision,expected_quantity,unit_cost,count_ref,state,created_by,created_at,start_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)",
          countId,
          actor.orgId,
          u.id,
          u.warehouse_id,
          u.product_id,
          u.bin,
          u.condition,
          u.revision,
          u.quantity,
          u.cost,
          normalized.countRef,
          actor.id,
          now(),
          hash,
        );
        this.platform.event(actor, "CountStarted", countId, {
          unitId: u.id,
          revision: u.revision,
          expectedQuantity: u.quantity,
        });
        return { id: countId };
      },
    );
  }
  submitCount(
    actor: Actor,
    key: string,
    input: { countId: string; quantity: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "count.submit",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, ["warehouse"]);
        this.countRecord(actor, input.countId);
      },
      () => {
        const c = this.countRecord(actor, input.countId),
          quantity = integer(input.quantity, "observed quantity", 0, 100000),
          reason = text(input.reason, "count evidence", 1000);
        if (c.state !== "draft") {
          check(
            c.observed_quantity === quantity && c.observation_reason === reason,
            "RECEIPT_CONFLICT",
            "This count already has a different observation, or was rejected before observation.",
          );
          return { id: c.id, quantity, delta: quantity - c.expected_quantity };
        }
        this.store.run(
          "UPDATE inventory_counts SET state='submitted',observed_quantity=?,observation_reason=?,observed_by=?,observed_at=? WHERE id=?",
          quantity,
          reason,
          actor.id,
          now(),
          c.id,
        );
        this.platform.event(actor, "CountSubmitted", c.id, {
          quantity,
          expectedQuantity: c.expected_quantity,
        });
        return { id: c.id, quantity, delta: quantity - c.expected_quantity };
      },
    );
  }
  decideCount(
    actor: Actor,
    key: string,
    input: {
      countId: string;
      decision: "approve" | "reject";
      reason: string;
      policyRevision?: number;
    },
  ) {
    return this.platform.command(
      actor,
      "count.decide",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
        this.countRecord(actor, input.countId);
      },
      () => {
        const c = this.countRecord(actor, input.countId),
          reason = text(input.reason, "review reason", 1000);
        check(
          ["approve", "reject"].includes(input.decision),
          "VALIDATION",
          "Unknown count decision.",
          400,
        );
        const state = input.decision === "approve" ? "approved" : "rejected";
        if (c.decision_result) {
          check(
            c.state === state && c.decision_reason === reason,
            "RECEIPT_CONFLICT",
            "Count already has a different review decision.",
          );
          return JSON.parse(c.decision_result) as {
            id: string;
            state: string;
            adjustment: ReturnType<Inventory["applyCount"]> | null;
            reviewPolicy?: CountReviewPolicy;
          };
        }
        check(
          input.decision === "reject" ||
            (c.state === "submitted" && c.observed_quantity !== null),
          "STATE",
          "Submit the physical observation before approval.",
        );
        const reviewPolicy = this.identity.countReviewPolicy(actor);
        if (input.decision === "approve") {
          check(
            input.policyRevision === reviewPolicy.revision ||
              (input.policyRevision === undefined &&
                reviewPolicy.revision === 1),
            "REVISION",
            "Count review policy changed or was not reviewed; refresh before approving.",
          );
          check(
            reviewPolicy.mode !== "independent" ||
              (actor.id !== c.created_by && actor.id !== c.observed_by),
            "SEPARATION_OF_DUTIES",
            "A different administrator must approve this count; the starter and observer cannot approve their own count.",
            403,
          );
        }
        const adjustment =
          input.decision === "approve"
            ? this.applyCount(
                actor,
                {
                  unitId: c.unit_id,
                  revision: c.stock_revision,
                  count: c.observed_quantity!,
                  reason,
                },
                c.id,
              )
            : null;
        const result = { id: c.id, state, adjustment, reviewPolicy };
        this.store.run(
          "UPDATE inventory_counts SET state=?,decision_reason=?,decided_by=?,decided_at=?,decision_result=? WHERE id=?",
          state,
          reason,
          actor.id,
          now(),
          JSON.stringify(result),
          c.id,
        );
        this.platform.event(actor, "CountReviewed", c.id, result);
        return result;
      },
    );
  }
  reserve(
    actor: Actor,
    orderId: string,
    productId: string,
    warehouseId: string,
    requested: number,
  ): number {
    actor = this.custodyActor(actor, ["commercial", "buyer"]);
    const units = this.store.all<Unit>(
      "SELECT * FROM inventory_units WHERE org_id=? AND product_id=? AND warehouse_id=? AND condition='usable' AND state='stock' ORDER BY rowid",
      actor.orgId,
      productId,
      warehouseId,
    );
    let remaining = requested;
    for (const u of units) {
      if (!remaining) break;
      const qty = Math.min(remaining, u.quantity - this.reserved(u.id));
      if (qty <= 0) continue;
      this.store.run(
        "INSERT INTO inventory_allocations(id,org_id,order_id,product_id,warehouse_id,unit_id,quantity) VALUES(?,?,?,?,?,?,?)",
        id(),
        actor.orgId,
        orderId,
        productId,
        warehouseId,
        u.id,
        qty,
      );
      remaining -= qty;
    }
    return requested - remaining;
  }
  allocations(actor: Actor, orderId: string) {
    actor = this.custodyReader(actor);
    return this.store.all<Allocation>(
      "SELECT * FROM inventory_allocations WHERE org_id=? AND order_id=? ORDER BY rowid",
      actor.orgId,
      orderId,
    );
  }
  pick(actor: Actor, allocationId: string, serial: string | null) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const row = this.store.get<Allocation>(
      "SELECT * FROM inventory_allocations WHERE org_id=? AND id=?",
      actor.orgId,
      allocationId,
    );
    check(row, "NOT_FOUND", "Allocation not found.", 404);
    site(actor, row.warehouse_id);
    const u = this.unit(actor, row.unit_id);
    check(
      u.serial === serial,
      "SERIAL",
      "Scan does not match the allocated unit.",
    );
    check(
      row.quantity > row.consumed + row.released,
      "STATE",
      "Allocation is no longer open.",
    );
    this.store.run(
      "UPDATE inventory_allocations SET stage='picked' WHERE id=?",
      row.id,
    );
    return row;
  }
  unpick(actor: Actor, allocationId: string) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const row = this.store.get<Allocation>(
      "SELECT * FROM inventory_allocations WHERE org_id=? AND id=?",
      actor.orgId,
      allocationId,
    );
    check(row, "NOT_FOUND", "Allocation not found.", 404);
    site(actor, row.warehouse_id);
    this.store.run(
      "UPDATE inventory_allocations SET stage='reserved' WHERE id=?",
      row.id,
    );
    return row;
  }
  // Called within the owning order/fulfillment transaction. A shortage report
  // segregates expected book stock for review; it does not confirm a loss.
  holdShortPick(
    actor: Actor,
    input: {
      allocationId: string;
      unitRevision: number;
      quantity: number;
      reason: string;
    },
    reference: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const a = this.store.get<Allocation>(
      "SELECT * FROM inventory_allocations WHERE org_id=? AND id=?",
      actor.orgId,
      input.allocationId,
    );
    check(a, "NOT_FOUND", "Allocation not found.", 404);
    site(actor, a.warehouse_id);
    const u = this.unit(actor, a.unit_id),
      quantity = integer(input.quantity, "short quantity", 1, 100000),
      reason = text(input.reason, "short-pick evidence", 1000);
    check(
      u.revision === input.unitRevision,
      "REVISION",
      "Stock changed; refresh before reporting a shortage.",
    );
    check(
      u.state === "stock" && u.condition === "usable",
      "STATE",
      "Allocated stock is unavailable.",
    );
    check(
      quantity <= a.quantity - a.consumed - a.released,
      "QUANTITY",
      "Short quantity exceeds the remaining allocation.",
    );
    this.store.run(
      "UPDATE inventory_allocations SET released=released+? WHERE id=?",
      quantity,
      a.id,
    );
    check(
      quantity <= u.quantity - this.reserved(u.id),
      "STOCK",
      "Short quantity overlaps another stock commitment.",
    );
    let heldId = u.id;
    if (quantity === u.quantity) {
      this.store.run(
        "UPDATE inventory_units SET condition='quarantine',revision=revision+1 WHERE id=?",
        u.id,
      );
    } else {
      check(
        !u.serial,
        "SERIAL",
        "A serialized shortage requires the entire unit.",
      );
      heldId = id();
      this.store.run(
        "UPDATE inventory_units SET quantity=quantity-?,revision=revision+1 WHERE id=?",
        quantity,
        u.id,
      );
      this.store.run(
        "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,'quarantine','stock')",
        heldId,
        actor.orgId,
        u.product_id,
        u.warehouse_id,
        u.bin,
        quantity,
        u.cost,
      );
    }
    if (heldId !== u.id)
      this.valuations.split(actor.orgId, u.id, heldId, quantity);
    this.store.run(
      "INSERT INTO inventory_short_picks VALUES(?,?,?,?,?,?,?,?,?)",
      reference,
      actor.orgId,
      a.id,
      u.id,
      heldId,
      quantity,
      reason,
      actor.id,
      now(),
    );
    this.movement(actor, u, "shortpick.hold", 0, reference, reason);
    if (heldId !== u.id)
      this.movement(
        actor,
        this.unit(actor, heldId),
        "shortpick.hold",
        0,
        reference,
        reason,
      );
    return { heldUnitId: heldId, productId: a.product_id, quantity };
  }
  release(actor: Actor, orderId: string, productId: string, quantity: number) {
    actor = this.custodyActor(actor, ["commercial", "buyer"]);
    if (quantity === 0) return 0;
    const allocations = this.allocations(actor, orderId).filter(
      (a) => a.product_id === productId,
    );
    const available = allocations.reduce(
      (sum, a) =>
        sum +
        (a.stage === "reserved" ? a.quantity - a.consumed - a.released : 0),
      0,
    );
    check(
      available >= quantity ||
        !allocations.some(
          (a) => a.stage === "picked" && a.quantity > a.consumed + a.released,
        ),
      "PICKED",
      "Unpick stock before removing picked units.",
    );
    let remaining = quantity;
    for (const a of allocations.filter((a) => a.stage === "reserved")) {
      const open = a.quantity - a.consumed - a.released;
      if (!open) continue;
      const qty = Math.min(open, remaining);
      this.store.run(
        "UPDATE inventory_allocations SET released=released+? WHERE id=?",
        qty,
        a.id,
      );
      remaining -= qty;
      if (!remaining) break;
    }
    return quantity - remaining;
  }
  ship(
    actor: Actor,
    orderId: string,
    lines: { allocationId: string; quantity: number }[],
    shipmentId: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const seen = new Set<string>();
    return lines.map((line) => {
      check(
        !seen.has(line.allocationId),
        "VALIDATION",
        "Duplicate allocation.",
        400,
      );
      seen.add(line.allocationId);
      const a = this.store.get<Allocation>(
        "SELECT * FROM inventory_allocations WHERE org_id=? AND id=? AND order_id=?",
        actor.orgId,
        line.allocationId,
        orderId,
      );
      check(a, "NOT_FOUND", "Allocation not found.", 404);
      site(actor, a.warehouse_id);
      const qty = integer(line.quantity, "shipment quantity", 1, 100000),
        u = this.unit(actor, a.unit_id);
      check(
        a.stage === "picked" && a.quantity - a.consumed - a.released >= qty,
        "STATE",
        "Shipment requires remaining picked allocation.",
      );
      check(
        u.state === "stock" && u.condition === "usable" && u.quantity >= qty,
        "STATE",
        "Stock is not shippable.",
      );
      this.store.run(
        "UPDATE inventory_allocations SET consumed=consumed+? WHERE id=?",
        qty,
        a.id,
      );
      this.store.run(
        "UPDATE inventory_units SET quantity=quantity-?,state=?,revision=revision+1 WHERE id=?",
        qty,
        u.serial ? "sold" : "stock",
        u.id,
      );
      this.movement(
        actor,
        u,
        "shipment",
        -qty,
        shipmentId,
        "Committed shipment",
      );
      return {
        unitId: u.id,
        productId: u.product_id,
        quantity: qty,
        unitCost: u.cost,
        serial: u.serial,
        warehouseId: u.warehouse_id,
      };
    });
  }
  dispatchTransfer(
    actor: Actor,
    key: string,
    input: {
      destinationId: string;
      unitId: string;
      quantity: number;
      revision: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "transfer.dispatch",
      key,
      input,
      (cached) => {
        actor = this.custodyActor(actor, ["warehouse"]);
        if (cached) {
          const original = this.store.get<Transfer>(
            "SELECT * FROM inventory_transfers WHERE org_id=? AND id=?",
            actor.orgId,
            cached.id,
          );
          check(original, "NOT_FOUND", "Original transfer not found.", 404);
          site(actor, original.source_id);
        } else site(actor, this.unit(actor, input.unitId).warehouse_id);
      },
      () => {
        const u = this.unit(actor, input.unitId),
          qty = integer(input.quantity, "transfer quantity", 1, 100000);
        this.warehouse(actor, input.destinationId);
        check(
          input.destinationId !== u.warehouse_id,
          "VALIDATION",
          "Select another warehouse.",
          400,
        );
        text(input.reason, "reason", 1000);
        check(
          u.revision === input.revision &&
            u.state === "stock" &&
            u.condition === "usable",
          "STATE",
          "Source stock changed or is unavailable.",
        );
        check(
          qty <= u.quantity - this.reserved(u.id),
          "STOCK",
          "Transfer cannot consume reserved stock.",
        );
        const transferId = id();
        let transit = u;
        if (u.serial || qty === u.quantity) {
          this.store.run(
            "UPDATE inventory_units SET state='transit',revision=revision+1 WHERE id=?",
            u.id,
          );
        } else {
          this.store.run(
            "UPDATE inventory_units SET quantity=quantity-?,revision=revision+1 WHERE id=?",
            qty,
            u.id,
          );
          const unitId = id();
          this.store.run(
            "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?)",
            unitId,
            actor.orgId,
            u.product_id,
            u.warehouse_id,
            u.bin,
            qty,
            u.cost,
            u.condition,
            "transit",
          );
          this.valuations.split(actor.orgId, u.id, unitId, qty);
          transit = this.unit(actor, unitId);
        }
        this.store.run(
          "INSERT INTO inventory_transfers VALUES(?,?,?,?,?,?)",
          transferId,
          actor.orgId,
          u.warehouse_id,
          input.destinationId,
          "transit",
          now(),
        );
        const lineId = id();
        this.store.run(
          "INSERT INTO inventory_transfer_lines(id,org_id,transfer_id,unit_id) VALUES(?,?,?,?)",
          lineId,
          actor.orgId,
          transferId,
          transit.id,
        );
        this.store.run(
          "INSERT INTO inventory_transfer_origins VALUES(?,?,?)",
          lineId,
          actor.orgId,
          u.id,
        );
        this.store.run(
          "INSERT INTO inventory_transfer_manifest VALUES(?,?,?,?,?,?,?,?)",
          lineId,
          actor.orgId,
          transferId,
          transit.id,
          u.product_id,
          u.serial,
          qty,
          u.cost,
        );
        this.movement(
          actor,
          transit,
          "transfer.dispatch",
          -qty,
          transferId,
          input.reason,
        );
        return { id: transferId, lineId, unitId: transit.id };
      },
    );
  }
  transfers(actor: Actor) {
    actor = this.custodyActor(actor, ["warehouse", "support"]);
    return this.store
      .all<Transfer>(
        "SELECT * FROM inventory_transfers WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (t) =>
          actor.role === "admin" ||
          actor.sites.includes(t.source_id) ||
          actor.sites.includes(t.destination_id),
      )
      .map((t) => this.transferDetails(actor, t));
  }
  transferPage(actor: Actor, input: TransferQueueInput = {}) {
    return this.database.transaction(() => {
      actor = this.custodyActor(actor, ["warehouse", "support"]);
      const state = input.state ?? null;
      check(
        state === null || transferQueueStates.includes(state),
        "VALIDATION",
        "Choose a supported transfer state.",
        400,
      );
      const scope = actor.role === "admin" ? null : [...actor.sites].sort();
      const binding = ["transfer-queue", 1, actor.orgId, scope, state];
      const parameters: SQLInputValue[] = [actor.orgId];
      let where = "t.org_id=?";
      if (scope) {
        where += scope.length
          ? ` AND (t.source_id IN (${scope.map(() => "?").join(",")}) OR t.destination_id IN (${scope.map(() => "?").join(",")}))`
          : " AND 0=1";
        parameters.push(...scope, ...scope);
      }
      let anchor: (Transfer & { position: number }) | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Transfer cursor", 4096);
        let cursor: unknown;
        try {
          const bytes = Buffer.from(encoded, "base64url");
          check(
            encoded === input.after && bytes.toString("base64url") === encoded,
            "VALIDATION",
            "Invalid transfer cursor.",
            400,
          );
          cursor = JSON.parse(bytes.toString("utf8"));
        } catch {
          check(false, "VALIDATION", "Invalid transfer cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 6 &&
            JSON.stringify(cursor.slice(0, 5)) === JSON.stringify(binding) &&
            typeof cursor[5] === "string" &&
            cursor[5].length > 0 &&
            cursor[5].length <= 128,
          "VALIDATION",
          "Transfer cursor does not match this organization, sites and state.",
          400,
        );
        anchor = this.store.get<Transfer & { position: number }>(
          `SELECT t.*,t.rowid AS position FROM inventory_transfers t WHERE ${where} AND t.id=?`,
          ...parameters,
          cursor[5],
        );
        check(anchor, "CURSOR", "Transfer cursor is no longer available.", 400);
      }
      // Derive the same live state as transferDetails, before the header limit.
      // Unrecovered losses and legacy whole receipts remain distinguishable.
      const loss = `EXISTS(SELECT 1 FROM inventory_transfer_losses l WHERE l.org_id=t.org_id AND l.transfer_id=t.id AND l.quantity>COALESCE((SELECT SUM(r.quantity) FROM inventory_transfer_recoveries r WHERE r.org_id=l.org_id AND r.loss_id=l.id),0))`;
      const arrivals = `EXISTS(SELECT 1 FROM inventory_transfer_receipts r JOIN inventory_transfer_manifest m ON m.org_id=r.org_id AND m.line_id=r.line_id WHERE m.org_id=t.org_id AND m.transfer_id=t.id)
        OR EXISTS(SELECT 1 FROM inventory_transfer_recoveries r JOIN inventory_transfer_losses l ON l.org_id=r.org_id AND l.id=r.loss_id WHERE l.org_id=t.org_id AND l.transfer_id=t.id)
        OR EXISTS(SELECT 1 FROM inventory_transfer_lines l WHERE l.org_id=t.org_id AND l.transfer_id=t.id AND l.received=1 AND NOT EXISTS(SELECT 1 FROM inventory_transfer_losses x WHERE x.org_id=l.org_id AND x.line_id=l.id))`;
      const effective = `CASE WHEN ${loss} THEN CASE WHEN t.state='transit' THEN 'partially-reconciled' ELSE 'reconciled-with-loss' END WHEN t.state='transit' AND (${arrivals}) THEN 'partially-received' ELSE t.state END`;
      const rows = this.store.all<Transfer & { position: number }>(
        `SELECT t.*,t.rowid AS position FROM inventory_transfers t WHERE ${where}
        ${state ? `AND (${effective})=?` : ""}
        ${anchor ? "AND (t.created_at<? OR (t.created_at=? AND t.rowid<?))" : ""}
        ORDER BY t.created_at DESC,t.rowid DESC LIMIT 21`,
        ...parameters,
        ...(state ? [state] : []),
        ...(anchor
          ? [anchor.created_at, anchor.created_at, anchor.position]
          : []),
      );
      const headers = rows.slice(0, 20);
      const items = headers.map(({ position: _, ...t }) =>
        this.transferDetails(actor, t),
      );
      return {
        items,
        next:
          rows.length > 20
            ? Buffer.from(
                JSON.stringify([...binding, headers[19]!.id]),
              ).toString("base64url")
            : null,
      };
    });
  }
  private transferDetails(actor: Actor, t: Transfer) {
    const lines = this.store
      .all<TransferManifest>(
        "SELECT m.*,l.received FROM inventory_transfer_manifest m JOIN inventory_transfer_lines l ON l.id=m.line_id AND l.org_id=m.org_id WHERE m.org_id=? AND m.transfer_id=?",
        actor.orgId,
        String(t.id),
      )
      .map((line) => {
        const receipts = this.store.all(
          "SELECT id,unit_id,receipt_ref,quantity,condition,bin,reason,actor_id,created_at FROM inventory_transfer_receipts WHERE org_id=? AND line_id=? ORDER BY created_at,id",
          actor.orgId,
          String(line.line_id),
        );
        const recorded = receipts.reduce(
          (sum, r) => sum + Number(r.quantity),
          0,
        );
        const losses = this.store
          .all<{
            id: string;
            loss_ref: string;
            quantity: number;
            unit_cost: number;
            reason: string;
            actor_id: string;
            created_at: string;
          }>(
            "SELECT id,loss_ref,quantity,unit_cost,reason,actor_id,created_at FROM inventory_transfer_losses WHERE org_id=? AND line_id=? ORDER BY created_at,id",
            actor.orgId,
            line.line_id,
          )
          .map((loss) => {
            const recoveries = this.store.all(
              "SELECT id,unit_id,receipt_ref,quantity,condition,bin,reason,actor_id,created_at FROM inventory_transfer_recoveries WHERE org_id=? AND loss_id=? ORDER BY created_at,id",
              actor.orgId,
              String(loss.id),
            );
            const recoveredQuantity = recoveries.reduce(
              (sum, r) => sum + Number(r.quantity),
              0,
            );
            return {
              ...loss,
              recoveredQuantity,
              remainingLostQuantity: Number(loss.quantity) - recoveredQuantity,
              recoveries,
            };
          });
        const lossQuantity = losses.reduce(
          (sum, l) => sum + Number(l.quantity),
          0,
        );
        const recoveredQuantity = losses.reduce(
          (sum, l) => sum + l.recoveredQuantity,
          0,
        );
        const legacyReceived = Boolean(
          line.received && recorded === 0 && lossQuantity === 0,
        );
        const receivedQuantity =
          (legacyReceived ? line.quantity : recorded) + recoveredQuantity;
        const remainingQuantity =
          line.quantity - receivedQuantity - (lossQuantity - recoveredQuantity);
        return {
          ...line,
          receivedQuantity,
          remainingQuantity,
          lossQuantity,
          recoveredQuantity,
          lostQuantity: lossQuantity - recoveredQuantity,
          transitRevision:
            remainingQuantity > 0
              ? this.unit(actor, line.unit_id).revision
              : null,
          legacyReceived,
          receipts,
          losses,
        };
      });
    return {
      ...t,
      source_name: this.warehouse(actor, String(t.source_id)).name,
      destination_name: this.warehouse(actor, String(t.destination_id)).name,
      state: lines.some((l) => l.lostQuantity > 0)
        ? t.state === "transit"
          ? "partially-reconciled"
          : "reconciled-with-loss"
        : t.state === "transit" && lines.some((l) => l.receivedQuantity > 0)
          ? "partially-received"
          : t.state,
      lines,
    };
  }
  receiveTransfer(
    actor: Actor,
    key: string,
    input: {
      transferId: string;
      lineId: string;
      quantity: number;
      serial: string | null;
      receiptRef: string;
      bin: string;
      condition: "usable" | "quarantine" | "damaged";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "transfer.receive",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, ["warehouse"]);
        const t = this.store.get(
          "SELECT * FROM inventory_transfers WHERE org_id=? AND id=?",
          actor.orgId,
          input.transferId,
        );
        check(t, "NOT_FOUND", "Transfer not found.", 404);
        site(actor, String(t.destination_id));
      },
      () => {
        const t = this.store.get(
          "SELECT * FROM inventory_transfers WHERE org_id=? AND id=?",
          actor.orgId,
          input.transferId,
        )!;
        const payload = {
          ...input,
          quantity: integer(input.quantity, "received quantity", 1, 100000),
          serial:
            input.serial === null ? null : text(input.serial, "scanned serial"),
          receiptRef: text(input.receiptRef, "arrival reference"),
          bin: text(input.bin, "bin"),
          reason: text(input.reason, "arrival evidence", 1000),
        };
        check(
          ["usable", "quarantine", "damaged"].includes(input.condition),
          "VALIDATION",
          "Unknown condition.",
          400,
        );
        const hash = digest(canonical(payload));
        const existing = this.store.get(
          "SELECT input_hash,result FROM inventory_transfer_receipts WHERE org_id=? AND line_id=? AND receipt_ref=?",
          actor.orgId,
          input.lineId,
          payload.receiptRef,
        );
        if (existing) {
          check(
            existing.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Arrival reference was already used with different details.",
          );
          return JSON.parse(String(existing.result)) as {
            id: string;
            receiptId: string;
            unitId: string;
            quantity: number;
            remainingQuantity: number;
          };
        }
        check(t.state === "transit", "STATE", "Transfer already received.");
        const line = this.store.get(
          "SELECT m.*,l.received FROM inventory_transfer_manifest m JOIN inventory_transfer_lines l ON l.id=m.line_id AND l.org_id=m.org_id WHERE m.org_id=? AND m.transfer_id=? AND m.line_id=?",
          actor.orgId,
          input.transferId,
          input.lineId,
        );
        check(line, "NOT_FOUND", "Transfer line not found.", 404);
        check(!line.received, "STATE", "Transfer line already received.");
        check(
          payload.serial === line.serial,
          "SERIAL",
          "Scan the serial dispatched on this transfer; leave blank for bulk stock.",
        );
        const recorded = Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM inventory_transfer_receipts WHERE org_id=? AND line_id=?",
            actor.orgId,
            input.lineId,
          )!.qty,
        );
        const remaining =
          Number(line.quantity) -
          recorded -
          this.lostFromTransit(actor, input.lineId);
        check(
          payload.quantity <= remaining,
          "QUANTITY",
          "Receipt exceeds the quantity still in transit.",
        );
        const u = this.unit(actor, String(line.unit_id));
        check(
          u.state === "transit" &&
            u.quantity === remaining &&
            u.warehouse_id === t.source_id &&
            u.cost === line.unit_cost &&
            u.product_id === line.product_id &&
            u.serial === line.serial,
          "STATE",
          "Transfer custody is inconsistent.",
        );
        let unitId = u.id;
        if (payload.quantity === remaining) {
          this.store.run(
            "UPDATE inventory_units SET warehouse_id=?,bin=?,condition=?,state='stock',revision=revision+1 WHERE id=?",
            String(t.destination_id),
            payload.bin,
            input.condition,
            u.id,
          );
        } else {
          check(!u.serial, "QUANTITY", "A serialized unit must arrive whole.");
          this.store.run(
            "UPDATE inventory_units SET quantity=quantity-?,revision=revision+1 WHERE id=?",
            payload.quantity,
            u.id,
          );
          unitId = id();
          this.store.run(
            "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?)",
            unitId,
            actor.orgId,
            u.product_id,
            String(t.destination_id),
            payload.bin,
            payload.quantity,
            u.cost,
            input.condition,
            "stock",
          );
        }
        if (unitId !== u.id)
          this.valuations.split(actor.orgId, u.id, unitId, payload.quantity);
        const remainingQuantity = remaining - payload.quantity;
        this.settleTransfer(
          actor,
          input.transferId,
          input.lineId,
          remainingQuantity,
        );
        const receiptId = id();
        const result = {
          id: input.transferId,
          receiptId,
          unitId,
          quantity: payload.quantity,
          remainingQuantity,
        };
        this.store.run(
          "INSERT INTO inventory_transfer_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          receiptId,
          actor.orgId,
          input.transferId,
          input.lineId,
          unitId,
          payload.receiptRef,
          payload.quantity,
          input.condition,
          payload.bin,
          payload.reason,
          actor.id,
          now(),
          hash,
          JSON.stringify(result),
        );
        this.movement(
          actor,
          this.unit(actor, unitId),
          "transfer.receive",
          payload.quantity,
          input.transferId,
          `${payload.receiptRef}: ${payload.reason}`,
        );
        return result;
      },
    );
  }
  private lostFromTransit(actor: Actor, lineId: string) {
    return Number(
      this.store.get(
        "SELECT COALESCE(SUM(quantity),0) AS qty FROM inventory_transfer_losses WHERE org_id=? AND line_id=?",
        actor.orgId,
        lineId,
      )!.qty,
    );
  }
  private settleTransfer(
    actor: Actor,
    transferId: string,
    lineId: string,
    remaining: number,
  ) {
    if (remaining !== 0) return;
    this.store.run(
      "UPDATE inventory_transfer_lines SET received=1 WHERE org_id=? AND id=?",
      actor.orgId,
      lineId,
    );
    if (
      !this.store.get(
        "SELECT id FROM inventory_transfer_lines WHERE org_id=? AND transfer_id=? AND received=0",
        actor.orgId,
        transferId,
      )
    )
      this.store.run(
        "UPDATE inventory_transfers SET state='received' WHERE org_id=? AND id=?",
        actor.orgId,
        transferId,
      );
  }
  approveTransferLoss(
    actor: Actor,
    key: string,
    input: {
      transferId: string;
      lineId: string;
      revision: number;
      quantity: number;
      serial: string | null;
      lossRef: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "transfer.loss",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
        check(
          this.store.get(
            "SELECT id FROM inventory_transfers WHERE org_id=? AND id=?",
            actor.orgId,
            input.transferId,
          ),
          "NOT_FOUND",
          "Transfer not found.",
          404,
        );
      },
      () => {
        const payload = {
          ...input,
          revision: integer(input.revision, "stock revision", 1),
          quantity: integer(input.quantity, "lost quantity", 1, 100000),
          serial:
            input.serial === null
              ? null
              : text(input.serial, "recorded serial"),
          lossRef: text(input.lossRef, "loss evidence reference"),
          reason: text(input.reason, "loss approval evidence", 1000),
        };
        const hash = digest(canonical(payload));
        const prior = this.store.get(
          "SELECT input_hash,result FROM inventory_transfer_losses WHERE org_id=? AND line_id=? AND loss_ref=?",
          actor.orgId,
          input.lineId,
          payload.lossRef,
        );
        if (prior) {
          check(
            prior.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Loss reference was already used with different details.",
          );
          return JSON.parse(String(prior.result)) as {
            id: string;
            lossId: string;
            quantity: number;
            remainingQuantity: number;
            unitCost: number;
          };
        }
        const t = this.store.get<Transfer>(
          "SELECT * FROM inventory_transfers WHERE org_id=? AND id=?",
          actor.orgId,
          input.transferId,
        )!;
        const line = this.store.get<TransferManifest>(
          "SELECT m.*,l.received FROM inventory_transfer_manifest m JOIN inventory_transfer_lines l ON l.id=m.line_id AND l.org_id=m.org_id WHERE m.org_id=? AND m.transfer_id=? AND m.line_id=?",
          actor.orgId,
          input.transferId,
          input.lineId,
        );
        check(line, "NOT_FOUND", "Transfer line not found.", 404);
        check(
          t.state === "transit" && !line.received,
          "STATE",
          "Transfer line has no unresolved transit stock.",
        );
        check(
          payload.serial === line.serial,
          "SERIAL",
          "Confirm the serial on the dispatch manifest; leave blank for bulk stock.",
        );
        const arrived = Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM inventory_transfer_receipts WHERE org_id=? AND line_id=?",
            actor.orgId,
            input.lineId,
          )!.qty,
        );
        const remaining =
          line.quantity - arrived - this.lostFromTransit(actor, input.lineId);
        const u = this.unit(actor, line.unit_id);
        check(
          u.revision === payload.revision,
          "REVISION",
          "Transit stock changed; refresh before approving loss.",
        );
        check(
          u.state === "transit" &&
            u.quantity === remaining &&
            u.warehouse_id === t.source_id &&
            u.cost === line.unit_cost &&
            u.product_id === line.product_id &&
            u.serial === line.serial,
          "STATE",
          "Transfer custody is inconsistent.",
        );
        check(
          payload.quantity <= remaining,
          "QUANTITY",
          "Loss exceeds the quantity still in transit.",
        );
        const remainingQuantity = remaining - payload.quantity;
        this.store.run(
          "UPDATE inventory_units SET quantity=?,revision=revision+1 WHERE id=?",
          remainingQuantity,
          u.id,
        );
        this.settleTransfer(actor, t.id, line.line_id, remainingQuantity);
        const lossId = id();
        const result = {
          id: t.id,
          lossId,
          quantity: payload.quantity,
          remainingQuantity,
          unitCost: line.unit_cost,
        };
        this.store.run(
          "INSERT INTO inventory_transfer_losses VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          lossId,
          actor.orgId,
          t.id,
          line.line_id,
          payload.lossRef,
          payload.quantity,
          line.unit_cost,
          payload.reason,
          actor.id,
          now(),
          hash,
          JSON.stringify(result),
        );
        this.movement(
          actor,
          u,
          "transfer.loss",
          -payload.quantity,
          lossId,
          `${payload.lossRef}: ${payload.reason}`,
        );
        return result;
      },
    );
  }
  recoverTransferLoss(
    actor: Actor,
    key: string,
    input: {
      lossId: string;
      quantity: number;
      serial: string | null;
      receiptRef: string;
      bin: string;
      condition: "usable" | "quarantine" | "damaged";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "transfer.recover",
      key,
      input,
      () => {
        actor = this.custodyActor(actor, []);
        check(
          this.store.get(
            "SELECT id FROM inventory_transfer_losses WHERE org_id=? AND id=?",
            actor.orgId,
            input.lossId,
          ),
          "NOT_FOUND",
          "Transfer loss not found.",
          404,
        );
      },
      () => {
        const payload = {
          ...input,
          quantity: integer(input.quantity, "recovered quantity", 1, 100000),
          serial:
            input.serial === null ? null : text(input.serial, "scanned serial"),
          receiptRef: text(input.receiptRef, "recovery reference"),
          bin: text(input.bin, "destination bin"),
          reason: text(input.reason, "recovery evidence", 1000),
        };
        check(
          ["usable", "quarantine", "damaged"].includes(input.condition),
          "VALIDATION",
          "Unknown condition.",
          400,
        );
        const hash = digest(canonical(payload));
        const prior = this.store.get(
          "SELECT input_hash,result FROM inventory_transfer_recoveries WHERE org_id=? AND loss_id=? AND receipt_ref=?",
          actor.orgId,
          input.lossId,
          payload.receiptRef,
        );
        if (prior) {
          check(
            prior.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Recovery reference was already used with different details.",
          );
          return JSON.parse(String(prior.result)) as {
            id: string;
            receiptId: string;
            unitId: string;
            quantity: number;
            remainingLostQuantity: number;
          };
        }
        const loss = this.store.get<TransferLoss>(
          "SELECT * FROM inventory_transfer_losses WHERE org_id=? AND id=?",
          actor.orgId,
          input.lossId,
        )!;
        const t = this.store.get<Transfer>(
          "SELECT * FROM inventory_transfers WHERE org_id=? AND id=?",
          actor.orgId,
          loss.transfer_id,
        );
        const line = this.store.get<TransferManifest>(
          "SELECT m.*,l.received FROM inventory_transfer_manifest m JOIN inventory_transfer_lines l ON l.id=m.line_id AND l.org_id=m.org_id WHERE m.org_id=? AND m.transfer_id=? AND m.line_id=?",
          actor.orgId,
          loss.transfer_id,
          loss.line_id,
        );
        check(
          t && line && line.unit_cost === loss.unit_cost,
          "STATE",
          "Loss manifest is inconsistent.",
        );
        check(
          payload.serial === line.serial,
          "SERIAL",
          "Scan the lost serial; leave blank for bulk stock.",
        );
        const recovered = Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS qty FROM inventory_transfer_recoveries WHERE org_id=? AND loss_id=?",
            actor.orgId,
            loss.id,
          )!.qty,
        );
        check(
          payload.quantity <= loss.quantity - recovered,
          "QUANTITY",
          "Recovery exceeds the unrecovered loss.",
        );
        let unitId: string;
        if (line.serial) {
          const u = this.unit(actor, line.unit_id);
          check(
            payload.quantity === 1 &&
              u.quantity === 0 &&
              u.state === "transit" &&
              u.serial === line.serial &&
              u.product_id === line.product_id &&
              u.cost === line.unit_cost &&
              u.warehouse_id === t.source_id,
            "STATE",
            "Lost serial custody is inconsistent.",
          );
          unitId = u.id;
          this.store.run(
            "UPDATE inventory_units SET quantity=1,warehouse_id=?,bin=?,condition=?,state='stock',revision=revision+1 WHERE id=?",
            t.destination_id,
            payload.bin,
            input.condition,
            unitId,
          );
        } else {
          unitId = id();
          this.store.run(
            "INSERT INTO inventory_units(id,org_id,product_id,warehouse_id,bin,quantity,cost,condition,state) VALUES(?,?,?,?,?,?,?,?,?)",
            unitId,
            actor.orgId,
            line.product_id,
            t.destination_id,
            payload.bin,
            payload.quantity,
            line.unit_cost,
            input.condition,
            "stock",
          );
        }
        const receiptId = id();
        const result = {
          id: t.id,
          receiptId,
          unitId,
          quantity: payload.quantity,
          remainingLostQuantity: loss.quantity - recovered - payload.quantity,
        };
        this.store.run(
          "INSERT INTO inventory_transfer_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          receiptId,
          actor.orgId,
          loss.id,
          unitId,
          payload.receiptRef,
          payload.quantity,
          input.condition,
          payload.bin,
          payload.reason,
          actor.id,
          now(),
          hash,
          JSON.stringify(result),
        );
        this.valuations.recover(actor.orgId, unitId, loss.id, payload.quantity);
        this.movement(
          actor,
          this.unit(actor, unitId),
          "transfer.recover",
          payload.quantity,
          loss.id,
          `${payload.receiptRef}: ${payload.reason}`,
        );
        return result;
      },
    );
  }
  // Called by Warranty inside the shared business transaction; Inventory owns custody.
  replacementCustody(actor: Actor, reference: string) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const hold = this.store.get<{
      id: string;
      org_id: string;
      unit_id: string;
      state: string;
    }>(
      "SELECT * FROM inventory_replacements WHERE org_id=? AND id=?",
      actor.orgId,
      reference,
    );
    check(hold, "NOT_FOUND", "Replacement custody not found.", 404);
    const unit = this.unit(actor, hold.unit_id);
    site(actor, unit.warehouse_id);
    return {
      hold,
      unit,
      reservedQuantity: this.reserved(unit.id),
      description: this.catalog.product(actor, unit.product_id).name,
    };
  }
  reserveReplacement(
    actor: Actor,
    reference: string,
    unitId: string,
    productId: string,
  ) {
    actor = this.custodyActor(actor, ["warranty"]);
    const u = this.unit(actor, unitId);
    site(actor, u.warehouse_id);
    check(
      u.product_id === productId &&
        u.serial &&
        u.state === "stock" &&
        u.condition === "usable" &&
        u.quantity === 1 &&
        this.reserved(u.id) === 0,
      "REPLACEMENT_STOCK",
      "Replacement requires an unreserved usable serial of the same product.",
    );
    this.store.run(
      "INSERT INTO inventory_replacements VALUES(?,?,?,'reserved')",
      reference,
      actor.orgId,
      u.id,
    );
    this.movement(
      actor,
      u,
      "replacement.reserve",
      0,
      reference,
      "Approved replacement reservation",
    );
  }
  releaseReplacement(actor: Actor, reference: string, reason: string) {
    actor = this.custodyActor(actor, ["warranty"]);
    const r = this.store.get(
      "SELECT * FROM inventory_replacements WHERE org_id=? AND id=?",
      actor.orgId,
      reference,
    );
    check(
      r && r.state === "reserved",
      "STATE",
      "Replacement reservation is not open.",
    );
    const u = this.unit(actor, String(r.unit_id));
    site(actor, u.warehouse_id);
    this.store.run(
      "UPDATE inventory_replacements SET state='cancelled' WHERE id=?",
      reference,
    );
    this.movement(
      actor,
      u,
      "replacement.cancel",
      0,
      reference,
      text(reason, "cancellation reason", 1000),
    );
  }
  handoverReplacement(
    actor: Actor,
    reference: string,
    serial: string,
    evidence: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse"]);
    const r = this.store.get(
      "SELECT * FROM inventory_replacements WHERE org_id=? AND id=?",
      actor.orgId,
      reference,
    );
    check(
      r && r.state === "reserved",
      "STATE",
      "Replacement reservation is not open.",
    );
    const u = this.unit(actor, String(r.unit_id));
    site(actor, u.warehouse_id);
    check(
      u.serial === serial,
      "SERIAL",
      "Scanned replacement serial does not match.",
    );
    check(
      u.state === "stock" &&
        u.condition === "usable" &&
        u.quantity === 1 &&
        this.reserved(u.id) === 1,
      "STATE",
      "Replacement stock is not ready for handover.",
    );
    this.store.run(
      "UPDATE inventory_replacements SET state='handed_over' WHERE id=?",
      reference,
    );
    this.store.run(
      "UPDATE inventory_units SET state='sold',quantity=0,revision=revision+1 WHERE id=?",
      u.id,
    );
    this.movement(
      actor,
      u,
      "replacement.handover",
      -1,
      reference,
      text(evidence, "handover evidence", 2000),
    );
  }
  // Internal candidates only: the warranty owner resolves current customer
  // entitlement before returning any of these records to an API caller.
  soldSerialCandidates(actor: Actor, query: string, after?: string) {
    actor = this.custodyActor(actor, ["warranty", "commercial", "buyer"]);
    const where =
      "org_id=? AND state='sold' AND quantity=0 AND serial IS NOT NULL AND instr(lower(serial),lower(?))>0";
    const cursor =
      after === undefined
        ? undefined
        : this.store.get<{ id: string; serial: string }>(
            `SELECT id,serial FROM inventory_units WHERE ${where} AND id=?`,
            actor.orgId,
            query,
            after,
          );
    check(
      after === undefined || cursor,
      "CURSOR",
      "Sold serial cursor is unavailable in the current search.",
      400,
    );
    return this.store.all<{ id: string; productId: string; serial: string }>(
      `SELECT id,product_id AS productId,serial FROM inventory_units WHERE ${where}
       ${cursor ? "AND (serial>? OR (serial=? AND id>?))" : ""}
       ORDER BY serial,id LIMIT 21`,
      actor.orgId,
      query,
      ...(cursor ? [cursor.serial, cursor.serial, cursor.id] : []),
    );
  }
  shipmentReference(actor: Actor, unitId: string): string | null {
    actor = this.custodyReader(actor);
    this.unit(actor, unitId);
    return (
      this.store.get<{ reference: string }>(
        "SELECT reference FROM inventory_movements WHERE org_id=? AND unit_id=? AND type='shipment' ORDER BY rowid DESC LIMIT 1",
        actor.orgId,
        unitId,
      )?.reference ?? null
    );
  }
  soldCustody(actor: Actor, unitId: string) {
    actor = this.custodyReader(actor);
    const u = this.unit(actor, unitId);
    check(
      u.serial && u.state === "sold" && u.quantity === 0,
      "STATE",
      "Unit is not currently in sold custody.",
    );
    const custody = this.store.get<{ type: string; reference: string }>(
      "SELECT type,reference FROM inventory_movements WHERE org_id=? AND unit_id=? AND type IN('shipment','replacement.handover') ORDER BY rowid DESC LIMIT 1",
      actor.orgId,
      unitId,
    );
    check(custody, "NOT_FOUND", "Sold custody evidence is missing.", 404);
    return custody;
  }
  receiveReturn(
    actor: Actor,
    unitId: string,
    warehouseId: string,
    bin: string,
    reference: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse"]);
    site(actor, warehouseId);
    this.warehouse(actor, warehouseId);
    const u = this.unit(actor, unitId);
    check(
      u.serial && u.state === "sold" && u.quantity === 0,
      "STATE",
      "Serialized return requires sold custody.",
    );
    this.store.run(
      "UPDATE inventory_units SET quantity=1,warehouse_id=?,bin=?,condition='quarantine',state='stock',revision=revision+1 WHERE id=?",
      warehouseId,
      text(bin, "return bin"),
      unitId,
    );
    this.movement(
      actor,
      this.unit(actor, unitId),
      "return",
      1,
      reference,
      "Authorized return in quarantine",
    );
  }
  returnDisposition(
    actor: Actor,
    unitId: string,
    disposition: "restock" | "scrap" | "repair",
    reference: string,
    reason: string,
  ) {
    actor = this.custodyActor(actor, ["warehouse", "warranty"]);
    const u = this.unit(actor, unitId);
    site(actor, u.warehouse_id);
    check(
      u.state === "stock" &&
        u.quantity > 0 &&
        u.condition === "quarantine" &&
        this.reserved(u.id) === 0,
      "STATE",
      "Return requires present, unallocated quarantine custody.",
    );
    text(reason, "disposition reason", 1000);
    if (disposition === "scrap") {
      this.store.run(
        "UPDATE inventory_units SET state='scrapped',quantity=0,revision=revision+1 WHERE id=?",
        u.id,
      );
      this.movement(actor, u, "scrap", -u.quantity, reference, reason);
    } else if (disposition === "restock") {
      this.store.run(
        "UPDATE inventory_units SET condition='usable',revision=revision+1 WHERE id=?",
        u.id,
      );
      this.movement(actor, u, "restock", 0, reference, reason);
    } else this.movement(actor, u, "repair", 0, reference, reason);
  }
}
