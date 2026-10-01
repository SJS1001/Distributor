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
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";

type Return = Row & {
  id: string;
  org_id: string;
  supplier_id: string;
  warehouse_id: string;
  po_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
};
type Observation = Row & {
  id: string;
  return_id: string;
  revision: number;
  kind: string;
  reference: string;
  evidence: string;
  amount: number;
  quantity: number;
  receipt_id: string | null;
  target_id: string | null;
  state: string | null;
  resolution: string | null;
  actor_id: string;
  created_at: string;
  input_hash: string;
  result: string;
};
type Base = {
  returnId: string;
  revision: number;
  reference: string;
  evidence: string;
};
export type SupplierCreditInput = Base & { amount: number; currency: string };
export type SupplierReplacementInput = Base & {
  receiptId: string;
  quantity: number;
};
export type SupplierVoidInput = Base & { observationId: string };
export type SupplierReviewInput = Base & {
  state: "open" | "closed";
  resolution: "reconciled" | "no-remedy" | null;
};

// Procurement-owned observations of external supplier outcomes. No supplier
// ledger, customer credit or inventory receipt is inferred from an observation.
export class SupplierFollowups {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
  ) {
    this.store = database.owned("procurement");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS procurement_return_followups (
        id TEXT PRIMARY KEY,org_id TEXT NOT NULL,return_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
        kind TEXT NOT NULL CHECK(kind IN('credit','replacement','void','review')),reference TEXT NOT NULL,evidence TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount>=0),quantity INTEGER NOT NULL CHECK(quantity>=0),receipt_id TEXT,target_id TEXT,
        state TEXT,resolution TEXT,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,
        UNIQUE(org_id,reference),UNIQUE(return_id,revision)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS procurement_followup_return ON procurement_return_followups(org_id,return_id,revision);
      CREATE INDEX IF NOT EXISTS procurement_followup_receipt ON procurement_return_followups(org_id,receipt_id);
      CREATE INDEX IF NOT EXISTS procurement_followup_target ON procurement_return_followups(org_id,target_id);
    `);
  }
  authorize(actor: Actor, write = false) {
    const current = this.identity.currentActor(actor);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing supplier returns.",
      403,
    );
    permit(
      current,
      write ? ["finance"] : ["finance", "commercial", "warehouse"],
    );
    return current;
  }
  private returned(actor: Actor, returnId: string) {
    const returned = this.store.get<Return>(
      `SELECT r.*,l.product_id FROM procurement_returns r JOIN procurement_receipts p ON p.org_id=r.org_id AND p.id=r.receipt_id JOIN procurement_lines l ON l.org_id=p.org_id AND l.id=p.line_id WHERE r.org_id=? AND r.id=?`,
      actor.orgId,
      text(returnId, "supplier return ID"),
    );
    check(returned, "NOT_FOUND", "Supplier return not found.", 404);
    if (actor.role === "warehouse") site(actor, returned.warehouse_id);
    return returned;
  }
  private aggregate(actor: Actor, returned: Return) {
    const totals = this.store.get(
        `SELECT COALESCE(MAX(f.revision),0) AS revision,
         COALESCE(SUM(CASE WHEN f.kind='credit' AND v.id IS NULL THEN f.amount ELSE 0 END),0) AS credit_amount,
         COALESCE(SUM(CASE WHEN f.kind='replacement' AND v.id IS NULL THEN f.quantity ELSE 0 END),0) AS replacement_quantity,
         COALESCE(SUM(CASE WHEN f.kind IN('credit','replacement') AND v.id IS NULL THEN 1 ELSE 0 END),0) AS active_count
         FROM procurement_return_followups f LEFT JOIN procurement_return_followups v ON v.org_id=f.org_id AND v.target_id=f.id AND v.kind='void'
         WHERE f.org_id=? AND f.return_id=?`,
        actor.orgId,
        returned.id,
      )!,
      review = this.store.get<Observation>(
        "SELECT * FROM procurement_return_followups WHERE org_id=? AND return_id=? AND kind='review' ORDER BY revision DESC LIMIT 1",
        actor.orgId,
        returned.id,
      );
    return {
      revision: Number(totals.revision),
      state: review?.state ?? "open",
      resolution: review?.resolution ?? null,
      originalCost: returned.quantity * returned.unit_cost,
      creditAmount: Number(totals.credit_amount),
      replacementQuantity: Number(totals.replacement_quantity),
      currency: this.identity.organization(actor).currency,
      activeCount: Number(totals.active_count),
    };
  }
  summary(actor: Actor, returnId: string) {
    actor = this.authorize(actor);
    return this.aggregate(actor, this.returned(actor, returnId));
  }
  history(actor: Actor, returnId: string, after?: number) {
    actor = this.authorize(actor);
    const returned = this.returned(actor, returnId);
    if (after !== undefined) {
      integer(after, "supplier history cursor", 1);
      check(
        this.store.get(
          "SELECT id FROM procurement_return_followups WHERE org_id=? AND return_id=? AND revision=?",
          actor.orgId,
          returned.id,
          after,
        ),
        "NOT_FOUND",
        "Supplier history cursor not found.",
        404,
      );
    }
    const rows = this.store.all<Observation>(
      `SELECT f.*,EXISTS(SELECT 1 FROM procurement_return_followups v WHERE v.org_id=f.org_id AND v.kind='void' AND v.target_id=f.id) AS voided FROM procurement_return_followups f WHERE f.org_id=? AND f.return_id=? ${after === undefined ? "" : "AND f.revision<?"} ORDER BY f.revision DESC LIMIT 21`,
      actor.orgId,
      returned.id,
      ...(after === undefined ? [] : [after]),
    );
    const items = rows
      .slice(0, 20)
      .map(({ input_hash, result, ...row }) => ({ ...row }));
    return {
      items,
      next: rows.length > 20 ? String(items.at(-1)!.revision) : null,
    };
  }
  private record(
    actor: Actor,
    key: string,
    kind: string,
    input: Base,
    details: {
      amount?: number;
      quantity?: number;
      receiptId?: string;
      observationId?: string;
      state?: string;
      resolution?: string | null;
    },
    validate: (
      current: Actor,
      returned: Return,
      summary: ReturnType<SupplierFollowups["aggregate"]>,
    ) => void,
  ) {
    return this.platform.command(
      actor,
      `purchase.return.${kind}`,
      key,
      { ...input, ...details },
      () => {
        const current = this.authorize(actor, true);
        this.returned(current, input.returnId);
      },
      () => {
        const current = this.authorize(actor, true),
          returned = this.returned(current, input.returnId);
        const payload = {
          ...input,
          ...details,
          revision: integer(input.revision, "supplier follow-up revision", 0),
          reference: text(
            text(input.reference, "supplier follow-up reference")
              .normalize("NFKC")
              .toUpperCase(),
            "supplier follow-up reference",
          ),
          evidence: text(input.evidence, "supplier evidence", 1000),
        };
        const hash = digest(canonical({ kind, ...payload })),
          old = this.store.get<Observation>(
            "SELECT * FROM procurement_return_followups WHERE org_id=? AND reference=?",
            current.orgId,
            payload.reference,
          );
        if (old) {
          check(
            old.input_hash === hash,
            "RECEIPT_CONFLICT",
            "Supplier reference already records different details.",
          );
          return JSON.parse(old.result) as { id: string; revision: number };
        }
        const summary = this.aggregate(current, returned);
        check(
          summary.revision === payload.revision,
          "REVISION",
          "Supplier follow-up changed. Reload before reviewing.",
        );
        check(
          kind === "review" || summary.state === "open",
          "STATE",
          "Reopen the supplier return before changing its outcomes.",
        );
        validate(current, returned, summary);
        const result = { id: id(), revision: summary.revision + 1 };
        this.store.run(
          "INSERT INTO procurement_return_followups VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          result.id,
          current.orgId,
          returned.id,
          result.revision,
          kind,
          payload.reference,
          payload.evidence,
          details.amount ?? 0,
          details.quantity ?? 0,
          details.receiptId ?? null,
          details.observationId ?? null,
          details.state ?? null,
          details.resolution ?? null,
          current.id,
          now(),
          hash,
          JSON.stringify(result),
        );
        this.platform.event(
          current,
          "SupplierReturnFollowupRecorded",
          returned.id,
          { observationId: result.id, revision: result.revision, kind },
        );
        return result;
      },
    );
  }
  credit(actor: Actor, key: string, input: SupplierCreditInput) {
    // Include currency in the command fingerprint and normalized observation identity.
    return this.record(
      actor,
      key,
      "credit",
      input,
      { amount: input.amount },
      (current, _returned, summary) => {
        integer(input.amount, "supplier credit amount", 1, 1_000_000_000);
        integer(
          summary.creditAmount + input.amount,
          "total supplier credit amount",
          1,
          1_000_000_000_000,
        );
        check(
          input.currency === this.identity.organization(current).currency,
          "CURRENCY",
          "Supplier credit must use the organization currency; FX requires separate reconciliation.",
          400,
        );
      },
    );
  }
  replacement(actor: Actor, key: string, input: SupplierReplacementInput) {
    return this.record(
      actor,
      key,
      "replacement",
      input,
      { receiptId: input.receiptId, quantity: input.quantity },
      (current, returned, summary) => {
        const quantity = integer(
          input.quantity,
          "replacement quantity",
          1,
          100000,
        );
        check(
          quantity + summary.replacementQuantity <= returned.quantity,
          "QUANTITY",
          "Replacement links exceed the units returned.",
        );
        const receipt = this.store.get(
          "SELECT r.*,p.supplier_id,l.product_id FROM procurement_receipts r JOIN procurement_orders p ON p.org_id=r.org_id AND p.id=r.po_id JOIN procurement_lines l ON l.org_id=r.org_id AND l.id=r.line_id WHERE r.org_id=? AND r.id=?",
          current.orgId,
          text(input.receiptId, "replacement receipt ID"),
        );
        check(receipt, "NOT_FOUND", "Replacement receipt not found.", 404);
        check(
          receipt.supplier_id === returned.supplier_id &&
            receipt.product_id === returned.product_id &&
            receipt.po_id !== returned.po_id,
          "REPLACEMENT",
          "Replacement requires a new purchase order from the same supplier for the same product.",
        );
        // A received unit can support only one active replacement link, even across returns.
        const linked = Number(
          this.store.get(
            `SELECT COALESCE(SUM(f.quantity),0) AS quantity FROM procurement_return_followups f WHERE f.org_id=? AND f.kind='replacement' AND f.receipt_id=? AND NOT EXISTS(SELECT 1 FROM procurement_return_followups v WHERE v.org_id=f.org_id AND v.kind='void' AND v.target_id=f.id)`,
            current.orgId,
            input.receiptId,
          )!.quantity,
        );
        check(
          linked + quantity <= Number(receipt.quantity),
          "QUANTITY",
          "Replacement receipt is already linked to other returned units.",
        );
      },
    );
  }
  void(actor: Actor, key: string, input: SupplierVoidInput) {
    return this.record(
      actor,
      key,
      "void",
      input,
      { observationId: input.observationId },
      (current, returned) => {
        const row = this.store.get<Observation>(
          "SELECT * FROM procurement_return_followups WHERE org_id=? AND return_id=? AND id=?",
          current.orgId,
          returned.id,
          text(input.observationId, "supplier observation ID"),
        );
        check(row, "NOT_FOUND", "Supplier observation not found.", 404);
        check(
          ["credit", "replacement"].includes(row.kind),
          "STATE",
          "Only a credit observation or replacement link can be voided.",
        );
        check(
          !this.store.get(
            "SELECT id FROM procurement_return_followups WHERE org_id=? AND target_id=?",
            current.orgId,
            row.id,
          ),
          "STATE",
          "Supplier observation was already voided.",
        );
      },
    );
  }
  review(actor: Actor, key: string, input: SupplierReviewInput) {
    return this.record(
      actor,
      key,
      "review",
      input,
      { state: input.state, resolution: input.resolution },
      (_current, _returned, summary) => {
        check(
          ["open", "closed"].includes(input.state),
          "VALIDATION",
          "Invalid supplier follow-up state.",
          400,
        );
        check(
          summary.state !== input.state,
          "STATE",
          "Supplier return already has this follow-up state.",
        );
        check(
          input.state === "open"
            ? input.resolution === null
            : ["reconciled", "no-remedy"].includes(input.resolution ?? ""),
          "RESOLUTION",
          "Select an explicit closure resolution; reopening has no resolution.",
          400,
        );
        if (input.state === "closed") {
          check(
            input.resolution === "reconciled"
              ? summary.activeCount > 0
              : summary.activeCount === 0,
            "RESOLUTION",
            "Reconciled closure requires an active outcome; no-remedy closure requires none.",
          );
        }
      },
    );
  }
}
