import { useEffect, useState } from "react";
import { request } from "./api.ts";
import { CustomerPrice, usePricingChange } from "./customer-pricing.tsx";
import catalog from "./gree-catalog-data.json" with { type: "json" };
import type { CustomerReferenceResult } from "../shared/catalog-reference.ts";
import type { CustomerProduct } from "../shared/customer-products.ts";
import type { ReferenceRequest } from "./reference-context.ts";
import { ProductDetail } from "./storefront.tsx";
export function ReferenceRequestSummary({
  reference,
}: {
  reference: ReferenceRequest;
}) {
  const family = catalog.products.find((p) => p.id === reference.familyId),
    model = family?.models?.find((m) => m.id === reference.modelId);
  return (
    <p role="status">
      Requested equipment: {family?.title || reference.familyId}
      {model
        ? ` · ${model.title}`
        : reference.modelId
          ? ` · model ${reference.modelId}`
          : ""}
      . Purchasing requires an approved account and a reviewed catalog match.
    </p>
  );
}
export function ReferenceMappingEditor({
  productId,
  recoveryScope,
}: {
  productId: string;
  recoveryScope: string;
}) {
  const change = usePricingChange(
    `/api/catalog/products/${encodeURIComponent(productId)}/reference`,
    "catalog.reference.set",
    { productId },
    recoveryScope,
    "Reference mapping",
  );
  const [familyId, setFamily] = useState(""),
    [modelId, setModel] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    if (change.value) {
      setFamily(change.value.familyId || "");
      setModel(change.value.modelId || "");
      setReason("");
    }
  }, [change.value]);
  const family = catalog.products.find((p) => p.id === familyId);
  return (
    <section>
      <h3>Reviewed manufacturer reference</h3>
      <p>
        Link this native SKU only after verifying the exact equipment and system
        configuration. This mapping does not copy images, documents or prices.
      </p>
      {change.recoveryUi}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change.save({
            productId,
            familyId: familyId || null,
            modelId: modelId || null,
            revision: change.value.revision,
            reason,
          });
        }}
      >
        <fieldset disabled={change.locked || !change.value}>
          <label>
            Manufacturer product family
            <select
              value={familyId}
              onChange={(e) => {
                setFamily(e.target.value);
                setModel("");
              }}
            >
              <option value="">No reviewed mapping</option>
              {catalog.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          {!!family?.models?.length && (
            <label>
              Exact manufacturer model
              <select
                required
                value={modelId}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">Select the verified model</option>
                {family.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {m.manufacturerModel ? ` · ${m.manufacturerModel}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Reason for reference mapping
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button>Save reviewed reference mapping</button>
        </fieldset>
      </form>
    </section>
  );
}
export function ReferenceMatches({
  reference,
  accountId,
  add,
}: {
  reference: ReferenceRequest;
  accountId: string;
  add: (product: CustomerProduct, quantity: number) => void;
}) {
  const [result, setResult] = useState<CustomerReferenceResult | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<CustomerProduct | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setResult(null);
    setError("");
    setSelected(null);
    const q = new URLSearchParams({ accountId, familyId: reference.familyId });
    if (reference.modelId) q.set("modelId", reference.modelId);
    void request<CustomerReferenceResult>(
      `/api/customer-products/reference?${q}`,
      { signal: c.signal },
    )
      .then(setResult)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [accountId, reference.familyId, reference.modelId]);
  const family = catalog.products.find((p) => p.id === reference.familyId),
    model = family?.models?.find((m) => m.id === reference.modelId);
  return (
    <section className="panel">
      <h2>Requested manufacturer equipment</h2>
      <p>
        {family?.title || reference.familyId}
        {model
          ? ` · ${model.title}`
          : reference.modelId
            ? ` · ${reference.modelId}`
            : ""}
      </p>
      <p>
        Reviewed native products available to your account. Verify the exact
        system combination before ordering.
      </p>
      {error && <p role="alert">{error}</p>}
      {!result && !error && (
        <p role="status">Checking reviewed purchasing matches…</p>
      )}
      {result && !result.products.length && (
        <p role="status">
          No reviewed purchasing match is currently available to your account.
          Contact your distributor with this model request.
        </p>
      )}
      {result?.truncated && (
        <p>
          Showing the first 20 reviewed matches. Contact your distributor for
          additional configurations.
        </p>
      )}
      {selected ? (
        <ProductDetail
          product={selected}
          back={() => setSelected(null)}
          add={(quantity) => add(selected, quantity)}
        />
      ) : (
        result?.products.map((product) => (
          <article key={product.id}>
            <h3>
              {product.sku} · {product.name}
            </h3>
            <CustomerPrice product={product} />
            <button onClick={() => setSelected(product)}>
              View {product.name}
            </button>
          </article>
        ))
      )}
    </section>
  );
}
