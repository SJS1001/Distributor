import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { usePages } from "./billing-inbox.tsx";

type Notice = {
  id: string;
  number: string;
  accountId?: string;
  amount: number;
  currency: string;
  status: string;
  state: string;
  revision: number;
  updatedAt: string;
  acknowledged: boolean;
  message: string;
};
const statusName = (status: string) => status.replaceAll("_", " ");
function NoticeHistory({
  notice,
  close,
}: {
  notice: Notice;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const rows = usePages(
    `/api/billing/refund-notices/${encodeURIComponent(notice.id)}/history`,
  );
  return (
    <section aria-label="Refund notice history">
      <h3 ref={heading} tabIndex={-1}>
        Refund notice history — {notice.number}
      </h3>
      <button className="secondary" onClick={close}>
        Close refund history
      </button>
      {rows.error && (
        <p className="error" role="alert">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} updates loaded{rows.busy ? " · Loading…" : ""}
      </p>
      <ol>
        {rows.items.map((n) => (
          <li key={n.revision}>
            <strong>{statusName(n.status)}</strong> · {n.createdAt} · update{" "}
            {n.revision}
            {n.source === "existing-state" &&
              " · existing verified status when notices became available"}
            <p>{n.message}</p>
          </li>
        ))}
      </ol>
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry refund history" : "Load older refund updates"}
        </button>
      )}
    </section>
  );
}
export function RefundNotices({
  initial,
  personal,
  accountName,
  renderActions,
}: {
  initial: { items: Notice[]; next: number | null; unread: number };
  personal: boolean;
  accountName: (id: string) => string;
  renderActions: (notice: Notice) => React.ReactNode;
}) {
  const rows = usePages("/api/billing/refund-notices", initial);
  const [selected, setSelected] = useState<Notice | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <section className="ledger-section" aria-label="Refund notices">
      <div className="info-heading">
        <h2>Refund notices</h2>
        <InfoBubble label="Refund notices">
          {personal
            ? "Refund exceptions for your customer account."
            : "Refund exceptions for authorized customer accounts."}{" "}
          Read status is personal. Refresh to see new notices and updated
          outcomes.
        </InfoBubble>
      </div>
      <p role="status">
        {initial.unread} unread refund notices · {rows.items.length} loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      {rows.error && (
        <p className="error" role="alert">
          {rows.error}
        </p>
      )}
      {rows.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                {!personal && <th>Customer</th>}
                <th>Refund</th>
                <th>Latest status</th>
                <th>Notice</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((n: Notice) => (
                <tr key={n.id}>
                  <td>{n.number}</td>
                  {!personal && <td>{accountName(n.accountId!)}</td>}
                  <td>
                    {new Intl.NumberFormat("en-CA", {
                      style: "currency",
                      currency: n.currency,
                    }).format(n.amount / 100)}
                  </td>
                  <td>
                    {statusName(n.status)} ·{" "}
                    {n.state === "open"
                      ? "needs review"
                      : "earlier exception resolved"}
                    <small>
                      {n.updatedAt} · update {n.revision}
                    </small>
                  </td>
                  <td>{n.message}</td>
                  <td>
                    <div className="actions">
                      {renderActions(n)}
                      <button
                        className="secondary"
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setSelected(n);
                        }}
                      >
                        View refund history
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No refund exception notices are available.</p>
      )}
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry refund notices" : "Load older refund notices"}
        </button>
      )}
      {selected && (
        <NoticeHistory
          key={selected.id}
          notice={selected}
          close={() => {
            setSelected(null);
            opener.current?.focus();
          }}
        />
      )}
    </section>
  );
}
