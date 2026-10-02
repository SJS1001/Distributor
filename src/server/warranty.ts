import { CLAIM_COVERAGE_INITIALIZE_DDL } from "./claim-coverage-schema.ts";
import { coverageDate, coverageDays } from "./coverage-policy.ts";
import {
  account,
  check,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
  type Role,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import { Fulfillment } from "./fulfillment.ts";
import { Billing } from "./billing.ts";
import { WarrantyEvidence } from "./warranty-evidence.ts";
import type { WarrantyDecisionPage } from "../shared/warranty-decisions.ts";
import type {
  ClaimCoverage,
  ClaimCoverageSnapshot,
  CoveragePolicy,
  WarrantyCoverage,
} from "../shared/warranty-coverage.ts";
import type { SoldSerial, SoldSerialPage } from "../shared/sold-serials.ts";
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
type ManufacturerCase = {
  id: string;
  org_id: string;
  claim_id: string;
  manufacturer: string;
  reference: string;
  state: "pending" | "accepted" | "denied" | "cancelled";
  revision: number;
  created_at: string;
};
type ReplacementShipping = {
  replacement_id: string;
  org_id: string;
  carrier: string;
  tracking: string;
  recipient: string;
  address: string;
  evidence: string;
  dispatched_at: string;
  state: "in_transit" | "delayed" | "lost" | "delivered";
  revision: number;
  observed_at: string;
};
type Replacement = {
  id: string;
  org_id: string;
  claim_id: string;
  new_unit_id: string;
  state: "reserved" | "cancelled" | "handed_over";
  revision: number;
  old_disposition: "restock" | "scrap";
  coverage_end: string;
  reason: string;
  recipient: string | null;
  evidence: string | null;
  created_at: string;
  completed_at: string | null;
};
export class Warranty {
  private store: Store;
  readonly evidence: WarrantyEvidence;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private fulfillment: Fulfillment,
    private billing: Billing,
  ) {
    this.store = database.owned("warranty");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS warranty_claims(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,unit_id TEXT NOT NULL,shipment_id TEXT NOT NULL,invoice_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('warranty','return')),state TEXT NOT NULL CHECK(state IN('submitted','approved','rejected','received','inspected','repair','disposed')),issue TEXT NOT NULL,evidence TEXT NOT NULL,coverage_end TEXT NOT NULL,inspection TEXT NOT NULL DEFAULT '',disposition TEXT,credit_id TEXT,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_replacements(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,claim_id TEXT NOT NULL,new_unit_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('reserved','cancelled','handed_over')),revision INTEGER NOT NULL CHECK(revision>=1),old_disposition TEXT NOT NULL CHECK(old_disposition IN('restock','scrap')),coverage_end TEXT NOT NULL,reason TEXT NOT NULL,recipient TEXT,evidence TEXT,created_at TEXT NOT NULL,completed_at TEXT) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS warranty_replacement_active ON warranty_replacements(org_id,claim_id) WHERE state IN('reserved','handed_over');
    CREATE TABLE IF NOT EXISTS warranty_replacement_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,replacement_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(replacement_id,revision)) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_replacement_shipping(
      replacement_id TEXT PRIMARY KEY REFERENCES warranty_replacements(id),org_id TEXT NOT NULL,
      carrier TEXT NOT NULL,tracking TEXT NOT NULL,carrier_key TEXT NOT NULL,tracking_key TEXT NOT NULL,
      recipient TEXT NOT NULL,address TEXT NOT NULL,evidence TEXT NOT NULL,dispatched_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN('in_transit','delayed','lost','delivered')),
      revision INTEGER NOT NULL CHECK(revision>=1),observed_at TEXT NOT NULL,
      UNIQUE(org_id,carrier_key,tracking_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_replacement_shipping_history(
      id TEXT PRIMARY KEY,org_id TEXT NOT NULL,replacement_id TEXT NOT NULL REFERENCES warranty_replacements(id),
      revision INTEGER NOT NULL CHECK(revision>=1),state TEXT NOT NULL,reference TEXT NOT NULL,reference_key TEXT NOT NULL,
      evidence TEXT NOT NULL,observed_at TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(replacement_id,revision),UNIQUE(replacement_id,reference_key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_decisions(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,claim_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS warranty_manufacturer_cases(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,claim_id TEXT NOT NULL,manufacturer TEXT NOT NULL,reference TEXT NOT NULL,manufacturer_key TEXT NOT NULL,reference_key TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','accepted','denied','cancelled')),revision INTEGER NOT NULL CHECK(revision>=1),created_at TEXT NOT NULL,UNIQUE(org_id,manufacturer_key,reference_key)) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS warranty_manufacturer_pending ON warranty_manufacturer_cases(org_id,claim_id) WHERE state='pending';
    CREATE TABLE IF NOT EXISTS warranty_manufacturer_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,case_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,evidence TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(case_id,revision)) STRICT;
  `);
    this.store.migrate(CLAIM_COVERAGE_INITIALIZE_DDL);
    this.evidence = new WarrantyEvidence(
      database,
      platform,
      identity,
      inventory,
      (actor, claimId) => this.claimRecord(actor, claimId),
    );
  }
  private authority(actor: Actor, roles: Role[]): Actor {
    const current = this.identity.currentActor(actor);
    permit(current, roles);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing warranty records.",
      403,
    );
    return current;
  }
  claim(actor: Actor, claimId: string): Claim {
    return this.database.transaction(() => this.claimRecord(actor, claimId));
  }
  decisionHistory(
    actor: Actor,
    claimId: string,
    after?: string,
  ): WarrantyDecisionPage {
    return this.database.transaction(() => {
      actor = this.authority(actor, [
        "warranty",
        "warehouse",
        "finance",
        "commercial",
        "buyer",
      ]);
      const claim = this.claimRecord(actor, claimId);
      let position = 0;
      if (after !== undefined) {
        const cursor = text(after, "Decision cursor", 128);
        const retained = this.store.get<{ position: number }>(
          "SELECT rowid AS position FROM warranty_decisions WHERE org_id=? AND claim_id=? AND id=?",
          actor.orgId,
          claim.id,
          cursor,
        );
        check(
          retained,
          "CURSOR",
          "Decision cursor is unavailable for this claim.",
          400,
        );
        position = retained.position;
      }
      const buyer = actor.role === "buyer";
      const rows = this.store.all<{
        id: string;
        action: string;
        created_at: string;
        reason?: string;
        actor_id?: string;
      }>(
        `SELECT id,action,created_at${buyer ? "" : ",reason,actor_id"} FROM warranty_decisions WHERE org_id=? AND claim_id=? AND rowid>? ORDER BY rowid LIMIT 21`,
        actor.orgId,
        claim.id,
        position,
      );
      const items = rows.slice(0, 20).map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: row.created_at,
        ...(buyer ? {} : { reason: row.reason!, actorId: row.actor_id! }),
      }));
      return { items, next: rows.length > 20 ? items[19]!.id : null };
    });
  }
  private claimRecord(actor: Actor, claimId: string): Claim {
    actor = this.authority(actor, [
      "warranty",
      "warehouse",
      "finance",
      "commercial",
      "buyer",
    ]);
    claimId = text(claimId, "Claim ID");
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
    return this.database.transaction(() => {
      actor = this.authority(actor, [
        "warranty",
        "warehouse",
        "finance",
        "commercial",
        "buyer",
      ]);
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
        )
        .map((c) => ({
          ...c,
          replacements: this.replacementRecords(actor, c.id),
          manufacturerCases:
            actor.role === "buyer" ? [] : this.manufacturerRecords(actor, c.id),
        }));
    });
  }
  replacements(actor: Actor, claimId: string) {
    return this.database.transaction(() =>
      this.replacementRecords(actor, claimId),
    );
  }
  private replacementRecords(actor: Actor, claimId: string) {
    actor = this.authority(actor, [
      "warranty",
      "warehouse",
      "finance",
      "commercial",
      "buyer",
    ]);
    claimId = text(claimId, "Claim ID");
    const c = this.claimRecord(actor, claimId);
    return this.store
      .all<Replacement>(
        "SELECT * FROM warranty_replacements WHERE org_id=? AND claim_id=? ORDER BY rowid",
        actor.orgId,
        claimId,
      )
      .filter((r) => {
        if (
          actor.role !== "warehouse" &&
          !this.store.get(
            "SELECT replacement_id FROM warranty_replacement_shipping WHERE replacement_id=? AND org_id=?",
            r.id,
            actor.orgId,
          )
        )
          return true;
        const viewer = actor;
        if (!["warehouse", "warranty"].includes(viewer.role)) return true;
        return [c.unit_id, r.new_unit_id].every((unitId) =>
          viewer.sites.includes(
            this.inventory.unit(viewer, unitId).warehouse_id,
          ),
        );
      })
      .map((r) => {
        const shipping = this.replacementShipping(actor, r.id);
        const viewer = shipping?.actor ?? actor;
        return {
          id: r.id,
          claimId,
          newUnitId: r.new_unit_id,
          oldSerial: this.inventory.unit(actor, c.unit_id).serial,
          newSerial: this.inventory.unit(actor, r.new_unit_id).serial,
          state: r.state,
          revision: r.revision,
          coverageEnd: r.coverage_end,
          oldDisposition: r.old_disposition,
          createdAt: r.created_at,
          completedAt: r.completed_at,
          shipping: shipping?.projection ?? null,
          ...(viewer.role === "buyer"
            ? {}
            : {
                reason: r.reason,
                recipient: r.recipient,
                evidence: r.evidence,
                history: this.store.all(
                  "SELECT revision,state,reason,actor_id,created_at FROM warranty_replacement_history WHERE org_id=? AND replacement_id=? ORDER BY revision",
                  actor.orgId,
                  r.id,
                ),
              }),
        };
      });
  }
  private replacement(actor: Actor, replacementId: string) {
    const r = this.store.get<Replacement>(
      "SELECT * FROM warranty_replacements WHERE org_id=? AND id=?",
      actor.orgId,
      replacementId,
    );
    check(r, "NOT_FOUND", "Replacement not found.", 404);
    const c = this.claimRecord(actor, r.claim_id);
    site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
    site(actor, this.inventory.unit(actor, r.new_unit_id).warehouse_id);
    return { r, c };
  }
  private hasReplacement(actor: Actor, claimId: string) {
    return this.store.get(
      "SELECT id FROM warranty_replacements WHERE org_id=? AND claim_id=? AND state IN('reserved','handed_over')",
      actor.orgId,
      claimId,
    );
  }
  private replacementHistory(actor: Actor, r: Replacement, reason: string) {
    this.store.run(
      "INSERT INTO warranty_replacement_history VALUES(?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      r.id,
      r.revision,
      r.state,
      text(reason, "replacement reason", 1000),
      actor.id,
      now(),
    );
    this.decision(actor, r.claim_id, `replacement.${r.state}`, reason);
  }
  reserveReplacement(
    actor: Actor,
    key: string,
    input: {
      claimId: string;
      newUnitId: string;
      oldDisposition: "restock" | "scrap";
      coveragePolicy: "inherit_original";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.replacement.reserve",
      key,
      input,
      () => {
        actor = this.authority(actor, ["warranty"]);
        const c = this.claimRecord(actor, input.claimId);
        site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
        site(actor, this.inventory.unit(actor, input.newUnitId).warehouse_id);
      },
      () => {
        const c = this.claimRecord(actor, input.claimId),
          old = this.inventory.unit(actor, c.unit_id);
        check(
          ["inspected", "repair"].includes(c.state),
          "STATE",
          "Replacement requires an inspected return or completed repair review.",
        );
        check(
          !c.credit_id && !this.hasReplacement(actor, c.id),
          "REMEDY",
          "Claim already has a credit or active replacement.",
        );
        check(
          ["restock", "scrap"].includes(input.oldDisposition) &&
            input.coveragePolicy === "inherit_original",
          "VALIDATION",
          "Select a returned-unit disposition and inherited original coverage.",
          400,
        );
        check(
          old.state === "stock" &&
            old.condition === "quarantine" &&
            old.quantity === 1,
          "STATE",
          "Returned serial must remain in quarantine.",
        );
        const replacementId = id();
        this.inventory.reserveReplacement(
          actor,
          replacementId,
          input.newUnitId,
          old.product_id,
        );
        this.store.run(
          "INSERT INTO warranty_replacements VALUES(?,?,?,?,'reserved',1,?,?,?,NULL,NULL,?,NULL)",
          replacementId,
          actor.orgId,
          c.id,
          input.newUnitId,
          input.oldDisposition,
          c.coverage_end,
          text(input.reason, "replacement reason", 1000),
          now(),
        );
        const { r } = this.replacement(actor, replacementId);
        this.replacementHistory(actor, r, input.reason);
        return {
          id: r.id,
          claimId: c.id,
          state: r.state,
          revision: r.revision,
        };
      },
    );
  }
  cancelReplacement(
    actor: Actor,
    key: string,
    input: { replacementId: string; revision: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "warranty.replacement.cancel",
      key,
      input,
      () => {
        actor = this.authority(actor, ["warranty"]);
        this.replacement(actor, input.replacementId);
      },
      () => {
        const { r } = this.replacement(actor, input.replacementId);
        check(
          integer(input.revision, "replacement revision", 1) === r.revision,
          "STALE_REPLACEMENT",
          "Replacement changed. Refresh and review its history.",
        );
        check(
          r.state === "reserved",
          "STATE",
          "Only a pending replacement can be cancelled.",
        );
        this.inventory.releaseReplacement(actor, r.id, input.reason);
        this.store.run(
          "UPDATE warranty_replacements SET state='cancelled',revision=revision+1,completed_at=? WHERE id=?",
          now(),
          r.id,
        );
        this.replacementHistory(
          actor,
          { ...r, state: "cancelled", revision: r.revision + 1 },
          input.reason,
        );
        return { id: r.id, state: "cancelled", revision: r.revision + 1 };
      },
    );
  }
  handoverReplacement(
    actor: Actor,
    key: string,
    input: {
      replacementId: string;
      revision: number;
      serial: string;
      recipient: string;
      evidence: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.replacement.handover",
      key,
      input,
      () => {
        actor = this.authority(actor, ["warehouse"]);
        this.replacement(actor, input.replacementId);
      },
      () => {
        const { r, c } = this.replacement(actor, input.replacementId);
        return this.completeReplacement(
          actor,
          r,
          c,
          input,
          "Replacement collected with recorded recipient and evidence.",
        );
      },
    );
  }
  private completeReplacement(
    actor: Actor,
    r: Replacement,
    c: Claim,
    input: {
      revision: number;
      serial: string;
      recipient: string;
      evidence: string;
    },
    historyReason: string,
  ) {
    check(
      integer(input.revision, "replacement revision", 1) === r.revision,
      "STALE_REPLACEMENT",
      "Replacement changed. Refresh and review its history.",
    );
    check(
      r.state === "reserved" &&
        ["inspected", "repair"].includes(c.state) &&
        !c.credit_id,
      "STATE",
      "Replacement is not pending on an inspected claim.",
    );
    const recipient = text(input.recipient, "recipient", 160),
      evidence = text(input.evidence, "handover evidence", 2000);
    this.inventory.handoverReplacement(actor, r.id, input.serial, evidence);
    this.inventory.returnDisposition(
      actor,
      c.unit_id,
      r.old_disposition,
      c.id,
      r.reason,
    );
    this.store.run(
      "UPDATE warranty_replacements SET state='handed_over',revision=revision+1,recipient=?,evidence=?,completed_at=? WHERE id=?",
      recipient,
      evidence,
      now(),
      r.id,
    );
    this.store.run(
      "UPDATE warranty_claims SET state='disposed',disposition='replacement' WHERE id=?",
      c.id,
    );
    this.replacementHistory(
      actor,
      { ...r, state: "handed_over", revision: r.revision + 1 },
      historyReason,
    );
    return {
      id: r.id,
      claimId: c.id,
      state: "handed_over",
      revision: r.revision + 1,
      newUnitId: r.new_unit_id,
    };
  }
  private shippingAuthority(
    actor: Actor,
    replacementId: string,
    write = false,
  ) {
    actor = this.authority(
      actor,
      write
        ? ["warehouse"]
        : ["warranty", "warehouse", "finance", "commercial", "buyer"],
    );
    replacementId = text(replacementId, "Replacement ID");
    const r = this.store.get<Replacement>(
      "SELECT * FROM warranty_replacements WHERE org_id=? AND id=?",
      actor.orgId,
      replacementId,
    );
    check(r, "NOT_FOUND", "Replacement not found.", 404);
    const c = this.claimRecord(actor, r.claim_id);
    if (write || ["warranty", "warehouse"].includes(actor.role)) {
      site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
      site(actor, this.inventory.unit(actor, r.new_unit_id).warehouse_id);
    }
    return { actor, r, c };
  }
  private shippingRow(actor: Actor, replacementId: string) {
    const row = this.store.get<ReplacementShipping>(
      "SELECT * FROM warranty_replacement_shipping WHERE org_id=? AND replacement_id=?",
      actor.orgId,
      replacementId,
    );
    check(row, "NOT_FOUND", "Replacement shipment not found.", 404);
    return row;
  }
  private shippingProjection(actor: Actor, row: ReplacementShipping) {
    return {
      carrier: row.carrier,
      tracking: row.tracking,
      state: row.state,
      revision: row.revision,
      dispatchedAt: row.dispatched_at,
      observedAt: row.observed_at,
      ...(actor.role === "buyer"
        ? {}
        : {
            recipient: row.recipient,
            address: row.address,
            evidence: row.evidence,
          }),
    };
  }
  private replacementShipping(actor: Actor, replacementId: string) {
    const row = this.store.get<ReplacementShipping>(
      "SELECT * FROM warranty_replacement_shipping WHERE org_id=? AND replacement_id=?",
      actor.orgId,
      replacementId,
    );
    if (!row) return null; // Existing collection records have no carrier shipment.
    actor = this.shippingAuthority(actor, replacementId).actor;
    return { actor, projection: this.shippingProjection(actor, row) };
  }
  dispatchReplacement(
    actor: Actor,
    key: string,
    input: {
      replacementId: string;
      revision: number;
      serial: string;
      recipient: string;
      address: string;
      carrier: string;
      tracking: string;
      evidence: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.replacement.dispatch",
      key,
      input,
      () => {
        actor = this.shippingAuthority(actor, input.replacementId, true).actor;
      },
      () => {
        const { r, c } = this.replacement(actor, input.replacementId);
        const carrier = text(input.carrier, "carrier", 160),
          tracking = text(input.tracking, "tracking reference", 160),
          address = text(input.address, "delivery address", 2000),
          recipient = text(input.recipient, "recipient", 160),
          evidence = text(input.evidence, "handover evidence", 2000);
        const carrierKey = carrier.normalize("NFKC").toLowerCase(),
          trackingKey = tracking.normalize("NFKC").toLowerCase();
        check(
          !this.store.get(
            "SELECT replacement_id FROM warranty_replacement_shipping WHERE org_id=? AND carrier_key=? AND tracking_key=?",
            actor.orgId,
            carrierKey,
            trackingKey,
          ),
          "TRACKING_REUSED",
          "Carrier tracking reference is already assigned to a replacement.",
        );
        const result = this.completeReplacement(
          actor,
          r,
          c,
          input,
          "Replacement handed to carrier with recorded tracking and evidence.",
        );
        const at = now();
        this.store.run(
          "INSERT INTO warranty_replacement_shipping VALUES(?,?,?,?,?,?,?,?,?,?,'in_transit',1,?)",
          r.id,
          actor.orgId,
          carrier,
          tracking,
          carrierKey,
          trackingKey,
          recipient,
          address,
          evidence,
          at,
          at,
        );
        this.shippingEvent(
          actor,
          r.id,
          1,
          "in_transit",
          "dispatch",
          evidence,
          at,
        );
        this.platform.event(actor, "warranty.replacement.dispatched", r.id, {
          claimId: c.id,
          newUnitId: r.new_unit_id,
        });
        return { ...result, shippingRevision: 1 };
      },
    );
  }
  private shippingEvent(
    actor: Actor,
    replacementId: string,
    revision: number,
    state: ReplacementShipping["state"],
    reference: string,
    evidence: string,
    observedAt: string,
  ) {
    this.store.run(
      "INSERT INTO warranty_replacement_shipping_history VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      replacementId,
      revision,
      state,
      reference,
      reference.normalize("NFKC").toLowerCase(),
      evidence,
      observedAt,
      actor.id,
      now(),
    );
  }
  updateReplacementShipping(
    actor: Actor,
    key: string,
    input: {
      replacementId: string;
      revision: number;
      state: ReplacementShipping["state"];
      reference: string;
      evidence: string;
      observedAt: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.replacement.shipping.update",
      key,
      input,
      () => {
        actor = this.shippingAuthority(actor, input.replacementId, true).actor;
      },
      () => {
        const row = this.shippingRow(actor, input.replacementId);
        check(
          integer(input.revision, "shipping revision", 1) === row.revision,
          "STALE_SHIPPING",
          "Replacement shipping changed. Refresh and review its history.",
        );
        check(
          row.state !== "delivered",
          "STATE",
          "Delivered shipping history is final; record any return through a claim.",
        );
        check(
          ["in_transit", "delayed", "lost", "delivered"].includes(input.state),
          "VALIDATION",
          "Select a supported shipping outcome.",
          400,
        );
        const reference = text(
            input.reference,
            "shipping evidence reference",
            160,
          ),
          evidence = text(input.evidence, "shipping evidence", 2000),
          observedAt = text(input.observedAt, "observed time", 24);
        const date = new Date(observedAt);
        check(
          Number.isFinite(date.getTime()) &&
            date.toISOString() === observedAt &&
            observedAt >= row.observed_at &&
            observedAt <= now(),
          "VALIDATION",
          "Observed time must be an ISO UTC time after the previous observation and not in the future.",
          400,
        );
        check(
          !this.store.get(
            "SELECT id FROM warranty_replacement_shipping_history WHERE replacement_id=? AND reference_key=?",
            row.replacement_id,
            reference.normalize("NFKC").toLowerCase(),
          ),
          "SHIPPING_REFERENCE",
          "Shipping reference is already recorded; review the original observation.",
        );
        this.store.run(
          "UPDATE warranty_replacement_shipping SET state=?,revision=revision+1,observed_at=? WHERE replacement_id=?",
          input.state,
          observedAt,
          row.replacement_id,
        );
        this.shippingEvent(
          actor,
          row.replacement_id,
          row.revision + 1,
          input.state,
          reference,
          evidence,
          observedAt,
        );
        this.platform.event(
          actor,
          "warranty.replacement.shipping.updated",
          row.replacement_id,
          { state: input.state, revision: row.revision + 1 },
        );
        return {
          id: row.replacement_id,
          state: input.state,
          revision: row.revision + 1,
        };
      },
    );
  }
  replacementShippingHistory(
    actor: Actor,
    replacementId: string,
    after?: number,
  ) {
    return this.database.transaction(() => {
      actor = this.shippingAuthority(actor, replacementId).actor;
      const row = this.shippingRow(actor, replacementId);
      const cursor =
        after === undefined
          ? 0
          : integer(after, "shipping history cursor", 1, row.revision);
      const rows = this.store.all<{
        revision: number;
        state: string;
        reference: string;
        evidence: string;
        observed_at: string;
        actor_id: string;
        created_at: string;
      }>(
        "SELECT revision,state,reference,evidence,observed_at,actor_id,created_at FROM warranty_replacement_shipping_history WHERE org_id=? AND replacement_id=? AND revision>? ORDER BY revision LIMIT 21",
        actor.orgId,
        replacementId,
        cursor,
      );
      const items = rows.slice(0, 20).map((h) => ({
        revision: h.revision,
        state: h.state,
        observedAt: h.observed_at,
        createdAt: h.created_at,
        ...(actor.role === "buyer"
          ? {}
          : {
              reference: h.reference,
              evidence: h.evidence,
              actorId: h.actor_id,
            }),
      }));
      return { items, next: rows.length > 20 ? items.at(-1)!.revision : null };
    });
  }
  private entitlement(actor: Actor, unitId: string, accountId: string) {
    this.identity.customer(actor, accountId);
    const custody = this.inventory.soldCustody(actor, unitId);
    if (custody.type === "replacement.handover") {
      const r = this.store.get<Replacement>(
        "SELECT * FROM warranty_replacements WHERE org_id=? AND id=? AND new_unit_id=? AND state='handed_over'",
        actor.orgId,
        custody.reference,
        unitId,
      );
      check(r, "NOT_FOUND", "Replacement ownership evidence is missing.", 404);
      const c = this.claimRecord(actor, r.claim_id);
      check(
        c.account_id === accountId,
        "NOT_FOUND",
        "No current serialized replacement for this account.",
        404,
      );
      return {
        shipmentId: c.shipment_id,
        invoiceId: c.invoice_id,
        coverageEnd: this.coverageDate(r.coverage_end),
        shippedAt: this.coverageDate(
          this.fulfillment.shipment(actor, c.shipment_id).shipped_at,
        ),
        source: "replacement_inherited" as const,
        provisionalDays: null,
        policy: this.claimCoverageRecord(c).snapshot?.policy ?? null,
        inheritedFromClaimId: c.id,
      };
    }
    const sale = this.fulfillment.soldUnit(
      actor,
      unitId,
      accountId,
      custody.reference,
    );
    const selected = this.identity.coveragePolicy(actor),
      policy: CoveragePolicy = {
        revision: selected.revision,
        days: selected.days,
        configuredAt: selected.configuredAt,
      },
      days = policy.days;
    const shippedAt = this.coverageDate(sale.shipment.shipped_at);
    const end = new Date(Date.parse(shippedAt) + days * 86400000);
    check(
      Number.isFinite(end.getTime()),
      "COVERAGE_DATE",
      "Calculated coverage end is outside the supported date range.",
    );
    return {
      shipmentId: sale.shipment.id,
      invoiceId: sale.shipment.invoice_id!,
      coverageEnd: end.toISOString(),
      shippedAt,
      source: "current_provisional_policy" as const,
      provisionalDays: days,
      policy,
      inheritedFromClaimId: null,
    };
  }
  private coverageDate(value: unknown) {
    return coverageDate(value);
  }
  private claimCoverageRecord(c: Claim): ClaimCoverage {
    const row = this.store.get<{ snapshot: string }>(
      "SELECT snapshot FROM warranty_claim_coverage WHERE org_id=? AND claim_id=?",
      c.org_id,
      c.id,
    );
    let snapshot: ClaimCoverageSnapshot | null = null;
    if (row) {
      const saved = JSON.parse(row.snapshot) as ClaimCoverageSnapshot;
      check(
        saved && typeof saved === "object" && !Array.isArray(saved),
        "COVERAGE_POLICY",
        "Retained coverage snapshot is invalid.",
      );
      const policy = saved.policy;
      if (policy !== null) {
        check(
          policy && typeof policy === "object" && !Array.isArray(policy),
          "COVERAGE_POLICY",
          "Retained coverage policy is invalid.",
        );
        integer(policy.revision, "retained coverage policy revision", 1);
        coverageDays(policy.days);
        check(
          policy.revision === 1
            ? policy.configuredAt === null
            : !!policy.configuredAt,
          "COVERAGE_POLICY",
          "Retained coverage policy version is invalid.",
        );
        if (policy.configuredAt !== null) coverageDate(policy.configuredAt);
      }
      check(
        (saved.source === "current_provisional_policy" &&
          policy !== null &&
          saved.inheritedFromClaimId === null) ||
          (saved.source === "replacement_inherited" &&
            typeof saved.inheritedFromClaimId === "string" &&
            saved.inheritedFromClaimId.length > 0),
        "COVERAGE_POLICY",
        "Retained coverage provenance is invalid.",
      );
      coverageDate(saved.shippedAt);
      coverageDate(saved.capturedAt);
      coverageDate(saved.coverageEnd);
      check(
        saved.coverageEnd === c.coverage_end,
        "COVERAGE_POLICY",
        "Retained claim and coverage dates differ.",
      );
      if (policy !== null)
        check(
          Date.parse(saved.shippedAt) + policy.days * 86400000 ===
            Date.parse(saved.coverageEnd),
          "COVERAGE_POLICY",
          "Retained coverage duration and dates differ.",
        );
      if (saved.source === "replacement_inherited") {
        const predecessor = this.store.get<Claim>(
          "SELECT * FROM warranty_claims WHERE org_id=? AND id=?",
          c.org_id,
          saved.inheritedFromClaimId!,
        );
        const replacement = this.store.get<Replacement>(
          "SELECT * FROM warranty_replacements WHERE org_id=? AND claim_id=? AND new_unit_id=? AND state='handed_over'",
          c.org_id,
          saved.inheritedFromClaimId!,
          c.unit_id,
        );
        check(
          predecessor &&
            replacement &&
            predecessor.id !== c.id &&
            predecessor.account_id === c.account_id &&
            predecessor.shipment_id === c.shipment_id &&
            predecessor.invoice_id === c.invoice_id &&
            predecessor.coverage_end === saved.coverageEnd &&
            replacement.coverage_end === saved.coverageEnd,
          "COVERAGE_POLICY",
          "Retained replacement coverage lineage is invalid.",
        );
      }
      snapshot = {
        policy:
          policy === null
            ? null
            : {
                revision: policy.revision,
                days: policy.days,
                configuredAt: policy.configuredAt,
              },
        source: saved.source,
        shippedAt: saved.shippedAt,
        coverageEnd: saved.coverageEnd,
        inheritedFromClaimId: saved.inheritedFromClaimId,
        capturedAt: saved.capturedAt,
      };
    }
    return {
      claimId: c.id,
      coverageEnd: this.coverageDate(c.coverage_end),
      snapshot,
      coveragePolicyApproved: false,
      eligibility: "requires_review",
    };
  }
  claimCoverage(actor: Actor, claimId: string): ClaimCoverage {
    return this.database.transaction(() =>
      this.claimCoverageRecord(this.claimRecord(actor, claimId)),
    );
  }
  coverage(actor: Actor, unitId: string, accountId: string): WarrantyCoverage {
    return this.database.transaction(() => {
      actor = this.authority(actor, ["warranty", "commercial", "buyer"]);
      unitId = text(unitId, "Sold unit ID");
      accountId = text(accountId, "Customer account ID");
      const entitlement = this.entitlement(actor, unitId, accountId),
        unit = this.inventory.unit(actor, unitId);
      check(
        unit.state === "sold" && unit.serial,
        "NOT_FOUND",
        "No currently sold serial for this account.",
        404,
      );
      const assessedAt = now();
      return {
        unitId,
        serial: unit.serial,
        accountId,
        shipmentId: entitlement.shipmentId,
        invoiceId: entitlement.invoiceId,
        shippedAt: entitlement.shippedAt,
        coverageEnd: entitlement.coverageEnd,
        source: entitlement.source,
        provisionalDays: entitlement.provisionalDays,
        policy: entitlement.policy,
        assessedAt,
        datePosition:
          Date.parse(assessedAt) < Date.parse(entitlement.shippedAt)
            ? "before_start"
            : Date.parse(assessedAt) >= Date.parse(entitlement.coverageEnd)
              ? "elapsed"
              : "within_dates",
        eligibility: "requires_review",
        coveragePolicyApproved: false,
      };
    });
  }
  soldUnits(actor: Actor) {
    return this.soldUnitPage(actor).items;
  }
  private soldSerialAccount(actor: Actor, unitId: string): string | null {
    const custody = this.inventory.soldCustody(actor, unitId);
    if (custody.type === "shipment")
      return (
        this.fulfillment.soldSerial(actor, custody.reference, unitId)?.shipment
          .account_id ?? null
      );
    if (custody.type !== "replacement.handover") return null;
    const row = this.store.get<{ accountId: string }>(
      `SELECT c.account_id AS accountId FROM warranty_replacements r
       JOIN warranty_claims c ON c.org_id=r.org_id AND c.id=r.claim_id
       WHERE r.org_id=? AND r.id=? AND r.new_unit_id=? AND r.state='handed_over'
       ${actor.role === "buyer" ? "AND c.account_id=?" : ""}`,
      actor.orgId,
      custody.reference,
      unitId,
      ...(actor.role === "buyer" ? [actor.accountId!] : []),
    );
    return row?.accountId ?? null;
  }
  soldUnitPage(
    actor: Actor,
    input: { query?: string; accountId?: string; after?: string } = {},
  ): SoldSerialPage {
    return this.database.transaction(() => {
      actor = this.authority(actor, ["warranty", "commercial", "buyer"]);
      const query =
        input.query === undefined
          ? ""
          : text(input.query, "Serial search", 100);
      const accountId =
        input.accountId === undefined
          ? actor.role === "buyer"
            ? text(actor.accountId, "Buyer account ID")
            : undefined
          : text(input.accountId, "Customer account ID");
      if (accountId !== undefined) this.identity.customer(actor, accountId);
      let after =
        input.after === undefined
          ? undefined
          : text(input.after, "Sold serial cursor", 128);
      if (after !== undefined) {
        // Validate the cursor's search and current sold state before resolving
        // customer ownership. No continuation may expose another account.
        this.inventory.soldSerialCandidates(actor, query, after);
        const owner = this.soldSerialAccount(actor, after);
        check(
          owner && (accountId === undefined || owner === accountId),
          "CURSOR",
          "Sold serial cursor is unavailable in your current account scope.",
          400,
        );
      }
      const items: SoldSerial[] = [];
      for (;;) {
        const candidates = this.inventory.soldSerialCandidates(
          actor,
          query,
          after,
        );
        for (const unit of candidates) {
          const owner = this.soldSerialAccount(actor, unit.id);
          if (!owner || (accountId !== undefined && owner !== accountId))
            continue;
          items.push({ ...unit, accountId: owner });
          if (items.length === 21)
            return { items: items.slice(0, 20), next: items[19]!.id };
        }
        if (candidates.length < 21) return { items, next: null };
        after = candidates.at(-1)!.id;
      }
    });
  }
  manufacturerCases(actor: Actor, claimId: string) {
    return this.database.transaction(() =>
      this.manufacturerRecords(actor, claimId),
    );
  }
  private manufacturerRecords(actor: Actor, claimId: string) {
    actor = this.authority(actor, [
      "warranty",
      "warehouse",
      "finance",
      "commercial",
    ]);
    claimId = text(claimId, "Claim ID");
    this.claimRecord(actor, claimId);
    return this.store
      .all<ManufacturerCase>(
        "SELECT * FROM warranty_manufacturer_cases WHERE org_id=? AND claim_id=? ORDER BY created_at DESC,id DESC",
        actor.orgId,
        claimId,
      )
      .map((c) => ({
        id: c.id,
        claimId: c.claim_id,
        manufacturer: c.manufacturer,
        reference: c.reference,
        state: c.state,
        revision: c.revision,
        createdAt: c.created_at,
        history: this.store.all(
          "SELECT revision,state,evidence,reason,actor_id,created_at FROM warranty_manufacturer_history WHERE org_id=? AND case_id=? ORDER BY revision",
          actor.orgId,
          c.id,
        ),
      }));
  }
  referManufacturer(
    actor: Actor,
    key: string,
    input: {
      claimId: string;
      manufacturer: string;
      reference: string;
      evidence: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.manufacturer.refer",
      key,
      input,
      () => {
        actor = this.authority(actor, ["warranty"]);
        const c = this.claimRecord(actor, input.claimId);
        site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
      },
      () => {
        const c = this.claimRecord(actor, input.claimId);
        check(
          c.type === "warranty" &&
            ["approved", "received", "inspected", "repair"].includes(c.state),
          "STATE",
          "Manufacturer referral requires an approved, unfinished warranty claim.",
        );
        const manufacturer = text(input.manufacturer, "manufacturer", 160),
          reference = text(input.reference, "manufacturer case reference", 160),
          manufacturerKey = manufacturer.normalize("NFKC").toLowerCase(),
          referenceKey = reference.normalize("NFKC").toLowerCase();
        check(
          !this.store.get(
            "SELECT id FROM warranty_manufacturer_cases WHERE org_id=? AND claim_id=? AND state='pending'",
            actor.orgId,
            c.id,
          ),
          "PENDING_MANUFACTURER_CASE",
          "Finish or cancel the pending manufacturer case before another referral.",
        );
        check(
          !this.store.get(
            "SELECT id FROM warranty_manufacturer_cases WHERE org_id=? AND manufacturer_key=? AND reference_key=?",
            actor.orgId,
            manufacturerKey,
            referenceKey,
          ),
          "MANUFACTURER_REFERENCE",
          "This manufacturer case reference is already recorded.",
        );
        const caseId = id();
        this.store.run(
          "INSERT INTO warranty_manufacturer_cases VALUES(?,?,?,?,?,?,?,'pending',1,?)",
          caseId,
          actor.orgId,
          c.id,
          manufacturer,
          reference,
          manufacturerKey,
          referenceKey,
          now(),
        );
        this.manufacturerHistory(
          actor,
          caseId,
          1,
          "pending",
          input.evidence,
          input.reason,
        );
        this.decision(actor, c.id, "manufacturer.referred", input.reason);
        return { id: caseId, claimId: c.id, state: "pending", revision: 1 };
      },
    );
  }
  private manufacturerCase(actor: Actor, caseId: string) {
    const c = this.store.get<ManufacturerCase>(
      "SELECT * FROM warranty_manufacturer_cases WHERE org_id=? AND id=?",
      actor.orgId,
      caseId,
    );
    check(c, "NOT_FOUND", "Manufacturer case not found.", 404);
    const claim = this.claimRecord(actor, c.claim_id);
    site(actor, this.inventory.unit(actor, claim.unit_id).warehouse_id);
    return c;
  }
  private manufacturerHistory(
    actor: Actor,
    caseId: string,
    revision: number,
    state: string,
    evidence: string,
    reason: string,
  ) {
    this.store.run(
      "INSERT INTO warranty_manufacturer_history VALUES(?,?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      caseId,
      revision,
      state,
      text(evidence, "manufacturer evidence reference", 2000),
      text(reason, "manufacturer decision reason", 1000),
      actor.id,
      now(),
    );
  }
  decideManufacturer(
    actor: Actor,
    key: string,
    input: {
      caseId: string;
      revision: number;
      outcome: "accepted" | "denied" | "cancelled";
      evidence: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "warranty.manufacturer.decide",
      key,
      input,
      () => {
        actor = this.authority(actor, ["warranty"]);
        this.manufacturerCase(actor, input.caseId);
      },
      () => {
        const c = this.manufacturerCase(actor, input.caseId);
        check(
          integer(input.revision, "case revision", 1) === c.revision,
          "STALE_MANUFACTURER_CASE",
          "Manufacturer case changed. Refresh and review its current history.",
        );
        check(
          c.state === "pending",
          "STATE",
          "Manufacturer case already has a final decision.",
        );
        check(
          ["accepted", "denied", "cancelled"].includes(input.outcome),
          "VALIDATION",
          "Unknown manufacturer outcome.",
          400,
        );
        this.store.run(
          "UPDATE warranty_manufacturer_cases SET state=?,revision=revision+1 WHERE id=? AND org_id=?",
          input.outcome,
          c.id,
          actor.orgId,
        );
        this.manufacturerHistory(
          actor,
          c.id,
          c.revision + 1,
          input.outcome,
          input.evidence,
          input.reason,
        );
        this.decision(
          actor,
          c.claim_id,
          `manufacturer.${input.outcome}`,
          input.reason,
        );
        return {
          id: c.id,
          claimId: c.claim_id,
          state: input.outcome,
          revision: c.revision + 1,
        };
      },
    );
  }
  submit(
    actor: Actor,
    key: string,
    input: {
      accountId: string;
      unitId: string;
      type: "warranty" | "return";
      policyRevision?: number;
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
        actor = this.authority(actor, ["warranty", "commercial", "buyer"]);
        this.identity.customer(actor, input.accountId);
      },
      () => {
        check(
          ["warranty", "return"].includes(input.type),
          "VALIDATION",
          "Unknown claim type.",
          400,
        );
        const entitlement = this.entitlement(
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
        const policy = entitlement.policy;
        check(
          input.policyRevision === undefined
            ? policy === null || policy.revision === 1
            : policy !== null &&
                integer(
                  input.policyRevision,
                  "reviewed coverage policy revision",
                  1,
                ) === policy.revision,
          "REVISION",
          "Coverage policy changed or was not reviewed; recheck the coverage dates before submitting.",
        );
        const coverageEnd = entitlement.coverageEnd,
          claimId = id(),
          issue = text(input.issue, "issue", 2000),
          evidence = text(input.evidence, "evidence reference", 2000);
        this.store.run(
          "INSERT INTO warranty_claims(id,org_id,account_id,unit_id,shipment_id,invoice_id,type,state,issue,evidence,coverage_end,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          claimId,
          actor.orgId,
          input.accountId,
          unit.id,
          entitlement.shipmentId,
          entitlement.invoiceId,
          input.type,
          "submitted",
          issue,
          evidence,
          coverageEnd,
          now(),
        );
        const snapshot: ClaimCoverageSnapshot = {
          policy,
          source: entitlement.source,
          shippedAt: entitlement.shippedAt,
          coverageEnd,
          inheritedFromClaimId: entitlement.inheritedFromClaimId,
          capturedAt: now(),
        };
        this.store.run(
          "INSERT INTO warranty_claim_coverage VALUES(?,?,?)",
          claimId,
          actor.orgId,
          JSON.stringify(snapshot),
        );
        this.recordActivity(actor, claimId, "submitted", issue);
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
    this.recordActivity(
      actor,
      claimId,
      action,
      text(reason, "decision reason", 1000),
      { reason },
    );
  }
  // Detail is validated by the native operation. Original issue and inspection
  // findings retain their existing 2,000-character limits, not decision limits.
  private recordActivity(
    actor: Actor,
    claimId: string,
    action: string,
    detail: string,
    decisionAudit?: { reason: string },
  ) {
    const activityId = id();
    this.store.run(
      "INSERT INTO warranty_decisions VALUES(?,?,?,?,?,?,?)",
      activityId,
      actor.orgId,
      claimId,
      action,
      detail,
      actor.id,
      now(),
    );
    this.platform.audit(actor, `warranty.${action}`, claimId, {
      activityId,
      ...decisionAudit,
    });
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
        actor = this.authority(actor, ["warranty"]);
        this.claimRecord(actor, input.claimId);
      },
      () => {
        const claim = this.claimRecord(actor, input.claimId);
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
        actor = this.authority(actor, ["warehouse"]);
        const claim = this.claimRecord(actor, input.claimId);
        site(actor, input.warehouseId);
        check(
          this.inventory.unit(actor, claim.unit_id).serial === input.serial,
          "SERIAL",
          "Returned serial does not match.",
        );
      },
      () => {
        const claim = this.claimRecord(actor, input.claimId);
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
        const received = this.inventory.unit(actor, claim.unit_id);
        this.recordActivity(
          actor,
          claim.id,
          "received",
          `Serial ${received.serial} received into quarantine at warehouse ${received.warehouse_id}, bin ${received.bin}.`,
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
        actor = this.authority(actor, ["warehouse", "warranty"]);
        const c = this.claimRecord(actor, input.claimId);
        site(actor, this.inventory.unit(actor, c.unit_id).warehouse_id);
      },
      () => {
        const claim = this.claimRecord(actor, input.claimId);
        check(
          claim.state === "received",
          "STATE",
          "Return must be received first.",
        );
        const findings = text(input.findings, "inspection findings", 2000);
        this.store.run(
          "UPDATE warranty_claims SET state='inspected',inspection=? WHERE id=?",
          findings,
          claim.id,
        );
        this.recordActivity(actor, claim.id, "inspected", findings);
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
        actor = this.authority(actor, ["warranty"]);
        const claim = this.claimRecord(actor, input.claimId);
        site(actor, this.inventory.unit(actor, claim.unit_id).warehouse_id);
      },
      () => {
        const claim = this.claimRecord(actor, input.claimId);
        check(
          !this.hasReplacement(actor, claim.id),
          "REMEDY",
          "Cancel the pending replacement before another disposition.",
        );
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
        actor = this.authority(actor, ["finance"]);
        this.claimRecord(actor, input.claimId);
      },
      () => {
        const claim = this.claimRecord(actor, input.claimId);
        check(
          claim.state === "disposed" &&
            !claim.credit_id &&
            !this.hasReplacement(actor, claim.id),
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
