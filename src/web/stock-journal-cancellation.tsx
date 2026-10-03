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
type Evidence = {
  evidenceHash: string;
  recordedBy: string;
  recordedAt: string;
  revision: number;
  receiverRef: string;
  externalRef: string;
  evidence: string;
};
type Attempt = {
  evidence: Evidence;
  key: string;
  selection: Selection;
  payload: {
    journalId: string;
    requestRef: string;
    evidenceHash: string;
    reason: string;
  };
};
const storageError =
  "Journal cancellation recovery evidence is unavailable. Restore browser storage and reconcile the previous attempt before submitting again.";
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const keys = (v: object, expected: string) =>
  Object.keys(v).sort().join() === expected;
function parse(raw: string): Attempt {
  if (raw.length > 16000) throw Error(storageError);
  const a = JSON.parse(raw) as Attempt,
    e = a?.evidence,
    s = a?.selection,
    p = a?.payload;
  if (
    !a ||
    !keys(a, "evidence,key,payload,selection") ||
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
    !["reversal", "replacement"].includes(s.leg) ||
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
    !keys(p, "evidenceHash,journalId,reason,requestRef") ||
    p.journalId !== s.id ||
    p.requestRef !== s.requestRef ||
    !e ||
    !keys(
      e,
      "evidence,evidenceHash,externalRef,receiverRef,recordedAt,recordedBy,revision",
    ) ||
    !/^[a-f0-9]{64}$/.test(e.evidenceHash) ||
    p.evidenceHash !== e.evidenceHash ||
    !text(e.recordedBy, 160) ||
    !text(e.recordedAt, 100) ||
    !Number.isSafeInteger(e.revision) ||
    e.revision < 1 ||
    e.receiverRef !== `quickbooks-sandbox:${s.realm}` ||
    !text(e.externalRef, 160) ||
    !text(e.evidence, 2000) ||
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
function selection(j: Selection): Selection {
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
  const r = value as ReturnType<
    StockJournalDelivery["cancelCorrectionAttempt"]
  >;
  const c = r.cancellation;
  const body = c?.body as Record<string, unknown> | undefined;
  return (
    Object.entries(a.selection).every(
      ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
    ) &&
    r.state === "cancelled" &&
    c?.recordedBy === actorId &&
    text(c.recordedAt, 100) &&
    !!body &&
    body.outcome === "cancelled-unposted" &&
    body.requestRef === a.payload.requestRef &&
    body.evidenceHash === a.payload.evidenceHash &&
    body.reason === a.payload.reason
  );
}

export function StockJournalCancellation({
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
  const storageKey = `distributor-journal-cancellation:${orgId}:${actorId}`;
  const [context, setContext] = useState<ReturnType<
      StockJournalDelivery["cancellationReview"]
    > | null>(null),
    [loading, setLoading] = useState(false),
    [recovery, setRecovery] = useState(() => retained(storageKey)),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    pending = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    reading = useRef<AbortController | null>(null),
    restoreFocus = useRef(false),
    recoveryButton = useRef<HTMLButtonElement>(null),
    loadButton = useRef<HTMLButtonElement>(null);
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
      reading.current?.abort();
      pending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey]);
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      (recoveryButton.current ?? loadButton.current)?.focus();
    }
  }, [review]);
  useEffect(() => {
    reading.current?.abort();
    reading.current = null;
    setContext(null);
    setLoading(false);
  }, [journal]);
  const loadEvidence = async () => {
    if (!journal) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    setError("");
    setContext(null);
    const current = () =>
      active.current &&
      reading.current === controller &&
      !controller.signal.aborted;
    try {
      const result = await request<
        ReturnType<StockJournalDelivery["cancellationReview"]>
      >(
        `/api/accounting/journals/${encodeURIComponent(journal.id)}/cancellation-review`,
        { signal: controller.signal },
      );
      if (current()) setContext(result);
    } catch (e) {
      if (current())
        setError(
          e instanceof Error
            ? e.message
            : "Cancellation evidence could not be loaded.",
        );
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        if (active.current) setLoading(false);
      }
    }
  };
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
          "This browser cannot coordinate journal cancellations between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is submitting a journal cancellation. Wait for its outcome before retrying.",
            );
          const previous = retained(storageKey);
          if (previous.error) throw Error(previous.error);
          if (
            replaying
              ? JSON.stringify(previous.attempt) !== JSON.stringify(input)
              : !!previous.attempt
          )
            throw Error(
              "Journal recovery evidence changed. Close this review and review the retained original cancellation.",
            );
          if (input.evidence.recordedBy === actorId)
            throw Error(
              "A different current finance principal must bind this evidence.",
            );
          const raw = JSON.stringify(input);
          parse(raw);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact journal cancellation could not be retained. Nothing was sent.",
            );
          if (current()) {
            setRecovery({ attempt: input, error: "" });
            setReplaying(true);
          }
          controller.signal.throwIfAborted();
          const clear = () => {
            if (localStorage.getItem(storageKey) !== raw)
              throw Error(
                "Journal recovery evidence changed. The retained cancellation has been preserved.",
              );
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) !== null)
              throw Error(
                "Journal cancellation recovery evidence could not be cleared. Retry the retained exact cancellation after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request(
              "/api/commands/accounting.journal.cancel-correction",
              {
                signal: controller.signal,
                method: "POST",
                headers: { "idempotency-key": input.key },
                body: JSON.stringify(input.payload),
              },
            );
          } catch (e) {
            if (
              e instanceof RequestError &&
              [
                "JOURNAL_STATE",
                "JOURNAL_CANCELLATION",
                "COST_RETRY_CANCELLED",
                "COST_ATTEMPT_CHANGED",
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
              "The journal cancellation reply could not be confirmed. Retry the retained exact cancellation.",
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
            : "Journal cancellation could not be confirmed.",
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
    <section aria-label="Journal cancellation recovery">
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            An exact journal cancellation is retained for this organization and
            principal. Reconcile it before another cancellation.
          </p>
          <button
            ref={recoveryButton}
            onClick={() => {
              setReview(recovery.attempt);
              setReplaying(true);
              setError("");
            }}
          >
            Review retained journal cancellation
          </button>
        </>
      )}
      {review ? (
        <section
          aria-label="Exact journal cancellation review"
          className="stock-history"
        >
          <h3 ref={heading} tabIndex={-1}>
            Exact journal cancellation review
          </h3>
          <p>
            {replaying
              ? "Retry the retained original cancellation. Its receipt may describe a historical state; refresh the journal after recovery."
              : "Confirm final cancellation evidence against this exact native journal reference."}
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
            Evidence hash <code>{review.evidence.evidenceHash}</code>, recorded
            by {review.evidence.recordedBy} at {review.evidence.recordedAt},
            revision {review.evidence.revision}.
          </p>
          <p>
            Receiver {review.evidence.receiverRef}; operator reference{" "}
            <code>{review.evidence.externalRef}</code>. Evidence:{" "}
            {review.evidence.evidence}
          </p>
          <p>Cancellation binding reason: {review.payload.reason}</p>
          <p>
            This binds retained final non-posting evidence to the native
            reference above. Confirm that both identify the same external
            attempt. It preserves permanent references and cannot cancel a
            provider request or authorize another write.
          </p>
          <div className="actions">
            <button
              disabled={busy || !!recovery.error}
              onClick={() => void submit()}
            >
              {replaying
                ? "Retry exact journal cancellation"
                : "Confirm journal cancellation"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                restoreFocus.current = true;
                setReview(null);
                setError("");
              }}
            >
              Close journal cancellation review
            </button>
          </div>
        </section>
      ) : journal?.state === "unknown" &&
        journal.leg !== "original" &&
        !recovery.attempt &&
        !recovery.error ? (
        <>
          <button
            ref={loadButton}
            disabled={loading}
            onClick={() => void loadEvidence()}
          >
            {loading
              ? "Loading cancellation evidence"
              : "Load final cancellation evidence"}
          </button>
          {context && (
            <section aria-label="Retained final cancellation evidence">
              <p>
                Final cancelled/unposted evidence{" "}
                {context.evidence.evidenceHash} recorded by{" "}
                {context.evidence.recordedBy} at {context.evidence.recordedAt}.
              </p>
              <p>
                Receiver: {context.evidence.input.receiverRef}. Operator
                reference: {context.evidence.input.externalRef}. Native
                reference: {context.journal.requestRef}.
              </p>
              <p>{context.evidence.input.evidence}</p>
              {context.canConfirm && context.evidence.recordedBy !== actorId ? (
                <form
                  aria-label="Review journal cancellation"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = String(
                      new FormData(event.currentTarget).get("reason") ?? "",
                    ).trim();
                    if (!text(reason, 2000)) return;
                    const e = context.evidence;
                    const attempt: Attempt = {
                      key: crypto.randomUUID(),
                      selection: selection(context.journal),
                      evidence: {
                        evidenceHash: e.evidenceHash,
                        recordedBy: e.recordedBy,
                        recordedAt: e.recordedAt,
                        revision: e.revision,
                        receiverRef: e.input.receiverRef,
                        externalRef: e.input.externalRef,
                        evidence: e.input.evidence,
                      },
                      payload: {
                        journalId: context.journal.id,
                        requestRef: context.journal.requestRef,
                        evidenceHash: e.evidenceHash,
                        reason,
                      },
                    };
                    try {
                      parse(JSON.stringify(attempt));
                      setReview(attempt);
                      setReplaying(false);
                      setError("");
                    } catch {
                      setError(storageError);
                    }
                  }}
                >
                  <div className="form-field">
                    <label htmlFor="journal-cancellation-reason">
                      Journal cancellation reason
                    </label>
                    <textarea
                      id="journal-cancellation-reason"
                      name="reason"
                      required
                      maxLength={2000}
                    />
                  </div>
                  <button type="submit">
                    Review exact journal cancellation
                  </button>
                </form>
              ) : (
                <p>
                  A different current finance principal must bind this final
                  cancellation evidence.
                </p>
              )}
            </section>
          )}
        </>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
