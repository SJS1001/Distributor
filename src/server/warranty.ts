import {
  account,
  check,
  id,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import { Fulfillment } from "./fulfillment.ts";
import { Billing } from "./billing.ts";
export type Claim = {
  id: string;
  org_id: string;
  account_id: string;
  unit_id: string;
  shipment_id: string;
  invoice_id: string;
  type: string;
  state: string;
  issue: string;
  evidence: string;
  coverage_end: string;
  inspection: string;
  disposition: string | null;
  credit_id: string | null;
  created_at: string;
};
export class Warranty {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private fulfillment: Fulfillment,
    private billing: Billing,
  ) {
    this.store = database.owned("warranty");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS warranty_claims(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,unit_id TEXT NOT NULL,shipment_id TEXT NOT NULL,invoice_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('warranty','return')),state TEXT NOT NULL CHECK(state IN('submitted','approved','rejected','received','inspected','repair','disposed')),issue TEXT NOT NULL,evidence TEXT NOT NULL,coverage_end TEXT NOT NULL,inspection TEXT NOT NULL DEFAULT '',disposition TEXT,credit_id TEXT,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_decisions(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,claim_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
  `);
  }
  claim(actor: Actor, claimId: string): Claim {
    const row = this.store.get<Claim>(
      "SELECT * FROM warranty_claims WHERE org_id=? AND id=?",
      actor.orgId,
      claimId,
    );
    check(row, "NOT_FOUND", "Claim not found.", 404);
    account(actor, row.account_id);
    if (actor.role === "warehouse")
      site(actor, this.inventory.unit(actor, row.unit_id).warehouse_id);
    return row;
  }
  list(actor: Actor) {
    permit(actor, ["warranty", "warehouse", "finance", "commercial", "buyer"]);
    return this.store
      .all<Claim>(
        "SELECT * FROM warranty_claims WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (c) =>
          (actor.role !== "buyer" || c.account_id === actor.accountId) &&
          (actor.role !== "warehouse" ||
            actor.sites.includes(
              this.inventory.unit(actor, c.unit_id).warehouse_id,
            )),
      );
  }
  submit(
    actor: Actor,
    key: string,
    input: {
      accountId: string;
      unitId: string;
      type: "warranty" | "return";
      issue: string;
      evidence: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.submit",
      key,
      input,
      () => {
        permit(actor, ["warranty", "commercial", "buyer"]);
        this.identity.customer(actor, input.accountId);
      },
      () => {
        check(
          ["warranty", "return"].includes(input.type),
          "VALIDATION",
          "Unknown claim type.",
          400,
        );
        const sale = this.fulfillment.soldUnit(
            actor,
            input.unitId,
            input.accountId,
          ),
          unit = this.inventory.unit(actor, input.unitId);
        check(
          unit.state === "sold",
          "STATE",
          "Unit is not currently in sold custody.",
        );
        check(
          !this.store.get(
            "SELECT id FROM warranty_claims WHERE org_id=? AND unit_id=? AND state NOT IN('rejected','disposed')",
            actor.orgId,
            unit.id,
          ),
          "ACTIVE_CLAIM",
          "Unit already has an active claim.",
        );
        const days = JSON.parse(this.identity.organization(actor).policy)
          .coverageDays as number;
        const coverageEnd = new Date(
            Date.parse(sale.shipment.shipped_at!) + days * 86400000,
          ).toISOString(),
          claimId = id();
        this.store.run(
          "INSERT INTO warranty_claims(id,org_id,account_id,unit_id,shipment_id,invoice_id,type,state,issue,evidence,coverage_end,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          claimId,
          actor.orgId,
          input.accountId,
          unit.id,
          sale.shipment.id,
          sale.shipment.invoice_id!,
          input.type,
          "submitted",
          text(input.issue, "issue", 2000),
          text(input.evidence, "evidence reference", 2000),
          coverageEnd,
          now(),
        );
        return { id: claimId, coverageEnd, coveragePolicyApproved: false };
      },
    );
  }
  private decision(
    actor: Actor,
    claimId: string,
    action: string,
    reason: string,
  ) {
    this.store.run(
      "INSERT INTO warranty_decisions VALUES(?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      claimId,
      action,
      text(reason, "decision reason", 1000),
      actor.id,
      now(),
    );
    this.platform.audit(actor, `warranty.${action}`, claimId, { reason });
  }
  review(
    actor: Actor,
    key: string,
    input: { claimId: string; approved: boolean; reason: string },
  ) {
    return this.platform.command(
      actor,
      "warranty.review",
      key,
      input,
      () => {
        permit(actor, ["warranty"]);
        this.claim(actor, input.claimId);
      },
      () => {
        const claim = this.claim(actor, input.claimId);
        check(
          claim.state === "submitted",
          "STATE",
          "Claim has already been reviewed.",
        );
        check(
          typeof input.approved === "boolean",
          "VALIDATION",
          "Approval decision must be a boolean.",
          400,
        );
        this.store.run(
          "UPDATE warranty_claims SET state=? WHERE id=?",
          input.approved ? "approved" : "rejected",
          claim.id,
        );
        this.decision(
          actor,
          claim.id,
          input.approved ? "approved" : "rejected",
          input.reason,
        );
        return {
          id: claim.id,
          state: input.approved ? "approved" : "rejected",
        };
      },
    );
  }
  receive(
    actor: Actor,
    key: string,
    input: {
      claimId: string;
      warehouseId: string;
      bin: string;
      serial: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.receive",
      key,
      input,
      () => {
        permit(actor, ["warehouse"]);
        const claim = this.claim(actor, input.claimId);
        site(actor, input.warehouseId);
        check(
          this.inventory.unit(actor, claim.unit_id).serial === input.serial,
          "SERIAL",
          "Returned serial does not match.",
        );
      },
      () => {
        const claim = this.claim(actor, input.claimId);
        check(
          claim.state === "approved",
          "STATE",
          "Return requires an approved claim.",
        );
        this.inventory.receiveReturn(
          actor,
          claim.unit_id,
          input.warehouseId,
          input.bin,
          claim.id,
        );
        this.store.run(
          "UPDATE warranty_claims SET state='received' WHERE id=?",
          claim.id,
        );
        return { id: claim.id, state: "received" };
      },
    );
  }
  inspect(
    actor: Actor,
    key: string,
    input: { claimId: string; findings: string },
  ) {
    return this.platform.command(
      actor,
      "warranty.inspect",
      key,
      input,
      () => {
        permit(actor, ["warehouse", "warranty"]);
        const c = this.claim(actor, input.claimId);
        site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
      },
      () => {
        const claim = this.claim(actor, input.claimId);
        check(
          claim.state === "received",
          "STATE",
          "Return must be received first.",
        );
        this.store.run(
          "UPDATE warranty_claims SET state='inspected',inspection=? WHERE id=?",
          text(input.findings, "inspection findings", 2000),
          claim.id,
        );
        return { id: claim.id, state: "inspected" };
      },
    );
  }
  dispose(
    actor: Actor,
    key: string,
    input: {
      claimId: string;
      disposition: "restock" | "scrap" | "repair";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.disposition",
      key,
      input,
      () => {
        permit(actor, ["warranty"]);
        const claim = this.claim(actor, input.claimId);
        site(actor, this.inventory.unit(actor, claim.unit_id).warehouse_id);
      },
      () => {
        const claim = this.claim(actor, input.claimId);
        check(
          ["restock", "scrap", "repair"].includes(input.disposition),
          "VALIDATION",
          "Unknown disposition.",
          400,
        );
        check(
          claim.state === "inspected" ||
            (claim.state === "repair" && input.disposition !== "repair"),
          "STATE",
          "Disposition requires inspection or repair completion.",
        );
        this.inventory.returnDisposition(
          actor,
          claim.unit_id,
          input.disposition,
          claim.id,
          input.reason,
        );
        this.store.run(
          "UPDATE warranty_claims SET state=?,disposition=? WHERE id=?",
          input.disposition === "repair" ? "repair" : "disposed",
          input.disposition,
          claim.id,
        );
        this.decision(
          actor,
          claim.id,
          `disposition.${input.disposition}`,
          input.reason,
        );
        return {
          id: claim.id,
          state: input.disposition === "repair" ? "repair" : "disposed",
        };
      },
    );
  }
  credit(
    actor: Actor,
    key: string,
    input: { claimId: string; reason: string },
  ) {
    return this.platform.command(
      actor,
      "warranty.credit",
      key,
      input,
      () => {
        permit(actor, ["finance"]);
        this.claim(actor, input.claimId);
      },
      () => {
        const claim = this.claim(actor, input.claimId);
        check(
          claim.state === "disposed" && !claim.credit_id,
          "STATE",
          "Credit requires final disposition and must not already exist.",
        );
        const unit = this.inventory.unit(actor, claim.unit_id),
          line = this.billing
            .lines(actor, claim.invoice_id)
            .find((l) => l.product_id === unit.product_id);
        check(line, "INVOICE", "Original invoice line is missing.");
        const credit = this.billing.credit(
          actor,
          claim.invoice_id,
          `rma:${claim.id}`,
          input.reason,
          [{ lineId: String(line.id), quantity: 1 }],
        );
        this.store.run(
          "UPDATE warranty_claims SET credit_id=? WHERE id=?",
          credit.id,
          claim.id,
        );
        this.decision(actor, claim.id, "credited", input.reason);
        return { id: claim.id, creditId: credit.id };
      },
    );
  }
}
