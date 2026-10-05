import React, { useState } from "react";
import { CatalogResourceWorkspace } from "./catalog-resources.tsx";
import { usePages } from "./billing-inbox.tsx";
import type {
  CatalogProduct,
  CatalogLifecycleRecord,
} from "../shared/catalog-lifecycle.ts";

const priceFormatters = {
  CAD: new Intl.NumberFormat("en", { style: "currency", currency: "CAD" }),
  USD: new Intl.NumberFormat("en", { style: "currency", currency: "USD" }),
};
type Actions = {
  canManage: boolean;
  busy: boolean;
  review: (id: string, active: boolean) => void;
  history: (id: string) => void;
  price: (product: CatalogProduct) => void;
};
function Products({
  search,
  state,
  ...actions
}: Actions & {
  search: string;
  state: string;
  manage: (product: CatalogProduct) => void;
}) {
  const rows = usePages<CatalogProduct>(
    `/api/catalog/products/page?state=${state}&q=${encodeURIComponent(search)}`,
  );
  return (
    <section aria-label="Staff catalog">
      <p role="status">
        {rows.items.length} products loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "SKU",
                "Product",
                "Serial tracking",
                "Base price",
                "Tax",
                "Status",
                "Actions",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.items.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.serialized ? "Required" : "Bulk"}</td>
                <td>
                  {priceFormatters[
                    p.currency as keyof typeof priceFormatters
                  ].format(p.unit_price / 100)}
                </td>
                <td>{p.tax_bp / 100}%</td>
                <td>{p.active === 1 ? "Active" : "Retired"}</td>
                <td>
                  {actions.canManage && (
                    <div className="actions">
                      <button
                        disabled={actions.busy}
                        onClick={() => actions.manage(p)}
                      >
                        Manage {p.sku}
                      </button>
                      <button
                        disabled={actions.busy}
                        onClick={() => actions.price(p)}
                      >
                        Tier price
                      </button>
                      <button
                        disabled={actions.busy}
                        aria-label={`${p.active === 1 ? "Retire" : "Reactivate"} ${p.sku}`}
                        onClick={() => actions.review(p.id, p.active !== 1)}
                      >
                        {p.active === 1 ? "Retire" : "Reactivate"}
                      </button>
                      <button
                        disabled={actions.busy}
                        aria-label={`Lifecycle history ${p.sku}`}
                        onClick={() => actions.history(p.id)}
                      >
                        Lifecycle history
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No matching products.</p>
      )}
      {(rows.next || rows.error) && (
        <button disabled={rows.busy} onClick={() => void rows.load()}>
          {rows.error ? "Retry catalog page" : "Next staff catalog page"}
        </button>
      )}
      <p>
        Pages show current status, ordered by SKU. Refresh after changes. Base
        prices are staff reference prices; customer quotes apply current tier
        prices.
      </p>
    </section>
  );
}
export function CatalogMaintenance(actions: Actions) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("active");
  const [selection, setSelection] = useState({
    search: "",
    state: "active",
    epoch: 0,
  });
  return (
    <>
      {product && (
        <CatalogResourceWorkspace
          key={product.id}
          product={product}
          close={() => setProduct(null)}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSelection({
            search: search.trim(),
            state,
            epoch: selection.epoch + 1,
          });
        }}
      >
        <label>
          Catalog search
          <input
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Product status
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="all">All products</option>
          </select>
        </label>
        <button type="submit" disabled={actions.busy}>
          Search catalog
        </button>
      </form>
      <Products
        key={selection.epoch}
        search={selection.search}
        state={selection.state}
        {...actions}
        manage={setProduct}
      />
    </>
  );
}
export function CatalogHistoryRows({
  items,
}: {
  items: CatalogLifecycleRecord[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Recorded time</th>
            <th>Change</th>
            <th>Reason</th>
            <th>Actor ID</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td>{row.createdAt}</td>
              <td>
                {row.product.sku}:{" "}
                {row.toActive === 1 ? "Reactivated" : "Retired"}
              </td>
              <td>{row.reason}</td>
              <td>{row.actorId}</td>
              <td>{row.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p>No lifecycle changes recorded.</p>}
    </div>
  );
}
