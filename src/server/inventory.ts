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
import { InventoryCosts } from "./inventory-costs.ts";
import { Identity } from "./iam.ts";
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
  constructor(
    database: Database,
    private platform: Platform,
    private catalog: Catalog,
    private identity: Identity,
  ) {
    this.store = database.owned("inventory");
    this.costs = new InventoryCosts(this.store);
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
      INSERT OR IGNORE INTO inventory_transfer_manifest
        SELECT l.id,l.org_id,l.transfer_id,l.unit_id,u.product_id,u.serial,-m.quantity,m.unit_cost
        FROM inventory_transfer_lines l JOIN inventory_units u ON u.id=l.unit_id AND u.org_id=l.org_id
        JOIN inventory_movements m ON m.org_id=l.org_id AND m.unit_id=l.unit_id AND m.reference=l.transfer_id AND m.type='transfer.dispatch' AND m.quantity<0;
    `);
    database.transaction(() => {
      if (!this.store.get("SELECT id FROM inventory_cost_clock WHERE id=1")) {
        this.store.run(
          "INSERT INTO inventory_cost_sequences(org_id,movement_id) SELECT org_id,id FROM inventory_movements ORDER BY rowid",
        );
        this.store.run(
          "INSERT INTO inventory_cost_clock VALUES(1,(SELECT COALESCE(MAX(sequence),0) FROM inventory_cost_sequences))",
        );
      }
    });
  }
  warehouses(actor: Actor) {
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
    const row = this.store.get(
      "SELECT * FROM inventory_warehouses WHERE org_id=? AND id=?",
      actor.orgId,
      warehouseId,
    );
    check(row, "NOT_FOUND", "Warehouse not found.", 404);
    return row;
  }
  transferDestinations(actor: Actor) {
    permit(actor, ["warehouse", "support"]);
    return this.store.all<{ id: string; name: string }>(
      "SELECT id,name FROM inventory_warehouses WHERE org_id=? ORDER BY name",
      actor.orgId,
    );
  }
  warehouseByName(actor: Actor, name: string) {
    permit(actor, []);
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
      () => permit(actor, []),
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
    permit(actor, [
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
  availability(actor: Actor, productId: string, warehouseId: string) {
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
    permit(actor, ["warehouse", "commercial", "finance"]);
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
      ), lineage(unit_id) AS (
        SELECT ? UNION SELECT e.parent FROM edges e JOIN lineage a ON e.child=a.unit_id
      ) SELECT DISTINCT m.reference FROM lineage a JOIN inventory_movements m ON m.unit_id=a.unit_id
      WHERE m.org_id=? AND m.type='receipt'`,
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
    permit(actor, []);
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
  trace(actor: Actor, serial: string) {
    permit(actor, ["warehouse", "commercial", "warranty", "support"]);
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
    this.platform.event(actor, `inventory.${type}`, reference, {
      unitId: unit.id,
      warehouseId: unit.warehouse_id,
      quantity,
    });
  }
  assertNewSerials(actor: Actor, serials: string[]) {
    permit(actor, ["warehouse"]);
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
    permit(actor, ["warehouse"]);
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
    permit(actor, []);
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
        permit(actor, ["warehouse"]);
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
        permit(actor, []);
        site(actor, this.unit(actor, input.unitId).warehouse_id);
      },
      () => this.applyCount(actor, input, input.unitId),
    );
  }
  private applyCount(
    actor: Actor,
    input: { unitId: string; revision: number; count: number; reason: string },
    reference: string,
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
    this.movement(actor, u, "count", count - u.quantity, reference, reason);
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
    permit(actor, ["warehouse", "support"]);
    return this.store
      .all<Count>(
        "SELECT * FROM inventory_counts WHERE org_id=? ORDER BY created_at DESC,id",
        actor.orgId,
      )
      .filter(
        (c) => actor.role === "admin" || actor.sites.includes(c.warehouse_id),
      )
      .map(({ start_hash, decision_result, ...c }) => ({
        ...c,
        delta:
          c.observed_quantity === null
            ? null
            : c.observed_quantity - c.expected_quantity,
        valueDelta:
          c.observed_quantity === null
            ? null
            : (c.observed_quantity - c.expected_quantity) * c.unit_cost,
        result: decision_result ? JSON.parse(decision_result) : null,
      }));
  }
  private custodyActor(actor: Actor, roles: Actor["role"][]) {
    const current = this.identity.currentActor(actor);
    permit(current, roles);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing serial custody.",
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
        permit(actor, ["warehouse"]);
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
        permit(actor, ["warehouse"]);
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
    input: { countId: string; decision: "approve" | "reject"; reason: string },
  ) {
    return this.platform.command(
      actor,
      "count.decide",
      key,
      input,
      () => {
        permit(actor, []);
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
          };
        }
        check(
          input.decision === "reject" ||
            (c.state === "submitted" && c.observed_quantity !== null),
          "STATE",
          "Submit the physical observation before approval.",
        );
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
        const result = { id: c.id, state, adjustment };
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
    return this.store.all<Allocation>(
      "SELECT * FROM inventory_allocations WHERE org_id=? AND order_id=? ORDER BY rowid",
      actor.orgId,
      orderId,
    );
  }
  pick(actor: Actor, allocationId: string, serial: string | null) {
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
    permit(actor, ["warehouse"]);
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
        permit(actor, ["warehouse"]);
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
    permit(actor, ["warehouse", "support"]);
    return this.store
      .all<Transfer>(
        "SELECT * FROM inventory_transfers WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (t) =>
          actor.role === "admin" ||
          actor.sites.includes(String(t.source_id)) ||
          actor.sites.includes(String(t.destination_id)),
      )
      .map((t) => {
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
                  remainingLostQuantity:
                    Number(loss.quantity) - recoveredQuantity,
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
              line.quantity -
              receivedQuantity -
              (lossQuantity - recoveredQuantity);
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
          destination_name: this.warehouse(actor, String(t.destination_id))
            .name,
          state: lines.some((l) => l.lostQuantity > 0)
            ? t.state === "transit"
              ? "partially-reconciled"
              : "reconciled-with-loss"
            : t.state === "transit" && lines.some((l) => l.receivedQuantity > 0)
              ? "partially-received"
              : t.state,
          lines,
        };
      });
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
        permit(actor, ["warehouse"]);
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
        permit(actor, []);
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
        permit(actor, []);
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
  reserveReplacement(
    actor: Actor,
    reference: string,
    unitId: string,
    productId: string,
  ) {
    permit(actor, ["warranty"]);
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
    permit(actor, ["warranty"]);
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
    permit(actor, ["warehouse"]);
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
  soldCustody(actor: Actor, unitId: string) {
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
