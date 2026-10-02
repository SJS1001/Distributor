import {
  check,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";

export type ReceiptInput = {
  poId: string;
  lineId: string;
  deliveryRef: string;
  quantity: number;
  serials: string[];
  bin: string;
  quarantine: boolean;
};
export type DraftInput = ReceiptInput & { observedSku: string };

type DraftRow = {
  id: string;
  org_id: string;
  warehouse_id: string;
  po_id: string;
  line_id: string;
  delivery_ref: string;
  state: "draft" | "received" | "discarded";
  revision: number;
  input: string;
  result: string | null;
  created_at: string;
  updated_at: string;
};
type ReceiptResult = { id: string; unitIds: string[] };
type DraftResult = ReceiptResult & { draftId: string; draftRevision: number };
type Owners = {
  currentActor: (actor: Actor) => Actor;
  authorize: (actor: Actor, poId: string) => void;
  context: (
    actor: Actor,
    input: DraftInput,
    ready: boolean,
  ) => { warehouseId: string };
  receive: (actor: Actor, input: ReceiptInput) => ReceiptResult;
};

// Procurement owns incomplete receipt evidence; inventory receives only on confirmation.
export class ReceiptDrafts {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private owners: Owners,
  ) {
    this.store = database.owned("procurement");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS procurement_drafts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,po_id TEXT NOT NULL,line_id TEXT NOT NULL,delivery_ref TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('draft','received','discarded')),revision INTEGER NOT NULL CHECK(revision>0),input TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,po_id,line_id,delivery_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS procurement_draft_versions(draft_id TEXT NOT NULL,revision INTEGER NOT NULL,org_id TEXT NOT NULL,state TEXT NOT NULL,input TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(draft_id,revision)) STRICT;
    `);
  }
  private row(actor: Actor, draftId: string) {
    const row = this.store.get<DraftRow>(
      "SELECT * FROM procurement_drafts WHERE org_id=? AND id=?",
      actor.orgId,
      text(draftId, "draft ID"),
    );
    check(row, "NOT_FOUND", "Receipt draft not found.", 404);
    if (actor.role === "warehouse") site(actor, row.warehouse_id);
    return row;
  }
  private summary(row: DraftRow) {
    const { input, result, ...fields } = row;
    return {
      ...fields,
      input: JSON.parse(input) as DraftInput,
      result: result ? (JSON.parse(result) as DraftResult) : null,
    };
  }
  list(actor: Actor) {
    actor = this.owners.currentActor(actor);
    permit(actor, ["warehouse", "commercial", "finance"]);
    return this.store
      .all<DraftRow>(
        "SELECT * FROM procurement_drafts WHERE org_id=? ORDER BY updated_at DESC,id",
        actor.orgId,
      )
      .filter(
        (d) =>
          actor.role !== "warehouse" || actor.sites.includes(d.warehouse_id),
      )
      .map((d) => this.summary(d));
  }
  history(actor: Actor, draftId: string) {
    actor = this.owners.currentActor(actor);
    permit(actor, ["warehouse", "commercial", "finance"]);
    this.row(actor, draftId);
    return this.store
      .all<{
        revision: number;
        state: string;
        input: string;
        actor_id: string;
        reason: string;
        created_at: string;
      }>(
        "SELECT revision,state,input,actor_id,reason,created_at FROM procurement_draft_versions WHERE org_id=? AND draft_id=? ORDER BY revision",
        actor.orgId,
        draftId,
      )
      .map((v) => ({ ...v, input: JSON.parse(String(v.input)) as DraftInput }));
  }
  private version(actor: Actor, row: DraftRow, reason: string) {
    this.store.run(
      "INSERT INTO procurement_draft_versions VALUES(?,?,?,?,?,?,?,?)",
      row.id,
      row.revision,
      actor.orgId,
      row.state,
      row.input,
      actor.id,
      reason,
      row.updated_at,
    );
    this.platform.audit(actor, "purchase.draft.version", row.id, {
      revision: row.revision,
      state: row.state,
      reason,
    });
  }
  save(
    actor: Actor,
    key: string,
    input: DraftInput & { draftId: string | null; revision: number },
  ) {
    return this.platform.command(
      actor,
      "purchase.draft.save",
      key,
      input,
      () => {
        actor = this.owners.currentActor(actor);
        permit(actor, ["warehouse"]);
        if (input.draftId !== null) this.row(actor, input.draftId);
        else this.owners.authorize(actor, input.poId);
      },
      () => {
        const revision = integer(input.revision, "draft revision");
        const old =
          input.draftId === null ? null : this.row(actor, input.draftId);
        check(
          old ? old.state === "draft" : revision === 0,
          "STATE",
          "Only an open draft can be edited; a new draft starts at revision zero.",
        );
        if (old) {
          check(
            old.revision === revision,
            "REVISION",
            "Draft changed. Reload the saved draft before editing.",
          );
          check(
            old.po_id === input.poId &&
              old.line_id === input.lineId &&
              old.delivery_ref ===
                text(input.deliveryRef, "delivery reference"),
            "DRAFT_IDENTITY",
            "A saved draft's purchase line and delivery reference cannot be changed.",
          );
        }
        const context = this.owners.context(actor, input, false);
        const { draftId: _draftId, revision: _revision, ...payload } = input;
        const normalized: DraftInput = {
          ...payload,
          deliveryRef: text(input.deliveryRef, "delivery reference"),
          observedSku: text(input.observedSku, "observed SKU"),
          bin: text(input.bin, "bin"),
          serials: input.serials.map((s) => text(s, "serial")),
        };
        if (!old)
          check(
            !this.store.get(
              "SELECT id FROM procurement_drafts WHERE org_id=? AND po_id=? AND line_id=? AND delivery_ref=?",
              actor.orgId,
              input.poId,
              input.lineId,
              normalized.deliveryRef,
            ),
            "DRAFT_EXISTS",
            "This purchase line and delivery reference already has a saved draft. Resume it or use a new reference.",
          );
        const row: DraftRow = {
          id: old?.id ?? id(),
          org_id: actor.orgId,
          warehouse_id: context.warehouseId,
          po_id: input.poId,
          line_id: input.lineId,
          delivery_ref: normalized.deliveryRef,
          state: "draft",
          revision: revision + 1,
          input: JSON.stringify(normalized),
          result: null,
          created_at: old?.created_at ?? now(),
          updated_at: now(),
        };
        if (old)
          this.store.run(
            "UPDATE procurement_drafts SET revision=?,input=?,updated_at=? WHERE id=? AND org_id=?",
            row.revision,
            row.input,
            row.updated_at,
            row.id,
            actor.orgId,
          );
        else
          this.store.run(
            "INSERT INTO procurement_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            row.id,
            row.org_id,
            row.warehouse_id,
            row.po_id,
            row.line_id,
            row.delivery_ref,
            row.state,
            row.revision,
            row.input,
            row.result,
            row.created_at,
            row.updated_at,
          );
        this.version(
          actor,
          row,
          old ? "Saved edited receipt draft" : "Created receipt draft",
        );
        return this.summary(row);
      },
    );
  }
  confirm(
    actor: Actor,
    key: string,
    input: { draftId: string; revision: number },
  ) {
    return this.platform.command(
      actor,
      "purchase.draft.confirm",
      key,
      input,
      () => {
        actor = this.owners.currentActor(actor);
        permit(actor, ["warehouse"]);
        this.row(actor, input.draftId);
      },
      () => {
        const row = this.row(actor, input.draftId),
          revision = integer(input.revision, "draft revision", 1);
        if (row.state === "received") {
          check(
            row.revision === revision + 1,
            "REVISION",
            "This receipt was confirmed from a different draft revision.",
          );
          return JSON.parse(row.result!) as DraftResult;
        }
        check(
          row.state === "draft",
          "STATE",
          "Discarded drafts cannot be received.",
        );
        check(
          row.revision === revision,
          "REVISION",
          "Draft changed. Review the current saved scans before receiving.",
        );
        const payload = JSON.parse(row.input) as DraftInput;
        this.owners.context(actor, payload, true);
        const { observedSku: _sku, ...receiptInput } = payload;
        const result: DraftResult = {
          ...this.owners.receive(actor, receiptInput),
          draftId: row.id,
          draftRevision: row.revision + 1,
        };
        row.state = "received";
        row.revision++;
        row.result = JSON.stringify(result);
        row.updated_at = now();
        this.store.run(
          "UPDATE procurement_drafts SET state=?,revision=?,result=?,updated_at=? WHERE org_id=? AND id=?",
          row.state,
          row.revision,
          row.result,
          row.updated_at,
          actor.orgId,
          row.id,
        );
        this.version(actor, row, "Confirmed physical receipt");
        return result;
      },
    );
  }
  discard(
    actor: Actor,
    key: string,
    input: { draftId: string; revision: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "purchase.draft.discard",
      key,
      input,
      () => {
        actor = this.owners.currentActor(actor);
        permit(actor, ["warehouse"]);
        this.row(actor, input.draftId);
      },
      () => {
        const row = this.row(actor, input.draftId),
          reason = text(input.reason, "discard reason", 1000);
        check(
          row.state === "draft",
          "STATE",
          "Only an open draft can be discarded.",
        );
        check(
          row.revision === integer(input.revision, "draft revision", 1),
          "REVISION",
          "Draft changed. Reload before discarding.",
        );
        row.state = "discarded";
        row.revision++;
        row.updated_at = now();
        this.store.run(
          "UPDATE procurement_drafts SET state=?,revision=?,updated_at=? WHERE org_id=? AND id=?",
          row.state,
          row.revision,
          row.updated_at,
          actor.orgId,
          row.id,
        );
        this.version(actor, row, reason);
        return this.summary(row);
      },
    );
  }
}
