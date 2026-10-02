import { permit, type Actor } from "./core.ts";
import type { Store } from "./database.ts";
import { movementSigns } from "./inventory-costs.ts";
import { IssueCollector } from "./control-issues.ts";
import type { StockControls } from "../shared/reconciliation.ts";
// Called by the application inside its authorized, single snapshot transaction.
export function stockControls(store: Store, actor: Actor): StockControls {
  permit(actor, ["finance"]);
  const issues = new IssueCollector(),
    products = new Map<
      string,
      {
        quantity: bigint;
        value: bigint;
        movementQuantity: bigint;
        movementValue: bigint;
      }
    >();
  const product = (id: string) => {
    let row = products.get(id);
    if (!row) {
      row = {
        quantity: 0n,
        value: 0n,
        movementQuantity: 0n,
        movementValue: 0n,
      };
      products.set(id, row);
    }
    return row;
  };
  let units = 0,
    movements = 0;
  // CAST preserves SQLite's exact 64-bit integers before any JS number conversion.
  store.visit<{
    id: string;
    product: string;
    quantity: string;
    cost: string;
    state: string;
  }>(
    "SELECT id,product_id AS product,CAST(quantity AS TEXT) AS quantity,CAST(cost AS TEXT) AS cost,state FROM inventory_units WHERE org_id=? ORDER BY rowid",
    [actor.orgId],
    (u) => {
      units++;
      const q = BigInt(u.quantity),
        cost = BigInt(u.cost),
        p = product(u.product);
      p.quantity += q;
      p.value += q * cost;
      if (!["stock", "transit"].includes(u.state) && q !== 0n)
        issues.add("NONPHYSICAL_QUANTITY", u.id, 0n, q);
      if (
        q > BigInt(Number.MAX_SAFE_INTEGER) ||
        cost > BigInt(Number.MAX_SAFE_INTEGER)
      )
        issues.add("UNSAFE_STOCK_INTEGER", u.id);
    },
  );
  store.visit<{
    id: string;
    product: string | null;
    type: string;
    quantity: string;
    cost: string;
    sequence: number | null;
    created: string;
  }>(
    `SELECT m.id,u.product_id AS product,m.type,CAST(m.quantity AS TEXT) AS quantity,CAST(m.unit_cost AS TEXT) AS cost,s.sequence,m.created_at AS created
     FROM inventory_movements m LEFT JOIN inventory_units u ON u.org_id=m.org_id AND u.id=m.unit_id
     LEFT JOIN inventory_cost_sequences s ON s.org_id=m.org_id AND s.movement_id=m.id
     WHERE m.org_id=? ORDER BY m.rowid`,
    [actor.orgId],
    (m) => {
      movements++;
      const q = BigInt(m.quantity),
        cost = BigInt(m.cost),
        sign = Object.hasOwn(movementSigns, m.type)
          ? movementSigns[m.type]
          : undefined;
      if (m.sequence === null) issues.add("MISSING_MOVEMENT_SEQUENCE", m.id);
      if (m.product === null) issues.add("MISSING_MOVEMENT_UNIT", m.id);
      if (!sign) issues.add("UNSUPPORTED_MOVEMENT", m.id);
      else if (
        (sign === "zero" && q !== 0n) ||
        (sign === "positive" && q <= 0n) ||
        (sign === "negative" && q >= 0n) ||
        (["transfer.dispatch", "relocation.split.out"].includes(m.type) &&
          q >= 0n) ||
        (["transfer.receive", "relocation.split.in"].includes(m.type) &&
          q <= 0n)
      )
        issues.add("MOVEMENT_DIRECTION", m.id);
      if (
        cost < 0n ||
        q > BigInt(Number.MAX_SAFE_INTEGER) ||
        q < -BigInt(Number.MAX_SAFE_INTEGER) ||
        cost > BigInt(Number.MAX_SAFE_INTEGER)
      )
        issues.add("UNSAFE_MOVEMENT_INTEGER", m.id);
      if (
        !Number.isFinite(Date.parse(m.created)) ||
        new Date(m.created).toISOString() !== m.created
      )
        issues.add("MOVEMENT_TIMESTAMP", m.id);
      if (m.product !== null) {
        const p = product(m.product),
          delta = sign === "transfer" ? 0n : q;
        p.movementQuantity += delta;
        p.movementValue += delta * cost;
      }
    },
  );
  store.visit<{ id: string }>(
    `SELECT s.movement_id AS id FROM inventory_cost_sequences s LEFT JOIN inventory_movements m ON m.org_id=s.org_id AND m.id=s.movement_id WHERE s.org_id=? AND m.id IS NULL ORDER BY s.sequence`,
    [actor.orgId],
    (s) => issues.add("ORPHAN_MOVEMENT_SEQUENCE", s.id),
  );
  let quantity = 0n,
    value = 0n,
    movementQuantity = 0n,
    movementValue = 0n;
  for (const [id, p] of products) {
    issues.compare("PRODUCT_QUANTITY", id, p.movementQuantity, p.quantity);
    issues.compare("PRODUCT_VALUE", id, p.movementValue, p.value);
    quantity += p.quantity;
    value += p.value;
    movementQuantity += p.movementQuantity;
    movementValue += p.movementValue;
  }
  return {
    products: products.size,
    units,
    movements,
    quantity: String(quantity),
    value: String(value),
    movementQuantity: String(movementQuantity),
    movementValue: String(movementValue),
    issues: issues.result(),
  };
}
