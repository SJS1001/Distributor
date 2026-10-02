import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import type {
  ControlIssues,
  Reconciliation,
} from "../shared/reconciliation.ts";
function money(value: string, currency: string) {
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? "−" : ""}${(absolute / 100n).toLocaleString("en-US")}.${String(absolute % 100n).padStart(2, "0")}`;
}
function Issues({ name, issues }: { name: string; issues: ControlIssues }) {
  return (
    <section aria-label={`${name} discrepancies`}>
      <h3>
        {name} discrepancies: {issues.count}
      </h3>
      {issues.count === 0 ? (
        <p>No discrepancies detected in these controls.</p>
      ) : (
        <>
          <p role="alert">
            Investigate the original records before correcting stock or money.
          </p>
          <ol>
            {issues.items.map((issue, i) => (
              <li key={i}>
                {issue.code.replaceAll("_", " ")} · Record {issue.recordId}
                {issue.expected !== null && (
                  <p>
                    Expected {issue.expected} · Recorded {issue.actual}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {issues.truncated && (
            <p>
              Showing the first {issues.items.length} details. The count covers
              the complete scan. Resolve these records and run the controls
              again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function ReconciliationPanel() {
  const [data, setData] = useState<Reconciliation | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const load = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const result = await request<Reconciliation>(
        "/api/operations/reconciliation",
        { signal: controller.signal },
      );
      if (pending.current === controller && !controller.signal.aborted)
        setData(result);
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Reconciliation could not be completed.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  return (
    <section className="panel" aria-label="Stock and billing reconciliation">
      <h2>Stock and billing reconciliation</h2>
      <p>
        Control totals from one current database snapshot. Stock includes
        quarantine and in-transit custody at original cost. Transfers do not
        change organization-wide quantity or value.
      </p>
      <p>
        These controls compare stock by product and native billing records. They
        do not verify physical counts, shipment-to-invoice agreement, bank
        statements or provider balances.
      </p>
      <button onClick={() => void load()} disabled={busy}>
        Run reconciliation
      </button>
      {busy && <p role="status">Checking stock and billing…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p role="status">
            Checked {data.checkedAt} · {data.currency} ·{" "}
            {data.stock.issues.count + data.billing.issues.count} discrepancies
          </p>
          <h3>Stock controls</h3>
          <dl>
            <dt>Recorded quantity</dt>
            <dd>{data.stock.quantity}</dd>
            <dt>Movement quantity</dt>
            <dd>{data.stock.movementQuantity}</dd>
            <dt>Recorded original cost</dt>
            <dd>{money(data.stock.value, data.currency)}</dd>
            <dt>Movement original cost</dt>
            <dd>{money(data.stock.movementValue, data.currency)}</dd>
          </dl>
          <p>
            {data.stock.units} custody records · {data.stock.products} products
            · {data.stock.movements} movements
          </p>
          <Issues name="Stock" issues={data.stock.issues} />
          <h3>Billing controls</h3>
          <dl>
            <dt>Invoice total</dt>
            <dd>{money(data.billing.total, data.currency)}</dd>
            <dt>Credits</dt>
            <dd>{money(data.billing.credited, data.currency)}</dd>
            <dt>Payments</dt>
            <dd>{money(data.billing.paid, data.currency)}</dd>
            <dt>Completed refunds</dt>
            <dd>{money(data.billing.refunded, data.currency)}</dd>
            <dt>Document balance</dt>
            <dd>{money(data.billing.balance, data.currency)}</dd>
            <dt>Pending refunds</dt>
            <dd>{money(data.billing.pendingRefunds, data.currency)}</dd>
            <dt>Uncertain refunds</dt>
            <dd>{money(data.billing.uncertainRefunds, data.currency)}</dd>
          </dl>
          <p>
            {data.billing.invoices} invoices · {data.billing.credits} credits ·{" "}
            {data.billing.payments} payments · {data.billing.refunds} refund
            requests
          </p>
          <Issues name="Billing" issues={data.billing.issues} />
        </>
      )}
    </section>
  );
}
