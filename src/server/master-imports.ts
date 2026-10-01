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
import { Platform } from "./platform.ts";
import {
  normalizeManifest,
  type ImportManifest,
  type MasterReview,
  type MasterMapping,
} from "./import-manifest.ts";

export type MasterInput = ImportManifest & { kind: "customer" | "catalog" };
type Issue = { row: number | null; code: string; message: string };
type Report = {
  rows: {
    row: number;
    source: unknown;
    sourceId: string | null;
    entry: MasterReview | null;
    issues: Issue[];
  }[];
  issues: Issue[];
  quantity: number;
  value: number;
  creates: number;
  matches: number;
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
type Result = {
  id: string;
  decision: "approve" | "reject";
  reason: string;
  quantity: number;
  value: number;
  mappings: MasterMapping[];
};

export class MasterImports {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private catalog: Catalog,
  ) {
    this.store = database.owned("migration");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS migration_master_batches(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,batch_ref TEXT NOT NULL,source_ref TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('customer','catalog')),input TEXT NOT NULL,input_hash TEXT NOT NULL,report TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','blocked','applied','rejected')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,result TEXT,UNIQUE(org_id,batch_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS migration_master_sources(org_id TEXT NOT NULL,kind TEXT NOT NULL,source_ref TEXT NOT NULL,source_id TEXT NOT NULL,batch_id TEXT NOT NULL,target_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('create','match')),input_hash TEXT NOT NULL,PRIMARY KEY(org_id,kind,source_ref,source_id),UNIQUE(org_id,kind,source_ref,target_id)) STRICT;
    `);
  }
  private batch(actor: Actor, batchId: string) {
    permit(actor, []);
    const batch = this.store.get<Batch>(
      "SELECT * FROM migration_master_batches WHERE org_id=? AND id=?",
      actor.orgId,
      batchId,
    );
    check(batch, "NOT_FOUND", "Master import batch not found.", 404);
    return batch;
  }
  list(actor: Actor) {
    permit(actor, []);
    return this.store
      .all<Batch>(
        "SELECT * FROM migration_master_batches WHERE org_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50",
        actor.orgId,
      )
      .map((batch) => {
        const { rows: _rows, ...input } = JSON.parse(
          batch.input,
        ) as MasterInput;
        return {
          ...input,
          id: batch.id,
          report: JSON.parse(batch.report) as Report,
          reviewHash: batch.review_hash,
          state: batch.state,
          createdBy: batch.created_by,
          createdAt: batch.created_at,
          decisionBy: batch.decision_by,
          decisionAt: batch.decision_at,
          decisionReason: batch.decision_reason,
          result: batch.result ? (JSON.parse(batch.result) as Result) : null,
        };
      });
  }
  private assess(actor: Actor, input: MasterInput): Report {
    const issues: Issue[] = [],
      sources = new Map<string, number[]>(),
      keys = new Map<string, number[]>(),
      targets = new Map<string, number[]>();
    const rows = input.rows.map((raw, index) => {
      const rowIssues: Issue[] = [];
      let entry: MasterReview | null = null;
      const sourceId =
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        typeof (raw as Record<string, unknown>).sourceId === "string"
          ? String((raw as Record<string, unknown>).sourceId).trim()
          : null;
      if (sourceId)
        sources.set(sourceId, [...(sources.get(sourceId) ?? []), index]);
      try {
        entry =
          input.kind === "customer"
            ? this.identity.reviewCustomerImport(actor, raw)
            : this.catalog.reviewImport(actor, raw);
        keys.set(entry.matchKey, [...(keys.get(entry.matchKey) ?? []), index]);
        if (entry.targetId)
          targets.set(entry.targetId, [
            ...(targets.get(entry.targetId) ?? []),
            index,
          ]);
        check(
          !this.store.get(
            "SELECT target_id FROM migration_master_sources WHERE org_id=? AND kind=? AND source_ref=? AND source_id=?",
            actor.orgId,
            input.kind,
            input.sourceRef,
            entry.sourceId,
          ),
          "SOURCE_ALREADY_APPLIED",
          "Source row already has an applied master mapping.",
        );
        if (entry.targetId)
          check(
            !this.store.get(
              "SELECT source_id FROM migration_master_sources WHERE org_id=? AND kind=? AND source_ref=? AND target_id=?",
              actor.orgId,
              input.kind,
              input.sourceRef,
              entry.targetId,
            ),
            "TARGET_ALREADY_MAPPED",
            "Selected target already maps a row in this source dataset.",
          );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        rowIssues.push({
          row: index + 1,
          code: error.code,
          message: error.message,
        });
      }
      return {
        row: index + 1,
        source: raw,
        sourceId,
        entry,
        issues: rowIssues,
      };
    });
    for (const [groups, code, message] of [
      [
        sources,
        "DUPLICATE_SOURCE_ROW",
        "Source row occurs more than once in this batch.",
      ],
      [
        keys,
        "DUPLICATE_MASTER_KEY",
        "SKU/account name occurs more than once in this batch; review ambiguous source records separately.",
      ],
      [
        targets,
        "DUPLICATE_TARGET",
        "Multiple source rows select the same target.",
      ],
    ] as const)
      for (const indexes of groups.values())
        if (indexes.length > 1)
          for (const index of indexes)
            rows[index]!.issues.push({ row: index + 1, code, message });
    let quantity = 0,
      value = 0,
      creates = 0,
      matches = 0;
    for (const r of rows) {
      issues.push(...r.issues);
      if (!r.entry || r.issues.length) continue;
      quantity++;
      value += r.entry.value;
      if (r.entry.targetId) matches++;
      else creates++;
    }
    if (value > 1e12)
      issues.push({
        row: null,
        code: "VALUATION_LIMIT",
        message: "Control amount exceeds the supported limit.",
      });
    if (quantity !== input.expectedQuantity || value !== input.expectedValue)
      issues.push({
        row: null,
        code: "RECONCILIATION",
        message:
          "Eligible record count/control amount do not match the independently supplied source totals.",
      });
    return { rows, issues, quantity, value, creates, matches };
  }
  preview(actor: Actor, key: string, input: MasterInput) {
    return this.platform.command(
      actor,
      "import.masters.preview",
      key,
      input,
      () => permit(actor, []),
      () => {
        const normalized = normalizeManifest(actor, input, this.identity, [
          "kind",
        ]);
        check(
          ["customer", "catalog"].includes(normalized.kind),
          "VALIDATION",
          "Master import kind must be customer or catalog.",
          400,
        );
        const hash = digest(canonical(normalized)),
          old = this.store.get<Batch>(
            "SELECT * FROM migration_master_batches WHERE org_id=? AND batch_ref=?",
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
          "INSERT INTO migration_master_batches(id,org_id,batch_ref,source_ref,kind,input,input_hash,report,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          batchId,
          actor.orgId,
          normalized.batchRef,
          normalized.sourceRef,
          normalized.kind,
          canonical(normalized),
          hash,
          canonical(report),
          reviewHash,
          report.issues.length ? "blocked" : "ready",
          actor.id,
          now(),
        );
        this.platform.audit(actor, "import.masters.preview.saved", batchId, {
          kind: normalized.kind,
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
  ): Result {
    return this.platform.command(
      actor,
      "import.masters.decide",
      key,
      input,
      () => {
        permit(actor, []);
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
          const old = JSON.parse(batch.result) as Result;
          check(
            old.decision === input.decision && old.reason === reason,
            "RECEIPT_CONFLICT",
            "Import already has a different permanent review decision.",
          );
          return old;
        }
        const source = JSON.parse(batch.input) as MasterInput;
        let mappings: MasterMapping[] = [],
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
            "Master data/source mappings changed since the dry run. Reject and create a fresh batch.",
          );
          mappings = source.rows.map((raw) =>
            source.kind === "customer"
              ? this.identity.applyCustomerImport(actor, raw)
              : this.catalog.applyImport(actor, raw),
          );
          for (const m of mappings)
            this.store.run(
              "INSERT INTO migration_master_sources VALUES(?,?,?,?,?,?,?,?)",
              actor.orgId,
              source.kind,
              source.sourceRef,
              m.sourceId,
              batch.id,
              m.targetId,
              m.action,
              digest(
                canonical(
                  source.rows[
                    current.rows.findIndex((r) => r.sourceId === m.sourceId)
                  ],
                ),
              ),
            );
          quantity = current.quantity;
          value = current.value;
        }
        const result: Result = {
          id: batch.id,
          decision: input.decision,
          reason,
          quantity,
          value,
          mappings,
        };
        this.store.run(
          "UPDATE migration_master_batches SET state=?,decision_by=?,decision_at=?,decision_reason=?,result=? WHERE id=? AND org_id=?",
          input.decision === "approve" ? "applied" : "rejected",
          actor.id,
          now(),
          reason,
          canonical(result),
          batch.id,
          actor.orgId,
        );
        this.platform.audit(actor, "import.masters.reviewed", batch.id, {
          kind: source.kind,
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
