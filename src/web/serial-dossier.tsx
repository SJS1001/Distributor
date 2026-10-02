import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SerialDossier as Dossier,
  SerialDossierInput,
} from "../shared/serial-dossier.ts";
import { request } from "./api.ts";
import { StockMovementList } from "./stock-movement-list.tsx";

type Position = Omit<SerialDossierInput, "serial">;
export function SerialDossier({
  serial,
  currency,
  productName,
  warehouseName,
  onBack,
  onClose,
}: {
  serial: string;
  currency: string;
  productName: (id: string) => string;
  warehouseName: (id: string) => string;
  onBack: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [trail, setTrail] = useState<Position[]>([]);
  const pending = useRef<AbortController | null>(null),
    active = useRef(true);
  const attempt = useRef<{ position: Position; trail: Position[] }>({
    position: {},
    trail: [],
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(
    async (position: Position, previous: Position[]) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      attempt.current = { position, trail: previous };
      setPage(null);
      setError("");
      setBusy(true);
      try {
        const query = new URLSearchParams({ serial, ...position });
        const result = await request<Dossier>(`/api/serials/dossier?${query}`, {
          signal: controller.signal,
        });
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
              : "Serial dossier could not be loaded.",
          );
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          if (active.current) setBusy(false);
        }
      }
    },
    [serial],
  );
  useEffect(() => {
    active.current = true;
    heading.current?.focus();
    void load({}, []);
    return () => {
      active.current = false;
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, [load]);
  const formatters = useMemo(
    () =>
      new Map(
        [
          ...new Set([
            currency,
            ...(page?.shipments.items.flatMap((s) =>
              s.invoice ? [s.invoice.currency] : [],
            ) ?? []),
          ]),
        ].map((c) => [
          c,
          new Intl.NumberFormat("en", { style: "currency", currency: c }),
        ]),
      ),
    [currency, page],
  );
  const money = (amount: number, c = currency) =>
    formatters.get(c)!.format(amount / 100);
  const older = (section: keyof Position, after: string) =>
    void load({ ...attempt.current.position, [section]: after }, [
      ...trail,
      attempt.current.position,
    ]);
  return (
    <section className="stock-history" aria-label="Serial dossier">
      <h2 ref={heading} tabIndex={-1}>
        Serial dossier
      </h2>
      <div className="actions">
        <button type="button" onClick={onBack}>
          Back to movements
        </button>
        <button type="button" onClick={onClose}>
          Close serial dossier
        </button>
        <button type="button" onClick={() => void load({}, [])}>
          Refresh serial dossier
        </button>
      </div>
      <p>
        Serial {serial}. Each section shows up to twenty records within your
        current access. Missing evidence means none is visible in this scope.
        Older pages retain the other sections’ positions. Refresh starts every
        section again.
      </p>
      {busy && <p role="status">Loading serial dossier…</p>}
      {error && (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() =>
              void load(attempt.current.position, attempt.current.trail)
            }
          >
            Retry serial dossier
          </button>
        </>
      )}
      {page && (
        <>
          <p>
            <strong>{productName(page.movements.unit.product_id)}</strong> ·
            stock record <code>{page.movements.unit.id}</code>
          </p>
          <p>
            {warehouseName(page.movements.unit.warehouse_id)} /{" "}
            {page.movements.unit.bin} · {page.movements.unit.state} ·{" "}
            {page.movements.unit.condition} · {page.movements.unit.quantity}{" "}
            units · original unit cost {money(page.movements.unit.cost)} ·
            revision {page.movements.unit.revision}
          </p>
          <section aria-label="Original receipt">
            <h3>Original receipt</h3>
            {page.receipt ? (
              <>
                <p>
                  Delivery reference{" "}
                  <strong>{page.receipt.deliveryReference}</strong> ·{" "}
                  {warehouseName(page.receipt.warehouseId)} ·{" "}
                  {new Date(page.receipt.receivedAt).toLocaleString()}
                </p>
                <p>
                  Purchase order <code>{page.receipt.purchaseOrderId}</code> ·
                  supplier <code>{page.receipt.supplierId}</code> · receipt{" "}
                  <code>{page.receipt.id}</code>
                </p>
              </>
            ) : (
              <p>No original receipt is visible in this scope.</p>
            )}
          </section>
          <section aria-label="Sales and invoices">
            <h3>Sales and invoices</h3>
            <p>
              {page.shipments.items.length} committed sales on this page. Totals
              belong to whole invoices and may include other stock.
            </p>
            {!page.shipments.items.length && (
              <p>No committed sales are visible in this scope.</p>
            )}
            <ol>
              {page.shipments.items.map((s) => (
                <li key={s.id}>
                  <p>
                    Shipment <code>{s.id}</code> · order{" "}
                    <code>{s.orderId}</code> · customer{" "}
                    <code>{s.accountId}</code>
                  </p>
                  <p>
                    {warehouseName(s.warehouseId)} · {s.mode} ·{" "}
                    {new Date(s.shippedAt).toLocaleString()}
                    {s.carrier && ` · ${s.carrier}`}
                    {s.tracking && ` · tracking ${s.tracking}`}
                  </p>
                  {s.invoice ? (
                    <>
                      <p>
                        Invoice <strong>{s.invoice.number}</strong> ·{" "}
                        <code>{s.invoice.id}</code> ·{" "}
                        {new Date(s.invoice.createdAt).toLocaleString()}
                      </p>
                      <p>
                        Whole invoice total{" "}
                        {money(s.invoice.total, s.invoice.currency)}{" "}
                        {s.invoice.currency}
                      </p>
                    </>
                  ) : (
                    <p>
                      No invoice summary is visible in this scope.
                      {s.invoiceId && (
                        <>
                          {" "}
                          Invoice reference <code>{s.invoiceId}</code>.
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {page.shipments.next && (
              <button
                type="button"
                onClick={() => older("shipmentAfter", page.shipments.next!)}
              >
                Older sales
              </button>
            )}
          </section>
          <section aria-label="Claims and replacements">
            <h3>Claims and replacements</h3>
            <p>
              {page.claims.items.length} claims on this page. Replacement
              reservation and handover are separate states; the original claim
              retains its invoice.
            </p>
            {!page.claims.items.length && (
              <p>No claims or replacement links are visible in this scope.</p>
            )}
            <ol>
              {page.claims.items.map((c) => (
                <li key={c.id}>
                  <p>
                    <strong>
                      {c.relationship === "replacement"
                        ? "Replacement for claim"
                        : "Claim for this serial"}
                    </strong>{" "}
                    <code>{c.id}</code> · {c.type} · {c.state}
                  </p>
                  <p>{c.issue}</p>
                  <p>
                    Created {new Date(c.createdAt).toLocaleString()} · coverage
                    ends {new Date(c.coverageEnd).toLocaleString()}
                  </p>
                  <p>
                    Original claimed stock <code>{c.unitId}</code> · customer{" "}
                    <code>{c.accountId}</code> · shipment{" "}
                    <code>{c.shipmentId}</code> · invoice{" "}
                    <code>{c.invoiceId}</code>
                  </p>
                  {c.replacementState && (
                    <p>
                      Replacement state: <strong>{c.replacementState}</strong>
                    </p>
                  )}
                  {c.disposition && <p>Disposition: {c.disposition}</p>}
                  {c.creditId && (
                    <p>
                      Credit reference <code>{c.creditId}</code>
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {page.claims.next && (
              <button
                type="button"
                onClick={() => older("claimAfter", page.claims.next!)}
              >
                Older claims
              </button>
            )}
          </section>
          <section aria-label="Stock movements">
            <h3>Stock movements</h3>
            <p>{page.movements.items.length} movements on this page.</p>
            {!page.movements.items.length && (
              <p>No movements are visible in this scope.</p>
            )}
            <StockMovementList
              items={page.movements.items}
              money={money}
              warehouseName={warehouseName}
            />
            {page.movements.next && (
              <button
                type="button"
                onClick={() => older("movementAfter", page.movements.next!)}
              >
                Older movements
              </button>
            )}
          </section>
          {trail.length > 0 && (
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  void load(trail[trail.length - 1]!, trail.slice(0, -1))
                }
              >
                Previous dossier page
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
