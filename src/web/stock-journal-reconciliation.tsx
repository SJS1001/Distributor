import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import {
  type Attempt,
  type Review,
  canonical,
  checkedReview,
  parse,
  retained,
  sha,
  snapshot,
  validReceipt,
} from "./stock-journal-reconciliation-contract.ts";

export function StockJournalReconciliation({
  orgId,
  actorId,
}: {
  orgId: string;
  actorId: string;
}) {
  const storageKey = `distributor-journal-reconciliation:${orgId}:${actorId}`;
  const [source, setSource] = useState<Review | null>(null),
    [review, setReview] = useState<Attempt | null>(null),
    [recovery, setRecovery] = useState(() => retained(storageKey, orgId)),
    [replaying, setReplaying] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const operation = useRef<AbortController | null>(null),
    active = useRef(true),
    heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLButtonElement | null>(null),
    loadButton = useRef<HTMLButtonElement>(null),
    recoveryButton = useRef<HTMLButtonElement>(null),
    restore = useRef(false);
  useEffect(() => {
    active.current = true;
    const changed = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null)
        setRecovery(retained(storageKey, orgId));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey, orgId]);
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (restore.current) {
      restore.current = false;
      (opener.current?.isConnected
        ? opener.current
        : (recoveryButton.current ?? loadButton.current)
      )?.focus();
    }
  }, [review]);
  const run = async (
    work: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () =>
      active.current &&
      operation.current === controller &&
      !controller.signal.aborted;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await work(controller.signal, current);
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey, orgId));
        setError(
          e instanceof Error
            ? e.message
            : "Original reconciliation could not be confirmed.",
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  function load(id: string) {
    void run(async (signal, current) => {
      setSource(null);
      const result = await checkedReview(
        await request(
          `/api/accounting/costs/${encodeURIComponent(id)}/journal-reconciliation`,
          { signal },
        ),
        orgId,
        id,
        actorId,
      );
      if (current()) setSource(result);
    });
  }
  const close = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    restore.current = true;
    setReview(null);
    setSource(null);
    setError("");
  };
  const submit = () => {
    if (!review) return;
    const input = review;
    void run(async (signal, current) => {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate reconciliation between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          signal.throwIfAborted();
          if (!lock)
            throw Error(
              "Another tab is confirming original reconciliation. Wait for its outcome.",
            );
          const previousRaw = localStorage.getItem(storageKey);
          const previous = retained(storageKey, orgId);
          if (previous.error) throw Error(previous.error);
          if (
            replaying
              ? canonical(previous.attempt) !== canonical(input)
              : !!previous.attempt
          )
            throw Error(
              "Reconciliation recovery evidence changed. Close this review and review the retained original attempt.",
            );
          const raw = replaying ? previousRaw! : JSON.stringify(input);
          parse(raw, orgId);
          if ((await sha(input.snapshot)) !== input.payload.reviewHash)
            throw Error(
              "The retained original reconciliation hash is invalid. Reconcile its evidence before another confirmation.",
            );
          signal.throwIfAborted();
          if (localStorage.getItem(storageKey) !== previousRaw)
            throw Error(
              "Reconciliation recovery evidence changed. Close this review and review the retained original attempt.",
            );
          if (!replaying) localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact original reconciliation could not be retained. Nothing was sent.",
            );
          if (current()) {
            setRecovery({ attempt: input, error: "" });
            setReplaying(true);
          }
          const path = `/api/accounting/costs/${encodeURIComponent(input.payload.packetId)}`;
          let accepted = false;
          if (replaying) {
            const fresh = await checkedReview(
              await request(`${path}/journal-reconciliation`, { signal }),
              orgId,
              input.payload.packetId,
              actorId,
            );
            if (
              fresh.reviewHash !== input.payload.reviewHash ||
              canonical(snapshot(fresh)) !== canonical(input.snapshot)
            )
              throw Error(
                "The original reconciliation evidence changed. Preserve the retained attempt for finance reconciliation.",
              );
            accepted = fresh.accepted;
            if (!accepted && !fresh.canConfirm)
              throw Error(
                `Original reconciliation is unavailable: ${fresh.issues.map((i) => i.message).join(" ") || "the original packet is superseded"}. Preserve the retained attempt.`,
              );
          }
          signal.throwIfAborted();
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "Reconciliation recovery evidence changed. Close this review and review the retained original attempt.",
            );
          const result = accepted
            ? await request(path, { signal })
            : await request(
                "/api/commands/accounting.cost.reconcile-journals",
                {
                  signal,
                  method: "POST",
                  headers: { "idempotency-key": input.key },
                  body: JSON.stringify(input.payload),
                },
              );
          if (!(await validReceipt(result, input, actorId)))
            throw Error(
              "The reconciliation reply could not be verified. Recover the retained exact reconciliation.",
            );
          signal.throwIfAborted();
          if (!current()) return;
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "Reconciliation recovery evidence changed; the retained attempt has been preserved.",
            );
          localStorage.removeItem(storageKey);
          if (localStorage.getItem(storageKey) !== null)
            throw Error(
              "Reconciliation recovery evidence could not be cleared. Recover the retained exact reconciliation after restoring browser storage.",
            );
          setRecovery({ attempt: null, error: "" });
          restore.current = true;
          setReview(null);
          setSource(null);
          setStatus(
            `Original journal reconciliation confirmed: ${input.payload.externalRef}. Recorded operator evidence; external qualification remains open.`,
          );
        },
      );
    });
  };
  const selected = review?.snapshot ?? (source ? snapshot(source) : null);
  return (
    <section aria-label="Original journal reconciliation">
      <div className="info-heading">
        <h3>Original journal reconciliation</h3>
        <InfoBubble label="Original journal reconciliation">
          Reconcile every posting date of one approved original packet against
          independent ledger evidence. This records a local finance receipt.
        </InfoBubble>
      </div>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <p role="status">
          {review
            ? "Confirming original reconciliation…"
            : "Loading original reconciliation…"}
        </p>
      )}
      {recovery.attempt && !review && (
        <>
          <p>
            An exact original reconciliation is retained for this organization
            and principal. Recover it before another confirmation.
          </p>
          <button
            ref={recoveryButton}
            disabled={busy}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setReview(recovery.attempt);
              setSource(null);
              setReplaying(true);
              setError("");
            }}
          >
            Review retained original reconciliation
          </button>
        </>
      )}
      {!review && (
        <form
          aria-label="Select original reconciliation"
          onSubmit={(e) => {
            e.preventDefault();
            opener.current = e.currentTarget.querySelector("button");
            load(
              String(
                new FormData(e.currentTarget).get("packetId") ?? "",
              ).trim(),
            );
          }}
        >
          <div className="form-field">
            <label htmlFor="original-reconciliation-packet">
              Approved original cost packet ID
            </label>
            <input
              id="original-reconciliation-packet"
              name="packetId"
              required
              maxLength={160}
              disabled={busy}
            />
          </div>
          <button ref={loadButton} disabled={busy} type="submit">
            Load original reconciliation
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => {
                operation.current?.abort();
                operation.current = null;
                setBusy(false);
                setSource(null);
              }}
            >
              Cancel reconciliation read
            </button>
          )}
        </form>
      )}
      {selected && (
        <section
          className="stock-history"
          aria-label={
            review
              ? "Exact original journal reconciliation"
              : "Original posting date controls"
          }
        >
          <h4 ref={heading} tabIndex={-1}>
            {review
              ? "Exact original journal reconciliation"
              : "Original posting date controls"}
          </h4>
          <p>
            Packet <code>{selected.packetId}</code> · {selected.region} ·{" "}
            {selected.currency}. Debit {selected.debit} cents; credit{" "}
            {selected.credit} cents. Receiver{" "}
            {selected.receiverRef ?? "No single company binding"}.
          </p>
          <p>
            Source SHA-256 <code>{selected.contentHash}</code>. Fixed review
            SHA-256{" "}
            <code>{review?.payload.reviewHash ?? source?.reviewHash}</code>.
          </p>
          {selected.dates.map((d, i) => (
            <section
              key={d.postingDate}
              aria-label={`Posting date ${d.postingDate}`}
            >
              <h5>{d.postingDate}</h5>
              <p>
                Debit {d.debit} cents; credit {d.credit} cents.
              </p>
              {d.journal ? (
                <>
                  <p>
                    Journal <code>{d.journal.id}</code>; state {d.journal.state}
                    ; native reference <code>{d.journal.requestRef}</code>;
                    company {d.journal.realm}; binding{" "}
                    <code>{d.journal.bindingId}</code>.
                  </p>
                  <p>
                    Journal review <code>{d.journal.reviewHash}</code>; history{" "}
                    <code>{d.journal.historyHash}</code>.
                  </p>
                  {d.journal.posted ? (
                    <>
                      <p>
                        Posted ID {d.journal.posted.externalId}; synchronization
                        token {d.journal.posted.syncToken}; revision{" "}
                        {d.journal.posted.revision}; recorded by{" "}
                        {d.journal.posted.recordedBy} at{" "}
                        {d.journal.posted.recordedAt}.
                      </p>
                      <p>
                        Final observation{" "}
                        <code>{d.journal.posted.observationHash}</code>.
                      </p>
                    </>
                  ) : (
                    <p>No final posted outcome.</p>
                  )}
                </>
              ) : (
                <p>No native original journal for this date.</p>
              )}
              {review && (
                <p>
                  Independent ledger evidence:{" "}
                  {review.payload.journals[i]!.evidenceRef}
                </p>
              )}
            </section>
          ))}
          {review ? (
            <>
              <p>
                Independent batch reference:{" "}
                <code>{review.payload.externalRef}</code>. Reason:{" "}
                {review.payload.reason}
              </p>
              <p>
                Confirmation: every original posting date reconciled. The exact
                source, company, native dates and evidence above will be
                retained before confirmation.
              </p>
              <div className="actions">
                <button disabled={busy || !!recovery.error} onClick={submit}>
                  {replaying
                    ? "Recover exact original reconciliation"
                    : "Confirm original reconciliation"}
                </button>
                <button onClick={close}>
                  Close original reconciliation review
                </button>
              </div>
            </>
          ) : (
            <>
              {source?.issues.length ? (
                <ul>
                  {source.issues.map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                </ul>
              ) : null}
              {source?.accepted && (
                <p role="status">
                  This original packet already has an acceptance receipt. Read
                  its saved cost review for the retained receipt.
                </p>
              )}
              {source?.superseded && (
                <p role="status">
                  This original packet has been superseded. Original acceptance
                  is unavailable.
                </p>
              )}
              {source?.canConfirm && !recovery.attempt && !recovery.error && (
                <form
                  aria-label="Attest original posting dates"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    if (values.get("confirmation") !== "all-dates-reconciled")
                      return;
                    const attempt: Attempt = {
                      key: crypto.randomUUID(),
                      snapshot: snapshot(source),
                      payload: {
                        packetId: source.packetId,
                        contentHash: source.contentHash,
                        reviewHash: source.reviewHash,
                        externalRef: String(
                          values.get("externalRef") ?? "",
                        ).trim(),
                        reason: String(values.get("reason") ?? "").trim(),
                        confirmation: "all-dates-reconciled",
                        journals: source.dates.map((d, i) => ({
                          journalId: d.journal!.id,
                          postingDate: d.postingDate,
                          externalId: d.journal!.posted!.externalId,
                          syncToken: d.journal!.posted!.syncToken,
                          debit: d.debit,
                          credit: d.credit,
                          evidenceRef: String(
                            values.get(`evidence-${i}`) ?? "",
                          ).trim(),
                        })),
                      },
                    };
                    try {
                      parse(JSON.stringify(attempt), orgId);
                      opener.current = e.currentTarget.querySelector("button");
                      setReview(attempt);
                      setReplaying(false);
                      setError("");
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Review complete independent date evidence.",
                      );
                    }
                  }}
                >
                  {source.dates.map((d, i) => (
                    <div className="form-field" key={d.postingDate}>
                      <label htmlFor={`original-ledger-evidence-${i}`}>
                        Independent ledger evidence for {d.postingDate}
                      </label>
                      <input
                        id={`original-ledger-evidence-${i}`}
                        name={`evidence-${i}`}
                        required
                        maxLength={1000}
                      />
                    </div>
                  ))}
                  <div className="form-field">
                    <label htmlFor="original-reconciliation-reference">
                      Independent batch reconciliation reference
                    </label>
                    <input
                      id="original-reconciliation-reference"
                      name="externalRef"
                      required
                      maxLength={160}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="original-reconciliation-reason">
                      Reconciliation reason
                    </label>
                    <textarea
                      id="original-reconciliation-reason"
                      name="reason"
                      required
                      maxLength={2000}
                    />
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      name="confirmation"
                      value="all-dates-reconciled"
                      required
                    />{" "}
                    I reconciled every original posting date
                  </label>
                  <button type="submit">
                    Review exact original reconciliation
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
