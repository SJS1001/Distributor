import React from "react";
import { FinancialReport } from "./financial-report.tsx";
import { DashboardReports } from "./dashboard-reports.tsx";
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
  const points = (rows: typeof days) =>
    rows
      .map((d, i) => `${110 + i * 8},${110 - (d.value / max) * 80}`)
      .join(" ");
  const display = (v: number) =>
    currency ? amount(v, currency) : v.toLocaleString();
  return (
    <section className="analytics-history">
      <h3>{title}</h3>
      <details>
        <summary>Period and calculation details</summary>
        <p>
          {current[0]?.date}–{current.at(-1)?.date} UTC compared with{" "}
          {previous[0]?.date}–{previous.at(-1)?.date}.{" "}
          {currency
            ? `${currency}, original invoice total including tax; before credits, payments and refunds. Invoiced sales, not recognized revenue.`
            : "Accepted orders by recorded creation date; includes orders now closed."}{" "}
          Today is partial.
        </p>
      </details>
      <div className="analytics-period-total">
        <strong>{display(current.reduce((n, d) => n + d.value, 0))}</strong>
        <span>
          last 28 days · previous{" "}
          {display(previous.reduce((n, d) => n + d.value, 0))}
        </span>
      </div>
      <svg
        viewBox="0 0 360 150"
        role="img"
        aria-label={`${title}. Solid line current period; dashed line previous period. Exact daily values in the table below.`}
      >
        <line x1="110" y1="30" x2="110" y2="110" stroke="#98a2b3" />
        <line x1="110" y1="110" x2="330" y2="110" stroke="#98a2b3" />
        <text x="104" y="34" fontSize="12" textAnchor="end">
          {display(max)}
        </text>
        <text x="104" y="110" fontSize="12" textAnchor="end">
          0
        </text>
        <text x="110" y="134" fontSize="12">
          {current[0]?.date}
        </text>
        <text x="330" y="134" fontSize="12" textAnchor="end">
          {current.at(-1)?.date}
        </text>
        <polygon
          fill="#d6e7fb"
          opacity="0.65"
          points={`110,110 ${points(current)} ${110 + Math.max(0, current.length - 1) * 8},110`}
        />
        <polyline
          fill="none"
          stroke="#315fbd"
          strokeWidth="2"
          points={points(current)}
        />
        <polyline
          fill="none"
          stroke="#667085"
          strokeWidth="2"
          strokeDasharray="4 3"
          points={points(previous)}
        />
      </svg>
      <p>
        Solid blue: current period ({current[0]?.date} to {current.at(-1)?.date}
        ). Dashed gray: previous period ({previous[0]?.date} to{" "}
        {previous.at(-1)?.date}). Vertical scale: {display(0)} to {display(max)}{" "}
        {currency ? "per day" : "orders per day"}.
      </p>
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
  return (
    <section className="dashboard-card analytics-attention">
      <h2>Needs attention</h2>
      <p>
        Current accessible records. Reservation exceptions block new allocation
        or fulfillment; the linked queue shows these reservation exceptions.
      </p>
      <ul>
        {items.map((item) => (
          <li key={item.label}>
            <button
              className="text-action"
              onClick={() => navigate(item.intent)}
            >
              {item.label}: <strong>{item.value.toLocaleString()}</strong>
            </button>
          </li>
        ))}
      </ul>
      {items.every((i) => i.value === 0) && (
        <p>No records match these attention rules.</p>
      )}
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
  return (
    <DashboardReports
      scope={preferenceScope}
      reports={[
        ...(data.invoices
          ? [
              {
                id: "transactions",
                label: "Sales, credits & payments",
                content: <FinancialReport customer={customer} />,
              },
            ]
          : []),
        {
          id: "orders",
          label: "Order activity",
          content: (
            <section className="dashboard-card">
              <h2>Where are orders waiting?</h2>
              <p>Current status distribution across accessible records.</p>
              {data.orders.states.length === 0 && (
                <p>No orders recorded yet.</p>
              )}
              {data.orders.states.map((row) => (
                <div className="order-bar" key={row.state}>
                  <button
                    className="text-action"
                    onClick={() =>
                      navigate({
                        page: "Orders",
                        section: "orders-queue",
                        orderState: row.state as "open" | "closed",
                      })
                    }
                  >
                    {row.state === "open"
                      ? "Open — review or fulfill"
                      : "Closed — review history"}
                    : {row.count.toLocaleString()}
                  </button>
                  <div className="bar-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${(row.count / Math.max(1, ...data.orders.states.map((r) => r.count))) * 100}%`,
                        background: "#315fbd",
                      }}
                    />
                  </div>
                </div>
              ))}
              <History
                title="Accepted orders"
                days={data.orders.history.map((d) => ({
                  ...d,
                  value: d.count,
                }))}
                currentStart={data.orders.period.start}
              />
              <button
                className="text-action"
                onClick={() =>
                  navigate({ page: "Orders", section: "orders-queue" })
                }
              >
                Review underlying orders
              </button>
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
                  <section className="dashboard-card">
                    <h2>
                      {customer
                        ? "Your purchases & balances"
                        : "Sales & receivables"}
                    </h2>
                    <p>
                      As of {data.invoices.agingAsOf}.{" "}
                      {data.invoices.agingBasis}. Positive current balances
                      only; currencies are separate.
                    </p>
                    {data.invoices.aging.length === 0 && (
                      <p>No invoices recorded yet.</p>
                    )}
                    {data.invoices.aging.map((group) => (
                      <div key={group.currency}>
                        <h3>{group.currency} balances</h3>
                        {group.buckets.map((row) => (
                          <div className="order-bar" key={row.bucket}>
                            <div>
                              <span>{buckets[row.bucket]}</span>
                              <strong>
                                {amount(row.amount, group.currency)}
                              </strong>
                            </div>
                            <div className="bar-track" aria-hidden="true">
                              <span
                                style={{
                                  width: `${(row.amount / Math.max(1, ...group.buckets.map((r) => r.amount))) * 100}%`,
                                  background: "#ba6b19",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <button
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
                    <button
                      className="text-action"
                      onClick={() =>
                        navigate({
                          page: "Billing",
                          section: "billing-invoices",
                        })
                      }
                    >
                      Review underlying invoices
                    </button>
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
                  <section className="dashboard-card">
                    <h2>Which stock needs attention?</h2>
                    <p>
                      Stock in quarantine or damaged condition, grouped by
                      warehouse. Quantities are physical units; no low-stock
                      threshold is assumed.
                    </p>
                    {data.stock.length === 0 ? (
                      <p>No quarantined or damaged stock in your scope.</p>
                    ) : (
                      <div className="table-wrap">
                        <div className="stock-report-bars">
                          {data.stock.map((row) => (
                            <div
                              className="order-bar"
                              key={row.warehouseId + row.condition}
                            >
                              <div>
                                <span>
                                  {warehouseName?.(row.warehouseId) ??
                                    row.warehouseId}{" "}
                                  · {row.condition}
                                </span>
                                <strong>
                                  {row.quantity.toLocaleString()} units
                                </strong>
                              </div>
                              <div className="bar-track" aria-hidden="true">
                                <span
                                  style={{
                                    width: `${(row.quantity / Math.max(1, ...data.stock!.map((item) => item.quantity))) * 100}%`,
                                    background:
                                      row.condition === "damaged"
                                        ? "#bd4141"
                                        : "#c88b23",
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <table>
                          <thead>
                            <tr>
                              <th>Warehouse</th>
                              <th>Condition</th>
                              <th>Records</th>
                              <th>Units</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.stock.map((row) => (
                              <tr key={row.warehouseId + row.condition}>
                                <td>
                                  {warehouseName?.(row.warehouseId) ??
                                    row.warehouseId}
                                </td>
                                <td>
                                  <button
                                    className="text-action"
                                    onClick={() =>
                                      navigate({
                                        page: "Inventory",
                                        section: "inventory-stock",
                                        stockView: row.condition as
                                          "quarantine" | "damaged",
                                        warehouseId: row.warehouseId,
                                      })
                                    }
                                  >
                                    {row.condition}
                                  </button>
                                </td>
                                <td>{row.records}</td>
                                <td>{row.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
