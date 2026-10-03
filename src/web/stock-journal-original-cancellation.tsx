import React, { useEffect, useRef, useState } from "react";
import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import { request, RequestError } from "./api.ts";
import { canonical } from "./stock-journal-reconciliation-contract.ts";
import {
  checkedAttempt,
  checkedCancellationReview,
  checkedEvidenceReview,
  retained,
  validReceipt,
  type Attempt,
  type CancellationReview,
  type EvidenceReview,
  type Snapshot,
} from "./stock-journal-original-cancellation-contract.ts";
function FixedJournal({ snapshot: s }: { snapshot: Snapshot }) {
  return (
    <>
      <p>
        Original journal <code>{s.journalId}</code> · {s.postingDate} ·{" "}
        {s.region} / {s.currency} · debit {s.debit} cents · credit {s.credit}{" "}
        cents.
      </p>
      <p>
        Sandbox company {s.realm} · binding <code>{s.bindingId}</code> ·
        permanent reference <code>{s.requestRef}</code>.
      </p>
      <p>
        Source <code>{s.sourceId}</code> · source hash{" "}
        <code>{s.sourceHash}</code> · original review hash{" "}
        <code>{s.reviewHash}</code> · complete history hash{" "}
        <code>{s.historyHash}</code>.
      </p>
    </>
  );
}
function FixedProof({ proof }: { proof: CancellationReview["evidence"] }) {
  return (
    <>
      <p>
        Evidence hash <code>{proof.evidenceHash}</code> · revision{" "}
        {proof.revision} · recorded by {proof.recordedBy} at {proof.recordedAt}.
      </p>
      <p>
        Receiver cancellation case reference: {proof.input.externalRef}.
        Evidence: {proof.input.evidence}
      </p>
      <p>
        Attested: final cancellation, verified non-posting and prevention of
        later posting for this exact request.
      </p>
    </>
  );
}
export function StockJournalOriginalCancellation({
  orgId,
  actorId,
  journal,
  saved,
}: {
  orgId: string;
  actorId: string;
  journal: ReturnType<StockJournalDelivery["detail"]> | null;
  saved: (id: string) => void;
}) {
  const storageKey = `distributor-original-journal-cancellation:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey, orgId)),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [evidence, setEvidence] = useState<EvidenceReview | null>(null),
    [final, setFinal] = useState<CancellationReview | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    reading = useRef<AbortController | null>(null),
    pending = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    sectionHeading = useRef<HTMLHeadingElement>(null),
    recoverButton = useRef<HTMLButtonElement>(null),
    loadButton = useRef<HTMLButtonElement>(null),
    restoreFocus = useRef(false);
  useEffect(() => {
    active.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setRecovery(retained(storageKey, orgId));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      reading.current?.abort();
      pending.current?.abort();
      reading.current = null;
      pending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey, orgId]);
  useEffect(() => {
    reading.current?.abort();
    reading.current = null;
    setLoading(false);
    setEvidence(null);
    setFinal(null);
  }, [journal]);
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      (
        recoverButton.current ??
        loadButton.current ??
        sectionHeading.current
      )?.focus();
    }
  }, [review]);
  const load = async (kind: "evidence" | "cancel") => {
    if (!journal) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    const current = () =>
      active.current &&
      reading.current === controller &&
      !controller.signal.aborted;
    setLoading(true);
    setError("");
    setEvidence(null);
    setFinal(null);
    try {
      const raw = await request(
        `/api/accounting/journals/${encodeURIComponent(journal.id)}/original-cancellation${kind === "evidence" ? "-evidence" : ""}-review`,
        { signal: controller.signal },
      );
      if (kind === "evidence") {
        const checked = await checkedEvidenceReview(raw, orgId, journal.id);
        if (current()) setEvidence(checked);
      } else {
        const checked = await checkedCancellationReview(
          raw,
          orgId,
          journal.id,
          actorId,
        );
        if (current()) setFinal(checked);
      }
    } catch (e) {
      if (current())
        setError(
          e instanceof Error
            ? e.message
            : "Original cancellation evidence could not be loaded.",
        );
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        if (active.current) setLoading(false);
      }
    }
  };
  const prepare = async (attempt: Attempt, replay = false) => {
    setError("");
    try {
      await checkedAttempt(attempt, orgId, actorId);
      if (active.current) {
        setReview(attempt);
        setReplaying(replay);
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "The exact review could not be verified.",
        );
    }
  };
  const submit = async () => {
    if (!review || pending.current) return;
    const a = review,
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
          "This browser cannot coordinate original cancellations between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is submitting an original cancellation. Wait for its outcome before retrying.",
            );
          const previous = retained(storageKey, orgId);
          if (previous.error) throw Error(previous.error);
          if (
            replaying
              ? canonical(previous.attempt) !== canonical(a)
              : !!previous.attempt
          )
            throw Error(
              "Original cancellation recovery evidence changed. Close this review and review the retained attempt.",
            );
          await checkedAttempt(a, orgId, actorId);
          if (!current()) return;
          // Recheck after asynchronous integrity validation before retaining or sending.
          const latest = retained(storageKey, orgId);
          if (
            latest.error ||
            canonical(latest.attempt) !== canonical(previous.attempt)
          )
            throw Error(
              "Original cancellation recovery evidence changed. The retained attempt has been preserved.",
            );
          const raw = JSON.stringify(a);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact original cancellation could not be retained. Nothing was sent.",
            );
          setRecovery({ attempt: a, error: "" });
          setReplaying(true);
          const clear = () => {
            if (!current()) return false;
            if (localStorage.getItem(storageKey) !== raw)
              throw Error(
                "Original cancellation recovery evidence changed. The retained attempt has been preserved.",
              );
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) !== null)
              throw Error(
                "Original cancellation recovery evidence could not be cleared. Recover the retained exact attempt after restoring browser storage.",
              );
            restoreFocus.current = true;
            setRecovery({ attempt: null, error: "" });
            setReview(null);
            setEvidence(null);
            setFinal(null);
            saved(a.snapshot.journalId);
            return true;
          };
          let result: unknown;
          try {
            controller.signal.throwIfAborted();
            result = await request(
              `/api/commands/accounting.journal.${a.kind === "evidence" ? "original-cancellation.evidence" : "cancel-original"}`,
              {
                signal: controller.signal,
                method: "POST",
                headers: { "idempotency-key": a.key },
                body: JSON.stringify(a.payload),
              },
            );
          } catch (e) {
            if (
              !replaying &&
              e instanceof RequestError &&
              e.status === 409 &&
              [
                "JOURNAL_STATE",
                "JOURNAL_REVIEW_CHANGED",
                "JOURNAL_CANCELLATION",
                "JOURNAL_CANCELLATION_EVIDENCE",
              ].includes(e.code ?? "")
            )
              clear();
            throw e;
          }
          if (!(await validReceipt(result, a, actorId)))
            throw Error(
              "The original cancellation reply could not be verified. Recover the retained exact attempt.",
            );
          clear();
        },
      );
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey, orgId));
        setError(
          e instanceof Error
            ? e.message
            : "Original cancellation could not be confirmed.",
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  const eligible =
    journal?.state === "unknown" &&
    journal.leg === "original" &&
    !recovery.attempt &&
    !recovery.error;
  return (
    <section aria-label="Original journal cancellation">
      <h3 ref={sectionHeading} tabIndex={-1}>
        Original journal cancellation
      </h3>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            An exact original cancellation{" "}
            {recovery.attempt.kind === "evidence"
              ? "evidence submission"
              : "decision"}{" "}
            is retained for this organization and principal. Recover it before
            another submission.
          </p>
          <button
            ref={recoverButton}
            onClick={() => void prepare(recovery.attempt!, true)}
          >
            Review retained original cancellation attempt
          </button>
        </>
      )}
      {review ? (
        <section
          aria-label="Exact original cancellation review"
          className="stock-history"
        >
          <h3 ref={heading} tabIndex={-1}>
            Exact original cancellation review
          </h3>
          <p>
            {replaying
              ? "Recover the retained original key and body. A historical receipt does not change current journal state."
              : "Review the fixed original request and final non-posting evidence before confirmation."}
          </p>
          <FixedJournal snapshot={review.snapshot} />
          {review.kind === "evidence" ? (
            <>
              <p>
                Evidence review hash <code>{review.payload.reviewHash}</code>.
              </p>
              <p>
                Receiver cancellation case reference:{" "}
                {review.payload.externalRef}. Evidence:{" "}
                {review.payload.evidence}
              </p>
              <p>
                Attested: final cancellation, verified non-posting and
                prevention of later posting for this exact request.
              </p>
            </>
          ) : (
            <>
              <FixedProof proof={review.proof} />
              <p>Independent cancellation reason: {review.payload.reason}</p>
            </>
          )}
          <p>
            This retains manual operator evidence. A lookup miss is
            insufficient. It cannot cancel a provider request or authorize
            another write. Permanent source/date/reference reservations remain
            retained.
          </p>
          <div className="actions">
            <button
              disabled={busy || !!recovery.error}
              onClick={() => void submit()}
            >
              {replaying
                ? "Recover exact original cancellation attempt"
                : review.kind === "evidence"
                  ? "Record final original cancellation evidence"
                  : "Confirm independent original cancellation"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                restoreFocus.current = true;
                setReview(null);
                setError("");
              }}
            >
              Close original cancellation review
            </button>
          </div>
        </section>
      ) : eligible ? (
        <>
          <div className="actions">
            <button
              ref={loadButton}
              disabled={loading}
              onClick={() => void load("evidence")}
            >
              Load original cancellation evidence review
            </button>
            <button disabled={loading} onClick={() => void load("cancel")}>
              Load final original cancellation evidence
            </button>
          </div>
          {loading && (
            <p role="status">Loading original cancellation evidence</p>
          )}
          {evidence && (
            <form
              aria-label="Original cancellation evidence entry"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                if (
                  [
                    "cancellationFinal",
                    "nonPostingVerified",
                    "noLaterPosting",
                  ].some((k) => data.get(k) !== "on")
                )
                  return;
                void prepare({
                  kind: "evidence",
                  key: crypto.randomUUID(),
                  proof: null,
                  snapshot: evidence.snapshot,
                  payload: {
                    journalId: evidence.snapshot.journalId,
                    reviewHash: evidence.reviewHash,
                    requestRef: evidence.snapshot.requestRef,
                    externalRef: String(data.get("externalRef") ?? "").trim(),
                    evidence: String(data.get("evidence") ?? "").trim(),
                    cancellationFinal: true,
                    nonPostingVerified: true,
                    noLaterPosting: true,
                  },
                });
              }}
            >
              <FixedJournal snapshot={evidence.snapshot} />
              <p>
                A lookup miss is insufficient. Establish final cancellation,
                non-posting and prevention of later posting for the exact
                receiver request.
              </p>
              <div className="form-field">
                <label htmlFor="original-cancellation-case">
                  Receiver cancellation case reference
                </label>
                <input
                  id="original-cancellation-case"
                  name="externalRef"
                  required
                  maxLength={160}
                />
              </div>
              <div className="form-field">
                <label htmlFor="original-cancellation-proof">
                  Final cancellation and non-posting evidence
                </label>
                <textarea
                  id="original-cancellation-proof"
                  name="evidence"
                  required
                  maxLength={2000}
                />
              </div>
              <label>
                <input type="checkbox" name="cancellationFinal" required />{" "}
                Cancellation of this exact request is final
              </label>
              <label>
                <input type="checkbox" name="nonPostingVerified" required />{" "}
                Non-posting of this exact request is verified
              </label>
              <label>
                <input type="checkbox" name="noLaterPosting" required /> This
                exact request cannot post later
              </label>
              <button type="submit">
                Review original cancellation evidence
              </button>
            </form>
          )}
          {final && (
            <section aria-label="Final original cancellation evidence">
              <FixedJournal snapshot={final.evidence.snapshot} />
              <FixedProof proof={final.evidence} />
              {final.canConfirm ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const reason = String(
                      new FormData(event.currentTarget).get("reason") ?? "",
                    ).trim();
                    void prepare({
                      kind: "cancel",
                      key: crypto.randomUUID(),
                      snapshot: final.evidence.snapshot,
                      proof: final.evidence,
                      payload: {
                        journalId: final.journal.id,
                        requestRef: final.journal.requestRef,
                        evidenceHash: final.evidence.evidenceHash,
                        reason,
                      },
                    });
                  }}
                >
                  <div className="form-field">
                    <label htmlFor="original-cancellation-reason">
                      Independent original cancellation reason
                    </label>
                    <textarea
                      id="original-cancellation-reason"
                      name="reason"
                      required
                      maxLength={2000}
                    />
                  </div>
                  <button type="submit">
                    Review independent original cancellation
                  </button>
                </form>
              ) : (
                <p>
                  A different current finance principal must confirm this final
                  evidence.
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
