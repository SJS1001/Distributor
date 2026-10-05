import { shippingSummary } from "../shared/shipping-terms.ts";
import React, { useEffect, useState } from "react";
import { command, request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { displayMoney } from "./storefront.tsx";
import type { OrderRequest, OrderRequestStatus } from "../shared/purchasing.ts";
const labels: Record<OrderRequestStatus, string> = {
  awaiting_approval: "Awaiting distributor approval",
  information_needed: "More information needed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  accepted: "Accepted",
};
function RequestDetail({
  id,
  buyer,
  canReview,
  back,
  resubmit,
  order,
  changed,
}: {
  id: string;
  buyer: boolean;
  canReview: boolean;
  back: () => void;
  resubmit: (value: OrderRequest) => void;
  order: (id: string) => void;
  changed: () => void;
}) {
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
    <section className="panel">
      <div className="actions">
        <button disabled={busy} onClick={back}>
          Back to requests
        </button>
        <button disabled={busy} onClick={() => setEpoch(epoch + 1)}>
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
          <h3>{labels[value.status]}</h3>
          <p>
            Request {value.id} · Revision {value.revision}
          </p>
          <p>
            {!buyer && `Customer ${value.accountId} · `}Submitted{" "}
            {new Date(value.createdAt).toLocaleString()}
          </p>
          <ul>
            {value.lines.map((l) => (
              <li key={l.productId}>
                {l.quantity} × {l.description} —{" "}
                {displayMoney(l.unitPrice, value.currency)} +{" "}
                {displayMoney(l.unitTax, value.currency)} tax per unit
              </li>
            ))}
          </ul>
          <p>
            <strong>
              Submitted total: {displayMoney(value.total, value.currency)}
            </strong>
          </p>
          <p>{shippingSummary(value.shipping, value.currency)}</p>
          <p>
            {value.allowBackorder
              ? "Backorders accepted"
              : "No backorders accepted"}
            . Quote expires {new Date(value.expiresAt).toLocaleString()}.
          </p>
          {value.status !== "accepted" && (
            <p>
              No stock is reserved and no payment is taken for this request.
              Price and availability are confirmed on acceptance.
            </p>
          )}
          {value.reviewReason && <p>Review required: {value.reviewReason}</p>}
          {value.message && <blockquote>{value.message}</blockquote>}
          {value.orderId && (
            <button onClick={() => order(value.orderId!)}>
              View accepted order
            </button>
          )}
          {buyer && value.status !== "accepted" && (
            <div className="actions">
              {["awaiting_approval", "information_needed"].includes(
                value.status,
              ) && (
                <button
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
              <p>
                Resubmission opens the current cart for this warehouse using
                these request quantities. Review any existing draft, current
                prices and terms before submitting a new revision.
              </p>
            </div>
          )}
          {!buyer && canReview && value.status === "awaiting_approval" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("order.review.decide", {
                  requestId: value.id,
                  revision: value.revision,
                  expectedHash: value.expectedHash,
                  action,
                  message,
                  staffNote: note,
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Distributor decision</legend>
                <label>
                  Decision
                  <select
                    aria-label="Decision"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="request_information">
                      Request more information
                    </option>
                    <option value="approve">Approve order</option>
                    <option value="decline">Decline request</option>
                  </select>
                </label>
                <label>
                  Message to customer
                  <textarea
                    required
                    maxLength={1000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>
                <label>
                  Private staff note
                  <textarea
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p>
                  Approval rechecks current access, price, credit and supply. If
                  the quote expired or terms changed, ask the buyer to review
                  and resubmit.
                </p>
                <button>Record decision</button>
              </fieldset>
            </form>
          )}
          {!buyer && value.status === "information_needed" && (
            <p>
              Awaiting the buyer's response and renewed quote before another
              decision.
            </p>
          )}
          <h4>Request history</h4>
          <ol>
            {value.history.map((h, i) => (
              <li key={`${h.revision}:${i}`}>
                <strong>{h.action.replaceAll("_", " ")}</strong> ·{" "}
                {new Date(h.createdAt).toLocaleString()}
                <p>{h.message}</p>
                {h.staffNote && <p>Private note: {h.staffNote}</p>}
              </li>
            ))}
          </ol>
        </>
      ) : (
        !error && <p role="status">Loading request…</p>
      )}
    </section>
  );
}
function RequestList({ select }: { select: (id: string) => void }) {
  const rows = usePages<OrderRequest>("/api/order-requests"),
    [status, setStatus] = useState("");
  return (
    <>
      <label>
        Request status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {rows.error && <p role="alert">{rows.error}</p>}
      <p role="status">
        {rows.items.length} requests loaded{rows.busy ? " · Loading…" : ""}
      </p>
      <div className="request-cards">
        {rows.items
          .filter((r) => !status || r.status === status)
          .map((r) => (
            <article className="panel" key={r.id}>
              <h3>{labels[r.status]}</h3>
              <p>
                {r.lines.length} products · {displayMoney(r.total, r.currency)}
              </p>
              <p>{new Date(r.createdAt).toLocaleString()}</p>
              <button onClick={() => select(r.id)}>
                View request {r.id.slice(-8)}
              </button>
            </article>
          ))}
      </div>
      {rows.loaded && !rows.items.length && <p>No order requests.</p>}
      {(rows.next || rows.error) && (
        <button disabled={rows.busy} onClick={() => void rows.load()}>
          {rows.error ? "Retry requests" : "Load more requests"}
        </button>
      )}
    </>
  );
}
export function OrderRequests({
  buyer,
  canReview,
  resubmit,
  order,
}: {
  buyer: boolean;
  canReview: boolean;
  resubmit: (value: OrderRequest) => void;
  order: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [epoch, setEpoch] = useState(0);
  return (
    <section>
      <h2>{buyer ? "Your order requests" : "Order review queue"}</h2>
      {selected ? (
        <RequestDetail
          key={selected}
          id={selected}
          buyer={buyer}
          canReview={canReview}
          back={() => setSelected(null)}
          resubmit={resubmit}
          order={order}
          changed={() => setEpoch(epoch + 1)}
        />
      ) : (
        <>
          <p>
            Orders requiring distributor verification appear here before
            acceptance.
          </p>
          <button onClick={() => setEpoch(epoch + 1)}>Refresh requests</button>
          <RequestList key={epoch} select={setSelected} />
        </>
      )}
    </section>
  );
}
