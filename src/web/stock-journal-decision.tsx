import React, { useEffect, useRef, useState } from "react";
import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import { request, RequestError } from "./api.ts";

type Journal = ReturnType<StockJournalDelivery["detail"]>;
type Selection = Pick<
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
>;
type Attempt = {
  key: string;
  selection: Selection;
  payload: {
    journalId: string;
    reviewHash: string;
    decision: "approve" | "reject";
    reason: string;
  };
};
const storageError =
  "Journal decision recovery evidence is unavailable. Restore browser storage and reconcile the previous attempt before submitting again.";
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const keys = (v: object, expected: string) =>
  Object.keys(v).sort().join() === expected;
function parse(raw: string): Attempt {
  if (raw.length > 16000) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt,
    s = a?.selection,
    p = a?.payload;
  if (
    !a ||
    !keys(a, "key,payload,selection") ||
    !text(a.key, 36) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      a.key,
    ) ||
    !s ||
    !keys(
      s,
      "attemptId,bindingId,id,leg,postingDate,realm,requestRef,reviewHash,sourceHash,sourceId",
    ) ||
    !text(s.id, 160) ||
    !text(s.sourceId, 160) ||
    !text(s.sourceHash, 64) ||
    !/^[a-f0-9]{64}$/.test(s.sourceHash) ||
    !["original", "reversal", "replacement"].includes(s.leg) ||
    !text(s.postingDate, 10) ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.postingDate) ||
    !(s.attemptId === null || text(s.attemptId, 160)) ||
    !text(s.bindingId, 160) ||
    !text(s.realm, 30) ||
    !/^[1-9][0-9]{0,29}$/.test(s.realm) ||
    !text(s.reviewHash, 64) ||
    !/^[a-f0-9]{64}$/.test(s.reviewHash) ||
    !text(s.requestRef, 21) ||
    !/^DJ-[a-f0-9]{18}$/.test(s.requestRef) ||
    !p ||
    !keys(p, "decision,journalId,reason,reviewHash") ||
    p.journalId !== s.id ||
    p.reviewHash !== s.reviewHash ||
    !["approve", "reject"].includes(p.decision) ||
    !text(p.reason, 2000)
  )
    throw Error(storageError);
  return a;
}
function retained(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    return { attempt: raw === null ? null : parse(raw), error: "" };
  } catch {
    return { attempt: null, error: storageError };
  }
}
function selection(j: Journal): Selection {
  return {
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
  };
}
function validReply(value: unknown, a: Attempt, actorId: string) {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    Object.entries(a.selection).every(([k, v]) => r[k] === v) &&
    r.state === (a.payload.decision === "approve" ? "pending" : "rejected") &&
    r.decisionBy === actorId &&
    r.decisionReason === a.payload.reason &&
    text(r.decisionAt, 100)
  );
}

