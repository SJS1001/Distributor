import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { checkoutUrl } from "../shared/checkout.ts";
type Checkout = {
  state: string;
  message: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  expiresAt?: number;
};
export function CheckoutAction({
  effectId,
  checkout,
}: {
  effectId: string;
  checkout: Checkout;
}) {
  const active = useRef<AbortController | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setError("");
    setBusy(false);
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [effectId, checkout.state]);
  const open = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ state: string; url: string }>(
        `/api/effects/${encodeURIComponent(effectId)}/checkout`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || active.current !== controller) return;
      const url = checkoutUrl(result.url);
      if (result.state !== "ready" || !url)
        throw new Error(
          "Checkout address could not be verified. Contact finance.",
        );
      window.location.assign(url);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div>
      <span>
        {checkout.invoiceNumber} ·{" "}
        {new Intl.NumberFormat("en", {
          style: "currency",
          currency: checkout.currency,
        }).format(checkout.amount / 100)}
      </span>
      <small>{checkout.message}</small>
      {checkout.expiresAt && (
        <small>
          Expires {new Date(checkout.expiresAt * 1000).toLocaleString()}
        </small>
      )}
      {checkout.state === "ready" && (
        <button disabled={busy} onClick={() => void open()}>
          Open secure checkout
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
