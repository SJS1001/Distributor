import { shippingSummary } from "../shared/shipping-terms.ts";
import React, { useEffect, useId, useState } from "react";
import { command, request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { displayMoney } from "./storefront.tsx";
import type { OrderRequest, OrderRequestStatus } from "../shared/purchasing.ts";
import "./fulfillment-queues.css";
const labels: Record<OrderRequestStatus, string> = {
  awaiting_approval: "Awaiting distributor approval",
  information_needed: "More information needed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  accepted: "Accepted",
};
const tones: Record<OrderRequestStatus, string> = {
  awaiting_approval: "attention",
  information_needed: "active",
  declined: "problem",
  withdrawn: "neutral",
  accepted: "done",
};
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const units = (value: OrderRequest) =>
  value.lines.reduce((total, l) => total + l.quantity, 0);
function RequestSummary({
  value,
  buyer,
  now,
  accountName,
  order,
}: {
  value: OrderRequest;
  buyer: boolean;
  now: number;
  accountName?: (id: string) => string;
  order: (id: string) => void;
}) {
  return (
    <>
      {" "}
      <header className="record-detail-header">
        <div>
          <p className="record-detail-eyebrow">
            Order request{" "}
            <code className="queue-id" title={value.id}>
              {value.id.slice(0, 8)}
            </code>
          </p>
          <h3 data-tone={tones[value.status]}>{labels[value.status]}</h3>
          <p>
            {!buyer &&
              `${accountName ? accountName(value.accountId) : `Customer ${value.accountId}`} · `}
            Submitted {new Date(value.createdAt).toLocaleString()} · Revision{" "}
            {value.revision}
          </p>
        </div>
      </header>
      <dl className="record-figures request-figures">
        <div className="record-figure-emphasis">
          <dt>Submitted total</dt>
          <dd>{displayMoney(value.total, value.currency)}</dd>
        </div>
        <div>
          <dt>Requested units</dt>
          <dd>
            {plural(units(value), "unit")} ·{" "}
            {plural(value.lines.length, "product")}
          </dd>
        </div>
        <div>
          <dt>Backorders</dt>
          <dd>{value.allowBackorder ? "Accepted" : "Not accepted"}</dd>
        </div>
        <div>
          <dt>Quote expires</dt>
          <dd>
            <time
              dateTime={new Date(value.expiresAt).toISOString()}
              title={new Date(value.expiresAt).toISOString()}
            >
              {new Date(value.expiresAt).toLocaleString(undefined, {
                timeZoneName: "short",
              })}
            </time>
            {value.status !== "accepted" && value.expiresAt <= now && (
              <p role="status">
                <strong>Expired</strong> · The buyer must review current
                quantities, prices and terms and resubmit before approval.
              </p>
            )}
          </dd>
        </div>
      </dl>
      <div className="record-detail-panel">
        <h3>Requested lines</h3>
        <ul className="request-lines">
          {value.lines.map((l) => (
            <li key={l.productId}>
              <span>
                <strong>{l.quantity} ×</strong> {l.description}
              </span>
              <span>
                {displayMoney(l.unitPrice, value.currency)} +{" "}
                {displayMoney(l.unitTax, value.currency)} tax per unit
              </span>
            </li>
          ))}
        </ul>
        <div className="request-facts">
          <p>{shippingSummary(value.shipping, value.currency)}</p>
          {value.status !== "accepted" && (
            <p>
              No stock is reserved and no payment is taken for this request.
              Price and availability are confirmed on acceptance.
            </p>
          )}
          {value.reviewReason && <p>Review required: {value.reviewReason}</p>}
        </div>
        {value.message && (
          <blockquote className="request-message">{value.message}</blockquote>
        )}
        {value.orderId && (
          <div className="record-detail-actions request-next">
            <button onClick={() => order(value.orderId!)}>
              View accepted order
            </button>
          </div>
        )}
      </div>
    </>
  );
}
type RequestCommand = (name: string, payload: unknown) => Promise<void>;
function BuyerRequestActions({
  value,
  busy,
  run,
  resubmit,
}: {
  value: OrderRequest;
  busy: boolean;
  run: RequestCommand;
  resubmit: (value: OrderRequest) => void;
}) {
  return (
    <div className="record-detail-panel">
      <h3>Your next step</h3>
      <div className="actions">
        {["awaiting_approval", "information_needed"].includes(value.status) && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run("order.review.withdraw", {
                requestId: value.id,
                revision: value.revision,
              })
            }
          >
            Withdraw request
          </button>
        )}
        <button disabled={busy} onClick={() => resubmit(value)}>
          Review quantities and resubmit
        </button>
      </div>
      <p className="record-detail-note">
        Resubmission opens the current cart for this warehouse using these
        request quantities. Review any existing draft, current prices and terms
        before submitting a new revision.
      </p>
    </div>
  );
}
type RequestDecision = { action: string; message: string; note: string };
function DistributorRequestDecision({
  value,
  busy,
  run,
  decision,
  change,
}: {
  value: OrderRequest;
  busy: boolean;
  run: RequestCommand;
  decision: RequestDecision;
  change: (field: keyof RequestDecision, value: string) => void;
}) {
  return (
    <form
      className="record-detail-panel request-decision"
      onSubmit={(e) => {
        e.preventDefault();
        void run("order.review.decide", {
          requestId: value.id,
          revision: value.revision,
          expectedHash: value.expectedHash,
          action: decision.action,
          message: decision.message,
          staffNote: decision.note,
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Distributor decision</legend>
        <label>
          Decision
          <select
            aria-label="Decision"
            value={decision.action}
            onChange={(e) => change("action", e.target.value)}
          >
            <option value="request_information">
              Request more information
            </option>
            <option value="approve">Approve order</option>
            <option value="decline">Decline request</option>
          </select>
        </label>
        <label>
          Message to customer (Required)
          <textarea
            required
            maxLength={1000}
            value={decision.message}
            onChange={(e) => change("message", e.target.value)}
          />
        </label>
        <label>
          Private staff note (Optional)
          <textarea
            maxLength={2000}
            value={decision.note}
            onChange={(e) => change("note", e.target.value)}
          />
        </label>
        <p>
          Approval rechecks current access, price, credit and supply. If the
          quote expired or terms changed, ask the buyer to review and resubmit.
        </p>
        <button type="submit">Record decision</button>
      </fieldset>
    </form>
  );
}
function RequestHistory({ history }: { history: OrderRequest["history"] }) {
  return (
    <div className="record-detail-panel">
      <h3>Request history</h3>
      <ol className="request-history">
        {history.map((h) => (
          <li key={h.revision}>
            <strong>{h.action.replaceAll("_", " ")}</strong> ·{" "}
            {new Date(h.createdAt).toLocaleString()}
            {h.message && <p>{h.message}</p>}
            {h.staffNote && <p>Private note: {h.staffNote}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
function RequestDetail({
  id,
  buyer,
  canReview,
  back,
  resubmit,
  order,
  changed,
  accountName,
}: {
  id: string;
  buyer: boolean;
  canReview: boolean;
  back: () => void;
  resubmit: (value: OrderRequest) => void;
  order: (id: string) => void;
  changed: () => void;
  accountName?: (id: string) => string;
}) {
  const [now, setNow] = useState(Date.now());
  const [value, setValue] = useState<OrderRequest | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState("request_information"),
    [message, setMessage] = useState(""),
    [note, setNote] = useState(""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setValue(null);
    setError("");
    void request<OrderRequest>(
      `/api/order-requests/${encodeURIComponent(id)}`,
      { signal: c.signal },
    )
      .then((result) => {
        if (!c.signal.aborted) setValue(result);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, epoch]);
  useEffect(() => {
    if (!value || value.status === "accepted") return;
    const remaining = value.expiresAt - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining + 1, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [value]);
  const run = async (name: string, payload: unknown) => {
    setBusy(true);
    setError("");
    try {
      await command(name, payload);
      setEpoch(epoch + 1);
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="record-detail" aria-label="Order request detail">
      <div className="record-detail-actions">
        <button className="secondary" disabled={busy} onClick={back}>
          <span aria-hidden="true">← </span>Back to requests
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setEpoch(epoch + 1)}
        >
          Refresh request
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {value ? (
        <>
          <RequestSummary
            value={value}
            buyer={buyer}
            now={now}
            accountName={accountName}
            order={order}
          />
          {buyer && value.status !== "accepted" && (
            <BuyerRequestActions
              value={value}
              busy={busy}
              run={run}
              resubmit={resubmit}
            />
          )}
          {!buyer && canReview && value.status === "awaiting_approval" && (
            <DistributorRequestDecision
              value={value}
              busy={busy}
              run={run}
              decision={{ action, message, note }}
              change={(field, text) =>
                ({ action: setAction, message: setMessage, note: setNote })[
                  field
                ](text)
              }
            />
          )}
          {!buyer && value.status === "information_needed" && (
            <p className="record-detail-panel record-detail-note">
              Awaiting the buyer's response and renewed quote before another
              decision.
            </p>
          )}
          <RequestHistory history={value.history} />
        </>
      ) : (
        !error && (
          <p role="status" className="record-detail-panel">
            Loading request…
          </p>
        )
      )}
    </section>
  );
}
function RequestList({
  title,
  buyer,
  refresh,
  select,
  accountName,
}: {
  title: string;
  buyer: boolean;
  refresh: () => void;
  select: (id: string) => void;
  accountName?: (id: string) => string;
}) {
  const rows = usePages<OrderRequest>("/api/order-requests"),
    [status, setStatus] = useState(""),
    statusId = useId();
  const shown = rows.items.filter((r) => !status || r.status === status);
  return (
    <>
      <div className="queue-controls">
        <h2>{title}</h2>
        <div className="queue-field">
          <label htmlFor={statusId}>Request status</label>
          <select
            id={statusId}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="queue-field queue-field-actions">
          <button className="secondary" onClick={refresh}>
            Refresh requests
          </button>
        </div>
        <p role="status">
          {plural(rows.items.length, "request")} loaded
          {status ? ` · ${shown.length} shown` : ""}
          {rows.busy ? " · Loading…" : ""}
        </p>
        <p>
          {buyer
            ? "Orders that need distributor verification wait here before acceptance. No stock is reserved and no payment is taken until a request is accepted."
            : "Orders requiring distributor verification appear here before acceptance."}
        </p>
        {rows.error && <p role="alert">{rows.error}</p>}
        {(rows.next || rows.error) && (
          <button
            className="secondary"
            disabled={rows.busy}
            onClick={() => void rows.load()}
          >
            {rows.error ? "Retry requests" : "Load more requests"}
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Order request records"
        >
          <table>
            <thead>
              <tr>
                <th>Request</th>
                {!buyer && <th>Customer</th>}
                <th>Status</th>
                <th>Requested</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="record-link"
                      title={r.id}
                      aria-label={`View request ${r.id}`}
                      onClick={() => select(r.id)}
                    >
                      View request <code>{r.id.slice(0, 8)}</code>
                    </button>
                  </td>
                  {!buyer && (
                    <td>
                      <strong>
                        {accountName
                          ? accountName(r.accountId)
                          : `Customer ${r.accountId.slice(0, 8)}`}
                      </strong>
                    </td>
                  )}
                  <td>
                    <span className="queue-state" data-tone={tones[r.status]}>
                      {labels[r.status]}
                    </span>
                  </td>
                  <td>
                    <strong>{displayMoney(r.total, r.currency)}</strong>
                    <small>
                      {plural(units(r), "unit")} ·{" "}
                      {plural(r.lines.length, "product")}
                    </small>
                  </td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !shown.length && (
        <p className="fulfillment-empty">
          <strong>
            {rows.items.length
              ? "No requests match this status"
              : "No order requests"}
          </strong>
          {rows.items.length
            ? "Choose another status to see the other loaded requests."
            : buyer
              ? "Orders that need distributor approval will appear here after you submit them."
              : "Customer orders that need distributor approval will appear here."}
        </p>
      )}
    </>
  );
}
export function OrderRequests({
  buyer,
  canReview,
  resubmit,
  order,
  accountName,
}: {
  buyer: boolean;
  canReview: boolean;
  resubmit: (value: OrderRequest) => void;
  order: (id: string) => void;
  accountName?: (id: string) => string;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [epoch, setEpoch] = useState(0);
  const title = buyer ? "Your order requests" : "Order review queue";
  return (
    <section className="fulfillment-queue" aria-label={title}>
      {selected ? (
        <>
          <h2 className="request-section-title">{title}</h2>
          <RequestDetail
            key={selected}
            id={selected}
            buyer={buyer}
            canReview={canReview}
            back={() => setSelected(null)}
            resubmit={resubmit}
            order={order}
            changed={() => setEpoch(epoch + 1)}
            accountName={accountName}
          />
        </>
      ) : (
        <RequestList
          key={epoch}
          title={title}
          buyer={buyer}
          refresh={() => setEpoch(epoch + 1)}
          select={setSelected}
          accountName={accountName}
        />
      )}
    </section>
  );
}
