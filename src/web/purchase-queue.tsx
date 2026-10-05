import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  purchaseQueueStates,
  type PurchaseQueueState,
} from "../shared/purchase-queue.ts";
import { request } from "./api.ts";

type Order = Record<string, any>;
type Page = { items: Order[]; next: string | null };
const empty: Order[] = [];
export function usePurchaseQueue(
  initialItems: Order[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    state: "" as PurchaseQueueState | "",
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
      const page = await request<Page>(`/api/purchases/orders/page?${query}`, {
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
  const filter = (state: PurchaseQueueState | "") => {
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

export function PurchaseQueueControls({
  queue,
}: {
  queue: ReturnType<typeof usePurchaseQueue>;
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
    <section className="queue-controls" aria-label="Purchase order queue">
      <h2 id="purchasing-queue" ref={heading} tabIndex={-1}>
        Purchase order queue
      </h2>
      <div className="queue-field">
        <label htmlFor={stateId}>Purchase order state</label>
        <select
          id={stateId}
          value={queue.state}
          disabled={!queue.active}
          onChange={(e) =>
            queue.filter(e.target.value as PurchaseQueueState | "")
          }
        >
          <option value="">All states</option>
          {purchaseQueueStates.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>
      <p role="status">
        {queue.items.length} purchase orders loaded
        {queue.busy
          ? " · Loading…"
          : queue.loaded && !queue.next && !queue.error
            ? " · All results shown"
            : ""}
      </p>
      <p>
        Newest recorded purchase orders first. Refresh reloads the queue and its
        current states.
      </p>
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
            void queue.load(queue.state, queue.next, queue.loaded);
          }}
        >
          {queue.error
            ? "Retry purchase order queue"
            : queue.loaded && !queue.next
              ? "All purchase orders loaded"
              : "Load more purchase orders"}
        </button>
      )}
    </section>
  );
}
