import { InfoBubble } from "./info-bubble.tsx";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { claimStates, type ClaimState } from "../shared/claim-queue.ts";
import { request } from "./api.ts";
import "./operations-lane.css";

type Claim = Record<string, any>;
type Page = { items: Claim[]; next: string | null };
const empty: Claim[] = [];
export function useClaimQueue(
  initialItems: Claim[] | undefined,
  initialNext: string | null | undefined,
  active: boolean,
) {
  const initial = initialItems ?? empty;
  const [view, setView] = useState({
    source: initial,
    items: initial,
    next: initialNext ?? null,
    state: "" as ClaimState | "",
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
      const page = await request<Page>(`/api/warranty/claims/page?${query}`, {
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
  const filter = (state: ClaimState | "") => {
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

export function ClaimQueueControls({
  queue,
}: {
  queue: ReturnType<typeof useClaimQueue>;
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
    <section
      className="queue-controls claim-queue-controls"
      aria-label="Claim queue"
    >
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Claim queue
        </h2>
        <InfoBubble label="Claim queue">
          Newest recorded claims first. Refresh reloads the queue and its
          current states.
        </InfoBubble>
      </div>
      <div className="queue-field">
        <label htmlFor={stateId}>Claim state</label>
        <select
          id={stateId}
          value={queue.state}
          disabled={!queue.active}
          onChange={(e) => queue.filter(e.target.value as ClaimState | "")}
        >
          <option value="">All states</option>
          {claimStates.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>
      <div className="queue-field queue-field-actions">
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
            ? "Retry claim queue"
            : queue.loaded && !queue.next
              ? "All claims loaded"
              : "Load more claims"}
        </button>
      </div>
      <p role="status">
        {queue.items.length} {queue.items.length === 1 ? "claim" : "claims"}{" "}
        loaded{queue.busy ? " · Loading…" : ""}
      </p>
      {queue.error && (
        <p role="alert" className="error">
          {queue.error}
        </p>
      )}
    </section>
  );
}
