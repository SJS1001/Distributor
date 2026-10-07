import { InfoBubble } from "./info-bubble.tsx";
import React, { useEffect, useRef, useState } from "react";
import { ProductAvailabilityEditor } from "./product-availability.tsx";
import { CatalogResourceWorkspace } from "./catalog-resources.tsx";
import { useCursorPage } from "./cursor-page.ts";
import type {
  CatalogProduct,
  CatalogLifecycleRecord,
} from "../shared/catalog-lifecycle.ts";

const priceFormatters = {
  CAD: new Intl.NumberFormat("en", { style: "currency", currency: "CAD" }),
  USD: new Intl.NumberFormat("en", { style: "currency", currency: "USD" }),
};
type Actions = {
  recoveryScope: string;
  canManage: boolean;
  canManageAvailability: boolean;
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
  const rows = useCursorPage<CatalogProduct>(
    `/api/catalog/products/page?state=${state}&q=${encodeURIComponent(search)}`,
  );
  return (
    <section aria-label="Staff catalog">
      <p role="status">
        Page {rows.pageNumber} · {rows.items.length}{" "}
        {rows.items.length === 1 ? "product" : "products"} loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <div className="table-wrap">
        <table className="catalog-maintenance-table">
          <thead>
            <tr>
              {[
                "SKU",
                "Product",
                "Serial tracking",
                "Base price",
                "Tax",
                "Status",
                "Customer availability",
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
                  {actions.canManageAvailability && (
                    <ProductAvailabilityEditor
                      productId={p.id}
                      compact
                      initial={p.availability}
                    />
                  )}
                </td>
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
                        className="secondary"
                        disabled={actions.busy}
                        onClick={() => actions.price(p)}
                      >
                        Tier price
                      </button>
                      <button
                        className="secondary"
                        disabled={actions.busy}
                        aria-label={`${p.active === 1 ? "Retire" : "Reactivate"} ${p.sku}`}
                        onClick={() => actions.review(p.id, p.active !== 1)}
                      >
                        {p.active === 1 ? "Retire" : "Reactivate"}
                      </button>
                      <button
                        className="secondary"
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
      <nav className="actions" aria-label="Catalog pages">
        <button
          className="secondary"
          disabled={rows.busy || rows.pageNumber === 1}
          onClick={rows.previous}
        >
          Previous catalog page
        </button>
        <button
          className="secondary"
          disabled={rows.busy || !rows.next}
          onClick={rows.nextPage}
        >
          Next staff catalog page
        </button>
        {rows.error && (
          <button disabled={rows.busy} onClick={rows.retry}>
            Retry catalog page
          </button>
        )}
        <InfoBubble label="catalog pages">
          Pages show current status, ordered by SKU. Refresh after changes. Base
          prices are staff reference prices; customer quotes apply their
          account's pricing rules.
        </InfoBubble>
      </nav>
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
        <ProductDialog
          key={product.id}
          product={product}
          canManageAvailability={actions.canManageAvailability}
          recoveryScope={actions.recoveryScope}
          close={() => setProduct(null)}
        />
      )}
      <form
        className="queue-controls catalog-search"
        aria-label="Catalog filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSelection({
            search: search.trim(),
            state,
            epoch: selection.epoch + 1,
          });
        }}
      >
        <label className="queue-field">
          Catalog search
          <input
            type="search"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="queue-field">
          Product status
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="all">All products</option>
          </select>
        </label>
        <div className="queue-field-actions">
          <button type="submit" disabled={actions.busy}>
            Search catalog
          </button>
        </div>
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
function ProductDialog(
  props: React.ComponentProps<typeof CatalogResourceWorkspace>,
) {
  const dialog = useRef<HTMLDialogElement>(null),
    pressedBackdrop = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="catalog-management-dialog"
      aria-label={`Manage ${props.product.sku}`}
      onCancel={(event) => {
        event.preventDefault();
        props.close();
      }}
      // The dialog element fills only its box; a click on the dialog itself
      // (not its content) is a click on the backdrop outside the box.
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget)
          props.close();
        pressedBackdrop.current = false;
      }}
    >
      <CatalogResourceWorkspace {...props} />
    </dialog>
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
