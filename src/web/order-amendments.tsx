import { InfoBubble } from "./info-bubble.tsx";
import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";

export function OrderAmendments({
  orderId,
  currency,
  lines,
  onClose,
}: {
  orderId: string;
  currency: string;
  lines: { id: string; description: string }[];
  onClose: () => void;
}) {
  const history = usePages(
    `/api/orders/${encodeURIComponent(orderId)}/amendments`,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const money = (value: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      value / 100,
    );
  return (
    <section aria-label="Order amendment history">
      <div className="info-heading">
        <h3 ref={heading} tabIndex={-1}>
          Order amendment history
        </h3>
        <InfoBubble label="Order amendment history">
          Quantity changes retain accepted unit prices and tax. Reasons are
          visible to the buyer. Newest first.
        </InfoBubble>
      </div>
      <button type="button" onClick={onClose}>
        Close amendment history
      </button>
      {history.error && (
        <p role="alert" className="error">
          {history.error}
        </p>
      )}
      {history.loaded && history.items.length === 0 && (
        <p>No order amendments recorded.</p>
      )}
      <ol>
        {history.items.map((r) => (
          <li key={r.id}>
            <p>
              {lines.find((line) => line.id === r.line_id)?.description ??
                r.line_id}{" "}
              · v{r.revision} · {r.created_at}
            </p>
            <p>
              {r.before_quantity} → {r.after_quantity} total ordered units ·
              reserved stock change {r.allocated_delta > 0 ? "+" : ""}
              {r.allocated_delta}
            </p>
            <p>
              Accepted unit price {money(r.unit_price)} · unit tax{" "}
              {money(r.unit_tax)}
            </p>
            <p>
              Order total {money(r.before_total)} → {money(r.after_total)}
            </p>
            <p>
              {r.reason} · recorded by {r.actor_id}
            </p>
          </li>
        ))}
      </ol>
      {history.busy && <p role="status">Loading amendment history…</p>}
      {(history.next || history.error) && (
        <button
          type="button"
          disabled={history.busy}
          onClick={() => void history.load()}
        >
          {history.error ? "Retry amendment history" : "Load older amendments"}
        </button>
      )}
    </section>
  );
}
