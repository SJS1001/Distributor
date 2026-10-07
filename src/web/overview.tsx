import React from "react";
import { InfoBubble } from "./info-bubble.tsx";
import type { Application } from "../server/application.ts";
import type { NavigationIntent } from "./navigation.ts";
import { Attention, OperationalAnalytics } from "./operational-analytics.tsx";
import { WorkspaceIcon } from "./workspace.tsx";

type OverviewData = {
  warehouses?: Record<string, unknown>[];
  analytics?: ReturnType<Application["dashboard"]>["analytics"];
  orderCounts: { total: number; open: number };
  invoiceSummary: {
    total: number;
    unpaid: number;
    settled: number;
    credit: number;
    due: number;
  };
  stockSummary: { available: number };
  orders: {
    id: string;
    account_id: string;
    state: string;
    created_at: string;
  }[];
};
type Segment = { label: string; value: number; color: string };
const number = (value: number) => value.toLocaleString();
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(value / 100);

// Every segment uses complete, permission-scoped server aggregates, never a
// paginated queue or invented historical trend. Values remain available as text.
export function DistributionChart({
  label,
  segments,
  unit,
}: {
  label: string;
  segments: Segment[];
  unit: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <div className="distribution-chart">
      <div className="chart-ring">
        <svg
          viewBox="0 0 120 120"
          role="img"
          aria-label={`${label}: ${number(total)} ${unit}. ${segments.map((s) => `${s.label}: ${number(s.value)}`).join("; ")}`}
        >
          <circle
            cx="60"
            cy="60"
            r="48"
            fill="none"
            stroke="#e9edf2"
            strokeWidth="12"
          />
          {total > 0 &&
            segments.map((segment) => {
              const length = (segment.value / total) * 100;
              const start = offset;
              offset += length;
              return (
                <circle
                  key={segment.label}
                  cx="60"
                  cy="60"
                  r="48"
                  pathLength="100"
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="12"
                  strokeDasharray={`${length} ${100 - length}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 60 60)"
                />
              );
            })}
        </svg>
        <div className="chart-ring-label" aria-hidden="true">
          <strong>{number(total)}</strong>
          <span>{unit}</span>
        </div>
      </div>
      <dl className="chart-legend">
        {segments.map((s) => (
          <div key={s.label}>
            <dt>
              <span className="legend-dot" style={{ background: s.color }} />
              {s.label}
            </dt>
            <dd>{number(s.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function ParcelGraphic() {
  return (
    <svg
      className="parcel-graphic"
      viewBox="0 0 160 120"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 91h128M31 98h31M111 98h19"
        stroke="#c4cfda"
        strokeWidth="2"
      />
      <path
        d="m48 44 32-17 32 17v39L80 101 48 83Z"
        fill="#edf2f6"
        stroke="#8394a6"
        strokeWidth="2"
      />
      <path d="m48 44 32 17 32-17M80 61v40" stroke="#8394a6" strokeWidth="2" />
      <path d="m66 35 32 17v13l-13 7V59L54 42" fill="#e89b44" />
      <path d="m91 81 12-6M91 87l8-4" stroke="#8394a6" strokeWidth="2" />
      <path
        d="M23 43h13M30 36v14M122 25h10M127 20v10"
        stroke="#a0b1c0"
        strokeWidth="2"
      />
    </svg>
  );
}
export function Overview({
  data,
  currency,
  staff,
  canReadInvoices,
  canPrepare,
  canReceive = false,
  busy,
  navigate,
  prepare,
  accountName,
  preferenceScope,
}: {
  data: OverviewData;
  currency: string;
  staff: boolean;
  canReadInvoices: boolean;
  canPrepare: boolean;
  canReceive?: boolean;
  busy: boolean;
  navigate: (page: string | NavigationIntent) => void;
  prepare: () => void;
  accountName: (id: string) => string;
  preferenceScope?: string;
}) {
  const invoice = data.invoiceSummary;
  const metrics = [
    {
      label: "Open orders",
      value: number(data.orderCounts.open),
      hint: "Orders still in progress",
      page: "Orders",
      icon: "Orders",
    },
    ...(staff
      ? [
          {
            label: "Available units",
            value: number(data.stockSummary.available),
            hint: "Across your accessible stock",
            page: "Inventory",
            icon: "Inventory",
          },
        ]
      : []),
    ...(canReadInvoices
      ? [
          {
            label: "Invoice balance",
            value: data.analytics?.invoices
              ? data.analytics.invoices.balances
                  .map((row) => money(row.due, row.currency))
                  .join(" · ") || money(0, currency)
              : money(invoice.due, currency),
            hint: "Outstanding positive balances",
            page: "Billing",
            icon: "Billing",
          },
          {
            label: "Unpaid invoices",
            value: number(invoice.unpaid),
            hint: "Invoices with a balance due",
            page: "Billing",
            icon: "Reconciliation",
          },
        ]
      : []),
  ];
  const routes = staff
    ? [
        {
          page: "Purchasing",
          title: canReceive ? "Receive stock" : "Review purchasing",
          detail: canReceive
            ? "Start a receipt from a purchase order"
            : "Purchase orders & receipts",
        },
        {
          page: "Inventory",
          title: "Manage inventory",
          detail: "Stock & serials",
        },
        {
          page: "Orders",
          title: "Fulfill orders",
          detail: "Orders & shipments",
        },
        ...(canReadInvoices
          ? [
              {
                page: "Billing",
                title: "Review billing",
                detail: "Invoices & payments",
              },
            ]
          : []),
      ]
    : [
        {
          page: "Orders",
          title: "Track orders",
          detail: "Orders & deliveries",
        },
        {
          page: "Billing",
          title: "Review billing",
          detail: "Invoices & payments",
        },
        {
          page: "Returns",
          title: "Manage returns",
          detail: "Returns & warranty",
        },
      ];
  return (
    <div className="overview">
      <div className="overview-intro">
        <div>
          <div className="info-heading">
            <h2>{staff ? "At a glance" : "Your account at a glance"}</h2>
            <InfoBubble label="these totals">
              Current totals across your accessible records
            </InfoBubble>
          </div>
        </div>
        {canPrepare && (
          <button className="primary-action" disabled={busy} onClick={prepare}>
            <WorkspaceIcon name="Orders" />
            Prepare order
            <WorkspaceIcon name="arrow" />
          </button>
        )}
      </div>
      <div className="overview-metrics">
        {metrics.map((metric) => (
          <button
            className="metric-card"
            key={metric.label}
            onClick={() =>
              navigate(
                metric.page === "Orders"
                  ? {
                      page: "Orders",
                      section: "orders-queue",
                      orderState: "open",
                    }
                  : metric.page === "Billing"
                    ? {
                        page: "Billing",
                        section: "billing-invoices",
                        invoiceBalance: "unpaid",
                      }
                    : {
                        page: "Inventory",
                        section: "inventory-stock",
                        stockView: "available",
                      },
              )
            }
          >
            <span className="metric-top">
              <span>{metric.label}</span>
              <WorkspaceIcon name={metric.icon} />
            </span>
            <strong>{metric.value}</strong>
            <span className="metric-hint">
              {metric.hint}
              <WorkspaceIcon name="arrow" />
            </span>
          </button>
        ))}
      </div>
      {data.analytics && (
        <Attention data={data.analytics} navigate={navigate} />
      )}
      <div className="overview-workbench">
        <section className="dashboard-card recent-orders">
          <div className="section-title">
            <div>
              <span className="section-kicker">Work queue</span>
              <h2>Recent orders</h2>
            </div>
            <button className="text-action" onClick={() => navigate("Orders")}>
              All orders <WorkspaceIcon name="arrow" />
            </button>
          </div>
          {data.orders.length ? (
            <>
              <p className="chart-note">
                {Math.min(data.orders.length, 8) === 1
                  ? "Latest recorded order."
                  : `Latest ${Math.min(data.orders.length, 8)} recorded orders.`}{" "}
                Open the order queue for all records and actions.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {staff && <th>Customer</th>}
                      <th>Order</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.slice(0, 8).map((order) => (
                      <tr key={order.id}>
                        {staff && (
                          <td data-label="Customer">
                            {accountName(order.account_id)}
                          </td>
                        )}
                        <td data-label="Order">
                          <button
                            type="button"
                            className="record-link"
                            title={order.id}
                            onClick={() =>
                              navigate({
                                page: "Orders",
                                section: "orders-queue",
                                orderId: order.id,
                              })
                            }
                          >
                            <code>{order.id.slice(0, 8)}</code>
                          </button>
                        </td>
                        <td data-label="Status">
                          <span
                            className={`order-state ${order.state === "open" ? "is-open" : ""}`}
                          >
                            {order.state.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td data-label="Created">
                          {new Date(order.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="dashboard-empty">
              <ParcelGraphic />
              <div>
                <h3>Your order book starts here</h3>
                <p>
                  {canPrepare
                    ? "Prepare an order to review products, quantities and availability before accepting it."
                    : "Orders will appear here once they have been accepted."}
                </p>
                {canPrepare && (
                  <button
                    className="text-action"
                    disabled={busy}
                    onClick={prepare}
                  >
                    Prepare your first order <WorkspaceIcon name="arrow" />
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
        <section
          className="workflow-section"
          aria-labelledby="workflow-heading"
        >
          <div className="section-title">
            <h2 id="workflow-heading">Quick access</h2>
          </div>
          <div className="workflow-path">
            {routes.map((route) => (
              <button
                key={route.page}
                onClick={() =>
                  navigate({
                    page: route.page,
                    section:
                      route.page === "Purchasing"
                        ? "purchasing-queue"
                        : route.page === "Orders"
                          ? "orders-queue"
                          : route.page === "Inventory"
                            ? "inventory-stock"
                            : route.page === "Billing"
                              ? "billing-invoices"
                              : undefined,
                  })
                }
              >
                <WorkspaceIcon name={route.page} />
                <span>
                  <strong>{route.title}</strong>
                  <small>{route.detail}</small>
                </span>
                <WorkspaceIcon name="arrow" />
              </button>
            ))}
          </div>
        </section>
      </div>
      {data.analytics ? (
        <OperationalAnalytics
          preferenceScope={preferenceScope}
          customer={!staff}
          data={data.analytics}
          navigate={navigate}
          warehouseName={(id) =>
            String(
              data.warehouses?.find((warehouse) => warehouse.id === id)?.name ??
                id,
            )
          }
        />
      ) : (
        <div className="overview-charts">
          <section className="dashboard-card">
            <div className="section-title">
              <div>
                <span className="section-kicker">Order book</span>
                <h2>Order activity</h2>
              </div>
              <button
                className="text-action"
                onClick={() => navigate("Orders")}
              >
                View orders <WorkspaceIcon name="arrow" />
              </button>
            </div>
            <div
              className="order-chart"
              role="img"
              aria-label={`Order activity: ${number(data.orderCounts.total)} orders. Open: ${number(data.orderCounts.open)}; Closed: ${number(data.orderCounts.total - data.orderCounts.open)}`}
            >
              <div className="order-chart-total">
                <strong>{number(data.orderCounts.total)}</strong>
                <span>total orders</span>
              </div>
              {[
                {
                  label: "Open",
                  value: data.orderCounts.open,
                  color: "#315fbd",
                },
                {
                  label: "Closed",
                  value: data.orderCounts.total - data.orderCounts.open,
                  color: "#9daec5",
                },
              ].map((segment) => (
                <div className="order-bar" key={segment.label}>
                  <div>
                    <span>{segment.label}</span>
                    <strong>{number(segment.value)}</strong>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${data.orderCounts.total ? (segment.value / data.orderCounts.total) * 100 : 0}%`,
                        background: segment.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="chart-note">
              {data.orderCounts.total === 0
                ? "No orders recorded yet. Accepted orders will appear here."
                : "Open and closed orders as a share of all accessible orders."}
            </p>
          </section>
          {canReadInvoices && (
            <section className="dashboard-card">
              <div className="section-title">
                <div>
                  <span className="section-kicker">Accounts receivable</span>
                  <h2>Invoice balances</h2>
                </div>
                <button
                  className="text-action"
                  onClick={() => navigate("Billing")}
                >
                  View billing <WorkspaceIcon name="arrow" />
                </button>
              </div>
              <DistributionChart
                label="Invoice balances"
                unit="invoices"
                segments={[
                  {
                    label: "Balance due",
                    value: invoice.unpaid,
                    color: "#ba6b19",
                  },
                  {
                    label: "Settled",
                    value: invoice.settled,
                    color: "#23796d",
                  },
                  {
                    label: "Credit balance",
                    value: invoice.credit,
                    color: "#6671b7",
                  },
                ]}
              />
              <p className="chart-note">
                {invoice.total === 0
                  ? "No invoices recorded yet. Issued invoices will appear here."
                  : "Invoice counts by current balance, across all accessible invoices."}
              </p>
            </section>
          )}
        </div>
      )}
      <p className="overview-footnote">
        Current snapshot · Totals respect your account and warehouse access. Use
        Refresh to load the latest figures.
      </p>
    </div>
  );
}
