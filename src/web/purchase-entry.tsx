import React, { useEffect, useRef, useState } from "react";
import { Modal } from "./modal.tsx";
import { request, RequestError } from "./api.ts";
import type {
  CatalogPage,
  CatalogProduct,
} from "../shared/catalog-lifecycle.ts";

type Choice = { id: string; name: string };
type Line = { product: CatalogProduct; quantity: string; unitCost: string };
type Review = {
  supplier: Choice;
  warehouse: Choice;
  currency: string;
  lines: Line[];
  payload: {
    supplierId: string;
    warehouseId: string;
    lines: { productId: string; quantity: number; unitCost: number }[];
  };
};
type Pending = { key: string; review: Review };
const amount = (cents: bigint, currency: string) =>
  `${currency} ${(cents / 100n).toLocaleString("en")}.${String(cents % 100n).padStart(2, "0")}`;
const lineCost = (line: Line) => BigInt(line.quantity) * BigInt(line.unitCost);

// Browser storage is recovery evidence, never authority to create or receive stock.
// Refuse damaged evidence rather than silently issuing a new purchase attempt.
function retained(storageKey: string): {
  pending: Pending | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { pending: null, error: "" };
    if (raw.length > 200000) throw Error();
    const pending = JSON.parse(raw) as Pending;
    const { review, key } = pending;
    if (
      typeof key !== "string" ||
      !/^[a-f0-9-]{36}$/.test(key) ||
      !review ||
      !["CAD", "USD"].includes(review.currency) ||
      !Array.isArray(review.lines) ||
      !review.lines.length ||
      review.lines.length > 100 ||
      !review.supplier?.id ||
      !review.warehouse?.id ||
      typeof review.supplier.name !== "string" ||
      typeof review.warehouse.name !== "string" ||
      review.payload?.supplierId !== review.supplier.id ||
      review.payload?.warehouseId !== review.warehouse.id ||
      !Array.isArray(review.payload.lines) ||
      review.payload.lines.length !== review.lines.length
    )
      throw Error();
    const seen = new Set<string>();
    for (let i = 0; i < review.lines.length; i++) {
      const line = review.lines[i]!,
        input = review.payload.lines[i]!;
      if (
        !line.product?.id ||
        typeof line.product.sku !== "string" ||
        typeof line.product.name !== "string" ||
        seen.has(line.product.id) ||
        input.productId !== line.product.id ||
        !Number.isSafeInteger(input.quantity) ||
        input.quantity < 1 ||
        input.quantity > 100000 ||
        !Number.isSafeInteger(input.unitCost) ||
        input.unitCost < 0 ||
        input.unitCost > 1e9 ||
        line.quantity !== String(input.quantity) ||
        line.unitCost !== String(input.unitCost)
      )
        throw Error();
      seen.add(line.product.id);
    }
    return { pending, error: "" };
  } catch {
    return {
      pending: null,
      error:
        "Purchase recovery evidence cannot be read. Do not create another order until the previous attempt is reconciled and browser storage is available.",
    };
  }
}

