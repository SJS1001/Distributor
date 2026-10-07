import React, { useEffect, useState } from "react";
import { request, RequestError } from "./api.ts";
import type {
  PricingHistoryEntry,
  PricingPolicy,
  ProductMsrp,
} from "../shared/customer-pricing.ts";
import "./record-forms.css";
import "./customer-pricing.css";

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    cents / 100,
  );
type Attempt = {
  key: string;
  command?: string;
  payload: Record<string, unknown>;
};
// Retain the complete reviewed revision and payload before sending, including
// across reload/sign-in. An uncertain reply must not become an edited retry.
export function usePricingChange(
  path: string,
  command: string,
  identity: Record<string, string>,
  recoveryScope: string,
  description = "Pricing",
  allowedCommands: string[] = [],
) {
  const storageKey = `distributor-pricing:${recoveryScope}:${command}:${Object.values(identity).join(":")}`;
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { attempt: null as Attempt | null, error: "" };
      const a = JSON.parse(raw) as Attempt;
      if (
        raw.length > 20000 ||
        !/^[a-f0-9-]{36}$/.test(a.key) ||
        !a.payload ||
        (a.command !== undefined &&
          ![command, ...allowedCommands].includes(a.command)) ||
        !Number.isInteger(a.payload.revision ?? a.payload.cartRevision) ||
        typeof a.payload.reason !== "string" ||
        !a.payload.reason.trim() ||
        Object.entries(identity).some(([k, v]) => a.payload[k] !== v)
      )
        throw Error();
      return { attempt: a, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved change cannot be read. Restore browser storage and reload before changing this record.",
      };
    }
  });
  const [attempt, setAttempt] = useState(recovery.attempt),
    [blocked, setBlocked] = useState(recovery.error);
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0),
    [rejected, setRejected] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setBusy(true);
    setError("");
    void request(path, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setValue(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [path, epoch]);
  async function send(next: Attempt) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setAttempt(next);
      await request(`/api/commands/${next.command ?? command}`, {
        method: "POST",
        headers: { "idempotency-key": next.key },
        body: JSON.stringify(next.payload),
      });
      localStorage.removeItem(storageKey);
      setAttempt(null);
      setRejected(false);
      setNotice(`${description} saved.`);
      setEpoch((e) => e + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof RequestError &&
        e.status < 500 &&
        ![401, 403, 408, 429].includes(e.status)
      )
        setRejected(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const recoveryUi = (
    <>
      {blocked && <p role="alert">{blocked}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {attempt && (
        <div className="pricing-recovery">
          <p role="status">
            A reviewed change is awaiting confirmation. Retry sends exactly the
            saved values and revision.
          </p>
          <p>
            {typeof attempt.payload.multiplierBp !== "undefined"
              ? `Multiplier: ${attempt.payload.multiplierBp === null ? "existing tier prices" : Number(attempt.payload.multiplierBp) / 10000}. Display: ${attempt.payload.displayMode === "detailed" ? "MSRP, discount, savings and net" : "net price only"}.`
              : command === "catalog.reference.set"
                ? `Reference: ${attempt.payload.familyId ?? "unmapped"} · model ${attempt.payload.modelId ?? "none"}.`
                : command === "catalog.product-addons.set"
                  ? `Add-ons: ${Array.isArray(attempt.payload.addonIds) ? attempt.payload.addonIds.length : 0} products in the reviewed order.`
                  : command === "catalog.unit-cost.set"
                    ? `Reviewed unit cost: ${attempt.payload.unitCostCents === null ? "not set" : Number(attempt.payload.unitCostCents) / 100}.`
                    : command === "catalog.price-approval-policy.set"
                      ? `Maximum discount: ${attempt.payload.maxDiscountBp === null ? "unconfigured" : Number(attempt.payload.maxDiscountBp) / 100}%. Minimum margin: ${attempt.payload.minMarginBp === null ? "unconfigured" : Number(attempt.payload.minMarginBp) / 100}%.`
                      : command === "cart.price-override.set"
                        ? `Product: ${attempt.payload.productId}. Action: ${attempt.command ?? command}. Offered net unit price: ${attempt.payload.unitPrice === undefined ? "unchanged" : `${Number(attempt.payload.unitPrice) / 100} ${value?.currency ?? "currency units"}`}. Decision: ${attempt.payload.decision ?? "none"}.`
                        : `MSRP: ${attempt.payload.msrpCents === null ? "not set" : Number(attempt.payload.msrpCents) / 100}.`}{" "}
            Reason: {String(attempt.payload.reason)}
          </p>
          <button
            type="button"
            disabled={busy || !!blocked}
            onClick={() => void send(attempt)}
          >
            {description === "Pricing"
              ? "Retry saved pricing change"
              : `Retry saved ${description.toLowerCase()}`}
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
                  setValue(null);
                  setEpoch((e) => e + 1);
                } catch {
                  setBlocked(
                    "Browser storage is unavailable. Restore it and reload.",
                  );
                }
              }}
            >
              Discard rejected change and reload
            </button>
          )}
        </div>
      )}
    </>
  );
  return {
    value,
    busy,
    locked: busy || !!attempt || !!blocked,
    recoveryUi,
    reload: () => setEpoch((e) => e + 1),
    save: (payload: Record<string, unknown>, selectedCommand = command) =>
      send({ key: crypto.randomUUID(), command: selectedCommand, payload }),
  };
}

