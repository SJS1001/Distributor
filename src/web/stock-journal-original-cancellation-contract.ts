import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import type {
  OriginalCancellationEvidenceInput,
  OriginalCancellationInput,
} from "../server/stock-journal-original-cancellation.ts";
import { canonical, sha } from "./stock-journal-reconciliation-contract.ts";
import {
  selection,
  type Journal,
} from "./stock-journal-permission-contract.ts";
export type EvidenceReview = ReturnType<
  StockJournalDelivery["originalCancellationEvidenceReview"]
>;
export type CancellationReview = ReturnType<
  StockJournalDelivery["originalCancellationReview"]
>;
export type Snapshot = EvidenceReview["snapshot"];
export type Proof = CancellationReview["evidence"];
export type Attempt = { key: string; snapshot: Snapshot } & (
  | {
      kind: "evidence";
      proof: null;
      payload: OriginalCancellationEvidenceInput;
    }
  | { kind: "cancel"; proof: Proof; payload: OriginalCancellationInput }
);
export const storageError =
  "Original cancellation recovery evidence is unavailable. Restore browser storage and reconcile the retained attempt before another submission.";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, expected: string) =>
  object(v) && Object.keys(v).sort().join() === expected;
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const time = (v: unknown) => text(v, 100) && Number.isFinite(Date.parse(v));
export function validSnapshot(v: Snapshot, orgId: string) {
  return (
    keys(
      v,
      "bindingId,credit,currency,debit,historyHash,journalId,orgId,postingDate,realm,region,requestRef,reviewHash,sourceHash,sourceId,version",
    ) &&
    v.version === 1 &&
    v.orgId === orgId &&
    text(v.journalId) &&
    text(v.sourceId) &&
    hash(v.sourceHash) &&
    hash(v.reviewHash) &&
    hash(v.historyHash) &&
    date(v.postingDate) &&
    typeof v.realm === "string" &&
    /^[1-9][0-9]{0,29}$/.test(v.realm) &&
    text(v.bindingId) &&
    /^DJ-[a-f0-9]{18}$/.test(v.requestRef) &&
    ["CA", "US"].includes(v.region) &&
    ["CAD", "USD"].includes(v.currency) &&
    integer(v.debit) &&
    v.credit === v.debit
  );
}
function validInput(p: OriginalCancellationEvidenceInput, s: Snapshot) {
  return (
    keys(
      p,
      "cancellationFinal,evidence,externalRef,journalId,noLaterPosting,nonPostingVerified,requestRef,reviewHash",
    ) &&
    p.journalId === s.journalId &&
    p.requestRef === s.requestRef &&
    hash(p.reviewHash) &&
    text(p.externalRef) &&
    text(p.evidence, 2000) &&
    p.cancellationFinal === true &&
    p.nonPostingVerified === true &&
    p.noLaterPosting === true
  );
}
function validProof(p: Proof, s: Snapshot) {
  return (
    keys(p, "evidenceHash,input,recordedAt,recordedBy,revision,snapshot") &&
    hash(p.evidenceHash) &&
    integer(p.revision) &&
    text(p.recordedBy) &&
    time(p.recordedAt) &&
    canonical(p.snapshot) === canonical(s) &&
    validInput(p.input, s)
  );
}
export function parse(raw: string, orgId: string): Attempt {
  if (raw.length > 32000) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt;
  if (
    !keys(a, "key,kind,payload,proof,snapshot") ||
    typeof a.key !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      a.key,
    ) ||
    !validSnapshot(a.snapshot, orgId)
  )
    throw Error(storageError);
  if (a.kind === "evidence") {
    if (a.proof !== null || !validInput(a.payload, a.snapshot))
      throw Error(storageError);
  } else if (
    a.kind !== "cancel" ||
    !validProof(a.proof, a.snapshot) ||
    !keys(a.payload, "evidenceHash,journalId,reason,requestRef") ||
    a.payload.journalId !== a.snapshot.journalId ||
    a.payload.requestRef !== a.snapshot.requestRef ||
    a.payload.evidenceHash !== a.proof.evidenceHash ||
    !text(a.payload.reason, 2000)
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
export async function checkedProof(p: Proof, s: Snapshot) {
  return (
    validProof(p, s) &&
    (await sha(s)) === p.input.reviewHash &&
    (await sha({
      journalId: s.journalId,
      orgId: s.orgId,
      revision: p.revision,
      body: {
        kind: "original-cancellation-evidence",
        input: p.input,
        snapshot: s,
      },
      recordedBy: p.recordedBy,
      recordedAt: p.recordedAt,
    })) === p.evidenceHash
  );
}
export async function checkedAttempt(
  a: Attempt,
  orgId: string,
  actorId: string,
) {
  parse(JSON.stringify(a), orgId);
  if (
    a.kind === "evidence"
      ? (await sha(a.snapshot)) !== a.payload.reviewHash
      : !(await checkedProof(a.proof, a.snapshot)) ||
        a.proof.recordedBy === actorId
  )
    throw Error(storageError);
  return a;
}
async function sameJournal(raw: unknown, s: Snapshot, state: string) {
  if (!object(raw)) return false;
  if (!(
    raw.id === s.journalId &&
    raw.leg === "original" &&
    raw.sourceId === s.sourceId &&
    raw.sourceHash === s.sourceHash &&
    raw.postingDate === s.postingDate &&
    raw.realm === s.realm &&
    raw.bindingId === s.bindingId &&
    raw.reviewHash === s.reviewHash &&
    raw.requestRef === s.requestRef &&
    raw.state === state &&
    raw.externalId === null &&
    raw.leaseStarted === null &&
    raw.leaseMode === null
  ))
    return false;
  try {
    // Includes strict original-retry predecessor shape, identity and plan hash.
    // The native owner independently verifies every retained ancestor/history.
    await selection(raw as Journal, s.orgId);
    return true;
  } catch {
    return false;
  }
}
export async function checkedEvidenceReview(
  raw: unknown,
  orgId: string,
  journalId: string,
) {
  const r = raw as EvidenceReview;
  if (
    !keys(r, "journal,reviewHash,snapshot") ||
    !validSnapshot(r.snapshot, orgId) ||
    r.snapshot.journalId !== journalId ||
    !(await sameJournal(r.journal, r.snapshot, "unknown")) ||
    (await sha(r.snapshot)) !== r.reviewHash
  )
    throw Error(
      "The original evidence review could not be verified. Reload the complete journal evidence.",
    );
  return r;
}
export async function checkedCancellationReview(
  raw: unknown,
  orgId: string,
  journalId: string,
  actorId: string,
) {
  const r = raw as CancellationReview;
  if (
    !keys(r, "canConfirm,evidence,journal") ||
    !validSnapshot(r.evidence?.snapshot, orgId) ||
    r.evidence.snapshot.journalId !== journalId ||
    !(await sameJournal(r.journal, r.evidence.snapshot, "unknown")) ||
    !(await checkedProof(r.evidence, r.evidence.snapshot)) ||
    r.canConfirm !== (r.evidence.recordedBy !== actorId)
  )
    throw Error(
      "The final original evidence could not be verified. Reload the complete cancellation evidence.",
    );
  return r;
}
export async function validReceipt(raw: unknown, a: Attempt, actorId: string) {
  if (!object(raw)) return false;
  if (a.kind === "evidence") {
    const r = raw as ReturnType<
      StockJournalDelivery["recordOriginalCancellationEvidence"]
    >;
    return (
      keys(r, "evidence,journal") &&
      (await sameJournal(r.journal, a.snapshot, "unknown")) &&
      validProof(r.evidence, a.snapshot) &&
      r.evidence.recordedBy === actorId &&
      canonical(r.evidence.input) === canonical(a.payload) &&
      (await checkedProof(r.evidence, a.snapshot))
    );
  }
  const r = raw as ReturnType<StockJournalDelivery["cancelOriginalAttempt"]>,
    c = r.cancellation;
  return (
    (await sameJournal(r, a.snapshot, "cancelled")) &&
    keys(c, "body,hash,recordedAt,recordedBy,revision") &&
    c.recordedBy === actorId &&
    time(c.recordedAt) &&
    c.revision === a.proof.revision + 1 &&
    canonical(c.body) ===
      canonical({
        outcome: "cancelled-unposted",
        evidenceHash: a.payload.evidenceHash,
        reason: a.payload.reason,
        requestRef: a.payload.requestRef,
      }) &&
    (await sha({
      journalId: a.snapshot.journalId,
      orgId: a.snapshot.orgId,
      revision: c.revision,
      body: c.body,
      recordedBy: c.recordedBy,
      recordedAt: c.recordedAt,
    })) === c.hash
  );
}
