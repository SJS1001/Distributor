import {
  canonical,
  check,
  digest,
  DomainError,
  id,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Catalog } from "./catalog.ts";
import { Inventory, type OpeningRow } from "./inventory.ts";
import { Platform } from "./platform.ts";

import { normalizeManifest, type ImportManifest } from "./import-manifest.ts";
import { MasterImports } from "./master-imports.ts";
import { DocumentImports } from "./document-imports.ts";
import { Billing } from "./billing.ts";

type Input = ImportManifest;
type Issue = { row: number | null; code: string; message: string };
type Report = {
  rows: {
    row: number;
    sourceId: string | null;
    entry: OpeningRow | null;
    issues: Issue[];
  }[];
  issues: Issue[];
  quantity: number;
  value: number;
  bySite: { warehouseId: string; quantity: number; value: number }[];
};
type Batch = Row & {
  id: string;
  input: string;
  input_hash: string;
  report: string;
  review_hash: string;
  state: string;
  result: string | null;
};
export class Migration {
  private store: Store;
  readonly masters: MasterImports;
  readonly documents: DocumentImports;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private catalog: Catalog,
    billing: Billing,
  ) {
    this.masters = new MasterImports(database, platform, identity, catalog);
    this.documents = new DocumentImports(database, platform, identity, billing);
    this.store = database.owned("migration");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS migration_opening_batches(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,batch_ref TEXT NOT NULL,source_ref TEXT NOT NULL,input TEXT NOT NULL,input_hash TEXT NOT NULL,report TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','blocked','applied','rejected')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,result TEXT,UNIQUE(org_id,batch_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS migration_opening_sources(org_id TEXT NOT NULL,source_ref TEXT NOT NULL,source_id TEXT NOT NULL,batch_id TEXT NOT NULL,unit_id TEXT NOT NULL,input_hash TEXT NOT NULL,PRIMARY KEY(org_id,source_ref,source_id)) STRICT;
    `);
  }
  private current(actor: Actor) {
    const current = this.identity.currentActor(actor);
    permit(current, []);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing import reviews.",
      403,
    );
    return current;
  }
  private batch(actor: Actor, batchId: string) {
    actor = this.current(actor);
    const batch = this.store.get<Batch>(
      "SELECT * FROM migration_opening_batches WHERE org_id=? AND id=?",
      actor.orgId,
      batchId,
    );
    check(batch, "NOT_FOUND", "Import batch not found.", 404);
    return batch;
  }
  private view(batch: Batch) {
    const input = JSON.parse(batch.input) as Input;
    return {
      id: batch.id,
      batchRef: input.batchRef,
      sourceRef: input.sourceRef,
      sourceHash: input.sourceHash,
      cutoffAt: input.cutoffAt,
      region: input.region,
      currency: input.currency,
      expectedQuantity: input.expectedQuantity,
      expectedValue: input.expectedValue,
      acknowledgment: input.acknowledgment,
      report: JSON.parse(batch.report) as Report,
      reviewHash: batch.review_hash,
      state: batch.state,
      createdBy: batch.created_by,
      createdAt: batch.created_at,
      decisionBy: batch.decision_by,
      decisionAt: batch.decision_at,
      decisionReason: batch.decision_reason,
      result: batch.result ? JSON.parse(batch.result) : null,
    };
  }
  list(actor: Actor) {
    actor = this.current(actor);
    return this.store
      .all<Batch>(
        "SELECT * FROM migration_opening_batches WHERE org_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50",
        actor.orgId,
      )
      .map((b) => this.view(b));
  }
  private normalize(actor: Actor, input: Input): Input {
    return normalizeManifest(actor, input, this.identity);
  }

  private assess(actor: Actor, input: Input): Report {
    const issues: Issue[] = [],
      sourceRows = new Map<string, number[]>(),
      serialRows = new Map<string, number[]>();
    const rows = input.rows.map((raw, index) => {
      const rowIssues: Issue[] = [];
      let entry: OpeningRow | null = null;
      try {
        check(
          raw && typeof raw === "object" && !Array.isArray(raw),
          "VALIDATION",
          "Opening row must be an object.",
          400,
        );
        const row = raw as Record<string, unknown>,
          fields = [
            "sourceId",
            "sku",
            "warehouse",
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
        const product = this.catalog.productBySku(actor, text(row.sku, "SKU")),
          warehouse = this.inventory.warehouseByName(
            actor,
            text(row.warehouse, "warehouse name"),
          );
        entry = this.inventory.validateOpening(actor, {
          sourceId: row.sourceId,
          productId: product.id,
          warehouseId: warehouse.id,
          bin: row.bin,
          serial: row.serial,
          quantity: row.quantity,
          unitCost: row.unitCost,
          condition: row.condition,
        });
        check(
          !this.store.get(
            "SELECT unit_id FROM migration_opening_sources WHERE org_id=? AND source_ref=? AND source_id=?",
            actor.orgId,
            input.sourceRef,
            entry.sourceId,
          ),
          "SOURCE_ALREADY_APPLIED",
          "Source row already has an applied opening mapping.",
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        rowIssues.push({
          row: index + 1,
          code: error.code,
          message: error.message,
        });
      }
      const sourceId =
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        typeof (raw as Record<string, unknown>).sourceId === "string"
          ? String((raw as Record<string, unknown>).sourceId).trim()
          : null;
      if (sourceId)
        sourceRows.set(sourceId, [...(sourceRows.get(sourceId) ?? []), index]);
      if (entry?.serial)
        serialRows.set(entry.serial, [
          ...(serialRows.get(entry.serial) ?? []),
          index,
        ]);
      return { row: index + 1, sourceId, entry, issues: rowIssues };
    });
    for (const [groups, code, message] of [
      [
        sourceRows,
        "DUPLICATE_SOURCE_ROW",
        "Source row occurs more than once in the batch.",
      ],
      [
        serialRows,
        "DUPLICATE_SERIAL",
        "Serial occurs more than once in the batch.",
      ],
    ] as const) {
      for (const indexes of groups.values())
        if (indexes.length > 1)
          for (const index of indexes)
            rows[index]!.issues.push({ row: index + 1, code, message });
    }
    let quantity = 0,
      value = 0;
    const bySite = new Map<
      string,
      { warehouseId: string; quantity: number; value: number }
    >();
    for (const r of rows) {
      issues.push(...r.issues);
      if (!r.entry || r.issues.length) continue;
      quantity += r.entry.quantity;
      value += r.entry.quantity * r.entry.unitCost;
      const site = bySite.get(r.entry.warehouseId) ?? {
        warehouseId: r.entry.warehouseId,
        quantity: 0,
        value: 0,
      };
      site.quantity += r.entry.quantity;
      site.value += r.entry.quantity * r.entry.unitCost;
      bySite.set(site.warehouseId, site);
    }
    if (value > 1e12)
      issues.push({
        row: null,
        code: "VALUATION_LIMIT",
        message: "Batch value exceeds the supported limit.",
      });
    if (quantity !== input.expectedQuantity || value !== input.expectedValue)
      issues.push({
        row: null,
        code: "RECONCILIATION",
        message:
          "Eligible row totals do not match the independently supplied source quantity/value.",
      });
    return { rows, issues, quantity, value, bySite: [...bySite.values()] };
  }
  preview(actor: Actor, key: string, input: Input) {
    return this.platform.command(
      actor,
      "import.opening.preview",
      key,
      input,
      () => {
        actor = this.current(actor);
      },
      () => {
        const normalized = this.normalize(actor, input),
          hash = digest(canonical(normalized));
        const old = this.store.get<Batch>(
          "SELECT * FROM migration_opening_batches WHERE org_id=? AND batch_ref=?",
          actor.orgId,
          normalized.batchRef,
        );
        if (old) {
          check(
            old.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Batch reference already describes different immutable source/mapping evidence.",
          );
          return { id: old.id, reviewHash: old.review_hash };
        }
        const report = this.assess(actor, normalized),
          batchId = id(),
          reviewHash = digest(canonical({ inputHash: hash, report }));
        this.store.run(
          "INSERT INTO migration_opening_batches(id,org_id,batch_ref,source_ref,input,input_hash,report,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          batchId,
          actor.orgId,
          normalized.batchRef,
          normalized.sourceRef,
          canonical(normalized),
          hash,
          canonical(report),
          reviewHash,
          report.issues.length ? "blocked" : "ready",
          actor.id,
          now(),
        );
        this.platform.audit(actor, "import.opening.preview.saved", batchId, {
          sourceHash: normalized.sourceHash,
          reviewHash,
          rows: normalized.rows.length,
          rejected: report.rows.filter((r) => r.issues.length).length,
        });
        return { id: batchId, reviewHash };
      },
    );
  }
  decide(
    actor: Actor,
    key: string,
    input: {
      batchId: string;
      reviewHash: string;
      decision: "approve" | "reject";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "import.opening.decide",
      key,
      input,
      () => {
        actor = this.current(actor);
        this.batch(actor, input.batchId);
      },
      () => {
        const batch = this.batch(actor, input.batchId),
          reason = text(input.reason, "review reason", 2000);
        check(
          input.reviewHash === batch.review_hash,
          "REVIEW_CHANGED",
          "Review fingerprint does not match the saved dry run.",
        );
        check(
          ["approve", "reject"].includes(input.decision),
          "VALIDATION",
          "Import decision is invalid.",
          400,
        );
        if (batch.result) {
          const old = JSON.parse(batch.result);
          check(
            old.decision === input.decision && old.reason === reason,
            "RECEIPT_CONFLICT",
            "Import already has a different permanent review decision.",
          );
          return old as {
            id: string;
            decision: string;
            reason: string;
            quantity: number;
            value: number;
            mappings: {
              sourceId: string;
              unitId: string;
              quantity: number;
              value: number;
            }[];
          };
        }
        const source = JSON.parse(batch.input) as Input;
        let mappings: {
            sourceId: string;
            unitId: string;
            quantity: number;
            value: number;
          }[] = [],
          quantity = 0,
          value = 0;
        if (input.decision === "approve") {
          check(
            batch.state === "ready",
            "IMPORT_REJECTS",
            "Batch has rejects; correct the source/mapping and create a new batch.",
          );
          const current = this.assess(actor, source);
          check(
            current.issues.length === 0 &&
              digest(
                canonical({ inputHash: batch.input_hash, report: current }),
              ) === batch.review_hash,
            "IMPORT_STALE",
            "Stock/source mapping changed since the dry run. Reject and create a fresh batch.",
          );
          mappings = this.inventory.applyOpening(
            actor,
            current.rows.map((r) => r.entry!),
            batch.id,
            reason,
          );
          for (const m of mappings) {
            const row = current.rows.find(
              (r) => r.sourceId === m.sourceId,
            )!.entry!;
            this.store.run(
              "INSERT INTO migration_opening_sources VALUES(?,?,?,?,?,?)",
              actor.orgId,
              source.sourceRef,
              m.sourceId,
              batch.id,
              m.unitId,
              digest(canonical(row)),
            );
          }
          quantity = current.quantity;
          value = current.value;
        }
        const result = {
          id: batch.id,
          decision: input.decision,
          reason,
          quantity,
          value,
          mappings,
        };
        this.store.run(
          "UPDATE migration_opening_batches SET state=?,decision_by=?,decision_at=?,decision_reason=?,result=? WHERE id=? AND org_id=?",
          input.decision === "approve" ? "applied" : "rejected",
          actor.id,
          now(),
          reason,
          canonical(result),
          batch.id,
          actor.orgId,
        );
        this.platform.audit(actor, "import.opening.reviewed", batch.id, {
          decision: input.decision,
          reason,
          reviewHash: batch.review_hash,
          quantity,
          value,
        });
        return result;
      },
    );
  }
}
