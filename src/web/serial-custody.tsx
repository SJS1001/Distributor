import { InfoBubble } from "./info-bubble.tsx";
import React from "react";
import { usePages } from "./billing-inbox.tsx";
import "./fulfillment-queues.css";
type Item = Record<string, any>;
export function SerialCustody({
  initial,
  warehouseName,
  currency,
  renderActions,
}: {
  initial: { items: Item[]; next: string | null };
  warehouseName: (id: string) => string;
  currency: string;
  renderActions: (r: Item) => React.ReactNode;
}) {
  const rows = usePages("/api/stock/serial-reviews", initial);
  const cost = (n: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      n / 100,
    );
  const count = rows.items.length;
  const tone = (state: string) =>
    state === "submitted"
      ? "attention"
      : state === "approved"
        ? "problem"
        : state === "recovered"
          ? "done"
          : "neutral";
  return (
    <section aria-label="Serial custody reviews" className="fulfillment-queue">
      <div className="queue-controls">
        <div className="info-heading">
          <h2 id="inventory-serials" tabIndex={-1}>
            Serial custody reviews
          </h2>
          <InfoBubble label="Serial custody reviews">
            Missing observations preserve expected book stock until
            administrator review. Approved losses retain the serial identity
            with zero book quantity. Scanned recovery returns it to quarantine
            at original cost; inspect it before making it available.
          </InfoBubble>
        </div>
        <p role="status">
          {count} {count === 1 ? "review" : "reviews"} loaded
          {rows.busy ? " · Loading…" : ""}
        </p>
        {rows.error && (
          <p role="alert" className="error">
            {rows.error}
          </p>
        )}
        {(rows.next || rows.error) && (
          <button
            className="secondary"
            disabled={rows.busy}
            onClick={() => void rows.load()}
          >
            {rows.error ? "Retry custody reviews" : "Load more custody reviews"}
          </button>
        )}
      </div>
      {!count && !rows.busy && !rows.error && (
        <p className="fulfillment-empty">
          <strong>No missing-serial reviews</strong>
          Reviews appear here when warehouse staff report an expected serial as
          missing from its bin.
        </p>
      )}
      {count > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference / serial</th>
                <th>Observation</th>
                <th>Decision / recovery</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.review_ref}</strong>
                    <small>
                      {r.serial} · {warehouseName(r.warehouse_id)} / {r.bin}
                    </small>
                    <small>{cost(r.unit_cost)} original cost</small>
                  </td>
                  <td>
                    {r.reason}
                    <small>
                      {r.created_at} · observer {r.observed_by}
                    </small>
                  </td>
                  <td>
                    <span className="queue-state" data-tone={tone(r.state)}>
                      {r.state}
                    </span>
                    <small>{r.decision_reason}</small>
                    {r.decided_at && (
                      <small>
                        {r.decided_at} · reviewer {r.decided_by}
                      </small>
                    )}
                    {r.recovered_at && (
                      <>
                        <small>
                          {r.recovery_ref} · {r.recovery_bin} ·{" "}
                          {r.recovery_reason}
                        </small>
                        <small>
                          {r.recovered_at} · receiver {r.recovered_by}
                        </small>
                      </>
                    )}
                  </td>
                  <td>{renderActions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
