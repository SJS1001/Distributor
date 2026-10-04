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
import { Platform } from "./platform.ts";
import { Fulfillment } from "./fulfillment.ts";
import { CarrierBookings } from "./carrier-bookings.ts";
import { CarrierOfflineMemberReview } from "./carrier-offline-member-review.ts";
import { PlatformOfflineCarrierReviewReader } from "./platform-offline-carrier-review.ts";

export const canadaPostCommandReviewLimits = Object.freeze({
  commands: 1000,
  audits: 4000,
  events: 2000,
  rowBytes: 65536,
  totalBytes: 8 * 1024 * 1024,
  jsonNodes: 8192,
  jsonContainers: 512,
  jsonDepth: 32,
  outputBytes: 16 * 1024 * 1024,
});
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function freeze<T>(v: T): Frozen<T> {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}
function valid(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CANADA_POST_COMMAND",
    "Native Canada Post command preimages are incomplete, unsupported or inconsistent.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CANADA_POST_COMMAND_LIMIT",
    "Native command history exceeds the fixed complete profile.",
  );
}
function id(v: unknown): asserts v is string {
  valid(
    !types.isProxy(v) &&
      typeof v === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(v),
  );
}
function own(v: object, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(v, k);
  valid(d && "value" in d);
  return d.value;
}
function owner(v: unknown, p: object): asserts v is object {
  valid(
    !types.isProxy(v) &&
      v !== null &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === p,
  );
}
function locator(v: Actor): Actor {
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
function json(raw: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    valid(false);
  }
  const stack: [unknown, number][] = [[v, 0]];
  let nodes = 0;
  while (stack.length) {
    const [x, d] = stack.pop()!;
    bounded(
      ++nodes <= canadaPostCommandReviewLimits.jsonNodes &&
        d <= canadaPostCommandReviewLimits.jsonDepth,
    );
    if (typeof x === "string")
      valid(!x.includes("\0") && Buffer.from(x).toString() === x);
    if (typeof x === "number") valid(Number.isFinite(x));
    if (x && typeof x === "object")
      for (const c of Object.values(x)) stack.push([c, d + 1]);
  }
  valid(v !== null && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
}
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

/** Fixed internal consistency reader. No provider, import or source authority. */
export class PlatformOfflineCanadaPostCommandReviewReader {
  readonly #store: Store;
  #active = false;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
    private readonly fulfillment: Fulfillment,
    private readonly carrier: CarrierBookings,
  ) {
    this.owners();
    this.#store = database.owned("platform");
  }
  private owners() {
    for (const [v, p] of [
      [this.database, Database.prototype],
      [this.identity, Identity.prototype],
      [this.platform, Platform.prototype],
      [this.fulfillment, Fulfillment.prototype],
      [this.carrier, CarrierBookings.prototype],
    ] as const) {
      owner(v, p);
      for (const name of Object.getOwnPropertyNames(p))
        if (name !== "constructor") valid(!Object.hasOwn(v, name));
    }
    for (const v of [
      this.identity,
      this.platform,
      this.fulfillment,
      this.carrier,
    ])
      valid(own(v, "database") === this.database);
    for (const v of [this.identity, this.fulfillment, this.carrier])
      valid(own(v, "platform") === this.platform);
    valid(
      own(this.fulfillment, "identity") === this.identity &&
        own(this.carrier, "identity") === this.identity &&
        own(this.carrier, "fulfillment") === this.fulfillment,
    );
    for (const [v, module] of [
      [this.identity, "iam"],
      [this.platform, "platform"],
      [this.fulfillment, "fulfillment"],
      [this.carrier, "integration"],
    ] as const) {
      const s = own(v, "store");
      owner(s, Store.prototype);
      valid(own(s, "database") === this.database && own(s, "owner") === module);
      for (const method of Object.getOwnPropertyNames(Store.prototype))
        if (method !== "constructor") valid(!Object.hasOwn(s, method));
    }
  }
  private actor(v: Actor) {
    const a = this.identity.currentActor(v);
    permit(a, ["finance"]);
    check(
      !a.accountId,
      "FORBIDDEN",
      "Current organization finance staff is required.",
      403,
    );
    check(
      !this.identity.security(a).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing command provenance.",
      403,
    );
    return a;
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
          Number(r.largest) <= canadaPostCommandReviewLimits.rowBytes &&
          (total += Number(r.bytes)) <=
            canadaPostCommandReviewLimits.totalBytes,
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
        Number(order.largest) <= canadaPostCommandReviewLimits.rowBytes &&
        Number.isSafeInteger(order.bytes) &&
        (total += Number(order.bytes)) <=
          canadaPostCommandReviewLimits.totalBytes,
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
        Number(r.nodes) <= canadaPostCommandReviewLimits.jsonNodes &&
          Number(r.containers) <= canadaPostCommandReviewLimits.jsonContainers,
      );
      valid(
        this.#store.get(
          `SELECT COUNT(*) AS n FROM ${spec.table} WHERE NOT json_valid(${c})`,
        )!.n === 0,
      );
      // Unclassified foreign carrier history is not assigned guessed tenancy.
      valid(
        this.#store.get(
          `SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${spec.name} LIKE 'carrier.%' AND org_id<>?`,
          org,
        )!.n === 0,
      );
    }
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
        json(String(data[spec.document]));
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
      hash: digest(
        canonical({
          purpose: "distributor-platform-canada-post-command-scope-v1",
          commands,
          audits,
          events,
          orders,
        }),
      ),
    };
  }
  getInTransaction(actorInput: Actor, groupId: string, bookingId: string) {
    const loc = locator(actorInput);
    id(groupId);
    id(bookingId);
    valid(groupId !== bookingId);
    valid(!this.#active);
    this.#active = true;
    try {
      this.owners();
      this.database.requireTransaction();
      const actor = this.actor(loc);
      const changes = this.#store.get("SELECT total_changes() AS n")!.n;
      const hold = this.platform.rawRecoveryHoldInTransaction();
      check(
        hold,
        "RECOVERY_HOLD_REQUIRED",
        "Actual raw restored hold required.",
      );
      const scope = this.scan(actor.orgId);
      const nativeOwner = new CarrierOfflineMemberReview(
        this.database,
        this.identity,
        this.platform,
      );
      const native = nativeOwner.reviewUnknownMemberInTransaction(
        actor,
        groupId,
        bookingId,
      );
      const platformReview = new PlatformOfflineCarrierReviewReader(
        this.database,
        this.identity,
      ).getInTransaction(actor, groupId, bookingId);
      const blockers = new Set<string>([
        "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
      ]);
      const commands: {
        actorId: string;
        command: string;
        key: string;
        requestHash: string;
        result: Record<string, unknown>;
        createdAt: string;
        payload: Record<string, unknown>;
      }[] = [];
      const used = new Set<Row>();
      const reconstruct = (
        name: string,
        target: string,
        reviewHash: unknown,
        payload: Record<string, unknown>,
      ) => {
        const matches = scope.commands.filter(
          (c) => c.name === name && json(String(c.result)).id === target,
        );
        valid(matches.length === 1);
        const c = matches[0]!,
          result = json(String(c.result));
        valid(result.reviewHash === reviewHash && !used.has(c));
        // Platform.command hashes canonical(payload), preserving array order.
        // No permutations, trimmed variants or missing fields are guessed.
        valid(digest(canonical(payload)) === c.hash);
        used.add(c);
        commands.push({
          actorId: String(c.actor_id),
          command: name,
          key: String(c.key),
          requestHash: String(c.hash),
          result,
          createdAt: String(c.created_at),
          payload,
        });
      };
      const custody: { bookingId: string; custodyHash: string }[] = [];
      for (const p of native.preparations) {
        const i = p.intent;
        const {
          bookingId: bid,
          reviewHash,
          nativeSnapshot,
          configuration: _configuration,
          ...payload
        } = i;
        valid(
          bid === p.bookingId &&
            i.provider === "canada-post" &&
            !Object.hasOwn(i, "replacementId"),
        );
        reconstruct("carrier.prepare", bid, reviewHash, payload);
        const c = this.fulfillment.reviewPackedCarrierCustodyInTransaction(
          actor,
          i.shipmentId,
        );
        valid(
          canonical(c.shipment) === canonical(nativeSnapshot) &&
            this.carrier.warehouseForBooking(actor, bid) ===
              c.shipment.warehouse_id,
        );
        custody.push({ bookingId: bid, custodyHash: c.custodyHash });
        const event = scope.events.filter(
          (e) => e.type === "carrier.booking.prepared" && e.reference === bid,
        );
        valid(event.length === 1);
        valid(
          canonical(json(String(event[0]!.payload))) ===
            canonical({
              shipmentId: i.shipmentId,
              reviewHash,
              provider: "canada-post",
            }),
        );
      }
      for (const g of native.groups) {
        const members = native.members.filter((m) => m.group_id === g.id);
        const entries = members.map((m) => ({
          bookingId: m.booking_id,
          reviewHash: m.review_hash,
        }));
        reconstruct(
          "carrier.canada-post.group.prepare",
          String(g.id),
          g.review_hash,
          { configurationHash: g.configuration_hash, entries },
        );
        const event = scope.events.filter(
          (e) =>
            e.type === "carrier.canada-post.group.prepared" &&
            e.reference === g.id,
        );
        valid(event.length === 1);
        valid(
          canonical(json(String(event[0]!.payload))) ===
            canonical({
              reviewHash: g.review_hash,
              warehouseId: g.warehouse_id,
              count: entries.length,
            }),
        );
      }
      const ids = new Set([
        ...native.preparations.map((p) => p.bookingId),
        ...native.groups.map((g) => String(g.id)),
      ]);
      for (const c of scope.commands) {
        const result = json(String(c.result));
        if (String(c.name).startsWith("carrier.") && !used.has(c))
          blockers.add(
            [
              "carrier.cancel",
              "carrier.canada-post.group.cancel",
              "carrier.claim.release",
            ].includes(String(c.name))
              ? "CANCELLATION_OR_RELEASE_REQUEST_PREIMAGE_UNSUPPORTED"
              : "OTHER_CARRIER_COMMAND_NOT_NATIVE_JOINED",
          );
        if (
          !String(c.name).startsWith("carrier.") &&
          typeof result.id === "string" &&
          ids.has(result.id)
        )
          valid(false);
      }
      for (const a of scope.audits)
        if (
          ids.has(String(a.reference)) &&
          !String(a.action).startsWith("carrier.")
        )
          valid(false);
      for (const e of scope.events)
        if (
          ids.has(String(e.reference)) &&
          !String(e.type).startsWith("carrier.")
        )
          valid(false);
      // Join every relevant domain audit to the actual closure, not just its hash.
      for (const a of scope.audits.filter(
        (a) =>
          String(a.action).startsWith("carrier.") &&
          !scope.commands.some(
            (c) =>
              c.name === a.action &&
              c.key === a.reference &&
              c.actor_id === a.actor_id,
          ),
      )) {
        const d = json(String(a.detail));
        if (
          String(a.action).startsWith("carrier.canada-post.manifest.") ||
          ["carrier.booking.unknown", "carrier.booking.booked"].includes(
            String(a.action),
          )
        )
          blockers.add("NATIVE_UNJOINED_CARRIER_OUTCOME");
        if (
          String(a.action).startsWith("carrier.canada-post.member.") &&
          ids.has(String(a.reference))
        )
          valid(
            native.members.some(
              (m) =>
                m.group_id === a.reference &&
                m.booking_id === d.bookingId &&
                m.review_hash === d.reviewHash,
            ),
          );
        if (
          !ids.has(String(a.reference)) ||
          (d.bookingId !== undefined && !ids.has(String(d.bookingId)))
        )
          blockers.add("OTHER_CARRIER_COMMAND_NOT_NATIVE_JOINED");
      }
      for (const e of scope.events.filter((e) =>
        String(e.type).startsWith("carrier."),
      ))
        if (!ids.has(String(e.reference)))
          blockers.add("OTHER_CARRIER_COMMAND_NOT_NATIVE_JOINED");
      const auditOrder = new Map(
        this.#store
          .all(
            "SELECT audit_id,sequence FROM platform_audit_order WHERE org_id=? ORDER BY sequence",
            actor.orgId,
          )
          .map((r) => [String(r.audit_id), Number(r.sequence)]),
      );
      for (const m of native.members) {
        if (m.token !== null) blockers.add("RETAINED_MEMBER_CLAIM");
        const outcomes = scope.audits
          .filter(
            (a) =>
              a.reference === m.group_id &&
              String(a.action).startsWith("carrier.canada-post.member.") &&
              json(String(a.detail)).bookingId === m.booking_id,
          )
          .sort(
            (a, b) =>
              auditOrder.get(String(a.id))! - auditOrder.get(String(b.id))!,
          );
        for (const a of outcomes)
          valid(json(String(a.detail)).reviewHash === m.review_hash);
        const last = outcomes.at(-1);
        if (m.state === "created") {
          valid(
            last?.action === "carrier.canada-post.member.created" &&
              json(String(last.detail)).labelHash === m.label_hash,
          );
          const es = scope.events.filter(
            (e) =>
              e.type === "carrier.canada-post.member.created" &&
              e.reference === m.group_id &&
              json(String(e.payload)).bookingId === m.booking_id,
          );
          valid(
            es.length === 1 &&
              json(String(es[0]!.payload)).shipmentId ===
                m.provider_shipment_id,
          );
        } else if (m.state === "unknown") {
          if (
            !last ||
            ![
              "carrier.canada-post.member.unknown",
              "carrier.canada-post.member.unconfirmed",
            ].includes(String(last.action))
          )
            blockers.add("UNKNOWN_MEMBER_OUTCOME_NOT_NATIVE_JOINED");
        } else if (m.state === "pending") valid(outcomes.length === 0);
        else blockers.add("MEMBER_OUTCOME_PROFILE_UNSUPPORTED");
      }
      for (const g of native.groups)
        if (g.token !== null || g.started_at !== null)
          blockers.add("RETAINED_GROUP_CLAIM");
      for (const b of native.bookingHistory)
        if (b.token !== null || b.started_at !== null)
          blockers.add("RETAINED_BOOKING_CLAIM");
      this.owners();
      this.actor(loc);
      valid(
        canonical(this.platform.rawRecoveryHoldInTransaction()) ===
          canonical(hold),
      );
      valid(
        nativeOwner.reviewUnknownMemberInTransaction(actor, groupId, bookingId)
          .reviewHash === native.reviewHash,
      );
      for (const p of native.preparations)
        valid(
          this.fulfillment.reviewPackedCarrierCustodyInTransaction(
            actor,
            p.intent.shipmentId,
          ).custodyHash ===
            custody.find((c) => c.bookingId === p.bookingId)!.custodyHash,
        );
      valid(this.scan(actor.orgId).hash === scope.hash);
      this.actor(loc);
      this.owners();
      valid(this.#store.get("SELECT total_changes() AS n")!.n === changes);
      const body = {
        version: 1 as const,
        purpose:
          "distributor-platform-offline-canada-post-command-review-v1" as const,
        orgId: actor.orgId,
        groupId,
        bookingId,
        nativeReviewHash: native.reviewHash,
        nativeBlockers: native.blockers,
        hold,
        platformHistory: platformReview.history,
        platformReviewHash: platformReview.factsHash,
        scopeHash: scope.hash,
        commands,
        custody,
        blockers: [...blockers].sort(),
      };
      const encoded = canonical(body);
      bounded(
        Buffer.byteLength(encoded) <= canadaPostCommandReviewLimits.outputBytes,
      );
      return freeze(structuredClone({ ...body, factsHash: digest(encoded) }));
    } finally {
      this.#active = false;
    }
  }
}
export type PlatformOfflineCanadaPostCommandReview = ReturnType<
  PlatformOfflineCanadaPostCommandReviewReader["getInTransaction"]
>;