export function StockJournalDecision({
  orgId,
  actorId,
  journal,
  saved,
}: {
  orgId: string;
  actorId: string;
  journal: Journal | null;
  saved: (id: string) => void;
}) {
  const storageKey = `distributor-journal-decision:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey)),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    pending = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setRecovery(retained(storageKey));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey]);
  useEffect(() => {
    if (review) heading.current?.focus();
  }, [review]);
  const submit = async () => {
    if (!review || pending.current) return;
    const input = review,
      controller = new AbortController();
    pending.current = controller;
    const current = () =>
      active.current &&
      pending.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate journal decisions between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is submitting a journal decision. Wait for its outcome before retrying.",
            );
          const previous = retained(storageKey);
          if (previous.error) throw Error(previous.error);
          if (
            replaying
              ? JSON.stringify(previous.attempt) !== JSON.stringify(input)
              : !!previous.attempt
          )
            throw Error(
              "Journal recovery evidence changed. Close this review and review the retained original decision.",
            );
          const raw = JSON.stringify(input);
          parse(raw);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact journal decision could not be retained. Nothing was sent.",
            );
          if (current()) {
            setRecovery({ attempt: input, error: "" });
            setReplaying(true);
          }
          controller.signal.throwIfAborted();
          const clear = () => {
            if (localStorage.getItem(storageKey) !== raw)
              throw Error(
                "Journal recovery evidence changed. The retained decision has been preserved.",
              );
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) !== null)
              throw Error(
                "Journal decision recovery evidence could not be cleared. Retry the retained exact decision after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request("/api/commands/accounting.journal.decide", {
              signal: controller.signal,
              method: "POST",
              headers: { "idempotency-key": input.key },
              body: JSON.stringify(input.payload),
            });
          } catch (e) {
            if (
              e instanceof RequestError &&
              [
                "JOURNAL_INPUT",
                "JOURNAL_REVIEW_CHANGED",
                "JOURNAL_DECISION",
                "JOURNAL_REFERENCE",
              ].includes(e.code ?? "")
            ) {
              clear();
              if (current()) {
                setRecovery({ attempt: null, error: "" });
                setReview(null);
                saved(input.selection.id);
              }
            }
            throw e;
          }
          if (!validReply(result, input, actorId))
            throw Error(
              "The journal decision reply could not be confirmed. Retry the retained exact decision.",
            );
          clear();
          if (current()) {
            setRecovery({ attempt: null, error: "" });
            setReview(null);
            saved(input.selection.id);
          }
        },
      );
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey));
        setError(
          e instanceof Error
            ? e.message
            : "Journal decision could not be confirmed.",
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  return (
    <section aria-label="Journal decision recovery">
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            An exact journal decision is retained for this organization and
            principal. Reconcile it before another decision.
          </p>
          <button
            onClick={() => {
              setReview(recovery.attempt);
              setReplaying(true);
              setError("");
            }}
          >
            Review retained journal decision
          </button>
        </>
      )}
      {review ? (
        <section
          aria-label="Exact journal decision review"
          className="stock-history"
        >
          <h3 ref={heading} tabIndex={-1}>
            Exact journal decision review
          </h3>
          <p>
            {replaying
              ? "Retry the retained original decision. Its receipt may describe a historical state; refresh the journal after recovery."
              : "Confirm this fixed decision against the frozen journal reviewed above."}
          </p>
          <p>
            Journal <code>{review.selection.id}</code> · {review.selection.leg}{" "}
            · {review.selection.postingDate} · sandbox company{" "}
            {review.selection.realm} · reference{" "}
            <code>{review.selection.requestRef}</code>.
          </p>
          <p>
            Source <code>{review.selection.sourceId}</code> · source hash{" "}
            <code>{review.selection.sourceHash}</code> · review hash{" "}
            <code>{review.selection.reviewHash}</code> · binding{" "}
            <code>{review.selection.bindingId}</code> · attempt{" "}
            {review.selection.attemptId ?? "initial"}.
          </p>
          <p>
            Decision: <strong>{review.payload.decision}</strong>. Reason:{" "}
            {review.payload.reason}
          </p>
          <p>
            Approval queues an independently reviewed journal. Provider
            execution is not connected to this browser.
          </p>
          <div className="actions">
            <button
              disabled={busy || !!recovery.error}
              onClick={() => void submit()}
            >
              {replaying
                ? "Retry exact journal decision"
                : "Confirm journal decision"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError("");
              }}
            >
              Close journal decision review
            </button>
          </div>
        </section>
      ) : journal?.state === "ready" && !recovery.attempt && !recovery.error ? (
        journal.createdBy === actorId ? (
          <p>
            A different current finance principal must approve or reject this
            journal.
          </p>
        ) : (
          <form
            aria-label="Review journal decision"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget),
                decision = String(values.get("decision")),
                reason = String(values.get("reason") ?? "").trim();
              if (
                !["approve", "reject"].includes(decision) ||
                !text(reason, 2000)
              )
                return;
              setReview({
                key: crypto.randomUUID(),
                selection: selection(journal),
                payload: {
                  journalId: journal.id,
                  reviewHash: journal.reviewHash,
                  decision: decision as "approve" | "reject",
                  reason,
                },
              });
              setReplaying(false);
              setError("");
            }}
          >
            <div className="form-field">
              <label htmlFor="journal-decision">Journal decision</label>
              <select id="journal-decision" name="decision">
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="journal-decision-reason">
                Journal decision reason
              </label>
              <textarea
                id="journal-decision-reason"
                name="reason"
                required
                maxLength={2000}
              />
            </div>
            <button type="submit">Review exact journal decision</button>
          </form>
        )
      ) : null}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
