import React, { useState } from "react";
import { request } from "./api.ts";
import type { BalanceObservation } from "../server/integration-accounting-balances.ts";
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(n / 100);
export function AccountingBalanceReview({
  effectId,
  latest,
  refresh,
}: {
  effectId: string;
  latest: BalanceObservation | null;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<BalanceObservation[] | null>(null),
    [next, setNext] = useState<number | null>(null);
  const readHistory = async (after?: number) => {
    const page = await request<{
      items: BalanceObservation[];
      next: number | null;
    }>(
      `/api/effects/${encodeURIComponent(effectId)}/balance-history?limit=20${after ? `&after=${after}` : ""}`,
    );
    setHistory((old) => (after ? [...(old ?? []), ...page.items] : page.items));
    setNext(page.next);
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Balance read failed. Retry verification.",
      );
    } finally {
      setBusy(false);
    }
  };
  const summary = (o: BalanceObservation) => (
    <span>
      {o.difference === 0 ? "Balances agree" : "Balance difference"}: QuickBooks{" "}
      {money(o.providerBalance, o.currency)}, Distributor{" "}
      {money(o.nativeBalance, o.currency)}; difference{" "}
      {money(o.difference, o.currency)}. Checked {o.observedAt}. Distributor
      credited {money(o.credited, o.currency)}, paid {money(o.paid, o.currency)}
      , refunded {money(o.refunded, o.currency)}.
    </span>
  );
  return (
    <section aria-label="QuickBooks balance review">
      <p>
        {latest
          ? summary(latest)
          : "No QuickBooks balance comparison recorded."}
      </p>
      <p>
        Compare this invoice with QuickBooks. Each check records a point in
        time; matching balances alone do not verify the ledger. Differences
        require finance review.
      </p>
      <div className="actions">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const storageKey = `distributor-accounting-balance:${effectId}`,
                key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
              sessionStorage.setItem(storageKey, key);
              await request(
                `/api/effects/${encodeURIComponent(effectId)}/balance`,
                { method: "POST", headers: { "idempotency-key": key } },
              );
              sessionStorage.removeItem(storageKey);
              await refresh();
              if (history !== null) await readHistory();
            })
          }
        >
          Check QuickBooks balance
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => readHistory())}
        >
          View balance history
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {history !== null && (
        <div aria-label="Balance history">
          {history.length === 0 ? (
            <p>No completed checks.</p>
          ) : (
            <ol>
              {history.map((o) => (
                <li key={o.id}>{summary(o)}</li>
              ))}
            </ol>
          )}
          {next !== null && (
            <button
              disabled={busy}
              onClick={() => void run(() => readHistory(next))}
            >
              Load more balance checks
            </button>
          )}
        </div>
      )}
    </section>
  );
}
