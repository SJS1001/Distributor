import {
  canonical,
  check,
  digest,
  DomainError,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import type { DocumentReview, DocumentMapping } from "./billing-opening.ts";
import { Platform } from "./platform.ts";
import { normalizeManifest, type ImportManifest } from "./import-manifest.ts";

export type DocumentInput = ImportManifest & {
  expectedNet: number;
  expectedTax: number;
  expectedCredited: number;
  expectedPaid: number;
  expectedRefunded: number;
};
type Issue = { row: number | null; code: string; message: string };
type Report = {
  rows: {
    row: number;
    source: unknown;
    sourceId: string | null;
    entry: DocumentReview | null;
    issues: Issue[];
  }[];
  issues: Issue[];
  quantity: number;
  value: number;
  net: number;
  tax: number;
  credited: number;
  paid: number;
  refunded: number;
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
  mappings: DocumentMapping[];
};

export class DocumentImports {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private billing: Billing,
  ) {
    this.store = database.owned("migration");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS migration_document_batches(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,batch_ref TEXT NOT NULL,source_ref TEXT NOT NULL,input TEXT NOT NULL,input_hash TEXT NOT NULL,report TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','blocked','applied','rejected')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,result TEXT,UNIQUE(org_id,batch_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS migration_document_sources(org_id TEXT NOT NULL,source_ref TEXT NOT NULL,source_id TEXT NOT NULL,batch_id TEXT NOT NULL,invoice_id TEXT NOT NULL,input_hash TEXT NOT NULL,PRIMARY KEY(org_id,source_ref,source_id),UNIQUE(org_id,invoice_id)) STRICT;
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
      "SELECT * FROM migration_document_batches WHERE org_id=? AND id=?",
      actor.orgId,
      batchId,
    );
    check(batch, "NOT_FOUND", "Document import batch not found.", 404);
    return batch;
  }
  list(actor: Actor) {
    actor = this.current(actor);
    return this.store
      .all<Batch>(
        "SELECT * FROM migration_document_batches WHERE org_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50",
        actor.orgId,
      )
      .map((batch) => {
        const { rows: _rows, ...input } = JSON.parse(
          batch.input,
        ) as DocumentInput;
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
  private assess(actor: Actor, input: DocumentInput): Report {
    const issues: Issue[] = [],
      sources = new Map<string, number[]>(),
      keys = new Map<string, number[]>();
    const rows = input.rows.map((raw, index) => {
      const rowIssues: Issue[] = [];
      let entry: DocumentReview | null = null;
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
        entry = this.billing.opening.review(actor, raw, input.cutoffAt);
        keys.set(entry.matchKey, [...(keys.get(entry.matchKey) ?? []), index]);
        check(
          !this.store.get(
            "SELECT invoice_id FROM migration_document_sources WHERE org_id=? AND source_ref=? AND source_id=?",
            actor.orgId,
            input.sourceRef,
            entry.sourceId,
          ),
          "SOURCE_ALREADY_APPLIED",
          "Source row already has a permanent document mapping.",
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
        "DUPLICATE_DOCUMENT_NUMBER",
        "Original invoice number occurs more than once in this batch.",
      ],
    ] as const)
      for (const indexes of groups.values())
        if (indexes.length > 1)
          for (const index of indexes)
            rows[index]!.issues.push({ row: index + 1, code, message });
    let quantity = 0,
      value = 0,
      net = 0,
      tax = 0,
      credited = 0,
      paid = 0,
      refunded = 0;
    for (const r of rows) {
      issues.push(...r.issues);
      if (!r.entry || r.issues.length) continue;
      quantity++;
      value += r.entry.value;
      net += r.entry.document.net;
      tax += r.entry.document.tax;
      credited += r.entry.document.credited;
      paid += r.entry.document.paid;
      refunded += r.entry.document.refunded;
    }
    if ([value, net, tax, credited, paid, refunded].some((n) => n > 1e12))
      issues.push({
        row: null,
        code: "VALUATION_LIMIT",
        message: "Control amount exceeds the supported limit.",
      });
    if (
      quantity !== input.expectedQuantity ||
      value !== input.expectedValue ||
      net !== input.expectedNet ||
      tax !== input.expectedTax ||
      credited !== input.expectedCredited ||
      paid !== input.expectedPaid ||
      refunded !== input.expectedRefunded
    )
      issues.push({
        row: null,
        code: "RECONCILIATION",
        message:
          "Eligible document count, original net/tax, historical credits/cash/refunds and outstanding balances do not match independent source totals.",
      });
    return {
      rows,
      issues,
      quantity,
      value,
      net,
      tax,
      credited,
      paid,
      refunded,
    };
  }
  preview(actor: Actor, key: string, input: DocumentInput) {
    return this.platform.command(
      actor,
      "import.documents.preview",
      key,
      input,
      () => {
        actor = this.current(actor);
      },
      () => {
        const normalized = normalizeManifest(actor, input, this.identity, [
          "expectedNet",
          "expectedTax",
          "expectedCredited",
          "expectedPaid",
          "expectedRefunded",
        ]);
        for (const field of [
          "expectedNet",
          "expectedTax",
          "expectedCredited",
          "expectedPaid",
          "expectedRefunded",
        ] as const)
          normalized[field] = integer(normalized[field], field, 0, 1e12);
        const hash = digest(canonical(normalized)),
          old = this.store.get<Batch>(
            "SELECT * FROM migration_document_batches WHERE org_id=? AND batch_ref=?",
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
          "INSERT INTO migration_document_batches(id,org_id,batch_ref,source_ref,input,input_hash,report,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
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
        this.platform.audit(actor, "import.documents.preview.saved", batchId, {
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
      "import.documents.decide",
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
          const old = JSON.parse(batch.result) as Result;
          check(
            old.decision === input.decision && old.reason === reason,
            "RECEIPT_CONFLICT",
            "Import already has a different permanent review decision.",
          );
          return old;
        }
        const source = JSON.parse(batch.input) as DocumentInput;
        let mappings: DocumentMapping[] = [],
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
            "Financial document/master/source mappings changed since the dry run. Reject and create a fresh batch.",
          );
          mappings = current.rows.map((r) =>
            this.billing.opening.apply(actor, r.entry!, {
              sourceRef: source.sourceRef,
              sourceHash: source.sourceHash,
              cutoffAt: source.cutoffAt,
              batchId: batch.id,
            }),
          );
          for (const m of mappings)
            this.store.run(
              "INSERT INTO migration_document_sources VALUES(?,?,?,?,?,?)",
              actor.orgId,
              source.sourceRef,
              m.sourceId,
              batch.id,
              m.invoiceId,
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
          "UPDATE migration_document_batches SET state=?,decision_by=?,decision_at=?,decision_reason=?,result=? WHERE id=? AND org_id=?",
          input.decision === "approve" ? "applied" : "rejected",
          actor.id,
          now(),
          reason,
          canonical(result),
          batch.id,
          actor.orgId,
        );
        this.platform.audit(actor, "import.documents.reviewed", batch.id, {
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
