import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";

export function SupplierReturnHistory({
  returnId,
  currency,
  canCorrect,
  onCorrect,
  onClose,
}: {
  returnId: string;
  currency: string;
  canCorrect: boolean;
  onCorrect: (id: string) => void;
  onClose: () => void;
}) {
  const history = usePages(
      `/api/purchases/returns/${encodeURIComponent(returnId)}/history`,
    ),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const money = (amount: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      amount / 100,
    );
  return (
    <section aria-label="Supplier follow-up history">
      <h3 ref={heading} tabIndex={-1}>
        Supplier follow-up history
      </h3>
      <button type="button" onClick={onClose}>
        Close supplier history
      </button>
      <p>
        Supplier observations retain their evidence after corrections. Recording
        a credit does not post it to accounting; linking a receipt does not
        receive stock.
      </p>
      {history.error && (
        <p role="alert" className="error">
          {history.error}
        </p>
      )}
      {history.loaded && history.items.length === 0 && (
        <p>No supplier outcomes recorded. Follow-up remains open.</p>
      )}
      <ol>
        {history.items.map((r) => (
          <li key={r.id}>
            <p>
              v{r.revision} · {r.kind} · {r.reference} · {r.created_at}
            </p>
            {r.kind === "credit" && (
              <p>
                Supplier credit recorded: {money(r.amount)}
                {r.voided ? " · Voided by later evidence" : ""}
              </p>
            )}
            {r.kind === "replacement" && (
              <p>
                {r.quantity} replacement units · receipt {r.receipt_id}
                {r.voided ? " · Voided by later evidence" : ""}
              </p>
            )}
            {r.kind === "void" && <p>Voids observation {r.target_id}</p>}
            {r.kind === "review" && (
              <p>
                {r.state} · {r.resolution ?? "Follow-up reopened"}
              </p>
            )}
            <p>
              {r.evidence} · recorded by {r.actor_id}
            </p>
            {canCorrect &&
              !r.voided &&
              ["credit", "replacement"].includes(r.kind) && (
                <button type="button" onClick={() => onCorrect(r.id)}>
                  Void supplier observation {r.reference}
                </button>
              )}
          </li>
        ))}
      </ol>
      {history.busy && <p role="status">Loading supplier history…</p>}
      {(history.next || history.error) && (
        <button
          type="button"
          disabled={history.busy}
          onClick={() => void history.load()}
        >
          {history.error
            ? "Retry supplier history"
            : "Load older supplier observations"}
        </button>
      )}
    </section>
  );
}
