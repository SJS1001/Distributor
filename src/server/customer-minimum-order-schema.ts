export const CUSTOMER_MINIMUM_ORDER_SCHEMA = [
  {
    type: "table",
    name: "iam_customer_minimum_orders",
    tbl_name: "iam_customer_minimum_orders",
    sql: "CREATE TABLE iam_customer_minimum_orders(org_id TEXT NOT NULL,account_id TEXT NOT NULL,minimum_subtotal INTEGER NOT NULL CHECK(minimum_subtotal>=0 AND minimum_subtotal<=1000000000000),minimum_equipment_quantity INTEGER NOT NULL CHECK(minimum_equipment_quantity>=0 AND minimum_equipment_quantity<=100000),revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,PRIMARY KEY(org_id,account_id)) STRICT",
  },
] as const;
export const CUSTOMER_MINIMUM_ORDER_DDL = CUSTOMER_MINIMUM_ORDER_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const CUSTOMER_MINIMUM_ORDER_INITIALIZE =
  CUSTOMER_MINIMUM_ORDER_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
