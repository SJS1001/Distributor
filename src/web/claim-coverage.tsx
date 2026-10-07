import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { SoldSerialSelect } from "./sold-serial-select.tsx";
import type {
  ClaimCoverage,
  WarrantyCoverage,
} from "../shared/warranty-coverage.ts";
import type { SoldSerial, SoldSerialPage } from "../shared/sold-serials.ts";

export function ClaimSerialReview({
  initial,
  onChange,
}: {
  initial: SoldSerialPage;
  onChange: (
    unit: SoldSerial | null,
    coverage: WarrantyCoverage | null,
  ) => void;
}) {
  const pending = useRef<AbortController | null>(null);
  const [unit, setUnit] = useState<SoldSerial | null>(null);
  const [coverage, setCoverage] = useState<WarrantyCoverage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  const load = async (selected: SoldSerial | null) => {
    pending.current?.abort();
    pending.current = null;
    setUnit(selected);
    setCoverage(null);
    setError("");
    setBusy(false);
    onChange(selected, null);
    if (!selected) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const result = await request<WarrantyCoverage>(
        `/api/warranty/sold-units/${encodeURIComponent(selected.id)}/coverage?accountId=${encodeURIComponent(selected.accountId)}`,
        { signal: controller.signal },
      );
      if (pending.current === controller) {
        setCoverage(result);
        onChange(selected, result);
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
  return (
    <div>
      <SoldSerialSelect
        initial={initial}
        name="unitId"
        label="Sold serial"
        required
        chooseFirst
        onSelectionChange={(selected) => void load(selected)}
      />
      <p role="status" aria-label="Claim coverage review status">
        {busy
          ? "Loading claim coverage…"
          : coverage
            ? "Claim coverage dates loaded"
            : "Select a serial to review its coverage dates."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {coverage && (
        <p>
          Calculated coverage end: {coverage.coverageEnd}.{" "}
          {coverage.policy
            ? `Policy version ${coverage.policy.revision}: ${coverage.policy.days} days after the original shipment.`
            : "Original replacement end retained; historical policy version is unavailable."}{" "}
          {coverage.source === "shipment_policy"
            ? "Duration retained at shipment; later policy changes do not change these dates."
            : coverage.source === "current_provisional_policy"
              ? "Historical shipment policy is unavailable; these dates use the current provisional policy."
              : "Replacement inherits the original coverage end."}{" "}
          Eligibility requires review.
        </p>
      )}
      {unit && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(unit)}
        >
          {error ? "Retry claim coverage" : "Recheck claim coverage"}
        </button>
      )}
    </div>
  );
}

export function RetainedClaimCoverage({ claimId }: { claimId: string }) {
  const pending = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ClaimCoverage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  const load = async () => {
    if (pending.current) return;
    setOpen(true);
    setResult(null);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await request<ClaimCoverage>(
        `/api/warranty/claims/${encodeURIComponent(claimId)}/coverage`,
        { signal: controller.signal },
      );
      if (pending.current === controller) setResult(response);
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Retained coverage could not be read.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div>
      <button
        type="button"
        className="secondary"
        ref={opener}
        onClick={() => void load()}
      >
        Claim coverage snapshot
      </button>
      {open && (
        <section aria-label="Retained claim coverage">
          <h3 ref={heading} tabIndex={-1}>
            Retained claim coverage
          </h3>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              pending.current?.abort();
              pending.current = null;
              setBusy(false);
              setOpen(false);
              opener.current?.focus();
            }}
          >
            Close claim coverage
          </button>
          {busy && <p role="status">Loading retained coverage…</p>}
          {error && (
            <>
              <p role="alert" className="error">
                {error}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void load()}
              >
                Retry retained coverage
              </button>
            </>
          )}
          {result && (
            <>
              <p>
                Retained coverage end: {result.coverageEnd}. Eligibility
                requires review.
              </p>
              {result.snapshot ? (
                <>
                  <p>
                    Captured at {result.snapshot.capturedAt}. Original shipment:{" "}
                    {result.snapshot.shippedAt}.
                  </p>
                  <p>
                    {result.snapshot.policy
                      ? `Policy version ${result.snapshot.policy.revision}: ${result.snapshot.policy.days} days after the original shipment.`
                      : "Historical policy version is unavailable."}
                  </p>
                  {result.snapshot.source === "shipment_policy" && (
                    <p>
                      Policy retained at original shipment; later changes do not
                      change these dates.
                    </p>
                  )}
                  {result.snapshot.source === "current_provisional_policy" && (
                    <p>
                      Historical shipment policy is unavailable. This snapshot
                      used the provisional policy at claim submission.
                    </p>
                  )}
                  {result.snapshot.source === "replacement_inherited" && (
                    <p>
                      Inherited from the preceding claim. Replacement handover
                      does not restart coverage.
                    </p>
                  )}
                </>
              ) : (
                <p>
                  Historical policy snapshot is unavailable. The original claim
                  date remains retained.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
