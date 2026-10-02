import React, { useEffect, useState } from "react";
import { request } from "./api.ts";
import type {
  SupplierChoice,
  SupplierPage,
} from "../shared/supplier-search.ts";

function SupplierResults({
  q,
  after,
  selected,
  choose,
  next,
}: {
  q: string;
  after: string | null;
  selected: SupplierChoice | null;
  choose: (supplier: SupplierChoice) => void;
  next: (cursor: string) => void;
}) {
  const [page, setPage] = useState<SupplierPage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<SupplierPage>(
      `/api/purchases/suppliers/page?q=${encodeURIComponent(q)}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [q, after, retry]);
  const options = page?.items ?? [];
  const choices =
    selected && !options.some((row) => row.id === selected.id)
      ? [selected, ...options]
      : options;
  return (
    <>
      <label>
        Supplier
        <select
          aria-label="Supplier"
          required
          value={selected?.id ?? ""}
          onChange={(e) => {
            const row = choices.find((item) => item.id === e.target.value);
            if (row) choose(row);
          }}
        >
          <option value="" disabled>
            Select…
          </option>
          {choices.map((row) => (
            <option key={row.id} value={row.id} disabled={!row.active}>
              {row.name}
              {row.active ? "" : " · Suspended for new purchasing"}
            </option>
          ))}
        </select>
      </label>
      {!page && !error && <p role="status">Loading suppliers…</p>}
      {page && (
        <>
          <p role="status">
            {page.items.length}{" "}
            {page.items.length === 1 ? "supplier" : "suppliers"} on this page
          </p>
          {!page.items.length && (
            <p>
              No matching suppliers.
              {selected ? " Your selected supplier is retained." : ""}
            </p>
          )}
          {page.next && (
            <button type="button" onClick={() => next(page.next!)}>
              Next purchase suppliers
            </button>
          )}
        </>
      )}
      {error && (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setPage(null);
              setError("");
              setRetry(retry + 1);
            }}
          >
            Retry purchase suppliers
          </button>
        </>
      )}
    </>
  );
}

export function SupplierPicker({
  selected,
  choose,
}: {
  selected: SupplierChoice | null;
  choose: (supplier: SupplierChoice) => void;
}) {
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState({
    q: "",
    after: null as string | null,
    epoch: 0,
  });
  const runSearch = () =>
    setSelection({ q: search.trim(), after: null, epoch: selection.epoch + 1 });
  return (
    <section aria-label="Purchase supplier search">
      <label>
        Purchase supplier search
        <input
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
        />
      </label>
      <button type="button" onClick={runSearch}>
        Search purchase suppliers
      </button>
      <SupplierResults
        key={selection.epoch}
        q={selection.q}
        after={selection.after}
        selected={selected}
        choose={choose}
        next={(after) =>
          setSelection({ ...selection, after, epoch: selection.epoch + 1 })
        }
      />
      {selected && (
        <p>
          Selected supplier: {selected.name}
          {selected.active
            ? ""
            : " · Suspended for new purchasing; choose an available supplier."}
        </p>
      )}
    </section>
  );
}
