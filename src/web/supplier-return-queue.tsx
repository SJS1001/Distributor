import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { request } from "./api.ts";

type SupplierReturn = Record<string, any>;
type Page = { items: SupplierReturn[]; next: string | null };
const empty: SupplierReturn[] = [];
export function useSupplierReturnQueue(
  initialItems: SupplierReturn[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    q: "",
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
      q: "",
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
  const load = async (q = view.q, after = view.next, append = true) => {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setView((v) => ({ ...v, busy: true, error: "" }));
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (after) query.set("after", after);
    const valid = () =>
      pending.current === controller &&
      current.current.initial === initial &&
      current.current.active;
    try {
      const page = await request<Page>(`/api/purchases/returns/page?${query}`, {
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
  const filter = (q: string) => {
    cancel();
    setView({
      source: initial,
      items: [],
      next: null,
      q,
      loaded: false,
      busy: false,
      error: "",
    });
    void load(q, null, false);
  };
  const displayed =
    view.source === initial
      ? view
      : {
          ...view,
          items: initial,
          next: initialNext ?? null,
          q: "",
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
      setView({
        source: initial,
        items: initial,
        next: initialNext ?? null,
        q: "",
        loaded: true,
        busy: false,
        error: "",
      });
    },
  };
}

export function SupplierReturnQueueControls({
  queue,
  onSearch,
}: {
  queue: ReturnType<typeof useSupplierReturnQueue>;
  onSearch: () => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const searchId = useId();
  const [search, setSearch] = useState(queue.q);
  useEffect(() => setSearch(queue.q), [queue.q, queue.source]);
  const pager = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (queue.busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (queue.loaded && !queue.next && !queue.error) heading.current?.focus();
    else pager.current?.focus();
  }, [queue.busy, queue.loaded, queue.next, queue.error]);
  return (
    <section className="queue-controls" aria-label="Supplier return queue">
      <h2 ref={heading} tabIndex={-1}>
        Supplier return queue
      </h2>
      <form
        className="queue-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
          queue.filter(search.trim());
        }}
      >
        <div className="queue-field">
          <label htmlFor={searchId}>Search supplier returns</label>
          <input
            id={searchId}
            type="search"
            maxLength={160}
            value={search}
            disabled={!queue.active}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="queue-field-actions">
          <button type="submit" disabled={!queue.active}>
            Search returns
          </button>
        </div>
      </form>
      <p role="status">
        {queue.items.length}{" "}
        {queue.items.length === 1 ? "supplier return" : "supplier returns"}{" "}
        loaded
        {queue.busy ? " · Loading…" : ""}
      </p>
      <p>
        Newest recorded supplier returns first. Search by return reference,
        serial or reason. Refresh reloads the queue and clears the search.
      </p>
      {queue.error && (
        <p role="alert" className="error">
          {queue.error}
        </p>
      )}
      {(!queue.loaded || queue.next || queue.error || queue.busy) && (
        <button
          type="button"
          ref={pager}
          className="secondary"
          disabled={
            !queue.active ||
            queue.busy ||
            (queue.loaded && !queue.next && !queue.error)
          }
          onClick={() => {
            restoreFocus.current = true;
            void queue.load(queue.q, queue.next, queue.loaded);
          }}
        >
          {queue.error
            ? "Retry supplier return queue"
            : queue.loaded && !queue.next
              ? "All supplier returns loaded"
              : "Load more supplier returns"}
        </button>
      )}
    </section>
  );
}
