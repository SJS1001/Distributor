import { InfoBubble } from "./info-bubble.tsx";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  countQueueStates,
  type CountQueueState,
} from "../shared/count-queue.ts";
import { request } from "./api.ts";
import "./fulfillment-queues.css";

type Count = Record<string, any>;
type Page = { items: Count[]; next: string | null };
type Selection = {
  state: CountQueueState | "";
  after: string | null;
  trail: (string | null)[];
};
const names: Record<CountQueueState, string> = {
  draft: "Awaiting observation",
  submitted: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
};

// The application replaces this component on refresh. Only the current page's
// headers are retained; older/newer navigation keeps continuation tokens only.
export function CountQueue({
  initial,
  active,
  selectedState,
  onState,
  children,
}: {
  initial: Page;
  active: boolean;
  selectedState?: CountQueueState | "";
  onState?: (state: CountQueueState | "") => void;
  children: (items: Count[]) => React.ReactNode;
}) {
  const [page, setPage] = useState<Page | null>(initial);
  const [selection, setSelection] = useState<Selection>({
    state: "",
    after: null,
    trail: [],
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const enabled = useRef(active);
  const heading = useRef<HTMLHeadingElement>(null),
    retry = useRef<HTMLButtonElement>(null);
  const stateId = useId();
  useLayoutEffect(() => {
    enabled.current = active;
    if (!active) {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
    }
    return () => {
      enabled.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, [active]);
  useLayoutEffect(() => {
    if (error) retry.current?.focus();
  }, [error]);
  const load = async (next: Selection, focus = true) => {
    if (!enabled.current) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSelection(next);
    setPage(null);
    setError("");
    setBusy(true);
    const query = new URLSearchParams();
    if (next.state) query.set("state", next.state);
    if (next.after) query.set("after", next.after);
    const current = () =>
      enabled.current &&
      pending.current === controller &&
      !controller.signal.aborted;
    try {
      const result = await request<Page>(`/api/counts/page?${query}`, {
        signal: controller.signal,
      });
      if (!current()) return;
      setPage(result);
      if (focus) heading.current?.focus();
    } catch (e) {
      if (current())
        setError(
          e instanceof Error ? e.message : "Counts could not be loaded.",
        );
    } finally {
      if (current()) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (
      active &&
      selectedState !== undefined &&
      selection.state !== selectedState
    )
      void load({ state: selectedState ?? "", after: null, trail: [] }, false);
  }, [selectedState, active]);
  const count = page?.items.length ?? 0;
  return (
    <section aria-label="Count queue" className="fulfillment-queue">
      <div className="queue-controls">
        <h2 id="inventory-counts" ref={heading} tabIndex={-1}>
          Cycle counts
        </h2>
        <div className="queue-field">
          <label htmlFor={stateId}>Count state</label>
          <select
            id={stateId}
            value={selection.state}
            disabled={!active}
            onChange={(e) => {
              onState?.(e.target.value as CountQueueState | "");
              void load(
                {
                  state: e.target.value as CountQueueState | "",
                  after: null,
                  trail: [],
                },
                false,
              );
            }}
          >
            <option value="">All states</option>
            {countQueueStates.map((state) => (
              <option key={state} value={state}>
                {names[state]}
              </option>
            ))}
          </select>
        </div>
        <div className="queue-field queue-field-actions">
          <button
            type="button"
            className="secondary"
            disabled={!active}
            onClick={() =>
              void load({ state: selection.state, after: null, trail: [] })
            }
          >
            Refresh counts
          </button>
          {page && active && selection.trail.length > 0 && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void load({
                  state: selection.state,
                  after: selection.trail.at(-1)!,
                  trail: selection.trail.slice(0, -1),
                })
              }
            >
              Newer counts
            </button>
          )}
          {page?.next && active && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void load({
                  state: selection.state,
                  after: page.next,
                  trail: [...selection.trail, selection.after],
                })
              }
            >
              Older counts
            </button>
          )}
        </div>
        <div className="status-line">
          <p role="status">
            {busy
              ? "Loading counts…"
              : page && active
                ? `${count} ${count === 1 ? "count" : "counts"} on this page · Page ${selection.trail.length + 1}`
                : "No count page available."}
          </p>
          <InfoBubble label="count list">
            Newest recorded counts first. States and observations are current
            when each page is read.
          </InfoBubble>
        </div>
        {error && (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button
              type="button"
              className="secondary"
              ref={retry}
              disabled={!active || busy}
              onClick={() => void load(selection)}
            >
              Retry count queue
            </button>
          </>
        )}
      </div>
      {page &&
        active &&
        (page.items.length ? (
          children(page.items)
        ) : (
          <p className="fulfillment-empty">
            No counts match this state in your current warehouse scope.
          </p>
        ))}
    </section>
  );
}
