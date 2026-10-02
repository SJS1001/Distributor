import { IssueCollector } from "./control-issues.ts";
import { reservationControls } from "./reservation-controls.ts";
import type {
  OrderSalesEvidence,
  FulfillmentSalesEvidence,
  InventorySalesEvidence,
  BillingSalesEvidence,
} from "./sales-evidence.ts";
import type { SalesControls } from "../shared/reconciliation.ts";

type Packed = { allocationId: string; quantity: number };
type Shipped = {
  unitId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
};
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;
const integer = (v: unknown, minimum: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= minimum;
const packed = (v: unknown): v is Packed =>
  object(v) && identifier(v.allocationId) && integer(v.quantity, 1);
const shipped = (v: unknown): v is Shipped =>
  object(v) &&
  identifier(v.unitId) &&
  identifier(v.productId) &&
  identifier(v.warehouseId) &&
  integer(v.quantity, 1) &&
  integer(v.unitCost, 0);
const key = (...parts: (string | null)[]) => JSON.stringify(parts);
const add = (map: Map<string, bigint>, id: string, n: bigint) =>
  map.set(id, (map.get(id) ?? 0n) + n);

// No SQL or business writes here. Owning modules provide scoped evidence in the
// application transaction. Agreement does not establish which record is true.
export function salesControls(
  orderEvidence: OrderSalesEvidence,
  shipments: FulfillmentSalesEvidence,
  inventory: InventorySalesEvidence,
  billing: BillingSalesEvidence,
  currency: string,
): SalesControls {
  const issues = new IssueCollector(),
    orders = new Map(orderEvidence.orders.map((o) => [o.id, o])),
    orderLines = new Map(
      orderEvidence.lines.map((l) => [key(l.order, l.product), l]),
    ),
    allocations = new Map(inventory.allocations.map((a) => [a.id, a])),
    invoiceMap = new Map(billing.invoices.map((i) => [i.id, i])),
    shipmentMap = new Map(shipments.map((s) => [s.id, s])),
    consumed = new Map<string, bigint>(),
    supplied = new Map<string, bigint>(),
    unitsByShipment = new Map<string, Map<string, bigint>>(),
    movementByShipment = new Map<string, Map<string, bigint>>(),
    productsByShipment = new Map<string, Map<string, bigint>>(),
    productsByInvoice = new Map<string, Map<string, bigint>>();
  let shippedQuantity = 0n,
    shippedCost = 0n,
    movementQuantity = 0n,
    movementCost = 0n,
    invoicedQuantity = 0n,
    invoiceNet = 0n,
    invoiceTax = 0n;
  const exact = (value: string, id: string) => {
    const n = BigInt(value);
    if (
      n > BigInt(Number.MAX_SAFE_INTEGER) ||
      n < -BigInt(Number.MAX_SAFE_INTEGER)
    )
      issues.add("UNSAFE_SALES_INTEGER", id);
    return n;
  };
  const match = (
    code: string,
    id: string,
    expected: string,
    actual: string | null,
  ) => {
    if (expected !== actual) issues.add(code, id, expected, actual);
  };
  const read = <T>(
    raw: string,
    valid: (v: unknown) => v is T,
    code: string,
    id: string,
  ): T[] => {
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values) || !values.every(valid)) {
        issues.add(code, id);
        return [];
      }
      return values;
    } catch {
      // Never echo raw retained JSON: it can contain addresses and serials.
      issues.add(code, id);
      return [];
    }
  };
  for (const order of orders.values())
    match("SALE_ORDER_CURRENCY", order.id, currency, order.currency);
  for (const s of shipments) {
    const lines = read(s.lines, packed, "SALE_PACKED_EVIDENCE", s.id),
      units = read(s.units, shipped, "SALE_UNIT_EVIDENCE", s.id),
      order = orders.get(s.order);
    if (!order) issues.add("SALE_SHIPMENT_ORDER", s.id);
    else {
      match("SALE_SHIPMENT_ACCOUNT", s.id, order.account, s.account);
      match("SALE_SHIPMENT_WAREHOUSE", s.id, order.warehouse, s.warehouse);
    }
    if (!lines.length) issues.add("SALE_MISSING_PACKED_LINES", s.id);
    if (s.state !== "shipped") {
      if (units.length || s.invoice !== null)
        issues.add("SALE_UNCOMMITTED_EVIDENCE", s.id);
      continue;
    }
    if (!units.length) issues.add("SALE_MISSING_UNITS", s.id);
    if (units.length !== lines.length) issues.add("SALE_UNIT_LINE_COUNT", s.id);
    const invoice = s.invoice === null ? undefined : invoiceMap.get(s.invoice);
    if (!invoice || invoice.opening) issues.add("SALE_SHIPMENT_INVOICE", s.id);
    else match("SALE_INVOICE_REVERSE_LINK", s.id, s.id, invoice.shipment);
    const seen = new Set<string>(),
      unitTotals = new Map<string, bigint>(),
      products = new Map<string, bigint>();
    unitsByShipment.set(s.id, unitTotals);
    productsByShipment.set(s.id, products);
    for (const [index, line] of lines.entries()) {
      if (seen.has(line.allocationId))
        issues.add("SALE_DUPLICATE_ALLOCATION", s.id);
      seen.add(line.allocationId);
      add(consumed, line.allocationId, BigInt(line.quantity));
      const a = allocations.get(line.allocationId),
        u = units[index];
      if (!a) issues.add("SALE_SHIPMENT_ALLOCATION", s.id);
      else {
        match("SALE_ALLOCATION_ORDER", a.id, s.order, a.order);
        match("SALE_ALLOCATION_WAREHOUSE", a.id, s.warehouse, a.warehouse);
        if (u) {
          match("SALE_ALLOCATION_UNIT", a.id, a.unit, u.unitId);
          match("SALE_ALLOCATION_PRODUCT", a.id, a.product, u.productId);
        }
      }
      if (u)
        issues.compare(
          "SALE_PACKED_QUANTITY",
          s.id,
          BigInt(line.quantity),
          BigInt(u.quantity),
        );
    }
    for (const u of units) {
      const quantity = BigInt(u.quantity),
        cost = BigInt(u.unitCost);
      shippedQuantity += quantity;
      shippedCost += quantity * cost;
      match("SALE_UNIT_WAREHOUSE", s.id, s.warehouse, u.warehouseId);
      if (!orderLines.has(key(s.order, u.productId)))
        issues.add("SALE_UNIT_ORDER_LINE", s.id);
      add(supplied, key(s.order, u.productId), quantity);
      add(products, u.productId, quantity);
      add(
        unitTotals,
        key(u.unitId, u.productId, u.warehouseId, String(u.unitCost)),
        quantity,
      );
    }
  }
  for (const a of allocations.values()) {
    const recorded = exact(a.consumed, a.id),
      expected = consumed.get(a.id) ?? 0n;
    issues.compare("SALE_ALLOCATION_CONSUMED", a.id, expected, recorded);
    if (recorded || expected) {
      match("SALE_ALLOCATION_UNIT_PRODUCT", a.id, a.product, a.unitProduct);
      if (!orders.has(a.order)) issues.add("SALE_CONSUMED_ORDER", a.id);
      if (!orderLines.has(key(a.order, a.product)))
        issues.add("SALE_CONSUMED_ORDER_LINE", a.id);
    }
  }
  for (const l of orderEvidence.lines) {
    if (!orders.has(l.order)) issues.add("SALE_ORPHAN_ORDER_LINE", l.id);
    issues.compare(
      "SALE_ORDER_SHIPPED",
      l.id,
      supplied.get(key(l.order, l.product)) ?? 0n,
      exact(l.shipped, l.id),
    );
  }
  for (const m of inventory.movements) {
    const quantity = -exact(m.quantity, m.id),
      cost = exact(m.cost, m.id);
    movementQuantity += quantity;
    movementCost += quantity * cost;
    if (quantity <= 0n || cost < 0n)
      issues.add("SALE_MOVEMENT_DIRECTION", m.id);
    if (m.product === null) issues.add("SALE_MOVEMENT_UNIT", m.id);
    if (shipmentMap.get(m.shipment)?.state !== "shipped")
      issues.add("SALE_ORPHAN_MOVEMENT", m.id);
    let totals = movementByShipment.get(m.shipment);
    if (!totals) movementByShipment.set(m.shipment, (totals = new Map()));
    add(totals, key(m.unit, m.product, m.warehouse, m.cost), quantity);
  }
  for (const [shipment, expected] of unitsByShipment) {
    const actual =
      movementByShipment.get(shipment) ?? new Map<string, bigint>();
    for (const tuple of new Set([...expected.keys(), ...actual.keys()]))
      issues.compare(
        "SALE_STOCK_DEDUCTION",
        shipment,
        expected.get(tuple) ?? 0n,
        actual.get(tuple) ?? 0n,
      );
  }
  for (const i of billing.invoices) {
    if (i.opening) continue;
    const s = shipmentMap.get(i.shipment),
      o = orders.get(i.order);
    if (!s || s.state !== "shipped") issues.add("SALE_INVOICE_SHIPMENT", i.id);
    else {
      match("SALE_SHIPMENT_REVERSE_LINK", i.id, i.id, s.invoice);
      match("SALE_INVOICE_ORDER", i.id, s.order, i.order);
      match("SALE_INVOICE_ACCOUNT", i.id, s.account, i.account);
    }
    if (!o) issues.add("SALE_INVOICE_ORDER_MISSING", i.id);
    else match("SALE_INVOICE_ORDER_CURRENCY", i.id, o.currency, i.currency);
    match("SALE_INVOICE_CURRENCY", i.id, currency, i.currency);
    productsByInvoice.set(i.id, new Map());
  }
  for (const l of billing.lines) {
    const i = invoiceMap.get(l.invoice);
    if (!i) {
      issues.add("SALE_ORPHAN_INVOICE_LINE", l.id);
      continue;
    }
    if (i.opening) continue;
    const quantity = exact(l.quantity, l.id),
      price = exact(l.price, l.id),
      tax = exact(l.tax, l.id),
      orderLine = orderLines.get(key(i.order, l.product));
    invoicedQuantity += quantity;
    // Regional amounts never add another currency without an exchange policy.
    if (i.currency === currency) {
      invoiceNet += quantity * price;
      invoiceTax += quantity * tax;
    }
    add(productsByInvoice.get(i.id)!, l.product, quantity);
    if (!orderLine) issues.add("SALE_INVOICE_PRODUCT", l.id);
    else {
      issues.compare(
        "SALE_INVOICE_PRICE",
        l.id,
        exact(orderLine.price, orderLine.id),
        price,
      );
      issues.compare(
        "SALE_INVOICE_TAX",
        l.id,
        exact(orderLine.tax, orderLine.id),
        tax,
      );
    }
  }
  for (const i of billing.invoices) {
    if (i.opening) continue;
    const expected =
        productsByShipment.get(i.shipment) ?? new Map<string, bigint>(),
      actual = productsByInvoice.get(i.id)!;
    for (const product of new Set([...expected.keys(), ...actual.keys()]))
      issues.compare(
        "SALE_INVOICE_QUANTITY",
        i.id,
        expected.get(product) ?? 0n,
        actual.get(product) ?? 0n,
      );
  }
  reservationControls(orderEvidence, shipments, inventory, issues);
  return {
    orders: orders.size,
    shipments: shipments.filter((s) => s.state === "shipped").length,
    invoices: billing.invoices.filter((i) => !i.opening).length,
    openingInvoices: billing.invoices.filter((i) => i.opening).length,
    allocations: allocations.size,
    movements: inventory.movements.length,
    shippedQuantity: String(shippedQuantity),
    shippedCost: String(shippedCost),
    movementQuantity: String(movementQuantity),
    movementCost: String(movementCost),
    invoicedQuantity: String(invoicedQuantity),
    invoiceNet: String(invoiceNet),
    invoiceTax: String(invoiceTax),
    issues: issues.result(),
  };
}