export function CustomerPrice({
  product,
  compact = false,
}: {
  product: {
    unit_price: number;
    currency: string;
    pricing?: { msrpCents: number; discountBp: number; savingsCents: number };
  };
  compact?: boolean;
}) {
  return (
    <div
      className={`customer-price${compact ? " customer-price-compact" : ""}`}
    >
      {product.pricing && (
        <>
          <span className="customer-msrp">
            MSRP {money(product.pricing.msrpCents, product.currency)}
          </span>
          <span className="customer-savings">
            {product.pricing.discountBp / 100}% off · Save{" "}
            {money(product.pricing.savingsCents, product.currency)}
          </span>
        </>
      )}
      <strong>{money(product.unit_price, product.currency)}</strong>
      <span className="customer-price-unit">Net price / unit</span>
    </div>
  );
}
function CustomerEditor({
  accountId,
  currency,
  recoveryScope,
}: {
  accountId: string;
  currency: string;
  recoveryScope: string;
}) {
  const change = usePricingChange(
    `/api/catalog/pricing/${encodeURIComponent(accountId)}`,
    "catalog.pricing.set",
    { accountId },
    recoveryScope,
  );
  const [mode, setMode] = useState("tier"),
    [multiplier, setMultiplier] = useState("0.75"),
    [display, setDisplay] = useState<PricingPolicy["displayMode"]>("net_only"),
    [reason, setReason] = useState(""),
    [sample, setSample] = useState("100");
  useEffect(() => {
    const v = change.value as PricingPolicy | null;
    if (v) {
      setMode(v.multiplierBp === null ? "tier" : "multiplier");
      setMultiplier(String((v.multiplierBp ?? 7500) / 10000));
      setDisplay(v.displayMode);
      setReason("");
    }
  }, [change.value]);
  const bp = Math.round(Number(multiplier) * 10000),
    valid =
      multiplier.trim() !== "" &&
      Number.isFinite(Number(multiplier)) &&
      bp >= 0 &&
      bp <= 10000 &&
      Math.abs(Number(multiplier) * 10000 - bp) < 0.000001;
  const cents = Math.round(Number(sample) * 100),
    net = Math.floor((cents * bp + 5000) / 10000);
  return (
    <div className="pricing-editor">
      {change.recoveryUi}
      {change.value ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "multiplier" && !valid) return;
            void change.save({
              accountId,
              multiplierBp: mode === "tier" ? null : bp,
              displayMode: display,
              revision: change.value.revision,
              reason,
            });
          }}
        >
          <fieldset disabled={change.locked} className="record-form-card">
            <legend>Customer price agreement</legend>
            <div className="record-form-grid">
              <label>
                Price calculation
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="tier">Existing tier and base prices</option>
                  <option value="multiplier">
                    Multiply each product’s MSRP
                  </option>
                </select>
              </label>
              <label>
                Prices shown to this customer
                <select
                  value={display}
                  onChange={(e) =>
                    setDisplay(e.target.value as PricingPolicy["displayMode"])
                  }
                >
                  <option value="net_only">Net price only</option>
                  <option value="detailed">
                    MSRP, discount %, savings and net price
                  </option>
                </select>
              </label>
            </div>
            {mode === "multiplier" && (
              <div className="record-form-grid">
                <label>
                  MSRP multiplier
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.0001"
                    required
                    value={multiplier}
                    onChange={(e) => setMultiplier(e.target.value)}
                    aria-describedby={`multiplier-help-${accountId}`}
                  />
                </label>
                <p
                  id={`multiplier-help-${accountId}`}
                  className="record-form-note"
                >
                  {valid
                    ? `${bp / 100}% of MSRP · ${(10000 - bp) / 100}% discount`
                    : "Enter a multiplier between 0 and 1, with up to four decimal places."}{" "}
                  For example, 0.75 gives 25% off MSRP.
                </p>
                <p className="record-form-note record-form-wide">
                  Every eligible product needs an explicit MSRP. Products
                  missing MSRP cannot be quoted under this agreement.
                </p>
              </div>
            )}
            {mode === "multiplier" && (
              <div className="pricing-preview">
                <label>
                  Example MSRP ({currency})
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                  />
                </label>
                <p>Illustrative customer preview · before tax</p>
                {valid &&
                  sample.trim() !== "" &&
                  Number.isFinite(cents) &&
                  cents >= 0 && (
                    <CustomerPrice
                      product={{
                        unit_price: net,
                        currency,
                        ...(display === "detailed"
                          ? {
                              pricing: {
                                msrpCents: cents,
                                discountBp: 10000 - bp,
                                savingsCents: cents - net,
                              },
                            }
                          : {}),
                      }}
                    />
                  )}
                <small>
                  Actual product prices and tax are calculated by the server at
                  quote and acceptance.
                </small>
              </div>
            )}
            {mode === "tier" && (
              <p className="record-form-note">
                Current tier prices remain in effect. Detailed display includes
                MSRP and savings only for products with an MSRP and a net price
                at or below it.
              </p>
            )}
            <label>
              Reason for pricing change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="record-form-footer">
              <button type="submit" disabled={mode === "multiplier" && !valid}>
                Save customer pricing
              </button>
              <button
                type="button"
                className="secondary"
                disabled={change.locked}
                onClick={change.reload}
              >
                Reload current pricing
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p role="status">
            {change.busy ? "Loading current pricing…" : "Pricing unavailable."}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={change.locked}
            onClick={change.reload}
          >
            Reload current pricing
          </button>
        </>
      )}
      <PricingHistory accountId={accountId} currency={currency} />
    </div>
  );
}
export function CustomerPricingControls({
  accounts,
  selectedOnly = false,
  recoveryScope,
}: {
  selectedOnly?: boolean;
  accounts: { id: string; name: string; currency: string }[];
  recoveryScope: string;
}) {
  const [id, setId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === id);
  return (
    <section className="panel customer-pricing-panel">
      <h3>Customer pricing</h3>
      <p className="customer-panel-intro">
        {selectedOnly
          ? "Agree this customer’s MSRP multiplier and decide how their prices appear."
          : "Choose the customer, agree their MSRP multiplier and decide how their prices appear."}
      </p>
      {!selectedOnly && (
        <label>
          Customer for pricing
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {account ? (
        <CustomerEditor
          key={`${recoveryScope}:${id}`}
          accountId={id}
          currency={account.currency}
          recoveryScope={recoveryScope}
        />
      ) : (
        <p>Create a customer before assigning a price agreement.</p>
      )}
    </section>
  );
}
export function ProductMsrpEditor({
  productId,
  currency,
  recoveryScope,
}: {
  productId: string;
  currency: string;
  recoveryScope: string;
}) {
  const change = usePricingChange(
    `/api/catalog/products/${encodeURIComponent(productId)}/msrp`,
    "catalog.product-msrp.set",
    { productId },
    recoveryScope,
  );
  const [amount, setAmount] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    const v = change.value as ProductMsrp | null;
    if (v) {
      setAmount(v.msrpCents === null ? "" : (v.msrpCents / 100).toFixed(2));
      setReason("");
    }
  }, [change.value]);
  return (
    <section className="pricing-editor">
      <h3>Manufacturer suggested retail price</h3>
      <p>
        MSRP is the explicit starting price for customer multipliers. Enter the
        manufacturer’s suggested price in {currency} dollars.
      </p>
      {change.recoveryUi}
      {change.value && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change.save({
              productId,
              msrpCents:
                amount.trim() === "" ? null : Math.round(Number(amount) * 100),
              revision: change.value.revision,
              reason,
            });
          }}
        >
          <fieldset disabled={change.locked} className="record-form-card">
            <legend>Product MSRP</legend>
            <label>
              MSRP ({currency}, dollars)
              <input
                type="number"
                min="0"
                max="10000000"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <small className="record-form-note">
              Blank means no MSRP. Customers with an MSRP multiplier cannot
              quote this product until MSRP is set.
            </small>
            <label>
              Reason for MSRP change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="record-form-footer">
              <button>Save product MSRP</button>
              <button
                type="button"
                className="secondary"
                disabled={change.locked}
                onClick={change.reload}
              >
                Reload product MSRP
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!change.value && (
        <button
          type="button"
          className="secondary"
          disabled={change.locked}
          onClick={change.reload}
        >
          Reload product MSRP
        </button>
      )}
      <PricingHistory productId={productId} currency={currency} />
    </section>
  );
}

