import type {
  StockJournalDelivery,
  OriginalRetryInput,
} from "../server/stock-journal-delivery.ts";
import { canonical, sha } from "./stock-journal-reconciliation-contract.ts";
import {
  checkedProof,
  validSnapshot,
} from "./stock-journal-original-cancellation-contract.ts";
import { selection } from "./stock-journal-permission-contract.ts";
export type Review = ReturnType<StockJournalDelivery["originalRetryReview"]>;
export type Attempt = {
  key: string;
  review: Review;
  payload: OriginalRetryInput;
};
export const storageError =
  "Original retry recovery evidence is unavailable. Restore browser storage and reconcile the retained attempt before another submission.";
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, fields: string) =>
  object(v) && Object.keys(v).sort().join() === fields;
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && !!v && v.length <= max && v.trim() === v;
const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) => text(v, 100) && Number.isFinite(Date.parse(v));
async function digestText(v: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function assert(v: unknown): asserts v {
  if (!v)
    throw Error(
      "The original retry review could not be verified. Reload the complete cancelled journal evidence.",
    );
}
export function parse(raw: string, orgId: string): Attempt {
  if (raw.length > 8_388_608) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt;
  if (
    !keys(a, "key,payload,review") ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      a.key,
    ) ||
    !keys(a.payload, "journalId,reason,reviewHash") ||
    !validSnapshot(a.review?.snapshot, orgId) ||
    a.payload.journalId !== a.review.snapshot.journalId ||
    !hex(a.payload.reviewHash) ||
    a.payload.reviewHash !== a.review.reviewHash ||
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
export async function checkedReview(
  raw: unknown,
  orgId: string,
  journalId: string,
): Promise<Review> {
  const r = raw as Review;
  assert(
    keys(r, "cancellation,evidence,journal,plan,reviewHash,snapshot") &&
      validSnapshot(r.snapshot, orgId) &&
      r.snapshot.journalId === journalId &&
      hex(r.reviewHash),
  );
  const { reviewHash, ...fixed } = r,
    s = r.snapshot,
    j = r.journal,
    c = r.cancellation,
    e = r.evidence;
  assert(
    (await sha(fixed)) === reviewHash &&
      object(j) &&
      j.leg === "original" &&
      j.state === "cancelled" &&
      j.externalId === null &&
      j.leaseStarted === null &&
      j.leaseMode === null &&
      text(j.createdBy) &&
      time(j.createdAt) &&
      text(j.decisionBy) &&
      j.decisionBy !== j.createdBy &&
      time(j.decisionAt) &&
      text(j.decisionReason, 2000),
  );
  await selection(j, orgId);
  assert(
    j.id === s.journalId &&
      j.sourceId === s.sourceId &&
      j.sourceHash === s.sourceHash &&
      j.postingDate === s.postingDate &&
      j.realm === s.realm &&
      j.bindingId === s.bindingId &&
      j.reviewHash === s.reviewHash &&
      j.requestRef === s.requestRef &&
      j.requestRef === `DJ-${(await digestText(j.id)).slice(0, 18)}`,
  );
  assert(
    validSnapshot(e?.snapshot, orgId) &&
      (await checkedProof(e, e.snapshot)) &&
      canonical({ ...e.snapshot, historyHash: s.historyHash }) === canonical(s),
  );
  assert(
    keys(c, "body,hash,recordedAt,recordedBy,revision") &&
      hex(c.hash) &&
      time(c.recordedAt) &&
      text(c.recordedBy) &&
      c.recordedBy !== e.recordedBy &&
      c.revision === e.revision + 1 &&
      keys(c.body, "evidenceHash,outcome,reason,requestRef") &&
      c.body.outcome === "cancelled-unposted" &&
      c.body.evidenceHash === e.evidenceHash &&
      c.body.requestRef === s.requestRef &&
      text(c.body.reason, 2000) &&
      (await sha({
        journalId: j.id,
        orgId,
        revision: c.revision,
        body: c.body,
        recordedBy: c.recordedBy,
        recordedAt: c.recordedAt,
      })) === c.hash,
  );
  const p = r.plan;
  assert(
    keys(p, "input,intent,policyHash,predecessor") &&
      canonical(p.predecessor) ===
        canonical({
          journalId: j.id,
          reviewHash: j.reviewHash,
          cancellationHash: c.hash,
          historyHash: s.historyHash,
        }) &&
      p.policyHash === j.plan.policyHash &&
      canonical(p.intent) === canonical(j.plan.intent) &&
      canonical(p.input) ===
        canonical({
          ...j.plan.input,
          attemptId: j.id,
          authority: p.input?.authority,
          reason: "Separately reviewed original retry",
        }),
  );
  await selection(
    {
      ...j,
      id: "prospective-original-retry",
      attemptId: j.id,
      plan: p,
      reviewHash: await sha(p),
    },
    orgId,
  );
  const bytes = p.intent.source.bytes;
  assert(
    typeof bytes === "string" &&
      bytes.length <= 4_194_304 &&
      (await digestText(bytes)) === s.sourceHash,
  );
  const doc = JSON.parse(bytes),
    lines = doc.report?.journal;
  assert(
    doc.region === s.region &&
      doc.currency === s.currency &&
      Array.isArray(lines),
  );
  let debit = 0n,
    credit = 0n;
  for (const line of lines.filter((l: any) => l.date === s.postingDate)) {
    assert(
      Number.isSafeInteger(line.debit) &&
        Number.isSafeInteger(line.credit) &&
        line.debit >= 0 &&
        line.credit >= 0,
    );
    debit += BigInt(line.debit);
    credit += BigInt(line.credit);
  }
  assert(debit === BigInt(s.debit) && credit === BigInt(s.credit));
  return r;
}
export async function checkedAttempt(a: Attempt, orgId: string) {
  parse(JSON.stringify(a), orgId);
  await checkedReview(a.review, orgId, a.payload.journalId);
  return a;
}
export async function checkedReceipt(
  raw: unknown,
  a: Attempt,
  actorId: string,
) {
  assert(object(raw));
  const r = raw as ReturnType<StockJournalDelivery["prepareOriginalRetry"]>,
    p = {
      ...a.review.plan,
      input: { ...a.review.plan.input, reason: a.payload.reason },
    };
  assert(
    text(r.id) &&
      r.id !== a.review.journal.id &&
      r.requestRef !== a.review.journal.requestRef &&
      r.requestRef === `DJ-${(await digestText(r.id)).slice(0, 18)}` &&
      r.createdBy === actorId &&
      time(r.createdAt) &&
      r.state === "ready" &&
      r.externalId === null &&
      r.decisionBy === null &&
      r.decisionAt === null &&
      r.decisionReason === null &&
      r.leaseStarted === null &&
      r.leaseMode === null &&
      r.dispatched === false &&
      canonical(r.plan) === canonical(p),
  );
  await selection(r, a.review.snapshot.orgId);
  return r;
}
