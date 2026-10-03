import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import type {
  LedgerAuthority,
  LedgerDisclosure,
} from "../server/organization-residency.ts";
import type {
  JournalPermissionInput,
  JournalPermissionDecision,
  PermissionReview,
} from "../server/stock-journal-permissions.ts";
type Observation = PermissionReview["observation"];

export type Journal = ReturnType<StockJournalDelivery["detail"]>;
export type Selection = Pick<
  Journal,
  | "id"
  | "sourceId"
  | "sourceHash"
  | "leg"
  | "postingDate"
  | "attemptId"
  | "bindingId"
  | "realm"
  | "reviewHash"
  | "requestRef"
  | "plan"
>;
export type Prospect = {
  selection: Selection;
  previousAuthority: LedgerAuthority;
  previousPermissionHash: string;
  authority: LedgerAuthority;
  mode: "write" | "lookup";
  disclosure: LedgerDisclosure;
};
export type History = ReturnType<StockJournalDelivery["permissionHistory"]>;
export type Attempt = {
  key: string;
  selection: Selection;
  disclosure: LedgerDisclosure;
} & (
  | {
      kind: "prepare";
      previousAuthority: LedgerAuthority;
      payload: JournalPermissionInput;
    }
  | {
      kind: "decide";
      prepared: PermissionReview;
      payload: JournalPermissionDecision;
    }
);
export const recoveryError =
  "Journal permission recovery evidence is unavailable. Restore browser storage and reconcile the original attempt before another submission.";
