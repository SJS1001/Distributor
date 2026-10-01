import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  site,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Identity } from "./iam.ts";
import type { Catalog } from "./catalog.ts";
import type { Inventory } from "./inventory.ts";
import {
  labelRendererHash,
  renderLabel,
  type LabelFacts,
} from "./label-pdf.ts";

export class StockLabels {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private catalog: Catalog,
  ) {
    this.store = database.owned("inventory");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS inventory_label_renditions(org_id TEXT NOT NULL,facts_hash TEXT NOT NULL,facts TEXT NOT NULL,renderer_hash TEXT NOT NULL,bytes BLOB NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(org_id,facts_hash)) STRICT;
      CREATE TABLE IF NOT EXISTS inventory_label_downloads(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,actor_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,unit_id TEXT NOT NULL,revision INTEGER NOT NULL,copies INTEGER NOT NULL,facts_hash TEXT NOT NULL,content_hash TEXT NOT NULL,filename TEXT NOT NULL,size INTEGER NOT NULL,requested_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state='prepared')) STRICT;
    `);
  }
  private current(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["warehouse"]);
    return actor;
  }
  private facts(
    actor: Actor,
    unitId: string,
    revision: number,
    copies: number,
  ): LabelFacts {
    actor = this.current(actor);
    const u = this.inventory.unit(actor, unitId);
    site(actor, u.warehouse_id);
    check(
      u.revision === integer(revision, "stock revision", 1),
      "STALE_REVISION",
      "Stock changed. Reload before preparing labels.",
    );
    integer(copies, "label copies", 1, 20);
    check(
      u.state === "stock" && u.quantity > 0,
      "LABEL_STOCK",
      "Labels require physically held stock.",
    );
    const p = this.catalog.product(actor, u.product_id);
    return {
      unitId,
      warehouseId: u.warehouse_id,
      revision,
      sku: p.sku,
      serial: u.serial,
      copies,
    };
  }
  private rendition(actor: Actor, hash: string) {
    return this.store.get(
      "SELECT * FROM inventory_label_renditions WHERE org_id=? AND facts_hash=?",
      actor.orgId,
      hash,
    );
  }
  private verify(row: Row, hash: string) {
    check(
      row.facts_hash === hash &&
        digest(String(row.facts)) === hash &&
        digest(row.bytes as Uint8Array) === row.content_hash,
      "LABEL_INTEGRITY",
      "Stored label failed integrity verification.",
      500,
    );
  }
  async download(
    actor: Actor,
    key: string,
    unitId: string,
    input: { revision: number; copies: number },
    reauthenticate: () => Actor = () => this.identity.currentActor(actor),
  ) {
    actor = this.current(actor);
    const facts = this.facts(actor, unitId, input.revision, input.copies),
      serialized = canonical(facts),
      hash = digest(serialized);
    const existing = this.rendition(actor, hash);
    if (existing) this.verify(existing, hash);
    const bytes = existing
      ? Buffer.from(existing.bytes as Uint8Array)
      : await renderLabel(facts);
    const refreshed = reauthenticate();
    check(
      refreshed.id === actor.id && refreshed.orgId === actor.orgId,
      "FORBIDDEN",
      "Label principal changed.",
      403,
    );
    actor = this.current(refreshed);
    const receipt = this.platform.command(
      actor,
      "inventory.label.download",
      key,
      { unitId, ...input },
      () => {
        check(
          canonical(this.facts(actor, unitId, input.revision, input.copies)) ===
            serialized,
          "STALE_REVISION",
          "Label identity changed. Reload before preparing labels.",
        );
      },
      () => {
        let row = this.rendition(actor, hash);
        if (!row) {
          this.store.run(
            "INSERT INTO inventory_label_renditions VALUES(?,?,?,?,?,?)",
            actor.orgId,
            hash,
            serialized,
            labelRendererHash,
            bytes,
            digest(bytes),
          );
          row = this.rendition(actor, hash)!;
        }
        this.verify(row, hash);
        const result = {
          id: id(),
          unitId,
          revision: input.revision,
          copies: input.copies,
          filename: `Stock_${unitId}.pdf`,
          contentHash: String(row.content_hash),
          size: (row.bytes as Uint8Array).length,
          requestedAt: now(),
          state: "prepared",
        };
        this.store.run(
          "INSERT INTO inventory_label_downloads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          result.id,
          actor.orgId,
          actor.id,
          facts.warehouseId,
          unitId,
          result.revision,
          result.copies,
          hash,
          result.contentHash,
          result.filename,
          result.size,
          result.requestedAt,
          result.state,
        );
        return result;
      },
    );
    const row = this.rendition(actor, hash)!;
    this.verify(row, hash);
    check(
      receipt.contentHash === row.content_hash,
      "LABEL_INTEGRITY",
      "Label receipt and bytes disagree.",
      500,
    );
    return { receipt, bytes: Buffer.from(row.bytes as Uint8Array) };
  }
  downloads(actor: Actor) {
    actor = this.current(actor);
    if (actor.role !== "admin" && actor.sites.length === 0) return [];
    const scope =
      actor.role === "admin"
        ? ""
        : ` AND d.warehouse_id IN (${actor.sites.map(() => "?").join(",")})`;
    return this.store
      .all(
        `SELECT d.*,r.facts FROM inventory_label_downloads d JOIN inventory_label_renditions r ON r.org_id=d.org_id AND r.facts_hash=d.facts_hash WHERE d.org_id=?${scope} ORDER BY d.rowid DESC LIMIT 200`,
        actor.orgId,
        ...(actor.role === "admin" ? [] : actor.sites),
      )
      .map((r) => ({ ...r, facts: JSON.parse(String(r.facts)) }));
  }
}
