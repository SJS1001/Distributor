import React, { useEffect, useRef, useState } from "react";
import { WarrantyAssessments } from "./warranty-registration.tsx";
import type { WarrantyRegistrationReview } from "../shared/warranty-registration.ts";
import { request } from "./api.ts";
import type { WarrantyCoverage } from "../shared/warranty-coverage.ts";
import type { SoldSerial, SoldSerialPage } from "../shared/sold-serials.ts";
import { SoldSerialSelect } from "./sold-serial-select.tsx";

export function SoldCoverage({
  initial,
  refreshToken,
  onClose,
}: {
  initial: SoldSerialPage;
  refreshToken?: unknown;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const refreshSeen = useRef(refreshToken);
  const [unit, setUnit] = useState<SoldSerial | null>(null);
  const [coverage, setCoverage] = useState<WarrantyCoverage | null>(null);
  const [assessment, setAssessment] =
    useState<WarrantyRegistrationReview | null>(null);
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
    setAssessment(null);
    setError("");
    setBusy(false);
  };
  const load = async () => {
    if (!unit || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setCoverage(null);
    setAssessment(null);
    setError("");
    setBusy(true);
    try {
      const [result, registration] = await Promise.all([
        request<WarrantyCoverage>(
          `/api/warranty/sold-units/${encodeURIComponent(unit.id)}/coverage?accountId=${encodeURIComponent(unit.accountId)}`,
          { signal: controller.signal },
        ),
        request<WarrantyRegistrationReview>(
          `/api/warranty/sold-units/${encodeURIComponent(unit.id)}/registration?accountId=${encodeURIComponent(unit.accountId)}`,
          { signal: controller.signal },
        ),
      ]);
      if (pending.current === controller) {
        setCoverage(result);
        setAssessment(registration);
      }
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
  useEffect(() => {
    if (Object.is(refreshSeen.current, refreshToken)) return;
    refreshSeen.current = refreshToken;
    if (unit) void load();
  }, [refreshToken]);
  return (
    <section
      id="sold-coverage-panel"
      className="sold-coverage-panel"
      aria-label="Sold serial coverage"
    >
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          Sold serial coverage
        </h2>
        <button
          type="button"
          className="secondary icon-button"
          aria-label="Close coverage lookup"
          title="Close coverage lookup"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p>
        Coverage rules are provisional. Dates do not approve a claim or
        determine return eligibility. Submit a request for review even when the
        calculated date has elapsed.
      </p>
      <SoldSerialSelect
        initial={initial}
        refreshToken={refreshToken}
        name="coverage-unit"
        label="Sold serial for coverage"
        onSelectionChange={(selected) => {
          clear();
          setUnit(selected);
        }}
      />
      <div className="coverage-lookup-actions">
        <button
          className="secondary"
          disabled={!unit || busy}
          onClick={() => void load()}
        >
          {error ? "Retry coverage lookup" : "Check coverage dates"}
        </button>
        <p role="status" aria-label="Coverage status">
          {busy
            ? "Loading coverage…"
            : coverage
              ? "Coverage dates loaded"
              : "Select a serial and check its coverage dates."}
        </p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {assessment && (
        <WarrantyAssessments
          returnEligibility={assessment.returnEligibility}
          warrantyEligibility={assessment.warrantyEligibility}
        />
      )}
      {coverage && (
        <details>
          <summary>Historical shipment coverage calculation</summary>
          <p>Serial {coverage.serial}</p>
          <p>Original shipment: {coverage.shippedAt}</p>
          <p>Calculated coverage end: {coverage.coverageEnd}</p>
          <p>
            {coverage.source === "replacement_inherited"
              ? "Replacement retains the original coverage end; replacement handover does not restart coverage."
              : coverage.source === "shipment_policy"
                ? `Duration retained at shipment: ${coverage.provisionalDays} days. Later policy changes do not change these dates.`
                : `Historical shipment policy is unavailable. Current provisional duration: ${coverage.provisionalDays} days after shipment.`}
          </p>
          <p>
            {coverage.policy
              ? `Policy version ${coverage.policy.revision}.`
              : "Historical policy version is unavailable."}
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
        </details>
      )}
    </section>
  );
}
