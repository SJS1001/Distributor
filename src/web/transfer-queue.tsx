import React, { useId, useLayoutEffect, useRef, useState } from "react";
import {
  transferQueueStates,
  type TransferQueueState,
} from "../shared/transfer-queue.ts";
import { request } from "./api.ts";

type Transfer = Record<string, any>;
type Page = { items: Transfer[]; next: string | null };
type Selection = {
  state: TransferQueueState | "";
  after: string | null;
  trail: (string | null)[];
};
const names: Record<TransferQueueState, string> = {
  transit: "In transit",
  "partially-received": "Partially received",
  "partially-reconciled": "Partially reconciled",
  received: "Received",
  "reconciled-with-loss": "Reconciled with loss",
};

// The application replaces this component on refresh. Only the current page's
// headers are retained; older/newer navigation keeps continuation tokens only.
export function TransferQueue({
  initial,
  active,
  children,
}: {
  initial: Page;
  active: boolean;
  children: (items: Transfer[]) => React.ReactNode;
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
      const result = await request<Page>(`/api/transfers/page?${query}`, {
        signal: controller.signal,
      });
      if (!current()) return;
      setPage(result);
      if (focus) heading.current?.focus();
    } catch (e) {
      if (current())
        setError(
          e instanceof Error ? e.message : "Transfers could not be loaded.",
        );
    } finally {
      if (current()) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section aria-label="Transfer queue">
      <h2 id="inventory-transfers" ref={heading} tabIndex={-1}>
        Transfers
      </h2>
      <label htmlFor={stateId}>Transfer state</label>
      <select
        id={stateId}
        value={selection.state}
        disabled={!active}
        onChange={(e) =>
          void load(
            {
              state: e.target.value as TransferQueueState | "",
              after: null,
              trail: [],
            },
            false,
          )
        }
      >
        <option value="">All states</option>
        {transferQueueStates.map((state) => (
          <option key={state} value={state}>
            {names[state]}
          </option>
        ))}
      </select>
      <p>
        Newest recorded transfers first. States and quantities are current when
        each page is read.
      </p>
      <p role="status">
        {busy
          ? "Loading transfers…"
          : page && active
            ? `${page.items.length} transfers on this page · Page ${selection.trail.length + 1}`
            : "No transfer page available."}
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={!active}
          onClick={() =>
            void load({ state: selection.state, after: null, trail: [] })
          }
        >
          Refresh transfers
        </button>
        {page && active && selection.trail.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void load({
                state: selection.state,
                after: selection.trail.at(-1)!,
                trail: selection.trail.slice(0, -1),
              })
            }
          >
            Newer transfers
          </button>
        )}
        {page?.next && active && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void load({
                state: selection.state,
                after: page.next,
                trail: [...selection.trail, selection.after],
              })
            }
          >
            Older transfers
          </button>
        )}
      </div>
      {error && (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            type="button"
            ref={retry}
            disabled={!active || busy}
            onClick={() => void load(selection)}
          >
            Retry transfer queue
          </button>
        </>
      )}
      {page &&
        active &&
        (page.items.length ? (
          children(page.items)
        ) : (
          <p>No transfers match this state in your current warehouse scope.</p>
        ))}
    </section>
  );
}
