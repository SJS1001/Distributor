import { carrierNames } from "../shared/carrier-booking.ts";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";

export const platformOfflineCarrierReviewLimits = Object.freeze({
  commands: 1000,
  audits: 4000,
  events: 2000,
  rowBytes: 65536,
  totalBytes: 8 * 1024 * 1024,
  jsonDepth: 16,
});
const commandNames = [
  "carrier.prepare",
  "carrier.cancel",
  "carrier.canada-post.group.prepare",
  "carrier.canada-post.group.cancel",
  "carrier.claim.release",
] as const;
const domainNames = [
  "carrier.booking.canceled",
  "carrier.booking.booked",
  "carrier.booking.unknown",
  "carrier.canada-post.group.canceled",
  "carrier.canada-post.member.claimed",
  "carrier.canada-post.member.created",
  "carrier.canada-post.member.unconfirmed",
  "carrier.canada-post.member.unknown",
  "carrier.canada-post.manifest.claimed",
  "carrier.canada-post.manifest.transmitted",
  "carrier.canada-post.manifest.unconfirmed",
  "carrier.canada-post.manifest.unknown",
  "carrier.claim.released",
];
const eventNames = [
  "carrier.booking.prepared",
  "carrier.booking.canceled",
  "carrier.booking.booked",
  "carrier.canada-post.group.prepared",
  "carrier.canada-post.group.canceled",
  "carrier.canada-post.member.created",
  "carrier.canada-post.manifest.transmitted",
];
type Data = Record<string, unknown>;
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function valid(value: unknown): asserts value {
  check(
    value,
    "CARRIER_PROVENANCE_INTEGRITY",
    "Retained carrier provenance is malformed, incomplete or ambiguous.",
  );
}
function exact(v: unknown, max = 160): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    v.trim() === v &&
    !/[\u0000-\u001f\u007f]/u.test(v)
  );
}
function hash(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
function integer(
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): v is number {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function instant(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v
  );
}
function fields(v: unknown, keys: string[]): asserts v is Data {
  valid(
    v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k)),
  );
}
function json(
  raw: unknown,
  style: "canonical" | "command" = "canonical",
): Data {
  valid(typeof raw === "string");
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    valid(false);
  }
  // Bound traversal before recursive canonicalization; only parsed data is visited.
  const stack: [unknown, number][] = [[v, 0]];
  let count = 0;
  while (stack.length) {
    const [x, depth] = stack.pop()!;
    valid(
      depth <= platformOfflineCarrierReviewLimits.jsonDepth && ++count <= 4096,
    );
    if (x !== null && typeof x === "object")
      for (const child of Object.values(x)) stack.push([child, depth + 1]);
  }
  valid(v !== null && typeof v === "object" && !Array.isArray(v));
  valid((style === "canonical" ? canonical(v) : JSON.stringify(v)) === raw);
  return v as Data;
}
function freeze<T>(v: T): Frozen<T> {
  if (v !== null && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}
function target(v: unknown): Data {
  valid(v !== null && typeof v === "object");
  const t = v as Data;
  fields(
    t,
    t.kind === "booking"
      ? ["kind", "bookingId"]
      : t.kind === "manifest"
        ? ["kind", "groupId"]
        : ["kind", "groupId", "bookingId"],
  );
  valid(["booking", "manifest", "member"].includes(String(t.kind)));
  for (const k of ["bookingId", "groupId"]) if (k in t) valid(exact(t[k], 128));
  return t;
}
type Audit = {
  id: string;
  actorId: string;
  action: string;
  reference: string;
  detail: Data;
  detailJson: string;
  createdAt: string;
  sequence: number;
};
type Receipt = {
  actorId: string;
  command: string;
  key: string;
  requestHash: string;
  result: Data;
  resultJson: string;
  createdAt: string;
  audit: Audit;
};
type Event = {
  id: string;
  type: string;
  reference: string;
  version: number;
  payload: Data;
  payloadJson: string;
  createdAt: string;
};
export type PlatformOfflineCarrierReview = Frozen<{
  version: 1;
  purpose: "distributor-platform-offline-carrier-review-v1";
  orgId: string;
  groupId: string;
  bookingId: string;
  history: { commands: number; audits: number; events: number; hash: string };
  commands: Receipt[];
  audits: Audit[];
  events: Event[];
  blockers: string[];
  factsHash: string;
}>;

/** Fixed historical Platform projection. No membership/site/source/provider or release authority. */
export class PlatformOfflineCarrierReviewReader {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
  ) {
    this.store = database.owned("platform");
  }
  getInTransaction(
    actor: Actor,
    groupId: string,
    bookingId: string,
  ): PlatformOfflineCarrierReview {
    this.database.requireTransaction();
    actor = this.identity.currentActor(actor);
    permit(actor, ["warehouse"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Organization warehouse staff is required.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing carrier provenance.",
      403,
    );
    check(
      this.identity.region === "CA",
      "CARRIER_PROVENANCE_REGION",
      "Canada Post group provenance requires the Canadian organization.",
      403,
    );
    check(
      exact(groupId, 128) && exact(bookingId, 128) && groupId !== bookingId,
      "VALIDATION",
      "Supply exact distinct group and booking identities.",
      400,
    );
    // Platform does not retain booking warehouse or group membership. A supplied
    // group ID or event's warehouse cannot authorize an unrelated booking read.
    check(
      actor.role === "admin",
      "CARRIER_PROVENANCE_SCOPE",
      "Platform alone cannot establish booking site scope for a site-restricted reader.",
      403,
    );
    const org = actor.orgId;
    const specs = [
      {
        from: "platform_commands c",
        where: "c.org_id=? AND c.name LIKE 'carrier.%'",
        strings: [
          "c.org_id",
          "c.actor_id",
          "c.name",
          "c.key",
          "c.hash",
          "c.result",
          "c.created_at",
        ],
        numbers: [],
        limit: platformOfflineCarrierReviewLimits.commands,
      },
      {
        from: "platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id",
        where: "a.org_id=? AND a.action LIKE 'carrier.%'",
        strings: [
          "a.id",
          "a.org_id",
          "a.actor_id",
          "a.action",
          "a.reference",
          "a.detail",
          "a.created_at",
          "o.org_id",
        ],
        numbers: ["o.sequence"],
        limit: platformOfflineCarrierReviewLimits.audits,
      },
      {
        from: "platform_events e",
        where: "e.org_id=? AND e.type LIKE 'carrier.%'",
        strings: [
          "e.id",
          "e.org_id",
          "e.type",
          "e.reference",
          "e.payload",
          "e.created_at",
        ],
        numbers: ["e.version"],
        limit: platformOfflineCarrierReviewLimits.events,
      },
    ];
    let total = 0;
    const counts: number[] = [];
    for (const s of specs) {
      const bytes = s.strings
        .map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`)
        .join("+");
      const bad = [
        ...s.strings.map((c) => `typeof(${c})!='text'`),
        ...s.numbers.map(
          (c) => `typeof(${c})!='integer' OR ${c}<1 OR ${c}>9007199254740991`,
        ),
      ].join(" OR ");
      const r = this.store.get(
        `SELECT COUNT(*) AS n,COALESCE(MAX(CASE WHEN ${bad} THEN 1 ELSE 0 END),0) AS bad,COALESCE(MAX(${bytes}),0) AS largest,COALESCE(SUM(${bytes}),0) AS bytes FROM ${s.from} WHERE ${s.where}`,
        org,
      )!;
      valid(
        integer(r.n, 0, s.limit) &&
          r.bad === 0 &&
          integer(r.largest, 0, platformOfflineCarrierReviewLimits.rowBytes) &&
          integer(r.bytes),
      );
      total += r.bytes;
      valid(total <= platformOfflineCarrierReviewLimits.totalBytes);
      counts.push(r.n);
    }
    // Dangling order rows cannot be attributed to a specific action after loss.
    valid(
      this.store.get(
        "SELECT COUNT(*) AS n FROM platform_audit_order o LEFT JOIN platform_audit a ON a.id=o.audit_id WHERE o.org_id=? AND a.id IS NULL",
        org,
      )!.n === 0,
    );
    const commands = this.store.all(
      "SELECT org_id,actor_id,name,key,hash,result,created_at FROM platform_commands WHERE org_id=? AND name LIKE 'carrier.%' ORDER BY actor_id,name,key",
      org,
    );
    const auditRows = this.store.all(
      "SELECT a.id,a.org_id,a.actor_id,a.action,a.reference,a.detail,a.created_at,o.org_id AS order_org_id,o.sequence FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id WHERE a.org_id=? AND a.action LIKE 'carrier.%' ORDER BY o.sequence",
      org,
    );
    const eventRows = this.store.all(
      "SELECT id,org_id,type,version,reference,payload,created_at FROM platform_events WHERE org_id=? AND type LIKE 'carrier.%' ORDER BY type,reference,id",
      org,
    );
    valid(
      commands.length === counts[0] &&
        auditRows.length === counts[1] &&
        eventRows.length === counts[2],
    );
    const audits: Audit[] = auditRows.map((a) => {
      valid(
        a.org_id === org &&
          a.order_org_id === org &&
          exact(a.id) &&
          exact(a.actor_id) &&
          exact(a.action) &&
          exact(a.reference, 128) &&
          instant(a.created_at) &&
          integer(a.sequence, 1),
      );
      return {
        id: a.id,
        actorId: a.actor_id,
        action: a.action,
        reference: a.reference,
        detail: json(a.detail),
        detailJson: a.detail as string,
        createdAt: a.created_at,
        sequence: a.sequence,
      };
    });
    valid(new Set(audits.map((a) => a.sequence)).size === audits.length);
    const commandAudits = new Map<string, Audit>();
    const key = (a: string, n: string, k: string) => canonical([a, n, k]);
    for (const a of audits) {
      if ((commandNames as readonly string[]).includes(a.action)) {
        fields(a.detail, ["requestHash"]);
        valid(hash(a.detail.requestHash));
        const k = key(a.actorId, a.action, a.reference);
        valid(!commandAudits.has(k));
        commandAudits.set(k, a);
      } else valid(domainNames.includes(a.action));
    }
    const receipts: Receipt[] = commands.map((c) => {
      valid(
        c.org_id === org &&
          exact(c.actor_id) &&
          exact(c.name) &&
          exact(c.key, 128) &&
          hash(c.hash) &&
          instant(c.created_at) &&
          (commandNames as readonly string[]).includes(c.name),
      );
      const result = json(c.result, "command");
      if (c.name.endsWith("prepare")) {
        fields(result, ["id", "reviewHash"]);
        valid(exact(result.id, 128) && hash(result.reviewHash));
      } else if (c.name.endsWith("cancel")) {
        fields(result, ["id"]);
        valid(exact(result.id, 128));
      } else {
        fields(result, ["target", "state", "claimHash"]);
        target(result.target);
        valid(result.state === "unknown" && hash(result.claimHash));
      }
      const k = key(c.actor_id, c.name, c.key),
        a = commandAudits.get(k);
      valid(a && a.detail.requestHash === c.hash);
      commandAudits.delete(k);
      return {
        actorId: c.actor_id,
        command: c.name,
        key: c.key,
        requestHash: c.hash,
        result,
        resultJson: c.result as string,
        createdAt: c.created_at,
        audit: a,
      };
    });
    valid(commandAudits.size === 0);
    const events: Event[] = eventRows.map((e) => {
      valid(
        e.org_id === org &&
          exact(e.id) &&
          exact(e.type) &&
          eventNames.includes(e.type) &&
          exact(e.reference, 128) &&
          e.version === 1 &&
          instant(e.created_at),
      );
      return {
        id: e.id,
        type: e.type,
        reference: e.reference,
        version: 1,
        payload: json(e.payload),
        payloadJson: e.payload as string,
        createdAt: e.created_at,
      };
    });
    const usedEvents = new Set<Event>(),
      usedDomain = new Set<Audit>();
    const oneEvent = (type: string, reference: string, payload?: Data) => {
      const found = events.filter(
        (e) =>
          e.type === type &&
          e.reference === reference &&
          (payload === undefined ||
            canonical(e.payload) === canonical(payload)),
      );
      valid(found.length === 1 && !usedEvents.has(found[0]!));
      usedEvents.add(found[0]!);
      return found[0]!;
    };
    const preparations = new Map<string, Receipt>();
    for (const r of receipts.filter((r) => r.command.endsWith("prepare"))) {
      const id = r.result.id as string;
      valid(!preparations.has(id));
      preparations.set(id, r);
      const group = r.command === "carrier.canada-post.group.prepare";
      const e = oneEvent(
        group
          ? "carrier.canada-post.group.prepared"
          : "carrier.booking.prepared",
        id,
      );
      if (group) {
        fields(e.payload, ["reviewHash", "warehouseId", "count"]);
        valid(
          exact(e.payload.warehouseId, 128) && integer(e.payload.count, 1, 100),
        );
      } else {
        const replacement = "replacementId" in e.payload;
        fields(e.payload, [
          "shipmentId",
          "reviewHash",
          "provider",
          ...(replacement ? ["replacementId"] : []),
        ]);
        valid(
          exact(e.payload.shipmentId, 128) &&
            (carrierNames as readonly string[]).includes(
              String(e.payload.provider),
            ) &&
            (!replacement || e.payload.replacementId === e.payload.shipmentId),
        );
      }
      valid(e.payload.reviewHash === r.result.reviewHash);
    }
    const prepared = (id: unknown, group: boolean, before?: number) => {
      valid(exact(id, 128));
      const r = preparations.get(id);
      valid(
        r &&
          r.command ===
            (group ? "carrier.canada-post.group.prepare" : "carrier.prepare") &&
          (before === undefined || r.audit.sequence < before),
      );
      return r;
    };
    for (const r of receipts.filter((r) => r.command.endsWith("cancel"))) {
      const group = r.command !== "carrier.cancel",
        id = r.result.id as string,
        prep = prepared(id, group, r.audit.sequence);
      const matches = audits.filter(
        (a) =>
          a.action ===
            (group
              ? "carrier.canada-post.group.canceled"
              : "carrier.booking.canceled") && a.reference === id,
      );
      valid(matches.length === 1);
      const a = matches[0]!;
      fields(a.detail, ["reviewHash", "reason"]);
      valid(
        a.actorId === r.actorId &&
          a.detail.reviewHash === prep.result.reviewHash &&
          exact(a.detail.reason, 1000) &&
          prep.audit.sequence < a.sequence &&
          a.sequence < r.audit.sequence &&
          !usedDomain.has(a),
      );
      usedDomain.add(a);
      const expected = group
        ? { reviewHash: prep.result.reviewHash }
        : events.find(
            (e) => e.type === "carrier.booking.prepared" && e.reference === id,
          )!.payload;
      oneEvent(
        group
          ? "carrier.canada-post.group.canceled"
          : "carrier.booking.canceled",
        id,
        group
          ? expected
          : {
              shipmentId: expected.shipmentId,
              ...("replacementId" in expected
                ? { replacementId: expected.replacementId }
                : {}),
            },
      );
    }
    for (const r of receipts.filter(
      (r) => r.command === "carrier.claim.release",
    )) {
      const t = target(r.result.target),
        reference = String(t.kind === "booking" ? t.bookingId : t.groupId);
      if (t.bookingId) prepared(t.bookingId, false, r.audit.sequence);
      if (t.groupId) prepared(t.groupId, true, r.audit.sequence);
      const found = audits.filter(
        (a) =>
          a.action === "carrier.claim.released" &&
          a.reference === reference &&
          a.actorId === r.actorId &&
          a.detail.claimHash === r.result.claimHash &&
          canonical(a.detail.target) === canonical(t),
      );
      valid(found.length === 1);
      const a = found[0]!;
      fields(a.detail, [
        "target",
        "minimumAgeMs",
        "startedAt",
        "claimHash",
        "reason",
      ]);
      valid(
        integer(a.detail.minimumAgeMs, 1, 86400000) &&
          integer(a.detail.startedAt) &&
          exact(a.detail.reason, 160) &&
          a.sequence < r.audit.sequence &&
          !usedDomain.has(a),
      );
      usedDomain.add(a);
    }
    for (const a of audits.filter(
      (a) => domainNames.includes(a.action) && !usedDomain.has(a),
    )) {
      const d = a.detail,
        n = a.action;
      if (n.startsWith("carrier.canada-post.member.")) {
        const suffix = n.split(".").at(-1)!;
        fields(d, [
          "bookingId",
          "reviewHash",
          ...(suffix === "claimed"
            ? ["send"]
            : suffix === "unknown"
              ? []
              : [
                  "reconciled",
                  "groupState",
                  ...(suffix === "created" ? ["labelHash"] : []),
                ]),
        ]);
        prepared(a.reference, true, a.sequence);
        const b = prepared(d.bookingId, false, a.sequence);
        valid(
          d.reviewHash === b.result.reviewHash &&
            events.some(
              (e) =>
                e.type === "carrier.booking.prepared" &&
                e.reference === d.bookingId &&
                e.payload.provider === "canada-post",
            ),
        );
        if (suffix === "claimed") valid(typeof d.send === "boolean");
        else {
          const claim = audits.findLast(
            (c) =>
              c.action === "carrier.canada-post.member.claimed" &&
              c.reference === a.reference &&
              c.detail.bookingId === d.bookingId &&
              c.sequence < a.sequence,
          );
          valid(
            claim &&
              claim.actorId === a.actorId &&
              claim.detail.reviewHash === d.reviewHash,
          );
          if (suffix !== "unknown")
            valid(
              typeof d.reconciled === "boolean" &&
                d.reconciled === !claim.detail.send &&
                ["closed", "unknown", "creating"].includes(
                  String(d.groupState),
                ),
            );
          if (suffix === "created") {
            valid(hash(d.labelHash));
            const e = events.filter(
              (e) =>
                e.type === n &&
                e.reference === a.reference &&
                e.payload.bookingId === d.bookingId,
            );
            valid(e.length === 1);
            fields(e[0]!.payload, ["bookingId", "reviewHash", "shipmentId"]);
            valid(
              e[0]!.payload.reviewHash === d.reviewHash &&
                exact(e[0]!.payload.shipmentId, 32) &&
                /^[A-Za-z0-9_-]{1,32}$/.test(e[0]!.payload.shipmentId) &&
                !usedEvents.has(e[0]!),
            );
            usedEvents.add(e[0]!);
          }
        }
      } else if (n.startsWith("carrier.canada-post.manifest.")) {
        prepared(a.reference, true, a.sequence);
        const suffix = n.split(".").at(-1)!;
        fields(d, [
          "reviewHash",
          ...(suffix === "claimed"
            ? ["send", "memberHash"]
            : suffix === "unknown"
              ? []
              : [
                  "reconciled",
                  ...(suffix === "transmitted"
                    ? ["documentHash", "poNumber"]
                    : []),
                ]),
        ]);
        valid(hash(d.reviewHash));
        if (suffix === "claimed")
          valid(typeof d.send === "boolean" && hash(d.memberHash));
        else {
          const claim = audits.findLast(
            (c) =>
              c.action === "carrier.canada-post.manifest.claimed" &&
              c.reference === a.reference &&
              c.sequence < a.sequence,
          );
          valid(
            claim &&
              claim.actorId === a.actorId &&
              claim.detail.reviewHash === d.reviewHash,
          );
          if (suffix !== "unknown")
            valid(
              typeof d.reconciled === "boolean" &&
                d.reconciled === !claim.detail.send,
            );
          if (suffix === "transmitted") {
            valid(
              hash(d.documentHash) &&
                exact(d.poNumber, 10) &&
                /^[A-Za-z0-9]{1,10}$/.test(d.poNumber),
            );
            oneEvent(n, a.reference, {
              reviewHash: d.reviewHash,
              poNumber: d.poNumber,
              documentHash: d.documentHash,
            });
          }
        }
      } else if (
        n === "carrier.booking.unknown" ||
        n === "carrier.booking.booked"
      ) {
        const b = prepared(a.reference, false, a.sequence);
        fields(
          d,
          n.endsWith("unknown")
            ? ["reviewHash"]
            : ["reviewHash", "labelHash", "reconciled"],
        );
        valid(d.reviewHash === b.result.reviewHash);
        if (n.endsWith("booked")) {
          valid(hash(d.labelHash) && typeof d.reconciled === "boolean");
          const e = oneEvent(n, a.reference);
          const prep = events.find(
            (e) =>
              e.type === "carrier.booking.prepared" &&
              e.reference === a.reference,
          )!;
          fields(e.payload, [
            "shipmentId",
            "reviewHash",
            "reference",
            "tracking",
            ...("replacementId" in prep.payload ? ["replacementId"] : []),
          ]);
          valid(
            e.payload.shipmentId === prep.payload.shipmentId &&
              e.payload.replacementId === prep.payload.replacementId &&
              e.payload.reviewHash === d.reviewHash &&
              exact(e.payload.reference, 200) &&
              exact(e.payload.tracking, 200),
          );
        }
      } else valid(false); // Orphan cancellation/release domain audit.
      usedDomain.add(a);
    }
    // Canada Post manifest confirmation emits booking events, without a separate
    // booking.booked audit. Bind to its retained manifest audit, not an invented one.
    for (const e of events.filter((e) => !usedEvents.has(e))) {
      valid(e.type === "carrier.booking.booked");
      const b = prepared(e.reference, false),
        p = events.find(
          (x) =>
            x.type === "carrier.booking.prepared" &&
            x.reference === e.reference,
        )!;
      fields(e.payload, [
        "shipmentId",
        "provider",
        "manifestId",
        "reviewHash",
        ...("replacementId" in p.payload ? ["replacementId"] : []),
      ]);
      valid(
        e.payload.provider === "canada-post" &&
          e.payload.shipmentId === p.payload.shipmentId &&
          e.payload.replacementId === p.payload.replacementId &&
          e.payload.reviewHash === b.result.reviewHash,
      );
      prepared(e.payload.manifestId, true);
      const a = audits.filter(
        (a) =>
          a.action === "carrier.canada-post.manifest.transmitted" &&
          a.reference === e.payload.manifestId,
      );
      valid(a.length === 1 && a[0]!.sequence > b.audit.sequence);
      valid(
        events.filter((x) => x.type === e.type && x.reference === e.reference)
          .length === 1,
      );
      usedEvents.add(e);
    }
    valid(usedEvents.size === events.length);
    // Audit sequences, not wall-clock timestamps or unordered event IDs, bind
    // these native terminal relationships. Stale recovery has no audit of its
    // own; do not invent a complete token/attempt chain from these checks.
    const domain = audits.filter((a) => domainNames.includes(a.action));
    for (const a of domain) {
      if (
        a.action === "carrier.canada-post.group.canceled" ||
        a.action === "carrier.canada-post.manifest.transmitted"
      )
        valid(
          !domain.some(
            (later) =>
              later.reference === a.reference && later.sequence > a.sequence,
          ),
        );
      if (a.action === "carrier.canada-post.member.created")
        valid(
          !domain.some(
            (later) =>
              later.reference === a.reference &&
              later.action.startsWith("carrier.canada-post.member.") &&
              later.detail.bookingId === a.detail.bookingId &&
              later.sequence > a.sequence,
          ),
        );
      if (
        a.action === "carrier.booking.canceled" ||
        a.action === "carrier.booking.booked"
      )
        valid(
          !domain.some(
            (later) =>
              later.sequence > a.sequence &&
              (later.reference === a.reference ||
                later.detail.bookingId === a.reference),
          ),
        );
      if (a.action === "carrier.claim.released") {
        const t = target(a.detail.target);
        if (t.bookingId) prepared(t.bookingId, false, a.sequence);
        if (t.groupId) prepared(t.groupId, true, a.sequence);
      }
    }
    for (const e of events.filter(
      (e) => e.type === "carrier.canada-post.group.prepared",
    )) {
      const created = events.filter(
        (c) =>
          c.type === "carrier.canada-post.member.created" &&
          c.reference === e.reference,
      );
      valid(created.length <= Number(e.payload.count));
      const transmitted = events.filter(
        (c) =>
          c.type === "carrier.canada-post.manifest.transmitted" &&
          c.reference === e.reference,
      );
      if (transmitted.length) {
        valid(transmitted.length === 1 && created.length === e.payload.count);
        const booked = events.filter(
          (b) =>
            b.type === "carrier.booking.booked" &&
            b.payload.manifestId === e.reference,
        );
        valid(
          booked.length === created.length &&
            created.every((c) =>
              booked.some(
                (b) =>
                  b.reference === c.payload.bookingId &&
                  b.payload.reviewHash === c.payload.reviewHash,
              ),
            ),
        );
        const completion = domain.find(
          (a) =>
            a.action === "carrier.canada-post.manifest.transmitted" &&
            a.reference === e.reference,
        )!;
        valid(
          domain
            .filter(
              (a) =>
                a.action === "carrier.canada-post.member.created" &&
                a.reference === e.reference,
            )
            .every((a) => a.sequence < completion.sequence),
        );
      }
    }
    const selectedGroup = preparations.get(groupId),
      selectedBooking = preparations.get(bookingId);
    check(
      selectedGroup && selectedBooking,
      "NOT_FOUND",
      "Retained carrier preparation not found.",
      404,
    );
    prepared(groupId, true);
    prepared(bookingId, false);
    const selectedEvent = events.find(
      (e) => e.type === "carrier.booking.prepared" && e.reference === bookingId,
    )!;
    valid(selectedEvent.payload.provider === "canada-post");
    const selected = receipts.filter(
      (r) =>
        r.result.id === groupId ||
        r.result.id === bookingId ||
        (r.result.target &&
          ((r.result.target as Data).groupId === groupId ||
            (r.result.target as Data).bookingId === bookingId)),
    );
    const selectedAuditIds = new Set(selected.map((r) => r.audit.id));
    const body = {
      version: 1 as const,
      purpose: "distributor-platform-offline-carrier-review-v1" as const,
      orgId: org,
      groupId,
      bookingId,
      history: {
        commands: commands.length,
        audits: audits.length,
        events: events.length,
        hash: digest(
          canonical({
            purpose: "distributor-platform-carrier-history-v1",
            commands,
            audits: auditRows,
            events: eventRows,
          }),
        ),
      },
      commands: selected,
      audits: audits.filter(
        (a) =>
          selectedAuditIds.has(a.id) ||
          a.reference === groupId ||
          a.reference === bookingId,
      ),
      events: events.filter(
        (e) => e.reference === groupId || e.reference === bookingId,
      ),
      blockers: [
        "BOOKING_SITE_ACCOUNT_CONFIGURATION_NOT_RETAINED",
        "CLAIM_TOKEN_AND_COMPLETE_ATTEMPT_LINEAGE_NOT_RETAINED",
        "EVENT_DURABLE_ORDER_AND_ACTOR_NOT_RETAINED",
        "GROUP_MEMBERSHIP_ALLOWLIST_NOT_RETAINED",
        "ORIGINAL_COMMAND_PAYLOADS_NOT_RETAINED",
        "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
      ],
    };
    return freeze({ ...body, factsHash: digest(canonical(body)) });
  }
}
