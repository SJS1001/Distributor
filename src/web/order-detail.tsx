import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { IncomingSupply } from "./incoming-supply.tsx";
import { shippingSummary } from "../shared/shipping-terms.ts";
import "./order-detail.css";
type Item = Record<string, any>;

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value / 100);
const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;
const sum = (lines: Item[], key: string) =>
  lines.reduce((total, line) => total + (Number(line[key]) || 0), 0);

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
    <section
      className="record-detail-panel"
      aria-label="Recorded order timeline"
    >
      <div className="info-heading">
        <h3>Recorded history</h3>
        <InfoBubble label="Recorded history">
          Recorded milestones, newest first. Planned fulfillment steps are not
          completed events.
        </InfoBubble>
      </div>
      <ol className="order-timeline">
        {events.map((e) => (
          <li key={e.id}>
            <strong>{e.label}</strong>
            <time dateTime={e.date}>{new Date(e.date).toLocaleString()}</time>
            {e.reason && <p>{e.reason}</p>}
          </li>
        ))}
      </ol>
      {[
        { history: amendments, label: "quantity changes" },
        { history: reservations, label: "reservation changes" },
      ].map(({ history, label }) =>
        history.error || history.busy || history.next ? (
          <div key={label} className="order-timeline-more">
            {history.error && <p role="alert">{history.error}</p>}
            {history.busy && <p role="status">Loading {label}…</p>}
            {(history.next || history.error) && (
              <button
                type="button"
                className="secondary"
                disabled={history.busy}
                onClick={() => void history.load()}
              >
                {history.error ? "Retry" : "Load more"} {label}
              </button>
            )}
          </div>
        ) : null,
      )}
    </section>
  );
}

/** Focused order record. Reads use the server's current order access. */
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
  const lines: Item[] = order?.lines ?? [];
  return (
    <section
      className="record-detail order-detail"
      aria-label="Focused order detail"
    >
      <button type="button" className="secondary back-link" onClick={back}>
        <span aria-hidden="true">←</span> All orders
      </button>
      <header className="record-detail-header">
        <div>
          <p className="record-detail-eyebrow">Customer order</p>
          <h2
            ref={heading}
            tabIndex={-1}
            aria-label={
              error ? `Order ${orderId} unavailable` : `Order ${orderId}`
            }
            title={orderId}
          >
            {error ? (
              <>
                Order <code>{orderId.slice(0, 8)}</code> unavailable
              </>
            ) : (
              <>
                Order <code>{orderId.slice(0, 8)}</code>
              </>
            )}
          </h2>
          {order && (
            <p>
              <strong>{accountName(order.account_id)}</strong> ·{" "}
              {warehouseName(order.warehouse_id)} · Created{" "}
              <time dateTime={order.created_at}>
                {new Date(order.created_at).toLocaleDateString()}
              </time>
            </p>
          )}
        </div>
        {order && (
          <span
            className="record-status order-status"
            data-status={order.state === "closed" ? "closed" : "open"}
          >
            <span className="order-visually-hidden">Status: </span>
            {order.state}
          </span>
        )}
      </header>
      {error ? (
        <div className="record-detail-panel">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry order detail
          </button>
        </div>
      ) : !order ? (
        <p role="status" className="record-detail-panel">
          Checking current order access…
        </p>
      ) : (
        <>
          <dl className="record-figures">
            <div className="record-figure-emphasis">
              <dt>Order total</dt>
              <dd>{formatMoney(order.total, order.currency)}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{units(sum(lines, "quantity"))}</dd>
            </div>
            <div>
              <dt>Reserved</dt>
              <dd>{units(sum(lines, "allocated"))}</dd>
            </div>
            <div>
              <dt>Shipped</dt>
              <dd>{units(sum(lines, "shipped"))}</dd>
            </div>
            <div>
              <dt>Canceled</dt>
              <dd>{units(sum(lines, "canceled"))}</dd>
            </div>
          </dl>
          <section className="record-detail-panel" aria-label="Order lines">
            <h3>
              Lines{" "}
              <small>
                {lines.length} {lines.length === 1 ? "product" : "products"}
              </small>
            </h3>
            {lines.length ? (
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Order line records"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="numeric">Ordered</th>
                      <th className="numeric">Reserved</th>
                      <th className="numeric">Shipped</th>
                      <th className="numeric">Canceled</th>
                      <th className="numeric">Unit price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.description ?? line.product_id}</td>
                        <td className="numeric">{line.quantity}</td>
                        <td className="numeric">{line.allocated}</td>
                        <td className="numeric">{line.shipped}</td>
                        <td className="numeric">{line.canceled}</td>
                        <td className="numeric">
                          {typeof line.unit_price === "number"
                            ? formatMoney(line.unit_price, order.currency)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="record-detail-empty">
                No lines are recorded on this order.
              </p>
            )}
            <p className="record-detail-note">
              {shippingSummary(order.shipping, order.currency)}
            </p>
            <p className="record-detail-note">
              {order.state === "closed"
                ? "This order is closed. Review its recorded history."
                : "Review outstanding quantities above, then return to the queue for the actions permitted for your role. Each action checks current access and stock."}
            </p>
          </section>
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
