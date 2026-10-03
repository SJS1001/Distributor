import { types } from "node:util";
import { canonical, digest } from "./core.ts";
import {
  validateCarrierLabel,
  type CarrierIntent,
} from "./carrier-bookings.ts";
import { captureCarrierConfiguration } from "./carrier-configuration.ts";
import {
  captureCanadaPostAccountBinding,
  canadaPostConfigurationHash,
  reviewCanadaPostShipment,
  captureCanadaPostShipmentDetails,
} from "./canada-post-evidence.ts";

// Data comparison only. Even an entirely self-consistent caller copy is not a
// current native read, authentic provider evidence, reservation or permission.
export const canadaPostOfflineMemberEvidenceLimits = Object.freeze({
  members: 100,
  nodes: 100_000,
  depth: 24,
  array: 4000,
  record: 64,
  string: 1_398_104,
  totalUtf8Bytes: 16 * 1024 * 1024,
  pdfBytes: 1_048_576,
});
type Data = Record<string, any>;
function need(ok: unknown): asserts ok {
  if (!ok)
    throw new Error(
      "CANADA_POST_OFFLINE_EVIDENCE: unsupported or inconsistent captured facts",
    );
}
// Check Proxy (including revoked Proxy) before *any* reflection/Array.isArray.
// Copy descriptors only. Bound enumeration, strings and depth before hashing,
// parsing embedded JSON, decoding base64, or using legacy pure helper functions.
function capture(input: unknown): any {
  let nodes = 0,
    bytes = 0;
  const active = new WeakSet<object>();
  const limits = canadaPostOfflineMemberEvidenceLimits;
  const charge = (s: string) => {
    need(s.length <= limits.string);
    bytes += Buffer.byteLength(s, "utf8");
    need(bytes <= limits.totalUtf8Bytes);
  };
  const copy = (v: unknown, depth: number): any => {
    need(!types.isProxy(v));
    need(++nodes <= limits.nodes && depth <= limits.depth);
    if (typeof v === "string") {
      charge(v);
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      need(Number.isFinite(v) && !Object.is(v, -0));
      return v;
    }
    need(v !== null && typeof v === "object" && !active.has(v));
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    active.add(v);
    let length = 0,
      count = 0;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(v, "length");
      need(
        d &&
          "value" in d &&
          Number.isSafeInteger(d.value) &&
          d.value >= 0 &&
          d.value <= limits.array,
      );
      length = d.value;
    }
    // Early stop for enormous ordinary enumerable records; Reflect.ownKeys is
    // only reached after this check. JS has no bounded own-symbol iterator.
    for (const key in v)
      need(
        Object.hasOwn(v, key) && ++count <= (array ? length : limits.record),
      );
    const keys = Reflect.ownKeys(v);
    need(keys.length === count + (array ? 1 : 0));
    const out: any = array ? [] : {};
    for (const key of keys) {
      need(typeof key === "string" && key.length <= 128);
      if (array && key === "length") continue;
      need(!["__proto__", "prototype", "constructor"].includes(key));
      if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
      const d = Object.getOwnPropertyDescriptor(v, key);
      need(d && "value" in d && d.enumerable);
      charge(key);
      Object.defineProperty(out, key, {
        value: copy(d.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    need(!array || count === length);
    active.delete(v);
    return out;
  };
  return copy(input, 0);
}
function fields(v: any, keys: string): asserts v is Data {
  const expected = keys.split(",");
  need(
    v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === expected.length &&
      expected.every((k) => Object.hasOwn(v, k)),
  );
}
function list(v: any, max = 100): asserts v is any[] {
  need(Array.isArray(v) && v.length <= max);
}
function text(v: any, max = 128) {
  need(
    typeof v === "string" &&
      v.length > 0 &&
      Buffer.byteLength(v) <= max &&
      v.trim() === v &&
      !/[\u0000-\u001f\u007f]/.test(v),
  );
}
function hash(v: any) {
  need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function integer(v: any, min = 0, max = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(v) && v >= min && v <= max);
}
function instant(v: any) {
  need(
    typeof v === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v,
  );
}
function equal(a: any, b: any) {
  need(canonical(a) === canonical(b));
}
function signedShape(v: Data, key: string) {
  hash(v[key]);
  const { [key]: actual, ...body } = v;
  need(digest(canonical(body)) === actual);
}
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
function frozen<T>(v: T): Frozen<T> {
  if (v && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}
function nulls(v: Data, keys: string) {
  for (const key of keys.split(",")) need(v[key] === null);
}
function unique<T>(rows: T[], key: (r: T) => string) {
  need(new Set(rows.map(key)).size === rows.length);
}
function pdf(v: any) {
  fields(v, "encoding,bytes,sha256,data");
  need(v.encoding === "base64");
  integer(v.bytes, 1, canadaPostOfflineMemberEvidenceLimits.pdfBytes);
  hash(v.sha256);
  need(
    typeof v.data === "string" &&
      v.data.length === Math.ceil(v.bytes / 3) * 4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(v.data),
  );
  const bytes = Buffer.from(v.data, "base64");
  try {
    need(
      bytes.length === v.bytes &&
        bytes.toString("base64") === v.data &&
        digest(bytes) === v.sha256,
    );
    validateCarrierLabel({ mediaType: "application/pdf", bytes });
  } finally {
    bytes.fill(0);
  }
}
function address(v: any) {
  fields(v, "name,line1,line2,city,province,postalCode,country,phone");
  for (const k of [
    "name",
    "line1",
    "city",
    "province",
    "postalCode",
    "country",
    "phone",
  ])
    text(v[k], 128);
  need(typeof v.line2 === "string" && v.line2.length <= 40);
  need(v.country === "CA");
}
function shipment(v: any) {
  fields(
    v,
    "id,org_id,order_id,account_id,warehouse_id,state,mode,address,tracking,carrier,lines,units,invoice_id,created_at,shipped_at",
  );
  for (const k of ["id", "org_id", "order_id", "account_id", "warehouse_id"])
    text(v[k]);
  text(v.address, 8000);
  instant(v.created_at);
  need(v.state === "packed" && v.mode === "carrier" && v.units === "[]");
  nulls(v, "tracking,carrier,invoice_id,shipped_at");
  need(typeof v.lines === "string" && Buffer.byteLength(v.lines) <= 32768);
}
const nativeBlockers = [
  "PLATFORM_CARRIER_PROVENANCE_REQUIRED",
  "CURRENT_FULFILLMENT_STATE_REQUIRED",
  "PROVIDER_ACCOUNT_PREIMAGE_AND_QUALIFICATION_REQUIRED",
  "EXHAUSTIVE_EXTERNAL_OUTCOME_EVIDENCE_REQUIRED",
  "SOURCE_FENCE_AND_CURRENT_INDEPENDENT_APPROVAL_REQUIRED",
].sort();
const platformBlockers = [
  "BOOKING_SITE_ACCOUNT_CONFIGURATION_NOT_RETAINED",
  "CLAIM_TOKEN_AND_COMPLETE_ATTEMPT_LINEAGE_NOT_RETAINED",
  "EVENT_DURABLE_ORDER_AND_ACTOR_NOT_RETAINED",
  "GROUP_MEMBERSHIP_ALLOWLIST_NOT_RETAINED",
  "ORIGINAL_COMMAND_PAYLOADS_NOT_RETAINED",
  "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
].sort();

/** Supported profile: one ordinary untransmitted group, exactly one unknown
 * member, all siblings created in one original send attempt each. All members'
 * native/Platform/custody projections and external details/PDFs are required.
 * Other histories refuse; no completeness or qualification is inferred. */
export function compareCanadaPostOfflineMemberEvidence(input: unknown) {
  try {
    return compare(capture(input));
  } catch {
    throw new Error(
      "CANADA_POST_OFFLINE_EVIDENCE: unsupported or inconsistent captured facts",
    );
  }
}
function compare(v: any) {
  fields(
    v,
    "version,native,proposedReferences,account,platform,custody,members",
  );
  need(v.version === 1);
  const n = v.native,
    p = v.proposedReferences;
  fields(
    n,
    "version,purpose,orgId,region,currency,hold,groupId,bookingId,groups,members,bookingHistory,preparations,orderedMembers,duplicateScopeHash,bookingReferenceScopeHash,blockers,reviewHash",
  );
  need(
    n.version === 1 &&
      n.purpose === "carrier-offline-unknown-member-native-review" &&
      n.region === "CA" &&
      ["CAD", "USD"].includes(n.currency),
  );
  for (const k of ["orgId", "groupId", "bookingId"]) text(n[k]);
  fields(n.hold, "id,snapshot_hash,restored_at,source_completed_at");
  need(n.hold.id === 1);
  hash(n.hold.snapshot_hash);
  instant(n.hold.restored_at);
  instant(n.hold.source_completed_at);
  hash(n.duplicateScopeHash);
  hash(n.bookingReferenceScopeHash);
  signedShape(n, "reviewHash");
  for (const a of [
    n.groups,
    n.members,
    n.bookingHistory,
    n.preparations,
    n.orderedMembers,
    v.platform,
    v.custody,
    v.members,
  ])
    list(a);
  need(n.groups.length === 1 && n.members.length >= 1);
  const count = n.members.length;
  for (const a of [
    n.bookingHistory,
    n.preparations,
    n.orderedMembers,
    v.platform,
    v.custody,
    v.members,
  ])
    need(a.length === count);
  equal(n.blockers, nativeBlockers); // Profile requires retained display configuration and no claim.
  const g = n.groups[0];
  fields(
    g,
    "id,org_id,warehouse_id,configuration_hash,provider_group_id,review_hash,state,token,started_at,observation,manifest_bytes,manifest_hash,created_at",
  );
  need(g.id === n.groupId && g.org_id === n.orgId && g.state === "unknown");
  text(g.warehouse_id);
  hash(g.configuration_hash);
  hash(g.review_hash);
  instant(g.created_at);
  need(
    g.provider_group_id === g.id.replaceAll("-", "") &&
      /^[A-Za-z0-9_-]{1,32}$/.test(g.provider_group_id),
  );
  nulls(g, "token,started_at,observation,manifest_bytes,manifest_hash");
  const account = captureCanadaPostAccountBinding(v.account);
  need(
    account.orgId === n.orgId &&
      account.warehouseId === g.warehouse_id &&
      canadaPostConfigurationHash(account) === g.configuration_hash,
  );
  const sorted = n.members
    .map((m: any) => ({ bookingId: m.booking_id, reviewHash: m.review_hash }))
    .sort((a: any, b: any) => a.bookingId.localeCompare(b.bookingId));
  equal(n.orderedMembers, sorted);
  need(
    g.review_hash ===
      digest(
        canonical({
          configurationHash: g.configuration_hash,
          providerGroupId: g.provider_group_id,
          warehouseId: g.warehouse_id,
          entries: sorted,
        }),
      ),
  );
  fields(
    p,
    "version,purpose,orgId,region,currency,hold,warehouseId,proposed,configurationHash,memberReviewHash,scopeHash,references,blockers,reviewHash",
  );
  need(
    p.version === 1 &&
      p.purpose === "carrier-offline-proposed-reference-review-v1" &&
      p.orgId === n.orgId &&
      p.region === n.region &&
      p.currency === n.currency &&
      p.warehouseId === g.warehouse_id &&
      p.configurationHash === g.configuration_hash &&
      p.memberReviewHash === n.reviewHash,
  );
  equal(p.hold, n.hold);
  hash(p.scopeHash);
  signedShape(p, "reviewHash");
  fields(p.proposed, "groupId,bookingId,providerShipmentId,tracking");
  need(
    p.proposed.groupId === n.groupId && p.proposed.bookingId === n.bookingId,
  );
  fields(p.references, "members,bookings,promotedCopies,distinct");
  for (const k of ["members", "bookings", "promotedCopies", "distinct"])
    integer(p.references[k], 0, 1024);
  need(
    p.references.members >= count - 1 &&
      p.references.members <= 512 &&
      p.references.bookings <= 512 &&
      p.references.promotedCopies <=
        Math.min(p.references.members, p.references.bookings) &&
      p.references.distinct ===
        p.references.members +
          p.references.bookings -
          p.references.promotedCopies,
  );
  equal(
    p.blockers,
    [
      ...n.blockers,
      "NATIVE_REFERENCE_MATCH_ONLY_NO_RESERVATION",
      "PROVIDER_ACCOUNT_EQUIVALENCE_AND_EXTERNAL_REFERENCES_UNQUALIFIED",
    ].sort(),
  );
  for (const [rows, key] of [
    [n.members, "booking_id"],
    [n.bookingHistory, "id"],
    [n.preparations, "bookingId"],
    [v.members, "bookingId"],
    [v.platform, "bookingId"],
  ] as const)
    unique(rows, (r: any) => r[key]);
  unique(v.custody, (r: any) => r.shipment?.id);
  unique(n.bookingHistory, (r: any) => String(r.sequence));
  const outputs: {
    bookingId: string;
    reviewHash: string;
    shipmentId: string;
    providerShipmentId: string;
    tracking: string;
    customerRequestId: string;
    bodyHash: string;
    labelHash: string;
    labelBytes: number;
    custodyHash: string;
  }[] = [];
  for (const m of n.members) {
    fields(
      m,
      "group_id,booking_id,org_id,review_hash,active,state,token,started_at,provider_shipment_id,tracking,label_bytes,label_hash",
    );
    text(m.booking_id);
    hash(m.review_hash);
    need(m.group_id === g.id && m.org_id === n.orgId && m.active === 1);
    need(m.state === (m.booking_id === n.bookingId ? "unknown" : "created"));
    nulls(m, "token,started_at");
    const b = n.bookingHistory.find((b: any) => b.id === m.booking_id),
      prep = n.preparations.find((r: any) => r.bookingId === m.booking_id),
      e = v.members.find((r: any) => r.bookingId === m.booking_id);
    fields(
      b,
      "sequence,id,org_id,shipment_id,state,review_hash,intent,token,started_at,reference,tracking,label_bytes,label_type,label_hash,error,created_at",
    );
    integer(b.sequence, 1);
    instant(b.created_at);
    need(
      b.org_id === n.orgId &&
        b.state === "pending" &&
        b.review_hash === m.review_hash,
    );
    nulls(
      b,
      "token,started_at,reference,tracking,label_bytes,label_type,label_hash,error",
    );
    fields(prep, "bookingId,intent,intentHash");
    const intent = prep.intent;
    fields(
      intent,
      "shipmentId,previousId,provider,service,origin,destination,parcel,reviewedDestination,acknowledgment,configurationHash,configuration,nativeSnapshot,bookingId,reviewHash",
    );
    need(
      intent.previousId === null &&
        intent.provider === "canada-post" &&
        intent.bookingId === b.id &&
        intent.reviewHash === b.review_hash &&
        intent.shipmentId === b.shipment_id,
    );
    need(
      typeof b.intent === "string" &&
        Buffer.byteLength(b.intent) <= 65536 &&
        b.intent === canonical(intent) &&
        prep.intentHash === digest(b.intent),
    );
    text(intent.service, 100);
    text(intent.reviewedDestination, 8000);
    text(intent.acknowledgment, 1000);
    address(intent.origin);
    address(intent.destination);
    fields(intent.parcel, "weightGrams,lengthMm,widthMm,heightMm");
    for (const k of Object.keys(intent.parcel))
      integer(intent.parcel[k], 1, 30000);
    const configuration = captureCarrierConfiguration(
      intent.configuration,
      "canada-post",
    );
    need(
      configuration.hash === g.configuration_hash &&
        intent.configurationHash === g.configuration_hash &&
        configuration.services.some((s) => s.service === intent.service),
    );
    // The owning reader requires an identical origin AND display configuration
    // across this group. Coherent per-member hashes alone do not enforce this.
    equal(intent.origin, n.preparations[0].intent.origin);
    equal(intent.configuration, n.preparations[0].intent.configuration);
    shipment(intent.nativeSnapshot);
    need(
      intent.nativeSnapshot.id === b.shipment_id &&
        intent.nativeSnapshot.org_id === n.orgId &&
        intent.nativeSnapshot.warehouse_id === g.warehouse_id &&
        intent.nativeSnapshot.address === intent.reviewedDestination,
    );
    const c = v.custody.find((r: any) => r.shipment.id === b.shipment_id);
    fields(c, "version,shipment,allocations,history,custodyHash");
    need(c.version === "fulfillment-packed-carrier-custody/v1");
    signedShape(c, "custodyHash");
    equal(c.shipment, intent.nativeSnapshot);
    equal(c.history, { coverage: 0, delivery: 0, deliveryObservations: 0 });
    list(c.allocations);
    need(c.allocations.length > 0);
    unique(c.allocations, (a: any) => a.allocationId);
    for (const a of c.allocations) {
      fields(a, "allocationId,quantity");
      text(a.allocationId);
      integer(a.quantity, 1, 100000);
    }
    need(JSON.stringify(c.allocations) === c.shipment.lines);
    fields(
      e,
      "bookingId,reviewHash,configurationHash,groupId,customerRequestId,shipmentId,tracking,status,details,label",
    );
    const request = reviewCanadaPostShipment(
      account,
      intent as CarrierIntent,
      g.provider_group_id,
      g.configuration_hash,
    );
    need(
      e.reviewHash === m.review_hash &&
        e.configurationHash === g.configuration_hash &&
        e.groupId === g.provider_group_id &&
        e.customerRequestId === request.customerRequestId &&
        e.status === "created",
    );
    need(
      typeof e.shipmentId === "string" &&
        /^[A-Za-z0-9_-]{1,32}$/.test(e.shipmentId) &&
        typeof e.tracking === "string" &&
        /^\d{11,16}$/.test(e.tracking),
    );
    // Exact supported schema is the existing helper's ordinary domestic full
    // deliverySpec. Provider extensions are refused, never silently ignored.
    const details = e.details;
    fields(
      details,
      account.shippingPoint.kind === "pickup"
        ? "customerRequestId,trackingPin,shipmentStatus,cpcPickupIndicator,finalShippingPoint,shipmentDetail"
        : "customerRequestId,trackingPin,shipmentStatus,shippingPointId,shipmentDetail",
    );
    fields(details.shipmentDetail, "groupId,deliverySpec");
    equal(details.shipmentDetail.deliverySpec, request.body.deliverySpec);
    captureCanadaPostShipmentDetails(
      account,
      request,
      { tracking: e.tracking, status: "created" },
      details,
    );
    pdf(e.label);
    if (m.state === "created") {
      pdf(m.label_bytes);
      need(
        m.provider_shipment_id === e.shipmentId &&
          m.tracking === e.tracking &&
          m.label_hash === e.label.sha256,
      );
      equal(m.label_bytes, e.label);
    } else {
      nulls(m, "provider_shipment_id,tracking,label_bytes,label_hash");
      need(
        p.proposed.providerShipmentId === e.shipmentId &&
          p.proposed.tracking === e.tracking,
      );
    }
    outputs.push({
      bookingId: m.booking_id,
      reviewHash: m.review_hash,
      shipmentId: b.shipment_id,
      providerShipmentId: e.shipmentId,
      tracking: e.tracking,
      customerRequestId: e.customerRequestId,
      bodyHash: digest(canonical(request.body)),
      labelHash: e.label.sha256,
      labelBytes: e.label.bytes,
      custodyHash: c.custodyHash,
    });
  }
  need(outputs.some((o) => o.bookingId === n.bookingId));
  for (const key of [
    "shipmentId",
    "providerShipmentId",
    "tracking",
    "customerRequestId",
  ] as const)
    unique(outputs, (o) => o[key]);
  platform(v.platform, n, g, outputs);
  const body = {
    version: 1 as const,
    purpose: "canada-post-offline-member-consistency-v1" as const,
    orgId: n.orgId as string,
    region: "CA" as const,
    currency: n.currency as "CAD" | "USD",
    groupId: n.groupId as string,
    bookingId: n.bookingId as string,
    nativeReviewHash: n.reviewHash as string,
    proposedReferenceHash: p.reviewHash as string,
    configurationHash: g.configuration_hash as string,
    platformFactsHashes: (
      v.platform as { bookingId: string; factsHash: string }[]
    )
      .map((r: any) => ({
        bookingId: r.bookingId as string,
        factsHash: r.factsHash as string,
      }))
      .sort((a: any, b: any) => a.bookingId.localeCompare(b.bookingId)),
    members: outputs.sort((a, b) => a.bookingId.localeCompare(b.bookingId)),
    blockers: [
      ...new Set<string>([
        ...n.blockers,
        ...p.blockers,
        ...platformBlockers,
        "CALLER_COPIES_REQUIRE_FRESH_NATIVE_JOINS",
        "PRIVATE_CAPTURE_AND_QUALIFIED_COORDINATOR_REQUIRED",
      ]),
    ].sort(),
    inputHash: digest(
      canonical({
        purpose: "canada-post-offline-member-captured-input-v1",
        input: v,
      }),
    ),
  };
  return frozen({ ...body, comparisonHash: digest(canonical(body)) });
}

function platform(
  views: any[],
  n: Data,
  g: Data,
  members: {
    bookingId: string;
    reviewHash: string;
    shipmentId: string;
    providerShipmentId: string;
    labelHash: string;
  }[],
) {
  // Each member needs its own native projection: a target-only projection omits
  // sibling preparation receipts. Exact duplicate group rows must agree.
  const audits = new Map<string, any>(),
    events = new Map<string, any>(),
    commands = new Map<string, any>();
  for (const v of views) {
    fields(
      v,
      "version,purpose,orgId,groupId,bookingId,history,commands,audits,events,blockers,factsHash",
    );
    need(
      v.version === 1 &&
        v.purpose === "distributor-platform-offline-carrier-review-v1" &&
        v.orgId === n.orgId &&
        v.groupId === g.id &&
        members.some((m) => m.bookingId === v.bookingId),
    );
    fields(v.history, "commands,audits,events,hash");
    integer(v.history.commands, 2, 1000);
    integer(v.history.audits, 4, 4000);
    integer(v.history.events, 2, 2000);
    hash(v.history.hash);
    equal(v.history, views[0].history);
    equal([...v.blockers].sort(), platformBlockers);
    signedShape(v, "factsHash");
    list(v.commands, 2);
    list(v.audits, 2 + members.length * 2);
    list(v.events, 2 + members.length);
    need(
      v.commands.length === 2 &&
        v.history.commands >= members.length + 1 &&
        v.history.audits >= 3 * members.length + 1 &&
        v.history.events >= 2 * members.length,
    );
    unique(v.audits, (a: any) => a.id);
    unique(v.events, (e: any) => e.id);
    for (const a of v.audits) {
      fields(
        a,
        "id,actorId,action,reference,detail,detailJson,createdAt,sequence",
      );
      text(a.id);
      text(a.actorId);
      text(a.action);
      text(a.reference);
      instant(a.createdAt);
      integer(a.sequence, 1);
      need(a.detailJson === canonical(a.detail));
      if (audits.has(a.id)) equal(audits.get(a.id), a);
      else audits.set(a.id, a);
    }
    for (const r of v.commands) {
      fields(
        r,
        "actorId,command,key,requestHash,result,resultJson,createdAt,audit",
      );
      text(r.actorId);
      text(r.key);
      hash(r.requestHash);
      instant(r.createdAt);
      fields(r.result, "id,reviewHash");
      hash(r.result.reviewHash);
      need(
        (r.command === "carrier.prepare" && r.result.id === v.bookingId) ||
          (r.command === "carrier.canada-post.group.prepare" &&
            r.result.id === g.id),
      );
      need(r.resultJson === JSON.stringify(r.result));
      const a = audits.get(r.audit.id);
      need(a);
      equal(a, r.audit);
      need(
        a.actorId === r.actorId &&
          a.action === r.command &&
          a.reference === r.key,
      );
      equal(a.detail, { requestHash: r.requestHash });
      const key = r.result.id;
      if (commands.has(key)) equal(commands.get(key), r);
      else commands.set(key, r);
    }
    for (const e of v.events) {
      fields(e, "id,type,reference,version,payload,payloadJson,createdAt");
      text(e.id);
      text(e.type);
      text(e.reference);
      instant(e.createdAt);
      need(e.version === 1 && e.payloadJson === canonical(e.payload));
      if (events.has(e.id)) equal(events.get(e.id), e);
      else events.set(e.id, e);
    }
  }
  need(
    commands.size === members.length + 1 &&
      audits.size === 3 * members.length + 1 &&
      events.size === 2 * members.length,
  );
  unique([...audits.values()], (a) => String(a.sequence));
  const consumedAudits = new Set<string>(),
    consumedEvents = new Set<string>();
  const event = (type: string, reference: string, payload: any) => {
    const found = [...events.values()].filter(
      (e) => e.type === type && e.reference === reference,
    );
    // Created events share a group reference: select exact full member payload.
    const matches = found.filter(
      (e) => canonical(e.payload) === canonical(payload),
    );
    need(matches.length === 1 && !consumedEvents.has(matches[0].id));
    consumedEvents.add(matches[0].id);
  };
  const group = commands.get(g.id);
  need(group && group.result.reviewHash === g.review_hash);
  consumedAudits.add(group.audit.id);
  event("carrier.canada-post.group.prepared", g.id, {
    reviewHash: g.review_hash,
    warehouseId: g.warehouse_id,
    count: members.length,
  });
  let unknownSequence = 0;
  for (const m of members) {
    const r = commands.get(m.bookingId);
    need(
      r &&
        r.result.reviewHash === m.reviewHash &&
        r.audit.sequence < group.audit.sequence,
    );
    consumedAudits.add(r.audit.id);
    event("carrier.booking.prepared", m.bookingId, {
      shipmentId: m.shipmentId,
      reviewHash: m.reviewHash,
      provider: "canada-post",
    });
    const related = [...audits.values()]
      .filter((a) => a.reference === g.id && a.detail.bookingId === m.bookingId)
      .sort((a, b) => a.sequence - b.sequence);
    need(related.length === 2);
    const [claim, completion] = related;
    need(
      claim.action === "carrier.canada-post.member.claimed" &&
        group.audit.sequence < claim.sequence,
    );
    equal(claim.detail, {
      bookingId: m.bookingId,
      reviewHash: m.reviewHash,
      send: true,
    });
    need(completion.actorId === claim.actorId);
    consumedAudits.add(claim.id);
    consumedAudits.add(completion.id);
    if (m.bookingId === n.bookingId) {
      need(completion.action === "carrier.canada-post.member.unknown");
      equal(completion.detail, {
        bookingId: m.bookingId,
        reviewHash: m.reviewHash,
      });
      unknownSequence = claim.sequence;
    } else {
      need(completion.action === "carrier.canada-post.member.created");
      equal(completion.detail, {
        bookingId: m.bookingId,
        reviewHash: m.reviewHash,
        reconciled: false,
        groupState: "creating",
        labelHash: m.labelHash,
      });
      event("carrier.canada-post.member.created", g.id, {
        bookingId: m.bookingId,
        reviewHash: m.reviewHash,
        shipmentId: m.providerShipmentId,
      });
    }
  }
  need(unknownSequence > 0);
  for (const a of audits.values())
    if (a.action === "carrier.canada-post.member.created")
      need(a.sequence < unknownSequence);
  need(
    consumedAudits.size === audits.size && consumedEvents.size === events.size,
  );
  // Every view must include exactly all group history and its selected booking
  // preparation, rather than allowing fabricated disjoint incomplete pages.
  for (const v of views) {
    equal(
      v.audits.map((a: any) => a.id).sort(),
      [...audits.values()]
        .filter(
          (a) =>
            a.reference === g.id ||
            a.id === commands.get(g.id).audit.id ||
            a.id === commands.get(v.bookingId).audit.id,
        )
        .map((a) => a.id)
        .sort(),
    );
    equal(
      v.events.map((e: any) => e.id).sort(),
      [...events.values()]
        .filter((e) => e.reference === g.id || e.reference === v.bookingId)
        .map((e) => e.id)
        .sort(),
    );
  }
}
