import React, { useEffect, useId, useRef, useState } from "react";
import type {
  CartLine,
  CustomerProduct,
  CustomerProductPage,
  SelectedCustomerProduct,
} from "../shared/customer-products.ts";
import { request } from "./api.ts";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amount / 100,
  );
// Keep only one catalog page and the chosen products. Page navigation never
// determines the basket or whether a saved product is active.
export function CartQuantities({
  accountId,
  initial,
  selected,
  lines,
}: {
  accountId: string;
  initial: CustomerProductPage;
  selected: SelectedCustomerProduct[];
  lines: CartLine[];
}) {
  const [page, setPage] = useState(initial);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [basket, setBasket] = useState(() =>
    Object.fromEntries(
      selected
        .filter((p) => p.active === 1)
        .map((p) => [
          p.id,
          {
            product: p as CustomerProduct,
            quantity: String(
              lines.find((l) => l.productId === p.id)?.quantity ?? 0,
            ),
          },
        ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const [failed, setFailed] = useState<{
    query: string;
    after: string | null;
  } | null>(null);
  const prefix = useId();
  const searchInput = useRef<HTMLInputElement | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  const load = async (search = query, after: string | null = null) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const params = new URLSearchParams({ accountId });
    if (search.trim()) params.set("q", search.trim());
    if (after) params.set("after", after);
    setBusy(true);
    setError("");
    try {
      const result = await request<CustomerProductPage>(
        `/api/catalog/customer-products/page?${params}`,
        { signal: controller.signal },
      );
      if (pending.current !== controller || controller.signal.aborted) return;
      setPage(result);
      setQuery(search);
      setAppliedQuery(search);
      setFailed(null);
      setBasket((old) => {
        const next = { ...old };
        for (const product of result.items)
          if (next[product.id])
            next[product.id] = { ...next[product.id]!, product };
        return next;
      });
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted) {
        setFailed({ query: search, after });
        setError((e as Error).message);
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const change = (product: CustomerProduct, quantity: string) => {
    if (
      !basket[product.id] &&
      quantity !== "0" &&
      Object.keys(basket).length >= 100
    ) {
      setError(
        "Maximum 100 selected products. Remove an item before adding another.",
      );
      return;
    }
    setBasket((old) => {
      const next = { ...old };
      if (quantity === "0") delete next[product.id];
      else next[product.id] = { product, quantity };
      return next;
    });
  };
  const input = (product: CustomerProduct) => (
    <div key={product.id} className="form-field">
      <label htmlFor={`${prefix}-${product.id}`}>
        {product.sku} · {product.name}
      </label>
      <input
        id={`${prefix}-${product.id}`}
        type="number"
        min={0}
        max={100000}
        step={1}
        required
        value={basket[product.id]?.quantity ?? "0"}
        onChange={(event) => change(product, event.target.value)}
        aria-describedby={`${prefix}-price-${product.id}`}
      />
      <small id={`${prefix}-price-${product.id}`}>
        Customer price {money(product.unit_price, product.currency)} +{" "}
        {money(product.unit_tax, product.currency)} tax per unit (
        {product.currency}).
      </small>
      {basket[product.id] && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            change(product, "0");
            // An off-page row disappears when removed. Keep keyboard focus on
            // a stable control instead of leaving it on the discarded button.
            searchInput.current?.focus();
          }}
        >
          Remove {product.sku} · {product.name} from cart
        </button>
      )}
    </div>
  );
  const chosen = Object.values(basket);
  return (
    <div>
      <input
        type="hidden"
        name="basket"
        value={JSON.stringify(
          chosen
            .map(({ product, quantity }) => ({
              productId: product.id,
              quantity: Number(quantity),
            }))
            .filter((l) => l.quantity > 0)
            .sort((a, b) => a.productId.localeCompare(b.productId)),
        )}
      />
      <p role="status">
        {chosen.length} selected products. Quantities stay selected across
        catalog pages.
      </p>
      {chosen.some(
        ({ product }) => !page.items.some((p) => p.id === product.id),
      ) && (
        <section aria-label="Selected products">
          <h3>Selected products from other pages</h3>
          {chosen
            .filter(
              ({ product }) => !page.items.some((p) => p.id === product.id),
            )
            .map(({ product }) => input(product))}
        </section>
      )}
      <label htmlFor={`${prefix}-search`}>Search catalog</label>
      <input
        id={`${prefix}-search`}
        ref={searchInput}
        value={query}
        maxLength={120}
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void load();
          }
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Search catalog
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load("", null)}
        >
          Clear catalog search
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {error && failed && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (failed) void load(failed.query, failed.after);
          }}
        >
          Retry catalog page
        </button>
      )}
      <section aria-label="Catalog page">
        <h3>Catalog page</h3>
        <p role="status">
          {busy
            ? "Loading catalog…"
            : `${page.items.length} products on this page`}
        </p>
        {page.items.map(input)}
        {!page.items.length && <p>No matching products.</p>}
      </section>
      {page.next && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(appliedQuery, page.next)}
        >
          Next catalog page
        </button>
      )}
    </div>
  );
}
