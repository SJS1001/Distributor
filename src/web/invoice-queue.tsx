import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  invoiceQueueLabels,
  invoiceQueueStates,
  type InvoiceQueueState,
} from "../shared/invoice-queue.ts";
import { request } from "./api.ts";

type Invoice = Record<string, any>;
type Page = { items: Invoice[]; next: string | null };
const empty: Invoice[] = [];
export function useInvoiceQueue(
  initialItems: Invoice[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    state: "" as InvoiceQueueState | "",
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
      state: "",
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
  const load = async (state = view.state, after = view.next, append = true) => {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setView((v) => ({ ...v, busy: true, error: "" }));
    const query = new URLSearchParams();
    if (state) query.set("state", state);
    if (after) query.set("after", after);
    const valid = () =>
      pending.current === controller &&
      current.current.initial === initial &&
      current.current.active;
    try {
      const page = await request<Page>(`/api/billing/invoices/page?${query}`, {
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
  const filter = (state: InvoiceQueueState | "") => {
    cancel();
    setView({
      source: initial,
      items: [],
      next: null,
      state,
      loaded: false,
      busy: false,
      error: "",
    });
    void load(state, null, false);
  };
  const displayed =
    view.source === initial
      ? view
      : {
          ...view,
          items: initial,
          next: initialNext ?? null,
          state: "" as const,
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

export function InvoiceQueueControls({
  queue,
}: {
  queue: ReturnType<typeof useInvoiceQueue>;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const stateId = useId();
  const pager = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (queue.busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (queue.loaded && !queue.next && !queue.error) heading.current?.focus();
    else pager.current?.focus();
  }, [queue.busy, queue.loaded, queue.next, queue.error]);
  return (
    <section aria-label="Invoice queue">
      <h2 ref={heading} tabIndex={-1}>
        Invoice queue
      </h2>
      <label htmlFor={stateId}>Invoice balance</label>
      <select
        id={stateId}
        value={queue.state}
        disabled={!queue.active}
        onChange={(e) => queue.filter(e.target.value as InvoiceQueueState | "")}
      >
        <option value="">All balances</option>
        {invoiceQueueStates.map((state) => (
          <option key={state} value={state}>
            {invoiceQueueLabels[state]}
          </option>
        ))}
      </select>
      <p role="status">
        {queue.items.length} invoices loaded
        {queue.busy ? " · Loading…" : ""}
      </p>
      <p>
        Newest recorded invoices first. Refresh reloads the queue and its
        current balances.
      </p>
      {queue.error && (
        <p role="alert" className="error">
          {queue.error}
        </p>
      )}
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
          void queue.load(queue.state, queue.next, queue.loaded);
        }}
      >
        {queue.error
          ? "Retry invoice queue"
          : queue.loaded && !queue.next
            ? "All invoices loaded"
            : "Load more invoices"}
      </button>
    </section>
  );
}
