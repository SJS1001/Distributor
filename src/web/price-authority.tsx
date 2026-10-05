import type {
  PriceAuthorityHistoryEntry,
  PriceAuthorityHistoryPage,
} from "../shared/price-authority.ts";
import { useEffect, useState } from "react";
import { request } from "./api.ts";
import { usePricingChange } from "./customer-pricing.tsx";
const amount = (v: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw Error("Enter a nonnegative amount with up to two decimal places.");
  const result = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(result) || result > 1e12)
    throw Error("Amount is too large.");
  return result;
};
export { amount as reviewedCents };
function describeReview(value: unknown) {
  if (!value || typeof value !== "object") return "not configured";
  const v = value as Record<string, unknown>;
  if ("unitCostCents" in v)
    return v.unitCostCents === null
      ? "cost not configured"
      : `${Number(v.unitCostCents) / 100} ${v.currency ?? "currency units"} per unit`;
  return `maximum discount ${v.maxDiscountBp === null ? "unconfigured" : `${Number(v.maxDiscountBp) / 100}%`}; minimum margin ${v.minMarginBp === null ? "unconfigured" : `${Number(v.minMarginBp) / 100}%`}`;
}
export function PriceAuthorityHistory({ productId }: { productId?: string }) {
  const [items, setItems] = useState<PriceAuthorityHistoryEntry[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [opened, setOpened] = useState(false);
  async function load(after?: string) {
    setBusy(true);
    setError("");
    const q = new URLSearchParams();
    if (productId) q.set("productId", productId);
    if (after) q.set("after", after);
    try {
      const result = await request<PriceAuthorityHistoryPage>(
        `/api/catalog/price-authority-history?${q}`,
      );
      setItems((before) =>
        after ? [...before, ...result.items] : result.items,
      );
      setNext(result.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !opened) {
          setOpened(true);
          void load();
        }
      }}
    >
      <summary>Reviewed price authority history</summary>
      <button disabled={busy} onClick={() => void load()}>
        Refresh price authority history
      </button>
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <article key={item.id}>
          <p>
            {item.createdAt} · {item.kind} · actor {item.actorId}
          </p>
          <p>Reason: {item.reason}</p>
          <p>
            Before: {describeReview(item.before)} · After:{" "}
            {describeReview(item.after)}
          </p>
        </article>
      ))}
      {opened && !busy && !items.length && !error && (
        <p>No reviewed changes recorded.</p>
      )}
      {next && (
        <button disabled={busy} onClick={() => void load(next)}>
          Load older price authority changes
        </button>
      )}
    </details>
  );
}
export function UnitCostEditor({
  productId,
  recoveryScope,
}: {
  productId: string;
  recoveryScope: string;
}) {
  const change = usePricingChange(
    `/api/catalog/products/${encodeURIComponent(productId)}/unit-cost`,
    "catalog.unit-cost.set",
    { productId },
    recoveryScope,
    "Unit cost change",
  );
  const [cost, setCost] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (change.value) {
      setCost(
        change.value.unitCostCents === null
          ? ""
          : (change.value.unitCostCents / 100).toFixed(2),
      );
      setReason("");
    }
  }, [change.value]);
  return (
    <section>
      <h3>Reviewed wholesale unit cost</h3>
      <p>
        Staff pricing baseline for margin review. Historical receipt costs
        remain in inventory accounting. This value is never shown to buyers.
      </p>
      {change.recoveryUi}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            void change.save({
              productId,
              unitCostCents: cost === "" ? null : amount(cost),
              revision: change.value.revision,
              reason,
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={change.locked || !change.value}>
          <label>
            Reviewed unit cost ({change.value?.currency || "account currency"})
            <input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            <small>Leave empty when no reviewed cost is available.</small>
          </label>
          <label>
            Reason for unit cost change
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button>Save reviewed unit cost</button>
        </fieldset>
      </form>
      <PriceAuthorityHistory productId={productId} />
    </section>
  );
}
export function PriceApprovalPolicyEditor({
  recoveryScope,
}: {
  recoveryScope: string;
}) {
  const change = usePricingChange(
    "/api/catalog/price-approval-policy",
    "catalog.price-approval-policy.set",
    {},
    recoveryScope,
    "Price approval rules",
  );
  const [enabled, setEnabled] = useState(false),
    [discount, setDiscount] = useState(""),
    [margin, setMargin] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (change.value) {
      setEnabled(change.value.maxDiscountBp !== null);
      setDiscount(
        change.value.maxDiscountBp === null
          ? ""
          : String(change.value.maxDiscountBp / 100),
      );
      setMargin(
        change.value.minMarginBp === null
          ? ""
          : String(change.value.minMarginBp / 100),
      );
      setReason("");
    }
  }, [change.value]);
  return (
    <details>
      <summary>Price override approval rules</summary>
      <p>
        A discount is measured against the customer's ordinary negotiated price.
        Margin is (offered net price − reviewed wholesale cost) ÷ offered net
        price, excluding tax and shipping. Missing cost or unconfigured limits
        always require a separate approver.
      </p>
      {change.recoveryUi}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            const d = enabled ? amount(discount) : null,
              m = enabled ? amount(margin) : null;
            if ((d !== null && d > 10000) || (m !== null && m > 10000))
              throw Error("Enter percentages from 0 to 100.");
            void change.save({
              maxDiscountBp: d,
              minMarginBp: m,
              revision: change.value.revision,
              reason,
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={change.locked || !change.value}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Allow staff offers within reviewed limits
          </label>
          {enabled && (
            <>
              <label>
                Maximum discount (%)
                <input
                  required
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </label>
              <label>
                Minimum margin (%)
                <input
                  required
                  inputMode="decimal"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Reason for price approval rules
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button>Save price approval rules</button>
        </fieldset>
      </form>
      <PriceAuthorityHistory />
    </details>
  );
}
