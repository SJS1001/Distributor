import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import "./operations-lane.css";
import type { OperationsHealth } from "../shared/operations-health.ts";

const attentionStates = new Set([
  "unknown",
  "blocked",
  "failed",
  "rejected",
  "quarantined",
  "requires_action",
]);
function age(createdAt: string | null, checkedAt: string) {
  if (!createdAt) return "No creation time recorded";
  const minutes = Math.floor(
    (Date.parse(checkedAt) - Date.parse(createdAt)) / 60000,
  );
  if (!Number.isFinite(minutes)) return "Creation time is invalid";
  if (minutes < 0) return `Created ${createdAt} · clock is ahead of this check`;
  return `Created ${createdAt} · ${minutes} minutes old at this check`;
}

// Readable check time; the exact ISO value stays in the title and dateTime.
function checkedLabel(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]} UTC` : value;
}

export function OperationsHealthPanel() {
  const [data, setData] = useState<OperationsHealth | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const load = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setData(null);
    setError("");
    setBusy(true);
    try {
      const result = await request<OperationsHealth>("/api/operations/health", {
        signal: controller.signal,
      });
      if (pending.current === controller && !controller.signal.aborted)
        setData(result);
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Operations health is unavailable.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, []);
  const active = data?.queues.filter((queue) =>
    queue.states.some((row) => row.count > 0),
  );
  const attention = data?.queues.reduce(
    (total, queue) =>
      total +
      queue.states
        .filter((row) => attentionStates.has(row.state))
        .reduce((sum, row) => sum + row.count, 0),
    0,
  );
  const due = data?.queues.reduce(
    (total, queue) => total + (queue.due ?? 0),
    0,
  );
  return (
    <section className="panel ops-health" aria-label="Operations health">
      <div className="ops-section-header">
        <div>
          <div className="info-heading">
            <h2>Operations health</h2>
            <InfoBubble label="Operations health">
              Current organization totals across all recorded work. Refresh
              after operator or worker activity.
            </InfoBubble>
          </div>
        </div>
        <button type="button" className="secondary" onClick={() => void load()}>
          Refresh operations health
        </button>
      </div>
      {busy && <p role="status">Checking operations…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <dl className="record-figures ops-figures">
            <div>
              <dt>Checked</dt>
              <dd>
                <time dateTime={data.checkedAt} title={data.checkedAt}>
                  {checkedLabel(data.checkedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Regional store</dt>
              <dd>{data.region}</dd>
            </div>
            <div>
              <dt>Queues with recorded work</dt>
              <dd>
                {active!.length} of {data.queues.length}
              </dd>
            </div>
            <div>
              <dt>Due for review or processing</dt>
              <dd>{due}</dd>
            </div>
            <div className={attention ? "ops-figure-attention" : undefined}>
              <dt>Needs operator review</dt>
              <dd>{attention}</dd>
            </div>
          </dl>
          {data.recoveryHold ? (
            <p role="alert" className="ops-banner" data-tone="attention">
              Recovery hold active. Reconcile external outcomes before provider
              activation.
            </p>
          ) : (
            <p className="ops-banner">No recovery hold is recorded.</p>
          )}
          <div className="ops-queue-grid">
            {[...data.queues]
              .sort(
                (a, b) =>
                  Number(b.states.some((row) => row.count > 0)) -
                  Number(a.states.some((row) => row.count > 0)),
              )
              .map((queue) => {
                const recorded = queue.states.filter((row) => row.count > 0);
                return (
                  <section
                    key={queue.id}
                    aria-label={queue.label}
                    className="ops-queue"
                    data-empty={recorded.length ? undefined : "true"}
                    data-attention={
                      recorded.some((row) => attentionStates.has(row.state))
                        ? "true"
                        : undefined
                    }
                  >
                    <h3>{queue.label}</h3>
                    {queue.registered !== undefined && (
                      <p className="ops-note">
                        {queue.registered
                          ? "Consumer registered in this process. Separate worker activity is not observed."
                          : "Consumer disabled in this process. Retained history remains visible."}
                      </p>
                    )}
                    {(queue.due !== undefined ||
                      queue.expiredLeases !== undefined ||
                      queue.lastCompletedAt !== undefined) && (
                      <dl className="ops-queue-facts">
                        {queue.due !== undefined && (
                          <div>
                            <dt>Due for local review or processing</dt>
                            <dd>{queue.due}</dd>
                          </div>
                        )}
                        {queue.expiredLeases !== undefined && (
                          <div>
                            <dt>Expired leases</dt>
                            <dd>{queue.expiredLeases}</dd>
                          </div>
                        )}
                        {queue.lastCompletedAt !== undefined && (
                          <div>
                            <dt>Last recorded completion</dt>
                            <dd>{queue.lastCompletedAt ?? "None"}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                    {!recorded.length ? (
                      <p className="ops-note">No recorded work.</p>
                    ) : (
                      <ul className="ops-queue-states">
                        {recorded.map((row) => (
                          <li key={row.state}>
                            <strong>
                              {row.state.replaceAll("_", " ")}: {row.count}
                            </strong>
                            {attentionStates.has(row.state) && (
                              <span> · Operator review required</span>
                            )}
                            <p>
                              Oldest in this state:{" "}
                              {age(row.oldestCreatedAt, data.checkedAt)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
          </div>
          <p className="ops-note">
            Counts and creation age describe retained records. They do not prove
            provider availability, worker activity, physical residency or stock
            and money agreement. Due counts include work whose local retry time
            has arrived; they do not authorize sending it.
          </p>
          <p className="ops-note">
            Use Billing for provider outcome history, Inventory and Returns for
            carrier review and Event reporting for delivery attempts. An
            authorized finance operator can use Reconciliation for stock and
            money controls. Verify the original records before any retry or
            correction.
          </p>
        </>
      )}
    </section>
  );
}
