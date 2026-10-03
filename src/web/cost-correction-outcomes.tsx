import React, { useEffect, useRef, useState } from "react";
import type {
  CostCorrections,
  CorrectionOutcomeInput,
} from "../server/cost-corrections.ts";
import { command, request } from "./api.ts";
type Outcomes = ReturnType<CostCorrections["outcomes"]>;
export function CostCorrectionOutcomes({
  correctionId,
  contentHash,
  recoveryHold,
}: {
  correctionId: string;
  contentHash: string;
  recoveryHold: boolean;
}) {
  const [state, setState] = useState<Outcomes | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [],
  );
  const load = async (signal: AbortSignal) => {
    const result = await request<Outcomes>(
      `/api/accounting/cost-corrections/${encodeURIComponent(correctionId)}/outcomes`,
      { signal },
    );
    signal.throwIfAborted();
    if (
      result.contentHash !== contentHash ||
      result.correctionId !== correctionId
    )
      throw Error("Ledger history does not match this approved correction.");
    setState(result);
  };
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Ledger observation failed. Retry the same evidence.",
        );
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section aria-label="Correction ledger observations">
      <h4>Correction ledger observations</h4>
      <p>
        Record evidence obtained from the receiver. This does not send a journal
        or independently verify posting. Uncertain requests retain their
        reference. Posted and cancelled observations are final.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void run(load)}>
        {state ? "Refresh ledger observations" : "Load ledger observations"}
      </button>
      {state?.legs.map((leg) => (
        <section key={leg.leg} aria-label={`${leg.leg} ledger journal`}>
          <h5>{leg.leg === "reversal" ? "Reversal" : "Replacement"} journal</h5>
          <p>
            Receiver: {state.receiverRef} · {state.receiverRegion} ·{" "}
            {state.currency}. Intended debit/credit: {leg.debit}/{leg.credit}{" "}
            minor units. Approved posting date: {leg.postingDate}.
          </p>
          <p>
            Current observation: {leg.current?.input.outcome ?? "none recorded"}{" "}
            · revision {leg.current?.revision ?? 0}.
          </p>
          <ol>
            {leg.history.map((o) => (
              <li key={o.revision}>
                Revision {o.revision}: {o.input.outcome} · {o.input.externalRef}{" "}
                · {o.input.evidence} · {o.recordedBy} · {o.recordedAt}. Evidence
                SHA-256:{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {o.evidenceHash}
                </code>
                .
              </li>
            ))}
          </ol>
          {leg.history.length < (leg.current?.revision ?? 0) && (
            <p>
              Showing the latest 100 observations; older evidence remains in the
              store.
            </p>
          )}
          {(!leg.current || leg.current.input.outcome === "unknown") && (
            <form
              key={`${leg.leg}-${leg.current?.revision ?? 0}`}
              aria-label={`Record ${leg.leg} ledger observation`}
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget),
                  outcome = String(
                    values.get("outcome"),
                  ) as CorrectionOutcomeInput["outcome"];
                const input: CorrectionOutcomeInput = {
                  correctionId,
                  contentHash,
                  leg: leg.leg,
                  previousRevision: leg.current?.revision ?? 0,
                  receiverRef: state.receiverRef,
                  receiverRegion: state.receiverRegion,
                  currency: state.currency,
                  debit: leg.debit,
                  credit: leg.credit,
                  outcome,
                  externalRef:
                    leg.current?.input.externalRef ??
                    String(values.get("externalRef")),
                  postingDate:
                    outcome === "posted"
                      ? String(values.get("postingDate"))
                      : null,
                  evidence: String(values.get("evidence")),
                };
                void run(async (signal) => {
                  await command(
                    "accounting.cost.correction.observe",
                    input,
                    signal,
                  );
                  signal.throwIfAborted();
                  await load(signal);
                });
              }}
            >
              <fieldset disabled={busy || recoveryHold}>
                <legend>Record {leg.leg} evidence</legend>
                <div className="form-field">
                  <label htmlFor={`ledger-${leg.leg}-outcome`}>
                    Observed {leg.leg} outcome
                  </label>
                  <select
                    id={`ledger-${leg.leg}-outcome`}
                    name="outcome"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose observed outcome
                    </option>
                    <option value="unknown">Unknown</option>
                    <option value="posted">Verified posted</option>
                    <option value="cancelled-unposted">
                      Verified cancelled and unposted
                    </option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor={`ledger-${leg.leg}-reference`}>
                    {leg.leg} journal or request reference
                  </label>
                  <input
                    id={`ledger-${leg.leg}-reference`}
                    name="externalRef"
                    required
                    maxLength={160}
                    defaultValue={leg.current?.input.externalRef ?? ""}
                    readOnly={!!leg.current}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor={`ledger-${leg.leg}-date`}>
                    {leg.leg} observed posting date (posted only)
                  </label>
                  <input
                    id={`ledger-${leg.leg}-date`}
                    name="postingDate"
                    type="date"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor={`ledger-${leg.leg}-evidence`}>
                    {leg.leg} receiver outcome evidence
                  </label>
                  <textarea
                    id={`ledger-${leg.leg}-evidence`}
                    name="evidence"
                    required
                    maxLength={2000}
                  />
                </div>
                <button type="submit">
                  Record {leg.leg} ledger observation
                </button>
              </fieldset>
            </form>
          )}
        </section>
      ))}
    </section>
  );
}
