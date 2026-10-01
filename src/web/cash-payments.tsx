import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";
import type { PaymentPage, PaymentSummary } from "../shared/payment-history.ts";

export function CashPayments({
  initial,
  renderActions,
}: {
  initial: PaymentPage;
  renderActions: (payment: PaymentSummary) => React.ReactNode;
}) {
  const rows = usePages<PaymentSummary>("/api/billing/payments/page", initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const previouslyBusy = useRef(false);
  useEffect(() => {
    if (
      previouslyBusy.current &&
      !rows.busy &&
      rows.loaded &&
      rows.next === null
    )
      heading.current?.focus();
    previouslyBusy.current = rows.busy;
  }, [rows.busy, rows.next, rows.loaded]);
  return (
    <section aria-label="Recorded cash payments">
      <h2 ref={heading} tabIndex={-1}>
        Recorded cash payments
      </h2>
      <p>
        Newest payments first, in the original invoice currency. Refresh resets
        the loaded pages.
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} payments loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {["Invoice", "Cash", "Source", "QuickBooks handoff"].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.invoiceNumber}
                    <small>{p.created_at}</small>
                  </td>
                  <td>
                    {new Intl.NumberFormat("en", {
                      style: "currency",
                      currency: p.currency,
                    }).format(p.amount / 100)}
                  </td>
                  <td>
                    {p.provider} · {p.external_ref}
                  </td>
                  <td>{renderActions(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No cash payments are recorded.</p>
      )}
      {(rows.next !== null || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry older payments" : "Load older payments"}
        </button>
      )}
    </section>
  );
}
