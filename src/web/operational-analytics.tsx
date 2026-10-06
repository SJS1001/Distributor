import React from "react";
import { FinancialReport } from "./financial-report.tsx";
import { DashboardReports } from "./dashboard-reports.tsx";
import { WorkspaceIcon } from "./workspace.tsx";
import { DailyBars, compactNumber, shortDate, plural } from "./bar-chart.tsx";
import type { Application } from "../server/application.ts";
import type { NavigationIntent } from "./navigation.ts";
type Analytics = ReturnType<Application["dashboard"]>["analytics"];
const amount = (value: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value / 100);
const buckets: Record<string, string> = {
  notDue: "Not due / due today",
  days1to30: "1–30 days overdue",
  days31to60: "31–60 days overdue",
  days61to90: "61–90 days overdue",
  daysOver90: "Over 90 days overdue",
  unknownDue: "Due date unknown",
};
// Daily history as paired bars: current period in blue over the matching
// previous-period day in gray. Bars read honestly when activity is sparse
// (a single day is one bar, not a misleading ramp). Values stay in the table.
function History({
  title,
  days,
  currentStart,
  currency,
}: {
  title: string;
  days: { date: string; value: number }[];
  currentStart: string;
  currency?: string;
}) {
  const previous = days.filter((d) => d.date < currentStart),
    current = days.filter((d) => d.date >= currentStart);
  const max = Math.max(1, ...days.map((d) => d.value));
  const display = (v: number) =>
    currency ? amount(v, currency) : v.toLocaleString();
  const axis = (v: number) => compactNumber(currency ? v / 100 : v);
  const currentTotal = current.reduce((n, d) => n + d.value, 0);
  const previousTotal = previous.reduce((n, d) => n + d.value, 0);
  return (
    <section className="analytics-history">
      <div className="analytics-history-head">
        <h3>{title}</h3>
        <div className="analytics-period-total">
          <strong>{display(currentTotal)}</strong>
          <span>
            last {current.length} days · previous {display(previousTotal)}
          </span>
        </div>
      </div>
      <DailyBars
        label={`${title}. Blue bars show the current period; gray bars the previous period. Exact daily values in the table below.`}
        max={max}
        ticks={[
          { value: 0, label: "0" },
          ...(currency || max % 2 === 0
            ? [{ value: max / 2, label: axis(max / 2) }]
            : []),
          { value: max, label: axis(max) },
        ]}
        start={shortDate(current[0]?.date)}
        end={shortDate(current.at(-1)?.date)}
        series={[
          {
            values: current.map((_, i) => previous[i]?.value ?? 0),
            color: "#cfd7e1",
            offset: 0.1,
            width: 0.8,
          },
          {
            values: current.map((d) => d.value),
            color: "#315fbd",
            offset: 0.25,
            width: 0.5,
          },
        ]}
      />
      <ul className="trend-legend" aria-hidden="true">
        <li>
          <i className="trend-swatch is-current" />
          {shortDate(current[0]?.date)} – {shortDate(current.at(-1)?.date)}
        </li>
        <li>
          <i className="trend-swatch is-previous" />
          Previous {current.length} days
        </li>
        <li>{currency ? `${currency} per day` : "Orders per day"}</li>
      </ul>
      <details>
        <summary>Period and calculation details</summary>
        <p>
          {current[0]?.date}–{current.at(-1)?.date} UTC compared with{" "}
          {previous[0]?.date}–{previous.at(-1)?.date}.{" "}
          {currency
            ? `${currency}, original invoice total including tax; before credits, payments and refunds. Invoiced sales, not recognized revenue.`
            : "Accepted orders by recorded creation date; includes orders now closed."}{" "}
          Today is partial. Vertical scale: {display(0)} to {display(max)}{" "}
          {currency ? "per day" : "orders per day"}.
        </p>
      </details>
      <details>
        <summary>Daily values: current and comparison period</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Current date UTC</th>
                <th>Value</th>
                <th>Previous date UTC</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {current.map((d, i) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{display(d.value)}</td>
                  <td>{previous[i]?.date}</td>
                  <td>{display(previous[i]?.value ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function ReportHead({
  kicker,
  title,
  caption,
}: {
  kicker: string;
  title: string;
  caption: React.ReactNode;
}) {
  return (
    <header className="report-card-head">
      <span className="section-kicker">{kicker}</span>
      <h2>{title}</h2>
      <p>{caption}</p>
    </header>
  );
}
function MeterRow({
  label,
  value,
  share,
  color,
  detail,
  onOpen,
}: {
  label: string;
  value: string;
  share: number;
  color: string;
  detail?: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  return (
    <div className={`report-meter ${share === 0 ? "is-zero" : ""}`}>
      {onOpen ? (
        <button type="button" className="report-meter-label" onClick={onOpen}>
          {content}
        </button>
      ) : (
        <div className="report-meter-label">{content}</div>
      )}
      <div className="bar-track" aria-hidden="true">
        <span
          style={{
            width: `${Math.round(share * 1000) / 10}%`,
            background: color,
          }}
        />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function ReportFooter({ children }: { children: React.ReactNode }) {
  return <footer className="report-card-footer">{children}</footer>;
}
export function Attention({
  data,
  navigate,
}: {
  data: Analytics;
  navigate: (intent: NavigationIntent) => void;
}) {
  const items = [
    {
      label: "Open orders with overdue or expired reservations",
      value: data.orders.overdueReservations,
      intent: {
        page: "Orders",
        section: "orders-queue",
        orderState: "open",
        orderReservation: "overdue",
      } as NavigationIntent,
    },
    ...(data.countsAwaitingReview === null
      ? []
      : [
          {
            label: "Counts submitted for review",
            value: data.countsAwaitingReview,
            intent: {
              page: "Inventory",
              section: "inventory-counts",
              countState: "submitted",
            } as NavigationIntent,
          },
        ]),
    ...(data.invoices
      ? [
          {
            label: "Invoices with a positive balance",
            value: data.invoices.balances.reduce((n, r) => n + r.unpaid, 0),
            intent: {
              page: "Billing",
              section: "billing-invoices",
              invoiceBalance: "unpaid",
            } as NavigationIntent,
          },
        ]
      : []),
  ];
  const flagged = items.filter((item) => item.value > 0).length;
  return (
    <section
      className="dashboard-card analytics-attention"
      aria-labelledby="attention-heading"
    >
      <div className="attention-head">
        <h2 id="attention-heading">Needs attention</h2>
        <span className={`attention-summary ${flagged ? "is-flagged" : ""}`}>
          {flagged
            ? `${plural(flagged, "queue")} to review`
            : "No records match these attention rules."}
        </span>
      </div>
      <ul className="attention-list">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className={`attention-item ${item.value > 0 ? "is-flagged" : ""}`}
              onClick={() => navigate(item.intent)}
            >
              <span>{item.label}</span>
              <strong>{item.value.toLocaleString()}</strong>
              <WorkspaceIcon name="arrow" />
            </button>
          </li>
        ))}
      </ul>
      <details className="attention-rules">
        <summary>How these are counted</summary>
        <p>
          Current accessible records. Reservation exceptions block new
          allocation or fulfillment; the linked queue shows these reservation
          exceptions.
        </p>
      </details>
    </section>
  );
}
export function OperationalAnalytics({
  data,
  navigate,
  warehouseName,
  preferenceScope,
  customer = false,
}: {
  data: Analytics;
  navigate: (intent: NavigationIntent) => void;
  warehouseName?: (id: string) => string;
  preferenceScope?: string;
  customer?: boolean;
}) {
  // Open orders first: they are the actionable state. Presentation order only.
  const states = [...data.orders.states].sort(
    (a, b) => Number(b.state === "open") - Number(a.state === "open"),
  );
  const orderMax = Math.max(1, ...states.map((r) => r.count));
  const stockMax = Math.max(1, ...(data.stock ?? []).map((r) => r.quantity));
  const asOf = data.invoices
    ? new Date(data.invoices.agingAsOf).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
  return (
    <DashboardReports
      scope={preferenceScope}
      reports={[
        ...(data.invoices
          ? [
              {
                id: "transactions",
                label: "Sales, credits & payments",
                wide: true,
                content: <FinancialReport customer={customer} />,
              },
            ]
          : []),
        {
          id: "orders",
          label: "Order activity",
          content: (
            <section className="dashboard-card report-card">
              <ReportHead
                kicker="Order book"
                title="Where are orders waiting?"
                caption="Current status across accessible orders."
              />
              {states.length === 0 ? (
                <p className="report-empty">No orders recorded yet.</p>
              ) : (
                <div className="report-meters">
                  {states.map((row) => (
                    <MeterRow
                      key={row.state}
                      label={
                        row.state === "open"
                          ? "Open — review or fulfill"
                          : "Closed — review history"
                      }
                      value={row.count.toLocaleString()}
                      share={row.count / orderMax}
                      color={row.state === "open" ? "#315fbd" : "#9daec5"}
                      onOpen={() =>
                        navigate({
                          page: "Orders",
                          section: "orders-queue",
                          orderState: row.state as "open" | "closed",
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <History
                title="Accepted orders"
                days={data.orders.history.map((d) => ({
                  ...d,
                  value: d.count,
                }))}
                currentStart={data.orders.period.start}
              />
              <ReportFooter>
                <button
                  type="button"
                  className="text-action"
                  onClick={() =>
                    navigate({ page: "Orders", section: "orders-queue" })
                  }
                >
                  Review underlying orders <WorkspaceIcon name="arrow" />
                </button>
              </ReportFooter>
            </section>
          ),
        },
        ...(data.invoices
          ? [
              {
                id: "invoices",
                label: customer
                  ? "Purchases & balances"
                  : "Sales & receivables",
                content: (
                  <section className="dashboard-card report-card">
                    <ReportHead
                      kicker={customer ? "Your account" : "Accounts receivable"}
                      title={
                        customer
                          ? "Your purchases & balances"
                          : "Sales & receivables"
                      }
                      caption={`Positive balances as of ${asOf} (UTC). Each currency is separate.`}
                    />
                    <details className="report-basis">
                      <summary>How balances are aged</summary>
                      <p>
                        As of {data.invoices.agingAsOf}.{" "}
                        {data.invoices.agingBasis}. Positive current balances
                        only; currencies are separate.
                      </p>
                    </details>
                    {data.invoices.aging.length === 0 && (
                      <p className="report-empty">No invoices recorded yet.</p>
                    )}
                    {data.invoices.aging.map((group) => {
                      const top = Math.max(
                        1,
                        ...group.buckets.map((r) => r.amount),
                      );
                      return (
                        <div className="report-meters" key={group.currency}>
                          <h3>{group.currency} balances by age</h3>
                          {group.buckets.map((row) => (
                            <MeterRow
                              key={row.bucket}
                              label={buckets[row.bucket] ?? row.bucket}
                              value={amount(row.amount, group.currency)}
                              share={row.amount / top}
                              color={
                                row.bucket === "notDue" ? "#5b8bd0" : "#ba6b19"
                              }
                            />
                          ))}
                        </div>
                      );
                    })}
                    {data.invoices.history.map((group) => (
                      <History
                        key={group.currency}
                        title={`${customer ? "Your invoiced purchases" : "Invoiced sales"} — ${group.currency}`}
                        days={group.days.map((d) => ({
                          ...d,
                          value: d.amount,
                        }))}
                        currentStart={data.invoices!.period.start}
                        currency={group.currency}
                      />
                    ))}
                    <ReportFooter>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() =>
                          navigate({
                            page: "Billing",
                            section: customer
                              ? "billing-invoices"
                              : "billing-aging",
                          })
                        }
                      >
                        Review account and invoice aging
                      </button>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() =>
                          navigate({
                            page: "Billing",
                            section: "billing-invoices",
                          })
                        }
                      >
                        Review underlying invoices{" "}
                        <WorkspaceIcon name="arrow" />
                      </button>
                    </ReportFooter>
                  </section>
                ),
              },
            ]
          : []),
        ...(data.stock
          ? [
              {
                id: "stock",
                label: "Stock condition",
                content: (
                  <section className="dashboard-card report-card">
                    <ReportHead
                      kicker="Inventory"
                      title="Which stock needs attention?"
                      caption="Quarantined or damaged units by warehouse."
                    />
                    <details className="report-basis">
                      <summary>What is included</summary>
                      <p>
                        Stock in quarantine or damaged condition, grouped by
                        warehouse. Quantities are physical units; no low-stock
                        threshold is assumed.
                      </p>
                    </details>
                    {data.stock.length === 0 ? (
                      <p className="report-empty">
                        No quarantined or damaged stock in your scope.
                      </p>
                    ) : (
                      <div className="report-meters">
                        {data.stock.map((row) => (
                          <MeterRow
                            key={row.warehouseId + row.condition}
                            label={`${warehouseName?.(row.warehouseId) ?? row.warehouseId} · ${row.condition}`}
                            value={plural(row.quantity, "unit")}
                            detail={plural(row.records, "stock record")}
                            share={row.quantity / stockMax}
                            color={
                              row.condition === "damaged"
                                ? "#bd4141"
                                : "#c88b23"
                            }
                            onOpen={() =>
                              navigate({
                                page: "Inventory",
                                section: "inventory-stock",
                                stockView: row.condition as
                                  "quarantine" | "damaged",
                                warehouseId: row.warehouseId,
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                    <ReportFooter>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() =>
                          navigate({
                            page: "Inventory",
                            section: "inventory-stock",
                          })
                        }
                      >
                        Review stock queue <WorkspaceIcon name="arrow" />
                      </button>
                    </ReportFooter>
                  </section>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