export const canonical = (value: unknown) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export async function hash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function assert(value: unknown): asserts value {
  if (!value)
    throw Error(
      "Journal permission evidence could not be confirmed. Retain the original attempt and reconcile it.",
    );
}
export const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function exact(v: unknown, fields: string): asserts v is Record<string, any> {
  assert(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).sort().join() === fields.split(",").sort().join(),
  );
}
function authority(a: unknown, orgId: string): asserts a is LedgerAuthority {
  exact(
    a,
    "provider,purpose,environment,orgId,region,realm,revision,disclosureId,disclosureHash",
  );
  assert(
    a.provider === "quickbooks" &&
      a.purpose === "stock-cost-journal" &&
      a.environment === "sandbox" &&
      a.orgId === orgId &&
      ["CA", "US"].includes(a.region) &&
      typeof a.realm === "string" &&
      /^[1-9][0-9]{0,29}$/.test(a.realm) &&
      integer(a.revision) &&
      text(a.disclosureId) &&
      hex(a.disclosureHash),
  );
}
function scope(a: LedgerAuthority) {
  const { revision: _r, disclosureId: _i, disclosureHash: _h, ...rest } = a;
  return rest;
}
export async function selection(
  j: Selection,
  orgId: string,
): Promise<Selection> {
  const s = {
    id: j.id,
    sourceId: j.sourceId,
    sourceHash: j.sourceHash,
    leg: j.leg,
    postingDate: j.postingDate,
    attemptId: j.attemptId,
    bindingId: j.bindingId,
    realm: j.realm,
    reviewHash: j.reviewHash,
    requestRef: j.requestRef,
    plan: j.plan,
  };
  await validSelection(s, orgId);
  return s;
}
async function validSelection(s: Selection, orgId: string) {
  exact(
    s,
    "id,sourceId,sourceHash,leg,postingDate,attemptId,bindingId,realm,reviewHash,requestRef,plan",
  );
  assert(
    text(s.id) &&
      text(s.sourceId) &&
      hex(s.sourceHash) &&
      ["original", "reversal", "replacement"].includes(s.leg) &&
      typeof s.postingDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s.postingDate) &&
      (s.attemptId === null || text(s.attemptId)) &&
      text(s.bindingId) &&
      hex(s.reviewHash) &&
      typeof s.requestRef === "string" &&
      /^DJ-[a-f0-9]{18}$/.test(s.requestRef),
  );
  const retry = s.leg === "original" && s.attemptId !== null;
  exact(
    s.plan,
    retry ? "input,intent,policyHash,predecessor" : "input,intent,policyHash",
  );
  if (retry) {
    const p = s.plan.predecessor;
    exact(p, "journalId,reviewHash,cancellationHash,historyHash");
    assert(
      p.journalId === s.attemptId &&
        p.journalId !== s.id &&
        hex(p.reviewHash) &&
        hex(p.cancellationHash) &&
        hex(p.historyHash),
    );
  }
  assert(hex(s.plan.policyHash) && (await hash(s.plan)) === s.reviewHash);
  const i = s.plan.input,
    intent = s.plan.intent;
  authority(i?.authority, orgId);
  assert(
    i.sourceId === s.sourceId &&
      i.sourceHash === s.sourceHash &&
      i.leg === s.leg &&
      i.postingDate === s.postingDate &&
      i.attemptId === s.attemptId &&
      i.bindingId === s.bindingId &&
      i.realm === s.realm &&
      i.authority.realm === s.realm &&
      intent?.organizationId === orgId &&
      intent.realmId === s.realm &&
      intent.source?.hash === s.sourceHash,
  );
}
export async function disclosure(d: LedgerDisclosure, a: LedgerAuthority) {
  exact(
    d,
    "provider,purpose,environment,orgId,region,version,purposes,minimumData,processingCountries,subprocessors,retention,withdrawal,termsReference,reviewEvidence,id,hash,createdBy,createdAt",
  );
  const { id, hash: h, createdBy, createdAt, ...terms } = d;
  assert(
    id === a.disclosureId &&
      h === a.disclosureHash &&
      text(createdBy) &&
      text(createdAt, 100) &&
      d.orgId === a.orgId &&
      d.region === a.region &&
      d.provider === a.provider &&
      d.purpose === a.purpose &&
      d.environment === a.environment,
  );
  for (const k of [
    "version",
    "purposes",
    "retention",
    "withdrawal",
    "termsReference",
    "reviewEvidence",
  ] as const)
    assert(text(d[k], 10000));
  for (const k of [
    "minimumData",
    "processingCountries",
    "subprocessors",
  ] as const)
    assert(
      Array.isArray(d[k]) &&
        (k === "subprocessors" || d[k].length > 0) &&
        d[k].length <= 30 &&
        d[k].every((v) => text(v, 2000)),
    );
  assert(
    d.processingCountries.every((v) => /^[A-Z]{2}$/.test(v)) &&
      (await hash(terms)) === h,
  );
}
function input(p: JournalPermissionInput, s: Selection, orgId: string) {
  exact(p, "journalId,reviewHash,previousPermissionHash,authority,mode,reason");
  authority(p.authority, orgId);
  assert(
    p.journalId === s.id &&
      p.reviewHash === s.reviewHash &&
      hex(p.previousPermissionHash) &&
      ["write", "lookup"].includes(p.mode) &&
      text(p.reason, 2000) &&
      canonical(scope(p.authority)) ===
        canonical(scope(s.plan.input.authority)),
  );
}
function decision(
  p: JournalPermissionDecision,
  r: PermissionReview,
  s: Selection,
) {
  exact(p, "journalId,permissionReviewId,permissionReviewHash,decision,reason");
  assert(
    p.journalId === s.id &&
      p.permissionReviewId === r.id &&
      p.permissionReviewHash === r.reviewHash &&
      ["approve", "reject"].includes(p.decision) &&
      text(p.reason, 2000),
  );
}
export async function observation(o: Observation, s: Selection, orgId: string) {
  exact(o, "revision,hash,body,recordedBy,recordedAt");
  assert(
    integer(o.revision) &&
      hex(o.hash) &&
      text(o.recordedBy) &&
      text(o.recordedAt, 100) &&
      (await hash({
        journalId: s.id,
        orgId,
        revision: o.revision,
        body: o.body,
        recordedBy: o.recordedBy,
        recordedAt: o.recordedAt,
      })) === o.hash,
  );
}
export async function prepared(
  r: PermissionReview,
  s: Selection,
  orgId: string,
) {
  exact(r, "id,input,reviewHash,observation,decision");
  assert(text(r.id) && hex(r.reviewHash));
  input(r.input, s, orgId);
  assert((await hash(r.input)) === r.reviewHash);
  await observation(r.observation, s, orgId);
  assert(
    canonical(r.observation.body) ===
      canonical({
        kind: "permission-replacement.review",
        version: 1,
        id: r.id,
        input: r.input,
        reviewHash: r.reviewHash,
      }),
  );
  if (r.decision !== null) {
    await observation(r.decision, s, orgId);
    const body = r.decision.body as {
      kind: string;
      version: number;
      input: JournalPermissionDecision;
    };
    exact(body, "kind,version,input");
    assert(
      body.kind === "permission-replacement.decision" &&
        body.version === 1 &&
        r.decision.recordedBy !== r.observation.recordedBy &&
        r.decision.revision > r.observation.revision,
    );
    decision(body.input, r, s);
  }
}
export async function prospect(
  value: ReturnType<StockJournalDelivery["permissionReview"]>,
  expected: Journal,
  orgId: string,
): Promise<Prospect> {
  exact(
    value,
    "journal,previousAuthority,previousPermissionHash,authority,mode,disclosure",
  );
  const s = await selection(value.journal, orgId),
    target = await selection(expected, orgId);
  assert(canonical(s) === canonical(target));
  authority(value.previousAuthority, orgId);
  authority(value.authority, orgId);
  assert(
    canonical(scope(value.previousAuthority)) ===
      canonical(scope(s.plan.input.authority)) &&
      canonical(scope(value.authority)) ===
        canonical(scope(value.previousAuthority)) &&
      canonical(value.authority) !== canonical(value.previousAuthority) &&
      (await hash(value.previousAuthority)) === value.previousPermissionHash &&
      ["write", "lookup"].includes(value.mode),
  );
  await disclosure(value.disclosure, value.authority);
  return {
    selection: s,
    previousAuthority: value.previousAuthority,
    previousPermissionHash: value.previousPermissionHash,
    authority: value.authority,
    mode: value.mode,
    disclosure: value.disclosure,
  };
}
export async function history(
  h: History,
  s: Selection,
  orgId: string,
  reviewId?: string,
) {
  exact(h, "journalId,reviewHash,authority,mode,reviews,olderReviews");
  authority(h.authority, orgId);
  assert(
    h.journalId === s.id &&
      h.reviewHash === s.reviewHash &&
      canonical(scope(h.authority)) ===
        canonical(scope(s.plan.input.authority)) &&
      ["write", "lookup"].includes(h.mode) &&
      typeof h.olderReviews === "boolean" &&
      Array.isArray(h.reviews) &&
      h.reviews.length <= 20 &&
      new Set(h.reviews.map((r) => r.id)).size === h.reviews.length,
  );
  if (reviewId)
    assert(
      h.reviews.length === 1 &&
        h.reviews[0]!.id === reviewId &&
        !h.olderReviews,
    );
  for (const r of h.reviews) await prepared(r, s, orgId);
}
export function parse(raw: string): Attempt {
  try {
    assert(raw.length <= 1_048_576);
    const a = JSON.parse(raw) as Attempt;
    exact(
      a,
      a?.kind === "prepare"
        ? "key,selection,disclosure,kind,previousAuthority,payload"
        : "key,selection,disclosure,kind,prepared,payload",
    );
    assert(
      ["prepare", "decide"].includes(a.kind) &&
        typeof a.key === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          a.key,
        ),
    );
    return a;
  } catch {
    throw Error(recoveryError);
  }
}
export async function attempt(a: Attempt, orgId: string, actorId: string) {
  await validSelection(a.selection, orgId);
  if (a.kind === "prepare") {
    input(a.payload, a.selection, orgId);
    authority(a.previousAuthority, orgId);
    assert(
      canonical(scope(a.previousAuthority)) ===
        canonical(scope(a.payload.authority)) &&
        canonical(a.previousAuthority) !== canonical(a.payload.authority) &&
        (await hash(a.previousAuthority)) === a.payload.previousPermissionHash,
    );
    await disclosure(a.disclosure, a.payload.authority);
  } else {
    await prepared(a.prepared, a.selection, orgId);
    assert(
      a.prepared.decision === null &&
        a.prepared.observation.recordedBy !== actorId,
    );
    decision(a.payload, a.prepared, a.selection);
    await disclosure(a.disclosure, a.prepared.input.authority);
  }
}
export async function receipt(
  value: unknown,
  a: Attempt,
  orgId: string,
  actorId: string,
) {
  if (a.kind === "prepare") {
    const r = value as PermissionReview;
    await prepared(r, a.selection, orgId);
    assert(
      canonical(r.input) === canonical(a.payload) &&
        r.observation.recordedBy === actorId &&
        r.decision === null,
    );
  } else {
    const o = value as Observation;
    await observation(o, a.selection, orgId);
    assert(
      o.recordedBy === actorId &&
        o.revision > a.prepared.observation.revision &&
        canonical(o.body) ===
          canonical({
            kind: "permission-replacement.decision",
            version: 1,
            input: a.payload,
          }),
    );
  }
}