function ProductPage({
  search,
  after,
  add,
  selected,
  disabled,
  next,
}: {
  search: string;
  after: string | null;
  add: (product: CatalogProduct) => void;
  selected: Set<string>;
  disabled: boolean;
  next: (cursor: string) => void;
}) {
  const [rows, setRows] = useState<CatalogPage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<CatalogPage>(
      `/api/catalog/products/page?state=all&q=${encodeURIComponent(search)}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [search, after, retry]);
  return (
    <section aria-label="Purchase product search results">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!rows && !error && <p role="status">Loading products…</p>}
      {rows && (
        <>
          <p role="status">{rows.items.length} products on this page</p>
          {rows.items.map((product) => (
            <div className="purchase-product" key={product.id}>
              <span>
                {product.sku} · {product.name}
                {product.active ? "" : " · Retired for customer ordering"}
              </span>
              <button
                type="button"
                disabled={
                  disabled || selected.has(product.id) || selected.size >= 100
                }
                onClick={() => add(product)}
                aria-label={`Add ${product.sku}`}
              >
                {selected.has(product.id) ? "Selected" : "Add"}
              </button>
            </div>
          ))}
          {!rows.items.length && <p>No matching products.</p>}
          {rows.next && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => next(rows.next!)}
            >
              Next purchase products
            </button>
          )}
        </>
      )}
      {error && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError("");
            setRetry(retry + 1);
          }}
        >
          Retry purchase products
        </button>
      )}
    </section>
  );
}

export function PurchaseEntry({
  suppliers,
  warehouses,
  currency,
  orgId,
  actorId,
  close,
  created,
}: {
  suppliers: Choice[];
  warehouses: Choice[];
  currency: string;
  orgId: string;
  actorId: string;
  close: () => void;
  created: (id: string) => void;
}) {
  const storageKey = `distributor-purchase-attempt:${orgId}:${actorId}`;
  const [recovery] = useState(() => retained(storageKey));
  const [pending, setPending] = useState(recovery.pending);
  const [review, setReview] = useState<Review | null>(
    recovery.pending?.review ?? null,
  );
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState({
    search: "",
    after: null as string | null,
    epoch: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(recovery.error);
  const active = useRef(true),
    submitting = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const submit = async () => {
    if (submitting.current || recovery.error) return;
    setError("");
    if (!review) {
      const supplier = suppliers.find((s) => s.id === supplierId),
        warehouse = warehouses.find((w) => w.id === warehouseId);
      if (!supplier || !warehouse || !lines.length) {
        setError("Choose a supplier, warehouse and at least one product.");
        return;
      }
      const input = lines.map((line) => ({
        productId: line.product.id,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
      }));
      if (
        lines.length > 100 ||
        input.some(
          (line, i) =>
            !lines[i]!.quantity.trim() ||
            !lines[i]!.unitCost.trim() ||
            !Number.isSafeInteger(line.quantity) ||
            line.quantity < 1 ||
            line.quantity > 100000 ||
            !Number.isSafeInteger(line.unitCost) ||
            line.unitCost < 0 ||
            line.unitCost > 1e9,
        )
      ) {
        setError(
          "Enter whole units (1–100,000) and an explicit unit cost in cents (0–1,000,000,000) for every line.",
        );
        return;
      }
      setReview({
        supplier,
        warehouse,
        currency,
        lines: lines.map((line, i) => ({
          ...line,
          quantity: String(input[i]!.quantity),
          unitCost: String(input[i]!.unitCost),
        })),
        payload: { supplierId, warehouseId, lines: input },
      });
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another tab is submitting this staff account's purchase attempt. Wait for its outcome before retrying.",
            );
          const current = retained(storageKey);
          if (current.error) throw Error(current.error);
          if (current.pending && current.pending.key !== pending?.key) {
            if (active.current) {
              setPending(current.pending);
              setReview(current.pending.review);
            }
            throw Error(
              "Another tab retained a purchase attempt. Review its exact details before retrying.",
            );
          }
          const attempt = pending ?? { key: crypto.randomUUID(), review };
          // Persist before transport. Every retry, including reload/sign-out recovery,
          // uses this key and payload; changing an uncertain attempt is prohibited.
          localStorage.setItem(storageKey, JSON.stringify(attempt));
          if (active.current) setPending(attempt);
          let result: { id: string };
          try {
            result = await request<{ id: string }>(
              "/api/commands/purchase.create",
              {
                method: "POST",
                headers: { "idempotency-key": attempt.key },
                body: JSON.stringify(attempt.review.payload),
              },
            );
          } catch (e) {
            // These native refusals occur only after fresh authority and before any
            // commit. Cached success would have returned before line validation.
            // Authority, key conflicts and transport failures remain uncertain.
            if (e instanceof RequestError && [400, 404].includes(e.status)) {
              localStorage.removeItem(storageKey);
              if (active.current) setPending(null);
            }
            throw e;
          }
          if (!result || typeof result.id !== "string" || !result.id)
            throw Error(
              "Purchase reply could not be confirmed. Retry the retained attempt.",
            );
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Retained exact retry remains safe. */
          }
          if (active.current) created(result.id);
        },
      );
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Purchase attempt could not be confirmed.",
        );
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  const edit = (
    <>
      <label>
        Supplier
        <select
          aria-label="Supplier"
          required
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="" disabled>
            Select…
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Warehouse
        <select
          aria-label="Warehouse"
          required
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="" disabled>
            Select…
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        Enter purchase costs in {currency} cents. Selling prices are not
        purchase costs. Up to 100 different products; receipts are recorded
        separately.
      </p>
      <label>
        Purchase product search
        <input
          ref={searchInput}
          value={search}
          maxLength={120}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setSelection({
                search: search.trim(),
                after: null,
                epoch: selection.epoch + 1,
              });
            }
          }}
        />
      </label>
      <button
        type="button"
        onClick={() =>
          setSelection({
            search: search.trim(),
            after: null,
            epoch: selection.epoch + 1,
          })
        }
      >
        Search purchase products
      </button>
      <ProductPage
        key={selection.epoch}
        search={selection.search}
        after={selection.after}
        selected={new Set(lines.map((line) => line.product.id))}
        disabled={busy}
        add={(product) =>
          setLines((current) =>
            current.some((line) => line.product.id === product.id) ||
            current.length >= 100
              ? current
              : [...current, { product, quantity: "1", unitCost: "" }],
          )
        }
        next={(after) =>
          setSelection({ ...selection, after, epoch: selection.epoch + 1 })
        }
      />
      <section aria-label="Selected purchase lines">
        <h3>{lines.length} selected purchase lines</h3>
        {lines.map((line) => (
          <fieldset key={line.product.id}>
            <legend>
              {line.product.sku} · {line.product.name}
            </legend>
            <label>
              Units for {line.product.sku}
              <input
                type="number"
                required
                min={1}
                max={100000}
                step={1}
                value={line.quantity}
                onChange={(e) =>
                  setLines((current) =>
                    current.map((r) =>
                      r.product.id === line.product.id
                        ? { ...r, quantity: e.target.value }
                        : r,
                    ),
                  )
                }
              />
            </label>
            <label>
              Unit cost in cents for {line.product.sku}
              <input
                type="number"
                required
                min={0}
                max={1e9}
                step={1}
                value={line.unitCost}
                onChange={(e) =>
                  setLines((current) =>
                    current.map((r) =>
                      r.product.id === line.product.id
                        ? { ...r, unitCost: e.target.value }
                        : r,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setLines((current) =>
                  current.filter((r) => r.product.id !== line.product.id),
                );
                searchInput.current?.focus();
              }}
            >
              Remove {line.product.sku}
            </button>
          </fieldset>
        ))}
      </section>
    </>
  );
  const summary = review && (
    <>
      <p>
        Supplier: {review.supplier.name} · Warehouse: {review.warehouse.name}
      </p>
      <section aria-label="Reviewed purchase lines">
        {review.lines.map((line) => (
          <p key={line.product.id}>
            {line.product.sku} · {line.product.name} · {line.quantity} units ×{" "}
            {amount(BigInt(line.unitCost), review.currency)} ={" "}
            {amount(lineCost(line), review.currency)}
          </p>
        ))}
      </section>
      <p>
        Purchase total:{" "}
        {amount(
          review.lines.reduce((sum, line) => sum + lineCost(line), 0n),
          review.currency,
        )}
        . This is the sum of entered line costs; no tax, freight or supplier
        payment is added.
      </p>
      {pending ? (
        <p>
          A submitted attempt is retained. Retry these exact details to confirm
          its outcome. Closing this view or signing out cannot cancel a
          submitted order. Recovery is available on this browser for the same
          staff account; do not clear its storage or create a replacement
          elsewhere until reconciled.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setReview(null);
            setError("");
          }}
        >
          Edit purchase lines
        </button>
      )}
    </>
  );
  return (
    <Modal
      dialog={{
        title: review ? "Review purchase order" : "Create purchase order",
        fields: [
          {
            name: "purchase",
            label: "Purchase details",
            content: recovery.error ? (
              <p>
                Reconcile the retained attempt before creating another order.
              </p>
            ) : (
              (summary ?? edit)
            ),
          },
        ],
        perform: submit,
        submitLabel: pending
          ? "Retry exact purchase"
          : review
            ? "Create reviewed purchase order"
            : "Review purchase order",
      }}
      busy={busy}
      error={error}
      close={close}
      submit={submit}
    />
  );
}