function historyValue(value: unknown, currency: string) {
  if (!value || typeof value !== "object") return "Not previously set";
  const v = value as Record<string, unknown>;
  if ("multiplierBp" in v)
    return `${v.multiplierBp === null ? "Existing tier/base prices" : `MSRP × ${Number(v.multiplierBp) / 10000} (${(10000 - Number(v.multiplierBp)) / 100}% off)`}; ${v.displayMode === "detailed" ? "MSRP, discount, savings and net" : "net price only"}`;
  if ("msrpCents" in v)
    return v.msrpCents === null
      ? "MSRP not set"
      : `MSRP ${money(Number(v.msrpCents), currency)}`;
  return `${v.tier} tier: ${v.unitPrice === null ? "no tier price" : money(Number(v.unitPrice), currency)}`;
}
function PricingHistory({
  accountId,
  productId,
  currency,
}: {
  accountId?: string;
  productId?: string;
  currency: string;
}) {
  const [page, setPage] = useState<{
      items: PricingHistoryEntry[];
      next: string | null;
    } | null>(null),
    [after, setAfter] = useState<string | null>(null),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setBusy(true);
    setError("");
    const params = new URLSearchParams(
      accountId ? { accountId } : { productId: productId! },
    );
    if (after) params.set("after", after);
    void request<{ items: PricingHistoryEntry[]; next: string | null }>(
      `/api/catalog/pricing-history?${params}`,
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) setPage(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [accountId, productId, after, epoch]);
  return (
    <details className="pricing-history">
      <summary>Pricing change history</summary>
      <p>
        Recorded price agreement, MSRP and tier-price changes. Accepted order
        prices and financial adjustments remain in Orders and Billing.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading pricing history…</p>}
      {page?.items.map((h) => (
        <article key={h.id} className="pricing-history-entry">
          <h4>
            {h.kind === "policy"
              ? "Customer price agreement"
              : h.kind === "msrp"
                ? "Product MSRP"
                : "Tier price"}{" "}
            · {new Date(h.createdAt).toLocaleString()}
          </h4>
          <p>Before: {historyValue(h.before, currency)}</p>
          <p>After: {historyValue(h.after, currency)}</p>
          <p>Reason: {h.reason}</p>
          <small>Recorded by {h.actorId}</small>
        </article>
      ))}
      {!busy && page && !page.items.length && (
        <p>No pricing changes recorded.</p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAfter(null);
            setEpoch((e) => e + 1);
          }}
        >
          Refresh latest pricing history
        </button>
        {page?.next && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAfter(page.next)}
          >
            Older pricing changes
          </button>
        )}
        {error && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEpoch((e) => e + 1)}
          >
            Retry pricing history
          </button>
        )}
      </div>
    </details>
  );
}
