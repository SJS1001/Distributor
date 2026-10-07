import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgingInvestigation } from "../src/web/aging-investigation.tsx";
import {
  agingMatches,
  type AgingInvoice,
} from "../src/web/aging-investigation-contract.ts";
const invoice = (
  balance: number,
  bucket = "unknownDue",
  pendingRefunds = 0,
): AgingInvoice => ({
  id: "invoice",
  number: "INV",
  currency: "CAD",
  dueAt: null,
  dueBasis: "Not recorded",
  bucket,
  total: 10000,
  paid: 0,
  credited: 0,
  refunded: 0,
  balance,
  pendingRefunds,
});
test("unknown due investigation excludes settled and credited records while retaining positive receivables", () => {
  assert.equal(agingMatches(invoice(100), "unknownDue"), true);
  assert.equal(agingMatches(invoice(0), "unknownDue"), false);
  assert.equal(agingMatches(invoice(-100), "unknownDue"), false);
  assert.equal(agingMatches(invoice(100, "notDue"), "unknownDue"), false);
});
test("overdue investigation follows recorded buckets and never infers dates for missing terms", () => {
  for (const bucket of ["days1to30", "days31to60", "days61to90", "daysOver90"])
    assert.equal(agingMatches(invoice(100, bucket), "overdue"), true);
  for (const bucket of ["unknownDue", "notDue", "unexpected"])
    assert.equal(agingMatches(invoice(100, bucket), "overdue"), false);
  assert.equal(agingMatches(invoice(-100, "daysOver90"), "overdue"), false);
});
test("refund exceptions remain independent of settled or credit balance and filtering never mutates financial facts", () => {
  const source = invoice(-250, "unknownDue", 200),
    before = structuredClone(source);
  assert.equal(agingMatches(source, "pendingRefunds"), true);
  assert.equal(agingMatches(source, "credit"), true);
  assert.equal(agingMatches(source, "open"), false);
  assert.equal(agingMatches(source, "all"), true);
  assert.equal(agingMatches(invoice(0, "notDue", 200), "pendingRefunds"), true);
  assert.deepEqual(source, before);
});

test("account investigation explicitly pages matching snapshot records and omits unauthorized customer navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AgingInvestigation, {
      accountId: "customer",
      initialFilter: "unknownDue",
      initialReport: {
        observedAt: "2026-10-07T12:00:00Z",
        accounts: [
          {
            accountId: "customer",
            name: "Synthetic customer",
            currency: "CAD",
            invoices: Array.from({ length: 24 }, (_, index) => ({
              ...invoice(100),
              id: `invoice-${index}`,
              number: `INV-${index}`,
            })),
          },
        ],
      },
      onClose: () => {},
      onInvoice: () => {},
    }),
  );
  assert.match(html, /20 of 24 matching invoice records shown/);
  assert.match(html, /Show more matching invoices/);
  assert.match(html, /Unknown due date/);
  assert.match(html, /INV-19 · Investigate invoice/);
  assert.doesNotMatch(html, /INV-20 · Investigate invoice/);
  assert.doesNotMatch(html, /Open customer record/);
  assert.match(
    html,
    /Changing account terms does not change an existing invoice/,
  );
});

test("a refreshed missing account yields an explicit scoped absence, with no invoice or customer action", () => {
  const html = renderToStaticMarkup(
    React.createElement(AgingInvestigation, {
      accountId: "no-longer-permitted",
      initialReport: { observedAt: "2026-10-07T12:00:00Z", accounts: [] },
      onClose: () => {},
      onInvoice: () => {},
      onCustomer: () => {},
    }),
  );
  assert.match(html, /absent from the current permitted aging report/);
  assert.doesNotMatch(
    html,
    /Investigate invoice|Open customer record|All matching records shown/,
  );
});
