import React, { useEffect, useRef, useState } from "react";
import { usePages } from "./billing-inbox.tsx";
import type { PaymentSummary } from "../shared/payment-history.ts";

// The refund command needs a payment identity, independently of the cash-history
// window. Keep this read owned by the dialog so close/sign-out cancels it.
export function RefundPaymentSelect({ invoiceId }: { invoiceId: string }) {
  const rows = usePages<PaymentSummary>(
    `/api/billing/invoices/${encodeURIComponent(invoiceId)}/payments/page`,
  );
  const [selected, setSelected] = useState("");
  const select = useRef<HTMLSelectElement>(null);
  const previouslyBusy = useRef(false);
  useEffect(() => {
    if (
      previouslyBusy.current &&
      !rows.busy &&
      rows.loaded &&
      rows.next === null
    )
      select.current?.focus();
    previouslyBusy.current = rows.busy;
  }, [rows.busy, rows.next, rows.loaded]);
  return (
    <div>
      <select
        ref={select}
        name="paymentId"
        aria-labelledby="field-label-paymentId"
        required
        value={selected || rows.items[0]?.id || ""}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="" disabled>
          Select…
        </option>
        {rows.items.map((payment) => (
          <option key={payment.id} value={payment.id}>
            {payment.provider} ·{" "}
            {new Intl.NumberFormat("en", {
              style: "currency",
              currency: payment.currency,
            }).format(payment.amount / 100)}{" "}
            · {payment.external_ref}
          </option>
        ))}
      </select>
      <p role="status">
        {rows.items.length} invoice payments loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      {rows.loaded && !rows.items.length && (
        <p>No cash payments are recorded for this invoice.</p>
      )}
      {(rows.next !== null || rows.error) && (
        <button
          type="button"
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error
            ? "Retry invoice payments"
            : "Load older invoice payments"}
        </button>
      )}
    </div>
  );
}
