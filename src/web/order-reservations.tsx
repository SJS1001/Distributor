import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";

const instant = (value: number) => new Date(value).toLocaleString();
export function ReservationStatus({
  reservation,
}: {
  reservation?: { expiresAt: number | null; overdue: boolean };
}) {
  if (reservation?.expiresAt == null)
    return <small>No reservation deadline</small>;
  const due = reservation.overdue || reservation.expiresAt <= Date.now();
  return (
    <small>
      {due ? "Reservation deadline due" : "Reservation deadline"}:{" "}
      {instant(reservation.expiresAt)}
      {due ? " · Renew or clear before new allocation or picking." : ""}
    </small>
  );
}

export function OrderReservations({
  orderId,
  lines,
  onClose,
}: {
  orderId: string;
  lines: { id: string; description: string }[];
  onClose: () => void;
}) {
  const history = usePages(
    `/api/orders/${encodeURIComponent(orderId)}/reservations`,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section aria-label="Order reservation history">
      <h3 ref={heading} tabIndex={-1}>
        Order reservation history
      </h3>
      <button type="button" onClick={onClose}>
        Close reservation history
      </button>
      <p>
        Newest first. Reasons are visible to the buyer. Expiry releases unpicked
        units to backorder; original ordered quantities, accepted prices, tax,
        total and credit exposure remain intact. Picked and packed stock is
        preserved. Refresh reloads current status.
      </p>
      {history.error && (
        <p role="alert" className="error">
          {history.error}
        </p>
      )}
      {history.loaded && history.items.length === 0 && (
        <p>No reservation changes recorded.</p>
      )}
      <ol>
        {history.items.map((r) => (
          <li key={r.id}>
            <p>
              {r.action === "expire"
                ? "Unpicked reservations expired"
                : r.expires_at == null
                  ? "Reservation deadline cleared"
                  : r.before_expires_at == null
                    ? "Reservation deadline set"
                    : "Reservation deadline renewed"}{" "}
              · {r.created_at}
            </p>
            <p>
              Previous deadline:{" "}
              {r.before_expires_at == null
                ? "None"
                : instant(r.before_expires_at)}{" "}
              · Deadline:{" "}
              {r.expires_at == null ? "None" : instant(r.expires_at)}
            </p>
            {r.action === "expire" &&
              (typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines).map(
                (line: {
                  lineId: string;
                  released: number;
                  retainedPicked: number;
                }) => (
                  <p key={line.lineId}>
                    {lines.find((l) => l.id === line.lineId)?.description ??
                      "Order line"}{" "}
                    · {line.released} released to backorder ·{" "}
                    {line.retainedPicked} picked units retained
                  </p>
                ),
              )}
            <p>
              {r.reason} · recorded by {r.actor_id}
            </p>
          </li>
        ))}
      </ol>
      {history.busy && <p role="status">Loading reservation history…</p>}
      {(history.next || history.error) && (
        <button
          type="button"
          disabled={history.busy}
          onClick={() => void history.load()}
        >
          {history.error
            ? "Retry reservation history"
            : "Load older reservations"}
        </button>
      )}
    </section>
  );
}
