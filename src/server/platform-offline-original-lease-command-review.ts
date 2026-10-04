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
  type OfflineOriginalLeaseReview,
} from "./stock-journal-delivery.ts";

export const originalLeaseCommandReviewLimits = Object.freeze({
  commands: 1000,
  audits: 4000,
  events: 2000,
  jsonContainers: 512,
  outputBytes: 16 * 1024 * 1024,
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
  "accounting.journal.permission.prepare",
  "accounting.journal.permission.decide",
] as const;
type Name = (typeof names)[number];
type Data = Record<string, unknown>;
type Attempt = OfflineOriginalLeaseReview["attempts"][number];
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function valid(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_LEASE_COMMAND",
    "Original command provenance is incomplete, unsupported or inconsistent.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_LEASE_COMMAND_LIMIT",
    "Original command provenance exceeds the fixed native profile.",
  );
}
function id(v: unknown): asserts v is string {
  valid(
    !types.isProxy(v) &&
      typeof v === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(v),
  );
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
function principal(v: Actor): Actor {
  valid(!types.isProxy(v) && v !== null && typeof v === "object");
  valid([Object.prototype, null].includes(Object.getPrototypeOf(v)));
  const ds = Object.getOwnPropertyDescriptors(v);
  for (const k of Reflect.ownKeys(ds)) {
    valid(
      typeof k === "string" &&
        ["id", "orgId", "name", "role", "accountId", "sites"].includes(k),
    );
    const d = ds[k];
    valid(d && d.enumerable && "value" in d && !types.isProxy(d.value));
    if (k === "sites") {
      const a = d.value;
      valid(Array.isArray(a) && Object.getPrototypeOf(a) === Array.prototype);
      const keys = Reflect.ownKeys(a);
      bounded(keys.length <= 129);
      const ad = Object.getOwnPropertyDescriptors(a) as unknown as Record<
        string,
        PropertyDescriptor
      >;
      const n = ad.length!.value;
      valid(
        Number.isSafeInteger(n) && n >= 0 && n <= 128 && keys.length === n + 1,
      );
      for (let i = 0; i < n; i++) {
        const item = ad[String(i)];
        valid(item && item.enumerable && "value" in item);
        id(item.value);
      }
    } else
      valid(
        d.value === null ||
          (typeof d.value === "string" &&
            Buffer.byteLength(d.value) <= 2000 &&
            !d.value.includes("\0") &&
            Buffer.from(d.value).toString() === d.value),
      );
  }
  const actorId = ds.id?.value,
    orgId = ds.orgId?.value;
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
      ++nodes <= originalLeaseCommandReviewLimits.jsonNodes &&
        depth <= originalLeaseCommandReviewLimits.jsonDepth,
    );
    if (x !== null && typeof x === "object") {
      const children = Object.values(x);
      bounded(
        nodes + stack.length + children.length <=
          originalLeaseCommandReviewLimits.jsonNodes,
      );
      for (const child of children) stack.push([child, depth + 1]);
    }
    if (typeof x === "number") valid(Number.isSafeInteger(x));
    if (typeof x === "string")
      valid(!x.includes("\0") && Buffer.from(x).toString() === x);
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
const specs = [
  {
    table: "platform_commands",
    fields: "org_id actor_id name key hash result created_at",
    document: "result",
    name: "name",
    limit: 1000,
    order: "org_id,actor_id,name,key",
  },
  {
    table: "platform_audit",
    fields: "id org_id actor_id action reference detail created_at",
    document: "detail",
    name: "action",
    limit: 4000,
    order: "id",
  },
  {
    table: "platform_events",
    fields: "id org_id type reference payload created_at",
    document: "payload",
    name: "type",
    limit: 2000,
    order: "id",
  },
] as const;

/** Trusted internal, same-writer historical consistency. This object grants no
 * source/provider authenticity, import, release or transport permission. */
export class PlatformOfflineOriginalLeaseCommandReviewReader {
  readonly #store: Store;
  #active = false;
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
      [this.journals, ["readOfflineLeaseRetirementInTransaction"]],
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
  private scan(org: string) {
    let total = 0;
    // Fixed complete GLOBAL Platform sets. No selected-result or tenant LIMIT
    // can hide orphan/cross-org history; only numeric aggregates enter JS here.
    for (const spec of specs) {
      const cols = spec.fields.split(" "),
        sizes = cols.map((c) => `length(CAST(${c} AS BLOB))`),
        sum = sizes.join("+");
      const r = this.#store.get(
        `SELECT COUNT(*) AS n,COALESCE(SUM(${sum}),0) AS bytes,COALESCE(MAX(${sum}),0) AS largest,COALESCE(SUM(CASE WHEN ${cols.map((c) => `typeof(${c})!='text' OR instr(CAST(${c} AS BLOB),x'00')>0`).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad FROM ${spec.table}`,
      )!;
      bounded(
        Number.isSafeInteger(r.n) &&
          Number(r.n) <= spec.limit &&
          Number.isSafeInteger(r.bytes) &&
          Number(r.bytes) >= 0 &&
          Number(r.largest) <= originalLeaseCommandReviewLimits.rowBytes &&
          (total += Number(r.bytes)) <=
            originalLeaseCommandReviewLimits.totalBytes,
      );
      valid(r.bad === 0);
    }
    valid(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM platform_events WHERE typeof(version)!='integer' OR version<>1",
      )!.n === 0,
    );
    const order = this.#store.get(
      "SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(audit_id AS BLOB))+length(CAST(org_id AS BLOB))),0) AS bytes,COALESCE(MAX(length(CAST(audit_id AS BLOB))+length(CAST(org_id AS BLOB))),0) AS largest,COALESCE(SUM(CASE WHEN typeof(sequence)!='integer' OR sequence<1 OR sequence>9007199254740991 OR typeof(audit_id)!='text' OR typeof(org_id)!='text' OR instr(CAST(audit_id AS BLOB),x'00')>0 OR instr(CAST(org_id AS BLOB),x'00')>0 THEN 1 ELSE 0 END),0) AS bad FROM platform_audit_order",
    )!;
    bounded(
      Number(order.n) <= 4000 &&
        Number(order.largest) <= originalLeaseCommandReviewLimits.rowBytes &&
        Number.isSafeInteger(order.bytes) &&
        (total += Number(order.bytes)) <=
          originalLeaseCommandReviewLimits.totalBytes,
    );
    valid(order.bad === 0);
    valid(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM platform_audit_order o LEFT JOIN platform_audit a ON a.id=o.audit_id WHERE a.id IS NULL OR a.org_id<>o.org_id",
      )!.n === 0,
    );
    valid(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id WHERE o.audit_id IS NULL",
      )!.n === 0,
    );
    // Before json_valid, materialization or parse. Punctuation inside strings is
    // deliberately counted too; this conservative bound cannot undercount depth.
    for (const spec of specs) {
      const c = spec.document;
      const r = this.#store.get(
        `SELECT COALESCE(MAX(1+length(${c})-length(replace(replace(replace(replace(${c},',',''),':',''),'[',''),'{',''))),0) AS nodes,COALESCE(MAX(length(${c})-length(replace(replace(${c},'[',''),'{',''))),0) AS containers FROM ${spec.table}`,
      )!;
      bounded(
        Number(r.nodes) <= originalLeaseCommandReviewLimits.jsonNodes &&
          Number(r.containers) <=
            originalLeaseCommandReviewLimits.jsonContainers,
      );
      valid(
        this.#store.get(
          `SELECT COUNT(*) AS n FROM ${spec.table} WHERE NOT json_valid(${c})`,
        )!.n === 0,
      );
      // Unclassified foreign journal history is not assigned guessed tenancy.
      valid(
        this.#store.get(
          `SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${spec.name} LIKE 'accounting.journal.%' AND org_id<>?`,
          org,
        )!.n === 0,
      );
    }
    const clock = this.#store.get(
      "SELECT COUNT(*) AS n,MIN(id) AS id,MAX(sequence) AS sequence FROM platform_audit_clock",
    )!;
    const greatest = this.#store.get(
      "SELECT COALESCE(MAX(sequence),0) AS sequence FROM platform_audit_order",
    )!;
    valid(
      clock.n === 1 &&
        clock.id === 1 &&
        Number.isSafeInteger(clock.sequence) &&
        Number(clock.sequence) >= Number(greatest.sequence),
    );
    const decoded: Row[][] = [];
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (const spec of specs) {
      const rows = this.#store.all(
        `SELECT ${spec.fields
          .split(" ")
          .map((c) => `CAST(${c} AS BLOB) AS ${c}`)
          .join(
            ",",
          )}${spec.table === "platform_events" ? ",version" : ""} FROM ${spec.table} WHERE org_id=? ORDER BY ${spec.order}`,
        org,
      );
      const result = rows.map((r) => {
        const data: Row = {};
        for (const c of spec.fields.split(" ")) {
          const bytes = r[c];
          valid(bytes instanceof Uint8Array);
          let value: string;
          try {
            value = decoder.decode(bytes);
          } catch {
            valid(false);
          }
          valid(Buffer.from(value!).equals(Buffer.from(bytes)));
          data[c] = value!;
        }
        if (spec.table === "platform_events") data.version = r.version!;
        json(
          String(data[spec.document]),
          spec.table === "platform_commands" ? "command" : "audit",
        );
        return data;
      });
      decoded.push(result);
    }
    const orders = this.#store
      .all(
        "SELECT sequence,CAST(audit_id AS BLOB) AS audit_id,CAST(org_id AS BLOB) AS org_id FROM platform_audit_order WHERE org_id=? ORDER BY sequence",
        org,
      )
      .map((r) => {
        const result: Row = { sequence: r.sequence! };
        for (const c of ["audit_id", "org_id"]) {
          valid(r[c] instanceof Uint8Array);
          try {
            result[c] = decoder.decode(r[c] as Uint8Array);
          } catch {
            valid(false);
          }
        }
        return result;
      });
    const [commands, audits, events] = decoded as [Row[], Row[], Row[]];
    return {
      commands,
      audits,
      events,
      orders,
      hash: digest(
        canonical({
          purpose: "distributor-platform-original-lease-command-scope-v1",
          commands,
          audits,
          events,
          orders,
        }),
      ),
    };
  }
  getInTransaction(actorInput: Actor, journalId: string) {
    const loc = principal(actorInput);
    id(journalId);
    valid(!this.#active);
    this.#active = true;
    try {
      return this.review(loc, journalId);
    } finally {
      this.#active = false;
    }
  }
  private review(actorInput: Actor, journalId: string) {
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
    const platform = own(this.journals, "platform") as Platform;
    const hold = platform.rawRecoveryHoldInTransaction();
    valid(hold);
    const scope = this.scan(actor.orgId);
    const commands = scope.commands;
    const audits = scope.audits
      .map((a) => {
        const order = scope.orders.find((o) => o.audit_id === a.id);
        valid(order);
        return {
          ...a,
          sequence: order.sequence!,
          order_org_id: order.org_id!,
        } as Row;
      })
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));
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
    const native = this.journals.readOfflineLeaseRetirementInTransaction(
      actor,
      journalId,
    );
    valid(native.orgId === actor.orgId);
    const nativeSourceId = native.packet.id;
    id(nativeSourceId);
    const observations = {
      audits: audits
        .filter((a) => a.action === "accounting.journal.observed")
        .map((a) => {
          const d = json(String(a.detail), "audit");
          valid(
            canonical(Object.keys(d).sort()) ===
              canonical(["hash", "revision"]),
          );
          hash(d.hash);
          valid(Number.isSafeInteger(d.revision) && Number(d.revision) > 0);
          return {
            journalId: String(a.reference),
            revision: d.revision as number,
            hash: d.hash as string,
            actorId: String(a.actor_id),
            createdAt: String(a.created_at),
            sequence: Number(a.sequence),
            id: String(a.id),
          };
        }),
    };
    const selectedIds = new Set(native.attempts.map((a) => a.row.id));
    const nativeIdentities = [
      nativeSourceId,
      ...selectedIds,
      ...native.attempts.flatMap((a) =>
        a.row.lease_id ? [a.row.lease_id] : [],
      ),
    ];
    // Numeric existence only for foreign records. Escaped unknown tenancy must
    // not defeat literal matching; never decode another organization's text.
    for (const spec of specs) {
      valid(
        s.get(
          `SELECT COUNT(*) AS n FROM ${spec.table} WHERE org_id<>? AND instr(${spec.document},char(92)||'u')>0`,
          actor.orgId,
        )!.n === 0,
      );
      for (const value of nativeIdentities)
        valid(
          s.get(
            `SELECT COUNT(*) AS n FROM ${spec.table} WHERE org_id<>? AND (${spec.fields
              .split(" ")
              .map((c) => `instr(${c},?)>0`)
              .join(" OR ")})`,
            actor.orgId,
            ...spec.fields.split(" ").map(() => value),
          )!.n === 0,
        );
    }
    const claims = audits
      .filter((a) => a.action === "accounting.journal.claimed")
      .map((a) => ({ audit: a, body: json(String(a.detail), "audit") }));
    for (const a of native.attempts)
      for (const claim of claims.filter(
        (c) => c.audit.reference === a.row.id,
      )) {
        id(claim.body.leaseId);
        valid(
          claims.filter((c) => c.body.leaseId === claim.body.leaseId).length ===
            1,
        );
      }
    const selected = receipts.filter((c) => {
      if (c.row.name === names[5] || c.row.name === names[6]) {
        const input =
          c.row.name === names[5]
            ? c.result.input
            : (c.result.body as Data)?.input;
        valid(input && typeof input === "object" && !Array.isArray(input));
        id((input as Data).journalId);
        return selectedIds.has((input as Data).journalId as string);
      }
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
          "SELECT COUNT(*) AS n FROM platform_commands c WHERE c.org_id=? AND c.name LIKE 'accounting.journal.%' AND c.name NOT IN(?,?,?,?,?,?,?) AND (instr(c.result,?)>0 OR instr(c.result,?)>0)",
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
      const permissions = a.permission.reviews.flatMap((review) => {
        const prep = selected.filter(
          (c) => c.row.name === names[5] && c.result.id === review.id,
        );
        valid(prep.length === 1);
        const rc = prep[0]!;
        const oa = observationAudits.find(
          (o) => o.hash === review.observation.hash,
        );
        valid(
          oa &&
            rc.row.actor_id === review.observation.recordedBy &&
            Number(rc.audit.sequence) > oa.sequence,
        );
        const result = [
          matched(
            rc,
            { ...review, decision: null },
            review.input as unknown as Data,
          ),
        ];
        if (review.decision) {
          const decisions = selected.filter(
            (c) =>
              c.row.name === names[6] &&
              c.result.hash === review.decision!.hash,
          );
          valid(decisions.length === 1);
          const dc = decisions[0]!,
            da = observationAudits.find(
              (o) => o.hash === review.decision!.hash,
            );
          valid(
            da &&
              dc.row.actor_id === review.decision.recordedBy &&
              Number(dc.audit.sequence) > da.sequence &&
              da.sequence > Number(rc.audit.sequence),
          );
          result.push(
            matched(
              dc,
              review.decision,
              (review.decision.body as Data).input as Data,
            ),
          );
        }
        return result;
      });
      const leaseAudits = audits.filter(
        (x) =>
          x.reference === r.id &&
          [
            "accounting.journal.claimed",
            "accounting.journal.dispatched",
            "accounting.journal.observed",
          ].includes(String(x.action)),
      );
      let active: {
        leaseId: string;
        mode: string;
        actorId: string;
        sequence: number;
        createdAt: string;
      } | null = null;
      let dispatched = false;
      let last = decision?.audit.sequence ?? prepare.audit.sequence;
      const leaseIds = new Set<string>();
      for (const audit of leaseAudits) {
        valid(Number(audit.sequence) > last);
        last = Number(audit.sequence);
        const d = json(String(audit.detail), "audit");
        if (audit.action === "accounting.journal.claimed") {
          valid(
            !active &&
              canonical(Object.keys(d).sort()) ===
                canonical(["leaseId", "mode", "reviewHash"]),
          );
          id(d.leaseId);
          valid(
            !leaseIds.has(d.leaseId) &&
              d.reviewHash === r.review_hash &&
              (d.mode === "write" || d.mode === "lookup"),
          );
          valid(d.mode === (leaseIds.size ? "lookup" : "write"));
          leaseIds.add(d.leaseId);
          active = {
            leaseId: d.leaseId,
            mode: d.mode,
            actorId: String(audit.actor_id),
            sequence: Number(audit.sequence),
            createdAt: String(audit.created_at),
          };
        } else if (audit.action === "accounting.journal.dispatched") {
          valid(
            active &&
              active.mode === "write" &&
              !dispatched &&
              active.actorId === audit.actor_id &&
              canonical(d) ===
                canonical({
                  leaseId: active.leaseId,
                  requestRef: view.requestRef,
                }),
          );
          dispatched = true;
        } else {
          const o = a.observations.find((x) => x.revision === d.revision);
          valid(o && o.hash === d.hash);
          if (o.body.outcome === "unknown") {
            valid(active && o.body.leaseId === active.leaseId);
            if (
              ![
                "expired-lease",
                "clock-rollback",
                "restore-interrupted",
              ].includes(String(o.body.cause))
            )
              valid(o.recordedBy === active.actorId);
            active = null;
          } else valid(!active); // Permissions and cancellation are retained only between leases.
        }
      }
      // Native command completion precedes the next claim/observation. Merely
      // matching an observation hash cannot move a receipt across that boundary.
      for (const permission of permissions) {
        const observedHash =
          permission.command === names[5]
            ? (permission.result.observation as Data).hash
            : permission.result.hash;
        const oa = observationAudits.find((o) => o.hash === observedHash);
        valid(oa);
        const next = leaseAudits.find((x) => Number(x.sequence) > oa.sequence);
        valid(!next || permission.audit.sequence < Number(next.sequence));
      }
      valid(dispatched === !!r.dispatched);
      if (r.state === "running") {
        valid(
          active &&
            active.leaseId === r.lease_id &&
            active.mode === r.lease_mode &&
            active.actorId === r.lease_actor &&
            Date.parse(active.createdAt) >= Number(r.lease_started),
        );
      } else valid(!active);
      return {
        journalId: r.id,
        permissions,
        leaseAudits: leaseAudits.map((x) => ({
          id: String(x.id),
          actorId: String(x.actor_id),
          action: String(x.action),
          reference: String(x.reference),
          createdAt: String(x.created_at),
          sequence: Number(x.sequence),
          detail: json(String(x.detail), "audit"),
        })),
        currentLease:
          r.state === "running"
            ? {
                id: r.lease_id,
                actorId: r.lease_actor,
                started: r.lease_started,
                mode: r.lease_mode,
                dispatched: r.dispatched,
                requestRef: view.requestRef,
                claim: active,
              }
            : null,
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
    const touches = (value: unknown) =>
      nativeIdentities.some((id) => canonical(value).includes(id));
    const unjoinedAudits = audits.filter(
      (a) =>
        (String(a.action).startsWith("accounting.journal.") ||
          touches(json(String(a.detail), "audit")) ||
          selectedIds.has(String(a.reference))) &&
        !names.includes(a.action as Name) &&
        !(
          selectedIds.has(String(a.reference)) &&
          [
            "accounting.journal.claimed",
            "accounting.journal.dispatched",
            "accounting.journal.observed",
          ].includes(String(a.action))
        ),
    );
    const unjoinedCommands = commands.filter(
      (c) =>
        !names.includes(c.name as Name) &&
        (String(c.name).startsWith("accounting.journal.") ||
          touches(json(String(c.result), "command"))),
    );
    // Events have no ordinary journal writer in this baseline. Do not fabricate an event preimage.
    const unjoinedEvents = scope.events.filter(
      (e) =>
        String(e.type).startsWith("accounting.journal.") ||
        touches(json(String(e.payload), "audit")),
    );
    this.owners();
    const refreshed = this.identity.currentActor(actorInput);
    permit(refreshed, ["finance"]);
    valid(
      !refreshed.accountId &&
        !this.identity.security(refreshed).passwordChangeRequired &&
        canonical(refreshed) === canonical(actor),
    );
    valid(
      canonical(platform.rawRecoveryHoldInTransaction()) === canonical(hold),
    );
    valid(
      this.journals.readOfflineLeaseRetirementInTransaction(
        refreshed,
        journalId,
      ).hash === native.hash,
    );
    valid(this.scan(actor.orgId).hash === scope.hash);
    valid(s.get("SELECT total_changes() AS n")!.n === unchanged);
    const body = {
      version: 1 as const,
      purpose:
        "distributor-platform-offline-original-lease-command-review-v1" as const,
      profile: originalLeaseCommandReviewLimits,
      orgId: native.orgId,
      region: native.region,
      currency: native.currency,
      journalId,
      nativeReviewHash: native.hash,
      hold,
      scopeHash: scope.hash,
      history: {
        commands: commands.length,
        audits: audits.length,
        selectedCommands: selected.length,
        otherSourceCommands: receipts.length - selected.length,
        hash: digest(
          canonical({
            purpose: "distributor-platform-original-lease-command-history-v1",
            commands,
            audits,
          }),
        ),
        observationHash: digest(canonical(observations.audits)),
      },
      attempts: attemptFacts,
      blockers: [
        ...(unjoinedCommands.length
          ? ["COMMAND_PREIMAGE_NOT_OWNER_JOINED"]
          : []),
        ...(unjoinedAudits.length
          ? ["OTHER_JOURNAL_AUDITS_NOT_OWNER_JOINED"]
          : []),
        ...(unjoinedEvents.length
          ? ["JOURNAL_EVENT_PREIMAGE_NOT_RETAINED"]
          : []),
        "CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT",
        "SOURCE_PROVIDER_AND_CURRENT_COMMIT_AUTHORITY_NOT_QUALIFIED",
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
    const encoded = canonical(body);
    bounded(
      Buffer.byteLength(encoded) <=
        originalLeaseCommandReviewLimits.outputBytes,
    );
    return freeze(structuredClone({ ...body, factsHash: digest(encoded) }));
  }
}
export type PlatformOfflineOriginalLeaseCommandReview = ReturnType<
  PlatformOfflineOriginalLeaseCommandReviewReader["getInTransaction"]
>;
