import React, { useEffect, useMemo, useRef, useState } from "react";
import type { StockJournalDelivery } from "../server/stock-journal-delivery.ts";
import type { JournalLine } from "../server/integration-costs.ts";
import { request } from "./api.ts";
import { StockJournalDecision } from "./stock-journal-decision.tsx";
import { StockJournalOriginalCancellation } from "./stock-journal-original-cancellation.tsx";
import { StockJournalOriginalRetry } from "./stock-journal-original-retry.tsx";
import { StockJournalCancellation } from "./stock-journal-cancellation.tsx";
import { StockJournalPreparation } from "./stock-journal-preparation.tsx";
import { StockJournalPermissions } from "./stock-journal-permissions.tsx";

type Queue = ReturnType<StockJournalDelivery["queue"]>;
type Detail = ReturnType<StockJournalDelivery["detail"]>;
type History = ReturnType<StockJournalDelivery["observations"]>;
type Position = { after: string | null; trail: (string | null)[] };
type QueuePosition = Position & { state: string };
const start: Position = { after: null, trail: [] };

export function StockJournals({
  orgId,
  actorId,
}: {
  orgId: string;
  actorId: string;
}) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [queuePosition, setQueuePosition] = useState<QueuePosition>({
      ...start,
      state: "",
    }),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [history, setHistory] = useState<History | null>(null),
    [historyPosition, setHistoryPosition] = useState<Position>(start),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null),
    active = useRef(true),
    retry = useRef<(() => void) | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    if (detail) heading.current?.focus();
  }, [detail?.id]);
  const read = async (
    work: (signal: AbortSignal) => Promise<() => void>,
    again: () => void,
  ) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    retry.current = again;
    setBusy(true);
    setError("");
    try {
      const apply = await work(controller.signal);
      if (
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted
      )
        apply();
    } catch (e) {
      if (
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted
      )
        setError(
          e instanceof Error
            ? e.message
            : "Journal review could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  const loadQueue = (position: QueuePosition) => {
    setQueue(null);
    const query = new URLSearchParams();
    if (position.state) query.set("state", position.state);
    if (position.after) query.set("after", position.after);
    void read(
      async (signal) => {
        const page = await request<Queue>(`/api/accounting/journals?${query}`, {
          signal,
        });
        return () => {
          setQueue(page);
          setQueuePosition(position);
        };
      },
      () => loadQueue(position),
    );
  };
  const loadDetail = (id: string) => {
    setSelected(id);
    setDetail(null);
    setHistory(null);
    void read(
      async (signal) => {
        const path = `/api/accounting/journals/${encodeURIComponent(id)}`,
          [journal, observations] = await Promise.all([
            request<Detail>(path, { signal }),
            request<History>(path + "/observations", { signal }),
          ]);
        return () => {
          setDetail(journal);
          setHistory(observations);
          setHistoryPosition(start);
        };
      },
      () => loadDetail(id),
    );
  };
  const loadHistory = (id: string, position: Position) => {
    setHistory(null);
    void read(
      async (signal) => {
        const page = await request<History>(
          `/api/accounting/journals/${encodeURIComponent(id)}/observations${position.after ? `?after=${encodeURIComponent(position.after)}` : ""}`,
          { signal },
        );
        return () => {
          setHistory(page);
          setHistoryPosition(position);
        };
      },
      () => loadHistory(id, position),
    );
  };
  const close = () => {
    pending.current?.abort();
    pending.current = null;
    retry.current = null;
    setBusy(false);
    setError("");
    setSelected(null);
    setDetail(null);
    setHistory(null);
    opener.current?.focus();
  };
  const source = detail ? JSON.parse(detail.plan.intent.source.bytes) : null,
    rows: JournalLine[] = detail
      ? (detail.leg === "original"
          ? source.report.journal
          : source[detail.leg]
        ).filter((row: JournalLine) => row.date === detail.postingDate)
      : [];
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: source?.currency ?? "CAD",
      }),
    [source?.currency],
  );
  const money = (value: number) => formatter.format(value / 100);
  return (
    <section aria-label="Stock journal delivery reviews">
      <h2>Stock journal delivery reviews</h2>
      <p>
        Review frozen stock-cost journals for a named QuickBooks sandbox
        company. Approval reserves the reference and queues the journal;
        delivery runs separately. Uncertain delivery remains held for
        reconciliation.
      </p>
      <StockJournalPreparation
        orgId={orgId}
        actorId={actorId}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
      <form
        aria-label="Select journal queue"
        onSubmit={(event) => {
          event.preventDefault();
          const state = String(
            new FormData(event.currentTarget).get("state") ?? "",
          );
          loadQueue({ ...start, state });
        }}
      >
        <div className="form-field">
          <label htmlFor="journal-queue-state">Journal queue state</label>
          <select id="journal-queue-state" name="state" defaultValue="">
            <option value="">All states</option>
            {[
              "ready",
              "rejected",
              "pending",
              "running",
              "unknown",
              "posted",
              "cancelled",
            ].map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </div>
        <button type="submit">Load journal queue</button>
      </form>
      {busy && <p role="status">Loading journal review…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => retry.current?.()}>Retry journal read</button>
        </>
      )}
      {queue && (
        <>
          <p role="status">
            {queue.items.length} journals on this page. Newest preparations
            first; refresh to include later preparations.
          </p>
          {queue.items.length === 0 && <p>No journals match this selection.</p>}
          <div className="table-wrap">
            <table>
              <caption>Retained stock journal deliveries</caption>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Journal</th>
                  <th>Company</th>
                  <th>State</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {queue.items.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <code>{j.requestRef}</code>
                    </td>
                    <td>
                      {j.leg} · {j.postingDate}
                    </td>
                    <td>{j.realm}</td>
                    <td>{j.state}</td>
                    <td>
                      <button
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          loadDetail(j.id);
                        }}
                      >
                        Review journal {j.requestRef}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                loadQueue({ ...start, state: queuePosition.state })
              }
            >
              Refresh journal queue
            </button>
            {queuePosition.trail.length > 0 && (
              <button
                onClick={() =>
                  loadQueue({
                    state: queuePosition.state,
                    after: queuePosition.trail[queuePosition.trail.length - 1]!,
                    trail: queuePosition.trail.slice(0, -1),
                  })
                }
              >
                Newer journals
              </button>
            )}
            {queue.next && (
              <button
                onClick={() =>
                  loadQueue({
                    state: queuePosition.state,
                    after: queue.next,
                    trail: [...queuePosition.trail, queuePosition.after],
                  })
                }
              >
                Older journals
              </button>
            )}
          </div>
        </>
      )}
      {selected && (
        <div className="actions">
          <button onClick={close}>Close journal review</button>
          <button onClick={() => loadDetail(selected)}>
            Refresh journal review
          </button>
        </div>
      )}
      {detail && (
        <section
          className="stock-history"
          aria-label="Frozen stock journal review"
        >
          <h3 ref={heading} tabIndex={-1}>
            Frozen stock journal review
          </h3>
          <p>
            <strong>{detail.state}</strong> · {detail.leg} ·{" "}
            {detail.postingDate} · {source.currency} · sandbox company{" "}
            {detail.realm} · reference <code>{detail.requestRef}</code>.
          </p>
          <p>
            Source <code>{detail.sourceId}</code> · hash{" "}
            <code>{detail.sourceHash}</code>. Review hash{" "}
            <code>{detail.reviewHash}</code>. Binding{" "}
            <code>{detail.bindingId}</code>; attempt{" "}
            {detail.attemptId ?? "initial"}.
          </p>
          <p>
            Prepared by {detail.createdBy} at {detail.createdAt}. Preparation
            reason: {detail.plan.input.reason}.
          </p>
          <p>
            Cost policy revision {detail.plan.input.policyRevision}; company
            permission revision {detail.plan.input.authority.revision},{" "}
            {detail.plan.input.authority.region}. Reviewed terms{" "}
            <code>{detail.plan.input.authority.disclosureId}</code>, hash{" "}
            <code>{detail.plan.input.authority.disclosureHash}</code>.
          </p>
          {detail.decisionBy && (
            <p>
              Decision by {detail.decisionBy} at {detail.decisionAt}:{" "}
              {detail.decisionReason}.
            </p>
          )}
          {detail.externalId && (
            <p>Observed external journal: {detail.externalId}.</p>
          )}
          <div className="table-wrap">
            <table>
              <caption>Frozen journal lines for {detail.postingDate}</caption>
              <thead>
                <tr>
                  <th>Source account</th>
                  <th>Receiver account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.account}</td>
                    <td>
                      {
                        detail.plan.input.accounts.find(
                          (a) => a.sourceAccount === row.account,
                        )?.accountId
                      }
                    </td>
                    <td>{money(row.debit)}</td>
                    <td>{money(row.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section aria-label="Journal observation history">
            <h4>Journal observation history</h4>
            <p>
              Retained observations report delivery evidence. Reading history
              does not reconcile or resend a journal.
            </p>
            {history && (
              <>
                <p role="status">
                  {history.items.length} observations on this page.
                </p>
                {history.items.map((observation) => (
                  <details key={observation.revision}>
                    <summary>
                      Observation {observation.revision} ·{" "}
                      {observation.recordedAt}
                    </summary>
                    <p>
                      Recorded by {observation.recordedBy}; hash{" "}
                      <code>{observation.hash}</code>.
                    </p>
                    <pre>{JSON.stringify(observation.body, null, 2)}</pre>
                  </details>
                ))}
                <div className="actions">
                  <button onClick={() => loadHistory(detail.id, start)}>
                    Refresh journal observations
                  </button>
                  {historyPosition.trail.length > 0 && (
                    <button
                      onClick={() =>
                        loadHistory(detail.id, {
                          after:
                            historyPosition.trail[
                              historyPosition.trail.length - 1
                            ]!,
                          trail: historyPosition.trail.slice(0, -1),
                        })
                      }
                    >
                      Newer journal observations
                    </button>
                  )}
                  {history.next && (
                    <button
                      onClick={() =>
                        loadHistory(detail.id, {
                          after: history.next,
                          trail: [
                            ...historyPosition.trail,
                            historyPosition.after,
                          ],
                        })
                      }
                    >
                      Older journal observations
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </section>
      )}
      <StockJournalDecision
        orgId={orgId}
        actorId={actorId}
        journal={detail}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
      <StockJournalPermissions
        orgId={orgId}
        actorId={actorId}
        journal={detail}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
      <StockJournalOriginalCancellation
        orgId={orgId}
        actorId={actorId}
        journal={detail}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
      <StockJournalOriginalRetry
        orgId={orgId}
        actorId={actorId}
        journal={detail}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
      <StockJournalCancellation
        orgId={orgId}
        actorId={actorId}
        journal={detail}
        saved={(id) => {
          setQueue(null);
          loadDetail(id);
        }}
      />
    </section>
  );
}
