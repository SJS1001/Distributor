import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import type { CostWindow } from "./inventory-costs.ts";
import { Platform } from "./platform.ts";
import { CostCorrections } from "./cost-corrections.ts";

export type CostInput = {
  version: 1;
  batchRef: string;
  afterSequence: number;
  throughSequence: number;
  inventoryAccount: string;
  mappings: { type: string; offsetAccount: string }[];
  expectedMovements: number;
  expectedIncrease: number;
  expectedDecrease: number;
  expectedOpeningValue: number;
  expectedClosingValue: number;
  acknowledgment: string;
};
export type JournalLine = {
  movementId: string;
  sequence: number;
  date: string;
  account: string;
  debit: number;
  credit: number;
};
export type CostReport = CostWindow & {
  issues: { code: string; message: string }[];
  journal: JournalLine[];
  debit: number;
  credit: number;
};
type Packet = {
  sequence: number;
  id: string;
  org_id: string;
  batch_ref: string;
  input: string;
  input_hash: string;
  report: string;
  review_hash: string;
  state: string;
  created_by: string;
  created_at: string;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  artifact: string | null;
  content_hash: string | null;
  receipt: string | null;
  region: string;
  currency: string;
};
export type CostPacketView = {
  id: string;
  sequence: number;
  batchRef: string;
  state: string;
  reviewHash: string;
  contentHash: string | null;
  createdAt: string;
  createdBy: string;
  decisionAt: string | null;
  decisionBy: string | null;
  decisionReason: string | null;
  region: string;
  currency: string;
  input: CostInput;
  controls: Omit<CostReport, "movements" | "journal">;
  receipt: {
    receiverRef: string;
    receiverRegion: string;
    externalRef: string;
    contentHash: string;
    debit: number;
    credit: number;
    reason: string;
    recordedBy: string;
    recordedAt: string;
  } | null;
};
const accountCode = (raw: string) => {
  const value = text(raw, "Account code", 80);
  check(
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value),
    "VALIDATION",
    "Account codes must start with a letter or digit and contain only letters, digits, underscore, dot, slash or hyphen.",
    400,
  );
  return value;
};

