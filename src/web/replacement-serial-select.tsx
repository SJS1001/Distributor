import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { request } from "./api.ts";
type Unit = Record<string, any>;
type Page = { items: Unit[]; next: string | null };
export function ReplacementSerialSelect({
  claimId,
  warehouseName,
}: {
  claimId: string;
  warehouseName: (id: string) => string;
}) {
  const [page, setPage] = useState<Page>({ items: [], next: null });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<string | null>(null);
  const select = useRef<HTMLSelectElement | null>(null);
  const focusAfterLoad = useRef(false);
  const prefix = useId();
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
  }, []);
  const load = useCallback(
    async (search: string, after: string | null = null) => {
      if (pending.current) return;
      setSelected("");
      setError("");
      setBusy(true);
      if (!after) {
        setPage({ items: [], next: null });
        setLoaded(false);
      }
      retry.current = after;
      const controller = new AbortController();
      pending.current = controller;
      const params = new URLSearchParams();
      if (search.trim()) params.set("query", search.trim());
      if (after) params.set("after", after);
      try {
        const result = await request<Page>(
          `/api/warranty/claims/${encodeURIComponent(claimId)}/replacement-candidates?${params}`,
          { signal: controller.signal },
        );
        if (pending.current !== controller) return;
        setPage(result);
        setLoaded(true);
        focusAfterLoad.current = true;
      } catch (e) {
        if (pending.current === controller && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
    [claimId],
  );
  useEffect(() => {
    void load("");
    return cancel;
  }, [load, cancel]);
  useEffect(() => {
    if (!busy && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      select.current?.focus();
    }
  }, [busy]);
  return (
    <div>
      <label htmlFor={`${prefix}-search`}>
        Search replacement serial or bin
      </label>
      <input
        id={`${prefix}-search`}
        value={query}
        maxLength={100}
        onChange={(e) => {
          cancel();
          setQuery(e.target.value);
          setSelected("");
          setPage({ items: [], next: null });
          setLoaded(false);
          setBusy(false);
          setError("");
          retry.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void load(query);
          }
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void load(query)}
      >
        Search replacements
      </button>
      <label htmlFor={`${prefix}-serial`}>Replacement serial</label>
      <select
        ref={select}
        id={`${prefix}-serial`}
        name="newUnitId"
        required
        disabled={busy}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Select a replacement serial</option>
        {page.items.map((u) => (
          <option key={u.id} value={u.id}>
            {u.serial} · {warehouseName(u.warehouse_id)} / {u.bin}
          </option>
        ))}
      </select>
      <p role="status" aria-label="Replacement serial search status">
        {busy
          ? "Loading replacement serials…"
          : !loaded
            ? "Run a search to load replacement serials."
            : `${page.items.length} replacement serials on this page${page.next ? " · More results available" : " · End of results"}`}
      </p>
      {loaded && !page.items.length && (
        <p>No matching usable unreserved serials available.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {(page.next || error) && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(query, error ? retry.current : page.next)}
        >
          {error ? "Retry replacement search" : "Next replacement serials"}
        </button>
      )}
      <p>
        Only usable unreserved serials of the returned product at permitted
        warehouses are offered. Availability is checked again when reserving.
      </p>
    </div>
  );
}
