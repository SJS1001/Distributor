import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import "./operations-lane.css";

export type Delivery = {
  event_id: string;
  state: string;
  attempts: number;
  cycle_attempts: number;
  revision: number;
  consumer_version: number;
  last_error: string | null;
  updated_at: string;
};
type Diagnostics = {
  registered: boolean;
  totals: { state: string; count: number }[];
  pending: { count: number; oldest: string | null };
  items: Delivery[];
  next: string | null;
};
const endpoint = "/api/events/event-report/deliveries";
const stateName = (state: string) => state.replaceAll("_", " ");

function AttemptHistory({
  eventId,
  close,
}: {
  eventId: string;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = usePages(
    `${endpoint}/${encodeURIComponent(eventId)}/history`,
    undefined,
    "before",
  );
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-label="Event attempt history">
      <h3 ref={heading} tabIndex={-1}>
        Event attempt history — {eventId}
      </h3>
      <button className="secondary" onClick={close}>
        Close attempt history
      </button>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} attempts loaded{rows.busy ? " · Loading…" : ""}
      </p>
      <ol>
        {rows.items.map((attempt) => (
          <li key={attempt.attempt}>
            Attempt {attempt.attempt} · {stateName(attempt.outcome)} · report
            version {attempt.consumer_version}
            <p>
              Started {attempt.claimed_at}
              {attempt.finished_at
                ? ` · Finished ${attempt.finished_at}`
                : " · No completion recorded"}
            </p>
            {attempt.error_code && <p>Failure code: {attempt.error_code}</p>}
          </li>
        ))}
      </ol>
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No attempts are recorded.</p>
      )}
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry attempt history" : "Load older attempts"}
        </button>
      )}
    </section>
  );
}

export function EventReporting({
  admin,
  retry,
}: {
  admin: boolean;
  retry: (delivery: Delivery) => void;
}) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const current = useRef<Diagnostics | null>(null);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const load = async () => {
    if (pending.current || (current.current && !current.current.next)) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    const previous = current.current;
    try {
      const result = await request<Diagnostics>(
        endpoint +
          (previous?.next ? `?after=${encodeURIComponent(previous.next)}` : ""),
        { signal: controller.signal },
      );
      if (!active.current || pending.current !== controller) return;
      const items = new Map(
        (previous?.items ?? []).map((row) => [row.event_id, row]),
      );
      for (const row of result.items) items.set(row.event_id, row);
      const merged = { ...result, items: [...items.values()] };
      current.current = merged;
      setData(merged);
      if (previous && !result.next) heading.current?.focus();
    } catch (e) {
      if (
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted
      )
        setError(
          e instanceof Error
            ? e.message
            : "Event deliveries could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, []);
  return (
    <section className="panel ops-events" aria-label="Event reporting">
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Local event reporting
        </h2>
        <InfoBubble label="Local event reporting">
          Optional metadata reporting. Native stock, orders and billing remain
          authoritative. A reviewed retry queues an event; processing requires a
          separately enabled local worker. Delivery pages are live. Use Refresh
          after worker activity to reload current states.
        </InfoBubble>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">
        {data?.items.length ?? 0}{" "}
        {data?.items.length === 1 ? "delivery" : "deliveries"} loaded
        {busy ? " · Loading…" : ""}
      </p>
      {data && (
        <>
          {!data.registered && (
            <p role="status">
              Event reporting is not registered. History is retained; retries
              are unavailable.
            </p>
          )}
          <dl className="record-figures ops-figures">
            <div>
              <dt>Unclaimed events</dt>
              <dd>{data.pending.count}</dd>
            </div>
            <div>
              <dt>Oldest unclaimed</dt>
              <dd>{data.pending.oldest ?? "None"}</dd>
            </div>
          </dl>
          <ul aria-label="Delivery totals" className="ops-chips">
            {data.totals.map((total) => (
              <li key={total.state}>
                {stateName(total.state)}: {total.count}
              </li>
            ))}
          </ul>
          {!data.items.length && (
            <p className="empty">
              No event deliveries are recorded.{" "}
              {data.pending.count
                ? "Unclaimed events wait for a separately enabled local worker to process them; use Refresh after worker activity."
                : "Deliveries appear here after events are processed."}
            </p>
          )}
          {!!data.items.length && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>State</th>
                    <th>Attempts</th>
                    <th>Last failure</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.event_id}>
                      <td>{row.event_id}</td>
                      <td>{stateName(row.state)}</td>
                      <td>
                        {row.attempts} total · {row.cycle_attempts} this cycle
                      </td>
                      <td>{row.last_error ?? "None"}</td>
                      <td>{row.updated_at}</td>
                      <td>
                        <div className="actions">
                          <button
                            className="secondary"
                            onClick={(event) => {
                              opener.current = event.currentTarget;
                              setSelected(row.event_id);
                            }}
                          >
                            View attempts
                          </button>
                          {admin &&
                            data.registered &&
                            ["retry", "quarantined"].includes(row.state) && (
                              <button onClick={() => retry(row)}>
                                Review retry
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {(data?.next || error) && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {error ? "Retry event deliveries" : "Load older deliveries"}
        </button>
      )}
      {selected && (
        <AttemptHistory
          key={selected}
          eventId={selected}
          close={() => {
            setSelected(null);
            if (opener.current?.isConnected) opener.current.focus();
          }}
        />
      )}
    </section>
  );
}
