import React from "react";
import { usePages } from "./billing-inbox.tsx";
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
  return (
    <section aria-label="Serial custody reviews">
      <h2>Serial custody reviews</h2>
      <p>
        Missing observations preserve expected book stock until administrator
        review. Approved losses retain the serial identity with zero book
        quantity. Scanned recovery returns it to quarantine at original cost;
        inspect it before making it available.
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} reviews loaded{rows.busy ? " · Loading…" : ""}
      </p>
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
                  {r.state}
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
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry custody reviews" : "Load more custody reviews"}
        </button>
      )}
    </section>
  );
}
