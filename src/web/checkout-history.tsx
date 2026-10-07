import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";
import type {
  CheckoutHistoryPage,
  CheckoutObservation,
} from "../shared/checkout.ts";

export function CheckoutHistory({
  id,
  effectId,
  close,
}: {
  id: string;
  effectId: string;
  close: () => void;
}) {
  const [items, setItems] = useState<CheckoutObservation[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const retryAfter = useRef<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = async (after?: string) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    retryAfter.current = after;
    setBusy(true);
    setError("");
    try {
      const page = await request<CheckoutHistoryPage>(
        `/api/effects/${encodeURIComponent(effectId)}/checkout/history${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || pending.current !== controller) return;
      setItems((prior) => (after ? [...prior, ...page.items] : page.items));
      setNext(page.next);
      setLoaded(true);
    } catch (e) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(
          e instanceof Error
            ? e.message
            : "Checkout history could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    heading.current?.focus();
    void load();
    return () => {
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, [effectId]);
  return (
    <section
      id={id}
      aria-label="Checkout history"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="info-heading">
        <h4 ref={heading} tabIndex={-1}>
          Checkout history
        </h4>
        <InfoBubble label="Checkout history">
          Invoice-wide observations across all checkout generations, newest
          first. These are retained observations, not the current invoice
          balance. Older observations were not backfilled.
        </InfoBubble>
      </div>
      <button onClick={close}>Close checkout history</button>
      <button disabled={busy} onClick={() => void load()}>
        Reload checkout history
      </button>
      <p role="status">
        {items.length} observations loaded{busy ? " · Loading…" : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      {error && (
        <button disabled={busy} onClick={() => void load(retryAfter.current)}>
          Retry checkout history
        </button>
      )}
      {loaded && !items.length && (
        <p>
          No retained checkout observations. Older observations were not
          backfilled.
        </p>
      )}
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <dl>
              <dt>Frozen amount</dt>
              <dd>
                {new Intl.NumberFormat("en", {
                  style: "currency",
                  currency: item.currency,
                }).format(item.amount / 100)}{" "}
                · {item.currency}
              </dd>
              <dt>Observed at</dt>
              <dd>
                <time dateTime={item.observedAt}>{item.observedAt}</time>
              </dd>
              <dt>Source</dt>
              <dd>{item.source}</dd>
              <dt>Outcome</dt>
              <dd>
                {item.outcome === "not_found"
                  ? "Not found"
                  : item.outcome === "verified"
                    ? "Verified"
                    : "Unverified"}
              </dd>
              <dt>Session reference</dt>
              <dd>{item.reference ?? "Unavailable"}</dd>
              <dt>Session status</dt>
              <dd>{item.status ?? "Unavailable"}</dd>
              <dt>Payment status</dt>
              <dd>{item.paymentStatus ?? "Unavailable"}</dd>
              <dt>Expiry</dt>
              <dd>
                {item.expiresAt === null
                  ? "Unavailable"
                  : new Date(item.expiresAt * 1000).toLocaleString()}
              </dd>
              <dt>Checkout generation effect ID</dt>
              <dd>{item.effectId}</dd>
            </dl>
          </li>
        ))}
      </ol>
      {next && !error && (
        <button disabled={busy} onClick={() => void load(next)}>
          Load older checkout observations
        </button>
      )}
    </section>
  );
}
