// Version 6: coverage policy at native handover. Older shipments stay absent.
export const SHIPMENT_COVERAGE_SCHEMA = [
  {
    type: "table",
    name: "fulfillment_coverage",
    tbl_name: "fulfillment_coverage",
    sql: "CREATE TABLE fulfillment_coverage(shipment_id TEXT PRIMARY KEY REFERENCES fulfillment_shipments(id),org_id TEXT NOT NULL,snapshot TEXT NOT NULL) STRICT",
  },
] as const;
export const SHIPMENT_COVERAGE_DDL = SHIPMENT_COVERAGE_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const SHIPMENT_COVERAGE_INITIALIZE_DDL = SHIPMENT_COVERAGE_DDL.replace(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
