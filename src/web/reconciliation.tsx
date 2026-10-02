import React, { useEffect, useRef, useState } from "react";
import { request, command, downloadReconciliation } from "./api.ts";
import type {
  ControlIssues,
  Reconciliation,
  ReconciliationHistory,
  ReconciliationReceipt,
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
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<ReconciliationHistory | null>(null),
    [historyError, setHistoryError] = useState(""),
    [historyBusy, setHistoryBusy] = useState(false),
    [action, setAction] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  const historyPending = useRef<AbortController | null>(null),
    actionPending = useRef<AbortController | null>(null);
  const loadHistory = async (after?: string) => {
    if (historyPending.current) return;
    const controller = new AbortController();
    historyPending.current = controller;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const result = await request<ReconciliationHistory>(
        `/api/operations/reconciliation/history${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        { signal: controller.signal },
      );
      if (historyPending.current === controller && !controller.signal.aborted)
        setHistory((old) =>
          after && old
            ? { items: [...old.items, ...result.items], next: result.next }
            : result,
        );
    } catch (e) {
      if (historyPending.current === controller && !controller.signal.aborted)
        setHistoryError(
          e instanceof Error ? e.message : "Report history is unavailable.",
        );
    } finally {
      if (historyPending.current === controller) {
        historyPending.current = null;
        setHistoryBusy(false);
      }
    }
  };
  const reportAction = async (receipt?: ReconciliationReceipt) => {
    if (actionPending.current || (!receipt && !data)) return;
    const controller = new AbortController();
    actionPending.current = controller;
    setAction(receipt ? "Downloading report…" : "Saving reviewed report…");
    setNotice("");
    setError("");
    try {
      if (receipt) await downloadReconciliation(receipt, controller.signal);
      else {
        const saved = (await command(
          "operations.reconciliation.prepare",
          { expectedHash: data!.snapshotHash },
          controller.signal,
        )) as ReconciliationReceipt;
        if (
          actionPending.current === controller &&
          !controller.signal.aborted
        ) {
          setNotice(
            `Report saved at ${saved.checkedAt}. Download it from saved reports.`,
          );
          // A previous history read must not overwrite the newly saved history.
          historyPending.current?.abort();
          historyPending.current = null;
          await loadHistory();
        }
      }
    } catch (e) {
      if (actionPending.current === controller && !controller.signal.aborted)
        setError(
          `${e instanceof Error ? e.message : "Report could not be saved or downloaded."}${receipt ? "" : " If the response was lost, retry this same review or refresh saved reports to find a completed save."}`,
        );
    } finally {
      if (actionPending.current === controller) {
        actionPending.current = null;
        setAction("");
      }
    }
  };
  const load = async () => {
    if (pending.current || actionPending.current) return;
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
    void loadHistory();
    return () => {
      pending.current?.abort();
      pending.current = null;
      historyPending.current?.abort();
      historyPending.current = null;
      actionPending.current?.abort();
      actionPending.current = null;
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
        These controls compare stock by product, native billing records and
        agreement between orders, shipments, stock deductions and invoices. They
        do not verify physical counts, bank statements or provider balances.
      </p>
      <button onClick={() => void load()} disabled={busy || !!action}>
        Run reconciliation
      </button>
      {busy && <p role="status">Checking stock and billing…</p>}
      <button
        onClick={() => void reportAction()}
        disabled={!data || busy || !!action}
      >
        Save reviewed report
      </button>
      {action && <p role="status">{action}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p role="status">
            Checked {data.checkedAt} · {data.currency} ·{" "}
            {data.stock.issues.count +
              data.billing.issues.count +
              data.sales.issues.count}{" "}
            discrepancies
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
          <h3>Sales agreement controls</h3>
          <dl>
            <dt>Shipped quantity</dt>
            <dd>{data.sales.shippedQuantity}</dd>
            <dt>Stock deduction quantity</dt>
            <dd>{data.sales.movementQuantity}</dd>
            <dt>Invoiced quantity</dt>
            <dd>{data.sales.invoicedQuantity}</dd>
            <dt>Shipped original cost</dt>
            <dd>{money(data.sales.shippedCost, data.currency)}</dd>
            <dt>Stock deduction original cost</dt>
            <dd>{money(data.sales.movementCost, data.currency)}</dd>
            <dt>Regional native invoice line net</dt>
            <dd>{money(data.sales.invoiceNet, data.currency)}</dd>
            <dt>Regional native invoice line tax</dt>
            <dd>{money(data.sales.invoiceTax, data.currency)}</dd>
          </dl>
          <p>
            {data.sales.orders} orders · {data.sales.shipments} committed
            shipments · {data.sales.invoices} native invoices ·{" "}
            {data.sales.openingInvoices} historical opening invoices excluded
            from sales agreement
          </p>
          <Issues name="Sales agreement" issues={data.sales.issues} />
        </>
      )}
      <section aria-label="Saved reconciliation reports">
        <h3>Saved reports</h3>
        <p>
          Saving checks the displayed controls again. Each dated report retains
          its original bytes and discrepancy details. It does not verify
          physical stock or external balances.
        </p>
        <button
          onClick={() => void loadHistory()}
          disabled={historyBusy || !!action}
        >
          Refresh saved reports
        </button>
        {historyBusy && <p role="status">Loading saved reports…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {history?.items.length === 0 && <p>No saved reports.</p>}
        <ol>
          {history?.items.map((r) => (
            <li key={r.id}>
              <p>
                Checked {r.checkedAt} · {r.currency} · {r.discrepancies}{" "}
                discrepancies · Prepared by {r.preparedBy}
              </p>
              <button onClick={() => void reportAction(r)} disabled={!!action}>
                Download report {r.id}
              </button>
            </li>
          ))}
        </ol>
        {history?.next && (
          <button
            onClick={() => void loadHistory(history.next!)}
            disabled={historyBusy || !!action}
          >
            Load older reports
          </button>
        )}
      </section>
    </section>
  );
}
