import { useEffect, useState } from "react";
import { command, request } from "./api.ts";
import type { ProductAvailability } from "../shared/product-availability.ts";
import "./product-availability.css";

export function ProductAvailabilityEditor({
  productId,
  compact = false,
  initial,
}: {
  productId: string;
  compact?: boolean;
  initial?: ProductAvailability;
}) {
  const [value, setValue] = useState<ProductAvailability | null>(
    initial ?? null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (initial && epoch === 0) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void request<ProductAvailability>(
      `/api/catalog/products/${encodeURIComponent(productId)}/availability`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setValue(result);
          setDirty(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [productId, epoch, initial]);
  return (
    <section
      className={`availability-editor${compact ? " availability-compact" : ""}`}
      aria-label={`Customer availability for ${productId}`}
    >
      {!compact && <h3>Customer visibility &amp; availability</h3>}
      <p>Applies to all customers.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {value ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await command("catalog.product-availability.set", {
                productId,
                hidden: value.hidden,
                outOfStock: value.outOfStock,
                expectedAvailableOn: value.expectedAvailableOn || null,
                revision: value.revision,
                reason,
              });
              setReason("");
              setNotice("Availability saved for all customers.");
              setEpoch((previous) => previous + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend className="availability-legend">
              Customer availability
            </legend>
            <label className="availability-checkbox">
              <input
                type="checkbox"
                checked={value.hidden}
                onChange={(e) => {
                  setDirty(true);
                  setNotice("");
                  setValue({ ...value, hidden: e.target.checked });
                }}
              />
              Temporarily hide from all customers
            </label>
            <label className="availability-checkbox">
              <input
                type="checkbox"
                checked={value.outOfStock}
                onChange={(e) => {
                  setDirty(true);
                  setNotice("");
                  setValue({ ...value, outOfStock: e.target.checked });
                }}
              />
              Show out-of-stock badge
            </label>
            <label className="availability-date">
              {compact
                ? "Expected date"
                : "Expected availability date (optional)"}
              <input
                type="date"
                aria-label="Expected availability date (optional)"
                value={value.expectedAvailableOn ?? ""}
                onChange={(e) => {
                  setDirty(true);
                  setNotice("");
                  setValue({
                    ...value,
                    expectedAvailableOn: e.target.value || null,
                  });
                }}
              />
            </label>
            {!compact && (
              <p>
                Hidden products are removed from customer browsing and new
                purchases. Existing orders and history remain available. The
                badge and date are informational; they do not change inventory.
              </p>
            )}
            {(!compact || dirty || error) && (
              <>
                <label>
                  Reason for availability change
                  {compact ? (
                    <input
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  ) : (
                    <textarea
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                </label>
                <div className="actions">
                  <button type="submit">Save availability</button>
                  <button
                    type="button"
                    className={compact ? undefined : "secondary"}
                    onClick={() => setEpoch((previous) => previous + 1)}
                  >
                    Reload
                  </button>
                </div>
              </>
            )}
          </fieldset>
        </form>
      ) : (
        !error && <p role="status">Loading availability…</p>
      )}
      {!value && error && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEpoch((previous) => previous + 1)}
        >
          Retry availability
        </button>
      )}
    </section>
  );
}

export function AvailabilityBadge({
  product,
}: {
  product: { outOfStock?: boolean; expectedAvailableOn?: string | null };
}) {
  if (!product.outOfStock && !product.expectedAvailableOn) return null;
  const date = product.expectedAvailableOn
    ? new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${product.expectedAvailableOn}T00:00:00Z`))
    : null;
  return (
    <div className="product-availability-message">
      {product.outOfStock && (
        <span className="product-out-of-stock">Out of stock</span>
      )}
      {date && (
        <span>
          Expected availability:{" "}
          <time dateTime={product.expectedAvailableOn!}>{date}</time>
        </span>
      )}
    </div>
  );
}
