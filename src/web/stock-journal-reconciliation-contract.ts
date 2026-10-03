import type {
  IntegrationCosts,
  CostPacketView,
} from "../server/integration-costs.ts";
import type {
  JournalReconciliationInput,
  JournalReconciliationSnapshot,
} from "../server/stock-journal-reconciliation.ts";
export type Review = ReturnType<IntegrationCosts["journalReconciliation"]>;
export type Attempt = {
  key: string;
  snapshot: JournalReconciliationSnapshot;
  payload: JournalReconciliationInput;
};
export const storageError =
  "Original reconciliation recovery evidence is unavailable. Restore browser storage and reconcile the retained attempt before another confirmation.";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string) =>
  object(v) && Object.keys(v).sort().join() === names;
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 1;
const numeric = (v: unknown) =>
  typeof v === "string" && /^[1-9][0-9]{0,29}$/.test(v);
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function sha(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function snapshot(review: Review): JournalReconciliationSnapshot {
  const {
    reviewHash: _hash,
    issues: _issues,
    accepted: _accepted,
    superseded: _superseded,
    canConfirm: _can,
    ...fixed
  } = review;
  return fixed;
}
function validSnapshot(v: JournalReconciliationSnapshot, orgId: string) {
  if (
    !keys(
      v,
      "contentHash,credit,currency,dates,debit,organizationId,packetId,receiverRef,region,version",
    ) ||
    v.version !== 1 ||
    v.organizationId !== orgId ||
    !text(v.packetId) ||
    !hash(v.contentHash) ||
    !["CA", "US"].includes(v.region) ||
    !["CAD", "USD"].includes(v.currency) ||
    !integer(v.debit) ||
    v.debit !== v.credit ||
    !Array.isArray(v.dates) ||
    !v.dates.length ||
    v.dates.length > 500
  )
    return false;
  let total = 0n;
  const ids = new Set<string>(),
    companies = new Set<string>();
  for (const [i, d] of v.dates.entries()) {
    if (
      !keys(d, "credit,debit,journal,postingDate") ||
      !date(d.postingDate) ||
      (i > 0 && v.dates[i - 1]!.postingDate >= d.postingDate) ||
      !integer(d.debit) ||
      d.credit !== d.debit
    )
      return false;
    total += BigInt(d.debit);
    const j = d.journal;
    if (j === null) continue;
    if (
      !keys(
        j,
        "bindingId,historyHash,id,posted,realm,requestRef,reviewHash,state",
      ) ||
      !text(j.id) ||
      ids.has(j.id) ||
      !text(j.bindingId) ||
      !hash(j.reviewHash) ||
      !hash(j.historyHash) ||
      !numeric(j.realm) ||
      !/^DJ-[a-f0-9]{18}$/.test(j.requestRef) ||
      ![
        "ready",
        "pending",
        "running",
        "unknown",
        "posted",
        "cancelled",
      ].includes(j.state)
    )
      return false;
    ids.add(j.id);
    companies.add(canonical([j.realm, j.bindingId]));
    const p = j.posted;
    if (p === null) {
      if (j.state === "posted") return false;
    } else if (
      !keys(
        p,
        "externalId,observationHash,recordedAt,recordedBy,revision,syncToken",
      ) ||
      j.state !== "posted" ||
      !numeric(p.externalId) ||
      typeof p.syncToken !== "string" ||
      !/^[0-9]{1,2000}$/.test(p.syncToken) ||
      !hash(p.observationHash) ||
      !integer(p.revision) ||
      !text(p.recordedBy) ||
      !text(p.recordedAt, 100) ||
      !Number.isFinite(Date.parse(p.recordedAt))
    )
      return false;
  }
  const first = v.dates.find((d) => d.journal)?.journal;
  return (
    total === BigInt(v.debit) &&
    v.receiverRef ===
      (companies.size === 1 ? `quickbooks-sandbox:${first!.realm}` : null)
  );
}
export async function checkedReview(
  raw: unknown,
  orgId: string,
  packetId: string,
  actorId: string,
): Promise<Review> {
  const v = raw as Review;
  if (
    !keys(
      v,
      "accepted,canConfirm,contentHash,credit,currency,dates,debit,issues,organizationId,packetId,receiverRef,region,reviewHash,superseded,version",
    ) ||
    !validSnapshot(snapshot(v), orgId) ||
    v.packetId !== packetId ||
    !hash(v.reviewHash) ||
    typeof v.accepted !== "boolean" ||
    typeof v.superseded !== "boolean" ||
    typeof v.canConfirm !== "boolean" ||
    !Array.isArray(v.issues) ||
    v.issues.length > 1002 ||
    !v.issues.every(
      (i) =>
        keys(i, "code,message") && text(i.code, 100) && text(i.message, 2000),
    ) ||
    v.canConfirm !== (!v.accepted && !v.superseded && v.issues.length === 0) ||
    (v.canConfirm &&
      (!v.receiverRef ||
        v.dates.some(
          (d) => !d.journal?.posted || d.journal.posted.recordedBy === actorId,
        ))) ||
    (await sha(snapshot(v))) !== v.reviewHash
  )
    throw Error(
      "The original reconciliation review could not be verified. Reload its complete date evidence.",
    );
  return v;
}
export function parse(raw: string, orgId: string): Attempt {
  if (raw.length > 1048576) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt,
    p = a?.payload;
  if (
    !keys(a, "key,payload,snapshot") ||
    typeof a.key !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      a.key,
    ) ||
    !validSnapshot(a.snapshot, orgId) ||
    !a.snapshot.receiverRef ||
    !keys(
      p,
      "confirmation,contentHash,externalRef,journals,packetId,reason,reviewHash",
    ) ||
    p.packetId !== a.snapshot.packetId ||
    p.contentHash !== a.snapshot.contentHash ||
    !hash(p.reviewHash) ||
    !text(p.externalRef) ||
    !text(p.reason, 2000) ||
    p.confirmation !== "all-dates-reconciled" ||
    !Array.isArray(p.journals) ||
    p.journals.length !== a.snapshot.dates.length ||
    !p.journals.every((row, i) => {
      const d = a.snapshot.dates[i]!,
        j = d.journal,
        posted = j?.posted;
      return (
        keys(
          row,
          "credit,debit,evidenceRef,externalId,journalId,postingDate,syncToken",
        ) &&
        posted &&
        row.journalId === j.id &&
        row.postingDate === d.postingDate &&
        row.externalId === posted.externalId &&
        row.syncToken === posted.syncToken &&
        row.debit === d.debit &&
        row.credit === d.credit &&
        text(row.evidenceRef, 1000)
      );
    }) ||
    new TextEncoder().encode(JSON.stringify(p)).length > 256 * 1024
  )
    throw Error(storageError);
  return a;
}
export function retained(storageKey: string, orgId: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    return { attempt: raw === null ? null : parse(raw, orgId), error: "" };
  } catch {
    return { attempt: null, error: storageError };
  }
}
export async function validReceipt(raw: unknown, a: Attempt, actorId: string) {
  if (!object(raw)) return false;
  const v = raw as unknown as CostPacketView,
    r = v.receipt;
  return (
    v.id === a.payload.packetId &&
    v.state === "accepted" &&
    v.contentHash === a.payload.contentHash &&
    v.region === a.snapshot.region &&
    v.currency === a.snapshot.currency &&
    v.controls?.debit === a.snapshot.debit &&
    v.controls.credit === a.snapshot.credit &&
    keys(
      r,
      "contentHash,credit,debit,externalRef,nativeReconciliation,reason,receiverRef,receiverRegion,recordedAt,recordedBy",
    ) &&
    r?.receiverRef === a.snapshot.receiverRef &&
    r.receiverRegion === a.snapshot.region &&
    r.contentHash === a.payload.contentHash &&
    r.debit === a.snapshot.debit &&
    r.credit === a.snapshot.credit &&
    r.externalRef === a.payload.externalRef &&
    r.reason === a.payload.reason &&
    r.recordedBy === actorId &&
    text(r.recordedAt, 100) &&
    Number.isFinite(Date.parse(r.recordedAt)) &&
    keys(r.nativeReconciliation, "journals,reviewHash,snapshot") &&
    r.nativeReconciliation?.reviewHash === a.payload.reviewHash &&
    canonical(r.nativeReconciliation.snapshot) === canonical(a.snapshot) &&
    canonical(r.nativeReconciliation.journals) ===
      canonical(a.payload.journals) &&
    (await sha(a.snapshot)) === a.payload.reviewHash
  );
}
