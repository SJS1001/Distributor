import React, { useEffect, useId, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request, RequestError } from "./api.ts";
import "./purchasing-workspace.css";

import type { IncomingSupplyReview as Supply } from "../shared/incoming-supply.ts";
type Attempt = {
  key: string;
  name: string;
  payload: Record<string, string | number>;
  summary: string;
};
const commands = [
  "order.incoming.commit",
  "order.incoming.release",
  "order.incoming.priority",
  "order.incoming.reconcile",
];
function restore(key: string, orderId: string): Attempt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as Attempt;
  if (
    !value ||
    !commands.includes(value.name) ||
    typeof value.key !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.key) ||
    typeof value.summary !== "string" ||
    value.payload?.orderId !== orderId
  )
    throw Error(
      "Saved incoming-stock attempt cannot be read. Resolve the previous attempt before creating another.",
    );
  return value;
}

export function IncomingSupply({
  orderId,
  scope,
  editable,
  onChanged,
}: {
  orderId: string;
  scope: string;
  editable: boolean;
  onChanged?: () => void;
}) {
  const id = useId();
  const storageKey = `distributor-incoming:${scope}:${orderId}`;
  const [data, setData] = useState<Supply | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [review, setReview] = useState<Omit<Attempt, "key"> | null>(null);
  const [storageError, setStorageError] = useState("");
  const [lineId, setLineId] = useState("");
  const [purchaseLineId, setPurchaseLineId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("100");
  const [reason, setReason] = useState("");
  const [changeId, setChangeId] = useState("");
  const [changeKind, setChangeKind] = useState<"release" | "priority">(
    "release",
  );
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      setPending(restore(storageKey, orderId));
    } catch (e) {
      setStorageError((e as Error).message);
    }
  }, [storageKey, orderId]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void request<Supply>(
      `/api/orders/${encodeURIComponent(orderId)}/incoming-supply`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [orderId, retry]);
  const refresh = () => setRetry((value) => value + 1);
  const submit = async () => {
    if (inFlight.current || storageError || !editable) return;
    const attempt =
      pending ?? (review ? { ...review, key: crypto.randomUUID() } : null);
    if (!attempt) return;
    // Persist the exact reviewed request before sending; an uncertain reply must
    // never turn into a newly keyed duplicate when the page is reopened.
    try {
      localStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      setStorageError(
        "Browser storage is unavailable. No new request was sent; restore storage to recover safely.",
      );
      return;
    }
    inFlight.current = true;
    setPending(attempt);
    setReview(null);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(`/api/commands/${attempt.name}`, {
        method: "POST",
        headers: { "idempotency-key": attempt.key },
        body: JSON.stringify(attempt.payload),
      });
      localStorage.removeItem(storageKey);
      if (mounted.current) {
        setPending(null);
        setMessage(
          "Incoming-stock assignment updated. Current quantities are being refreshed.",
        );
        setReason("");
        refresh();
        onChanged?.();
      }
    } catch (e) {
      if (mounted.current) {
        // Authorization runs before cached-receipt recovery. A refusal to
        // replay an uncertain request does not prove it never committed.
        if (
          e instanceof RequestError &&
          e.status >= 400 &&
          e.status < 500 &&
          ![401, 403, 404, 408, 429].includes(e.status) &&
          e.code !== "IDEMPOTENCY_CONFLICT" &&
          (!pending ||
            [
              "REVISION",
              "INCOMING_DEMAND",
              "INCOMING_SUPPLY",
              "INCOMING_CAPACITY",
              "INCOMING_QUANTITY",
              "CREDIT_HOLD",
              "RESERVATION_EXPIRED",
            ].includes(e.code ?? ""))
        ) {
          try {
            localStorage.removeItem(storageKey);
            setPending(null);
            refresh();
          } catch {
            setStorageError(
              "The rejected attempt could not be cleared from browser storage.",
            );
          }
        }
        setError((e as Error).message);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const line = data?.lines.find((item) => item.lineId === lineId);
  const candidates =
    data?.candidates.filter((item) => item.productId === line?.productId) ?? [];
  const candidate = candidates.find(
    (item) => item.purchaseLineId === purchaseLineId,
  );
  const active =
    data?.commitments.filter(
      (item) => item.pendingQuantity + item.heldQuantity > 0,
    ) ?? [];
  const change = active.find((item) => item.id === changeId);
  const locked = busy || !!pending || !!review || !!storageError;
  return (
    <section className="incoming-supply" aria-labelledby={`${id}-title`}>
      <div className="info-heading">
        <h3 id={`${id}-title`}>Incoming stock for this order</h3>
        <InfoBubble label="Incoming stock for this order">
          Assign purchased goods to this customer before arrival. Incoming and
          inspection-held quantities cannot be picked or shipped. Usable
          receipts become reserved stock for the assigned order.
        </InfoBubble>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {storageError && (
        <p role="alert" className="error">
          {storageError}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy || !!review}
        onClick={refresh}
      >
        Refresh incoming stock
      </button>
      {!data && !error && <p role="status">Loading incoming stock…</p>}
      {data && (
        <>
          <div
            className="table-wrap"
            role="region"
            tabIndex={0}
            aria-label="Order coverage in units"
          >
            <p className="table-scroll-cue">
              Scroll across the table to review all fields and actions.
            </p>
            <table>
              <caption>Order coverage in units</caption>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Outstanding</th>
                  <th>Reserved</th>
                  <th>Incoming</th>
                  <th>Inspection hold</th>
                  <th>Uncovered</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((item) => (
                  <tr key={item.lineId}>
                    <th scope="row">{item.description}</th>
                    <td>{item.outstanding}</td>
                    <td>{item.allocated}</td>
                    <td>{item.incoming}</td>
                    <td>{item.held}</td>
                    <td>{item.uncovered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Priority 1 is served first; equal priorities follow assignment
            order. A partial delivery leaves the remaining assignment waiting
            for the next receipt.
          </p>
          {data.commitments.length ? (
            <div
              className="table-wrap"
              role="region"
              tabIndex={0}
              aria-label="Incoming stock assignments"
            >
              <p className="table-scroll-cue">
                Scroll across the table to review all fields and actions.
              </p>
              <table>
                <caption>Incoming assignments and history</caption>
                <thead>
                  <tr>
                    <th>Product / purchase order</th>
                    <th>Priority</th>
                    <th>Waiting</th>
                    <th>Held</th>
                    <th>Converted to stock reservation</th>
                    <th>Released</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commitments.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        {data.lines.find((row) => row.lineId === item.lineId)
                          ?.description ?? item.lineId}
                        <small title={item.poId}>
                          PO {item.poId.slice(0, 8)}
                        </small>
                        <small>{item.reason}</small>
                      </th>
                      <td>{item.priority}</td>
                      <td>{item.pendingQuantity}</td>
                      <td>{item.heldQuantity}</td>
                      <td>{item.convertedQuantity}</td>
                      <td>{item.releasedQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No incoming stock is assigned to this order yet.</p>
          )}
          {editable &&
            data.state === "open" &&
            data.lines.some((item) => item.held > 0) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const why = String(
                    new FormData(event.currentTarget).get("reason") ?? "",
                  ).trim();
                  if (locked || !why) return;
                  setReview({
                    name: "order.incoming.reconcile",
                    payload: { orderId, revision: data.revision, reason: why },
                    summary: `Reserve inspected arrivals for this order after checking its current account and reservation deadline. Quarantined units stay held. Reason: ${why}`,
                  });
                }}
              >
                <fieldset disabled={locked}>
                  <legend>Reserve inspected arrivals</legend>
                  <p>
                    If an account hold or an expired reservation prevented
                    allocation, resolve it first, then retry here. Quarantined
                    stock remains on hold.
                  </p>
                  <label htmlFor={`${id}-reconcile-reason`}>
                    Reason for retrying allocation
                  </label>
                  <input
                    id={`${id}-reconcile-reason`}
                    name="reason"
                    required
                    maxLength={500}
                  />
                  <button type="submit">Review arrival allocation</button>
                </fieldset>
              </form>
            )}
          {editable && data.state === "open" && (
            <div className="incoming-forms">
              {data.lines.some((item) => item.uncovered > 0) ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!line || !candidate || locked) return;
                    setReview({
                      name: "order.incoming.commit",
                      payload: {
                        orderId,
                        revision: data.revision,
                        lineId: line.lineId,
                        poId: candidate.poId,
                        purchaseLineId: candidate.purchaseLineId,
                        quantity: Number(quantity),
                        priority: Number(priority),
                        reason: reason.trim(),
                      },
                      summary: `Assign ${quantity} units of ${line.description} from purchase order ${candidate.poId}, priority ${priority}. Reason: ${reason.trim()}`,
                    });
                  }}
                >
                  <h4>Assign incoming stock</h4>
                  <fieldset disabled={locked}>
                    <legend>Choose demand and supply</legend>
                    <div className="incoming-field incoming-field-wide">
                      <label htmlFor={`${id}-line`}>Order product</label>
                      <select
                        id={`${id}-line`}
                        required
                        value={lineId}
                        onChange={(event) => {
                          setLineId(event.target.value);
                          setPurchaseLineId("");
                        }}
                      >
                        <option value="">Choose an uncovered product</option>
                        {data.lines
                          .filter((item) => item.uncovered > 0)
                          .map((item) => (
                            <option key={item.lineId} value={item.lineId}>
                              {item.description} · {item.uncovered} uncovered
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="incoming-field incoming-field-wide">
                      <label htmlFor={`${id}-purchase`}>
                        Incoming purchase line
                      </label>
                      <select
                        id={`${id}-purchase`}
                        required
                        value={purchaseLineId}
                        onChange={(event) =>
                          setPurchaseLineId(event.target.value)
                        }
                      >
                        <option value="">
                          Choose available incoming stock
                        </option>
                        {candidates
                          .filter((item) => item.availableQuantity > 0)
                          .map((item) => (
                            <option
                              key={item.purchaseLineId}
                              value={item.purchaseLineId}
                            >
                              {item.supplierName} · PO {item.poId.slice(0, 8)} ·{" "}
                              {item.availableQuantity} available
                            </option>
                          ))}
                      </select>
                      {line &&
                        !candidates.some(
                          (item) => item.availableQuantity > 0,
                        ) && (
                          <p>
                            No unassigned incoming supply matches this product
                            and warehouse. Create a purchase order or release
                            another assignment first.
                          </p>
                        )}
                    </div>
                    <div className="incoming-field">
                      <label htmlFor={`${id}-quantity`}>Units to assign</label>
                      <input
                        id={`${id}-quantity`}
                        type="number"
                        min="1"
                        max={Math.min(
                          line?.uncovered ?? 0,
                          candidate?.availableQuantity ?? 0,
                        )}
                        step="1"
                        required
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </div>
                    <div className="incoming-field">
                      <label htmlFor={`${id}-priority`}>
                        Priority (1 first)
                      </label>
                      <input
                        id={`${id}-priority`}
                        type="number"
                        min="1"
                        max="999"
                        step="1"
                        required
                        value={priority}
                        onChange={(event) => setPriority(event.target.value)}
                      />
                    </div>
                    <div className="incoming-field incoming-field-wide">
                      <label htmlFor={`${id}-reason`}>Assignment reason</label>
                      <input
                        id={`${id}-reason`}
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!candidate || !reason.trim()}
                    >
                      Review assignment
                    </button>
                  </fieldset>
                </form>
              ) : (
                <p className="empty">
                  {data.lines.length
                    ? "All order demand is covered. No incoming assignment is needed."
                    : "No order demand is recorded. There is nothing to assign."}
                </p>
              )}
              {active.length > 0 && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!change || locked) return;
                    const form = new FormData(event.currentTarget),
                      value = Number(form.get("value")),
                      why = String(form.get("reason") ?? "").trim();
                    if (!why) return;
                    setReview({
                      name: `order.incoming.${changeKind}`,
                      payload: {
                        orderId,
                        revision: data.revision,
                        commitmentId: change.id,
                        ...(changeKind === "release"
                          ? { quantity: value }
                          : { priority: value }),
                        reason: why,
                      },
                      summary: `${changeKind === "release" ? `Release ${value} units from` : `Set priority ${value} on`} assignment for PO ${change.poId}. Reason: ${why}`,
                    });
                  }}
                >
                  <h4>Change an assignment</h4>
                  <fieldset disabled={locked}>
                    <legend>Release units or change priority</legend>
                    <div className="incoming-field incoming-field-wide">
                      <label htmlFor={`${id}-change`}>Assignment</label>
                      <select
                        id={`${id}-change`}
                        required
                        value={changeId}
                        onChange={(event) => setChangeId(event.target.value)}
                      >
                        <option value="">Choose assignment</option>
                        {active.map((item) => (
                          <option key={item.id} value={item.id}>
                            {
                              data.lines.find(
                                (row) => row.lineId === item.lineId,
                              )?.description
                            }{" "}
                            · PO {item.poId.slice(0, 8)} ·{" "}
                            {item.pendingQuantity + item.heldQuantity} remaining
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="incoming-field">
                      <label htmlFor={`${id}-action`}>Action</label>
                      <select
                        id={`${id}-action`}
                        value={changeKind}
                        onChange={(event) =>
                          setChangeKind(
                            event.target.value as "release" | "priority",
                          )
                        }
                      >
                        <option value="release">Release assigned units</option>
                        <option value="priority">Change priority</option>
                      </select>
                    </div>
                    <div className="incoming-field">
                      <label htmlFor={`${id}-value`}>
                        {changeKind === "release"
                          ? "Units to release"
                          : "New priority (1 first)"}
                      </label>
                      <input
                        key={`${changeId}:${changeKind}`}
                        id={`${id}-value`}
                        name="value"
                        type="number"
                        min="1"
                        max={
                          changeKind === "release"
                            ? (change?.pendingQuantity ?? 0) +
                              (change?.heldQuantity ?? 0)
                            : 999
                        }
                        step="1"
                        defaultValue="1"
                        required
                      />
                    </div>
                    <div className="incoming-field incoming-field-wide">
                      <label htmlFor={`${id}-change-reason`}>
                        Change reason
                      </label>
                      <input
                        id={`${id}-change-reason`}
                        name="reason"
                        required
                        maxLength={500}
                      />
                    </div>
                    <button type="submit" disabled={!change}>
                      Review change
                    </button>
                  </fieldset>
                </form>
              )}
            </div>
          )}
        </>
      )}
      {(review || pending) && (
        <section
          className="incoming-review"
          aria-label="Review incoming-stock change"
        >
          <h4>
            {pending ? "Recover the saved attempt" : "Review before confirming"}
          </h4>
          <p>{(pending ?? review)?.summary}</p>
          {pending && (
            <p>
              The outcome may be uncertain. Retry this same request to recover
              its result before making another change.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !!storageError || !editable}
            onClick={() => void submit()}
          >
            {busy
              ? "Saving…"
              : pending
                ? "Retry exact saved attempt"
                : "Confirm change"}
          </button>
          {!pending && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Back to editing
            </button>
          )}
        </section>
      )}
    </section>
  );
}

