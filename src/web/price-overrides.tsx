import { useEffect, useState } from "react";
import type { CartPriceOverrides } from "../shared/price-overrides.ts";
import { usePricingChange } from "./customer-pricing.tsx";
import { reviewedCents } from "./price-authority.tsx";
const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(n / 100);
export function PriceOverridesEditor({
  cartId,
  recoveryScope,
  onSaved,
}: {
  cartId: string;
  recoveryScope: string;
  onSaved?: () => void | Promise<void>;
}) {
  const change = usePricingChange(
    `/api/carts/${encodeURIComponent(cartId)}/price-overrides`,
    "cart.price-override.set",
    { cartId },
    recoveryScope,
    "Price override",
    ["cart.price-override.decide", "cart.price-override.clear"],
  );
  const value = change.value as CartPriceOverrides | null;
  const [productId, setProduct] = useState(""),
    [price, setPrice] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const line = value?.lines.find((l) => l.productId === productId);
  useEffect(() => {
    if (value && !value.lines.some((l) => l.productId === productId))
      setProduct(value.lines[0]?.productId || "");
  }, [value, productId]);
  useEffect(() => {
    setPrice(
      line
        ? (
            (line.override && line.override.status !== "cleared"
              ? line.override.unitPrice
              : line.ordinaryUnitPrice) / 100
          ).toFixed(2)
        : "",
    );
    setReason("");
  }, [line]);
  async function submit(action: "set" | "clear" | "approve" | "reject") {
    setError("");
    try {
      if (!line || !value) throw Error("Select a saved cart line.");
      if (!reason.trim())
        throw Error("Enter the reason for this pricing action.");
      const payload = {
        cartId,
        cartRevision: value.cartRevision,
        productId,
        revision: line.override?.revision ?? 0,
        reason,
        ...(action === "set" ? { unitPrice: reviewedCents(price) } : {}),
        ...(action === "approve" || action === "reject"
          ? { decision: action }
          : {}),
      };
      const saved = await change.save(
        payload,
        `cart.price-override.${action === "set" ? "set" : action === "clear" ? "clear" : "decide"}`,
      );
      if (saved) await onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section aria-label="Saved cart selling prices">
      <h3>One-off selling prices</h3>
      <p>
        Review an offered net price for a saved cart line. A reason is required
        for every change. Offers outside reviewed limits, missing reviewed cost
        or unconfigured limits require a different authorized administrator's
        approval. Product or quantity changes require another review.
      </p>
      {change.recoveryUi}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit("set");
        }}
      >
        <fieldset disabled={change.locked || !value}>
          <label>
            Saved cart product
            <select
              value={productId}
              onChange={(e) => setProduct(e.target.value)}
            >
              {value?.lines.map((l) => (
                <option key={l.productId} value={l.productId}>
                  {l.description} · quantity {l.quantity}
                </option>
              ))}
            </select>
          </label>
          {line && (
            <>
              <p>
                Ordinary account unit price:{" "}
                {money(line.ordinaryUnitPrice, value!.currency)}
              </p>
              {line.override && (
                <div>
                  <p>
                    Offered price:{" "}
                    {money(line.override.unitPrice, value!.currency)} ·{" "}
                    {line.override.status}
                    {line.override.stale ? " · stale review" : ""}
                    {line.override.consumed ? " · already used" : ""}
                  </p>
                  <p>Latest review reason: {line.override.reason}</p>
                  {line.override.approvalReasons.length > 0 && (
                    <p>
                      Approval required:{" "}
                      {line.override.approvalReasons.join(" · ")}
                    </p>
                  )}
                </div>
              )}
              <label>
                Offered net unit price ({value!.currency})
                <input
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label>
                Reason for selling price action
                <textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button>Review offered selling price</button>
              {line.override && line.override.status !== "cleared" && (
                <button type="button" onClick={() => void submit("clear")}>
                  Clear offer and use account price
                </button>
              )}
              {line.override?.canApprove && (
                <>
                  <button type="button" onClick={() => void submit("approve")}>
                    Approve price exception
                  </button>
                  <button type="button" onClick={() => void submit("reject")}>
                    Reject price exception
                  </button>
                </>
              )}
            </>
          )}
        </fieldset>
      </form>
      <details>
        <summary>Saved cart price history</summary>
        {value?.history.map((h, i) => (
          <article key={`${h.productId}:${h.revision}:${i}`}>
            <p>
              {h.createdAt} · {h.productId} · {h.status} ·{" "}
              {h.unitPrice === null
                ? "account price"
                : money(h.unitPrice, value.currency)}
            </p>
            <p>
              Reason: {h.reason} · proposer {h.proposerId} · actor {h.actorId}
            </p>
          </article>
        ))}
      </details>
    </section>
  );
}
