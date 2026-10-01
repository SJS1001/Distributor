import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import type { WarrantyCoverage } from "../shared/warranty-coverage.ts";

type SoldUnit = { id: string; serial: string; accountId: string };
export function SoldCoverage({
  units,
  onClose,
}: {
  units: SoldUnit[];
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [unitId, setUnitId] = useState("");
  const [coverage, setCoverage] = useState<WarrantyCoverage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    heading.current?.focus();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  const clear = () => {
    pending.current?.abort();
    pending.current = null;
    setCoverage(null);
    setError("");
    setBusy(false);
  };
  const load = async () => {
    const unit = units.find((u) => u.id === unitId);
    if (!unit || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setCoverage(null);
    setError("");
    setBusy(true);
    try {
      const result = await request<WarrantyCoverage>(
        `/api/warranty/sold-units/${encodeURIComponent(unit.id)}/coverage?accountId=${encodeURIComponent(unit.accountId)}`,
        { signal: controller.signal },
      );
      if (pending.current === controller) setCoverage(result);
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Coverage could not be read.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section aria-label="Sold serial coverage">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          Sold serial coverage
        </h2>
        <button className="secondary" onClick={onClose}>
          Close coverage lookup
        </button>
      </div>
      <p>
        Coverage rules are provisional. Dates do not approve a claim or
        determine return eligibility. Submit a request for review even when the
        calculated date has elapsed.
      </p>
      {!units.length && <p>No currently sold serials available.</p>}
      <label htmlFor="sold-serial-coverage">Sold serial for coverage</label>
      <select
        id="sold-serial-coverage"
        value={unitId}
        onChange={(e) => {
          clear();
          setUnitId(e.target.value);
        }}
      >
        <option value="">Select a sold serial</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.serial}
          </option>
        ))}
      </select>
      <button
        className="secondary"
        disabled={!unitId || busy}
        onClick={() => void load()}
      >
        {error ? "Retry coverage lookup" : "Check coverage dates"}
      </button>
      <p role="status">
        {busy
          ? "Loading coverage…"
          : coverage
            ? "Coverage dates loaded"
            : "Select a serial and check its coverage dates."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {coverage && (
        <div>
          <p>Serial {coverage.serial}</p>
          <p>Original shipment: {coverage.shippedAt}</p>
          <p>Calculated coverage end: {coverage.coverageEnd}</p>
          <p>
            {coverage.source === "replacement_inherited"
              ? "Replacement retains the original coverage end; replacement handover does not restart coverage."
              : `Current provisional duration: ${coverage.provisionalDays} days after shipment.`}
          </p>
          <p>
            {coverage.datePosition === "elapsed"
              ? "Calculated end date has elapsed."
              : coverage.datePosition === "before_start"
                ? "Original shipment date is in the future; review the recorded evidence."
                : "Assessment is within the calculated dates."}{" "}
            Eligibility requires review.
          </p>
          <p>Assessed at {coverage.assessedAt}. Recheck after any change.</p>
        </div>
      )}
    </section>
  );
}
