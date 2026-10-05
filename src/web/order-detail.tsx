import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { IncomingSupply } from "./incoming-supply.tsx";
type Item = Record<string, any>;
function OrderTimeline({ order }: { order: Item }) {
  const amendments = usePages(
      `/api/orders/${encodeURIComponent(order.id)}/amendments`,
    ),
    reservations = usePages(
      `/api/orders/${encodeURIComponent(order.id)}/reservations`,
    );
  const events = [
    {
      id: "created",
      date: order.created_at,
      label: "Order recorded",
      reason: "",
    },
    ...amendments.items.map((e) => ({
      id: `amendment:${e.id}`,
      date: e.created_at,
      label: "Ordered quantity changed",
      reason: e.reason,
    })),
    ...reservations.items.map((e) => ({
      id: `reservation:${e.id}`,
      date: e.created_at,
      label:
        e.action === "expire"
          ? "Unpicked reservations expired"
          : "Reservation deadline changed",
      reason: e.reason,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section aria-label="Recorded order timeline">
      <h3>Recorded history</h3>
      <p>
        Recorded milestones, newest first. Planned fulfillment steps are not
        completed events.
      </p>
      <ol>
        {events.map((e) => (
          <li key={e.id}>
            <strong>{e.label}</strong> ·{" "}
            <time dateTime={e.date}>{new Date(e.date).toLocaleString()}</time>
            {e.reason && <p>{e.reason}</p>}
          </li>
        ))}
      </ol>
      {[
        { history: amendments, label: "quantity changes" },
        { history: reservations, label: "reservation changes" },
      ].map(({ history, label }) => (
        <div key={label}>
          {history.error && <p role="alert">{history.error}</p>}
          {history.busy && <p role="status">Loading {label}…</p>}
          {(history.next || history.error) && (
            <button
              type="button"
              disabled={history.busy}
              onClick={() => void history.load()}
            >
              {history.error ? "Retry" : "Load more"} {label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
export function OrderDetail({
  orderId,
  accountName,
  warehouseName,
  back,
  scope,
  canAssignIncoming,
}: {
  orderId: string;
  accountName: (id: string) => string;
  warehouseName: (id: string) => string;
  back: () => void;
  scope: string;
  canAssignIncoming: boolean;
}) {
  const [order, setOrder] = useState<Item | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setOrder(null);
    setError("");
    void request<Item>(`/api/orders/${encodeURIComponent(orderId)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (current) setOrder(result);
      })
      .catch((e) => {
        if (current && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Order could not be loaded.",
          );
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [orderId, attempt]);
  useEffect(() => {
    heading.current?.focus();
  }, [orderId]);
  return (
    <section aria-label="Focused order detail">
      <h2 ref={heading} tabIndex={-1}>
        Order {orderId}
      </h2>
      <button type="button" onClick={back}>
        Return to order queue
      </button>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry order detail
          </button>
        </>
      ) : !order ? (
        <p role="status">Checking current order access…</p>
      ) : (
        <>
          <p>
            <strong>{accountName(order.account_id)}</strong> ·{" "}
            {warehouseName(order.warehouse_id)} · Status: {order.state}
          </p>
          <p>
            Total:{" "}
            {new Intl.NumberFormat("en", {
              style: "currency",
              currency: order.currency,
              currencyDisplay: "code",
            }).format(order.total / 100)}
          </p>
          <p>
            {order.state === "closed"
              ? "This order is closed. Review its recorded history."
              : "Review outstanding quantities below, then return to the queue for the actions permitted for your role. Each action checks current access and stock."}
          </p>
          <ul>
            {order.lines.map((line: Item) => (
              <li key={line.id}>
                {line.description ?? line.product_id} · {line.quantity} ordered
                · {line.allocated} reserved · {line.shipped} shipped ·{" "}
                {line.canceled} canceled
              </li>
            ))}
          </ul>
          <IncomingSupply
            key={`${scope}:${order.id}`}
            orderId={order.id}
            scope={scope}
            editable={canAssignIncoming}
            onChanged={() => setAttempt((value) => value + 1)}
          />
          <OrderTimeline key={order.id} order={order} />
        </>
      )}
    </section>
  );
}
