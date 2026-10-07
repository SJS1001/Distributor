import { useEffect, useState } from "react";
import { request } from "./api.ts";
import { LocalCartFeedback } from "./shop-cart.tsx";
import { CustomerPrice, usePricingChange } from "./customer-pricing.tsx";
import {
  MAX_ADDONS,
  type CustomerAddonSuggestions,
  type ProductAddonEntry,
} from "../shared/catalog-addons.ts";
import type { CatalogPage } from "../shared/catalog-lifecycle.ts";
import type { CustomerProduct } from "../shared/customer-products.ts";

// Staff choose the products suggested with this unit, in display order.
export function ProductAddonsEditor({
  productId,
  recoveryScope,
}: {
  productId: string;
  recoveryScope: string;
}) {
  const change = usePricingChange(
    `/api/catalog/products/${encodeURIComponent(productId)}/addons`,
    "catalog.product-addons.set",
    { productId },
    recoveryScope,
    "Suggested add-ons",
  );
  const [addons, setAddons] = useState<ProductAddonEntry[]>([]),
    [reason, setReason] = useState(""),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ProductAddonEntry[] | null>(null),
    [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (change.value) {
      setAddons(change.value.addons);
      setReason("");
    }
  }, [change.value]);
  async function search() {
    setSearchError("");
    try {
      const page = await request<CatalogPage>(
        `/api/catalog/products/page?state=active&q=${encodeURIComponent(query.trim())}`,
      );
      setResults(
        page.items
          .filter((p) => p.id !== productId)
          .map((p) => ({ id: p.id, sku: p.sku, name: p.name, active: true })),
      );
    } catch (e) {
      setSearchError((e as Error).message);
    }
  }
  const move = (index: number, by: number) => {
    const next = [...addons];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    setAddons(next);
  };
  return (
    <section className="product-addons-editor">
      <h3>Suggested add-ons</h3>
      <p>
        Choose install kits, brackets or other products to suggest when a
        customer views or orders this unit. Customers see only add-ons their
        account may buy, at their own prices. Up to {MAX_ADDONS} products.
      </p>
      {change.recoveryUi}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change.save({
            productId,
            addonIds: addons.map((a) => a.id),
            revision: change.value.revision,
            reason,
          });
        }}
      >
        <fieldset disabled={change.locked || !change.value}>
          {addons.length ? (
            <ol className="product-addons-list" aria-label="Chosen add-ons">
              {addons.map((a, index) => (
                <li key={a.id}>
                  <span>
                    <code>{a.sku}</code> {a.name}
                    {!a.active && " · Retired, not shown to customers"}
                  </span>
                  <span className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={index === 0}
                      aria-label={`Move ${a.name} up`}
                      onClick={() => move(index, -1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={index === addons.length - 1}
                      aria-label={`Move ${a.name} down`}
                      onClick={() => move(index, 1)}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Remove add-on ${a.name}`}
                      onClick={() =>
                        setAddons(addons.filter((x) => x.id !== a.id))
                      }
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No add-ons are suggested with this product.</p>
          )}
          <label>
            Find a product to add
            <input
              type="search"
              value={query}
              maxLength={120}
              placeholder="SKU or product name"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => void search()}
          >
            Search products
          </button>
          {searchError && (
            <p role="alert" className="error">
              {searchError}
            </p>
          )}
          {results && (
            <ul className="product-addons-results" aria-label="Product matches">
              {!results.length && <li>No matching active products.</li>}
              {results.map((p) => {
                const chosen = addons.some((a) => a.id === p.id);
                return (
                  <li key={p.id}>
                    <span>
                      <code>{p.sku}</code> {p.name}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={chosen || addons.length >= MAX_ADDONS}
                      aria-label={`Add ${p.name} as an add-on`}
                      onClick={() => setAddons([...addons, p])}
                    >
                      {chosen ? "Added" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label>
            Reason for add-on change (Required)
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button>Save suggested add-ons</button>
        </fieldset>
      </form>
    </section>
  );
}

// Loads configured add-ons the account may buy for the given main units.
export function useAddonSuggestions(accountId: string, productIds: string[]) {
  const key = productIds.join(",");
  const [suggestions, setSuggestions] = useState<
    CustomerAddonSuggestions["suggestions"]
  >([]);
  useEffect(() => {
    setSuggestions([]);
    if (!key) return;
    const controller = new AbortController();
    void request<CustomerAddonSuggestions>(
      `/api/catalog/customer-products/addons?accountId=${encodeURIComponent(accountId)}&productIds=${encodeURIComponent(key)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSuggestions(result.suggestions);
      })
      // Suggestions are optional; ordering continues without them.
      .catch(() => {});
    return () => controller.abort();
  }, [accountId, key]);
  return suggestions;
}

export function AddonSuggestions({
  title,
  addons,
  add,
}: {
  title: string;
  addons: CustomerProduct[];
  add: (product: CustomerProduct) => void;
}) {
  if (!addons.length) return null;
  return (
    <section className="sf-addons" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {addons.map((p) => (
          <li key={p.id}>
            <div>
              <p className="sf-sku">{p.sku}</p>
              <p className="sf-addon-name">{p.name}</p>
              <CustomerPrice product={p} compact />
            </div>
            <button
              type="button"
              className="sf-addon-add"
              aria-label={`Add add-on ${p.name} to cart`}
              onClick={() => add(p)}
            >
              Add
            </button>
            <LocalCartFeedback productId={p.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
