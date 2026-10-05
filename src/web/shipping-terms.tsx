import React, { useEffect, useId, useState } from "react";
import { request, RequestError } from "./api.ts";
import {
  shippingSummary,
  type ShippingTerms,
} from "../shared/shipping-terms.ts";
export { shippingSummary } from "../shared/shipping-terms.ts";
type Payload = {
  cartId: string;
  cartRevision: number;
  treatment: ShippingTerms["treatment"];
  net: number;
  tax: number;
  reason: string;
};
type Attempt = { key: string; payload: Payload };
export function ShippingTermsEditor({
  cartId,
  cartRevision,
  currency,
  recoveryScope,
  onSaved,
}: {
  cartId: string;
  cartRevision: number;
  currency: string;
  recoveryScope: string;
  onSaved?: () => void | Promise<void>;
}) {
  const prefix = useId(),
    storageKey = `distributor-shipping:${recoveryScope}:${cartId}`;
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { attempt: null as Attempt | null, error: "" };
      const value = JSON.parse(raw) as Attempt;
      if (
        raw.length > 20000 ||
        !/^[a-f0-9-]{36}$/.test(value.key) ||
        value.payload?.cartId !== cartId ||
        !Number.isInteger(value.payload.cartRevision) ||
        !["extra", "included", "unspecified"].includes(
          value.payload.treatment,
        ) ||
        !Number.isSafeInteger(value.payload.net) ||
        value.payload.net < 0 ||
        !Number.isSafeInteger(value.payload.tax) ||
        value.payload.tax < 0 ||
        typeof value.payload.reason !== "string" ||
        !value.payload.reason.trim()
      )
        throw Error();
      return { attempt: value, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved shipping change cannot be read. Restore browser storage and reload before changing this cart.",
      };
    }
  });
  const [value, setValue] = useState<{
      shipping: ShippingTerms;
      cartRevision: number;
    } | null>(null),
    [epoch, setEpoch] = useState(0);
  const [treatment, setTreatment] =
      useState<ShippingTerms["treatment"]>("unspecified"),
    [net, setNet] = useState("0.00"),
    [tax, setTax] = useState("0.00"),
    [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState(recovery.attempt),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rejected, setRejected] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setBusy(true);
    void request<{ shipping: ShippingTerms; cartRevision: number }>(
      `/api/carts/${encodeURIComponent(cartId)}/shipping`,
      { signal: c.signal },
    )
      .then((v) => {
        if (c.signal.aborted) return;
        setValue(v);
        setTreatment(v.shipping.treatment);
        setNet((v.shipping.net / 100).toFixed(2));
        setTax((v.shipping.tax / 100).toFixed(2));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [cartId, cartRevision, epoch]);
  async function send(next: Attempt) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setAttempt(next);
      await request("/api/commands/cart.shipping.set", {
        method: "POST",
        headers: { "idempotency-key": next.key },
        body: JSON.stringify(next.payload),
      });
      localStorage.removeItem(storageKey);
      setAttempt(null);
      setRejected(false);
      setNotice(
        "Shipping terms saved. Obtain a fresh quote before accepting the order.",
      );
      setEpoch((v) => v + 1);
      await onSaved?.();
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof RequestError &&
        e.status < 500 &&
        ![401, 403, 408, 429].includes(e.status)
      )
        setRejected(true);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!attempt || !!recovery.error || !value;
  const cents = (v: string) => {
    if (!/^\d+(\.\d{1,2})?$/.test(v))
      throw Error("Use a nonnegative amount with at most two decimal places.");
    const n = Math.round(Number(v) * 100);
    if (!Number.isSafeInteger(n) || n > 1e12)
      throw Error("Shipping amount is too large.");
    return n;
  };
  return (
    <section aria-label="Cart shipping terms">
      <h3>Cart shipping terms</h3>
      <p>{shippingSummary(value?.shipping, currency)}</p>
      <p>
        Applies to this saved cart. Product or quantity changes require shipping
        review again. Tax is entered explicitly after review; product tax is not
        copied.
      </p>
      {recovery.error && <p role="alert">{recovery.error}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {attempt && (
        <div>
          <p>
            Saved shipping change awaiting confirmation:{" "}
            {shippingSummary({ ...attempt.payload, revision: 0 }, currency)}{" "}
            Reason: {attempt.payload.reason}
          </p>
          <button
            type="button"
            disabled={busy || !!recovery.error}
            onClick={() => void send(attempt)}
          >
            Retry saved shipping change
          </button>
          {rejected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                try {
                  localStorage.removeItem(storageKey);
                  setAttempt(null);
                  setRejected(false);
                  setError("");
                  setEpoch((v) => v + 1);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Discard rejected shipping change
            </button>
          )}
        </div>
      )}
      {!value && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError("");
            setEpoch((v) => v + 1);
          }}
        >
          Retry shipping terms
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (locked) return;
          try {
            const payload: Payload = {
              cartId,
              cartRevision: value!.cartRevision,
              treatment,
              net: treatment === "extra" ? cents(net) : 0,
              tax: treatment === "extra" ? cents(tax) : 0,
              reason: reason.trim(),
            };
            if (!payload.reason)
              throw Error(
                "Record the reviewed shipping terms and tax evidence.",
              );
            void send({ key: crypto.randomUUID(), payload });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label htmlFor={`${prefix}-treatment`}>Shipping treatment</label>
        <select
          id={`${prefix}-treatment`}
          disabled={locked}
          value={treatment}
          onChange={(e) =>
            setTreatment(e.target.value as ShippingTerms["treatment"])
          }
        >
          <option value="unspecified">Unspecified</option>
          <option value="included">Included in product prices</option>
          <option value="extra">Extra charge</option>
        </select>
        {treatment === "extra" && (
          <>
            <label htmlFor={`${prefix}-net`}>
              Shipping net amount ({currency})
            </label>
            <input
              id={`${prefix}-net`}
              inputMode="decimal"
              required
              disabled={locked}
              value={net}
              onChange={(e) => setNet(e.target.value)}
            />
            <label htmlFor={`${prefix}-tax`}>
              Explicit shipping tax ({currency})
            </label>
            <input
              id={`${prefix}-tax`}
              inputMode="decimal"
              required
              disabled={locked}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </>
        )}
        <label htmlFor={`${prefix}-reason`}>
          Shipping terms and tax review evidence
        </label>
        <textarea
          id={`${prefix}-reason`}
          maxLength={1000}
          required
          disabled={locked}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button disabled={locked}>Save reviewed shipping terms</button>
      </form>
    </section>
  );
}
