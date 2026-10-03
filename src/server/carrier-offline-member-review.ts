import { types } from "node:util";
import { carrierNames } from "../shared/carrier-booking.ts";
import {
  canonical,
  check,
  digest,
  permit,
  site,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { captureCarrierConfiguration } from "./carrier-configuration.ts";
import {
  validateCarrierLabel,
  type CarrierIntent,
} from "./carrier-bookings.ts";

type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
function intact(value: unknown): asserts value {
  check(
    value,
    "CARRIER_OFFLINE_REVIEW",
    "Retained carrier member history is inconsistent or unsupported.",
  );
}
function bounded(value: unknown): asserts value {
  check(
    value,
    "CARRIER_OFFLINE_REVIEW_LIMIT",
    "Retained carrier review exceeds its bounded profile.",
  );
}
function identifier(value: unknown): asserts value is string {
  intact(
    typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 128 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/.test(value),
  );
}
function hash(value: unknown): asserts value is string {
  intact(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}
function iso(value: unknown) {
  intact(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
}
function json(value: unknown): any {
  intact(typeof value === "string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    intact(false);
  }
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    bounded(depth <= 20 && ++nodes <= 20000);
    if (v && typeof v === "object")
      for (const child of Object.values(v)) visit(child, depth + 1);
  };
  visit(parsed, 0);
  return parsed;
}
function record(value: any, keys: string[]) {
  intact(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
  );
}
function claim(row: Row) {
  intact(
    (row.token === null && row.started_at === null) ||
      (typeof row.token === "string" &&
        row.token.length > 0 &&
        row.token.length <= 128 &&
        Number.isSafeInteger(row.started_at) &&
        Number(row.started_at) >= 0),
  );
}
// Fixed owner inventory. Full-table preflights deliberately precede subject
// filtering: corrupt foreign copies cannot hide behind their changed org/key.
const inventory = {
  integration_carrier_bookings: {
    max: 512,
    order: "sequence",
    columns:
      "sequence,id,org_id,shipment_id,state,review_hash,intent,token,started_at,reference,tracking,label_bytes,label_type,label_hash,error,created_at",
    blobs: ["label_bytes"],
    large: ["intent"],
  },
  integration_canada_post_groups: {
    max: 128,
    order: "id",
    columns:
      "id,org_id,warehouse_id,configuration_hash,provider_group_id,review_hash,state,token,started_at,observation,manifest_bytes,manifest_hash,created_at",
    blobs: ["manifest_bytes"],
    large: ["observation"],
  },
  integration_canada_post_members: {
    max: 512,
    order: "group_id,booking_id",
    columns:
      "group_id,booking_id,org_id,review_hash,active,state,token,started_at,provider_shipment_id,tracking,label_bytes,label_hash",
    blobs: ["label_bytes"],
    large: [],
  },
} as const;
type Table = keyof typeof inventory;
const MAX_BUDGET = 16 * 1024 * 1024;

function proposedPair(input: unknown) {
  intact(input !== null && typeof input === "object" && !types.isProxy(input));
  intact(
    Object.getPrototypeOf(input) === Object.prototype ||
      Object.getPrototypeOf(input) === null,
  );
  let count = 0;
  for (const key in input) intact(++count <= 4 && Object.hasOwn(input, key));
  intact(Reflect.ownKeys(input).length === 4 && count === 4);
  const values: Record<string, string> = Object.create(null);
  for (const key of [
    "groupId",
    "bookingId",
    "providerShipmentId",
    "tracking",
  ]) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    intact(d && "value" in d && d.enumerable);
    identifier(d.value);
    values[key] = d.value;
  }
  intact(
    /^[A-Za-z0-9_-]{1,32}$/.test(values.providerShipmentId!) &&
      /^\d{11,16}$/.test(values.tracking!),
  );
  return Object.freeze({
    groupId: values.groupId!,
    bookingId: values.bookingId!,
    providerShipmentId: values.providerShipmentId!,
    tracking: values.tracking!,
  });
}

function referencePair(reference: unknown, tracking: unknown) {
  intact(
    typeof reference === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(reference),
  );
  intact(typeof tracking === "string" && /^\d{11,16}$/.test(tracking));
  return { providerShipmentId: reference, tracking };
}
function pdf(bytes: unknown, labelHash: unknown) {
  intact(bytes instanceof Uint8Array);
  hash(labelHash);
  intact(digest(bytes) === labelHash);
  validateCarrierLabel({
    mediaType: "application/pdf",
    bytes: Buffer.from(bytes),
  });
}

// Fixed retained-manifest consistency, matching the existing native confirmation
// layout. This is neither provider truth nor authority to hand over a shipment.
function promotedManifest(group: Row, members: Row[]) {
  intact(
    group.token === null &&
      group.started_at === null &&
      typeof group.observation === "string",
  );
  pdf(group.manifest_bytes, group.manifest_hash);
  const c = json(group.observation);
  intact(canonical(c) === group.observation);
  record(c, [
    "kind",
    "groupReviewHash",
    "memberHash",
    "identity",
    "result",
    "documentHash",
  ]);
  intact(
    c.kind === "manifest-confirmed" &&
      c.groupReviewHash === group.review_hash &&
      c.documentHash === group.manifest_hash,
  );
  intact(
    members.every(
      (m) =>
        m.state === "created" &&
        m.active === 1 &&
        m.token === null &&
        m.started_at === null,
    ),
  );
  intact(
    c.memberHash ===
      digest(
        canonical(
          members.map((m) => ({
            bookingId: m.booking_id,
            reviewHash: m.review_hash,
            shipmentId: m.provider_shipment_id,
            tracking: m.tracking,
            labelHash: m.label_hash,
          })),
        ),
      ),
  );
  const keys = [
    "manifestId",
    "groupId",
    "configurationHash",
    "reviewHash",
    "customerReference",
    "shipmentIds",
  ];
  record(c.identity, keys);
  hash(c.identity.reviewHash);
  intact(
    c.identity.manifestId === group.id &&
      c.identity.groupId === group.provider_group_id &&
      c.identity.configurationHash === group.configuration_hash &&
      c.identity.customerReference ===
        "D" + c.identity.reviewHash.slice(0, 11).toUpperCase(),
  );
  const ids = members.map((m) => String(m.provider_shipment_id)).sort();
  intact(
    new Set(ids).size === ids.length &&
      canonical(c.identity.shipmentIds) === canonical(ids),
  );
  record(c.result, [...keys, "poNumber", "manifestDate", "totalCents"]);
  for (const key of keys)
    intact(canonical(c.result[key]) === canonical(c.identity[key]));
  intact(
    typeof c.result.poNumber === "string" &&
      /^[A-Za-z0-9]{1,10}$/.test(c.result.poNumber),
  );
  intact(
    typeof c.result.manifestDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(c.result.manifestDate) &&
      Number.isFinite(Date.parse(c.result.manifestDate)) &&
      new Date(c.result.manifestDate).toISOString().slice(0, 10) ===
        c.result.manifestDate,
  );
  intact(
    Number.isSafeInteger(c.result.totalCents) &&
      c.result.totalCents >= 0 &&
      c.result.totalCents <= 100000000,
  );
}

/** Internal native read only. No supplied evidence, SQL, adapters or callbacks. */
export class CarrierOfflineMemberReview {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
  ) {
    this.store = database.owned("integration");
  }
  /** Native consistency only; no reservation, provider truth or import authority. */
  reviewProposedReferencesInTransaction(actor: Actor, input: unknown) {
    this.database.requireTransaction();
    const proposed = proposedPair(input);
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    // Single inventory scan, with the same fixed preflights/current IAM/hold/site
    // checks as the historical reader. No alternate port or transaction boundary.
    const { facts, bookings, groups, members, capturedIntents } =
      this.readUnknownMember(actor, proposed.groupId, proposed.bookingId, true);
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    intact(
      bookingById.size === bookings.length && groupById.size === groups.length,
    );
    const targetGroup = groupById.get(proposed.groupId)!;
    const configurationHash = String(targetGroup.configuration_hash);
    type Reference = {
      bookingId: string;
      groupId: string | null;
      configurationHash: string | null;
      providerShipmentId: string;
      tracking: string;
      labelHash: string;
    };
    const references: Reference[] = [];
    let memberReferences = 0,
      bookingReferences = 0,
      promotedCopies = 0;
    // Validate linkage across the entire scanned inventory BEFORE org/provider
    // selection. A copied SQL org/provider must not hide a contradictory intent.
    for (const b of bookings) {
      identifier(b.id);
      identifier(b.org_id);
      identifier(b.shipment_id);
      hash(b.review_hash);
      iso(b.created_at);
      claim(b);
      const i = capturedIntents.get(String(b.id));
      intact(i && canonical(i) === b.intent && i.nativeSnapshot);
      const { bookingId, reviewHash, ...review } = i;
      intact(
        bookingId === b.id &&
          reviewHash === b.review_hash &&
          digest(canonical(review)) === reviewHash &&
          i.nativeSnapshot.org_id === b.org_id &&
          carrierNames.includes(i.provider),
      );
      identifier(i.shipmentId);
      intact(i.nativeSnapshot.id === i.shipmentId);
      intact(
        i.replacementId === undefined
          ? i.shipmentId === b.shipment_id &&
              i.nativeSnapshot.kind === undefined
          : i.replacementId === i.shipmentId &&
              i.nativeSnapshot.kind === "replacement" &&
              b.shipment_id === `replacement:${i.shipmentId}`,
      );
      identifier(i.nativeSnapshot.warehouse_id);
      intact(
        ["pending", "running", "unknown", "booked", "canceled"].includes(
          String(b.state),
        ),
      );
    }
    for (const g of groups) {
      identifier(g.id);
      identifier(g.org_id);
      identifier(g.warehouse_id);
      hash(g.configuration_hash);
      hash(g.review_hash);
      iso(g.created_at);
      claim(g);
      intact(
        g.provider_group_id === String(g.id).replaceAll("-", "") &&
          /^[A-Za-z0-9_-]{1,32}$/.test(String(g.provider_group_id)),
      );
      const entries = members.filter((m) => m.group_id === g.id);
      intact(entries.length >= 1 && entries.length <= 100);
      intact(
        [
          "prepared",
          "creating",
          "closed",
          "transmitting",
          "unknown",
          "transmitted",
          "canceled",
        ].includes(String(g.state)),
      );
      const states = entries.map((m) => m.state);
      if (g.state === "transmitted") promotedManifest(g, entries);
      else {
        intact(g.manifest_bytes === null && g.manifest_hash === null);
        if (g.state === "closed" || g.state === "transmitting")
          intact(states.every((s) => s === "created"));
        if (g.state === "prepared" || g.state === "canceled")
          intact(states.every((s) => s === "pending"));
      }
      intact(
        g.review_hash ===
          digest(
            canonical({
              configurationHash: g.configuration_hash,
              providerGroupId: g.provider_group_id,
              warehouseId: g.warehouse_id,
              entries: entries.map((m) => ({
                bookingId: m.booking_id,
                reviewHash: m.review_hash,
              })),
            }),
          ),
      );
    }
    for (const m of members) {
      const g = groupById.get(m.group_id),
        b = bookingById.get(m.booking_id);
      intact(g && b);
      const i = capturedIntents.get(String(b.id));
      intact(
        m.org_id === g.org_id &&
          m.org_id === b.org_id &&
          m.review_hash === b.review_hash &&
          i.provider === "canada-post" &&
          i.nativeSnapshot.warehouse_id === g.warehouse_id &&
          (i.configurationHash === undefined ||
            i.configurationHash === g.configuration_hash),
      );
      intact(
        ["pending", "creating", "unknown", "created"].includes(String(m.state)),
      );
      intact(m.active === Number(g.state !== "canceled"));
      claim(m);
      if (m.active === 1)
        intact(b.state === (g.state === "transmitted" ? "booked" : "pending"));
      if (g.state === "canceled")
        intact(m.token === null && m.started_at === null);
      if (m.state !== "created") {
        intact(
          [
            m.provider_shipment_id,
            m.tracking,
            m.label_bytes,
            m.label_hash,
          ].every((v) => v === null),
        );
        if (m.state === "pending") intact(m.token === null);
        if (m.state === "creating") intact(m.token !== null);
        continue;
      }
      intact(m.active === 1 && m.token === null && m.started_at === null);
      const pair = referencePair(m.provider_shipment_id, m.tracking);
      pdf(m.label_bytes, m.label_hash);
      if (m.org_id !== facts.orgId) continue;
      memberReferences++;
      references.push({
        bookingId: String(b.id),
        groupId: String(g.id),
        configurationHash: String(g.configuration_hash),
        ...pair,
        labelHash: String(m.label_hash),
      });
    }
    for (const b of bookings) {
      const i = capturedIntents.get(String(b.id));
      if (i.provider !== "canada-post") continue;
      const hasArtifact = [
        b.reference,
        b.tracking,
        b.label_bytes,
        b.label_type,
        b.label_hash,
      ].some((v) => v !== null);
      if (!hasArtifact) {
        intact(b.state !== "booked");
        continue;
      }
      intact(
        b.state === "booked" &&
          b.token === null &&
          b.started_at === null &&
          b.label_type === "application/pdf",
      );
      const pair = referencePair(b.reference, b.tracking);
      pdf(b.label_bytes, b.label_hash);
      if (b.org_id !== facts.orgId) continue;
      bookingReferences++;
      const own = references.filter((r) => r.bookingId === b.id);
      if (own.length) {
        intact(own.length === 1);
        const member = own[0]!;
        intact(
          member.groupId !== null &&
            groupById.get(member.groupId)!.state === "transmitted" &&
            member.providerShipmentId === pair.providerShipmentId &&
            member.tracking === pair.tracking &&
            member.labelHash === b.label_hash,
        );
        promotedCopies++;
      } else {
        intact(!members.some((m) => m.booking_id === b.id && m.active === 1));
        if (i.configurationHash !== undefined) hash(i.configurationHash);
        references.push({
          bookingId: String(b.id),
          groupId: null,
          configurationHash: i.configurationHash ?? null,
          ...pair,
          labelHash: String(b.label_hash),
        });
      }
    }
    // Matching references always conflict, even with unknown/different account
    // preimages. Never conclude that changed configuration implies a new account.
    for (let n = 0; n < references.length; n++) {
      const r = references[n]!;
      check(
        r.providerShipmentId !== proposed.providerShipmentId &&
          r.tracking !== proposed.tracking,
        "CARRIER_OFFLINE_REFERENCE_CONFLICT",
        "Proposed carrier references conflict with retained native history.",
      );
      intact(
        !references
          .slice(0, n)
          .some(
            (p) =>
              p.providerShipmentId === r.providerShipmentId ||
              p.tracking === r.tracking,
          ),
      );
    }
    check(
      references.every((r) => r.configurationHash === configurationHash),
      "CARRIER_OFFLINE_ACCOUNT_AMBIGUOUS",
      "Retained carrier account equivalence requires independent qualification.",
    );
    // Digest complete checked inventory, including irrelevant/foreign rows and
    // null states; bind blobs by size/hash without returning bytes or tuples.
    const committed = (rows: Row[]) =>
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v instanceof Uint8Array
              ? { bytes: v.length, sha256: digest(v) }
              : v,
          ]),
        ),
      );
    const scopeHash = digest(
      canonical({
        purpose: "carrier-offline-proposed-reference-scope-v1",
        bookings: committed(bookings),
        groups: committed(groups),
        members: committed(members),
      }),
    );
    const body = {
      version: 1 as const,
      purpose: "carrier-offline-proposed-reference-review-v1" as const,
      orgId: facts.orgId,
      region: facts.region,
      currency: facts.currency,
      hold: facts.hold,
      warehouseId: String(targetGroup.warehouse_id),
      proposed,
      configurationHash,
      memberReviewHash: facts.reviewHash,
      scopeHash,
      references: {
        members: memberReferences,
        bookings: bookingReferences,
        promotedCopies,
        distinct: references.length,
      },
      blockers: [
        ...facts.blockers,
        "NATIVE_REFERENCE_MATCH_ONLY_NO_RESERVATION",
        "PROVIDER_ACCOUNT_EQUIVALENCE_AND_EXTERNAL_REFERENCES_UNQUALIFIED",
      ].sort(),
    };
    intact(this.store.get("SELECT total_changes() AS n")!.n === unchanged);
    return freeze({ ...body, reviewHash: digest(canonical(body)) });
  }
  reviewUnknownMemberInTransaction(
    actor: Actor,
    groupId: string,
    bookingId: string,
  ) {
    return this.readUnknownMember(actor, groupId, bookingId).facts;
  }
  private readUnknownMember(
    actor: Actor,
    groupId: string,
    bookingId: string,
    proposedReference = false,
  ) {
    this.database.requireTransaction();
    identifier(groupId);
    identifier(bookingId);
    actor = this.identity.currentActor(actor);
    permit(actor, ["warehouse"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing carrier recovery.",
      403,
    );
    const organization = this.identity.organization(actor);
    identifier(actor.orgId);
    const hold = this.platform.rawRecoveryHoldInTransaction();
    check(
      hold,
      "RECOVERY_HOLD_REQUIRED",
      "An actual raw restored-store hold is required.",
    );
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    let budget = 0;
    // Every persisted scalar gets an SQL byte/type bound. The conservative
    // expansion budget covers JSON escaping, parsed copies, hex/base64 and keys.
    // Only fixed-size numeric aggregate results enter JS until ALL scans pass.
    for (const table of Object.keys(inventory) as Table[]) {
      const spec = inventory[table];
      const n = this.store.get(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT ?)`,
        spec.max + 1,
      )!.n;
      bounded(Number(n) <= spec.max);
      const cols = spec.columns.split(",");
      const length = (c: string) => `COALESCE(length(CAST(${c} AS BLOB)),0)`;
      const invalid = cols
        .map((c) => {
          const blob = (spec.blobs as readonly string[]).includes(c);
          const cap = blob
            ? 1048576
            : (spec.large as readonly string[]).includes(c)
              ? 262144
              : 4096;
          return `(${length(c)}>${cap} OR typeof(${c}) NOT IN (${blob ? "'blob','null'" : "'text','integer','null'"}))`;
        })
        .join(" OR ");
      const cost = cols
        .map(
          (c) =>
            `${(spec.blobs as readonly string[]).includes(c) ? 4 : 32}*${length(c)}+256`,
        )
        .join("+");
      const sizes = this.store.get(
        `SELECT COALESCE(MAX(CASE WHEN ${invalid} THEN 1 ELSE 0 END),0) AS bad, COALESCE(MAX(${cost}),0) AS row_bytes, COALESCE(SUM(${cost}),0) AS bytes FROM ${table}`,
      )!;
      bounded(
        sizes.bad === 0 &&
          Number(sizes.row_bytes) <= MAX_BUDGET &&
          Number.isSafeInteger(sizes.bytes) &&
          (budget += Number(sizes.bytes)) <= MAX_BUDGET,
      );
    }
    if (proposedReference) {
      // Before any row/numeric materialization. Do not change the older reader's
      // accepted profiles or digest domain; this is the new operation's guard.
      for (const [table, predicates] of [
        [
          "integration_carrier_bookings",
          "typeof(sequence)!='integer' OR sequence<1 OR sequence>9007199254740991 OR (started_at IS NOT NULL AND (typeof(started_at)!='integer' OR started_at<0 OR started_at>9007199254740991))",
        ],
        [
          "integration_canada_post_groups",
          "started_at IS NOT NULL AND (typeof(started_at)!='integer' OR started_at<0 OR started_at>9007199254740991)",
        ],
        [
          "integration_canada_post_members",
          "typeof(active)!='integer' OR active NOT IN(0,1) OR (started_at IS NOT NULL AND (typeof(started_at)!='integer' OR started_at<0 OR started_at>9007199254740991))",
        ],
      ])
        bounded(
          this.store.get(
            `SELECT COUNT(*) AS n FROM ${table} WHERE ${predicates}`,
          )!.n === 0,
        );
    }
    const read = (table: Table) =>
      this.store.all(
        `SELECT ${inventory[table].columns} FROM ${table} ORDER BY ${inventory[table].order}`,
      );
    const bookings = read("integration_carrier_bookings"),
      groups = read("integration_canada_post_groups"),
      members = read("integration_canada_post_members");
    const capturedIntents = new Map(
      bookings.map((b) => {
        const i = json(b.intent);
        intact(i && typeof i === "object" && !Array.isArray(i));
        return [String(b.id), i] as const;
      }),
    );
    const targetGroup = groups.find((g) => g.id === groupId);
    check(
      targetGroup && targetGroup.org_id === actor.orgId,
      "NOT_FOUND",
      "Carrier group not found.",
      404,
    );
    identifier(targetGroup.warehouse_id);
    site(actor, targetGroup.warehouse_id);
    const target = members.find(
      (m) => m.group_id === groupId && m.booking_id === bookingId,
    );
    intact(target && target.state === "unknown" && target.active === 1);
    // Closure through complete groups and shipment booking histories. Never take
    // a successful first page or hide an inactive predecessor's siblings.
    const groupIds = new Set<string>([groupId]),
      bookingIds = new Set<string>(),
      shipmentIds = new Set<string>();
    let size = -1;
    while (size !== groupIds.size + bookingIds.size + shipmentIds.size) {
      size = groupIds.size + bookingIds.size + shipmentIds.size;
      for (const m of members)
        if (
          groupIds.has(String(m.group_id)) ||
          bookingIds.has(String(m.booking_id))
        ) {
          identifier(m.group_id);
          identifier(m.booking_id);
          groupIds.add(m.group_id);
          bookingIds.add(m.booking_id);
        }
      for (const b of bookings)
        if (
          bookingIds.has(String(b.id)) ||
          shipmentIds.has(String(b.shipment_id)) ||
          shipmentIds.has(
            String(capturedIntents.get(String(b.id))!.shipmentId),
          ) ||
          shipmentIds.has(
            String(capturedIntents.get(String(b.id))!.nativeSnapshot?.id),
          )
        ) {
          identifier(b.id);
          identifier(b.shipment_id);
          bookingIds.add(b.id);
          shipmentIds.add(b.shipment_id);
        }
    }
    const bs = bookings.filter((b) => bookingIds.has(String(b.id))),
      gs = groups.filter((g) => groupIds.has(String(g.id))),
      ms = members.filter((m) => groupIds.has(String(m.group_id)));
    intact(bs.length === bookingIds.size && gs.length === groupIds.size);
    const intents = new Map<string, any>();
    const blockers = new Set([
      "PLATFORM_CARRIER_PROVENANCE_REQUIRED",
      "CURRENT_FULFILLMENT_STATE_REQUIRED",
      "PROVIDER_ACCOUNT_PREIMAGE_AND_QUALIFICATION_REQUIRED",
      "EXHAUSTIVE_EXTERNAL_OUTCOME_EVIDENCE_REQUIRED",
      "SOURCE_FENCE_AND_CURRENT_INDEPENDENT_APPROVAL_REQUIRED",
    ]);
    for (const b of bs) {
      intact(
        b.org_id === actor.orgId &&
          Number.isSafeInteger(b.sequence) &&
          Number(b.sequence) > 0,
      );
      hash(b.review_hash);
      iso(b.created_at);
      claim(b);
      const i = capturedIntents.get(String(b.id))!;
      intact(canonical(i) === b.intent);
      record(i, [
        "shipmentId",
        "previousId",
        "provider",
        "service",
        "origin",
        "destination",
        "parcel",
        "reviewedDestination",
        "acknowledgment",
        "nativeSnapshot",
        "bookingId",
        "reviewHash",
        ...(i?.configuration !== undefined
          ? ["configuration", "configurationHash"]
          : []),
      ]);
      const { bookingId: bid, reviewHash, ...review } = i;
      intact(
        bid === b.id &&
          reviewHash === b.review_hash &&
          digest(canonical(review)) === reviewHash &&
          i.provider === "canada-post" &&
          i.shipmentId === b.shipment_id &&
          !i.shipmentId.startsWith("replacement:"),
      );
      identifier(i.service);
      identifier(i.nativeSnapshot?.account_id);
      const s = i.nativeSnapshot;
      record(s, [
        "id",
        "org_id",
        "order_id",
        "account_id",
        "warehouse_id",
        "state",
        "mode",
        "address",
        "tracking",
        "carrier",
        "lines",
        "units",
        "invoice_id",
        "created_at",
        "shipped_at",
      ]);
      identifier(s.order_id);
      identifier(s.warehouse_id);
      iso(s.created_at);
      site(actor, s.warehouse_id);
      intact(
        s.id === i.shipmentId &&
          s.org_id === actor.orgId &&
          s.state === "packed" &&
          s.mode === "carrier" &&
          s.tracking === null &&
          s.carrier === null &&
          s.invoice_id === null &&
          s.shipped_at === null &&
          typeof s.address === "string" &&
          s.address.length <= 2000 &&
          s.address === i.reviewedDestination,
      );
      const lines = json(s.lines),
        units = json(s.units);
      intact(
        Array.isArray(lines) &&
          lines.length > 0 &&
          lines.length <= 1000 &&
          Array.isArray(units) &&
          units.length === 0,
      );
      const allocations = new Set();
      for (const l of lines) {
        record(l, ["allocationId", "quantity"]);
        identifier(l.allocationId);
        intact(
          !allocations.has(l.allocationId) &&
            Number.isSafeInteger(l.quantity) &&
            l.quantity > 0 &&
            l.quantity <= 100000,
        );
        allocations.add(l.allocationId);
      }
      for (const a of [i.origin, i.destination]) {
        record(a, [
          "name",
          "line1",
          "line2",
          "city",
          "province",
          "postalCode",
          "country",
          "phone",
        ]);
        intact(
          a.country === "CA" &&
            "AB BC MB NB NL NS NT NU ON PE QC SK YT"
              .split(" ")
              .includes(a.province) &&
            /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ] \d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
              a.postalCode,
            ),
        );
        for (const key of ["name", "line1", "city", "phone"])
          intact(
            typeof a[key] === "string" &&
              a[key].trim() === a[key] &&
              a[key].length > 0 &&
              a[key].length <= 160,
          );
        intact(
          /^\+?[0-9 () .-]+$/.test(a.phone) &&
            a.phone.length <= 32 &&
            a.phone.replace(/\D/g, "").length >= 10 &&
            a.phone.replace(/\D/g, "").length <= 15,
        );
        intact(
          typeof a.line2 === "string" &&
            a.line2.length <= 160 &&
            a.line2.trim() === a.line2,
        );
      }
      record(i.parcel, ["weightGrams", "lengthMm", "widthMm", "heightMm"]);
      for (const [key, v] of Object.entries(i.parcel))
        intact(
          Number.isSafeInteger(v) &&
            Number(v) > 0 &&
            Number(v) <= (key === "weightGrams" ? 1000000 : 100000),
        );
      intact(
        typeof i.acknowledgment === "string" &&
          i.acknowledgment.length > 0 &&
          i.acknowledgment.length <= 1000,
      );
      if (i.configuration !== undefined) {
        const c = captureCarrierConfiguration(i.configuration, "canada-post");
        intact(
          c.hash === i.configurationHash &&
            c.services.some((s) => s.service === i.service),
        );
      } else blockers.add("NATIVE_DISPLAY_CONFIGURATION_ABSENT");
      const history = bs.filter(
        (p) =>
          p.shipment_id === b.shipment_id &&
          Number(p.sequence) < Number(b.sequence),
      );
      const previous = history.at(-1);
      intact(
        i.previousId === (previous?.id ?? null) &&
          (!previous || previous.state === "canceled"),
      );
      intact(
        ["pending", "canceled"].includes(String(b.state)) &&
          b.token === null &&
          b.started_at === null &&
          [
            b.reference,
            b.tracking,
            b.label_bytes,
            b.label_type,
            b.label_hash,
            b.error,
          ].every((v) => v === null),
      );
      intents.set(String(b.id), i);
    }
    for (const g of gs) {
      intact(g.org_id === actor.orgId);
      identifier(g.id);
      identifier(g.warehouse_id);
      site(actor, g.warehouse_id);
      hash(g.configuration_hash);
      hash(g.review_hash);
      iso(g.created_at);
      claim(g);
      intact(
        g.provider_group_id === String(g.id).replaceAll("-", "") &&
          /^[A-Za-z0-9_-]{1,32}$/.test(String(g.provider_group_id)) &&
          [
            g.token,
            g.started_at,
            g.observation,
            g.manifest_bytes,
            g.manifest_hash,
          ].every((v) => v === null),
      );
      const groupMembers = ms.filter((m) => m.group_id === g.id);
      intact(groupMembers.length >= 1 && groupMembers.length <= 100);
      let origin: string | undefined, configuration: string | undefined;
      for (const m of groupMembers) {
        intact(
          m.org_id === actor.orgId &&
            m.active === Number(g.state !== "canceled"),
        );
        claim(m);
        const b = bs.find((b) => b.id === m.booking_id)!,
          i = intents.get(String(m.booking_id));
        intact(
          b &&
            i &&
            b.review_hash === m.review_hash &&
            i.nativeSnapshot.warehouse_id === g.warehouse_id,
        );
        const o = canonical(i.origin),
          c = canonical(i.configuration ?? null);
        origin ??= o;
        configuration ??= c;
        intact(
          origin === o &&
            configuration === c &&
            (i.configurationHash === undefined ||
              i.configurationHash === g.configuration_hash),
        );
        if (g.state !== "canceled") intact(b.state === "pending");
        if (m.state === "created") {
          intact(
            g.state !== "canceled" &&
              m.token === null &&
              m.started_at === null &&
              /^[A-Za-z0-9_-]{1,32}$/.test(String(m.provider_shipment_id)) &&
              /^\d{11,16}$/.test(String(m.tracking)) &&
              m.label_bytes instanceof Uint8Array,
          );
          validateCarrierLabel({
            mediaType: "application/pdf",
            bytes: Buffer.from(m.label_bytes),
          });
          intact(digest(m.label_bytes) === m.label_hash);
        } else {
          intact(
            ["pending", "creating", "unknown"].includes(String(m.state)) &&
              [
                m.provider_shipment_id,
                m.tracking,
                m.label_bytes,
                m.label_hash,
              ].every((v) => v === null),
          );
          intact(
            m.state === "creating"
              ? m.token !== null
              : m.state === "pending"
                ? m.token === null
                : true,
          );
          if (m.token !== null) blockers.add("RETAINED_MEMBER_CLAIM");
        }
        if (g.state === "canceled")
          intact(m.state === "pending" && m.token === null);
      }
      intact(
        g.review_hash ===
          digest(
            canonical({
              configurationHash: g.configuration_hash,
              providerGroupId: g.provider_group_id,
              warehouseId: g.warehouse_id,
              entries: groupMembers.map((m) => ({
                bookingId: m.booking_id,
                reviewHash: m.review_hash,
              })),
            }),
          ),
      );
      const states = groupMembers.map((m) => m.state);
      intact(
        g.state === "canceled" ||
          (states.includes("unknown")
            ? g.state === "unknown"
            : states.every((s) => s === "created")
              ? g.state === "closed"
              : states.every((s) => s === "pending")
                ? ["prepared", "creating"].includes(String(g.state))
                : g.state === "creating"),
      );
    }
    // Native duplicate scope is org/configuration, NOT a qualified provider
    // account. Bind that whole scope, including inactive and other-group rows.
    const duplicateScope = members.filter((m) => {
      const g = groups.find((g) => g.id === m.group_id);
      return (
        (g?.org_id === actor.orgId || m.org_id === actor.orgId) &&
        g?.configuration_hash === targetGroup.configuration_hash
      );
    });
    for (const m of duplicateScope) {
      const g = groups.find((g) => g.id === m.group_id)!;
      intact(m.org_id === actor.orgId && g.org_id === actor.orgId);
      if (
        m.state === "created" ||
        m.provider_shipment_id !== null ||
        m.tracking !== null
      ) {
        intact(
          m.state === "created" &&
            typeof m.provider_shipment_id === "string" &&
            typeof m.tracking === "string",
        );
        intact(
          /^[A-Za-z0-9_-]{1,32}$/.test(String(m.provider_shipment_id)) &&
            /^\d{11,16}$/.test(String(m.tracking)) &&
            m.label_bytes instanceof Uint8Array,
        );
        validateCarrierLabel({
          mediaType: "application/pdf",
          bytes: Buffer.from(m.label_bytes as Uint8Array),
        });
        intact(digest(m.label_bytes as Uint8Array) === m.label_hash);
        intact(
          duplicateScope.filter(
            (p) =>
              p.provider_shipment_id === m.provider_shipment_id ||
              p.tracking === m.tracking,
          ).length === 1,
        );
      }
    }
    const bookingReferences = bookings.filter((b) => {
      const i = capturedIntents.get(String(b.id))!;
      return (
        i.provider === "canada-post" &&
        (b.org_id === actor.orgId ||
          i.nativeSnapshot?.org_id === actor.orgId) &&
        (b.reference !== null || b.tracking !== null)
      );
    });
    for (const b of bookingReferences) {
      const i = capturedIntents.get(String(b.id))!;
      intact(
        b.org_id === actor.orgId && i.nativeSnapshot?.org_id === actor.orgId,
      );
      for (const m of duplicateScope)
        if (
          m.provider_shipment_id !== null &&
          (b.reference === m.provider_shipment_id || b.tracking === m.tracking)
        ) {
          // Native manifest promotion copies exactly this member to its booking.
          // An ambiguous other-account collision requires investigation, not truth.
          intact(
            b.id === m.booking_id &&
              b.reference === m.provider_shipment_id &&
              b.tracking === m.tracking &&
              b.label_hash === m.label_hash,
          );
        }
    }
    // Buffers cannot be deeply frozen; exact bytes become immutable base64 data.
    const detached = (r: Row) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          v instanceof Uint8Array
            ? {
                encoding: "base64",
                bytes: v.length,
                sha256: digest(v),
                data: Buffer.from(v).toString("base64"),
              }
            : v,
        ]),
      );
    const facts = {
      version: 1 as const,
      purpose: "carrier-offline-unknown-member-native-review" as const,
      orgId: actor.orgId,
      region: organization.region,
      currency: organization.currency,
      hold,
      groupId,
      bookingId,
      groups: gs.map(detached),
      members: ms.map(detached),
      bookingHistory: bs.map(detached),
      preparations: bs.map((b) => ({
        bookingId: b.id,
        intent: intents.get(String(b.id)) as CarrierIntent,
        intentHash: digest(String(b.intent)),
      })),
      orderedMembers: ms
        .filter((m) => m.group_id === groupId)
        .map((m) => ({ bookingId: m.booking_id, reviewHash: m.review_hash })),
      duplicateScopeHash: digest(
        canonical(
          duplicateScope.map((m) => ({
            groupId: m.group_id,
            bookingId: m.booking_id,
            providerShipmentId: m.provider_shipment_id,
            tracking: m.tracking,
            active: m.active,
            state: m.state,
            reviewHash: m.review_hash,
            token: m.token,
            startedAt: m.started_at,
            labelHash: m.label_hash,
            groupState: groups.find((g) => g.id === m.group_id)!.state,
            groupReviewHash: groups.find((g) => g.id === m.group_id)!
              .review_hash,
          })),
        ),
      ),
      bookingReferenceScopeHash: digest(
        canonical(
          bookingReferences.map((b) => ({
            bookingId: b.id,
            reference: b.reference,
            tracking: b.tracking,
            labelHash: b.label_hash,
            state: b.state,
            reviewHash: b.review_hash,
            intentHash: digest(String(b.intent)),
          })),
        ),
      ),
      blockers: [...blockers].sort(),
    };
    intact(this.store.get("SELECT total_changes() AS n")!.n === unchanged);
    return {
      facts: freeze({ ...facts, reviewHash: digest(canonical(facts)) }),
      bookings,
      groups,
      members,
      capturedIntents,
    };
  }
}
export type CarrierOfflineMemberFacts = ReturnType<
  CarrierOfflineMemberReview["reviewUnknownMemberInTransaction"]
>;
export type CarrierOfflineProposedReferenceFacts = ReturnType<
  CarrierOfflineMemberReview["reviewProposedReferencesInTransaction"]
>;
