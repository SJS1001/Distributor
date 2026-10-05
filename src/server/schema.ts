import { RECORD_NOTES_SCHEMA } from "./record-notes-schema.ts";
import { SCANNER_LINK_SCHEMA } from "./scanner-link-schema.ts";
import { ORDER_PRICE_OVERRIDES_SCHEMA } from "./order-price-overrides-schema.ts";
import { PRICE_AUTHORITY_SCHEMA } from "./catalog-price-authority-schema.ts";
import { CATALOG_REFERENCE_SCHEMA } from "./catalog-reference-schema.ts";
import { SHIPPING_TERMS_SCHEMA } from "./shipping-terms-schema.ts";
import { CUSTOMER_PRICING_SCHEMA } from "./customer-pricing-schema.ts";
import { PRODUCT_AVAILABILITY_SCHEMA } from "./product-availability-schema.ts";
import { PURCHASING_SCHEMA } from "./purchasing-schema.ts";
import { CATALOG_MEDIA_SCHEMA } from "./catalog-media-schema.ts";
import { ENROLLMENT_SCHEMA } from "./enrollment-schema.ts";
import { INCOMING_SUPPLY_SCHEMA } from "./incoming-supply-schema.ts";
import { INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA } from "./integration-offline-checkout-paid-schema.ts";
import { INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA } from "./integration-offline-original-lease-schema.ts";
import { INTEGRATION_OFFLINE_CANADA_POST_SCHEMA } from "./integration-offline-canada-post-schema.ts";
import { INTEGRATION_OFFLINE_ORIGINAL_SCHEMA } from "./integration-offline-original-schema.ts";
import { INTEGRATION_OFFLINE_REFUND_SCHEMA } from "./integration-offline-refund-schema.ts";
import { RESTORE_OFFLINE_SCHEMA } from "./restore-offline-schema.ts";
import { RESTORE_ACTIVATION_SCHEMA } from "./restore-activation-schema.ts";
import { INVENTORY_QUANTITY_SCHEMA } from "./inventory-quantity-schema.ts";
import { INVENTORY_VALUATION_SCHEMA } from "./inventory-valuation-schema.ts";
import { COST_CORRECTION_CHAIN_SCHEMA } from "./cost-correction-chain-schema.ts";
import { ORGANIZATION_REVOCATION_SCHEMA } from "./organization-revocation-schema.ts";
import { ORGANIZATION_AUTHORIZATION_SCHEMA } from "./organization-authorization-schema.ts";
import { STOCK_JOURNAL_SCHEMA } from "./stock-journal-schema.ts";
import { ORGANIZATION_RESIDENCY_SCHEMA } from "./organization-residency-schema.ts";
import { COST_CORRECTION_RETRY_SCHEMA } from "./cost-correction-retry-schema.ts";
import { COST_CORRECTION_OUTCOME_SCHEMA } from "./cost-correction-outcome-schema.ts";
import { COST_CORRECTION_SCHEMA } from "./cost-correction-schema.ts";
import { SUPPLIER_AVAILABILITY_SCHEMA } from "./supplier-availability-schema.ts";
import { SHIPMENT_COVERAGE_SCHEMA } from "./shipment-coverage-schema.ts";
import { CLAIM_COVERAGE_SCHEMA } from "./claim-coverage-schema.ts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonical, digest, check } from "./core.ts";
import type { Region } from "./iam.ts";
import baseline from "./schema-baseline.json" with { type: "json" };
import { CANADA_POST_SCHEMA } from "./canada-post-schema.ts";
import { QUICKBOOKS_REVOCATION_SCHEMA } from "./quickbooks-revocation-schema.ts";
import { ACCOUNTING_CANCELLATION_SCHEMA } from "./accounting-cancellation-schema.ts";

