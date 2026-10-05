import React, { useEffect, useRef, useState } from "react";
import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import { request, RequestError } from "./api.ts";
import { canonical } from "./stock-journal-reconciliation-contract.ts";
import {
  checkedAttempt,
  checkedReview,
  checkedReceipt,
  retained,
  type Attempt,
  type Review,
} from "./stock-journal-original-retry-contract.ts";
function FixedReview({ review: r }: { review: Review }) {
  const s = r.snapshot,
    p = r.plan,
    e = r.evidence,
    c = r.cancellation;
  return (
    <>
      <p>
        Cancelled original <code>{s.journalId}</code> · {s.postingDate} ·{" "}
        {s.region} / {s.currency} · debit {s.debit} cents · credit {s.credit}{" "}
        cents.
      </p>
      <p>
        Sandbox company {s.realm} · binding <code>{s.bindingId}</code> ·
        previous permanent reference <code>{s.requestRef}</code>.
      </p>
      <p>
        Final non-posting evidence <code>{e.evidenceHash}</code> ·{" "}
        {e.recordedBy} at {e.recordedAt} · receiver case {e.input.externalRef}:{" "}
        {e.input.evidence}
      </p>
      <p>
        Independent cancellation <code>{c.hash}</code> · {c.recordedBy} at{" "}
        {c.recordedAt} · {c.body.reason as string}.
      </p>
      <p>
        Cost policy version {p.input.policyRevision} · closed through{" "}
        {p.intent.closedThrough ?? "no date"}.
      </p>
      <p>
        Current permission version {p.input.authority.revision} · accepted terms{" "}
        <code>{p.input.authority.disclosureId}</code>.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Accounts for the new journal</caption>
          <thead>
            <tr>
              <th>Source account</th>
              <th>QuickBooks sandbox account</th>
            </tr>
          </thead>
          <tbody>
            {p.input.accounts.map((a) => (
              <tr key={a.sourceAccount}>
                <td>{a.sourceAccount}</td>
                <td>{a.accountId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Preparing this retry creates a new journal with its own reference. A
        different authorized finance user must approve it before it can be sent.
      </p>
      <details>
        <summary>Technical verification details</summary>
        <p>
          Source <code>{s.sourceId}</code> · source hash{" "}
          <code>{s.sourceHash}</code> · previous review hash{" "}
          <code>{s.reviewHash}</code> · complete predecessor history hash{" "}
          <code>{s.historyHash}</code>.
        </p>
        <p>
          Cost policy hash <code>{p.policyHash}</code> · accepted terms hash{" "}
          <code>{p.input.authority.disclosureHash}</code> · fixed retry review
          hash <code>{r.reviewHash}</code>.
        </p>
      </details>
    </>
  );
}
export function StockJournalOriginalRetry({
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
  const storageKey = `distributor-original-journal-retry:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey, orgId)),
    [source, setSource] = useState<Review | null>(null),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
    const changed = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null)
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
    setSource(null);
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
  const load = async () => {
    if (!journal || reading.current) return;
    const controller = new AbortController();
    reading.current = controller;
    const current = () =>
      active.current &&
      reading.current === controller &&
      !controller.signal.aborted;
    setLoading(true);
    setError("");
    setSource(null);
    try {
      const raw = await request(
        `/api/accounting/journals/${encodeURIComponent(journal.id)}/original-retry-review`,
        { signal: controller.signal },
      );
      const checked = await checkedReview(raw, orgId, journal.id);
      if (current()) setSource(checked);
    } catch (e) {
      if (current())
        setError(
          e instanceof Error
            ? e.message
            : "Journal details could not be loaded. Try reviewing the cancelled journal again.",
        );
    } finally {
      if (reading.current === controller) {
        reading.current = null;
        if (active.current) setLoading(false);
      }
    }
  };
  const prepare = async (a: Attempt, replay = false) => {
    setError("");
    try {
      await checkedAttempt(a, orgId);
      if (active.current) {
        setReview(a);
        setReplaying(replay);
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Original retry evidence could not be verified.",
        );
    }
  };
  const submit = async () => {
    if (!review || pending.current) return;
    const a = review,
      recovering = replaying,
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
          "This browser cannot safely coordinate journal preparation across tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is preparing this journal. Wait for its result before continuing.",
            );
          const previous = retained(storageKey, orgId);
          if (previous.error) throw Error(previous.error);
          if (
            recovering
              ? canonical(previous.attempt) !== canonical(a)
              : !!previous.attempt
          )
            throw Error(
              "The saved preparation changed in another tab. Close this review and review the saved preparation again.",
            );
          await checkedAttempt(a, orgId);
          if (!current()) return;
          const latest = retained(storageKey, orgId);
          if (
            latest.error ||
            canonical(latest.attempt) !== canonical(previous.attempt)
          )
            throw Error(
              "The saved preparation changed in another tab. It has been preserved; close this review and review it again.",
            );
          const raw = JSON.stringify(a);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "This preparation could not be saved in your browser. Nothing was sent. Restore browser storage before trying again.",
            );
          setRecovery({ attempt: a, error: "" });
          setReplaying(true);
          const clear = () => {
            if (!current()) return false;
            if (localStorage.getItem(storageKey) !== raw)
              throw Error(
                "The saved preparation changed in another tab. It has been preserved; close this review and review it again.",
              );
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) !== null)
              throw Error(
                "The saved preparation could not be cleared from your browser. Restore browser storage, then recover the saved preparation to confirm its result.",
              );
            setRecovery({ attempt: null, error: "" });
            restoreFocus.current = true;
            setReview(null);
            setSource(null);
            return true;
          };
          let result: unknown;
          try {
            controller.signal.throwIfAborted();
            result = await request(
              "/api/commands/accounting.journal.original-retry.prepare",
              {
                signal: controller.signal,
                method: "POST",
                headers: { "idempotency-key": a.key },
                body: JSON.stringify(a.payload),
              },
            );
          } catch (e) {
            // Only a newly refused command can release its newly retained attempt.
            // Recovery refusals never resolve uncertainty about the earlier command.
            if (
              !recovering &&
              e instanceof RequestError &&
              e.status === 409 &&
              ["JOURNAL_DUPLICATE", "JOURNAL_REVIEW_CHANGED"].includes(
                e.code ?? "",
              )
            )
              clear();
            throw e;
          }
          let receipt;
          try {
            receipt = await checkedReceipt(result, a, actorId);
          } catch {
            throw Error(
              "We couldn't confirm this journal preparation. Recover the saved preparation before starting another attempt.",
            );
          }
          if (clear()) {
            setNotice(
              "Journal preparation confirmed. Check the journal's current status: this confirmation does not change any later activity. Preparation alone does not approve or send the journal.",
            );
            saved(receipt.id);
          }
        },
      );
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey, orgId));
        setError(
          e instanceof Error
            ? e.message
            : "Original retry could not be confirmed.",
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
    journal?.state === "cancelled" &&
    journal.leg === "original" &&
    !recovery.attempt &&
    !recovery.error;
  return (
    <section aria-label="Original journal retry">
      <h3 ref={sectionHeading} tabIndex={-1}>
        Original journal retry
      </h3>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            A journal preparation is saved for your user in this organization.
            Review it before starting another attempt.
          </p>
          <button
            ref={recoverButton}
            onClick={() => void prepare(recovery.attempt!, true)}
          >
            Review saved journal preparation
          </button>
        </>
      )}
      {review ? (
        <section
          className="stock-history"
          aria-label="Review journal preparation"
        >
          <h4 ref={heading} tabIndex={-1}>
            Review journal preparation
          </h4>
          <FixedReview review={review.review} />
          <p>Reason for retry: {review.payload.reason}.</p>
          <p>
            {replaying
              ? "Continue the saved preparation using the same request and details. Your finance access is checked again. If this preparation already succeeded, recovery confirms that attempt instead of creating another journal."
              : "Review the cancelled journal, source, posting date, company and account mappings above. Preparing a new journal does not carry over the previous approval."}
          </p>
          <details>
            <summary>Preparation reference</summary>
            <code>{review.key}</code>
          </details>
          <div className="actions">
            <button
              disabled={busy || !!recovery.error}
              onClick={() => void submit()}
            >
              {replaying ? "Recover saved preparation" : "Prepare new journal"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                restoreFocus.current = true;
                setReview(null);
                setError("");
              }}
            >
              Close journal review
            </button>
          </div>
        </section>
      ) : eligible ? (
        <>
          <button
            ref={loadButton}
            disabled={loading}
            onClick={() => void load()}
          >
            Review cancelled journal
          </button>
          {loading && <p role="status">Loading journal details for review</p>}
          {source && (
            <form
              aria-label="Original retry entry"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void prepare({
                  key: crypto.randomUUID(),
                  review: structuredClone(source),
                  payload: {
                    journalId: source.snapshot.journalId,
                    reviewHash: source.reviewHash,
                    reason: String(data.get("reason") ?? "").trim(),
                  },
                });
              }}
            >
              <FixedReview review={source} />
              <div className="form-field">
                <label htmlFor="original-retry-reason">
                  Original retry reason
                </label>
                <textarea
                  id="original-retry-reason"
                  name="reason"
                  required
                  maxLength={2000}
                />
              </div>
              <button type="submit">Review new journal</button>
            </form>
          )}
        </>
      ) : !recovery.attempt && !recovery.error ? (
        <p>
          Select a final independently cancelled original journal to review a
          fresh attempt.
        </p>
      ) : null}
      {busy && <p role="status">Confirming journal preparation</p>}
    </section>
  );
}
