import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Overview } from "../src/web/overview.tsx";
import {
  PageSections,
  PageSection,
  WorkspaceNavigation,
  WorkspaceTabs,
} from "../src/web/workspace.tsx";

const data = {
  orderCounts: { total: 80, open: 60 },
  invoiceSummary: {
    total: 45,
    unpaid: 30,
    settled: 12,
    credit: 3,
    due: 123456,
  },
  stockSummary: { available: 240 },
  orders: [
    {
      id: "synthetic-order",
      account_id: "account",
      state: "open",
      created_at: "2026-10-01T12:00:00Z",
    },
  ],
};
const props = {
  data,
  currency: "CAD",
  staff: true,
  canReadInvoices: true,
  canPrepare: true,
  busy: false,
  navigate: () => {},
  prepare: () => {},
  accountName: () => "Synthetic account",
};

test("overview charts use complete aggregates even when queues contain one record", () => {
  const html = renderToStaticMarkup(React.createElement(Overview, props));
  assert.match(html, /Order activity: 80 orders\. Open: 60; Closed: 20/);
  assert.match(
    html,
    /Invoice balances: 45 invoices\. Balance due: 30; Settled: 12; Credit balance: 3/,
  );
  assert.match(html, /width:75%/);
  assert.match(html, /width:25%/);
  assert.match(html, /Latest recorded order\./);
  assert.match(html, /1,234\.56/);
});

test("empty charts retain honest zero states without invalid geometry", () => {
  const html = renderToStaticMarkup(
    React.createElement(Overview, {
      ...props,
      data: {
        ...data,
        orderCounts: { total: 0, open: 0 },
        invoiceSummary: { total: 0, unpaid: 0, settled: 0, credit: 0, due: 0 },
        orders: [],
      },
    }),
  );
  assert.match(html, /No orders recorded yet/);
  assert.match(html, /No invoices recorded yet/);
  assert.match(html, /Prepare your first order/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overview does not expose unavailable finance, warehouse or order-entry controls", () => {
  const warehouse = renderToStaticMarkup(
    React.createElement(Overview, {
      ...props,
      canReadInvoices: false,
      canPrepare: false,
    }),
  );
  assert.doesNotMatch(
    warehouse,
    /Invoice balances|Invoice balance|Unpaid invoices|View billing|Review billing|Prepare order/,
  );
  const buyer = renderToStaticMarkup(
    React.createElement(Overview, { ...props, staff: false }),
  );
  assert.doesNotMatch(buyer, /Available units|Receive stock|Manage inventory/);
  assert.match(buyer, /Track orders/);
});

test("buyer navigation exposes storefront destinations, reports and the active page", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkspaceNavigation, {
      pages: ["Shop", "Orders", "Billing", "Reports", "Account", "Returns"],
      page: "Orders",
      organization: "Synthetic organization",
      name: "Buyer",
      role: "buyer",
      region: "CA",
      navigate: () => {},
      signOut: () => {},
    }),
  );
  assert.doesNotMatch(
    html,
    />Inventory<|>Purchasing<|>Administration<|>Reconciliation<|>Operations health</,
  );
  assert.match(html, /<button aria-current="page">Orders<\/button>/);
  assert.doesNotMatch(html, />Returns<|>Customers<|>Catalog</);
  for (const destination of [
    "Shop",
    "Invoices &amp; payments",
    "Reports",
    "Account",
  ])
    assert.ok(html.includes(`>${destination}</button>`));
  assert.match(
    html,
    /aria-expanded="false" aria-controls="customer-navigation"/,
  );
});

test("category page tabs expose only authorized destinations and current page", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkspaceTabs, {
      pages: ["Overview", "Orders", "Customers", "Billing", "Security"],
      page: "Customers",
      navigate: () => {},
    }),
  );
  assert.match(html, /aria-label="Sales &amp; customers pages"/);
  assert.match(html, />Orders<\/button>/);
  assert.match(html, /aria-current="page"[^]*?Customers<\/button>/);
  assert.doesNotMatch(html, />Catalog<|>Billing<|>Security</);
});

test("section tabs expose one panel, retain inactive content and omit unauthorized sections", () => {
  const html = renderToStaticMarkup(
    React.createElement(PageSections, {
      label: "Orders sections",
      items: [
        { id: "orders", label: "Orders" },
        { id: "shipments", label: "Shipments" },
      ],
      children: [
        React.createElement(PageSection, {
          key: "orders",
          id: "orders",
          children: "Order queue",
        }),
        React.createElement(PageSection, {
          key: "shipments",
          id: "shipments",
          children: "Shipment filters",
        }),
        React.createElement(PageSection, {
          key: "restricted",
          id: "restricted",
          children: "Restricted controls",
        }),
      ],
    }),
  );
  assert.match(html, /role="tablist" aria-label="Orders sections"/);
  assert.match(
    html,
    /id="orders-tab" aria-controls="orders-panel" aria-selected="true" tabindex="0"/,
  );
  assert.match(
    html,
    /id="shipments-tab" aria-controls="shipments-panel" aria-selected="false" tabindex="-1"/,
  );
  assert.match(
    html,
    /id="orders-panel" aria-labelledby="orders-tab" tabindex="0">Order queue/,
  );
  assert.match(
    html,
    /id="shipments-panel" aria-labelledby="shipments-tab" tabindex="0" hidden="">Shipment filters/,
  );
  assert.doesNotMatch(html, /Restricted controls|On this page/);
});

test("section destinations select an allowed panel and fall back for an unavailable section", () => {
  for (const [defaultSection, expected] of [
    ["shipments", "shipments"],
    ["restricted", "orders"],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(PageSections, {
        label: "Orders sections",
        defaultSection,
        items: [
          { id: "orders", label: "Orders" },
          { id: "shipments", label: "Shipments" },
        ],
        children: null,
      }),
    );
    assert.match(
      html,
      new RegExp(`id="${expected}-tab"[^>]*aria-selected="true"`),
    );
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
  }
});

test("report grid spans wide reports and any card left alone in its row", async () => {
  const { reportSpans } = await import("../src/web/dashboard-reports.tsx");
  const wide = { wide: true },
    card = {};
  assert.deepEqual(reportSpans([wide, card, card, card]), [
    true,
    false,
    false,
    true,
  ]);
  assert.deepEqual(reportSpans([card, wide, card, card]), [
    true,
    true,
    false,
    false,
  ]);
  assert.deepEqual(reportSpans([wide, card, card]), [true, false, false]);
  assert.deepEqual(reportSpans([card]), [true]);
  assert.deepEqual(reportSpans([]), []);
});
