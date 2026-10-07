import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import type { SoldSerial, SoldSerialPage } from "../shared/sold-serials.ts";

export function SoldSerialSelect({
  initial,
  label,
  name,
  required = false,
  chooseFirst = false,
  refreshToken,
  onSelectionChange,
}: {
  initial: SoldSerialPage;
  label: string;
  name: string;
  required?: boolean;
  chooseFirst?: boolean;
  refreshToken?: unknown;
  onSelectionChange: (unit: SoldSerial | null) => void;
}) {
  const [page, setPage] = useState(initial);
  const [selected, setSelected] = useState(
    chooseFirst ? (initial.items[0]?.id ?? "") : "",
  );
  const [query, setQuery] = useState("");
  const [selectedUnit, setSelectedUnit] = useState<SoldSerial | null>(
    chooseFirst ? (initial.items[0] ?? null) : null,
  );
  const refreshSeen = useRef(refreshToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<{ after?: string; preserve: boolean } | null>(null);
  const select = useRef<HTMLSelectElement | null>(null);
  const focusAfterLoad = useRef(false);
  useEffect(() => {
    if (!busy && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      select.current?.focus();
    }
  }, [busy]);
  useEffect(() => {
    if (chooseFirst) onSelectionChange(initial.items[0] ?? null);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  const clearSelection = () => {
    setSelected("");
    setSelectedUnit(null);
    onSelectionChange(null);
  };
  const load = async (after?: string, preserve = false) => {
    if (preserve) pending.current?.abort();
    else if (pending.current) return;
    if (!preserve) clearSelection();
    const controller = new AbortController();
    pending.current = controller;
    retry.current = { after, preserve };
    setError("");
    setBusy(true);
    if (!after && !preserve) {
      setPage({ items: [], next: null });
      setLoaded(false);
    }
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (after) params.set("after", after);
    try {
      const result = await request<SoldSerialPage>(
        `/api/warranty/sold-units/page${params.size ? `?${params}` : ""}`,
        { signal: controller.signal },
      );
      if (pending.current !== controller) return;
      setPage(result);
      setLoaded(true);
      retry.current = null;
      focusAfterLoad.current = !preserve;
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Serials could not be read.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (Object.is(refreshSeen.current, refreshToken)) return;
    refreshSeen.current = refreshToken;
    void load(undefined, true);
  }, [refreshToken]);
  return (
    <div className="sold-serial-select">
      <div className="sold-serial-search">
        <label htmlFor={`${name}-search`}>Search sold serials</label>
        <input
          id={`${name}-search`}
          maxLength={100}
          value={query}
          onChange={(event) => {
            pending.current?.abort();
            pending.current = null;
            retry.current = null;
            setBusy(false);
            setError("");
            setLoaded(false);
            setPage({ items: [], next: null });
            clearSelection();
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void load();
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Search serials
        </button>
      </div>
      <div className="sold-serial-choice">
        <label htmlFor={`${name}-select`}>{label}</label>
        <select
          ref={select}
          id={`${name}-select`}
          name={name}
          required={required}
          disabled={busy}
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            const unit =
              page.items.find((unit) => unit.id === event.target.value) ??
              (selectedUnit?.id === event.target.value ? selectedUnit : null);
            setSelectedUnit(unit);
            onSelectionChange(unit);
          }}
        >
          <option value="">Select a sold serial</option>
          {selectedUnit &&
            !page.items.some((unit) => unit.id === selectedUnit.id) && (
              <option value={selectedUnit.id}>{selectedUnit.serial}</option>
            )}
          {page.items.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.serial}
            </option>
          ))}
        </select>
      </div>
      <p role="status" aria-label="Sold serial search status">
        {busy
          ? "Loading sold serials…"
          : !loaded
            ? "Run a search to load sold serials."
            : `${page.items.length} sold serial${page.items.length === 1 ? "" : "s"} on this page${page.next ? " · More results available" : " · End of results"}`}
      </p>
      {loaded && !page.items.length && (
        <p>No matching sold serials available.</p>
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
          onClick={() =>
            void load(
              error ? retry.current?.after : page.next!,
              error ? retry.current?.preserve : false,
            )
          }
        >
          {error ? "Retry serial search" : "Next sold serials"}
        </button>
      )}
      <p>Search part of a serial, or leave the search empty to start again.</p>
    </div>
  );
}
