import { COST_CORRECTION_SCHEMA } from "./cost-correction-schema.ts";

// Keep the v8-v14 manifest frozen. Each approved predecessor has one successor;
// the empty predecessor reserves the original's first correction.
export const COST_CORRECTION_CHAIN_SCHEMA = [
  {
    type: "index",
    name: "integration_cost_correction_successor",
    tbl_name: "integration_cost_corrections",
    sql: "CREATE UNIQUE INDEX integration_cost_correction_successor ON integration_cost_corrections(org_id,original_id,coalesce(json_extract(input,'$.predecessor.correctionId'),'')) WHERE state='reviewed'",
  },
] as const;
export const COST_CORRECTION_CHAIN_UPGRADE_DDL =
  "DROP INDEX integration_cost_correction_once;" +
  COST_CORRECTION_CHAIN_SCHEMA[0].sql;
export const COST_CORRECTION_CHAIN_INITIALIZE_DDL = [
  ...COST_CORRECTION_SCHEMA.filter(
    (o) => o.name !== "integration_cost_correction_once",
  ),
  ...COST_CORRECTION_CHAIN_SCHEMA,
]
  .map((o) => o.sql)
  .join(";")
  .replaceAll("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")
  .replaceAll("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
