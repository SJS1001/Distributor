import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { usePages } from "./billing-inbox.tsx";
import type {
  RefundPage,
  RefundSummary,
  RefundObservation,
} from "../shared/refund-history.ts";

function useEndFocus(
  busy: boolean,
  next: string | number | null,
  loaded: boolean,
) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previouslyBusy = useRef(false);
  useEffect(() => {
    if (previouslyBusy.current && !busy && loaded && next === null)
      heading.current?.focus();
    previouslyBusy.current = busy;
  }, [busy, next, loaded]);
  return heading;
}

function Observations({
  refund,
  close,
}: {
  refund: RefundSummary;
  close: () => void;
}) {
  const rows = usePages<RefundObservation>(
    `/api/billing/refunds/${encodeURIComponent(refund.id)}/observations`,
  );
  const heading = useEndFocus(rows.busy, rows.next, rows.loaded);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-label="Refund provider history">
      <div className="info-heading">
        <h3 tabIndex={-1} ref={heading}>
          Provider history — {refund.reference}
        </h3>
        <InfoBubble label="provider history">
          Newest observations first. Applied entries changed the refund when
          observed; retained entries did not. Refresh shows current status and
          resets this history view.
        </InfoBubble>
      </div>
      <button className="secondary" onClick={close}>
        Close refund history
      </button>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} observations loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Observed",
                  "Provider reference",
                  "Status",
                  "Native effect",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.observedAt}</td>
                  <td>{row.reference}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.applied
                      ? "Applied when observed"
                      : "Retained, not applied"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No provider observations are recorded for this refund.</p>
      )}
      {(rows.next !== null || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error
            ? "Retry refund observations"
            : "Load older refund observations"}
        </button>
      )}
    </section>
  );
}

export function CashRefunds({
  initial,
  renderActions,
}: {
  initial: RefundPage;
  renderActions: (refund: RefundSummary) => React.ReactNode;
}) {
  const rows = usePages<RefundSummary>("/api/billing/refunds/page", initial);
  const heading = useEndFocus(rows.busy, rows.next, rows.loaded);
  const [selected, setSelected] = useState<RefundSummary | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <section className="ledger-section" aria-label="Cash refunds">
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Cash refunds
        </h2>
        <InfoBubble label="Cash refunds">
          Newest refunds first. Provider history is loaded when selected.
          Refresh resets the loaded pages.
        </InfoBubble>
      </div>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} refunds loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Reference",
                  "Invoice / amount",
                  "Status",
                  "Provider history",
                  "Actions",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.items.map((refund) => (
                <tr key={refund.id}>
                  <td>{refund.reference}</td>
                  <td>
                    {refund.invoiceNumber}
                    <small>
                      {new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: refund.currency,
                      }).format(refund.amount / 100)}
                    </small>
                  </td>
                  <td>
                    {refund.state}
                    {refund.provider_status
                      ? ` · ${refund.provider_status}`
                      : ""}
                  </td>
                  <td>
                    {refund.provider_reference}
                    <button
                      className="secondary"
                      aria-expanded={selected?.id === refund.id}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setSelected(refund);
                      }}
                    >
                      View refund history
                    </button>
                  </td>
                  <td>{renderActions(refund)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No cash refunds are recorded.</p>
      )}
      {(rows.next !== null || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry older refunds" : "Load older refunds"}
        </button>
      )}
      {selected && (
        <Observations
          key={selected.id}
          refund={selected}
          close={() => {
            setSelected(null);
            opener.current?.focus();
          }}
        />
      )}
    </section>
  );
}
