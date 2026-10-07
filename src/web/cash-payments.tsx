import React, { useEffect, useRef } from "react";
import { InfoBubble } from "./info-bubble.tsx";
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
    <section className="ledger-section" aria-label="Recorded cash payments">
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Recorded cash payments
        </h2>
        <InfoBubble label="Recorded cash payments">
          Newest payments first, in the original invoice currency. Refresh
          resets the loaded pages.
        </InfoBubble>
      </div>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} payments loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.items.length ? (
        <div
          className="table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Cash payments"
        >
          <p className="table-scroll-cue">
            Scroll across the table to review all fields and actions.
          </p>
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
                    <small>
                      <time dateTime={p.created_at} title={p.created_at}>
                        {new Date(p.created_at).toLocaleString(undefined, {
                          timeZoneName: "short",
                        })}
                      </time>
                      <details>
                        <summary>Exact timestamp</summary>
                        <code>{p.created_at}</code>
                      </details>
                    </small>
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
