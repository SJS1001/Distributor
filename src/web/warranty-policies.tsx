import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { useWarrantyAttempt } from "./warranty-registration.tsx";
import type {
  ProductWarrantyTerms,
  ReturnWindowPolicy,
  SaveProductWarrantyTerms,
} from "../shared/warranty-registration.ts";
import "./warranty-registration.css";

type ReturnDraft = {
  expectedRevision: number;
  days: number | null;
  reason: string;
};
function PolicyEditor({
  orgId,
  productId,
  refreshToken,
}: {
  orgId: string;
  productId?: string;
  refreshToken?: unknown;
}) {
  const name = productId
    ? "warranty.terms.save"
    : "warranty.return-policy.save";
  const mutation = useWarrantyAttempt(
    orgId,
    productId ? `terms:${productId}` : "return-policy",
  );
  const [draft, setDraft] = useState<
    ReturnDraft | SaveProductWarrantyTerms | null
  >(null);
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refreshSeen = useRef(refreshToken);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [stale, setStale] = useState("");
  const load = async (preserve = false) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    if (!preserve) {
      setDraft(null);
      setReview(null);
      setStale("");
    }
    try {
      if (productId) {
        const value = await request<ProductWarrantyTerms>(
          `/api/warranty/products/${encodeURIComponent(productId)}/terms`,
          { signal: controller.signal },
        );
        if (pending.current === controller) {
          setCurrentRevision(value.revision);
          const expected =
            mutation.attempt?.payload.expectedRevision ??
            draft?.expectedRevision;
          if (preserve && expected !== undefined)
            setStale(
              expected !== value.revision
                ? "Policy changed. Your draft, reviewed revision and retained request were preserved; reload the current policy and review before a new save."
                : "Policy refreshed. Your draft and reviewed revision were preserved.",
            );
          if (!preserve || (!draft && !mutation.attempt))
            setDraft({
              productId,
              expectedRevision: value.revision,
              manufacturer: value.manufacturer ?? "",
              reference: value.reference ?? "",
              startsAt: value.startsAt ?? "installation",
              days: value.days,
              notes: value.notes ?? "",
              reason: "",
            });
        }
      } else {
        const value = await request<ReturnWindowPolicy>(
          "/api/warranty/return-policy",
          { signal: controller.signal },
        );
        if (pending.current === controller) {
          setCurrentRevision(value.revision);
          const expected =
            mutation.attempt?.payload.expectedRevision ??
            draft?.expectedRevision;
          if (preserve && expected !== undefined)
            setStale(
              expected !== value.revision
                ? "Policy changed. Your draft, reviewed revision and retained request were preserved; reload the current policy and review before a new save."
                : "Policy refreshed. Your draft and reviewed revision were preserved.",
            );
          if (!preserve || (!draft && !mutation.attempt))
            setDraft({
              expectedRevision: value.revision,
              days: value.days,
              reason: "",
            });
        }
      }
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Policy could not be read.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    if (Object.is(refreshSeen.current, refreshToken)) return;
    refreshSeen.current = refreshToken;
    void load(true);
  }, [refreshToken]);
  const retained =
    mutation.attempt?.name === name ? mutation.attempt.payload : null;
  const reviewed = retained ?? review;
  const terms = draft && "productId" in draft ? draft : null;
  return (
    <section
      className="warranty-record-panel"
      aria-label={
        productId ? "Product warranty terms" : "Ordinary return policy"
      }
    >
      <h3>{productId ? "Product warranty terms" : "Ordinary return policy"}</h3>
      <p>
        {productId
          ? "Configure documented equipment terms for this product. No duration is assumed; leave the duration empty when terms require review."
          : "Set the ordinary return window from shipment. This policy is separate from equipment warranty; an expired return window does not bar a warranty claim."}
      </p>
      <p role="status">
        {busy
          ? "Loading policy…"
          : draft
            ? `Current revision ${currentRevision ?? draft.expectedRevision}${draft.days === null ? " · Duration unset; review required" : ""}`
            : "Policy unavailable."}
      </p>
      {stale && <p role="status">{stale}</p>}
      {stale.startsWith("Policy changed") && !mutation.attempt && (
        <button
          className="secondary"
          disabled={busy || mutation.busy}
          onClick={() => void load()}
        >
          Reload current policy and discard draft
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error}
        </p>
      )}
      {(saved || mutation.receipt !== null) && (
        <p role="status">
          {productId
            ? "Product warranty terms saved."
            : "Ordinary return policy saved."}{" "}
          Save receipt retained; refresh to inspect the current revision.
        </p>
      )}
      {!mutation.attempt && (
        <button
          className="secondary"
          type="button"
          disabled={busy || mutation.busy}
          onClick={() => void load(true)}
        >
          Refresh {productId ? "product terms" : "return policy"}
        </button>
      )}
      {draft && !reviewed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setReview({ ...draft });
          }}
        >
          <fieldset
            disabled={busy || mutation.busy}
            className="warranty-record-fields"
          >
            {terms && (
              <>
                <label>
                  Manufacturer
                  <input
                    required
                    maxLength={240}
                    value={terms.manufacturer}
                    onChange={(event) =>
                      setDraft({ ...terms, manufacturer: event.target.value })
                    }
                  />
                </label>
                <label>
                  Warranty reference
                  <input
                    required
                    maxLength={1000}
                    value={terms.reference}
                    onChange={(event) =>
                      setDraft({ ...terms, reference: event.target.value })
                    }
                  />
                </label>
                <label>
                  Warranty starts at
                  <select
                    value={terms.startsAt}
                    onChange={(event) =>
                      setDraft({
                        ...terms,
                        startsAt: event.target.value as
                          "shipment" | "installation",
                      })
                    }
                  >
                    <option value="installation">Installation</option>
                    <option value="shipment">Shipment</option>
                  </select>
                </label>
              </>
            )}
            <label>
              {productId ? "Warranty duration (days)" : "Return window (days)"}
              <input
                type="number"
                min={0}
                max={36500}
                step={1}
                placeholder="Unset — review required"
                value={draft.days ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    days:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            {terms && (
              <label className="warranty-record-wide">
                Warranty notes
                <textarea
                  required
                  maxLength={2000}
                  value={terms.notes}
                  onChange={(event) =>
                    setDraft({ ...terms, notes: event.target.value })
                  }
                />
              </label>
            )}
            <label className="warranty-record-wide">
              Reason for policy change
              <textarea
                required
                maxLength={1000}
                value={draft.reason}
                onChange={(event) =>
                  setDraft({ ...draft, reason: event.target.value })
                }
              />
            </label>
          </fieldset>
          <button disabled={busy || mutation.busy} type="submit">
            Review {productId ? "product warranty terms" : "return policy"}
          </button>
        </form>
      )}
      {reviewed && (
        <section
          className="warranty-review"
          aria-label={
            productId ? "Review product warranty terms" : "Review return policy"
          }
        >
          <h4>
            {mutation.attempt
              ? "Recover submitted policy"
              : "Review policy change"}
          </h4>
          <dl>
            {Object.entries(reviewed).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>
                  {{
                    productId: "Product",
                    expectedRevision: "Reviewed revision",
                    manufacturer: "Manufacturer",
                    reference: "Warranty reference",
                    startsAt: "Starts at",
                    days: "Duration (days)",
                    notes: "Notes",
                    reason: "Reason",
                  }[key] ?? key}
                </dt>
                <dd>
                  {value === null ? "Unset; review required" : String(value)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="warranty-record-actions">
            <button
              disabled={mutation.busy}
              onClick={async () => {
                const value = await mutation.send(name, reviewed);
                if (value) {
                  setSaved(true);
                  await load();
                }
              }}
            >
              {mutation.busy
                ? "Saving policy…"
                : mutation.attempt
                  ? "Retry retained policy change"
                  : productId
                    ? "Save product warranty terms"
                    : "Save return policy"}
            </button>
            {!mutation.attempt && (
              <button
                className="secondary"
                disabled={mutation.busy}
                onClick={() => setReview(null)}
              >
                Edit policy change
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
export function WarrantyPolicies({
  products,
  orgId,
  actorId,
  refreshToken,
  onClose,
}: {
  products: Array<{ id: string; sku?: string; name?: string }>;
  orgId: string;
  actorId: string;
  refreshToken?: unknown;
  onClose?: () => void;
}) {
  const [productId, setProductId] = useState("");
  return (
    <section
      className="warranty-record-panel"
      aria-label="Return and warranty policies"
    >
      <div className="section-heading">
        <h2>Return and warranty policies</h2>
        {onClose && (
          <button
            className="secondary icon-button"
            aria-label="Close warranty policies"
            title="Close warranty policies"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <div className="warranty-policy-sections">
        <PolicyEditor
          orgId={`${orgId}:${actorId}`}
          refreshToken={refreshToken}
        />
        <section
          className="warranty-record-panel"
          aria-label="Product warranty configuration"
        >
          <label>
            Product for warranty terms
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              <option value="">Select a product</option>
              {products.map((product) => (
                <option value={product.id} key={product.id}>
                  {[product.sku, product.name].filter(Boolean).join(" · ") ||
                    product.id}
                </option>
              ))}
            </select>
          </label>
          {productId && (
            <PolicyEditor
              key={productId}
              orgId={`${orgId}:${actorId}`}
              productId={productId}
              refreshToken={refreshToken}
            />
          )}
        </section>
      </div>
    </section>
  );
}
