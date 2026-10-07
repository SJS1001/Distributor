import { InfoBubble } from "./info-bubble.tsx";
import { SavedFilters } from "./saved-filters.tsx";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  orderQueueStates,
  type OrderQueueState,
} from "../shared/order-queue.ts";
import { request } from "./api.ts";

type Order = Record<string, any>;
type Page = { items: Order[]; next: string | null };
const empty: Order[] = [];
export function useOrderQueue(
  initialItems: Order[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    state: "" as OrderQueueState | "",
    reservation: "" as "overdue" | "",
    loaded: true,
    busy: false,
    error: "",
  });
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ initial, active });
  // Only committed inputs may fence a request from the visible screen.
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
      reservation: "",
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
    state = view.state,
    after = view.next,
    append = true,
    reservation = view.reservation,
  ) => {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setView((v) => ({ ...v, busy: true, error: "" }));
    const query = new URLSearchParams();
    if (state) query.set("state", state);
    if (reservation) query.set("reservation", reservation);
    if (after) query.set("after", after);
    const valid = () =>
      pending.current === controller &&
      current.current.initial === initial &&
      current.current.active;
    try {
      const page = await request<Page>(`/api/orders/page?${query}`, {
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
  const filter = (
    state: OrderQueueState | "",
    reservation: "overdue" | "" = view.reservation,
  ) => {
    cancel();
    setView({
      source: initial,
      items: [],
      next: null,
      state,
      reservation,
      loaded: false,
      busy: false,
      error: "",
    });
    void load(state, null, false, reservation);
  };
  const displayed =
    view.source === initial
      ? view
      : {
          ...view,
          items: initial,
          next: initialNext ?? null,
          state: "" as const,
          reservation: "" as const,
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

const orderSavedFilters = ["open", "closed", "overdue"] as const;

export function OrderQueueControls({
  queue,
  scope,
  onFilter,
  onReservation,
}: {
  queue: ReturnType<typeof useOrderQueue>;
  scope?: string;
  onFilter?: (
    state: OrderQueueState | "",
    reservation?: "overdue" | "",
  ) => void;
  onReservation?: (value: "overdue" | "") => void;
}) {
  const apply = (state: OrderQueueState | "") => {
    queue.filter(state);
    onFilter?.(state);
  };
  const heading = useRef<HTMLHeadingElement | null>(null);
  const stateId = useId();
  const reservationId = useId();
  const applyReservation = (reservation: "overdue" | "") => {
    queue.filter(queue.state, reservation);
    onReservation?.(reservation);
  };
  const pager = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (queue.busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (queue.loaded && !queue.next && !queue.error) heading.current?.focus();
    else pager.current?.focus();
  }, [queue.busy, queue.loaded, queue.next, queue.error]);
  return (
    <section className="queue-controls" aria-label="Order queue">
      <h2 id="orders-queue" ref={heading} tabIndex={-1}>
        Order queue
      </h2>
      <div className="queue-field">
        <label htmlFor={stateId}>Order state</label>
        <select
          id={stateId}
          value={queue.state}
          disabled={!queue.active}
          onChange={(e) => apply(e.target.value as OrderQueueState | "")}
        >
          <option value="">All states</option>
          {orderQueueStates.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>
      <div className="queue-field">
        <label htmlFor={reservationId}>Reservation deadline</label>
        <select
          id={reservationId}
          value={queue.reservation}
          disabled={!queue.active}
          onChange={(e) => applyReservation(e.target.value as "overdue" | "")}
        >
          <option value="">All deadlines</option>
          <option value="overdue">Overdue reservations on open orders</option>
        </select>
      </div>
      {queue.reservation && (
        <p>
          Open orders with a recorded reservation deadline at or before the
          current time, or whose latest reservation history records expiry.{" "}
          <button
            type="button"
            disabled={!queue.active}
            onClick={() => applyReservation("")}
          >
            Clear reservation filter
          </button>
        </p>
      )}
      {scope && (
        <SavedFilters
          scope={scope}
          allowed={orderSavedFilters}
          labels={{ overdue: "Overdue reservations" }}
          value={queue.reservation ? "overdue" : queue.state}
          disabled={!queue.active || queue.busy}
          apply={(saved) => {
            const state = saved === "overdue" ? "" : (saved as OrderQueueState);
            const reservation = saved === "overdue" ? "overdue" : "";
            queue.filter(state, reservation);
            onFilter?.(state, reservation);
          }}
        />
      )}
      {queue.state && (
        <button
          type="button"
          disabled={!queue.active}
          onClick={() => apply("")}
        >
          Clear order state filter
        </button>
      )}
      <div className="status-line">
        <p role="status">
          {queue.items.length} {queue.items.length === 1 ? "order" : "orders"}{" "}
          loaded
          {queue.busy
            ? " · Loading…"
            : queue.loaded && !queue.next && !queue.error
              ? " · All results shown"
              : ""}
        </p>
        <InfoBubble label="order list">
          Newest recorded orders first. Refresh reloads the queue and its
          current states.
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
            void queue.load(queue.state, queue.next, queue.loaded);
          }}
        >
          {queue.error
            ? "Retry order queue"
            : queue.loaded && !queue.next
              ? "All orders loaded"
              : "Load more orders"}
        </button>
      )}
    </section>
  );
}
