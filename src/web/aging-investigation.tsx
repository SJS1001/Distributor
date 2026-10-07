import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { request } from "./api.ts";
import {
  agingFilters,
  agingMatches,
  type AgingFilter,
  type AgingInvoice,
} from "./aging-investigation-contract.ts";

export type AgingReport = {
  observedAt: string;
  accounts: {
    accountId: string;
    name: string;
    currency: string;
    invoices: AgingInvoice[];
  }[];
};
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(amount / 100);

/** Read-only investigation; actions continue through canonical invoice detail. */
export function AgingInvestigation({
  accountId,
  initialReport,
  initialFilter = "open",
  active = true,
  onClose,
  onInvoice,
  onCustomer,
  onReport,
}: {
  accountId: string;
  initialReport: AgingReport;
  initialFilter?: AgingFilter;
  active?: boolean;
  onClose: () => void;
  onInvoice: (invoiceId: string) => void;
  onCustomer?: (accountId: string) => void;
  onReport?: (report: AgingReport) => void;
}) {
  const [refreshed, setRefreshed] = useState<{
      source: AgingReport;
      value: AgingReport;
    } | null>(null),
    [filter, setFilter] = useState(initialFilter),
    [limit, setLimit] = useState(20),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    pending = useRef<AbortController | null>(null),
    latestReport = useRef(initialReport),
    filterId = useId();
  useLayoutEffect(() => {
    latestReport.current = initialReport;
  }, [initialReport]);
  useEffect(() => {
    setBusy(false);
    if (active) heading.current?.focus({ preventScroll: true });
    else {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
    }
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [accountId, active]);
  const refresh = async () => {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await request<AgingReport>("/api/billing/aging", {
        signal: controller.signal,
      });
      if (
        pending.current !== controller ||
        latestReport.current !== initialReport
      )
        return;
      setRefreshed({ source: initialReport, value: next });
      onReport?.(next);
    } catch (e) {
      if (
        pending.current === controller &&
        latestReport.current === initialReport &&
        !controller.signal.aborted
      )
        setError(
          e instanceof Error
            ? e.message
            : "Account balances could not be refreshed.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const report =
    refreshed?.source === initialReport ? refreshed.value : initialReport;
  const account = report.accounts.find((a) => a.accountId === accountId),
    invoices = account?.invoices.filter((i) => agingMatches(i, filter)) ?? [];
  return (
    <section
      className="record-detail"
      aria-label="Account balance investigation"
    >
      <button type="button" className="secondary back-link" onClick={onClose}>
        ← Account aging
      </button>
      <h3 ref={heading} tabIndex={-1}>
        {account?.name ?? "Account unavailable"} · Balance investigation
      </h3>
      <p>
        Inspect an invoice to review its original lines and current balance,
        then use the permitted payment, checkout, credit or refund actions.
        Changing account terms does not change an existing invoice’s recorded
        due date.
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || !active}
          onClick={() => void refresh()}
        >
          {error ? "Retry account balances" : "Refresh account balances"}
        </button>
        {account && onCustomer && (
          <button
            type="button"
            className="secondary"
            onClick={() => onCustomer(accountId)}
          >
            Open customer record
          </button>
        )}
      </div>
      {busy && <p role="status">Refreshing account balances…</p>}
      {error && (
        <p role="alert">
          {error} Showing the last successful observation; invoice details check
          current access and balances.
        </p>
      )}
      <p>
        Observed{" "}
        <time dateTime={report.observedAt}>
          {new Date(report.observedAt).toLocaleString()}
        </time>{" "}
        · UTC calendar-day aging.
      </p>
      {!account ? (
        <p role="status">
          This account is absent from the current permitted aging report.
        </p>
      ) : (
        <>
          <label htmlFor={filterId}>Investigate</label>
          <select
            id={filterId}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as AgingFilter);
              setLimit(20);
            }}
          >
            {Object.entries(agingFilters).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p role="status">
            {Math.min(limit, invoices.length)} of {invoices.length} matching
            invoice records shown
            {invoices.length <= limit ? " · All matching records shown" : ""}.
          </p>
          {invoices.length === 0 ? (
            <p>No invoice records match this investigation filter.</p>
          ) : (
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Account invoice balances"
            >
              <p className="table-scroll-hint">
                Scroll horizontally to review all invoice balance columns.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Recorded due date / basis</th>
                    <th>Total</th>
                    <th>Credited</th>
                    <th>Paid</th>
                    <th>Refunded</th>
                    <th>Balance</th>
                    <th>Pending refunds</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, limit).map((i) => (
                    <tr key={i.id}>
                      <td>
                        <button
                          type="button"
                          className="record-link"
                          onClick={() => onInvoice(i.id)}
                        >
                          {i.number} · Investigate invoice
                        </button>
                      </td>
                      <td>
                        {i.dueAt ? (
                          <time dateTime={i.dueAt}>{i.dueAt.slice(0, 10)}</time>
                        ) : (
                          "Unknown due date"
                        )}
                        <small> · {i.dueBasis}</small>
                      </td>
                      <td className="numeric">{money(i.total, i.currency)}</td>
                      <td className="numeric">
                        {money(i.credited, i.currency)}
                      </td>
                      <td className="numeric">{money(i.paid, i.currency)}</td>
                      <td className="numeric">
                        {money(i.refunded, i.currency)}
                      </td>
                      <td className="numeric">
                        {money(i.balance, i.currency)}
                      </td>
                      <td className="numeric">
                        {money(i.pendingRefunds, i.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {invoices.length > limit && (
            <button
              type="button"
              className="secondary"
              onClick={() => setLimit((v) => v + 20)}
            >
              Show more matching invoices
            </button>
          )}
        </>
      )}
    </section>
  );
}
