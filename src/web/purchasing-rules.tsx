import React, { useEffect, useState } from "react";
import { command, request } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import type {
  PurchasingPolicy,
  ProductPurchasingPolicy,
} from "../shared/purchasing.ts";
import type { CatalogProduct } from "../shared/catalog-lifecycle.ts";
import "./record-forms.css";
import "./purchasing-rules.css";

function ProductChoices({
  selected,
  change,
  disabled,
}: {
  selected: string[];
  change: (ids: string[]) => void;
  disabled: boolean;
}) {
  const rows = usePages<CatalogProduct>(
    "/api/catalog/products/page?state=active",
  );
  return (
    <fieldset disabled={disabled} className="policy-product-choices">
      <legend>Eligible products ({selected.length} selected)</legend>
      <div className="policy-products">
        {rows.items.map((p) => (
          <label key={p.id} className="purchasing-check">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                )
              }
            />
            {p.sku} — {p.name}
          </label>
        ))}
      </div>
      {selected.filter((id) => !rows.items.some((p) => p.id === id)).length >
        0 && (
        <p>
          Selections outside this page remain selected. Load more products to
          review them.
        </p>
      )}
      {rows.error && <p role="alert">{rows.error}</p>}
      {(rows.next || rows.error) && (
        <button
          type="button"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          Load more eligible product choices
        </button>
      )}
    </fieldset>
  );
}
function CustomerPolicy({ accountId }: { accountId: string }) {
  const [policy, setPolicy] = useState<PurchasingPolicy | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPolicy(null);
    setError("");
    void request<PurchasingPolicy>(
      `/api/catalog/purchasing/${encodeURIComponent(accountId)}`,
      { signal: controller.signal },
    )
      .then(setPolicy)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [accountId, epoch]);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {policy ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await command("catalog.purchasing.set", {
                ...policy,
                productIds: policy.mode === "selected" ? policy.productIds : [],
                reason,
              });
              setReason("");
              setNotice("Customer purchasing rules saved.");
              setEpoch(epoch + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="record-form-card">
            <legend>Customer purchasing access</legend>
            <label className="purchasing-access">
              Catalog access
              <select
                aria-label="Catalog access"
                value={policy.mode}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    mode: e.target.value as PurchasingPolicy["mode"],
                  })
                }
              >
                <option value="none">No product access</option>
                <option value="selected">Selected products</option>
                <option value="all">All active products</option>
              </select>
            </label>
            <label className="purchasing-check">
              <input
                type="checkbox"
                checked={policy.requiresReview}
                onChange={(e) =>
                  setPolicy({ ...policy, requiresReview: e.target.checked })
                }
              />
              Require distributor approval for every order
            </label>
            {policy.mode === "selected" && (
              <ProductChoices
                selected={policy.productIds}
                change={(productIds) => setPolicy({ ...policy, productIds })}
                disabled={busy}
              />
            )}
            <label>
              Reason for purchasing rule change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="record-form-note">
              Changing access applies to browsing and subsequent cart, quote and
              acceptance checks. Product rules may independently require review.
            </p>
            <div className="record-form-footer">
              <button type="submit">Save customer purchasing rules</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEpoch(epoch + 1)}
              >
                Reload current purchasing rules
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p role="status">
            {error
              ? "Rules unavailable. Reload to retry."
              : "Loading purchasing rules…"}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setEpoch(epoch + 1)}
          >
            Reload current purchasing rules
          </button>
        </>
      )}
    </>
  );
}
export function CustomerPurchasingRules({
  accounts,
  selectedOnly = false,
}: {
  selectedOnly?: boolean;
  accounts: { id: string; name: string }[];
}) {
  const [id, setId] = useState(accounts[0]?.id ?? "");
  return (
    <section className="panel customer-purchasing-rules">
      <h3>Customer purchasing rules</h3>
      {!selectedOnly && (
        <label>
          Customer for purchasing rules
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {id ? (
        <CustomerPolicy key={id} accountId={id} />
      ) : (
        <p>Create a customer before assigning product access.</p>
      )}
    </section>
  );
}
export function ProductPurchasingRules({ productId }: { productId: string }) {
  const [policy, setPolicy] = useState<ProductPurchasingPolicy | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [epoch, setEpoch] = useState(0),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setPolicy(null);
    setError("");
    void request<ProductPurchasingPolicy>(
      `/api/catalog/products/${encodeURIComponent(productId)}/purchasing`,
      { signal: c.signal },
    )
      .then(setPolicy)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [productId, epoch]);
  return (
    <>
      <h3>Product purchasing rules</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!policy && (
        <>
          {!error && <p role="status">Loading product purchasing rule…</p>}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setEpoch(epoch + 1)}
          >
            Reload product purchasing rule
          </button>
        </>
      )}
      {policy && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await command("catalog.product-purchasing.set", {
                ...policy,
                reason,
              });
              setReason("");
              setNotice("Product purchasing rule saved.");
              setEpoch(epoch + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="record-form-card">
            <legend>Order review</legend>
            <label className="record-form-check">
              <input
                type="checkbox"
                checked={policy.requiresReview}
                onChange={(e) =>
                  setPolicy({ ...policy, requiresReview: e.target.checked })
                }
              />
              Require distributor approval for orders containing this product
            </label>
            <label>
              Reason for product rule change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="record-form-note">
              Customer entitlement is managed in Customers → Customer purchasing
              rules.
            </p>
            <div className="record-form-footer">
              <button>Save product purchasing rule</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEpoch(epoch + 1)}
              >
                Reload product purchasing rule
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
