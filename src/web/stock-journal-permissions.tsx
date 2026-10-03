import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LedgerDisclosure } from "../server/organization-residency.ts";
import type { PermissionReview } from "../server/stock-journal-permissions.ts";
import { request } from "./api.ts";
import * as evidence from "./stock-journal-permission-contract.ts";
import type {
  Attempt,
  History,
  Journal,
  Prospect,
  Selection,
} from "./stock-journal-permission-contract.ts";

function retained(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return { attempt: raw === null ? null : evidence.parse(raw), error: "" };
  } catch {
    return { attempt: null, error: evidence.recoveryError };
  }
}
function Terms({ value: d }: { value: LedgerDisclosure }) {
  return (
    <section aria-label="Replacement ledger disclosure">
      <h4>Replacement ledger disclosure</h4>
      <p>
        {d.region} · QuickBooks sandbox · stock-cost-journal · version{" "}
        {d.version}.
      </p>
      <p>Purpose: {d.purposes}</p>
      <p>Minimum data: {d.minimumData.join("; ")}</p>
      <p>Processing countries: {d.processingCountries.join(", ")}</p>
      <p>Subprocessors: {d.subprocessors.join("; ")}</p>
      <p>Retention: {d.retention}</p>
      <p>Withdrawal: {d.withdrawal}</p>
      <p>Terms reference: {d.termsReference}</p>
      <p>Review evidence: {d.reviewEvidence}</p>
      <p>
        Disclosure <code>{d.id}</code> · hash <code>{d.hash}</code>.
      </p>
    </section>
  );
}
function Source({ value: s }: { value: Selection }) {
  return (
    <>
      <p>
        Journal <code>{s.id}</code> · {s.leg} · {s.postingDate} · sandbox
        company {s.realm} · {s.plan.input.authority.region}.
      </p>
      <p>
        Source <code>{s.sourceId}</code> · source hash{" "}
        <code>{s.sourceHash}</code> · original journal hash{" "}
        <code>{s.reviewHash}</code>.
      </p>
      <p>
        Permanent reference <code>{s.requestRef}</code> · binding{" "}
        <code>{s.bindingId}</code> · attempt {s.attemptId ?? "initial"}.
      </p>
      <p>
        Original journal, accounts, date, company and source remain unchanged.
        Permission review does not send or reconcile a journal.
      </p>
    </>
  );
}
export function StockJournalPermissions({
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
  const storageKey = `distributor-journal-permission:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey)),
    [prospect, setProspect] = useState<Prospect | null>(null),
    [history, setHistory] = useState<{
      selection: Selection;
      value: History;
    } | null>(null),
    [chosen, setChosen] = useState<{
      selection: Selection;
      prepared: PermissionReview;
      disclosure: LedgerDisclosure;
    } | null>(null),
    [review, setReview] = useState<Attempt | null>(null),
    [replaying, setReplaying] = useState(false),
    [reading, setReading] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(true),
    readPending = useRef<AbortController | null>(null),
    commandPending = useRef<AbortController | null>(null),
    retry = useRef<(() => void) | null>(null),
    selected = useRef<string | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    root = useRef<HTMLElement>(null),
    restoreFocus = useRef<string | null>(null),
    opener = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    selected.current = journal?.id ?? null;
  }, [journal?.id]);
  useEffect(() => {
    active.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setRecovery(retained(storageKey));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      readPending.current?.abort();
      commandPending.current?.abort();
      readPending.current = null;
      commandPending.current = null;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey]);
  useEffect(() => {
    readPending.current?.abort();
    readPending.current = null;
    retry.current = null;
    setReading(false);
    setProspect(null);
    setHistory(null);
    setChosen(null);
  }, [journal?.id]);
  useEffect(() => {
    if (review) heading.current?.focus();
    else if (restoreFocus.current) {
      const name = restoreFocus.current;
      restoreFocus.current = null;
      const button = Array.from(
        root.current?.querySelectorAll("button") ?? [],
      ).find((b) => !b.disabled && b.textContent === name);
      button?.focus();
    }
  }, [review]);
  const read = async (
    work: (signal: AbortSignal) => Promise<() => void>,
    again: () => void,
    id: string | null,
  ) => {
    if (commandPending.current) return;
    readPending.current?.abort();
    const controller = new AbortController();
    readPending.current = controller;
    retry.current = again;
    const current = () =>
      active.current &&
      readPending.current === controller &&
      !controller.signal.aborted &&
      selected.current === id;
    setReading(true);
    setError("");
    setNotice("");
    try {
      const apply = await work(controller.signal);
      if (current()) apply();
    } catch (e) {
      if (current())
        setError(
          e instanceof Error
            ? e.message
            : "Journal permission review could not be loaded.",
        );
    } finally {
      if (readPending.current === controller) {
        readPending.current = null;
        if (active.current) setReading(false);
      }
    }
  };
  const loadProspect = (j: Journal) => {
    setProspect(null);
    setChosen(null);
    void read(
      async (signal) => {
        const value = await request<
          ReturnType<
            import("../server/stock-journal-delivery.ts").StockJournalDelivery["permissionReview"]
          >
        >(
          `/api/accounting/journals/${encodeURIComponent(j.id)}/permission-review`,
          { signal },
        );
        const p = await evidence.prospect(value, j, orgId);
        return () => setProspect(p);
      },
      () => loadProspect(j),
      j.id,
    );
  };
  const loadHistory = (j: Journal, reviewId?: string) => {
    setHistory(null);
    setChosen(null);
    void read(
      async (signal) => {
        const s = await evidence.selection(j, orgId),
          value = await request<History>(
            `/api/accounting/journals/${encodeURIComponent(j.id)}/permissions${reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : ""}`,
            { signal },
          );
        await evidence.history(value, s, orgId, reviewId);
        return () => setHistory({ selection: s, value });
      },
      () => loadHistory(j, reviewId),
      j.id,
    );
  };
  const choose = (s: Selection, r: PermissionReview) => {
    setChosen(null);
    void read(
      async (signal) => {
        await evidence.prepared(r, s, orgId);
        const d = await request<LedgerDisclosure>(
          `/api/organization/ledger-disclosures/${encodeURIComponent(r.input.authority.disclosureId)}`,
          { signal },
        );
        await evidence.disclosure(d, r.input.authority);
        return () => setChosen({ selection: s, prepared: r, disclosure: d });
      },
      () => choose(s, r),
      s.id,
    );
  };
  const freeze = async (a: Attempt, recovering: boolean) => {
    const id = selected.current;
    await read(
      async () => {
        await evidence.attempt(a, orgId, actorId);
        return () => {
          setReview(a);
          setReplaying(recovering);
        };
      },
      () => void freeze(a, recovering),
      id,
    );
  };
  const close = () => {
    readPending.current?.abort();
    readPending.current = null;
    retry.current = null;
    setReading(false);
    restoreFocus.current = opener.current?.textContent ?? null;
    setReview(null);
    setError("");
  };
  const submit = async () => {
    if (!review || commandPending.current || readPending.current) return;
    const a = review,
      controller = new AbortController();
    commandPending.current = controller;
    retry.current = null;
    const current = () =>
      active.current &&
      commandPending.current === controller &&
      !controller.signal.aborted;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await evidence.attempt(a, orgId, actorId);
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate journal permission attempts between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!current()) return;
          if (!lock)
            throw Error(
              "Another tab is submitting a journal permission attempt. Wait for its outcome before recovery.",
            );
          const previous = retained(storageKey);
          if (previous.error) throw Error(previous.error);
          if (
            replaying
              ? evidence.canonical(previous.attempt) !== evidence.canonical(a)
              : !!previous.attempt
          )
            throw Error(
              "Journal permission recovery evidence changed. Close this review and review the retained original attempt.",
            );
          const raw = JSON.stringify(a);
          evidence.parse(raw);
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "The exact journal permission attempt could not be retained. Nothing was sent.",
            );
          if (current()) {
            setRecovery({ attempt: a, error: "" });
            setReplaying(true);
          }
          controller.signal.throwIfAborted();
          let result: unknown;
          // A retained independent decision first reads its original observation.
          // Missing decisions alone allow the exact-key cached command fallback.
          if (replaying && a.kind === "decide") {
            const h = await request<History>(
              `/api/accounting/journals/${encodeURIComponent(a.selection.id)}/permissions?reviewId=${encodeURIComponent(a.prepared.id)}`,
              { signal: controller.signal },
            );
            await evidence.history(h, a.selection, orgId, a.prepared.id);
            const r = h.reviews[0]!;
            if (
              evidence.canonical({ ...r, decision: null }) !==
              evidence.canonical(a.prepared)
            )
              throw Error(
                "Retained permission review changed. Preserve and reconcile the original attempt.",
              );
            if (r.decision !== null) {
              await evidence.receipt(r.decision, a, orgId, actorId);
              result = r.decision;
            }
          }
          controller.signal.throwIfAborted();
          if (result === undefined)
            result = await request(
              `/api/commands/accounting.journal.permission.${a.kind}`,
              {
                signal: controller.signal,
                method: "POST",
                headers: { "idempotency-key": a.key },
                body: JSON.stringify(a.payload),
              },
            );
          await evidence.receipt(result, a, orgId, actorId);
          if (!current()) return;
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(
              "Journal permission recovery evidence changed. The original attempt has been preserved.",
            );
          localStorage.removeItem(storageKey);
          if (localStorage.getItem(storageKey) !== null)
            throw Error(
              "Journal permission recovery evidence could not be cleared. Recover the retained exact attempt after restoring storage.",
            );
          if (current()) {
            setRecovery({ attempt: null, error: "" });
            setReview(null);
            setProspect(null);
            setHistory(null);
            setChosen(null);
            setNotice(
              a.kind === "prepare"
                ? `Permission review recorded: ${(result as PermissionReview).id}. A different finance principal must decide it.`
                : "Permission decision confirmed. Refresh history for the effective permission; the journal was not sent.",
            );
            saved(a.selection.id);
          }
        },
      );
    } catch (e) {
      if (current()) {
        setRecovery(retained(storageKey));
        setError(
          e instanceof Error
            ? e.message
            : "Journal permission attempt could not be confirmed.",
        );
      }
    } finally {
      if (commandPending.current === controller) {
        commandPending.current = null;
        if (active.current) setSubmitting(false);
      }
    }
  };
  const unavailable =
    submitting || reading || !!recovery.error || !!recovery.attempt || !!review;
  return (
    <section aria-label="Journal permission replacement" ref={root}>
      <h3>Journal permission replacement</h3>
      <p>
        Review the current organization choice separately from the frozen
        journal. A different finance principal approves or rejects the
        replacement. Unknown or expired delivery outcomes permit lookup only.
      </p>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {recovery.attempt && !review && (
        <>
          <p role="status">
            An exact permission attempt is retained for this organization and
            principal.
          </p>
          <button
            disabled={reading || submitting}
            onClick={(e) => {
              opener.current = e.currentTarget;
              void freeze(recovery.attempt!, true);
            }}
          >
            Review retained journal permission attempt
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {reading && <p role="status">Loading journal permission evidence…</p>}
      {error && retry.current && !submitting && (
        <button onClick={() => retry.current?.()}>
          Retry journal permission read
        </button>
      )}
      {reading && (
        <button onClick={close}>Cancel journal permission read</button>
      )}
      {review ? (
        <section
          aria-label="Exact journal permission review"
          className="stock-history"
        >
          <h4 tabIndex={-1} ref={heading}>
            Exact journal permission review
          </h4>
          <Source value={review.selection} />
          <p>
            {replaying
              ? "Recover the retained original attempt and its historical receipt."
              : "Confirm this fixed permission attempt."}
          </p>
          {review.kind === "prepare" ? (
            <>
              <p>
                Prepare replacement for <strong>{review.payload.mode}</strong>{" "}
                only. Previous permission hash{" "}
                <code>{review.payload.previousPermissionHash}</code>.
              </p>
              <p>
                Previous revision {review.previousAuthority.revision}; proposed
                revision {review.payload.authority.revision}. Reason:{" "}
                {review.payload.reason}
              </p>
            </>
          ) : (
            <>
              <p>
                Decision: <strong>{review.payload.decision}</strong> ·
                permission review <code>{review.prepared.id}</code> · review
                hash <code>{review.prepared.reviewHash}</code>.
              </p>
              <p>
                Prepared by {review.prepared.observation.recordedBy}. Permission
                mode: <strong>{review.prepared.input.mode}</strong>. Proposed
                revision {review.prepared.input.authority.revision}; predecessor
                hash <code>{review.prepared.input.previousPermissionHash}</code>
                .
              </p>
              <p>Preparation reason: {review.prepared.input.reason}</p>
              <p>Decision reason: {review.payload.reason}</p>
            </>
          )}
          <Terms value={review.disclosure} />
          <div className="actions">
            <button
              disabled={submitting || reading || !!recovery.error}
              onClick={() => void submit()}
            >
              {replaying
                ? "Recover exact journal permission attempt"
                : "Confirm journal permission attempt"}
            </button>
            <button disabled={submitting} onClick={close}>
              Close journal permission review
            </button>
          </div>
        </section>
      ) : (
        <>
          {journal && (
            <div className="actions">
              <button
                disabled={
                  unavailable ||
                  !["pending", "unknown", "running"].includes(journal.state)
                }
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  loadProspect(journal);
                }}
              >
                Load replacement permission
              </button>
              <button
                disabled={unavailable}
                onClick={() => loadHistory(journal)}
              >
                Load journal permission history
              </button>
            </div>
          )}
          {prospect && (
            <section
              aria-label="Prospective journal permission"
              className="stock-history"
            >
              <Source value={prospect.selection} />
              <p>
                Previous revision {prospect.previousAuthority.revision};
                proposed revision {prospect.authority.revision}. Operation:{" "}
                <strong>{prospect.mode}</strong> only.
              </p>
              <p>
                Previous permission hash{" "}
                <code>{prospect.previousPermissionHash}</code>.
              </p>
              <Terms value={prospect.disclosure} />
              <form
                aria-label="Prepare replacement permission"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = String(
                    new FormData(e.currentTarget).get("reason") ?? "",
                  ).trim();
                  if (!evidence.text(reason, 2000)) return;
                  void freeze(
                    {
                      kind: "prepare",
                      key: crypto.randomUUID(),
                      selection: prospect.selection,
                      previousAuthority: prospect.previousAuthority,
                      disclosure: prospect.disclosure,
                      payload: {
                        journalId: prospect.selection.id,
                        reviewHash: prospect.selection.reviewHash,
                        previousPermissionHash: prospect.previousPermissionHash,
                        authority: prospect.authority,
                        mode: prospect.mode,
                        reason,
                      },
                    },
                    false,
                  );
                }}
              >
                <div className="form-field">
                  <label htmlFor="permission-prepare-reason">
                    Permission preparation reason
                  </label>
                  <textarea
                    id="permission-prepare-reason"
                    name="reason"
                    required
                    maxLength={2000}
                  />
                </div>
                <button disabled={unavailable}>
                  Review exact permission preparation
                </button>
              </form>
            </section>
          )}
          {journal && (
            <form
              aria-label="Read exact permission review"
              onSubmit={(e) => {
                e.preventDefault();
                const id = String(
                  new FormData(e.currentTarget).get("reviewId") ?? "",
                ).trim();
                if (evidence.text(id)) loadHistory(journal, id);
              }}
            >
              <div className="form-field">
                <label htmlFor="permission-history-id">
                  Retained permission review ID
                </label>
                <input
                  id="permission-history-id"
                  name="reviewId"
                  required
                  maxLength={160}
                />
              </div>
              <button disabled={unavailable}>
                Read retained permission review
              </button>
            </form>
          )}
          {history && (
            <section aria-label="Journal permission history">
              <h4>Journal permission history</h4>
              <p>
                Historical effective revision {history.value.authority.revision}{" "}
                · {history.value.mode} only. History grants no current execution
                permission.
              </p>
              <p role="status">
                {history.value.reviews.length} retained reviews.
                {history.value.olderReviews
                  ? " Older reviews are available by exact review ID."
                  : ""}
              </p>
              {history.value.reviews.map((r) => (
                <details key={r.id}>
                  <summary>
                    Permission review {r.id} · {r.input.mode} ·{" "}
                    {r.decision
                      ? (r.decision.body as { input: { decision: string } })
                          .input.decision
                      : "awaiting independent decision"}
                  </summary>
                  <p>
                    Revision {r.input.authority.revision} · preparer{" "}
                    {r.observation.recordedBy} · {r.observation.recordedAt} ·
                    hash <code>{r.reviewHash}</code>.
                  </p>
                  <p>Reason: {r.input.reason}</p>
                  {r.decision && (
                    <p>
                      Decision by {r.decision.recordedBy} ·{" "}
                      {r.decision.recordedAt} ·{" "}
                      {
                        (r.decision.body as { input: { reason: string } }).input
                          .reason
                      }{" "}
                      · observation hash <code>{r.decision.hash}</code>.
                    </p>
                  )}
                  {!r.decision &&
                    (r.observation.recordedBy === actorId ? (
                      <p>
                        A different current finance principal must decide this
                        replacement permission.
                      </p>
                    ) : (
                      <button
                        disabled={unavailable}
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          choose(history.selection, r);
                        }}
                      >
                        Review permission decision {r.id}
                      </button>
                    ))}
                </details>
              ))}
            </section>
          )}
          {chosen && (
            <section
              aria-label="Independent permission decision"
              className="stock-history"
            >
              <Source value={chosen.selection} />
              <p>
                Permission review <code>{chosen.prepared.id}</code> ·{" "}
                {chosen.prepared.input.mode} only · proposed revision{" "}
                {chosen.prepared.input.authority.revision}.
              </p>
              <p>
                Prepared by {chosen.prepared.observation.recordedBy}; reason:{" "}
                {chosen.prepared.input.reason}
              </p>
              <Terms value={chosen.disclosure} />
              <form
                aria-label="Decide replacement permission"
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget),
                    decision = String(values.get("decision")),
                    reason = String(values.get("reason") ?? "").trim();
                  if (
                    !["approve", "reject"].includes(decision) ||
                    !evidence.text(reason, 2000)
                  )
                    return;
                  void freeze(
                    {
                      kind: "decide",
                      key: crypto.randomUUID(),
                      selection: chosen.selection,
                      disclosure: chosen.disclosure,
                      prepared: chosen.prepared,
                      payload: {
                        journalId: chosen.selection.id,
                        permissionReviewId: chosen.prepared.id,
                        permissionReviewHash: chosen.prepared.reviewHash,
                        decision: decision as "approve" | "reject",
                        reason,
                      },
                    },
                    false,
                  );
                }}
              >
                <div className="form-field">
                  <label htmlFor="permission-decision">
                    Permission decision
                  </label>
                  <select id="permission-decision" name="decision">
                    <option value="approve">Approve</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="permission-decision-reason">
                    Permission decision reason
                  </label>
                  <textarea
                    id="permission-decision-reason"
                    name="reason"
                    required
                    maxLength={2000}
                  />
                </div>
                <button disabled={unavailable}>
                  Review exact permission decision
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </section>
  );
}
