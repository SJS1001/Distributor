import React, { useEffect, useRef, useState } from "react";
import { request } from "./api.ts";
import { WarrantyAssessments } from "./warranty-registration.tsx";
import type {
  WarrantyRegistrationReview,
  ClaimEligibilityReview,
} from "../shared/warranty-registration.ts";
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
    registration: WarrantyRegistrationReview | null,
  ) => void;
}) {
  const pending = useRef<AbortController | null>(null);
  const [unit, setUnit] = useState<SoldSerial | null>(null);
  const [coverage, setCoverage] = useState<WarrantyCoverage | null>(null);
  const [assessment, setAssessment] =
    useState<WarrantyRegistrationReview | null>(null);
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
    setAssessment(null);
    setError("");
    setBusy(false);
    onChange(selected, null, null);
    if (!selected) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const [result, registration] = await Promise.all([
        request<WarrantyCoverage>(
          `/api/warranty/sold-units/${encodeURIComponent(selected.id)}/coverage?accountId=${encodeURIComponent(selected.accountId)}`,
          { signal: controller.signal },
        ),
        request<WarrantyRegistrationReview>(
          `/api/warranty/sold-units/${encodeURIComponent(selected.id)}/registration?accountId=${encodeURIComponent(selected.accountId)}`,
          { signal: controller.signal },
        ),
      ]);
      if (pending.current === controller) {
        setCoverage(result);
        setAssessment(registration);
        onChange(selected, result, registration);
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
        <details>
          <summary>Historical shipment coverage calculation</summary>
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
        </details>
      )}
      {assessment && (
        <WarrantyAssessments
          returnEligibility={assessment.returnEligibility}
          warrantyEligibility={assessment.warrantyEligibility}
        />
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

export function RetainedClaimCoverage({
  claimId,
  refreshToken,
}: {
  claimId: string;
  refreshToken?: unknown;
}) {
  const pending = useRef<AbortController | null>(null);
  const refreshSeen = useRef(refreshToken);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ClaimCoverage | null>(null);
  const [eligibility, setEligibility] = useState<ClaimEligibilityReview | null>(
    null,
  );
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
  const load = async (refresh = false) => {
    if (refresh) pending.current?.abort();
    else if (pending.current) return;
    setOpen(true);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const [response, assessment] = await Promise.all([
        request<ClaimCoverage>(
          `/api/warranty/claims/${encodeURIComponent(claimId)}/coverage`,
          { signal: controller.signal },
        ),
        request<ClaimEligibilityReview>(
          `/api/warranty/claims/${encodeURIComponent(claimId)}/assessment`,
          { signal: controller.signal },
        ),
      ]);
      if (pending.current === controller) {
        setResult(response);
        setEligibility(assessment);
      }
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
  useEffect(() => {
    if (Object.is(refreshSeen.current, refreshToken)) return;
    refreshSeen.current = refreshToken;
    if (open) void load(true);
  }, [refreshToken]);
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
          {eligibility &&
            (eligibility.snapshot ? (
              <section aria-label="Submitted claim assessment">
                <h4>Submitted assessment</h4>
                <p>
                  Return and equipment warranty assessment retained at claim
                  submission ({eligibility.snapshot.capturedAt}).
                </p>
                <WarrantyAssessments
                  returnEligibility={eligibility.snapshot.returnEligibility}
                  warrantyEligibility={eligibility.snapshot.warrantyEligibility}
                />
              </section>
            ) : (
              <p>
                Historical return and equipment warranty snapshot unavailable;
                current policy does not establish the historical decision.
              </p>
            ))}
          {eligibility && (
            <section aria-label="Current claim assessment">
              <h4>Current assessment</h4>
              <p>
                Recalculated at {eligibility.current.capturedAt}; current terms
                and installation records may differ from the submitted snapshot.
              </p>
              <WarrantyAssessments
                returnEligibility={eligibility.current.returnEligibility}
                warrantyEligibility={eligibility.current.warrantyEligibility}
              />
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void load()}
              >
                Refresh current assessment
              </button>
            </section>
          )}
          {result && (
            <details>
              <summary>Historical retained shipment calculation</summary>
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
            </details>
          )}
        </section>
      )}
    </div>
  );
}