// This is a reviewed regional file handoff. No provider transport or inferred
// chart of accounts is involved; receiver acceptance is a separate attestation.
export class IntegrationCosts {
  private store: Store;
  corrections: CostCorrections;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
  ) {
    this.store = database.owned("integration");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS integration_cost_packets(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL,batch_ref TEXT NOT NULL,region TEXT NOT NULL,currency TEXT NOT NULL,input TEXT NOT NULL,input_hash TEXT NOT NULL,report TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','blocked','rejected','reviewed','accepted')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,artifact TEXT,content_hash TEXT,receipt TEXT,UNIQUE(org_id,batch_ref)) STRICT;
      CREATE INDEX IF NOT EXISTS integration_cost_history ON integration_cost_packets(org_id,sequence);
      CREATE TABLE IF NOT EXISTS integration_cost_sources(org_id TEXT NOT NULL,movement_id TEXT NOT NULL,packet_id TEXT NOT NULL,PRIMARY KEY(org_id,movement_id)) STRICT;
      CREATE TABLE IF NOT EXISTS integration_cost_cursors(org_id TEXT PRIMARY KEY,through_sequence INTEGER NOT NULL,closing_value INTEGER NOT NULL,packet_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS integration_cost_receipts(org_id TEXT NOT NULL,receiver_ref TEXT NOT NULL,external_ref TEXT NOT NULL,packet_id TEXT NOT NULL UNIQUE,PRIMARY KEY(org_id,receiver_ref,external_ref)) STRICT;
    `);
    this.corrections = new CostCorrections(
      database,
      platform,
      identity,
      (actor, packetId) => {
        const packet = this.detail(actor, packetId);
        const artifact = this.download(actor, packetId).bytes;
        const document = JSON.parse(artifact);
        check(
          document.organizationId === actor.orgId &&
            document.packetId === packet.id &&
            document.region === packet.region &&
            document.currency === packet.currency &&
            canonical(document.report) === canonical(packet.report) &&
            canonical(document.input) === canonical(packet.input),
          "COST_INTEGRITY",
          "Original packet metadata differs from its immutable artifact.",
        );
        return { packet, report: packet.report, artifact };
      },
    );
  }
  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Buyer principals cannot access cost handoffs.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing cost handoffs.",
      403,
    );
    return actor;
  }
  private cursor(actor: Actor) {
    return (
      this.store.get<{
        through_sequence: number;
        closing_value: number;
        packet_id: string;
      }>(
        "SELECT through_sequence,closing_value,packet_id FROM integration_cost_cursors WHERE org_id=?",
        actor.orgId,
      ) ?? { through_sequence: 0, closing_value: 0, packet_id: "" }
    );
  }
  source(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const cursor = this.cursor(actor),
        organization = this.identity.organization(actor);
      const window = this.inventory.costs.window(
        actor,
        cursor.through_sequence,
      );
      check(
        window.openingValue === cursor.closing_value,
        "COST_RECONCILIATION",
        "Previously reviewed stock value changed; reconcile the cost history.",
      );
      return {
        ...window,
        region: organization.region,
        currency: organization.currency,
        previousPacketId: cursor.packet_id || null,
        recoveryHold: !!this.platform.recoveryHold(),
      };
    });
  }
  private packet(actor: Actor, packetId: string) {
    const packet = this.store.get<Packet>(
      "SELECT * FROM integration_cost_packets WHERE org_id=? AND id=?",
      actor.orgId,
      packetId,
    );
    check(packet, "NOT_FOUND", "Cost handoff not found.", 404);
    return packet;
  }
  private view(actor: Actor, packet: Packet): CostPacketView {
    const {
      movements: _movements,
      journal: _journal,
      ...controls
    } = JSON.parse(packet.report) as CostReport;
    return {
      id: packet.id,
      sequence: packet.sequence,
      batchRef: packet.batch_ref,
      state: packet.state,
      reviewHash: packet.review_hash,
      contentHash: packet.content_hash,
      createdAt: packet.created_at,
      createdBy: packet.created_by,
      decisionAt: packet.decision_at,
      decisionBy: packet.decision_by,
      decisionReason: packet.decision_reason,
      region: packet.region,
      currency: packet.currency,
      input: JSON.parse(packet.input),
      controls,
      receipt: packet.receipt ? JSON.parse(packet.receipt) : null,
    };
  }
  list(actor: Actor, page: { before?: number; limit?: number } = {}) {
    actor = this.principal(actor);
    const before = integer(
        page.before ?? Number.MAX_SAFE_INTEGER,
        "Cost history cursor",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      limit = integer(page.limit ?? 20, "Cost history page size", 1, 100);
    const rows = this.store.all<Packet>(
      "SELECT * FROM integration_cost_packets WHERE org_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?",
      actor.orgId,
      before,
      limit + 1,
    );
    return {
      items: rows.slice(0, limit).map((p) => this.view(actor, p)),
      next: rows.length > limit ? rows[limit - 1]!.sequence : null,
      recoveryHold: !!this.platform.recoveryHold(),
    };
  }
  detail(actor: Actor, packetId: string) {
    actor = this.principal(actor);
    const packet = this.packet(actor, packetId);
    return {
      ...this.view(actor, packet),
      report: JSON.parse(packet.report) as CostReport,
    };
  }
  private normalize(input: CostInput): CostInput {
    check(
      input.version === 1 &&
        Array.isArray(input.mappings) &&
        input.mappings.length <= 30,
      "VALIDATION",
      "Cost handoff version or mappings are invalid.",
      400,
    );
    const afterSequence = integer(
        input.afterSequence,
        "Cost cursor",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      inventoryAccount = accountCode(input.inventoryAccount),
      mappings = input.mappings
        .map((m) => ({
          type: text(m.type, "Movement type", 80),
          offsetAccount: accountCode(m.offsetAccount),
        }))
        .sort((a, b) => a.type.localeCompare(b.type));
    check(
      new Set(mappings.map((m) => m.type)).size === mappings.length &&
        mappings.every((m) => m.offsetAccount !== inventoryAccount),
      "VALIDATION",
      "Each movement type needs a unique mapping to a different offset account.",
      400,
    );
    return {
      version: 1,
      batchRef: text(input.batchRef, "Cost batch reference", 100),
      afterSequence,
      throughSequence: integer(
        input.throughSequence,
        "Cost cutoff",
        afterSequence + 1,
        Number.MAX_SAFE_INTEGER,
      ),
      inventoryAccount,
      mappings,
      expectedMovements: integer(
        input.expectedMovements,
        "Independent movement count",
        1,
        500,
      ),
      expectedIncrease: integer(
        input.expectedIncrease,
        "Independent cost increase",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      expectedDecrease: integer(
        input.expectedDecrease,
        "Independent cost decrease",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      expectedOpeningValue: integer(
        input.expectedOpeningValue,
        "Independent opening value",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      expectedClosingValue: integer(
        input.expectedClosingValue,
        "Independent closing value",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      acknowledgment: text(
        input.acknowledgment,
        "Regional handoff and duplicate-posting acknowledgment",
        2000,
      ),
    };
  }
  private assess(actor: Actor, input: CostInput): CostReport {
    const { more: _more, ...window } = this.inventory.costs.window(
        actor,
        input.afterSequence,
        input.throughSequence,
      ),
      issues: CostReport["issues"] = [],
      journal: JournalLine[] = [];
    for (const [matches, message] of [
      [
        window.movements.length === input.expectedMovements,
        "Movement count does not match the independent control.",
      ],
      [
        window.increase === input.expectedIncrease,
        "Cost increase does not match the independent control.",
      ],
      [
        window.decrease === input.expectedDecrease,
        "Cost decrease does not match the independent control.",
      ],
      [
        window.openingValue === input.expectedOpeningValue,
        "Opening stock value does not match the independent control.",
      ],
      [
        window.closingValue === input.expectedClosingValue,
        "Closing stock value does not match the independent control.",
      ],
    ] as const)
      if (!matches) issues.push({ code: "COST_CONTROL", message });
    const needed = new Set(
      window.movements.filter((m) => m.valueDelta !== 0).map((m) => m.type),
    );
    for (const mapping of input.mappings)
      if (!needed.has(mapping.type))
        issues.push({
          code: "COST_MAPPING",
          message: `Unused mapping: ${mapping.type}.`,
        });
    for (const m of window.movements) {
      if (!m.valueDelta) continue;
      const mapping = input.mappings.find((v) => v.type === m.type);
      if (!mapping) {
        issues.push({
          code: "COST_MAPPING",
          message: `Missing offset account for ${m.type}.`,
        });
        continue;
      }
      const amount = Math.abs(m.valueDelta),
        base = {
          movementId: m.id,
          sequence: m.sequence,
          date: m.createdAt.slice(0, 10),
        };
      journal.push(
        {
          ...base,
          account: input.inventoryAccount,
          debit: m.valueDelta > 0 ? amount : 0,
          credit: m.valueDelta < 0 ? amount : 0,
        },
        {
          ...base,
          account: mapping.offsetAccount,
          debit: m.valueDelta < 0 ? amount : 0,
          credit: m.valueDelta > 0 ? amount : 0,
        },
      );
    }
    const debit = journal.reduce((sum, l) => sum + BigInt(l.debit), 0n),
      credit = journal.reduce((sum, l) => sum + BigInt(l.credit), 0n);
    check(
      debit === credit && debit <= BigInt(Number.MAX_SAFE_INTEGER),
      "COST_RANGE",
      "Journal totals exceed the exact supported range.",
    );
    return {
      ...window,
      issues,
      journal,
      debit: Number(debit),
      credit: Number(credit),
    };
  }
  prepare(actor: Actor, key: string, raw: CostInput) {
    actor = this.principal(actor);
    const input = this.normalize(raw);
    return this.platform.command(
      actor,
      "accounting.cost.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
      },
      () => {
        const inputHash = digest(canonical(input)),
          old = this.store.get<Packet>(
            "SELECT * FROM integration_cost_packets WHERE org_id=? AND batch_ref=?",
            actor.orgId,
            input.batchRef,
          );
        if (old) {
          check(
            old.input_hash === inputHash,
            "COST_REFERENCE_CONFLICT",
            "This cost reference already identifies different evidence.",
          );
          return this.view(actor, old);
        }
        const cursor = this.cursor(actor);
        check(
          input.afterSequence === cursor.through_sequence,
          "COST_CURSOR",
          "Start with the last reviewed cutoff; cost handoffs cannot skip or repeat movements.",
        );
        const report = this.assess(actor, input);
        check(
          report.openingValue === cursor.closing_value,
          "COST_RECONCILIATION",
          "Previously reviewed stock value changed.",
        );
        const organization = this.identity.organization(actor);
        const packetId = id(),
          reviewHash = digest(
            canonical({
              inputHash,
              report,
              region: organization.region,
              currency: organization.currency,
            }),
          );
        this.store.run(
          "INSERT INTO integration_cost_packets(id,org_id,batch_ref,region,currency,input,input_hash,report,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          packetId,
          actor.orgId,
          input.batchRef,
          organization.region,
          organization.currency,
          canonical(input),
          inputHash,
          canonical(report),
          reviewHash,
          report.issues.length ? "blocked" : "ready",
          actor.id,
          now(),
        );
        this.platform.audit(actor, "accounting.cost.prepared", packetId, {
          reviewHash,
          afterSequence: input.afterSequence,
          throughSequence: input.throughSequence,
        });
        return this.view(actor, this.packet(actor, packetId));
      },
    );
  }
  decide(
    actor: Actor,
    key: string,
    input: {
      packetId: string;
      reviewHash: string;
      decision: "approve" | "reject";
      reason: string;
    },
  ) {
    actor = this.principal(actor);
    const reason = text(input.reason, "Cost review reason", 2000);
    check(
      ["approve", "reject"].includes(input.decision),
      "VALIDATION",
      "Cost decision is invalid.",
      400,
    );
    return this.platform.command(
      actor,
      "accounting.cost.decide",
      key,
      { ...input, reason },
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        this.packet(actor, input.packetId);
      },
      () => {
        const packet = this.packet(actor, input.packetId);
        check(
          packet.review_hash === input.reviewHash,
          "COST_REVIEW",
          "Review the saved cost fingerprint before deciding.",
        );
        if (!["ready", "blocked"].includes(packet.state)) {
          check(
            packet.decision_reason === reason &&
              packet.state ===
                (input.decision === "reject"
                  ? "rejected"
                  : packet.receipt
                    ? "accepted"
                    : "reviewed"),
            "COST_DECISION_CONFLICT",
            "This cost handoff has already received a different decision.",
          );
          return this.view(actor, packet);
        }
        const decidedAt = now();
        let artifact: string | null = null,
          contentHash: string | null = null;
        if (input.decision === "approve") {
          check(
            packet.state === "ready",
            "COST_BLOCKED",
            "Resolve the cost report issues in a new batch before approval.",
          );
          const source = JSON.parse(packet.input) as CostInput,
            cursor = this.cursor(actor),
            report = this.assess(actor, source);
          check(
            cursor.through_sequence === source.afterSequence &&
              cursor.closing_value === report.openingValue,
            "COST_CURSOR",
            "Another reviewed handoff advanced the cost cursor; prepare a new batch.",
          );
          const organization = this.identity.organization(actor);
          check(
            !report.issues.length &&
              organization.region === packet.region &&
              organization.currency === packet.currency &&
              digest(
                canonical({
                  inputHash: packet.input_hash,
                  report,
                  region: packet.region,
                  currency: packet.currency,
                }),
              ) === packet.review_hash,
            "COST_REVIEW",
            "Stock evidence or regional currency changed; prepare and review a new cost batch.",
          );
          artifact =
            canonical({
              format: "distributor-stock-cost",
              version: 1,
              packetId: packet.id,
              batchRef: packet.batch_ref,
              organizationId: actor.orgId,
              region: organization.region,
              currency: organization.currency,
              input: source,
              report,
              reviewHash: packet.review_hash,
              preparedBy: packet.created_by,
              preparedAt: packet.created_at,
              reviewedBy: actor.id,
              reviewedAt: decidedAt,
              reviewReason: reason,
            }) + "\n";
          contentHash = digest(artifact);
          for (const m of report.movements)
            this.store.run(
              "INSERT INTO integration_cost_sources VALUES(?,?,?)",
              actor.orgId,
              m.id,
              packet.id,
            );
          this.store.run(
            "INSERT INTO integration_cost_cursors VALUES(?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET through_sequence=excluded.through_sequence,closing_value=excluded.closing_value,packet_id=excluded.packet_id",
            actor.orgId,
            source.throughSequence,
            report.closingValue,
            packet.id,
          );
        }
        this.store.run(
          "UPDATE integration_cost_packets SET state=?,decision_by=?,decision_at=?,decision_reason=?,artifact=?,content_hash=? WHERE org_id=? AND id=?",
          input.decision === "approve" ? "reviewed" : "rejected",
          actor.id,
          decidedAt,
          reason,
          artifact,
          contentHash,
          actor.orgId,
          packet.id,
        );
        this.platform.audit(actor, "accounting.cost.decided", packet.id, {
          decision: input.decision,
          reviewHash: packet.review_hash,
          contentHash,
        });
        return this.view(actor, this.packet(actor, packet.id));
      },
    );
  }
  download(actor: Actor, packetId: string) {
    actor = this.principal(actor);
    const packet = this.packet(actor, packetId);
    check(
      ["reviewed", "accepted"].includes(packet.state) &&
        packet.artifact &&
        packet.content_hash,
      "COST_REVIEW_REQUIRED",
      "Only a reviewed cost handoff can be downloaded.",
    );
    check(
      digest(packet.artifact) === packet.content_hash,
      "COST_INTEGRITY",
      "Cost artifact failed its integrity check.",
    );
    return {
      bytes: packet.artifact,
      hash: packet.content_hash,
      filename: `distributor-cost-${packet.id}.json`,
    };
  }
  accept(
    actor: Actor,
    key: string,
    input: {
      packetId: string;
      contentHash: string;
      receiverRef: string;
      receiverRegion: "CA" | "US";
      externalRef: string;
      debit: number;
      credit: number;
      reason: string;
    },
  ) {
    actor = this.principal(actor);
    const normalized = {
      ...input,
      receiverRef: text(input.receiverRef, "Regional receiver reference", 100),
      externalRef: text(
        input.externalRef,
        "Receiver acceptance reference",
        160,
      ),
      reason: text(input.reason, "Acceptance evidence", 2000),
      debit: integer(
        input.debit,
        "Receiver debit total",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      credit: integer(
        input.credit,
        "Receiver credit total",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    };
    return this.platform.command(
      actor,
      "accounting.cost.accept",
      key,
      normalized,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        this.packet(actor, input.packetId);
      },
      () => {
        const packet = this.packet(actor, input.packetId),
          organization = this.identity.organization(actor),
          report = JSON.parse(packet.report) as CostReport;
        check(
          ["reviewed", "accepted"].includes(packet.state) &&
            packet.content_hash === input.contentHash &&
            packet.artifact &&
            digest(packet.artifact) === input.contentHash,
          "COST_INTEGRITY",
          "Acceptance must identify the exact reviewed artifact.",
        );
        check(
          input.receiverRegion === organization.region &&
            input.receiverRegion === packet.region &&
            organization.currency === packet.currency,
          "RESIDENCY",
          "This regional handoff requires a receiver in the original organization's region and currency.",
        );
        check(
          normalized.debit === report.debit &&
            normalized.credit === report.credit,
          "COST_CONTROL",
          "Receiver debit and credit totals must match the reviewed journal.",
        );
        const { packetId: _packetId, ...evidence } = normalized;
        if (packet.receipt) {
          const {
            recordedBy: _by,
            recordedAt: _at,
            ...old
          } = JSON.parse(packet.receipt);
          check(
            canonical(old) === canonical(evidence),
            "COST_ACCEPTANCE_CONFLICT",
            "This cost artifact has different recorded acceptance evidence.",
          );
          return this.view(actor, packet);
        }
        check(
          !this.store.get(
            "SELECT id FROM integration_cost_corrections WHERE org_id=? AND original_id=? AND state='reviewed'",
            actor.orgId,
            packet.id,
          ),
          "COST_CORRECTION_CONFLICT",
          "An approved correction supersedes this original handoff. Record its ledger outcome separately.",
        );
        check(
          !this.store.get(
            "SELECT packet_id FROM integration_cost_receipts WHERE org_id=? AND receiver_ref=? AND external_ref=?",
            actor.orgId,
            normalized.receiverRef,
            normalized.externalRef,
          ),
          "COST_ACCEPTANCE_CONFLICT",
          "Receiver reference already identifies another cost handoff.",
        );
        const receipt = {
          ...evidence,
          recordedBy: actor.id,
          recordedAt: now(),
        };
        this.store.run(
          "INSERT INTO integration_cost_receipts VALUES(?,?,?,?)",
          actor.orgId,
          normalized.receiverRef,
          normalized.externalRef,
          packet.id,
        );
        this.store.run(
          "UPDATE integration_cost_packets SET state='accepted',receipt=? WHERE org_id=? AND id=?",
          canonical(receipt),
          actor.orgId,
          packet.id,
        );
        this.platform.audit(actor, "accounting.cost.accepted", packet.id, {
          contentHash: packet.content_hash,
          receiverRef: normalized.receiverRef,
          externalRef: normalized.externalRef,
        });
        return this.view(actor, this.packet(actor, packet.id));
      },
    );
  }
}
