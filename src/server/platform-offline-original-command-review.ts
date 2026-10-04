import { types } from "node:util";
import {
  canonical,
  check,
  digest,
  permit,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { IntegrationCosts } from "./integration-costs.ts";
import { Platform } from "./platform.ts";
import {
  StockJournalDelivery,
  type OfflineOriginalJournalReview,
} from "./stock-journal-delivery.ts";
import { PlatformOfflineOriginalObservationReviewReader } from "./platform-offline-original-observation-review.ts";

export const originalCommandReviewLimits = Object.freeze({
  commands: 1000,
  audits: 4000,
  rowBytes: 65536,
  totalBytes: 8 * 1024 * 1024,
  jsonDepth: 48,
  jsonNodes: 16384,
});
const names = [
  "accounting.journal.prepare",
  "accounting.journal.decide",
  "accounting.journal.original-retry.prepare",
  "accounting.journal.cancel-original",
  "accounting.journal.original-cancellation.evidence",
] as const;
type Name = (typeof names)[number];
type Data = Record<string, unknown>;
type Attempt = OfflineOriginalJournalReview["attempts"][number];
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function valid(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_COMMAND",
    "Original command provenance is incomplete, unsupported or inconsistent.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_COMMAND_LIMIT",
    "Original command provenance exceeds the fixed native profile.",
  );
}
function id(v: unknown): asserts v is string {
  valid(typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v));
}
function text(v: unknown, max = 160): asserts v is string {
  valid(
    typeof v === "string" &&
      v.length > 0 &&
      v.length <= max &&
      v.trim() === v &&
      !/[\u0000-\u001f\u007f]/.test(v),
  );
}
function instant(v: unknown): asserts v is string {
  valid(
    typeof v === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v,
  );
}
function hash(v: unknown): asserts v is string {
  valid(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function own(value: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  valid(d && "value" in d);
  return d.value;
}
function owner(value: unknown, prototype: object): asserts value is object {
  valid(
    value &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Object.getPrototypeOf(value) === prototype,
  );
}
function principal(value: Actor): Actor {
  valid(value && typeof value === "object" && !types.isProxy(value));
  valid([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  // Only the two bounded locator descriptors are examined; ignored grants are never read.
  const actorId = own(value, "id"),
    orgId = own(value, "orgId");
  id(actorId);
  id(orgId);
  return { id: actorId, orgId } as Actor;
}
function json(raw: string, style: "command" | "audit"): Data {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    valid(false);
  }
  const stack: [unknown, number][] = [[v, 0]];
  let nodes = 0;
  while (stack.length) {
    const [x, depth] = stack.pop()!;
    bounded(
      ++nodes <= originalCommandReviewLimits.jsonNodes &&
        depth <= originalCommandReviewLimits.jsonDepth,
    );
    if (x !== null && typeof x === "object") {
      const children = Object.values(x);
      bounded(
        nodes + stack.length + children.length <=
          originalCommandReviewLimits.jsonNodes,
      );
      for (const child of children) stack.push([child, depth + 1]);
    }
    if (typeof x === "number") valid(Number.isSafeInteger(x));
  }
  valid(v !== null && typeof v === "object" && !Array.isArray(v));
  valid((style === "audit" ? canonical(v) : JSON.stringify(v)) === raw);
  return v as Data;
}
function freeze<T>(v: T): Frozen<T> {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}
function journalView(a: Attempt) {
  const r = a.row;
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceHash: a.plan.input.sourceHash,
    leg: r.leg,
    postingDate: r.posting_date,
    attemptId: r.attempt_id || null,
    bindingId: r.binding_id,
    realm: r.realm,
    reviewHash: r.review_hash,
    requestRef: `DJ-${digest(r.id).slice(0, 18)}`,
    state: r.state,
    externalId: r.external_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    decisionBy: r.decision_by,
    decisionAt: r.decision_at,
    decisionReason: r.decision_reason,
    leaseStarted: r.lease_started,
    leaseMode: r.lease_mode,
    dispatched: !!r.dispatched,
    plan: a.plan,
  };
}
type Receipt = {
  actorId: string;
  command: Name;
  key: string;
  requestHash: string;
  result: Data;
  createdAt: string;
  audit: { id: string; sequence: number; createdAt: string };
  preimage:
    | { status: "matched"; payload: Data }
    | {
        status: "not-retained";
        blocker: "DECISION_REQUEST_PREIMAGE_NOT_RETAINED";
      };
};
/** Trusted internal, same-writer historical consistency. This object grants no
 * source/provider authenticity, import, release or transport permission. */
export class PlatformOfflineOriginalCommandReviewReader {
  readonly #store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly journals: StockJournalDelivery,
  ) {
    this.owners();
    this.#store = database.owned("platform");
  }
  private owners() {
    owner(this.database, Database.prototype);
    owner(this.identity, Identity.prototype);
    owner(this.journals, StockJournalDelivery.prototype);
    valid(
      own(this.identity, "database") === this.database &&
        own(this.journals, "database") === this.database &&
        own(this.journals, "identity") === this.identity,
    );
    const platform = own(this.journals, "platform");
    owner(platform, Platform.prototype);
    valid(
      own(platform, "database") === this.database &&
        own(this.identity, "platform") === platform,
    );
    const costs = own(this.journals, "costs");
    owner(costs, IntegrationCosts.prototype);
    valid(
      own(costs, "database") === this.database &&
        own(costs, "identity") === this.identity &&
        own(costs, "platform") === platform &&
        own(costs, "journals") === this.journals,
    );
    // Reject per-instance substitutions before calling any task operation.
    for (const [o, methods] of [
      [this.database, ["requireTransaction", "owned"]],
      [this.identity, ["currentActor", "security"]],
      [this.journals, ["readOfflineOriginalInTransaction"]],
      [platform, ["rawRecoveryHoldInTransaction"]],
    ] as const)
      for (const method of methods) valid(!Object.hasOwn(o, method));
    for (const o of [
      this.database,
      this.identity,
      this.journals,
      platform,
      costs,
    ])
      for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(o)))
        if (key !== "constructor") valid(!Object.hasOwn(o, key));
    for (const [o, module] of [
      [this.identity, "iam"],
      [this.journals, "integration"],
      [costs, "integration"],
      [platform, "platform"],
    ] as const) {
      const store = own(o, "store");
      owner(store, Store.prototype);
      valid(
        own(store, "database") === this.database &&
          own(store, "owner") === module,
      );
      for (const key of Object.getOwnPropertyNames(Store.prototype))
        if (key !== "constructor") valid(!Object.hasOwn(store, key));
    }
  }
  getInTransaction(actorInput: Actor, journalId: string) {
    this.owners();
    valid(own(this.#store, "database") === this.database);
    this.database.requireTransaction();
    id(journalId);
    const actor = this.identity.currentActor(principal(actorInput));
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Current organization finance staff is required.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing original command provenance.",
      403,
    );
    const s = this.#store,
      unchanged = s.get("SELECT total_changes() AS n")!.n;
    // Entire organization sets, including unrelated names: no paged read and no
    // name-filter escape for changed command/audit labels. Only numeric SQL
    // results enter JS until BOTH sets pass fixed type/UTF-8 byte budgets.
    const specs = [
      {
        from: "platform_commands c",
        where: "c.org_id=?",
        fields:
          "c.org_id c.actor_id c.name c.key c.hash c.result c.created_at".split(
            " ",
          ),
        limit: originalCommandReviewLimits.commands,
      },
      {
        from: "platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id",
        where: "a.org_id=?",
        fields:
          "a.id a.org_id a.actor_id a.action a.reference a.detail a.created_at o.org_id".split(
            " ",
          ),
        limit: originalCommandReviewLimits.audits,
      },
    ];
    let bytes = 0;
    const counts: number[] = [];
    for (const spec of specs) {
      const sum = spec.fields
          .map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`)
          .join("+"),
        bad = spec.fields.map((c) => `typeof(${c})!='text'`).join(" OR ");
      const size = s.get(
        `SELECT COUNT(*) AS n,COALESCE(MAX(CASE WHEN ${bad} THEN 1 ELSE 0 END),0) AS bad,COALESCE(MAX(${sum}),0) AS largest,COALESCE(SUM(${sum}),0) AS bytes FROM ${spec.from} WHERE ${spec.where}`,
        actor.orgId,
      )!;
      bounded(
        Number.isSafeInteger(size.n) &&
          Number(size.n) <= spec.limit &&
          Number.isSafeInteger(size.bytes) &&
          Number(size.bytes) >= 0 &&
          Number.isSafeInteger(size.largest) &&
          Number(size.largest) <= originalCommandReviewLimits.rowBytes,
      );
      valid(size.bad === 0);
      bytes += Number(size.bytes);
      counts.push(Number(size.n));
    }
    // Reverse closure reads no foreign text into JS. Bound the complete foreign
    // command set before SQLite validates any JSON for identity collision checks.
    const foreignFields = specs[0]!.fields;
    const foreignBytes = foreignFields
      .map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`)
      .join("+");
    const foreign = s.get(
      `SELECT COUNT(*) AS n,COALESCE(MAX(CASE WHEN ${foreignFields.map((c) => `typeof(${c})!='text'`).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad,COALESCE(MAX(${foreignBytes}),0) AS largest,COALESCE(SUM(${foreignBytes}),0) AS bytes FROM platform_commands c WHERE c.org_id!=?`,
      actor.orgId,
    )!;
    bounded(
      Number.isSafeInteger(foreign.n) &&
        Number(foreign.n) <= originalCommandReviewLimits.commands &&
        Number.isSafeInteger(foreign.bytes) &&
        Number(foreign.bytes) >= 0 &&
        Number.isSafeInteger(foreign.largest) &&
        Number(foreign.largest) <= originalCommandReviewLimits.rowBytes,
    );
    valid(foreign.bad === 0);
    bounded(
      bytes + Number(foreign.bytes) <= originalCommandReviewLimits.totalBytes,
    );
    const collisionWhere =
      "(c.org_id!=? OR (c.name LIKE 'accounting.journal.%' AND c.name NOT IN(?,?,?,?,?)))";
    valid(
      s.get(
        `SELECT COUNT(*) AS n FROM platform_commands c WHERE ${collisionWhere} AND json_valid(c.result)=0`,
        actor.orgId,
        ...names,
      )!.n === 0,
    );
    // The native authorizer deliberately prohibits json_tree/json_each. Do not
    // relax it or decode another tenant's result into JS. Native IDs are ASCII:
    // after refusing ANY unicode escape in this collision-only profile, literal
    // matching covers all JSON occurrences, including duplicate keys. Escaped
    // foreign/unsupported results require a separate owning contract.
    valid(
      s.get(
        `SELECT COUNT(*) AS n FROM platform_commands c WHERE ${collisionWhere} AND instr(c.result,char(92)||'u')>0`,
        actor.orgId,
        ...names,
      )!.n === 0,
    );
    valid(
      s.get(
        `SELECT COUNT(*) AS n FROM platform_audit_order o LEFT JOIN platform_audit a ON a.id=o.audit_id WHERE (o.org_id=? OR a.org_id=?) AND (a.id IS NULL OR a.org_id!=o.org_id OR typeof(o.sequence)!='integer' OR o.sequence<1 OR o.sequence>9007199254740991)`,
        actor.orgId,
        actor.orgId,
      )!.n === 0,
    );
    const clock = s.get(
        "SELECT COUNT(*) AS n,MAX(sequence) AS sequence FROM platform_audit_clock WHERE id=1",
      )!,
      greatest = s.get(
        "SELECT COALESCE(MAX(sequence),0) AS sequence FROM platform_audit_order",
      )!;
    valid(
      clock.n === 1 &&
        Number.isSafeInteger(clock.sequence) &&
        Number(clock.sequence) >= Number(greatest.sequence) &&
        Number(clock.sequence) >= 0,
    );
    const sets = specs.map((spec, index) => {
      const projection = spec.fields
        .map((c, i) => `${c} AS f${i},hex(CAST(${c} AS BLOB)) AS b${i}`)
        .join(",");
      const rows = s.all(
        `SELECT ${projection}${index === 1 ? ",o.sequence AS sequence" : ""} FROM ${spec.from} WHERE ${spec.where} ORDER BY ${index === 0 ? "c.actor_id,c.name,c.key" : "o.sequence"}`,
        actor.orgId,
      );
      valid(rows.length === counts[index]);
      return rows.map((row) => {
        const clean: Row = {};
        spec.fields.forEach((c, i) => {
          const v = row[`f${i}`];
          valid(
            typeof v === "string" &&
              Buffer.from(v, "utf8").toString("hex").toUpperCase() ===
                row[`b${i}`],
          );
          clean[c.replace("o.org_id", "order_org_id").split(".").at(-1)!] = v;
        });
        if (index === 1) clean.sequence = row.sequence!;
        return clean;
      });
    });
    const [commands, audits] = sets as [Row[], Row[]];
    const auditLinks = new Map<string, Row>();
    let sequence = 0;
    for (const a of audits) {
      id(a.id);
      id(a.actor_id);
      text(a.action);
      text(a.reference, 2000);
      instant(a.created_at);
      valid(
        a.org_id === actor.orgId &&
          a.order_org_id === actor.orgId &&
          Number.isSafeInteger(a.sequence) &&
          Number(a.sequence) > sequence,
      );
      sequence = Number(a.sequence);
      if (!names.includes(a.action as Name)) continue;
      const detail = json(a.detail as string, "audit");
      valid(Object.keys(detail).length === 1);
      hash(detail.requestHash);
      const k = canonical([a.actor_id, a.action, a.reference]);
      valid(!auditLinks.has(k));
      auditLinks.set(k, { ...a, requestHash: detail.requestHash });
    }
    const receipts: { row: Row; result: Data; audit: Row }[] = [];
    for (const c of commands) {
      id(c.actor_id);
      text(c.name);
      text(c.key, 128);
      hash(c.hash);
      instant(c.created_at);
      valid(c.org_id === actor.orgId);
      if (!names.includes(c.name as Name)) continue;
      const k = canonical([c.actor_id, c.name, c.key]),
        audit = auditLinks.get(k);
      valid(
        audit &&
          audit.requestHash === c.hash &&
          String(audit.created_at) >= c.created_at,
      );
      auditLinks.delete(k);
      receipts.push({
        row: c,
        result: json(c.result as string, "command"),
        audit,
      });
    }
    valid(auditLinks.size === 0);
    const native = this.journals.readOfflineOriginalInTransaction(
      actor,
      journalId,
    );
    valid(native.orgId === actor.orgId);
    const nativeSourceId = native.packet.id;
    id(nativeSourceId);
    const observations = new PlatformOfflineOriginalObservationReviewReader(
      this.database,
      this.identity,
    ).getInTransaction(actor);
    const selectedIds = new Set(native.attempts.map((a) => a.row.id));
    const selected = receipts.filter((c) => {
      const view = c.row.name === names[4] ? c.result.journal : c.result;
      valid(view && typeof view === "object" && !Array.isArray(view));
      const v = view as Data;
      id(v.id);
      id(v.sourceId);
      valid(!selectedIds.has(v.id) || v.sourceId === nativeSourceId);
      if (v.sourceId !== nativeSourceId) return false;
      valid(selectedIds.has(v.id));
      return true;
    });
    const used = new Set<object>();
    const matched = (
      receipt: (typeof receipts)[number],
      expected: unknown,
      payload: Data,
      preimageRequired = true,
    ): Receipt => {
      valid(canonical(receipt.result) === canonical(expected));
      const matches = digest(canonical(payload)) === receipt.row.hash;
      valid(matches || !preimageRequired);
      used.add(receipt);
      return {
        actorId: receipt.row.actor_id as string,
        command: receipt.row.name as Name,
        key: receipt.row.key as string,
        requestHash: receipt.row.hash as string,
        result: receipt.result,
        createdAt: receipt.row.created_at as string,
        audit: {
          id: receipt.audit.id as string,
          sequence: receipt.audit.sequence as number,
          createdAt: receipt.audit.created_at as string,
        },
        preimage: matches
          ? { status: "matched", payload }
          : {
              status: "not-retained",
              blocker: "DECISION_REQUEST_PREIMAGE_NOT_RETAINED",
            },
      };
    };
    const one = (a: Attempt, name: Name) => {
      const matches = selected.filter(
        (c) =>
          c.row.name === name &&
          (name === names[4] ? (c.result.journal as Data).id : c.result.id) ===
            a.row.id,
      );
      valid(matches.length === 1);
      return matches[0]!;
    };
    const attemptFacts = native.attempts.map((a) => {
      const view = journalView(a),
        r = a.row;
      // Numeric-only reverse-scope refusal. Never materialize another tenant's
      // records. Any identity occurrence conservatively refuses.
      valid(
        s.get(
          "SELECT COUNT(*) AS n FROM platform_commands c WHERE c.org_id!=? AND (instr(c.result,?)>0 OR instr(c.result,?)>0)",
          actor.orgId,
          r.id,
          nativeSourceId,
        )!.n === 0,
      );
      valid(
        s.get(
          "SELECT COUNT(*) AS n FROM platform_commands c WHERE c.org_id=? AND c.name LIKE 'accounting.journal.%' AND c.name NOT IN(?,?,?,?,?) AND (instr(c.result,?)>0 OR instr(c.result,?)>0)",
          actor.orgId,
          ...names,
          r.id,
          nativeSourceId,
        )!.n === 0,
      );
      const preparation = one(a, r.attempt_id ? names[2] : names[0]);
      valid(
        preparation.row.actor_id === r.created_by &&
          String(preparation.row.created_at) >= r.created_at,
      );
      const ready = {
        ...view,
        state: "ready",
        externalId: null,
        decisionBy: null,
        decisionAt: null,
        decisionReason: null,
        leaseStarted: null,
        leaseMode: null,
        dispatched: false,
      };
      let preparationPayload: Data = a.plan.input as unknown as Data;
      if (r.attempt_id) {
        const previous = native.attempts.find((p) => p.row.id === r.attempt_id);
        valid(previous);
        const final = previous.observations.at(-1)!;
        const proof = previous.observations.find(
          (o) => o.hash === final.body.evidenceHash,
        );
        valid(proof);
        const evidence = {
          evidenceHash: proof.hash,
          revision: proof.revision,
          recordedBy: proof.recordedBy,
          recordedAt: proof.recordedAt,
          input: proof.body.input,
          snapshot: proof.body.snapshot,
        };
        const snapshot = {
          ...(proof.body.snapshot as Data),
          historyHash: digest(
            canonical(previous.observations.map((o) => o.hash)),
          ),
        };
        const dossier = {
          journal: journalView(previous),
          evidence,
          cancellation: final,
          snapshot,
          plan: {
            ...a.plan,
            input: {
              ...a.plan.input,
              reason: "Separately reviewed original retry",
            },
          },
        };
        preparationPayload = {
          journalId: r.attempt_id,
          reviewHash: digest(canonical(dossier)),
          reason: a.plan.input.reason,
        };
      }
      const prepare = matched(preparation, ready, preparationPayload);
      let decision: Receipt | null = null;
      if (r.state !== "ready") {
        const c = one(a, names[1]);
        valid(
          c.row.actor_id === r.decision_by &&
            String(c.row.created_at) >= String(r.decision_at) &&
            Number(c.audit.sequence) > prepare.audit.sequence,
        );
        decision = matched(
          c,
          {
            ...view,
            state: r.state === "rejected" ? "rejected" : "pending",
            externalId: null,
            leaseStarted: null,
            leaseMode: null,
            dispatched: false,
          },
          {
            journalId: r.id,
            reviewHash: r.review_hash,
            decision: r.state === "rejected" ? "reject" : "approve",
            reason: r.decision_reason,
          },
          false,
        );
      }
      let seq = decision?.audit.sequence ?? prepare.audit.sequence;
      const observationAudits = a.observations.map((o) => {
        const matches = observations.audits.filter(
          (x) => x.journalId === r.id && x.revision === o.revision,
        );
        valid(matches.length === 1);
        const audit = matches[0]!;
        valid(
          audit.hash === o.hash &&
            audit.actorId === o.recordedBy &&
            audit.createdAt >= o.recordedAt &&
            audit.sequence > seq,
        );
        seq = audit.sequence;
        return audit;
      });
      valid(
        observations.audits.filter((o) => o.journalId === r.id).length ===
          a.observations.length,
      );
      const evidenceReceipts = a.observations
        .filter((o) => o.body.kind === "original-cancellation-evidence")
        .map((o) => {
          const candidates = selected.filter(
            (c) =>
              c.row.name === names[4] &&
              (c.result.journal as Data).id === r.id &&
              (c.result.evidence as Data)?.evidenceHash === o.hash,
          );
          valid(candidates.length === 1);
          const c = candidates[0]!;
          const audit = observationAudits.find(
            (x) => x.revision === o.revision,
          )!;
          valid(
            c.row.actor_id === o.recordedBy &&
              String(c.row.created_at) >= o.recordedAt &&
              Number(c.audit.sequence) > audit.sequence,
          );
          const next = observationAudits.find(
            (x) => x.revision === o.revision + 1,
          );
          valid(!next || Number(c.audit.sequence) < next.sequence);
          return matched(
            c,
            {
              journal: {
                ...view,
                state: "unknown",
                externalId: null,
                leaseStarted: null,
                leaseMode: null,
              },
              evidence: {
                evidenceHash: o.hash,
                revision: o.revision,
                recordedBy: o.recordedBy,
                recordedAt: o.recordedAt,
                input: o.body.input,
                snapshot: o.body.snapshot,
              },
            },
            o.body.input as Data,
          );
        });
      let cancellation: Receipt | null = null;
      if (r.state === "cancelled") {
        const final = a.observations.at(-1)!,
          c = one(a, names[3]);
        valid(
          c.row.actor_id === final.recordedBy &&
            String(c.row.created_at) >= final.recordedAt &&
            Number(c.audit.sequence) > seq,
        );
        cancellation = matched(
          c,
          { ...view, cancellation: final },
          {
            journalId: r.id,
            requestRef: final.body.requestRef,
            evidenceHash: final.body.evidenceHash,
            reason: final.body.reason,
          },
        );
      }
      return {
        journalId: r.id,
        prepare,
        decision,
        evidence: evidenceReceipts,
        cancellation,
        observationAudits,
      };
    });
    valid(used.size === selected.length);
    for (const a of native.attempts)
      if (a.row.attempt_id) {
        const current = attemptFacts.find((x) => x.journalId === a.row.id)!,
          previous = attemptFacts.find(
            (x) => x.journalId === a.row.attempt_id,
          )!;
        valid(
          previous.cancellation &&
            current.prepare.audit.sequence >
              previous.cancellation.audit.sequence,
        );
      }
    for (const c of selected)
      valid(
        s.get(
          "SELECT COUNT(*) AS n FROM platform_audit WHERE org_id!=? AND actor_id=? AND action=? AND reference=?",
          actor.orgId,
          c.row.actor_id!,
          c.row.name!,
          c.row.key!,
        )!.n === 0,
      );
    valid(s.get("SELECT total_changes() AS n")!.n === unchanged);
    const body = {
      version: 1 as const,
      purpose: "distributor-platform-offline-original-commands-v1" as const,
      profile: originalCommandReviewLimits,
      orgId: native.orgId,
      region: native.region,
      currency: native.currency,
      journalId,
      nativeHash: native.hash,
      history: {
        commands: commands.length,
        audits: audits.length,
        selectedCommands: selected.length,
        otherSourceCommands: receipts.length - selected.length,
        hash: digest(
          canonical({
            purpose: "distributor-platform-original-command-history-v1",
            commands,
            audits,
          }),
        ),
        observationHash: observations.hash,
      },
      attempts: attemptFacts,
      blockers: [
        ...(attemptFacts.some(
          (a) => a.decision?.preimage.status === "not-retained",
        )
          ? ["DECISION_REQUEST_PREIMAGE_NOT_RETAINED"]
          : []),
        ...(receipts.length !== selected.length
          ? ["OTHER_SOURCE_RECEIPTS_NOT_OWNER_JOINED"]
          : []),
        "HISTORICAL_RECEIPTS_ARE_NOT_EXTERNAL_PROVENANCE",
        "SOURCE_COMPLETENESS_UNQUALIFIED",
        "CURRENT_EXTERNAL_AUTHORITY_REQUIRED",
        "RECOVERY_HOLD_RETAINED",
      ],
    };
    return freeze(
      structuredClone({ ...body, factsHash: digest(canonical(body)) }),
    );
  }
}
export type PlatformOfflineOriginalCommandReview = ReturnType<
  PlatformOfflineOriginalCommandReviewReader["getInTransaction"]
>;