export const SCHEMA_VERSION = 28;
export const SCHEMA_TABLE = "platform_schema_version";
// This DDL is part of the frozen v1 schema identity. Changing it requires a new version.
export const SCHEMA_DDL =
  "CREATE TABLE platform_schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,schema_hash TEXT NOT NULL,event_reports INTEGER NOT NULL CHECK(event_reports IN(0,1)),region TEXT NOT NULL CHECK(region IN('CA','US')),initialized_at TEXT NOT NULL) STRICT";

type SchemaObject = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};
export type SchemaInspection = {
  kind: "empty" | "legacy" | "previous" | "current";
  version: number | null;
  schemaHash: string;
  eventReports: boolean;
  region: Region | null;
  initializedAt: string | null;
};

function fingerprint(objects: SchemaObject[]) {
  return createHash("sha256").update(JSON.stringify(objects)).digest("hex");
}
function objects(db: DatabaseSync): SchemaObject[] {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .all() as SchemaObject[];
}
export function schemaFingerprint(db: DatabaseSync) {
  return fingerprint(objects(db));
}
const profiles = baseline.schemas.map((profile) => {
  check(
    digest(canonical(profile.schema)) === profile.hash,
    "SCHEMA_BASELINE",
    "Frozen schema manifest is inconsistent.",
  );
  const previous = [
    ...profile.schema,
    {
      type: "table",
      name: SCHEMA_TABLE,
      tbl_name: SCHEMA_TABLE,
      sql: SCHEMA_DDL,
    },
  ].sort((a, b) =>
    a.type < b.type
      ? -1
      : a.type > b.type
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
  return {
    eventReports: profile.eventReports,
    legacyHash: fingerprint(profile.schema),
    previousHash: fingerprint(previous),
    versionTwoHash: fingerprint(
      [...previous, ...CANADA_POST_SCHEMA].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionThreeHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFourHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFiveHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionSixHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionSevenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionEightHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionNineHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionElevenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwelveHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionThirteenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFourteenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionFifteenHash: fingerprint(
      [
        ...previous,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionSixteenHash: fingerprint(
      [
        ...previous,
        ...INVENTORY_VALUATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionSeventeenHash: fingerprint(
      [
        ...previous,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionEighteenHash: fingerprint(
      [
        ...previous,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionNineteenHash: fingerprint(
      [
        ...previous,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyHash: fingerprint(
      [
        ...previous,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyOneHash: fingerprint(
      [
        ...previous,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyTwoHash: fingerprint(
      [
        ...previous,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyThreeHash: fingerprint(
      [
        ...previous,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyFourHash: fingerprint(
      [
        ...previous,
        ...ENROLLMENT_SCHEMA,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentyFiveHash: fingerprint(
      [
        ...previous,
        ...PURCHASING_SCHEMA,
        ...CATALOG_MEDIA_SCHEMA,
        ...ENROLLMENT_SCHEMA,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentySixHash: fingerprint(
      [
        ...previous,
        ...PRODUCT_AVAILABILITY_SCHEMA,
        ...PURCHASING_SCHEMA,
        ...CATALOG_MEDIA_SCHEMA,
        ...ENROLLMENT_SCHEMA,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    versionTwentySevenHash: fingerprint(
      [
        ...previous,
        ...PRODUCT_AVAILABILITY_SCHEMA,
        ...CUSTOMER_PRICING_SCHEMA,
        ...CATALOG_REFERENCE_SCHEMA,
        ...PRICE_AUTHORITY_SCHEMA,
        ...SCANNER_LINK_SCHEMA,
        ...ORDER_PRICE_OVERRIDES_SCHEMA,
        ...SHIPPING_TERMS_SCHEMA,
        ...PURCHASING_SCHEMA,
        ...CATALOG_MEDIA_SCHEMA,
        ...ENROLLMENT_SCHEMA,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
    currentHash: fingerprint(
      [
        ...previous,
        ...RECORD_NOTES_SCHEMA,
        ...PRODUCT_AVAILABILITY_SCHEMA,
        ...CUSTOMER_PRICING_SCHEMA,
        ...CATALOG_REFERENCE_SCHEMA,
        ...PRICE_AUTHORITY_SCHEMA,
        ...SCANNER_LINK_SCHEMA,
        ...ORDER_PRICE_OVERRIDES_SCHEMA,
        ...SHIPPING_TERMS_SCHEMA,
        ...PURCHASING_SCHEMA,
        ...CATALOG_MEDIA_SCHEMA,
        ...ENROLLMENT_SCHEMA,
        ...INCOMING_SUPPLY_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA,
        ...INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA,
        ...INTEGRATION_OFFLINE_CANADA_POST_SCHEMA,
        ...INTEGRATION_OFFLINE_ORIGINAL_SCHEMA,
        ...INTEGRATION_OFFLINE_REFUND_SCHEMA,
        ...RESTORE_OFFLINE_SCHEMA,
        ...INVENTORY_VALUATION_SCHEMA,
        ...INVENTORY_QUANTITY_SCHEMA,
        ...RESTORE_ACTIVATION_SCHEMA,
        ...CANADA_POST_SCHEMA,
        ...QUICKBOOKS_REVOCATION_SCHEMA,
        ...ACCOUNTING_CANCELLATION_SCHEMA,
        ...CLAIM_COVERAGE_SCHEMA,
        ...SHIPMENT_COVERAGE_SCHEMA,
        ...SUPPLIER_AVAILABILITY_SCHEMA,
        ...COST_CORRECTION_SCHEMA.filter(
          (o) => o.name !== "integration_cost_correction_once",
        ),
        ...COST_CORRECTION_CHAIN_SCHEMA,
        ...COST_CORRECTION_OUTCOME_SCHEMA,
        ...COST_CORRECTION_RETRY_SCHEMA,
        ...ORGANIZATION_RESIDENCY_SCHEMA,
        ...STOCK_JOURNAL_SCHEMA,
        ...ORGANIZATION_AUTHORIZATION_SCHEMA,
        ...ORGANIZATION_REVOCATION_SCHEMA,
      ].sort((a, b) =>
        a.type < b.type
          ? -1
          : a.type > b.type
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      ),
    ),
  };
});
export function supportedSchemaHash(eventReports: boolean) {
  return profiles.find((p) => p.eventReports === eventReports)!.currentHash;
}

// Storage maintenance only. Callers must establish a single SQLite snapshot and
// must not run application constructors until this exact-schema check succeeds.
export function inspectConnection(db: DatabaseSync): SchemaInspection {
  const entries = objects(db),
    schemaHash = fingerprint(entries);
  if (entries.length === 0)
    return {
      kind: "empty",
      version: null,
      schemaHash,
      eventReports: false,
      region: null,
      initializedAt: null,
    };
  const current = profiles.find((p) => p.currentHash === schemaHash);
  const versionTwentySeven = profiles.find(
    (p) => p.versionTwentySevenHash === schemaHash,
  );
  const versionTwentySix = profiles.find(
    (p) => p.versionTwentySixHash === schemaHash,
  );
  const versionTwentyFive = profiles.find(
    (p) => p.versionTwentyFiveHash === schemaHash,
  );
  const versionTwentyFour = profiles.find(
    (p) => p.versionTwentyFourHash === schemaHash,
  );
  const versionTwentyThree = profiles.find(
    (p) => p.versionTwentyThreeHash === schemaHash,
  );
  const versionTwentyTwo = profiles.find(
    (p) => p.versionTwentyTwoHash === schemaHash,
  );
  const versionTwentyOne = profiles.find(
    (p) => p.versionTwentyOneHash === schemaHash,
  );
  const versionTwenty = profiles.find(
    (p) => p.versionTwentyHash === schemaHash,
  );
  const versionNineteen = profiles.find(
    (p) => p.versionNineteenHash === schemaHash,
  );
  const versionEighteen = profiles.find(
    (p) => p.versionEighteenHash === schemaHash,
  );
  const versionSeventeen = profiles.find(
    (p) => p.versionSeventeenHash === schemaHash,
  );
  const versionSixteen = profiles.find(
    (p) => p.versionSixteenHash === schemaHash,
  );
  const versionFifteen = profiles.find(
    (p) => p.versionFifteenHash === schemaHash,
  );
  const versionFourteen = profiles.find(
    (p) => p.versionFourteenHash === schemaHash,
  );
  const versionThirteen = profiles.find(
    (p) => p.versionThirteenHash === schemaHash,
  );
  const versionTwelve = profiles.find(
    (p) => p.versionTwelveHash === schemaHash,
  );
  const versionEleven = profiles.find(
    (p) => p.versionElevenHash === schemaHash,
  );
  const versionTen = profiles.find((p) => p.versionTenHash === schemaHash);
  const versionNine = profiles.find((p) => p.versionNineHash === schemaHash);
  const versionEight = profiles.find((p) => p.versionEightHash === schemaHash);
  const versionSeven = profiles.find((p) => p.versionSevenHash === schemaHash);
  const versionSix = profiles.find((p) => p.versionSixHash === schemaHash);
  const versionFive = profiles.find((p) => p.versionFiveHash === schemaHash);
  const versionFour = profiles.find((p) => p.versionFourHash === schemaHash);
  const versionThree = profiles.find((p) => p.versionThreeHash === schemaHash);
  const versionTwo = profiles.find((p) => p.versionTwoHash === schemaHash);
  const previous =
    versionTwentySeven ??
    versionTwentySix ??
    versionTwentyFive ??
    versionTwentyFour ??
    versionTwentyThree ??
    versionTwentyTwo ??
    versionTwentyOne ??
    versionTwenty ??
    versionNineteen ??
    versionEighteen ??
    versionSeventeen ??
    versionSixteen ??
    versionFifteen ??
    versionFourteen ??
    versionThirteen ??
    versionTwelve ??
    versionEleven ??
    versionTen ??
    versionNine ??
    versionEight ??
    versionSeven ??
    versionSix ??
    versionFive ??
    versionFour ??
    versionThree ??
    versionTwo ??
    profiles.find((p) => p.previousHash === schemaHash);
  const legacy = profiles.find((p) => p.legacyHash === schemaHash);
  check(
    current || previous || legacy,
    "SCHEMA_DRIFT",
    "Store schema is not an exact supported application schema.",
  );
  const regions = db
    .prepare("SELECT DISTINCT region FROM iam_organizations")
    .all();
  check(
    regions.length <= 1 &&
      regions.every((r) => r.region === "CA" || r.region === "US"),
    "SCHEMA_REGION",
    "Store organizations must belong to one supported region.",
  );
  const region = (regions[0]?.region ?? null) as Region | null;
  if (legacy)
    return {
      kind: "legacy",
      version: null,
      schemaHash,
      eventReports: legacy.eventReports,
      region,
      initializedAt: null,
    };
  const rows = db
    .prepare(
      "SELECT singleton,version,schema_hash,event_reports,region,initialized_at FROM platform_schema_version",
    )
    .all();
  check(
    rows.length === 1 && rows[0]?.singleton === 1,
    "SCHEMA_VERSION",
    "Store requires exactly one schema version receipt.",
  );
  const row = rows[0]!;
  check(
    row.version ===
      (current
        ? SCHEMA_VERSION
        : versionTwentySeven
          ? 27
          : versionTwentySix
            ? 26
            : versionTwentyFive
              ? 25
              : versionTwentyFour
                ? 24
                : versionTwentyThree
                  ? 23
                  : versionTwentyTwo
                    ? 22
                    : versionTwentyOne
                      ? 21
                      : versionTwenty
                        ? 20
                        : versionNineteen
                          ? 19
                          : versionEighteen
                            ? 18
                            : versionSeventeen
                              ? 17
                              : versionSixteen
                                ? 16
                                : versionFifteen
                                  ? 15
                                  : versionFourteen
                                    ? 14
                                    : versionThirteen
                                      ? 13
                                      : versionTwelve
                                        ? 12
                                        : versionEleven
                                          ? 11
                                          : versionTen
                                            ? 10
                                            : versionNine
                                              ? 9
                                              : versionEight
                                                ? 8
                                                : versionSeven
                                                  ? 7
                                                  : versionSix
                                                    ? 6
                                                    : versionFive
                                                      ? 5
                                                      : versionFour
                                                        ? 4
                                                        : versionThree
                                                          ? 3
                                                          : versionTwo
                                                            ? 2
                                                            : 1),
    "SCHEMA_VERSION",
    "Unsupported schema version; upgrades and downgrades require an explicitly supported procedure.",
  );
  check(
    row.schema_hash === schemaHash &&
      row.event_reports === Number((current ?? previous)!.eventReports),
    "SCHEMA_DRIFT",
    "Schema receipt does not match the exact stored profile.",
  );
  check(
    (row.region === "CA" || row.region === "US") &&
      (region === null || region === row.region),
    "SCHEMA_REGION",
    "Schema receipt and organization regions differ.",
  );
  check(
    typeof row.initialized_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        row.initialized_at,
      ) &&
      Number.isFinite(Date.parse(row.initialized_at)) &&
      new Date(row.initialized_at).toISOString() === row.initialized_at,
    "SCHEMA_VERSION",
    "Schema receipt timestamp is invalid.",
  );
  return {
    kind: current ? "current" : "previous",
    version: current
      ? SCHEMA_VERSION
      : versionTwentySeven
        ? 27
        : versionTwentySix
          ? 26
          : versionTwentyFive
            ? 25
            : versionTwentyFour
              ? 24
              : versionTwentyThree
                ? 23
                : versionTwentyTwo
                  ? 22
                  : versionTwentyOne
                    ? 21
                    : versionTwenty
                      ? 20
                      : versionNineteen
                        ? 19
                        : versionEighteen
                          ? 18
                          : versionSeventeen
                            ? 17
                            : versionSixteen
                              ? 16
                              : versionFifteen
                                ? 15
                                : versionFourteen
                                  ? 14
                                  : versionThirteen
                                    ? 13
                                    : versionTwelve
                                      ? 12
                                      : versionEleven
                                        ? 11
                                        : versionTen
                                          ? 10
                                          : versionNine
                                            ? 9
                                            : versionEight
                                              ? 8
                                              : versionSeven
                                                ? 7
                                                : versionSix
                                                  ? 6
                                                  : versionFive
                                                    ? 5
                                                    : versionFour
                                                      ? 4
                                                      : versionThree
                                                        ? 3
                                                        : versionTwo
                                                          ? 2
                                                          : 1,
    schemaHash,
    eventReports: (current ?? previous)!.eventReports,
    region: row.region,
    initializedAt: row.initialized_at,
  };
}

export function checkIntegrity(db: DatabaseSync) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  check(
    rows.length === 1 &&
      rows[0]?.integrity_check === "ok" &&
      db.prepare("PRAGMA foreign_key_check").all().length === 0,
    "SCHEMA_INTEGRITY",
    "Store integrity validation failed.",
  );
}

export function checkRegion(
  db: DatabaseSync,
  region: Region,
  requireOrganization: boolean,
) {
  check(
    region === "CA" || region === "US",
    "SCHEMA_REGION",
    "Region must be CA or US.",
  );
  const regions = db
    .prepare("SELECT DISTINCT region FROM iam_organizations")
    .all();
  check(
    regions.length <= 1 &&
      (!requireOrganization || regions.length === 1) &&
      regions.every((r) => r.region === region),
    "SCHEMA_REGION",
    "Store organizations must match the requested runtime region.",
  );
}
