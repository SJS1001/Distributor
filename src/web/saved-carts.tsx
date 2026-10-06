import React, { useEffect, useId, useRef, useState } from "react";
import type { SavedCartPage } from "../shared/customer-products.ts";
import { request } from "./api.ts";

export function SavedCarts({
  initial,
  accounts,
  warehouses,
  accountName,
  warehouseName,
  resume,
  shippingDetails,
  priceDetails,
  disabled,
}: {
  initial: SavedCartPage;
  accounts: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  accountName: (id: string) => string;
  warehouseName: (id: string) => string;
  resume: (accountId: string, warehouseId: string) => void;
  shippingDetails?: (cartId: string, cartRevision: number) => void;
  priceDetails?: (cartId: string, cartRevision: number) => void;
  disabled: boolean;
}) {
  const prefix = useId();
  const [page, setPage] = useState(initial),
    [accountId, setAccount] = useState(""),
    [warehouseId, setWarehouse] = useState("");
  const [applied, setApplied] = useState({ accountId: "", warehouseId: "" });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  const load = async (
    account = accountId,
    warehouse = warehouseId,
    after: string | null = null,
    retry?: string,
  ) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const params = new URLSearchParams();
    if (account) params.set("accountId", account);
    if (warehouse) params.set("warehouseId", warehouse);
    if (after) params.set("after", after);
    const url = retry ?? `/api/carts/page?${params}`;
    setBusy(true);
    setError("");
    try {
      const result = await request<SavedCartPage>(url, {
        signal: controller.signal,
      });
      if (pending.current !== controller || controller.signal.aborted) return;
      setPage(result);
      setApplied({ accountId: account, warehouseId: warehouse });
      setFailed(null);
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted) {
        setError((e as Error).message);
        setFailed(url);
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const locked = disabled || busy;
  // A single-account viewer (a buyer) gains nothing from a customer column.
  const multipleAccounts = accounts.length > 1;
  const columns = multipleAccounts
    ? ["Customer", "Warehouse", "Items", "Actions"]
    : ["Warehouse", "Items", "Actions"];
  return (
    <section aria-label="Saved carts">
      <h2>Saved carts</h2>
      <div className="queue-controls saved-cart-filters">
        {accounts.length > 1 && (
          <div className="queue-field">
            <label htmlFor={`${prefix}-account`}>Saved cart customer</label>
            <select
              id={`${prefix}-account`}
              value={accountId}
              disabled={locked}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">All available customers</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="queue-field">
          <label htmlFor={`${prefix}-warehouse`}>Saved cart warehouse</label>
          <select
            id={`${prefix}-warehouse`}
            value={warehouseId}
            disabled={locked}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">All available warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="actions queue-field-actions">
          <button type="button" disabled={locked} onClick={() => void load()}>
            Search saved carts
          </button>
          <button
            type="button"
            className="secondary"
            disabled={locked}
            onClick={() => {
              setAccount("");
              setWarehouse("");
              void load("", "");
            }}
          >
            First saved cart page
          </button>
        </div>
      </div>
      <p role="status">
        {busy
          ? "Loading saved carts…"
          : `${page.items.length} saved ${page.items.length === 1 ? "cart" : "carts"} on this page`}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {error && failed && (
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const params = new URL(failed, location.origin).searchParams;
            void load(
              params.get("accountId") ?? "",
              params.get("warehouseId") ?? "",
              null,
              failed,
            );
          }}
        >
          Retry saved cart page
        </button>
      )}
      {page.items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((c) => (
                <tr key={c.id}>
                  {multipleAccounts && (
                    <td data-label="Customer">{accountName(c.account_id)}</td>
                  )}
                  <td data-label="Warehouse">
                    {warehouseName(c.warehouse_id)}
                  </td>
                  <td data-label="Items">
                    {c.products} {c.products === 1 ? "product" : "products"} ·{" "}
                    {c.units} {c.units === 1 ? "unit" : "units"}
                  </td>
                  <td data-label="Actions">
                    <div className="actions">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => resume(c.account_id, c.warehouse_id)}
                      >
                        Resume
                      </button>
                      {priceDetails && (
                        <button
                          className="secondary"
                          disabled={locked}
                          onClick={() => priceDetails(c.id, c.revision)}
                        >
                          Selling price
                        </button>
                      )}
                      {shippingDetails && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={locked}
                          onClick={() => shippingDetails(c.id, c.revision)}
                        >
                          Shipping terms
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No saved carts match these filters.</p>
      )}
      {page.next && (
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            void load(applied.accountId, applied.warehouseId, page.next)
          }
        >
          Next saved cart page
        </button>
      )}
    </section>
  );
}
