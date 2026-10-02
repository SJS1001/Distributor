import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
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
  return (
    <section className="panel" aria-label="Operations health">
      <h2>Operations health</h2>
      <p>
        Current organization totals across all recorded work. Refresh after
        operator or worker activity.
      </p>
      <button type="button" className="secondary" onClick={() => void load()}>
        Refresh operations health
      </button>
      {busy && <p role="status">Checking operations…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            Checked {data.checkedAt} · {data.region} regional store
          </p>
          {data.recoveryHold ? (
            <p role="alert">
              Recovery hold active. Reconcile external outcomes before provider
              activation.
            </p>
          ) : (
            <p>No recovery hold is recorded.</p>
          )}
          <p>
            Counts and creation age describe retained records. They do not prove
            provider availability, worker activity, physical residency or stock
            and money agreement. Due counts include work whose local retry time
            has arrived; they do not authorize sending it.
          </p>
          {data.queues.map((queue) => (
            <section key={queue.id} aria-label={queue.label}>
              <h3>{queue.label}</h3>
              {queue.registered !== undefined && (
                <p>
                  {queue.registered
                    ? "Consumer registered in this process. Separate worker activity is not observed."
                    : "Consumer disabled in this process. Retained history remains visible."}
                </p>
              )}
              {queue.due !== undefined && (
                <p>Due for local review or processing: {queue.due}</p>
              )}
              {queue.expiredLeases !== undefined && (
                <p>Expired leases: {queue.expiredLeases}</p>
              )}
              {queue.lastCompletedAt !== undefined && (
                <p>
                  Last recorded completion: {queue.lastCompletedAt ?? "None"}
                </p>
              )}
              {!queue.states.some((row) => row.count > 0) ? (
                <p>No recorded work.</p>
              ) : (
                <ul>
                  {queue.states
                    .filter((row) => row.count > 0)
                    .map((row) => (
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
          ))}
          <p>
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
