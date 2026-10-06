import React, { useEffect, useRef, useState } from "react";
import type {
  SalesReport,
  SalesReportEntry,
} from "../shared/billing-sales-report.ts";
import { request, downloadDocument } from "./api.ts";
import { PageSections, PageSection } from "./workspace.tsx";
import { DailyBars, compactNumber, shortDate, plural } from "./bar-chart.tsx";
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(cents / 100);
function dates(days = 30) {
  const end = new Date(),
    start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
// Daily invoices and credits as paired bars. Sparse activity stays legible:
// one active day is one bar rather than a ramp from zero.
function Trend({
  rows,
  currency,
}: {
  rows: SalesReport["daily"];
  currency: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiceNet, r.creditNet]));
  const active = rows.filter((r) => r.invoiceNet > 0 || r.creditNet > 0);
  return (
    <div className="sales-trend">
      <div className="sales-trend-head">
        <h3>Invoices and credits over time</h3>
        <ul className="trend-legend" aria-hidden="true">
          <li>
            <i className="trend-swatch is-invoice" />
            Invoices
          </li>
          <li>
            <i className="trend-swatch is-credit" />
            Credits
          </li>
          <li>{currency} per day, before tax</li>
        </ul>
      </div>
      <DailyBars
        label={`Daily invoices in blue and credits in orange, excluding tax, ${currency}. Exact values in Daily figures tab.`}
        max={max}
        ticks={[0, 0.5, 1].map((n) => ({
          value: n * max,
          label: n === 0 ? "0" : compactNumber((n * max) / 100),
        }))}
        start={shortDate(rows[0]?.date)}
        end={shortDate(rows.at(-1)?.date)}
        series={[
          {
            values: rows.map((r) => r.invoiceNet),
            color: "#215fa2",
            offset: 0.1,
            width: 0.38,
          },
          {
            values: rows.map((r) => r.creditNet),
            color: "#c26a2c",
            offset: 0.52,
            width: 0.38,
          },
        ]}
      />
      <p className="sales-trend-note">
        {active.length === 0
          ? "No invoices or credits on any day in this period."
          : `Activity on ${plural(active.length, "day")} of ${rows.length}. Exact values are in Daily figures.`}
      </p>
    </div>
  );
}
export function FinancialReport({ customer = false }: { customer?: boolean }) {
  const [form, setForm] = useState(() => dates());
  const [selection, setSelection] = useState(() => ({
    ...dates(),
    refresh: 0,
  }));
  const [data, setData] = useState<SalesReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chosenCurrency, setCurrency] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState("");
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    void request<SalesReport>(
      `/api/reports/sales?from=${encodeURIComponent(selection.from)}&to=${encodeURIComponent(selection.to)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Report could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selection]);
  const currency = data?.currencies.some((c) => c.currency === chosenCurrency)
    ? chosenCurrency
    : data?.currencies[0]?.currency;
  const totals = data?.currencies.find((c) => c.currency === currency);
  const rows: SalesReport["daily"] = [];
  if (data && currency) {
    const recorded = new Map(
      data.daily
        .filter((row) => row.currency === currency)
        .map((row) => [row.date, row]),
    );
    for (
      let day = Date.parse(data.from + "T00:00:00Z"),
        end = Date.parse(data.to + "T00:00:00Z");
      day <= end && rows.length < 366;
      day += 86400000
    ) {
      const date = new Date(day).toISOString().slice(0, 10);
      rows.push(
        recorded.get(date) ?? {
          date,
          currency,
          invoiceNet: 0,
          creditNet: 0,
          payments: 0,
          refundsCompleted: 0,
        },
      );
    }
  }
  const entries =
    data?.details.items.filter((row) => row.currency === currency) ?? [];
  async function invoice(entry: SalesReportEntry) {
    if (download.current) return;
    const controller = new AbortController();
    download.current = controller;
    setDownloadBusy(true);
    setDownloadNotice("");
    try {
      await downloadDocument("invoice", entry.invoiceId, controller.signal);
      if (!controller.signal.aborted)
        setDownloadNotice("Invoice PDF prepared.");
    } catch (e) {
      if (!controller.signal.aborted)
        setDownloadNotice(
          e instanceof Error ? e.message : "Download unavailable.",
        );
    } finally {
      if (download.current === controller) {
        download.current = null;
        if (!controller.signal.aborted) setDownloadBusy(false);
      }
    }
  }
  return (
    <section
      className="dashboard-card financial-report"
      aria-label={
        customer ? "Your transaction report" : "Sales and adjustment report"
      }
    >
      <header className="financial-report-heading">
        <span className="section-kicker">History & adjustments</span>
        <h2>
          {customer
            ? "Your purchases, credits & payments"
            : "Sales, credits & payments"}
        </h2>
        <p>
          Original sale prices and later adjustments, kept separate from money
          received or refunded.
        </p>
      </header>
      <form
        className="financial-report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSelection({ ...form, refresh: selection.refresh + 1 });
        }}
      >
        <label>
          Report from
          <input
            type="date"
            required
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
        </label>
        <label>
          Report through
          <input
            type="date"
            required
            min={form.from}
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
        </label>
        <button disabled={busy} type="submit">
          Apply report period
        </button>
        <button
          disabled={busy}
          type="button"
          className="secondary"
          onClick={() => {
            const next = dates(90);
            setForm(next);
            setSelection({ ...next, refresh: selection.refresh + 1 });
          }}
        >
          Last 90 days
        </button>
      </form>
      {busy && <p role="status">Loading recorded transactions…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="report-period">
            {data.from} to {data.to}, inclusive UTC dates. Generated{" "}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
          {data.currencies.length > 1 && (
            <label>
              Report currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {data.currencies.map((c) => (
                  <option key={c.currency}>{c.currency}</option>
                ))}
              </select>
            </label>
          )}
          {!totals || !currency ? (
            <p>
              No recorded sales, credits or payment activity in this period.
            </p>
          ) : (
            <>
              <PageSections
                label="Financial report sections"
                items={[
                  { id: "financial-summary", label: "Summary" },
                  { id: "financial-transactions", label: "Transactions" },
                  { id: "financial-days", label: "Daily figures" },
                ]}
              >
                <PageSection id="financial-summary">
                  <div className="financial-metrics">
                    <div>
                      <span>
                        {customer
                          ? "Purchases after credits"
                          : "Sales after credits"}
                      </span>
                      <strong>{money(totals.netSales, currency)}</strong>
                      <small>
                        Before tax · {plural(totals.invoiceCount, "invoice")}
                      </small>
                    </div>
                    <div>
                      <span>Credits issued</span>
                      <strong>
                        {money(
                          totals.productCredits + totals.shippingCredits,
                          currency,
                        )}
                      </strong>
                      <small>
                        Before tax · {plural(totals.creditCount, "credit note")}
                      </small>
                    </div>
                    <div>
                      <span>Payments recorded</span>
                      <strong>{money(totals.payments, currency)}</strong>
                      <small>Cash activity, including tax</small>
                    </div>
                    <div>
                      <span>Completed refunds</span>
                      <strong>
                        {money(totals.refundsCompleted, currency)}
                      </strong>
                      <small>By request date; current status</small>
                    </div>
                  </div>
                  <Trend rows={rows} currency={currency} />
                  <dl className="financial-breakdown">
                    <div>
                      <dt>Products before credits</dt>
                      <dd>{money(totals.productNet, currency)}</dd>
                    </div>
                    <div>
                      <dt>Shipping charges before credits</dt>
                      <dd>{money(totals.shippingNet, currency)}</dd>
                    </div>
                    <div>
                      <dt>Product credits</dt>
                      <dd>{money(totals.productCredits, currency)}</dd>
                    </div>
                    <div>
                      <dt>Shipping credits</dt>
                      <dd>{money(totals.shippingCredits, currency)}</dd>
                    </div>
                    <div>
                      <dt>Tax after credits</dt>
                      <dd>{money(totals.netTax, currency)}</dd>
                    </div>
                    <div>
                      <dt>Total after credits, including tax</dt>
                      <dd>{money(totals.netTotal, currency)}</dd>
                    </div>
                    <div>
                      <dt>Refunds awaiting completion</dt>
                      <dd>{money(totals.refundsPending, currency)}</dd>
                    </div>
                    <div>
                      <dt>Refunds with outcome unknown</dt>
                      <dd>{money(totals.refundsUnknown, currency)}</dd>
                    </div>
                  </dl>
                </PageSection>
                <PageSection id="financial-transactions">
                  <p>
                    {data.details.truncated
                      ? `Latest ${data.details.limit} entries across all currencies are available below. Narrow the dates to inspect older activity. Totals include all matching records.`
                      : "Recorded entries for the selected period."}{" "}
                    Values retain the original sale or adjustment amounts.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "Date (UTC)",
                            "Type",
                            "Invoice",
                            "Product / reason",
                            "Quantity",
                            "Unit price",
                            "Tax",
                            "Total",
                            "Document",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => (
                          <tr key={entry.kind + entry.id}>
                            <td>{entry.date.slice(0, 10)}</td>
                            <td>
                              {entry.kind}
                              {entry.refundState
                                ? ` · ${entry.refundState}`
                                : ""}
                              {entry.shipping ? " · shipping" : ""}
                            </td>
                            <td>{entry.invoiceNumber}</td>
                            <td>{entry.description || entry.reason || "—"}</td>
                            <td>{entry.quantity ?? "—"}</td>
                            <td>
                              {entry.unitPrice === undefined
                                ? "—"
                                : money(entry.unitPrice, currency)}
                            </td>
                            <td>{money(entry.tax, currency)}</td>
                            <td>{money(entry.total, currency)}</td>
                            <td>
                              <button
                                className="text-action"
                                disabled={downloadBusy}
                                onClick={() => void invoice(entry)}
                              >
                                Invoice PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!entries.length && (
                    <p>
                      No entries for this currency in the displayed detail
                      window.
                    </p>
                  )}
                  {downloadNotice && <p role="status">{downloadNotice}</p>}
                </PageSection>
                <PageSection id="financial-days">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date (UTC)</th>
                          <th>Invoices before tax</th>
                          <th>Credits before tax</th>
                          <th>Payments</th>
                          <th>Completed refunds by request date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.date}>
                            <td>{row.date}</td>
                            <td>{money(row.invoiceNet, currency)}</td>
                            <td>{money(row.creditNet, currency)}</td>
                            <td>{money(row.payments, currency)}</td>
                            <td>{money(row.refundsCompleted, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </PageSection>
              </PageSections>
            </>
          )}
          <details className="report-calculation">
            <summary>What these figures include</summary>
            <p>{data.basis}</p>
            <p>
              Changing a customer's current price policy does not rewrite these
              historical values. Each currency is reported separately.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
