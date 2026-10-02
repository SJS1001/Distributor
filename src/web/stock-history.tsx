import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  StockHistoryInput,
  StockHistoryPage,
} from "../shared/stock-history.ts";
import { request } from "./api.ts";
import { SerialDossier } from "./serial-dossier.tsx";
import { StockMovementList } from "./stock-movement-list.tsx";

export function StockHistory({
  selection,
  currency,
  productName,
  warehouseName,
  canReviewSerial,
  onClose,
}: {
  selection: Pick<StockHistoryInput, "unitId" | "serial">;
  currency: string;
  productName: (id: string) => string;
  warehouseName: (id: string) => string;
  canReviewSerial: boolean;
  onClose: () => void;
}) {
  const query = new URLSearchParams(
    selection as Record<string, string>,
  ).toString();
  const endpoint = `/api/stock/history?${query}`;
  const [page, setPage] = useState<StockHistoryPage | null>(null);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [trail, setTrail] = useState<(string | null)[]>([]);
  const pending = useRef<AbortController | null>(null),
    active = useRef(true);
  const attempt = useRef<{ after: string | null; trail: (string | null)[] }>({
    after: null,
    trail: [],
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(
    async (after: string | null, previous: (string | null)[]) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      attempt.current = { after, trail: previous };
      setPage(null);
      setError("");
      setBusy(true);
      try {
        const result = await request<StockHistoryPage>(
          endpoint + (after ? `&after=${encodeURIComponent(after)}` : ""),
          { signal: controller.signal },
        );
        if (!active.current || pending.current !== controller) return;
        setPage(result);
        setTrail(previous);
      } catch (e) {
        if (
          active.current &&
          pending.current === controller &&
          !controller.signal.aborted
        )
          setError(
            e instanceof Error
              ? e.message
              : "Stock history could not be loaded.",
          );
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          if (active.current) setBusy(false);
        }
      }
    },
    [endpoint],
  );
  useEffect(() => {
    if (selectedSerial) return;
    active.current = true;
    heading.current?.focus();
    void load(null, []);
    return () => {
      active.current = false;
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, [load, selectedSerial]);
  const formatter = useMemo(
    () => new Intl.NumberFormat("en", { style: "currency", currency }),
    [currency],
  );
  const money = (value: number) => formatter.format(value / 100);
  if (selectedSerial)
    return (
      <SerialDossier
        serial={selectedSerial}
        currency={currency}
        productName={productName}
        warehouseName={warehouseName}
        onBack={() => setSelectedSerial(null)}
        onClose={onClose}
      />
    );
  return (
    <section className="stock-history" aria-label="Stock movement history">
      <h2 ref={heading} tabIndex={-1}>
        Stock movement history
      </h2>
      <div className="actions">
        <button type="button" onClick={onClose}>
          Close stock history
        </button>
        <button type="button" onClick={() => void load(null, [])}>
          Refresh movement history
        </button>
      </div>
      <p>
        Newest committed movements first. Each page shows this stock record and
        its current position when read. Warehouse staff see movements at their
        permitted sites. Split bulk records have separate histories.
      </p>
      {busy && <p role="status">Loading stock history…</p>}
      {error && (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() =>
              void load(attempt.current.after, attempt.current.trail)
            }
          >
            Retry movement history
          </button>
        </>
      )}
      {page && (
        <>
          {page.unit.serial && canReviewSerial && (
            <button
              type="button"
              onClick={() => setSelectedSerial(page.unit.serial!)}
            >
              Review serial dossier
            </button>
          )}
          <p>
            <strong>{productName(page.unit.product_id)}</strong> ·{" "}
            {page.unit.serial ? `Serial ${page.unit.serial}` : "Bulk lot"} ·
            record <code>{page.unit.id}</code>
          </p>
          <p>
            {warehouseName(page.unit.warehouse_id)} / {page.unit.bin} ·{" "}
            {page.unit.state} · {page.unit.condition} · {page.unit.quantity}{" "}
            units · original unit cost {money(page.unit.cost)} · revision{" "}
            {page.unit.revision}
          </p>
          <p role="status">{page.items.length} movements on this page.</p>
          {page.items.length === 0 && (
            <p>No movements are visible in this scope.</p>
          )}
          <StockMovementList
            items={page.items}
            money={money}
            warehouseName={warehouseName}
          />
          <div className="actions">
            {trail.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  void load(trail[trail.length - 1]!, trail.slice(0, -1))
                }
              >
                Newer movements
              </button>
            )}
            {page.next && (
              <button
                type="button"
                onClick={() =>
                  void load(page.next, [...trail, attempt.current.after])
                }
              >
                Older movements
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
