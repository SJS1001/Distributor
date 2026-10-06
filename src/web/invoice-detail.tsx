import React, { useEffect, useRef, useState } from "react";
import { downloadDocument, request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { shippingSummary } from "../shared/shipping-terms.ts";
type Item = Record<string, any>;

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value / 100);

function InvoicePayments({
  invoiceId,
  currency,
}: {
  invoiceId: string;
  currency: string;
}) {
  const payments = usePages(
    `/api/billing/invoices/${encodeURIComponent(invoiceId)}/payments/page`,
  );
  return (
    <section className="record-detail-panel" aria-label="Recorded payments">
      <h3>Recorded payments</h3>
      {payments.error && <p role="alert">{payments.error}</p>}
      {payments.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Source</th>
                <th className="numeric">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <time dateTime={p.created_at}>
                      {new Date(p.created_at).toLocaleString()}
                    </time>
                  </td>
                  <td>
                    {p.provider} · {p.external_ref}
                  </td>
                  <td className="numeric">
                    {formatMoney(p.amount, p.currency ?? currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payments.loaded && !payments.busy && !payments.items.length && (
        <p className="record-detail-empty">
          No cash payments are recorded against this invoice.
        </p>
      )}
      {payments.busy && <p role="status">Loading payments…</p>}
      {(payments.next || payments.error) && (
        <button
          type="button"
          className="secondary"
          disabled={payments.busy}
          onClick={() => void payments.load()}
        >
          {payments.error ? "Retry payments" : "Load more payments"}
        </button>
      )}
    </section>
  );
}

/** Canonical invoice record. Reads use the server's current invoice custody. */
export function InvoiceDetail({
  invoiceId,
  accountName,
  back,
  backLabel,
  canSeePayments,
  openOrder,
  actions,
}: {
  invoiceId: string;
  accountName: (id: string) => string;
  back: () => void;
  backLabel: string;
  canSeePayments: boolean;
  openOrder?: (orderId: string) => void;
  actions?: (invoice: Item) => React.ReactNode;
}) {
  const [invoice, setInvoice] = useState<Item | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [downloading, setDownloading] = useState(false),
    [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setInvoice(null);
    setError("");
    void request<Item>(
      `/api/billing/invoices/${encodeURIComponent(invoiceId)}`,
      {
        signal: controller.signal,
      },
    )
      .then((result) => {
        if (current) setInvoice(result);
      })
      .catch((e) => {
        if (current && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Invoice could not be loaded.",
          );
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [invoiceId, attempt]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [invoiceId, !!invoice]);
  const download = async () => {
    setDownloading(true);
    setNotice("");
    try {
      const receipt = await downloadDocument("invoice", invoiceId);
      if (typeof receipt === "string")
        setNotice("PDF download prepared. Receipt does not confirm delivery.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "PDF could not be prepared.");
    } finally {
      setDownloading(false);
    }
  };
  const currency = invoice?.currency ?? "CAD";
  const status = !invoice
    ? ""
    : invoice.balance > 0
      ? "Balance due"
      : invoice.balance < 0
        ? "Customer credit"
        : "Settled";
  return (
    <section className="record-detail" aria-label="Invoice detail">
      <button type="button" className="secondary back-link" onClick={back}>
        ← {backLabel}
      </button>
      {error ? (
        <div className="record-detail-panel">
          <h2 ref={heading} tabIndex={-1}>
            Invoice unavailable
          </h2>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry invoice
          </button>
        </div>
      ) : !invoice ? (
        <p role="status" className="record-detail-panel">
          Checking current invoice access…
        </p>
      ) : (
        <>
          <header className="record-detail-header">
            <div>
              <p className="record-detail-eyebrow">
                {invoice.origin === "opening" ? "Opening invoice" : "Invoice"}
              </p>
              <h2 ref={heading} tabIndex={-1}>
                {invoice.number}
              </h2>
              <p>
                <strong>{accountName(invoice.account_id)}</strong> · Issued{" "}
                <time dateTime={invoice.created_at}>
                  {new Date(invoice.created_at).toLocaleDateString()}
                </time>
              </p>
            </div>
            <span
              className="record-status"
              data-status={
                invoice.balance > 0
                  ? "due"
                  : invoice.balance < 0
                    ? "credit"
                    : "settled"
              }
            >
              {status}
            </span>
          </header>
          <dl className="record-figures">
            <div>
              <dt>Invoice total</dt>
              <dd>{formatMoney(invoice.total, currency)}</dd>
            </div>
            <div>
              <dt>Credited</dt>
              <dd>{formatMoney(invoice.credited, currency)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatMoney(invoice.paid, currency)}</dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>{formatMoney(invoice.refunded, currency)}</dd>
            </div>
            <div className="record-figure-emphasis">
              <dt>Current balance</dt>
              <dd>{formatMoney(invoice.balance, currency)}</dd>
            </div>
          </dl>
          <div className="record-detail-actions">
            <button
              type="button"
              disabled={downloading}
              onClick={() => void download()}
            >
              Download invoice PDF
            </button>
            {invoice.order_id && openOrder && (
              <button
                type="button"
                className="secondary"
                onClick={() => openOrder(invoice.order_id)}
              >
                Open source order
              </button>
            )}
            {actions?.(invoice)}
          </div>
          {notice && <p role="status">{notice}</p>}
          <section className="record-detail-panel" aria-label="Invoice lines">
            <h3>Lines</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="numeric">Quantity</th>
                    <th className="numeric">Unit price</th>
                    <th className="numeric">Unit tax</th>
                    <th className="numeric">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l: Item) => (
                    <tr key={l.id}>
                      <td>
                        {l.description}
                        {l.kind === "shipping" && <small> · Shipping</small>}
                        {l.credited_quantity > 0 && (
                          <small> · {l.credited_quantity} credited</small>
                        )}
                      </td>
                      <td className="numeric">{l.quantity}</td>
                      <td className="numeric">
                        {formatMoney(l.unit_price, currency)}
                      </td>
                      <td className="numeric">
                        {formatMoney(l.unit_tax, currency)}
                      </td>
                      <td className="numeric">
                        {formatMoney(
                          l.quantity * (l.unit_price + l.unit_tax),
                          currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={4}>Net before tax</th>
                    <td className="numeric">
                      {formatMoney(invoice.net, currency)}
                    </td>
                  </tr>
                  <tr>
                    <th colSpan={4}>Tax</th>
                    <td className="numeric">
                      {formatMoney(invoice.tax, currency)}
                    </td>
                  </tr>
                  <tr>
                    <th colSpan={4}>Original invoice total</th>
                    <td className="numeric">
                      {formatMoney(invoice.total, currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="record-detail-note">
              {shippingSummary(invoice.shipping, currency)}
            </p>
          </section>
          {canSeePayments && (
            <InvoicePayments invoiceId={invoice.id} currency={currency} />
          )}
        </>
      )}
    </section>
  );
}
