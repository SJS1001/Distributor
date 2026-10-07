import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { SoldSerialSelect } from "./sold-serial-select.tsx";
import { ControlIcon } from "./control-icon.tsx";
import type { SoldSerial, SoldSerialPage } from "../shared/sold-serials.ts";
import type {
  SaveInstallationRegistration,
  WarrantyRegistrationReview,
  ReturnWindowEligibility,
  RegisteredWarrantyEligibility,
} from "../shared/warranty-registration.ts";
import "./warranty-registration.css";

type Attempt = { key: string; name: string; payload: Record<string, unknown> };
const names = [
  "warranty.registration.save",
  "warranty.return-policy.save",
  "warranty.terms.save",
];
function readAttempt(storageKey: string): Attempt | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as Attempt;
  if (
    raw.length > 16000 ||
    !/^[a-f0-9-]{36}$/.test(value.key) ||
    !names.includes(value.name) ||
    !value.payload ||
    typeof value.payload !== "object" ||
    !Number.isSafeInteger(value.payload.expectedRevision) ||
    Number(value.payload.expectedRevision) < 0 ||
    typeof value.payload.reason !== "string" ||
    !value.payload.reason.trim()
  )
    throw Error(
      "Retained request is invalid; restore browser recovery data before submitting.",
    );
  return value;
}
/** Keep the exact submitted payload across lost responses and remounts. */
export function useWarrantyAttempt(orgId: string, purpose: string) {
  const storageKey = `distributor-warranty:${orgId}:${purpose}`;
  const [initial] = useState(() => {
    try {
      const retained = readAttempt(storageKey);
      if (retained) {
        const p = retained.payload;
        const text = (key: string, max = 2000) =>
          typeof p[key] === "string" &&
          String(p[key]).trim().length > 0 &&
          String(p[key]).length <= max;
        const duration =
          p.days === null ||
          (Number.isSafeInteger(p.days) &&
            Number(p.days) >= 0 &&
            Number(p.days) <= 36500);
        if (
          purpose === "installation"
            ? retained.name !== "warranty.registration.save" ||
              ![
                "unitId",
                "accountId",
                "shipmentId",
                "ownershipId",
                "installer",
                "site",
                "evidence",
              ].every((key) => text(key)) ||
              !text("installedOn", 10) ||
              !/^\d{4}-\d{2}-\d{2}$/.test(String(p.installedOn))
            : purpose === "return-policy"
              ? retained.name !== "warranty.return-policy.save" || !duration
              : retained.name !== "warranty.terms.save" ||
                p.productId !== purpose.slice(6) ||
                !duration ||
                !["manufacturer", "reference", "notes"].every((key) =>
                  text(key),
                ) ||
                !["shipment", "installation"].includes(String(p.startsAt))
        )
          throw Error("Invalid retained request");
      }
      return { attempt: retained, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Browser recovery data could not be read. Restore browser storage before saving.",
      };
    }
  });
  const [attempt, setAttempt] = useState<Attempt | null>(initial.attempt);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<unknown>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async (
    name: string,
    payload: Record<string, unknown>,
    onRejected?: () => void,
  ) => {
    if (inFlight.current || initial.error) return null;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let submitted: Attempt | null = null;
    try {
      const retained = readAttempt(storageKey);
      if (JSON.stringify(retained) !== JSON.stringify(attempt))
        throw Error(
          "Recovery data changed. Reopen this page to review the retained request.",
        );
      submitted = retained ?? { key: crypto.randomUUID(), name, payload };
      if (
        retained &&
        (retained.name !== name ||
          JSON.stringify(retained.payload) !== JSON.stringify(payload))
      )
        throw Error(
          "Retry the retained original request before another change.",
        );
      sessionStorage.setItem(storageKey, JSON.stringify(submitted));
      if (mounted.current) setAttempt(submitted);
      const result = await request(`/api/commands/${submitted.name}`, {
        method: "POST",
        headers: { "idempotency-key": submitted.key },
        body: JSON.stringify(submitted.payload),
      });
      if (mounted.current) setReceipt(result);
      if (sessionStorage.getItem(storageKey) !== JSON.stringify(submitted))
        throw Error(
          "Saved successfully, but recovery data changed. Preserve the receipt and reopen this page.",
        );
      sessionStorage.removeItem(storageKey);
      if (mounted.current) setAttempt(null);
      return result;
    } catch (e) {
      // A definitive rejected request did not commit; stale revisions require a fresh review.
      if (
        submitted &&
        e instanceof RequestError &&
        ["REVISION", "VALIDATION", "INSTALLATION_DATE"].includes(e.code ?? "")
      ) {
        try {
          if (
            sessionStorage.getItem(storageKey) === JSON.stringify(submitted)
          ) {
            sessionStorage.removeItem(storageKey);
            if (mounted.current) {
              setAttempt(null);
              onRejected?.();
            }
          }
        } catch {
          /* retain exact request */
        }
      }
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Save response unavailable. Retry the retained request.",
        );
      return null;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { attempt, error, busy, receipt, send };
}
export function WarrantyAssessments({
  returnEligibility: ordinary,
  warrantyEligibility: warranty,
}: {
  returnEligibility: ReturnWindowEligibility;
  warrantyEligibility: RegisteredWarrantyEligibility;
}) {
  return (
    <div className="warranty-assessments">
      <section aria-label="Ordinary return assessment">
        <h3>Ordinary return</h3>
        <p>
          {ordinary.datePosition === "unconfigured"
            ? "Return window is unset; review required."
            : ordinary.datePosition === "elapsed"
              ? "Ordinary return window has elapsed."
              : ordinary.datePosition === "before_start"
                ? "Shipment date needs review."
                : "Within the ordinary return window."}
        </p>
        <p>
          {ordinary.endAt
            ? `Return window ends ${ordinary.endAt}.`
            : "No return end date configured."}{" "}
          Policy revision {ordinary.policy.revision}.
        </p>
        <p>Ordinary return dates do not bar a warranty claim.</p>
      </section>
      <section aria-label="Equipment warranty assessment">
        <h3>Equipment warranty</h3>
        {warranty.provisional && (
          <p>
            Provisional inherited warranty dates: historical product terms are
            unavailable; review the original evidence.
          </p>
        )}
        <p>
          {warranty.datePosition === "unconfigured"
            ? "Product warranty terms are unset; review required."
            : warranty.datePosition === "registration_required"
              ? "Register installation to calculate the warranty dates."
              : warranty.datePosition === "elapsed"
                ? "Calculated warranty end has elapsed; request review."
                : warranty.datePosition === "before_start"
                  ? "Warranty start date needs review."
                  : "Within the calculated warranty dates."}
        </p>
        <p>
          {warranty.endAt
            ? `Warranty end: ${warranty.endAt}.`
            : "Warranty end requires review."}{" "}
          Terms revision {warranty.terms.revision}.
        </p>
        <p>
          Dates do not approve or reject a claim. Manufacturer acceptance is not
          recorded by local registration.
        </p>
      </section>
    </div>
  );
}
export function WarrantyRegistration({
  initial,
  orgId,
  actorId,
  refreshToken,
  onClose,
}: {
  initial: SoldSerialPage;
  orgId: string;
  actorId: string;
  refreshToken?: unknown;
  onClose?: () => void;
}) {
  const [unit, setUnit] = useState<SoldSerial | null>(null);
  const [record, setRecord] = useState<WarrantyRegistrationReview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<SaveInstallationRegistration | null>(null);
  const [review, setReview] = useState<SaveInstallationRegistration | null>(
    null,
  );
  const mutation = useWarrantyAttempt(`${orgId}:${actorId}`, "installation");
  const pending = useRef<AbortController | null>(null);
  const refreshSeen = useRef(refreshToken);
  const [stale, setStale] = useState("");
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  const load = async (selected: SoldSerial | null, preserve = false) => {
    pending.current?.abort();
    pending.current = null;
    if (!preserve) {
      setUnit(selected);
      setRecord(null);
      setDraft(null);
      setReview(null);
      setStale("");
    }
    setError("");
    setBusy(false);
    if (!selected) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const result = await request<WarrantyRegistrationReview>(
        `/api/warranty/sold-units/${encodeURIComponent(selected.id)}/registration?accountId=${encodeURIComponent(selected.accountId)}`,
        { signal: controller.signal },
      );
      if (pending.current !== controller) return;
      setRecord(result);
      if (preserve && (draft || mutation.attempt)) {
        const expected = mutation.attempt?.payload ?? draft!;
        setStale(
          expected.expectedRevision !== (result.registration?.revision ?? 0) ||
            expected.ownershipId !== result.ownershipId ||
            record?.terms.revision !== result.terms.revision ||
            record?.returnEligibility.policy.revision !==
              result.returnEligibility.policy.revision
            ? "Installation record or ownership changed. Your draft, reviewed revision and retained request were preserved; reload the current record and review before a new save."
            : "Server record refreshed. Your draft and reviewed revision were preserved.",
        );
      }
      if (!preserve || (!draft && !mutation.attempt))
        setDraft({
          unitId: result.unitId,
          accountId: result.accountId,
          shipmentId: result.shipmentId,
          ownershipId: result.ownershipId,
          expectedRevision: result.registration?.revision ?? 0,
          installedOn: result.registration?.installedOn ?? "",
          installer: result.registration?.installer ?? "",
          site: result.registration?.site ?? "",
          evidence: result.registration?.evidence ?? "",
          reason: "",
        });
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Registration could not be read.",
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
    const retained =
      mutation.attempt?.name === "warranty.registration.save"
        ? mutation.attempt.payload
        : null;
    const selected =
      unit ??
      (retained
        ? {
            id: String(retained.unitId),
            accountId: String(retained.accountId),
            productId: record?.productId ?? "",
            serial: record?.serial ?? "",
          }
        : null);
    if (selected) void load(selected, true);
  }, [refreshToken]);
  const reviewed =
    mutation.attempt?.name === "warranty.registration.save"
      ? (mutation.attempt.payload as SaveInstallationRegistration)
      : review;
  const save = async () => {
    if (!reviewed) return;
    const result = await mutation.send(
      "warranty.registration.save",
      { ...reviewed },
      () => {
        setDraft({ ...reviewed });
        setReview(null);
      },
    );
    if (result) {
      setReview(null);
      if (unit) await load(unit);
    }
  };
  return (
    <section
      className="warranty-record-panel"
      aria-label="Installation registration"
    >
      <div className="section-heading">
        <h2>Installation registration</h2>
        {onClose && (
          <button
            className="secondary icon-button"
            aria-label="Close installation registration"
            title="Close installation registration"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <p>
        Record installation for a sold serial. Corrections retain earlier
        records. This local record is not manufacturer registration or
        acceptance.
      </p>
      {!mutation.attempt && (
        <fieldset
          disabled={mutation.busy || !!review}
          className="warranty-record-fields warranty-record-wide"
        >
          <SoldSerialSelect
            initial={initial}
            refreshToken={refreshToken}
            name="installation-unit"
            label="Sold serial for installation"
            onSelectionChange={(selected) => {
              if (!mutation.busy) void load(selected);
            }}
          />
        </fieldset>
      )}
      <p role="status">
        {busy
          ? "Loading installation record…"
          : record
            ? `Serial ${record.serial} · registration revision ${record.registration?.revision ?? 0}`
            : "Select a sold serial to register its installation."}
      </p>
      {unit && !mutation.attempt && (
        <button
          type="button"
          className="secondary icon-button"
          aria-label="Refresh installation record"
          title="Refresh installation record"
          disabled={busy || mutation.busy}
          onClick={() => void load(unit, true)}
        >
          <ControlIcon name="refresh" />
        </button>
      )}
      {stale && <p role="status">{stale}</p>}
      {stale.startsWith("Installation record or ownership changed") &&
        unit &&
        !mutation.attempt && (
          <button
            type="button"
            className="secondary"
            disabled={busy || mutation.busy}
            onClick={() => void load(unit)}
          >
            Reload current installation and discard draft
          </button>
        )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mutation.error && (
        <p className="error" role="alert">
          {mutation.error}
        </p>
      )}
      {mutation.receipt !== null && (
        <p role="status">
          Installation registration saved. The save receipt is retained even if
          the current record cannot be refreshed.
        </p>
      )}
      {record && (
        <WarrantyAssessments
          returnEligibility={record.returnEligibility}
          warrantyEligibility={record.warrantyEligibility}
        />
      )}
      {draft && !reviewed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setReview({ ...draft });
          }}
        >
          <fieldset
            className="warranty-record-fields"
            disabled={mutation.busy || busy}
          >
            <label>
              Installation date
              <input
                type="date"
                required
                value={draft.installedOn}
                onChange={(event) =>
                  setDraft({ ...draft, installedOn: event.target.value })
                }
              />
            </label>
            <label>
              Installer
              <input
                required
                maxLength={240}
                value={draft.installer}
                onChange={(event) =>
                  setDraft({ ...draft, installer: event.target.value })
                }
              />
            </label>
            <label>
              Installation site
              <input
                required
                maxLength={1000}
                value={draft.site}
                onChange={(event) =>
                  setDraft({ ...draft, site: event.target.value })
                }
              />
            </label>
            <label>
              Installation evidence reference
              <textarea
                required
                maxLength={2000}
                value={draft.evidence}
                onChange={(event) =>
                  setDraft({ ...draft, evidence: event.target.value })
                }
              />
            </label>
            <label className="warranty-record-wide">
              Reason for registration or correction
              <textarea
                required
                maxLength={1000}
                value={draft.reason}
                onChange={(event) =>
                  setDraft({ ...draft, reason: event.target.value })
                }
              />
            </label>
          </fieldset>
          <button
            type="submit"
            disabled={mutation.busy || busy || (!!mutation.error && !draft)}
          >
            Review installation registration
          </button>
        </form>
      )}
      {reviewed && (
        <section
          className="warranty-review"
          aria-label="Review installation registration"
        >
          <h3>
            {mutation.attempt
              ? "Recover submitted registration"
              : "Review installation registration"}
          </h3>
          <dl>
            <dt>Sold unit</dt>
            <dd>{reviewed.unitId}</dd>
            <dt>Reviewed ownership</dt>
            <dd>{reviewed.ownershipId}</dd>
            <dt>Installation date</dt>
            <dd>{reviewed.installedOn}</dd>
            <dt>Installer</dt>
            <dd>{reviewed.installer}</dd>
            <dt>Site</dt>
            <dd>{reviewed.site}</dd>
            <dt>Evidence</dt>
            <dd>{reviewed.evidence}</dd>
            <dt>Reason</dt>
            <dd>{reviewed.reason}</dd>
            <dt>Reviewed revision</dt>
            <dd>{reviewed.expectedRevision}</dd>
          </dl>
          <div className="warranty-record-actions">
            <button disabled={mutation.busy} onClick={() => void save()}>
              {mutation.busy
                ? "Saving registration…"
                : mutation.attempt
                  ? "Retry retained registration"
                  : "Save installation registration"}
            </button>
            {!mutation.attempt && (
              <button
                className="secondary"
                disabled={mutation.busy}
                onClick={() => setReview(null)}
              >
                Edit registration
              </button>
            )}
          </div>
        </section>
      )}
      {record && (
        <details>
          <summary>
            Installation correction history ({record.history.length})
          </summary>
          {record.history.length ? (
            <div
              className="table-wrap warranty-installation-history"
              role="region"
              aria-label="Installation correction history table"
              tabIndex={0}
            >
              <p className="table-scroll-hint">
                Scroll horizontally to view all history columns.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Revision</th>
                    <th scope="col">Installed</th>
                    <th scope="col">Installer / site</th>
                    <th scope="col">Evidence / reason</th>
                    <th scope="col">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {record.history.map((item) => (
                    <tr key={item.revision}>
                      <td>{item.revision}</td>
                      <td>{item.installedOn}</td>
                      <td>
                        {item.installer}
                        <br />
                        {item.site}
                      </td>
                      <td>
                        {item.evidence}
                        <br />
                        {item.reason}
                      </td>
                      <td>{item.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No installation registration recorded.</p>
          )}
        </details>
      )}
    </section>
  );
}