type Order = {
  id: string;
  account_id: string;
  warehouse_id: string;
  lines: { description: string }[];
};
export function IncomingSupplyWorkspace({
  scope,
  editable,
  accountName,
  warehouseName,
}: {
  scope: string;
  editable: boolean;
  accountName: (id: string) => string;
  warehouseName: (id: string) => string;
}) {
  const [page, setPage] = useState<{
    items: Order[];
    next: string | null;
  } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError("");
    void request<{ items: Order[]; next: string | null }>(
      `/api/orders/page?state=open${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [cursor, retry]);
  return (
    <section className="incoming-workspace">
      <div className="info-heading">
        <h2>Incoming allocations</h2>
        <InfoBubble label="Incoming allocations">
          Choose a customer order to assign incoming purchase quantities and
          review what is still uncovered.
        </InfoBubble>
      </div>
      {error && (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry orders
          </button>
        </>
      )}
      {!page && !error && <p role="status">Loading open orders…</p>}
      {page && (
        <>
          {page.items.length > 0 && (
            <p className="incoming-order-count" role="status">
              {page.items.length}{" "}
              {page.items.length === 1 ? "open order" : "open orders"} on this
              page
            </p>
          )}
          <div className="incoming-order-choices" aria-label="Open orders">
            {page.items.map((order) => (
              <button
                type="button"
                key={order.id}
                aria-pressed={orderId === order.id}
                onClick={() => setOrderId(order.id)}
              >
                <strong>{accountName(order.account_id)}</strong>
                <span>
                  {warehouseName(order.warehouse_id)} · Order{" "}
                  <code title={order.id}>{order.id.slice(0, 8)}</code>
                </span>
                <small>
                  {order.lines.map((line) => line.description).join(", ")}
                </small>
              </button>
            ))}
          </div>
          {!page.items.length && (
            <p className="empty">
              No open customer orders need incoming stock on this page.
            </p>
          )}
          {(cursor || page.next) && (
            <div className="actions">
              {cursor && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCursor(null)}
                >
                  First page
                </button>
              )}
              {page.next && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCursor(page.next)}
                >
                  Next orders
                </button>
              )}
            </div>
          )}
        </>
      )}
      {orderId && (
        <IncomingSupply
          key={`${scope}:${orderId}`}
          orderId={orderId}
          scope={scope}
          editable={editable}
        />
      )}
    </section>
  );
}
