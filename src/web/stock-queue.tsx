import { InfoBubble } from "./info-bubble.tsx";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  stockQueueLabels,
  stockQueueViews,
  type StockQueueView,
} from "../shared/stock-queue.ts";
import { request } from "./api.ts";

type Stock = Record<string, any>;
type Page = { items: Stock[]; next: string | null };
type Filters = {
  query: string;
  productId: string;
  warehouseId: string;
  view: StockQueueView | "";
};
const empty: Stock[] = [];
export function useStockQueue(
  initialItems: Stock[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    filters: { query: "", productId: "", warehouseId: "", view: "" } as Filters,
    loaded: true,
    busy: false,
    error: "",
  });
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ initial, active });
  useLayoutEffect(() => {
    current.current = { initial, active };
  }, [initial, active]);
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
  };
  useEffect(() => {
    cancel();
    setView({
      source: initial,
      items: initial,
      next: initialNext ?? null,
      filters: {
        query: "",
        productId: "",
        warehouseId: "",
        view: "",
      } as Filters,
      loaded: true,
      busy: false,
      error: "",
    });
    return cancel;
  }, [initial, initialNext]);
  useEffect(() => {
    if (!active) {
      cancel();
      setView((v) => ({ ...v, busy: false }));
    }
    return cancel;
  }, [active]);
  const load = async (
    filters = view.filters,
    after = view.next,
    append = true,
  ) => {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setView((v) => ({ ...v, busy: true, error: "" }));
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) {
      if (value.trim()) query.set(name, value.trim());
    }
    if (after) query.set("after", after);
    const valid = () =>
      pending.current === controller &&
      current.current.initial === initial &&
      current.current.active;
    try {
      const page = await request<Page>(`/api/stock/page?${query}`, {
        signal: controller.signal,
      });
      if (!valid()) return;
      setView((v) => ({
        ...v,
        loaded: true,
        next: page.next,
        items: append
          ? [
              ...v.items,
              ...page.items.filter(
                (c) => !v.items.some((old) => old.id === c.id),
              ),
            ]
          : page.items,
      }));
    } catch (error) {
      if (valid()) setView((v) => ({ ...v, error: (error as Error).message }));
    } finally {
      if (valid()) {
        pending.current = null;
        setView((v) => ({ ...v, busy: false }));
      }
    }
  };
  const filter = (changes: Partial<Filters>, read = true) => {
    // After new initial stock arrives, the reset effect may not have applied
    // yet; start from the reset filters the hook already displays.
    const filters = {
      ...(view.source === initial
        ? view.filters
        : ({ query: "", productId: "", warehouseId: "", view: "" } as Filters)),
      ...changes,
    };
    cancel();
    setView({
      source: initial,
      items: [],
      next: null,
      filters,
      loaded: false,
      busy: false,
      error: "",
    });
    if (read) void load(filters, null, false);
  };
  const displayed =
    view.source === initial
      ? view
      : {
          ...view,
          items: initial,
          next: initialNext ?? null,
          filters: {
            query: "",
            productId: "",
            warehouseId: "",
            view: "",
          } as Filters,
          loaded: true,
          busy: false,
          error: "",
        };
  return {
    ...displayed,
    filter,
    load,
    active,
    stop: () => {
      cancel();
      setView((v) => ({ ...v, busy: false }));
    },
  };
}

export function StockQueueControls({
  queue,
  products,
  warehouses,
  onFilters,
}: {
  queue: ReturnType<typeof useStockQueue>;
  products: Record<string, any>[];
  warehouses: Record<string, any>[];
  onFilters?: (filters: {
    view: StockQueueView | "";
    warehouseId: string;
  }) => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pager = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const prefix = useId();
  useEffect(() => {
    if (queue.busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (queue.loaded && !queue.next && !queue.error) heading.current?.focus();
    else pager.current?.focus();
  }, [queue.busy, queue.loaded, queue.next, queue.error]);
  return (
    <section className="queue-controls" aria-label="Stock queue">
      <h2 id="inventory-stock" ref={heading} tabIndex={-1}>
        Stock queue
      </h2>
      <div className="queue-field">
        <label htmlFor={`${prefix}-query`}>Search stock serial or bin</label>
        <input
          id={`${prefix}-query`}
          maxLength={100}
          value={queue.filters.query}
          disabled={!queue.active}
          onChange={(e) => queue.filter({ query: e.target.value }, false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void queue.load(queue.filters, null, false);
            }
          }}
        />
        <button
          className="secondary"
          disabled={!queue.active || queue.busy}
          onClick={() => void queue.load(queue.filters, null, false)}
        >
          Search stock
        </button>
      </div>
      <div className="queue-field">
        <label htmlFor={`${prefix}-product`}>Stock product</label>
        <select
          id={`${prefix}-product`}
          disabled={!queue.active}
          value={queue.filters.productId}
          onChange={(e) => queue.filter({ productId: e.target.value })}
        >
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="queue-field">
        <label htmlFor={`${prefix}-warehouse`}>Stock warehouse</label>
        <select
          id={`${prefix}-warehouse`}
          disabled={!queue.active}
          value={queue.filters.warehouseId}
          onChange={(e) => {
            queue.filter({ warehouseId: e.target.value });
            onFilters?.({
              view: queue.filters.view,
              warehouseId: e.target.value,
            });
          }}
        >
          <option value="">All accessible warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="queue-field">
        <label htmlFor={`${prefix}-view`}>Stock condition or state</label>
        <select
          id={`${prefix}-view`}
          disabled={!queue.active}
          value={queue.filters.view}
          onChange={(e) => {
            const view = e.target.value as StockQueueView | "";
            queue.filter({ view });
            onFilters?.({ view, warehouseId: queue.filters.warehouseId });
          }}
        >
          <option value="">All stock records</option>
          {stockQueueViews.map((v) => (
            <option key={v} value={v}>
              {stockQueueLabels[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="status-line">
        <p role="status">
          {queue.items.length} stock records loaded
          {queue.busy
            ? " · Loading…"
            : queue.loaded && !queue.next && !queue.error
              ? " · All results shown"
              : ""}
        </p>
        <InfoBubble label="stock list">
          Search by serial or bin, or narrow the list by product, warehouse and
          condition. Refresh to see the latest stock availability.
        </InfoBubble>
      </div>
      {queue.error && (
        <p role="alert" className="error">
          {queue.error}
        </p>
      )}
      {(!queue.loaded || queue.next || queue.error || queue.busy) && (
        <button
          ref={pager}
          className="secondary"
          disabled={
            !queue.active ||
            queue.busy ||
            (queue.loaded && !queue.next && !queue.error)
          }
          onClick={() => {
            restoreFocus.current = true;
            void queue.load(queue.filters, queue.next, queue.loaded);
          }}
        >
          {queue.error
            ? "Retry stock queue"
            : queue.loaded && !queue.next
              ? "All stock records loaded"
              : "Load more stock"}
        </button>
      )}
    </section>
  );
}
